'use strict';
/* ============================================
   LATLOMP — WEBSITE MEDIA SERVICE (E8A)
   
   Provider-abstracted file storage.
   Cloudinary: production default.
   Local: development fallback ONLY.
   
   Security:
   - Extension + MIME type + magic bytes validated
   - Executable files rejected
   - Max 5MB per upload
   - schoolId from JWT only (never request body)
   - School A cannot access School B media
   
   Production rule: if CLOUDINARY_* not configured,
   fail loudly — never silently use ephemeral storage.
============================================ */
'use strict';

var path  = require('path');
var fs    = require('fs');
var crypto= require('crypto');

var ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif'
  /* SVG excluded — can contain embedded scripts */
];

var MAX_FILE_SIZE = 5 * 1024 * 1024; /* 5MB */

/* ============================================
   validateFileType(buffer, mimetype)
   Validates against magic bytes signature.
   Extension and mimetype alone are insufficient.
============================================ */
function validateFileType(buffer, mimetype) {
  if (!buffer || buffer.length < 12) {
    return { valid: false, reason: 'File appears to be empty or corrupt.' };
  }

  var normalised = (mimetype || '').toLowerCase().split(';')[0].trim();

  if (!ALLOWED_MIME_TYPES.includes(normalised)) {
    return {
      valid:  false,
      reason: 'File type not permitted. Allowed types: JPEG, PNG, WebP, GIF.'
    };
  }

  /* JPEG: FF D8 FF */
  if (normalised === 'image/jpeg' || normalised === 'image/jpg') {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { valid: true, mimeType: 'image/jpeg' };
    }
    return { valid: false, reason: 'File content does not match JPEG format.' };
  }

  /* PNG: 89 50 4E 47 0D 0A 1A 0A */
  if (normalised === 'image/png') {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { valid: true, mimeType: 'image/png' };
    }
    return { valid: false, reason: 'File content does not match PNG format.' };
  }

  /* GIF: 47 49 46 38 */
  if (normalised === 'image/gif') {
    if (buffer[0] === 0x47 && buffer[1] === 0x49 &&
        buffer[2] === 0x46 && buffer[3] === 0x38) {
      return { valid: true, mimeType: 'image/gif' };
    }
    return { valid: false, reason: 'File content does not match GIF format.' };
  }

  /* WebP: RIFF....WEBP */
  if (normalised === 'image/webp') {
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 &&  /* RIFF */
        buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 &&  /* WEBP */
        buffer[10] === 0x42 && buffer[11] === 0x50) {
      return { valid: true, mimeType: 'image/webp' };
    }
    return { valid: false, reason: 'File content does not match WebP format.' };
  }

  return { valid: false, reason: 'Unrecognised file type.' };
}

/* ============================================
   getStorageProvider()
   Determines which storage provider to use.
   Fails loudly in production if Cloudinary
   is not configured — never silently uses
   ephemeral filesystem.
============================================ */
function getStorageProvider() {
  var cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  var apiKey    = process.env.CLOUDINARY_API_KEY;
  var apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    return 'cloudinary';
  }

  var isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error(
      'Media storage is not configured. Set CLOUDINARY_CLOUD_NAME, ' +
      'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET environment variables. ' +
      'Files stored on the local filesystem in production are lost on redeploy.'
    );
  }

  /* Development only: local filesystem fallback */
  return 'local';
}

