'use strict';
/* ============================================
   LATLOMP — INSTITUTION WEBSITE MANAGEMENT (E8A)
   
   All routes authenticated via instProtect.
   schoolId ALWAYS from req.schoolId (JWT).
   NEVER from request body.
   
   RBAC:
   readGuard   — view website settings
   editGuard   — edit content, upload media, manage posts
   publishGuard— publish/unpublish (school admin only)
============================================ */
'use strict';

var express           = require('express');
var router            = express.Router();
var mongoose          = require('mongoose');
var multer            = require('multer');
var SchoolWebsite     = require('../models/SchoolWebsite.model');
var SchoolWebsitePage = require('../models/SchoolWebsitePage.model');
var SchoolWebsitePost = require('../models/SchoolWebsitePost.model');
var SchoolWebsiteMedia= require('../models/SchoolWebsiteMedia.model');
var SchoolEvent       = require('../models/SchoolEvent.model');
var mediaService      = require('../services/website.media.service');
var {
  instProtect, schoolAdminOnly,
  seniorStaffOrAdmin, canManageStudents, teacherOrAdmin
} = require('../middleware/inst.auth');
var { requireActiveSubscription } = require('../middleware/inst.tenant');

var readGuard    = [instProtect, teacherOrAdmin,     requireActiveSubscription];
var editGuard    = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var mediaGuard   = [instProtect, canManageStudents,  requireActiveSubscription];
var publishGuard = [instProtect, schoolAdminOnly,    requireActiveSubscription];

/* ---- Multer: memory storage, 5MB limit ---- */
var upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: mediaService.MAX_FILE_SIZE },
  fileFilter: function(req, file, cb) {
    if (mediaService.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Upload JPEG, PNG, WebP or GIF images only.'));
    }
  }
});

