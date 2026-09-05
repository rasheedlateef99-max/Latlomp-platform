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

/* ============================================
   E8B: STAFF PROFILES
   Staff identity: SchoolUser (authoritative).
   This section controls public website presentation only.
============================================ */

/* GET /api/institution/website/staff/selectable-users
   Returns school users available for website profiles.
   IMPORTANT: Must be registered before /staff/:staffUserId
   so Express matches /staff/selectable-users correctly.
*/
router.get('/staff/selectable-users', readGuard, async function(req, res) {
  try {
    var SchoolUser = require('../models/SchoolUser.model');
    var users = await SchoolUser.find({ schoolId: req.schoolId, isActive: true })
      .select('name email role avatar')
      .sort({ name: 1 })
      .lean();
    return res.json({ success: true, users, count: users.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/website/staff
   List all website staff profiles with staff user data.
*/
router.get('/staff', readGuard, async function(req, res) {
  try {
    var SchoolStaffProfile = require('../models/SchoolStaffProfile.model');
    var profiles = await SchoolStaffProfile.find({ schoolId: req.schoolId })
      .populate('staffUserId', 'name email role avatar')
      .sort({ displayOrder: 1 })
      .lean();
    return res.json({ success: true, profiles, count: profiles.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/website/staff/:staffUserId
   Create or update website profile for a staff member.
   staffUserId from URL — not from request body.
*/
router.put('/staff/:staffUserId', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.staffUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid staff user ID.' });
    }

    /* Verify staff member belongs to this school — TENANT SCOPE */
    var SchoolUser = require('../models/SchoolUser.model');
    var staffUser  = await SchoolUser.findOne({
      _id:      req.params.staffUserId,
      schoolId: req.schoolId
    }).select('_id name').lean();
    if (!staffUser) {
      return res.status(404).json({ success: false, message: 'Staff member not found in this institution.' });
    }

    var SchoolStaffProfile = require('../models/SchoolStaffProfile.model');
    var validCategories    = ['leadership', 'teaching', 'support'];

    var update = {
      publicTitle:    sanitizeText(req.body.publicTitle    || ''),
      publicBio:      sanitizeText(req.body.publicBio      || ''),
      publicPhotoUrl: req.body.publicPhotoUrl              || '',
      category:       validCategories.includes(req.body.category) ? req.body.category : 'teaching',
      displayOrder:   typeof req.body.displayOrder === 'number' ? req.body.displayOrder : 0,
      publicSubjects: Array.isArray(req.body.publicSubjects)
        ? req.body.publicSubjects.slice(0, 10).map(function(s) { return sanitizeText(s).substring(0, 50); })
        : [],
      updatedBy:     req.schoolUser._id,
      updatedByName: req.schoolUser.name || ''
    };

    if (req.body.showOnWebsite !== undefined) {
      update.showOnWebsite = !!req.body.showOnWebsite;
    }

    var profile = await SchoolStaffProfile.findOneAndUpdate(
      { staffUserId: req.params.staffUserId, schoolId: req.schoolId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, message: 'Staff profile updated.', profile });
  } catch(err) {
    console.error('[website] PUT /staff/:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/website/staff/:staffUserId/toggle
   Toggle showOnWebsite. Profile must exist first.
*/
router.put('/staff/:staffUserId/toggle', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.staffUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid staff user ID.' });
    }
    var SchoolStaffProfile = require('../models/SchoolStaffProfile.model');
    var profile = await SchoolStaffProfile.findOne({
      staffUserId: req.params.staffUserId,
      schoolId:    req.schoolId /* TENANT SCOPE */
    });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Staff profile not found. Click "Edit Profile" to create one first.'
      });
    }
    profile.showOnWebsite = !profile.showOnWebsite;
    profile.updatedBy     = req.schoolUser._id;
    profile.updatedByName = req.schoolUser.name || '';
    await profile.save();
    return res.json({ success: true, showOnWebsite: profile.showOnWebsite, message: 'Visibility updated.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E8B: DEPARTMENTS (website extension only)
   Academic department data managed in Structure routes.
   These routes touch ONLY the E8B website fields.
============================================ */

/* GET /api/institution/website/departments */
router.get('/departments', readGuard, async function(req, res) {
  try {
    var SchoolDepartment = require('../models/SchoolDepartment.model');
    var departments = await SchoolDepartment.find({ schoolId: req.schoolId })
      .select('name code faculty description websiteDescription websiteImageUrl showOnWebsite websiteDisplayOrder isActive')
      .sort({ websiteDisplayOrder: 1, name: 1 })
      .lean();
    return res.json({ success: true, departments, count: departments.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/website/departments/:id/website
   Updates ONLY website-specific fields.
   Never modifies name, code, faculty, hodId, isActive.
*/
router.put('/departments/:id/website', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid department ID.' });
    }
    var SchoolDepartment = require('../models/SchoolDepartment.model');
    var update = {};
    if (req.body.websiteDescription !== undefined) {
      update.websiteDescription = sanitizeText(req.body.websiteDescription || '');
    }
    if (req.body.websiteImageUrl !== undefined) {
      update.websiteImageUrl = req.body.websiteImageUrl || '';
    }
    if (req.body.showOnWebsite !== undefined) {
      update.showOnWebsite = !!req.body.showOnWebsite;
    }
    if (typeof req.body.websiteDisplayOrder === 'number') {
      update.websiteDisplayOrder = req.body.websiteDisplayOrder;
    }

    var dept = await SchoolDepartment.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId }, /* TENANT SCOPE */
      { $set: update },
      { new: true }
    );
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }
    return res.json({ success: true, message: 'Department website settings updated.', department: dept });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E8B: FACILITIES
============================================ */
var VALID_FACILITY_CATEGORIES = ['academic','sports','accommodation','dining','recreation','medical','transport','other'];

/* GET /api/institution/website/facilities */
router.get('/facilities', readGuard, async function(req, res) {
  try {
    var SchoolWebsiteFacility = require('../models/SchoolWebsiteFacility.model');
    var filter = { schoolId: req.schoolId }; /* TENANT SCOPE */
    if (req.query.published === 'true') filter.isPublished = true;
    var facilities = await SchoolWebsiteFacility.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 }).lean();
    return res.json({ success: true, facilities, count: facilities.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/website/facilities */
router.post('/facilities', editGuard, async function(req, res) {
  try {
    var SchoolWebsiteFacility = require('../models/SchoolWebsiteFacility.model');
    var { name, description, category, imageUrl, displayOrder, isPublished } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Facility name is required.' });
    }
    var facility = await SchoolWebsiteFacility.create({
      schoolId:      req.schoolId,
      name:          sanitizeText(name),
      description:   sanitizeText(description || ''),
      category:      VALID_FACILITY_CATEGORIES.includes(category) ? category : 'other',
      imageUrl:      imageUrl     || '',
      displayOrder:  typeof displayOrder === 'number' ? displayOrder : 0,
      isPublished:   !!isPublished,
      publishedAt:   isPublished ? new Date() : null,
      createdBy:     req.schoolUser._id,
      createdByName: req.schoolUser.name || ''
    });
    return res.status(201).json({ success: true, message: 'Facility created.', facility });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/website/facilities/:id */
router.put('/facilities/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid facility ID.' });
    }
    var SchoolWebsiteFacility = require('../models/SchoolWebsiteFacility.model');
    var facility = await SchoolWebsiteFacility.findOne({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!facility) {
      return res.status(404).json({ success: false, message: 'Facility not found.' });
    }

    if (req.body.name        !== undefined) facility.name        = sanitizeText(req.body.name);
    if (req.body.description !== undefined) facility.description = sanitizeText(req.body.description);
    if (req.body.category    !== undefined) facility.category    = VALID_FACILITY_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
    if (req.body.imageUrl    !== undefined) facility.imageUrl    = req.body.imageUrl;
    if (req.body.displayOrder!== undefined) facility.displayOrder= req.body.displayOrder;
    if (req.body.isPublished !== undefined) {
      facility.isPublished = !!req.body.isPublished;
      if (facility.isPublished && !facility.publishedAt) facility.publishedAt = new Date();
    }
    facility.updatedBy = req.schoolUser._id;
    await facility.save();
    return res.json({ success: true, message: 'Facility updated.', facility });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/website/facilities/:id */
router.delete('/facilities/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid facility ID.' });
    }
    var SchoolWebsiteFacility = require('../models/SchoolWebsiteFacility.model');
    var facility = await SchoolWebsiteFacility.findOneAndDelete({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!facility) {
      return res.status(404).json({ success: false, message: 'Facility not found.' });
    }
    return res.json({ success: true, message: 'Facility deleted.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E8B: PROGRAMMES
============================================ */
var VALID_PROGRAMME_LEVELS = ['primary','jss','sss','nd','hnd','degree','masters','phd','certificate','diploma','other'];

/* GET /api/institution/website/programmes */
router.get('/programmes', readGuard, async function(req, res) {
  try {
    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var filter = { schoolId: req.schoolId }; /* TENANT SCOPE */
    if (req.query.published === 'true') filter.isPublished = true;
    var programmes = await SchoolWebsiteProgramme.find(filter)
      .populate('departmentId', 'name code')
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    return res.json({ success: true, programmes, count: programmes.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/website/programmes */
router.post('/programmes', editGuard, async function(req, res) {
  try {
    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var { name, description, level, duration, subjects, entryRequirements,
          careerProspects, imageUrl, departmentId, displayOrder, isPublished, isFeatured } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Programme name is required.' });
    }
    var programme = await SchoolWebsiteProgramme.create({
      schoolId:          req.schoolId,
      name:              sanitizeText(name),
      description:       sanitizeText(description       || ''),
      level:             VALID_PROGRAMME_LEVELS.includes(level) ? level : 'other',
      duration:          sanitizeText(duration          || ''),
      subjects:          Array.isArray(subjects) ? subjects.slice(0, 20).map(function(s) { return sanitizeText(s); }) : [],
      entryRequirements: sanitizeText(entryRequirements || ''),
      careerProspects:   sanitizeText(careerProspects   || ''),
      imageUrl:          imageUrl       || '',
      departmentId:      departmentId   || null,
      displayOrder:      typeof displayOrder === 'number' ? displayOrder : 0,
      isPublished:       !!isPublished,
      isFeatured:        !!isFeatured,
      createdBy:         req.schoolUser._id,
      createdByName:     req.schoolUser.name || ''
    });
    return res.status(201).json({ success: true, message: 'Programme created.', programme });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/website/programmes/:id */
router.put('/programmes/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid programme ID.' });
    }
    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var programme = await SchoolWebsiteProgramme.findOne({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!programme) {
      return res.status(404).json({ success: false, message: 'Programme not found.' });
    }

    var textFields = ['name', 'description', 'duration', 'entryRequirements', 'careerProspects'];
    textFields.forEach(function(f) {
      if (req.body[f] !== undefined) programme[f] = sanitizeText(req.body[f]);
    });
    if (req.body.level        !== undefined) programme.level        = VALID_PROGRAMME_LEVELS.includes(req.body.level) ? req.body.level : 'other';
    if (req.body.imageUrl     !== undefined) programme.imageUrl     = req.body.imageUrl;
    if (req.body.departmentId !== undefined) programme.departmentId = req.body.departmentId || null;
    if (req.body.displayOrder !== undefined) programme.displayOrder = req.body.displayOrder;
    if (req.body.isPublished  !== undefined) programme.isPublished  = !!req.body.isPublished;
    if (req.body.isFeatured   !== undefined) programme.isFeatured   = !!req.body.isFeatured;
    if (Array.isArray(req.body.subjects)) {
      programme.subjects = req.body.subjects.slice(0, 20).map(function(s) { return sanitizeText(s); });
    }
    programme.updatedBy = req.schoolUser._id;
    await programme.save();
    return res.json({ success: true, message: 'Programme updated.', programme });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/website/programmes/:id */
router.delete('/programmes/:id', editGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid programme ID.' });
    }
    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var programme = await SchoolWebsiteProgramme.findOneAndDelete({
      _id: req.params.id, schoolId: req.schoolId /* TENANT SCOPE */
    });
    if (!programme) {
      return res.status(404).json({ success: false, message: 'Programme not found.' });
    }
    return res.json({ success: true, message: 'Programme deleted.' });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E8B: ACADEMIC CALENDAR
   Reads AcademicTerm — no duplicate model created.
============================================ */

/* GET /api/institution/website/academic-calendar */
router.get('/academic-calendar', readGuard, async function(req, res) {
  try {
    var AcademicTerm = require('../models/AcademicTerm.model');
    var terms = await AcademicTerm.find({ schoolId: req.schoolId }) /* TENANT SCOPE */
      .select('name session term startDate endDate isCurrent isActive')
      .sort({ startDate: -1 })
      .limit(20)
      .lean();
    return res.json({ success: true, terms, count: terms.length });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   E8B: PUBLIC STAFF PAGE
   All queries: TENANT SCOPE to school._id from slug.
   No private staff data (auth, salary, RBAC) exposed.
============================================ */
router.get('/:slug/staff', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolStaffProfile = require('../models/SchoolStaffProfile.model');
    var profiles = await SchoolStaffProfile.find({
      schoolId:      school._id,  /* TENANT SCOPE */
      showOnWebsite: true
    })
    .populate('staffUserId', 'name role')  /* public name and role only */
    .sort({ displayOrder: 1 })
    .lean();

    /* Group by category */
    var groups = { leadership: [], teaching: [], support: [] };
    profiles.forEach(function(p) {
      var cat = groups[p.category] ? p.category : 'teaching';
      groups[cat].push(p);
    });

    function renderGroup(title, items) {
      if (!items || !items.length) return '';
      return '<div class="ws-staff-group">' +
        '<h2 class="ws-staff-group-title">' + esc(title) + '</h2>' +
        '<div class="ws-staff-grid">' +
        items.map(function(p) {
          var staffName = (p.staffUserId && p.staffUserId.name) || '';
          var photoUrl  = escUrl(p.publicPhotoUrl || '');
          var initials  = staffName.split(' ').slice(0, 2)
            .map(function(w) { return w.charAt(0).toUpperCase(); }).join('');
          return '<div class="ws-staff-card">' +
            (photoUrl
              ? '<div class="ws-staff-photo"><img src="' + photoUrl + '" alt="' + esc(staffName) + '" loading="lazy" /></div>'
              : '<div class="ws-staff-photo ws-staff-initials">' + esc(initials || '?') + '</div>') +
            '<div class="ws-staff-info">' +
            '<h3 class="ws-staff-name">' + esc(staffName) + '</h3>' +
            (p.publicTitle ? '<div class="ws-staff-title">' + esc(p.publicTitle) + '</div>' : '') +
            (p.publicBio   ? '<p class="ws-staff-bio">'    + esc(p.publicBio.substring(0, 200)) + '</p>' : '') +
            (p.publicSubjects && p.publicSubjects.length
              ? '<div class="ws-staff-subjects">' +
                p.publicSubjects.slice(0, 5).map(function(s) {
                  return '<span class="ws-tag">' + esc(s) + '</span>';
                }).join('') + '</div>'
              : '') +
            '</div></div>';
        }).join('') +
        '</div></div>';
    }

    var bodyHtml =
      '<section class="ws-section"><div class="ws-container">' +
      '<div class="ws-section-label">Our People</div>' +
      '<h1 class="ws-page-title">Staff &amp; Leadership</h1>' +
      renderGroup('Leadership',    groups.leadership) +
      renderGroup('Teaching Staff',groups.teaching) +
      renderGroup('Support Staff', groups.support) +
      (!profiles.length ? '<div class="ws-empty"><div class="ws-empty-icon">👥</div><p>Staff directory coming soon.</p></div>' : '') +
      '</div></section>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Staff — ' + school.name),
      currentPage: 'staff',
      body:        bodyHtml
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/staff:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8B: PUBLIC DEPARTMENTS PAGE
============================================ */
router.get('/:slug/departments', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolDepartment = require('../models/SchoolDepartment.model');
    var departments = await SchoolDepartment.find({
      schoolId:      school._id,  /* TENANT SCOPE */
      showOnWebsite: true,
      isActive:      true
    }).sort({ websiteDisplayOrder: 1, name: 1 }).lean();

    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var programmes = await SchoolWebsiteProgramme.find({
      schoolId:    school._id,  /* TENANT SCOPE */
      isPublished: true
    }).select('name level duration departmentId').lean();

    /* Group programmes by departmentId */
    var progByDept = {};
    programmes.forEach(function(p) {
      var key = p.departmentId ? p.departmentId.toString() : 'none';
      if (!progByDept[key]) progByDept[key] = [];
      progByDept[key].push(p);
    });

    var deptHtml = departments.length
      ? '<div class="ws-dept-grid">' + departments.map(function(d) {
          var deptProgs = progByDept[d._id.toString()] || [];
          return '<div class="ws-dept-card">' +
            (d.websiteImageUrl ? '<div class="ws-dept-img"><img src="' + escUrl(d.websiteImageUrl) + '" alt="' + esc(d.name) + '" loading="lazy" /></div>' : '') +
            '<div class="ws-dept-body">' +
            (d.code ? '<div class="ws-dept-code">' + esc(d.code) + '</div>' : '') +
            '<h2 class="ws-dept-name">' + esc(d.name) + '</h2>' +
            (d.faculty ? '<div class="ws-dept-faculty">' + esc(d.faculty) + '</div>' : '') +
            ((d.websiteDescription || d.description)
              ? '<p class="ws-dept-desc">' + esc((d.websiteDescription || d.description).substring(0, 250)) + '</p>'
              : '') +
            (deptProgs.length
              ? '<div class="ws-dept-progs"><strong>Programmes: </strong>' +
                deptProgs.slice(0, 5).map(function(p) { return '<span class="ws-tag">' + esc(p.name) + '</span>'; }).join(' ') +
                '</div>'
              : '') +
            '</div></div>';
        }).join('') + '</div>'
      : '<div class="ws-empty"><div class="ws-empty-icon">🏢</div><p>Department information coming soon.</p></div>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Departments — ' + school.name),
      currentPage: 'departments',
      body: '<section class="ws-section"><div class="ws-container">' +
            '<div class="ws-section-label">Academics</div>' +
            '<h1 class="ws-page-title">Departments</h1>' +
            deptHtml + '</div></section>'
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/departments:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8B: PUBLIC FACILITIES PAGE
============================================ */
router.get('/:slug/facilities', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolWebsiteFacility = require('../models/SchoolWebsiteFacility.model');
    var facilities = await SchoolWebsiteFacility.find({
      schoolId:    school._id,  /* TENANT SCOPE */
      isPublished: true
    }).sort({ displayOrder: 1 }).lean();

    var facilitiesHtml = facilities.length
      ? '<div class="ws-facility-grid">' + facilities.map(function(f) {
          return '<div class="ws-facility-card">' +
            (f.imageUrl
              ? '<div class="ws-facility-img"><img src="' + escUrl(f.imageUrl) + '" alt="' + esc(f.name) + '" loading="lazy" /></div>'
              : '<div class="ws-facility-icon">🏋️</div>') +
            '<div class="ws-facility-body">' +
            '<h3 class="ws-facility-name">' + esc(f.name) + '</h3>' +
            (f.category ? '<span class="ws-tag" style="display:inline-block;margin-bottom:8px;">' + esc(f.category) + '</span>' : '') +
            (f.description ? '<p class="ws-facility-desc">' + esc(f.description.substring(0, 200)) + '</p>' : '') +
            '</div></div>';
        }).join('') + '</div>'
      : '<div class="ws-empty"><div class="ws-empty-icon">🏋️</div><p>Facilities information coming soon.</p></div>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Facilities — ' + school.name),
      currentPage: 'facilities',
      body: '<section class="ws-section"><div class="ws-container">' +
            '<div class="ws-section-label">Campus</div>' +
            '<h1 class="ws-page-title">Facilities</h1>' +
            facilitiesHtml + '</div></section>'
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/facilities:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8B: PUBLIC PROGRAMMES PAGE
============================================ */
router.get('/:slug/programmes', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolWebsiteProgramme = require('../models/SchoolWebsiteProgramme.model');
    var programmes = await SchoolWebsiteProgramme.find({
      schoolId:    school._id,  /* TENANT SCOPE */
      isPublished: true
    }).populate('departmentId', 'name').sort({ displayOrder: 1 }).lean();

    var levelMap = {
      primary:'Primary', jss:'JSS', sss:'SSS', nd:'ND', hnd:'HND',
      degree:'Degree', masters:"Master's", phd:'PhD',
      certificate:'Certificate', diploma:'Diploma', other:'Other'
    };

    var progsHtml = programmes.length
      ? '<div class="ws-programme-grid">' + programmes.map(function(p) {
          return '<div class="ws-programme-card' + (p.isFeatured ? ' ws-programme-featured' : '') + '">' +
            (p.imageUrl ? '<div class="ws-programme-img"><img src="' + escUrl(p.imageUrl) + '" alt="' + esc(p.name) + '" loading="lazy" /></div>' : '') +
            '<div class="ws-programme-body">' +
            '<div class="ws-programme-meta">' +
              '<span class="ws-tag">' + esc(levelMap[p.level] || p.level) + '</span>' +
              (p.duration ? ' <span class="ws-programme-duration">⏱ ' + esc(p.duration) + '</span>' : '') +
            '</div>' +
            '<h3 class="ws-programme-name">' + esc(p.name) + '</h3>' +
            (p.departmentId ? '<div class="ws-programme-dept">' + esc(p.departmentId.name || '') + '</div>' : '') +
            (p.description  ? '<p class="ws-programme-desc">'   + esc(p.description.substring(0, 200)) + '</p>' : '') +
            (p.entryRequirements ? '<div class="ws-programme-req"><strong>Entry Requirements:</strong> ' + esc(p.entryRequirements.substring(0, 150)) + '</div>' : '') +
            '</div></div>';
        }).join('') + '</div>'
      : '<div class="ws-empty"><div class="ws-empty-icon">📚</div><p>Programme listings coming soon.</p></div>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Programmes — ' + school.name),
      currentPage: 'programmes',
      body: '<section class="ws-section"><div class="ws-container">' +
            '<div class="ws-section-label">Academics</div>' +
            '<h1 class="ws-page-title">Programmes</h1>' +
            progsHtml + '</div></section>'
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/programmes:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8B: PUBLIC ADMISSIONS PAGE
   Content from publishedConfig.admissions +
   SchoolWebsitePage slug='admissions'.
============================================ */
router.get('/:slug/admissions', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config    = website.publishedConfig || {};
    var admission = config.admissions       || {};

    var SchoolWebsitePage = require('../models/SchoolWebsitePage.model');
    var page = await SchoolWebsitePage.findOne({
      schoolId: school._id,  /* TENANT SCOPE */
      slug:     'admissions',
      status:   'published'
    }).lean();

    var content = (page && page.publishedContent) || admission.requirements || '';

    var admBody =
      '<section class="ws-section"><div class="ws-container ws-page-content">' +
      '<div class="ws-section-label">Join Us</div>' +
      '<h1 class="ws-page-title">Admissions</h1>' +
      '<div class="ws-admissions-status ' + (admission.isOpen ? 'ws-admissions-open' : 'ws-admissions-closed') + '">' +
        (admission.isOpen ? '✅ Admissions are currently open' : '⏸ Admissions are currently closed') +
        (admission.deadline ? ' · Application deadline: <strong>' + esc(fmtDate(admission.deadline)) + '</strong>' : '') +
      '</div>' +
      (content ? '<div class="ws-prose" style="margin-top:24px;">' + esc(content).replace(/\n/g, '<br/>') + '</div>' : '') +
      (admission.howToApply
        ? '<div class="ws-callout" style="margin-top:24px;"><h3>How to Apply</h3><p>' + esc(admission.howToApply) + '</p></div>'
        : '') +
      ((admission.contactEmail || admission.contactPhone)
        ? '<div class="ws-admissions-contact"><h3>Enquiries</h3>' +
          (admission.contactEmail ? '<div>✉️ <a href="mailto:' + esc(admission.contactEmail) + '">' + esc(admission.contactEmail) + '</a></div>' : '') +
          (admission.contactPhone ? '<div>📞 ' + esc(admission.contactPhone) + '</div>' : '') +
          '</div>'
        : '') +
      (admission.applicationUrl
        ? '<div style="margin-top:28px;"><a href="' + escUrl(admission.applicationUrl) + '" class="ws-btn ws-btn-primary" target="_blank" rel="noopener">Apply Now →</a></div>'
        : '') +
      '</div></section>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Admissions — ' + school.name),
      currentPage: 'admissions',
      body:        admBody
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/admissions:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8B: PUBLIC ACADEMIC CALENDAR PAGE
   Reads AcademicTerm — no new model.
============================================ */
router.get('/:slug/academic-calendar', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var AcademicTerm = require('../models/AcademicTerm.model');
    var terms = await AcademicTerm.find({
      schoolId: school._id,  /* TENANT SCOPE */
      isActive: true
    })
    .select('name session term startDate endDate isCurrent')
    .sort({ startDate: -1 })
    .limit(12)
    .lean();

    var calHtml = terms.length
      ? '<div class="ws-calendar-wrap"><table class="ws-calendar-table"><thead><tr>' +
        '<th>Term</th><th>Session</th><th>Start</th><th>End</th><th></th>' +
        '</tr></thead><tbody>' +
        terms.map(function(t) {
          return '<tr' + (t.isCurrent ? ' class="ws-calendar-current"' : '') + '>' +
            '<td><strong>' + esc(t.name || '—') + '</strong></td>' +
            '<td>' + esc(t.session || '—') + '</td>' +
            '<td>' + (t.startDate ? fmtDate(t.startDate) : '—') + '</td>' +
            '<td>' + (t.endDate   ? fmtDate(t.endDate)   : '—') + '</td>' +
            '<td>' + (t.isCurrent ? '<span class="ws-tag-active">Current</span>' : '') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="ws-empty"><div class="ws-empty-icon">📅</div><p>Academic calendar coming soon.</p></div>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Academic Calendar — ' + school.name),
      currentPage: 'academic_calendar',
      body: '<section class="ws-section"><div class="ws-container">' +
            '<div class="ws-section-label">Academic</div>' +
            '<h1 class="ws-page-title">Academic Calendar</h1>' +
            calHtml + '</div></section>'
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/academic-calendar:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

module.exports = router;