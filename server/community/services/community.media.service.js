'use strict';
/* ============================================
   LATLOMP COMMUNITY — MEDIA SERVICE (E9D)

   Handles media uploads for community posts.
   Does NOT modify website.media.service.js.
   Reuses: SchoolWebsiteMedia model, Cloudinary config.

   Images: JPEG/PNG/WebP/GIF — max 5MB
   Videos: MP4/WebM/MOV      — max 50MB

   schoolId: ALWAYS from authenticated context.
   uploadedBy: ALWAYS from req.communityMember.memberRef.
   All records: usageContext = 'community_post'.
============================================ */
'use strict';

var path   = require('path');
var fs     = require('fs');
var crypto = require('crypto');
var stream = require('stream');

/* ---- MIME constants ---- */
var IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
var VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
var ALL_MIMES   = IMAGE_MIMES.concat(VIDEO_MIMES);

/* ---- Size limits ---- */
var IMAGE_MAX_BYTES = 5  * 1024 * 1024; /* 5MB  */
var VIDEO_MAX_BYTES = 50 * 1024 * 1024; /* 50MB */

/* ---- Magic bytes validation ---- */
function validateMagicBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 12) return false;

  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

    case 'image/png':
      return buffer[0] === 0x89 && buffer[1] === 0x50 &&
             buffer[2] === 0x4E && buffer[3] === 0x47;

    case 'image/webp':
      /* RIFF header + WEBP marker */
      return buffer[0]  === 0x52 && buffer[1]  === 0x49 &&
             buffer[2]  === 0x46 && buffer[3]  === 0x46 &&
             buffer[8]  === 0x57 && buffer[9]  === 0x45 &&
             buffer[10] === 0x42 && buffer[11] === 0x50;

    case 'image/gif':
      return buffer[0] === 0x47 && buffer[1] === 0x49 &&
             buffer[2] === 0x46 && buffer[3] === 0x38;

    case 'video/webm':
      /* WebM/Matroska: 1A 45 DF A3 */
      return buffer[0] === 0x1A && buffer[1] === 0x45 &&
             buffer[2] === 0xDF && buffer[3] === 0xA3;

    case 'video/mp4':
    case 'video/quicktime':
      /* ISO base media: 'ftyp' or other known top-level box at bytes 4–7 */
      if (buffer.length < 8) return false;
      var boxType = buffer.slice(4, 8).toString('ascii');
      return ['ftyp', 'moov', 'mdat', 'wide', 'skip', 'free', 'pnot', 'jP  '].indexOf(boxType) !== -1;

    default:
      return false;
  }
}

/* ---- Provider detection ---- */
function getProvider() {
  return (process.env.CLOUDINARY_CLOUD_NAME &&
          process.env.CLOUDINARY_API_KEY    &&
          process.env.CLOUDINARY_API_SECRET)
    ? 'cloudinary' : 'local';
}

/* ---- Cloudinary upload via stream (avoids base64 bloat for video) ---- */
async function uploadToCloudinary(buffer, schoolId) {
  var cloudinary = require('cloudinary').v2;
  var folder     = 'schools/' + schoolId.toString() + '/community';

  var result = await new Promise(function(resolve, reject) {
    var uploadStream = cloudinary.uploader.upload_stream(
      { folder: folder, resource_type: 'auto' },
      function(err, res) { if (err) reject(err); else resolve(res); }
    );
    var readable = new stream.Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });

  /* Derive video thumbnail URL from Cloudinary's video transformation */
  var thumbnailUrl = result.secure_url;
  if (result.resource_type === 'video') {
    thumbnailUrl = result.secure_url
      .replace('/upload/', '/upload/w_640,h_360,c_fill,so_2/')
      .replace(/\.(mp4|webm|mov|avi|mkv)$/i, '.jpg');
  }

  return {
    storageRef:   result.public_id,
    url:          result.secure_url,
    thumbnailUrl: thumbnailUrl,
    filename:     result.public_id.split('/').pop() || result.public_id,
    width:        result.width  || null,
    height:       result.height || null
  };
}

/* ---- Local filesystem upload (development only) ---- */
async function uploadToLocal(buffer, originalName, schoolId, mimeType) {
  var isVideo = VIDEO_MIMES.includes(mimeType);
  var extMap  = {
    'image/jpeg':    '.jpg',
    'image/png':     '.png',
    'image/webp':    '.webp',
    'image/gif':     '.gif',
    'video/mp4':     '.mp4',
    'video/webm':    '.webm',
    'video/quicktime':'.mov'
  };
  var ext      = extMap[mimeType] || '.bin';
  var hash     = crypto.randomBytes(16).toString('hex');
  var filename = hash + ext;
  var dir      = path.join(
    __dirname, '../../../public/uploads/schools',
    schoolId.toString(), 'community'
  );

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);

  var url = '/uploads/schools/' + schoolId.toString() + '/community/' + filename;

  return {
    storageRef:   path.join(dir, filename),
    url:          url,
    thumbnailUrl: isVideo ? null : url,
    filename:     filename,
    width:        null,
    height:       null
  };
}