/* ---- Helper: sanitize plain text (strip any HTML tags) ---- */
function sanitizeText(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

/* ---- Helper: ensure website doc exists for school ---- */
async function ensureWebsite(schoolId) {
  var website = await SchoolWebsite.findOne({ schoolId });
  if (!website) {
    website = new SchoolWebsite({
      schoolId,
      draftConfig: {
        homepageSections: [
          { type: 'hero',              enabled: true, order: 1, config: {} },
          { type: 'about',             enabled: true, order: 2, config: {} },
          { type: 'principal_message', enabled: true, order: 3, config: {} },
          { type: 'news',              enabled: true, order: 4, config: {} },
          { type: 'events',            enabled: true, order: 5, config: {} },
          { type: 'contact',           enabled: true, order: 6, config: {} }
        ],
        enabledModules: ['home', 'about', 'news', 'events', 'contact']
      }
    });
    await website.save();
  }
  return website;
}

/* ============================================
   GET /api/institution/website/
   Get website status + draft config for builder.
============================================ */
router.get('/', readGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);

    /* Load school base data to populate builder with existing info */
    var School  = require('../models/School.model');
    var school  = await School.findById(req.schoolId)
      .select('name logo primaryColor secondaryColor address phone motto principalName slug')
      .lean();

    return res.json({
      success: true,
      status:  website.status,
      publishedAt:      website.publishedAt,
      publishedByName:  website.publishedByName,
      lastEditedAt:     website.lastEditedAt,
      lastEditedByName: website.lastEditedByName,
      draftConfig:      website.draftConfig,
      school
    });
  } catch(err) {
    console.error('[website] GET /:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/website/settings
   Update draftConfig: identity, contact, social.
   Sanitizes all text — no raw HTML accepted.
============================================ */
router.put('/settings', editGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);
    var allowed = [
      'tagline', 'description', 'about', 'history',
      'mission', 'vision', 'values', 'foundedYear',
      'publicEmail', 'publicPhone', 'mapEmbedUrl', 'socialLinks',
      'principalMessage', 'admissions'
    ];

    allowed.forEach(function(field) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] === 'string') {
          website.draftConfig[field] = sanitizeText(req.body[field]);
        } else {
          /* Nested objects (socialLinks, admissions, principalMessage) */
          website.draftConfig[field] = req.body[field];
          /* Sanitize nested text fields */
          if (field === 'principalMessage' && req.body[field]) {
            website.draftConfig[field].text  = sanitizeText(req.body[field].text  || '');
            website.draftConfig[field].name  = sanitizeText(req.body[field].name  || '');
            website.draftConfig[field].title = sanitizeText(req.body[field].title || '');
          }
          if (field === 'admissions' && req.body[field]) {
            website.draftConfig[field].requirements = sanitizeText(req.body[field].requirements || '');
            website.draftConfig[field].howToApply   = sanitizeText(req.body[field].howToApply   || '');
          }
        }
      }
    });

    website.lastEditedAt     = new Date();
    website.lastEditedBy     = req.schoolUser._id;
    website.lastEditedByName = req.schoolUser.name || '';
    website.markModified('draftConfig');
    await website.save();

    return res.json({ success: true, message: 'Settings saved.', draftConfig: website.draftConfig });
  } catch(err) {
    console.error('[website] PUT /settings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/website/design
   Update draftConfig: theme, colors, fonts.
============================================ */
router.put('/design', editGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);
    var allowed = ['theme', 'primaryColor', 'secondaryColor', 'accentColor',
                   'fontTheme', 'navStyle', 'footerStyle', 'logoUrl', 'faviconUrl', 'logoMediaId'];
    var validThemes    = ['modern', 'classic', 'bold'];
    var validFonts     = ['inter', 'poppins', 'merriweather'];
    var validNavStyles = ['light', 'dark', 'transparent'];

    if (req.body.theme && !validThemes.includes(req.body.theme)) {
      return res.status(400).json({ success: false, message: 'Invalid theme.' });
    }
    if (req.body.fontTheme && !validFonts.includes(req.body.fontTheme)) {
      return res.status(400).json({ success: false, message: 'Invalid font theme.' });
    }
    if (req.body.navStyle && !validNavStyles.includes(req.body.navStyle)) {
      return res.status(400).json({ success: false, message: 'Invalid nav style.' });
    }

    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) { website.draftConfig[f] = req.body[f]; }
    });

    website.lastEditedAt     = new Date();
    website.lastEditedBy     = req.schoolUser._id;
    website.lastEditedByName = req.schoolUser.name || '';
    website.markModified('draftConfig');
    await website.save();

    return res.json({ success: true, message: 'Design saved.', draftConfig: website.draftConfig });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/website/homepage
   Update homepage section ordering and config.