/* ============================================
   uploadToCloudinary(buffer, options)
   Streams buffer to Cloudinary.
   Returns: { url, secureUrl, publicId, width, height }
============================================ */
async function uploadToCloudinary(buffer, options) {
  var cloudinary;
  try {
    cloudinary = require('cloudinary').v2;
  } catch(e) {
    throw new Error('cloudinary package not installed. Run: npm install cloudinary');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  return new Promise(function(resolve, reject) {
    var folder = 'latlomp/schools/' + options.schoolId + '/' + (options.usageContext || 'general');

    var uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:           folder,
        resource_type:    'image',
        allowed_formats:  ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation:   [{ quality: 'auto', fetch_format: 'auto' }],
        eager: [{
          width: 400, height: 300, crop: 'fill', quality: 'auto'
        }]
      },
      function(error, result) {
        if (error) {
          return reject(new Error('Cloudinary upload failed: ' + error.message));
        }
        resolve({
          url:          result.secure_url,
          secureUrl:    result.secure_url,
          thumbnailUrl: result.eager && result.eager[0]
            ? result.eager[0].secure_url
            : result.secure_url,
          publicId:     result.public_id,
          width:        result.width  || null,
          height:       result.height || null
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/* ============================================
   uploadToLocal(buffer, options)
   Development-only local filesystem storage.
   Files stored at: public/uploads/schools/:schoolId/
   Returns: { url, publicId, width, height }
============================================ */
async function uploadToLocal(buffer, options) {
  var uploadDir = path.join(
    __dirname, '..', '..', '..', 'public', 'uploads', 'schools',
    options.schoolId.toString()
  );

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  var ext      = options.mimeType === 'image/png'  ? '.png'
               : options.mimeType === 'image/webp' ? '.webp'
               : options.mimeType === 'image/gif'  ? '.gif'
               : '.jpg';

  var filename = crypto.randomBytes(16).toString('hex') + ext;
  var filepath = path.join(uploadDir, filename);

  fs.writeFileSync(filepath, buffer);

  var publicPath = '/uploads/schools/' + options.schoolId.toString() + '/' + filename;

  return {
    url:          publicPath,
    secureUrl:    publicPath,
    thumbnailUrl: publicPath,
    publicId:     publicPath,
    width:        null,
    height:       null
  };
}

/* ============================================
   deleteFromStorage(storageRef, provider)
============================================ */
async function deleteFromStorage(storageRef, provider) {
  if (provider === 'cloudinary') {
    try {
      var cloudinary = require('cloudinary').v2;
      await cloudinary.uploader.destroy(storageRef);
    } catch(e) {
      console.warn('[WebsiteMedia] Cloudinary delete warning:', e.message);
    }
  } else if (provider === 'local') {
    try {
      var localPath = path.join(__dirname, '..', '..', '..', 'public', storageRef);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch(e) {
      console.warn('[WebsiteMedia] Local file delete warning:', e.message);
    }
  }
}

/* ============================================
   uploadMedia(file, schoolId, usageContext, uploader)
   
   Main upload function called by route handler.
   file: multer file object { buffer, mimetype, originalname, size }
   schoolId: from JWT (never from request body)
   Returns: SchoolWebsiteMedia document data
============================================ */
async function uploadMedia(file, schoolId, usageContext, uploader) {
  /* 1. Size check */
  if (!file || !file.buffer) {
    throw new Error('No file data received.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File exceeds the maximum allowed size of 5MB.');
  }

  /* 2. Magic bytes validation */
  var typeCheck = validateFileType(file.buffer, file.mimetype);
  if (!typeCheck.valid) {
    throw new Error(typeCheck.reason);
  }

  /* 3. Determine storage provider */
  var provider = getStorageProvider();

  /* 4. Upload */
  var uploadResult;
  if (provider === 'cloudinary') {
    uploadResult = await uploadToCloudinary(file.buffer, {
      schoolId:     schoolId.toString(),
      usageContext: usageContext || 'general',
      mimeType:     typeCheck.mimeType
    });
  } else {
    uploadResult = await uploadToLocal(file.buffer, {
      schoolId:     schoolId,
      usageContext: usageContext || 'general',
      mimeType:     typeCheck.mimeType
    });
  }

  /* 5. Return record data (caller creates DB document) */
  return {
    storageProvider: provider,
    storageRef:      uploadResult.publicId,
    url:             uploadResult.url,
    secureUrl:       uploadResult.secureUrl,
    thumbnailUrl:    uploadResult.thumbnailUrl,
    width:           uploadResult.width,
    height:          uploadResult.height,
    mimeType:        typeCheck.mimeType,
    fileSize:        file.size,
    originalName:    file.originalname,
    filename:        path.basename(uploadResult.publicId)
  };
}

module.exports = {
  uploadMedia,
  deleteFromStorage,
  validateFileType,
  getStorageProvider,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES
};