/* ============================================
   uploadCommunityMedia
   Main upload entry point.
   Called by POST /api/community/media/upload.

   file:    multer file object (req.file)
   options: { schoolId, memberId, memberType, memberRef }
============================================ */
async function uploadCommunityMedia(file, options) {
  var mimeType = (file.mimetype || '').toLowerCase().split(';')[0].trim();
  var buffer   = file.buffer;
  var isVideo  = VIDEO_MIMES.includes(mimeType);

  /* MIME allowlist */
  if (!ALL_MIMES.includes(mimeType)) {
    throw new Error(
      'File type not allowed. Accepted types: JPEG, PNG, WebP, GIF, MP4, WebM, MOV.'
    );
  }

  /* Size limit */
  var maxBytes = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (buffer.length > maxBytes) {
    throw new Error(
      isVideo
        ? 'Video exceeds the 50MB maximum size.'
        : 'Image exceeds the 5MB maximum size.'
    );
  }

  /* Magic bytes */
  if (!validateMagicBytes(buffer, mimeType)) {
    throw new Error(
      'File content does not match its declared type. ' +
      'Please upload a genuine image or video file.'
    );
  }

  /* Upload to storage */
  var provider = getProvider();
  var uploaded;

  if (provider === 'cloudinary') {
    uploaded = await uploadToCloudinary(buffer, options.schoolId);
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Cloudinary is required in production. ' +
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
      );
    }
    uploaded = await uploadToLocal(
      buffer,
      file.originalname || 'upload',
      options.schoolId,
      mimeType
    );
  }

  /* Create SchoolWebsiteMedia record — reusing existing model */
  var SchoolWebsiteMedia = require('../../institution/models/SchoolWebsiteMedia.model');
  var media = await SchoolWebsiteMedia.create({
    schoolId:        options.schoolId,
    originalName:    file.originalname || 'community-upload',
    filename:        uploaded.filename,
    mimeType:        mimeType,
    fileSize:        buffer.length,
    width:           uploaded.width,
    height:          uploaded.height,
    storageProvider: provider === 'cloudinary' ? 'cloudinary' : 'local',
    storageRef:      uploaded.storageRef,
    url:             uploaded.url,
    thumbnailUrl:    uploaded.thumbnailUrl || null,
    usageContext:    'community_post',
    isPublic:        false,
    uploadedBy:      options.memberRef,
    isActive:        true
  });

  return {
    mediaId:      media._id,
    url:          media.url,
    thumbnailUrl: media.thumbnailUrl || media.url,
    mimeType:     media.mimeType,
    fileSize:     media.fileSize,
    isVideo:      isVideo,
    filename:     media.filename
  };
}

/* ============================================
   deleteCommunityMedia
   Hard-deletes from storage and DB.
   Verifies ownership (uploadedBy === memberRef).
   IDOR: schoolId + usageContext always checked.
============================================ */
async function deleteCommunityMedia(mediaId, schoolId, memberRef) {
  var SchoolWebsiteMedia = require('../../institution/models/SchoolWebsiteMedia.model');

  var media = await SchoolWebsiteMedia.findOne({
    _id:         mediaId,
    schoolId:    schoolId,          /* TENANT SCOPE */
    usageContext:'community_post'
  });
  if (!media) throw new Error('Media not found.');

  /* Ownership check */
  if (!media.uploadedBy || media.uploadedBy.toString() !== memberRef.toString()) {
    throw new Error('You can only delete your own uploaded media.');
  }

  /* Delete from provider */
  var provider = getProvider();
  if (provider === 'cloudinary' && media.storageRef) {
    try {
      var cloudinary = require('cloudinary').v2;
      var isVideo    = VIDEO_MIMES.includes(media.mimeType);
      await cloudinary.uploader.destroy(media.storageRef, {
        resource_type: isVideo ? 'video' : 'image'
      });
    } catch(e) {
      console.warn('[community-media] Cloudinary delete warn:', e.message);
    }
  } else if (provider === 'local' && media.storageRef) {
    try {
      if (fs.existsSync(media.storageRef)) fs.unlinkSync(media.storageRef);
    } catch(e) {
      console.warn('[community-media] Local delete warn:', e.message);
    }
  }

  await SchoolWebsiteMedia.findByIdAndDelete(media._id);
  return true;
}

/* ============================================
   getCommunityMedia
   Returns media uploaded by the current member.
   Tenant-scoped. Paginated.
============================================ */
async function getCommunityMedia(schoolId, memberRef, page, limit) {
  var SchoolWebsiteMedia = require('../../institution/models/SchoolWebsiteMedia.model');
  var pg   = Math.max(1, page  || 1);
  var lim  = Math.min(30, limit || 20);
  var skip = (pg - 1) * lim;

  var filter = {
    schoolId:    schoolId,     /* TENANT SCOPE */
    usageContext:'community_post',
    uploadedBy:  memberRef,
    isActive:    { $ne: false }
  };

  var [media, total] = await Promise.all([
    SchoolWebsiteMedia.find(filter)
      .select('_id url thumbnailUrl mimeType fileSize originalName createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .lean(),
    SchoolWebsiteMedia.countDocuments(filter)
  ]);

  return { media, total, page: pg, hasMore: skip + media.length < total };
}

module.exports = {
  uploadCommunityMedia,
  deleteCommunityMedia,
  getCommunityMedia,
  IMAGE_MIMES,
  VIDEO_MIMES,
  ALL_MIMES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES
};