============================================ */
router.put('/homepage', editGuard, async function(req, res) {
  try {
    var { sections } = req.body;
    if (!Array.isArray(sections)) {
      return res.status(400).json({ success: false, message: 'sections must be an array.' });
    }

    var validTypes = [
      'hero', 'about', 'principal_message', 'stats', 'news', 'events',
      'contact', 'cta', 'programmes', 'departments', 'facilities', 'admissions'
    ];

    var sanitized = sections.filter(function(s) {
      return validTypes.includes(s.type);
    }).map(function(s, i) {
      return {
        type:    s.type,
        enabled: !!s.enabled,
        order:   typeof s.order === 'number' ? s.order : i,
        config: {
          headline:       sanitizeText(s.config && s.config.headline),
          subtext:        sanitizeText(s.config && s.config.subtext),
          heroImageUrl:   s.config && s.config.heroImageUrl   ? s.config.heroImageUrl   : '',
          overlayOpacity: s.config && typeof s.config.overlayOpacity === 'number'
            ? Math.min(1, Math.max(0, s.config.overlayOpacity)) : 0.5,
          buttonText:     sanitizeText(s.config && s.config.buttonText),
          buttonUrl:      s.config && s.config.buttonUrl ? s.config.buttonUrl : '',
          ctaText:        sanitizeText(s.config && s.config.ctaText),
          ctaButtonText:  sanitizeText(s.config && s.config.ctaButtonText),
          ctaButtonUrl:   s.config && s.config.ctaButtonUrl ? s.config.ctaButtonUrl : '',
          stats:          Array.isArray(s.config && s.config.stats)
            ? s.config.stats.slice(0, 8).map(function(st) {
                return { label: sanitizeText(st.label), value: sanitizeText(st.value) };
              })
            : []
        }
      };
    });

    var website = await ensureWebsite(req.schoolId);
    website.draftConfig.homepageSections = sanitized;
    website.lastEditedAt     = new Date();
    website.lastEditedBy     = req.schoolUser._id;
    website.lastEditedByName = req.schoolUser.name || '';
    website.markModified('draftConfig');
    await website.save();

    return res.json({ success: true, message: 'Homepage sections saved.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/website/navigation
   Update enabled modules and nav order.
============================================ */
router.put('/navigation', editGuard, async function(req, res) {
  try {
    var validModules = [
      'home', 'about', 'news', 'events', 'gallery', 'staff',
      'departments', 'programmes', 'facilities', 'admissions',
      'contact', 'alumni', 'student_portal', 'parent_portal'
    ];
    var website = await ensureWebsite(req.schoolId);

    if (req.body.enabledModules) {
      website.draftConfig.enabledModules = (req.body.enabledModules || [])
        .filter(function(m) { return validModules.includes(m); });
    }
    if (req.body.navOrder) {
      website.draftConfig.navOrder = (req.body.navOrder || [])
        .filter(function(m) { return validModules.includes(m); });
    }
    if (req.body.customNavLabels) {
      /* Only allow string labels — sanitized */
      var labels = req.body.customNavLabels;
      var cleanLabels = {};
      Object.keys(labels).forEach(function(k) {
        if (validModules.includes(k) && typeof labels[k] === 'string') {
          cleanLabels[k] = sanitizeText(labels[k]).substring(0, 30);
        }
      });
      website.draftConfig.customNavLabels = cleanLabels;
    }

    website.lastEditedAt     = new Date();
    website.lastEditedBy     = req.schoolUser._id;
    website.lastEditedByName = req.schoolUser.name || '';
    website.markModified('draftConfig');
    await website.save();

    return res.json({ success: true, message: 'Navigation saved.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PUT /api/institution/website/seo
   Update SEO metadata in draftConfig.
============================================ */
router.put('/seo', editGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);
    var { metaTitle, metaDescription, ogImageUrl, keywords } = req.body;

    website.draftConfig.seo = {
      metaTitle:       sanitizeText(metaTitle       || ''),
      metaDescription: sanitizeText(metaDescription || ''),
      ogImageUrl:      ogImageUrl || '',
      keywords:        Array.isArray(keywords)
        ? keywords.slice(0, 20).map(function(k) { return sanitizeText(k).substring(0, 50); })
        : []
    };

    website.lastEditedAt     = new Date();
    website.lastEditedBy     = req.schoolUser._id;
    website.lastEditedByName = req.schoolUser.name || '';
    website.markModified('draftConfig');
    await website.save();

    return res.json({ success: true, message: 'SEO settings saved.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/website/preview
   Returns full draft data for authenticated preview.
   NEVER accessible without valid instProtect JWT.
   Public /school/:slug route has zero awareness of drafts.
============================================ */
router.get('/preview', editGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);
    var School  = require('../models/School.model');
    var school  = await School.findById(req.schoolId)
      .select('name logo primaryColor secondaryColor address phone motto principalName slug')
      .lean();

    /* Load recent draft/published posts for preview */
    var posts = await SchoolWebsitePost.find({
      schoolId: req.schoolId,
      status:   { $in: ['published', 'draft'] }
    }).sort({ publishedAt: -1 }).limit(3).lean();

    /* Load upcoming public events for preview */
    var events = await SchoolEvent.find({
      schoolId:     req.schoolId,
      showOnWebsite:true,
      status:       { $in: ['published', 'draft'] },
      date:         { $gte: new Date() }
    }).sort({ date: 1 }).limit(3).lean();

    return res.json({
      success:     true,
      school,
      draftConfig: website.draftConfig,
      preview: {
        posts,
        events
      }
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/website/publish
   Atomically copies draftConfig → publishedConfig.
   schoolAdminOnly — most privileged action.
============================================ */
router.post('/publish', publishGuard, async function(req, res) {
  try {
    var website = await ensureWebsite(req.schoolId);

    /* Validate minimum required fields */
    var School = require('../models/School.model');
    var school = await School.findById(req.schoolId).select('name slug').lean();

    if (!school.slug) {
      return res.status(400).json({
        success: false,
        message: 'Your school must have a slug/URL before publishing. Configure it in School Settings.'
      });
    }

    /* Atomic publish: copy draft → published */
    var now = new Date();
    await SchoolWebsite.findByIdAndUpdate(website._id, {
      $set: {
        status:           'published',
        publishedAt:      now,
        publishedBy:      req.schoolUser._id,
        publishedByName:  req.schoolUser.name || '',
        lastEditedAt:     now,
        publishedConfig:  website.draftConfig
      }
    });

    var publicUrl = (process.env.APP_URL || 'https://latlompsystem.up.railway.app') +
                    '/school/' + school.slug;

    return res.json({
      success:   true,
      message:   'Website published successfully.',
      publicUrl,
      publishedAt: now
    });
  } catch(err) {
    console.error('[website] POST /publish:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   POST /api/institution/website/unpublish
   Takes website offline. Preserves all content.
============================================ */
router.post('/unpublish', publishGuard, async function(req, res) {
  try {
    await SchoolWebsite.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: {
          status:        'unpublished',
          unpublishedAt: new Date(),
          unpublishedBy: req.schoolUser._id
      }}
    );

    return res.json({ success: true, message: 'Website taken offline. Your content is preserved.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   PAGES
============================================ */

router.get('/pages', readGuard, async function(req, res) {
  try {
    var pages = await SchoolWebsitePage.find({ schoolId: req.schoolId })
      .sort({ displayOrder: 1 }).lean();
    return res.json({ success: true, pages, count: pages.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pages/:slug', readGuard, async function(req, res) {
  try {
    var page = await SchoolWebsitePage.findOne({
      schoolId: req.schoolId,
      slug:     req.params.slug
    }).lean();
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found.' });
    }
    return res.json({ success: true, page });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/pages/:slug', editGuard, async function(req, res) {
  try {
    var slug    = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    var content = sanitizeText(req.body.draftContent || '');
    var title   = sanitizeText(req.body.title || '');
    var update  = {
      draftContent:  content,
      title:         title || undefined,
      metaTitle:     sanitizeText(req.body.metaTitle || ''),
      metaDesc:      sanitizeText(req.body.metaDesc  || ''),
      showInNav:     req.body.showInNav !== undefined ? !!req.body.showInNav : undefined,
      isEnabled:     req.body.isEnabled !== undefined ? !!req.body.isEnabled : undefined,
      lastEditedBy:  req.schoolUser._id,
      lastEditedByName: req.schoolUser.name || '',
      lastEditedAt:  new Date()
    };

    /* Remove undefined keys */
    Object.keys(update).forEach(function(k) {
      if (update[k] === undefined) delete update[k];
    });

    var page = await SchoolWebsitePage.findOneAndUpdate(
      { schoolId: req.schoolId, slug },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (page.isNew || !page.createdBy) {
      page.slug      = slug;
      page.pageType  = req.body.pageType || 'built_in';
      page.createdBy = req.schoolUser._id;
      page.createdByName = req.schoolUser.name || '';
      await page.save();
    }

    return res.json({ success: true, message: 'Page saved.', page });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pages/:slug/publish', editGuard, async function(req, res) {
  try {
    var page = await SchoolWebsitePage.findOne({
      schoolId: req.schoolId, slug: req.params.slug
    });
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found.' });
    }

    page.publishedContent = page.draftContent;
    page.status           = 'published';
    page.publishedAt      = new Date();
    page.publishedBy      = req.schoolUser._id;
    page.publishedByName  = req.schoolUser.name || '';
    await page.save();

    return res.json({ success: true, message: 'Page published.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   NEWS POSTS (SchoolWebsitePost)
============================================ */

router.get('/news', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId };
    if (req.query.status) filter.status = req.query.status;

    var posts = await SchoolWebsitePost.find(filter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean();

    return res.json({ success: true, posts, count: posts.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/news', editGuard, async function(req, res) {
  try {
    var { title, excerpt, content, featuredImageUrl, featuredMediaId,
          authorDisplayName, category, tags, publishNow, isFeatured } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    /* Generate slug from title */
    var baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    /* Check uniqueness */
    var existing = await SchoolWebsitePost.findOne({ schoolId: req.schoolId, slug: baseSlug });
    var slug     = existing ? baseSlug + '-' + Date.now() : baseSlug;

    var post = await SchoolWebsitePost.create({
      schoolId:          req.schoolId,
      title:             sanitizeText(title),
      slug,
      excerpt:           sanitizeText(excerpt || '').substring(0, 500),
      content:           sanitizeText(content || ''),
      featuredImageUrl:  featuredImageUrl || '',
      featuredMediaId:   featuredMediaId  || null,
      authorDisplayName: sanitizeText(authorDisplayName || ''),
      status:            publishNow ? 'published' : 'draft',
      publishedAt:       publishNow ? new Date() : null,
      isFeatured:        !!isFeatured,
      category:          sanitizeText(category || 'general'),
      tags:              Array.isArray(tags)
        ? tags.slice(0, 10).map(function(t) { return sanitizeText(t).substring(0, 30); })
        : [],
      createdBy:         req.schoolUser._id,
      createdByName:     req.schoolUser.name || ''
    });

    return res.status(201).json({ success: true, message: 'Post created.', post });
  } catch(err) {
    console.error('[website] POST /news:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/news/:id', readGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await SchoolWebsitePost.findOne({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    }).lean();
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    return res.json({ success: true, post });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/news/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await SchoolWebsitePost.findOne({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    var allowed = ['title','excerpt','content','featuredImageUrl','featuredMediaId',
                   'authorDisplayName','category','tags','isFeatured'];
    allowed.forEach(function(f) {
      if (req.body[f] !== undefined) {
        if (typeof req.body[f] === 'string') {
          post[f] = sanitizeText(req.body[f]);
        } else {
          post[f] = req.body[f];
        }
      }
    });

    if (req.body.status === 'published' && post.status !== 'published') {
      post.status      = 'published';
      post.publishedAt = new Date();
    } else if (req.body.status) {
      post.status = req.body.status;
    }

    post.updatedBy     = req.schoolUser._id;
    post.updatedByName = req.schoolUser.name || '';
    await post.save();

    return res.json({ success: true, message: 'Post updated.', post });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/news/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }
    var post = await SchoolWebsitePost.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId }, /* TENANT SCOPE */
      { $set: { status: 'archived', updatedBy: req.schoolUser._id } },
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    return res.json({ success: true, message: 'Post archived.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   EVENTS — Toggle showOnWebsite on existing SchoolEvents
============================================ */
router.get('/events', readGuard, async function(req, res) {
  try {
    var events = await SchoolEvent.find({
      schoolId: req.schoolId,
      status:   { $in: ['published', 'draft'] }
    }).select('title date status showOnWebsite websiteFeatured websiteDisplayOrder eventType')
      .sort({ date: 1 }).lean();

    return res.json({ success: true, events, count: events.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/events/:eventId/website', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.eventId)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    }
    var update = {};
    if (req.body.showOnWebsite !== undefined) {
      update.showOnWebsite = !!req.body.showOnWebsite;
    }
    if (req.body.websiteFeatured !== undefined) {
      update.websiteFeatured = !!req.body.websiteFeatured;
    }
    if (typeof req.body.websiteDisplayOrder === 'number') {
      update.websiteDisplayOrder = req.body.websiteDisplayOrder;
    }

    var event = await SchoolEvent.findOneAndUpdate(
      { _id: req.params.eventId, schoolId: req.schoolId }, /* TENANT SCOPE */
      { $set: update },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    return res.json({
      success: true,
      message: 'Event website settings updated.',
      showOnWebsite: event.showOnWebsite
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   MEDIA LIBRARY
============================================ */

router.get('/media', readGuard, async function(req, res) {
  try {
    var filter = { schoolId: req.schoolId, isActive: true }; /* TENANT SCOPE */
    if (req.query.context) filter.usageContext = req.query.context;

    var media = await SchoolWebsiteMedia.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, media, count: media.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/media/upload', mediaGuard, upload.single('file'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    var usageContext = req.body.usageContext || 'general';
    var validContexts = ['logo','favicon','gallery','news','staff','hero','general','event'];
    if (!validContexts.includes(usageContext)) {
      usageContext = 'general';
    }

    /* Validate + upload via service */
    var uploadData = await mediaService.uploadMedia(
      req.file,
      req.schoolId,   /* schoolId from JWT — never from body */
      usageContext,
      req.schoolUser
    );

    /* Create media record */
    var media = await SchoolWebsiteMedia.create({
      schoolId:        req.schoolId,
      originalName:    req.file.originalname,
      filename:        uploadData.filename,
      mimeType:        uploadData.mimeType,
      fileSize:        uploadData.fileSize,
      width:           uploadData.width,
      height:          uploadData.height,
      storageProvider: uploadData.storageProvider,
      storageRef:      uploadData.storageRef,
      url:             uploadData.url,
      secureUrl:       uploadData.secureUrl,
      thumbnailUrl:    uploadData.thumbnailUrl,
      altText:         req.body.altText || '',
      caption:         req.body.caption || '',
      usageContext,
      uploadedBy:      req.schoolUser._id,
      uploadedByName:  req.schoolUser.name || ''
    });

    return res.status(201).json({
      success: true,
      message: 'File uploaded successfully.',
      media: {
        _id:          media._id,
        url:          media.url,
        thumbnailUrl: media.thumbnailUrl,
        usageContext: media.usageContext,
        mimeType:     media.mimeType,
        fileSize:     media.fileSize
      }
    });
  } catch(err) {
    console.error('[website] POST /media/upload:', err.message);
    var statusCode = err.message.includes('not configured') ? 503
                   : err.message.includes('not allowed')    ? 400
                   : err.message.includes('exceeds')        ? 413
                   : err.message.includes('content does not match') ? 400
                   : 500;
    return res.status(statusCode).json({ success: false, message: err.message });
  }
});

router.delete('/media/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid media ID.' });
    }
    var media = await SchoolWebsiteMedia.findOne({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!media) {
      return res.status(404).json({ success: false, message: 'Media not found.' });
    }

    /* Soft delete — do not delete from storage if still referenced */
    media.isActive  = false;
    media.deletedAt = new Date();
    media.deletedBy = req.schoolUser._id;
    await media.save();

    return res.json({ success: true, message: 'Media removed from library.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   DOMAIN (skeleton in E8A)
============================================ */
router.get('/domain', readGuard, async function(req, res) {
  try {
    var School = require('../models/School.model');
    var school = await School.findById(req.schoolId).select('slug').lean();
    var appUrl = process.env.APP_URL || 'https://latlompsystem.up.railway.app';

    return res.json({
      success:      true,
      slug:         school.slug || '',
      platformUrl:  school.slug ? appUrl + '/school/' + school.slug : null,
      customDomain: null,   /* E8G */
      status:       'slug_only'
    });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;