'use strict';
/* ============================================
   LATLOMP — PUBLIC SCHOOL WEBSITE RENDERER (E8A)
   
   NO AUTHENTICATION on these routes.
   PUBLIC visitors only.
   
   SECURITY:
   1. Tenant resolved ONLY from URL slug.
   2. publishedConfig ONLY — draftConfig never served.
   3. ALL related data lookups scoped to resolved schoolId.
   4. ALL school text escaped before HTML output.
   5. No school-authored JavaScript ever rendered.
   6. No private data (students, parents, finance) in any response.
   
   Every single DB query below includes the resolved
   schoolId from slug — not from any request parameter.
============================================ */
'use strict';

var express = require('express');
var router  = express.Router();

/* ---- HTML escaping — applied to ALL school content ---- */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escUrl(url) {
  if (!url) return '';
  /* Block javascript: urls and data: urls */
  var clean = String(url).trim();
  if (/^javascript:/i.test(clean) || /^data:/i.test(clean)) return '';
  return esc(clean);
}

/* ---- Resolve tenant from slug — used by all public routes ---- */
async function resolvePublishedWebsite(slug) {
  var School       = require('../models/School.model');
  var SchoolWebsite= require('../models/SchoolWebsite.model');

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;

  var school = await School.findOne({ slug: slug.toLowerCase() })
    .select('_id name logo primaryColor secondaryColor address phone motto principalName slug')
    .lean();

  if (!school) return null;

  var website = await SchoolWebsite.findOne({
    schoolId: school._id,   /* TENANT SCOPE: schoolId from slug, not URL param */
    status:   'published'   /* NEVER serve draft or unpublished */
  }).lean();

  return { school, website };
}

/* ---- CSS custom properties from school config ---- */
function buildCSSVars(config, school) {
  var primary   = config.primaryColor   || school.primaryColor   || '#1a5276';
  var secondary = config.secondaryColor || school.secondaryColor || '#2e86c1';
  var accent    = config.accentColor    || '#e67e22';
  var fontMap   = {
    poppins:     "'Poppins', sans-serif",
    merriweather:"'Merriweather', serif",
    inter:       "'Inter', sans-serif"
  };
  var font = fontMap[config.fontTheme] || fontMap.inter;

  return [
    '--ws-primary: '   + esc(primary)   + ';',
    '--ws-secondary: ' + esc(secondary) + ';',
    '--ws-accent: '    + esc(accent)    + ';',
    '--ws-font: '      + font           + ';',
  ].join(' ');
}

/* ---- Google Fonts URL ---- */
function googleFontsUrl(fontTheme) {
  if (fontTheme === 'poppins')
    return 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap';
  if (fontTheme === 'merriweather')
    return 'https://fonts.googleapis.com/css2?family=Merriweather:wght@300;400;700&display=swap';
  return 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap';
}

/* ---- Navigation renderer ---- */
function renderNav(school, config, currentPage) {
  var appUrl = process.env.APP_URL || '';
  var slug   = school.slug || '';
  var base   = '/school/' + esc(slug);

  var modules = config.enabledModules || ['home','about','news','events','contact'];
  var labels  = config.customNavLabels || {};
  var order   = config.navOrder && config.navOrder.length ? config.navOrder : modules;

  var moduleLabels = {
    home:          'Home',
    about:         'About',
    news:          'News',
    events:        'Events',
    gallery:       'Gallery',
    staff:         'Staff',
    departments:   'Departments',
    programmes:    'Programmes',
    facilities:    'Facilities',
    admissions:    'Admissions',
    contact:       'Contact',
    alumni:        'Alumni',
    student_portal:'Student Portal',
    parent_portal: 'Parent Portal'
  };

  var portalUrls = {
    student_portal: '/institution/student/portal.html',
    parent_portal:  '/institution/parent/dashboard.html'
  };

  var navItems = order.filter(function(m) { return modules.includes(m); }).map(function(m) {
    var label    = labels[m] || moduleLabels[m] || m;
    var href     = portalUrls[m] || (m === 'home' ? base : base + '/' + m);
    var isActive = currentPage === m;
    return '<li><a href="' + esc(href) + '"' +
      (isActive ? ' class="active"' : '') + '>' + esc(label) + '</a></li>';
  }).join('');

  var logo = config.logoUrl || school.logo || '';
  var navBg = config.navStyle === 'light' ? 'ws-nav--light' : 'ws-nav--dark';

  return `<nav class="ws-nav ${navBg}">
  <div class="ws-container ws-nav-inner">
    <a href="${base}" class="ws-nav-brand">
      ${logo ? '<img src="' + escUrl(logo) + '" alt="' + esc(school.name) + ' logo" class="ws-nav-logo" />' : ''}
      <span class="ws-nav-name">${esc(school.name)}</span>
    </a>
    <button class="ws-nav-toggle" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
    <ul class="ws-nav-menu">${navItems}</ul>
  </div>
</nav>`;
}

/* ---- Footer renderer ---- */
function renderFooter(school, config) {
  var base        = '/school/' + esc(school.slug || '');
  var socialLinks = config.socialLinks || {};
  var socialHtml  = '';
  var socialMap   = {
    facebook:  { icon: 'f', label: 'Facebook'  },
    twitter:   { icon: '𝕏', label: 'Twitter'   },
    instagram: { icon: '◎', label: 'Instagram'  },
    youtube:   { icon: '▶', label: 'YouTube'    },
    linkedin:  { icon: 'in',label: 'LinkedIn'   }
  };
  Object.keys(socialMap).forEach(function(k) {
    if (socialLinks[k]) {
      socialHtml += '<a href="' + escUrl(socialLinks[k]) + '" class="ws-social-link" ' +
        'rel="noopener noreferrer" target="_blank" aria-label="' + esc(socialMap[k].label) + '">' +
        esc(socialMap[k].icon) + '</a>';
    }
  });

  return `<footer class="ws-footer">
  <div class="ws-container ws-footer-inner">
    <div class="ws-footer-brand">
      <div class="ws-footer-name">${esc(school.name)}</div>
      ${config.description ? '<p class="ws-footer-desc">' + esc(config.description.substring(0,200)) + '</p>' : ''}
    </div>
    <div class="ws-footer-contact">
      ${school.address ? '<div>📍 ' + esc(school.address) + '</div>' : ''}
      ${(config.publicPhone || school.phone) ? '<div>📞 ' + esc(config.publicPhone || school.phone) + '</div>' : ''}
      ${config.publicEmail ? '<div>✉️ <a href="mailto:' + esc(config.publicEmail) + '">' + esc(config.publicEmail) + '</a></div>' : ''}
    </div>
    <div class="ws-footer-social">${socialHtml}</div>
  </div>
  <div class="ws-footer-bottom">
    <div class="ws-container">
      <span>© ${new Date().getFullYear()} ${esc(school.name)}.</span>
      <span class="ws-footer-credit">Powered by <a href="/" rel="noopener">LatLomp</a></span>
    </div>
  </div>
</footer>`;
}

/* ---- HTML page shell ---- */
function htmlShell({ school, config, title, description, currentPage, body, extraHead }) {
  var theme    = esc(config.theme || 'modern');
  var seo      = config.seo || {};
  var pageTitle= title || esc(seo.metaTitle || school.name);
  var pageDesc = description || esc(seo.metaDescription || config.description || '');
  var ogImage  = escUrl(seo.ogImageUrl || config.logoUrl || '');
  var favicon  = escUrl(config.faviconUrl || '');
  var cssVars  = buildCSSVars(config, school);
  var canonical= (process.env.APP_URL || '') + '/school/' + esc(school.slug || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(pageDesc)}" />
${seo.keywords && seo.keywords.length
  ? '<meta name="keywords" content="' + esc(seo.keywords.join(', ')) + '" />'
  : ''}
<link rel="canonical" href="${canonical}" />
<meta property="og:type"        content="website" />
<meta property="og:title"       content="${esc(pageTitle)}" />
<meta property="og:description" content="${esc(pageDesc)}" />
${ogImage ? '<meta property="og:image" content="' + ogImage + '" />' : ''}
<meta name="twitter:card"        content="summary_large_image" />
<meta name="twitter:title"       content="${esc(pageTitle)}" />
<meta name="twitter:description" content="${esc(pageDesc)}" />
${favicon ? '<link rel="icon" href="' + favicon + '" />' : ''}
<link rel="stylesheet" href="${googleFontsUrl(config.fontTheme)}" />
<link rel="stylesheet" href="/school/themes/${theme}.css" />
<style>:root { ${cssVars} }</style>
${extraHead || ''}
</head>
<body>
${renderNav(school, config, currentPage)}
<main class="ws-main">
${body}
</main>
${renderFooter(school, config)}
<script>
/* Minimal JS — mobile nav only. No school-authored code. */
(function() {
  var toggle = document.querySelector('.ws-nav-toggle');
  var menu   = document.querySelector('.ws-nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function() {
      menu.classList.toggle('open');
      toggle.classList.toggle('open');
    });
  }
})();
</script>
</body>
</html>`;
}

/* ---- "Coming Soon" page ---- */
function comingSoonPage(school) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(school ? school.name : 'School Website')}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" />
<style>
  body { margin:0; background:#0f0f1a; color:#fff; font-family:'Inter',sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; text-align:center; }
  .box { max-width:480px; padding:40px 24px; }
  .icon { font-size:56px; margin-bottom:20px; }
  h1   { font-size:28px; font-weight:900; margin-bottom:12px; }
  p    { color:#a0a0c0; font-size:15px; line-height:1.7; }
</style>
</head>
<body>
<div class="box">
  <div class="icon">🏫</div>
  <h1>${esc(school ? school.name : 'School Website')}</h1>
  <p>This school's website is being set up. Please check back soon.</p>
</div>
</body>
</html>`;
}

/* ============================================
   DATE FORMATTING HELPER (server-side)
============================================ */
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

/* ============================================
   HOMEPAGE SECTIONS RENDERER
============================================ */
async function renderHomepageSections(sections, school, config, schoolId) {
  var SchoolWebsitePost = require('../models/SchoolWebsitePost.model');
  var SchoolEvent       = require('../models/SchoolEvent.model');

  /* Resolve data for sections that need DB access.
     All queries TENANT-SCOPED to schoolId. */
  var needsNews   = sections.find(function(s) { return s.type === 'news'   && s.enabled; });
  var needsEvents = sections.find(function(s) { return s.type === 'events' && s.enabled; });

  var [recentPosts, upcomingEvents] = await Promise.all([
    needsNews ? SchoolWebsitePost.find({
      schoolId: schoolId, /* TENANT SCOPE */
      status:   'published'
    }).sort({ publishedAt: -1 }).limit(3).lean() : Promise.resolve([]),

    needsEvents ? SchoolEvent.find({
      schoolId:      schoolId, /* TENANT SCOPE */
      showOnWebsite: true,
      status:        'published',
      date:          { $gte: new Date() }
    }).sort({ date: 1 }).limit(3).lean() : Promise.resolve([])
  ]);

  var slug = school.slug || '';
  var base = '/school/' + esc(slug);
  var html = '';

  var sortedSections = sections
    .filter(function(s) { return s.enabled; })
    .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

  sortedSections.forEach(function(section) {
    var cfg = section.config || {};

    switch (section.type) {

      case 'hero':
        var heroImg    = escUrl(cfg.heroImageUrl || config.logoUrl || '');
        var headline   = esc(cfg.headline   || config.tagline || school.name);
        var subtext    = esc(cfg.subtext    || config.description || school.motto || '');
        var btnText    = esc(cfg.buttonText || '');
        var btnUrl     = escUrl(cfg.buttonUrl || '');
        var opacity    = typeof cfg.overlayOpacity === 'number' ? cfg.overlayOpacity : 0.5;
        html += `<section class="ws-hero" style="${heroImg ? 'background-image:linear-gradient(rgba(0,0,0,' + opacity + '),rgba(0,0,0,' + opacity + ')),url(' + heroImg + ')' : ''}">
  <div class="ws-container ws-hero-content">
    <h1 class="ws-hero-headline">${headline}</h1>
    ${subtext ? '<p class="ws-hero-sub">' + subtext + '</p>' : ''}
    <div class="ws-hero-actions">
      ${btnText && btnUrl ? '<a href="' + btnUrl + '" class="ws-btn ws-btn-accent">' + btnText + '</a>' : ''}
      <a href="${base}/admissions" class="ws-btn ws-btn-outline">Apply Now</a>
    </div>
  </div>
</section>`;
        break;

      case 'about':
        var aboutText = esc(cfg.subtext || config.about || config.description || '');
        if (!aboutText) break;
        html += `<section class="ws-section ws-section-alt">
  <div class="ws-container ws-two-col">
    <div class="ws-col-text">
      <div class="ws-section-label">About Us</div>
      <h2 class="ws-section-title">${esc(cfg.headline || 'Welcome to ' + school.name)}</h2>
      <p class="ws-section-body">${aboutText}</p>
      <a href="${base}/about" class="ws-btn ws-btn-primary">Learn More</a>
    </div>
    ${config.logoUrl ? '<div class="ws-col-media"><img src="' + escUrl(config.logoUrl) + '" alt="' + esc(school.name) + '" class="ws-about-img" /></div>' : ''}
  </div>
</section>`;
        break;

      case 'principal_message':
        var pm = config.principalMessage || {};
        if (!pm.text) break;
        html += `<section class="ws-section ws-section-principal">
  <div class="ws-container ws-principal-wrap">
    ${pm.photoUrl ? '<div class="ws-principal-photo"><img src="' + escUrl(pm.photoUrl) + '" alt="' + esc(pm.name || 'Principal') + '" /></div>' : ''}
    <div class="ws-principal-text">
      <div class="ws-section-label">A Message from Our ${esc(pm.title || 'Principal')}</div>
      <blockquote class="ws-principal-quote">"${esc(pm.text)}"</blockquote>
      <div class="ws-principal-sig">${esc(pm.name || school.principalName || '')}</div>
      <div class="ws-principal-title">${esc(pm.title || 'Principal')}, ${esc(school.name)}</div>
    </div>
  </div>
</section>`;
        break;

      case 'stats':
        var stats = Array.isArray(cfg.stats) && cfg.stats.length ? cfg.stats : [];
        if (!stats.length) break;
        html += `<section class="ws-section ws-section-stats">
  <div class="ws-container">
    <div class="ws-stats-grid">
      ${stats.slice(0,6).map(function(s) {
        return '<div class="ws-stat"><div class="ws-stat-value">' + esc(s.value) +
               '</div><div class="ws-stat-label">' + esc(s.label) + '</div></div>';
      }).join('')}
    </div>
  </div>
</section>`;
        break;

      case 'news':
        if (!recentPosts.length) break;
        html += `<section class="ws-section">
  <div class="ws-container">
    <div class="ws-section-header">
      <div class="ws-section-label">Latest</div>
      <h2 class="ws-section-title">${esc(cfg.headline || 'School News')}</h2>
      <a href="${base}/news" class="ws-section-link">View All →</a>
    </div>
    <div class="ws-card-grid">
      ${recentPosts.map(function(p) {
        return '<a href="' + base + '/news/' + esc(p.slug) + '" class="ws-card">' +
          (p.featuredImageUrl ? '<div class="ws-card-img"><img src="' + escUrl(p.featuredImageUrl) + '" alt="' + esc(p.title) + '" loading="lazy" /></div>' : '') +
          '<div class="ws-card-body">' +
          (p.category ? '<span class="ws-tag">' + esc(p.category) + '</span>' : '') +
          '<h3 class="ws-card-title">' + esc(p.title) + '</h3>' +
          (p.excerpt ? '<p class="ws-card-excerpt">' + esc(p.excerpt.substring(0,120)) + '</p>' : '') +
          '<div class="ws-card-date">' + fmtDate(p.publishedAt) + '</div>' +
          '</div></a>';
      }).join('')}
    </div>
  </div>
</section>`;
        break;

      case 'events':
        if (!upcomingEvents.length) break;
        html += `<section class="ws-section ws-section-alt">
  <div class="ws-container">
    <div class="ws-section-header">
      <div class="ws-section-label">Upcoming</div>
      <h2 class="ws-section-title">${esc(cfg.headline || 'Events')}</h2>
      <a href="${base}/events" class="ws-section-link">View All →</a>
    </div>
    <div class="ws-event-list">
      ${upcomingEvents.map(function(ev) {
        var dt = ev.date ? new Date(ev.date) : null;
        return '<div class="ws-event-item">' +
          (dt ? '<div class="ws-event-date"><span class="ws-event-day">' +
            dt.getDate() + '</span><span class="ws-event-month">' +
            dt.toLocaleString('en',{month:'short'}) + '</span></div>' : '') +
          '<div class="ws-event-info">' +
          '<h3 class="ws-event-title">' + esc(ev.title) + '</h3>' +
          (ev.description ? '<p class="ws-event-desc">' + esc(ev.description.substring(0,100)) + '</p>' : '') +
          (ev.location && ev.location.address ? '<div class="ws-event-loc">📍 ' + esc(ev.location.address) + '</div>' : '') +
          '</div></div>';
      }).join('')}
    </div>
  </div>
</section>`;
        break;

      case 'contact':
        html += `<section class="ws-section ws-section-contact" id="contact">
  <div class="ws-container">
    <div class="ws-section-label">Get In Touch</div>
    <h2 class="ws-section-title">${esc(cfg.headline || 'Contact Us')}</h2>
    <div class="ws-contact-grid">
      <div class="ws-contact-info">
        ${school.address ? '<div class="ws-contact-item">📍 <span>' + esc(school.address) + '</span></div>' : ''}
        ${(config.publicPhone || school.phone) ? '<div class="ws-contact-item">📞 <span>' + esc(config.publicPhone || school.phone) + '</span></div>' : ''}
        ${config.publicEmail ? '<div class="ws-contact-item">✉️ <a href="mailto:' + esc(config.publicEmail) + '">' + esc(config.publicEmail) + '</a></div>' : ''}
        ${config.mapEmbedUrl ? '<div class="ws-map-embed"><iframe src="' + escUrl(config.mapEmbedUrl) + '" width="100%" height="300" style="border:0" allowfullscreen loading="lazy"></iframe></div>' : ''}
      </div>
    </div>
  </div>
</section>`;
        break;

      case 'cta':
        var ctaText = esc(cfg.ctaText || 'Ready to join our school?');
        var ctaBtn  = esc(cfg.ctaButtonText || 'Apply Now');
        var ctaUrl  = escUrl(cfg.ctaButtonUrl || base + '/admissions');
        html += `<section class="ws-cta">
  <div class="ws-container">
    <h2 class="ws-cta-text">${ctaText}</h2>
    <a href="${ctaUrl}" class="ws-btn ws-btn-accent">${ctaBtn}</a>
  </div>
</section>`;
        break;
    }
  });

  return html;
}

/* ============================================
   PUBLIC ROUTES
   NO authentication. publishedConfig ONLY.
   All data scoped to resolved schoolId.
============================================ */

/* ---- 404 handler ---- */
function sendNotFound(res) {
  return res.status(404).send(`<!DOCTYPE html>
<html><head><title>School Not Found</title>
<style>body{background:#0f0f1a;color:#fff;font-family:sans-serif;display:flex;
align-items:center;justify-content:center;min-height:100vh;text-align:center;margin:0;}
.box{max-width:400px;padding:32px;}</style></head>
<body><div class="box"><div style="font-size:48px">🔍</div>
<h1>School Not Found</h1>
<p style="color:#888">This school website does not exist or has been moved.</p>
<a href="/" style="color:#6c63ff">← LatLomp Home</a></div></body></html>`);
}

/* ---- Homepage ---- */
router.get('/:slug', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved) return sendNotFound(res);

    var { school, website } = resolved;

    if (!website) {
      return res.status(200).send(comingSoonPage(school));
    }

    var config   = website.publishedConfig || {};
    var sections = config.homepageSections || [];

    /* All section DB queries inside — schoolId scoped to school._id */
    var bodyHtml = await renderHomepageSections(sections, school, config, school._id);

    return res.send(htmlShell({
      school,
      config,
      title:       config.seo && config.seo.metaTitle ? esc(config.seo.metaTitle) : esc(school.name),
      description: config.seo && config.seo.metaDescription ? esc(config.seo.metaDescription) : esc(config.description || ''),
      currentPage: 'home',
      body:        bodyHtml
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug:', err.message);
    return res.status(500).send('<h1>An error occurred. Please try again.</h1>');
  }
});

/* ---- About page ---- */
router.get('/:slug/about', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolWebsitePage = require('../models/SchoolWebsitePage.model');
    var page = await SchoolWebsitePage.findOne({
      schoolId: school._id,  /* TENANT SCOPE */
      slug:     'about',
      status:   'published'
    }).lean();

    var content = (page && page.publishedContent)
      ? page.publishedContent
      : (config.about || '');

    var body = `<section class="ws-section">
  <div class="ws-container ws-page-content">
    <div class="ws-section-label">About Us</div>
    <h1 class="ws-page-title">${esc((page && page.title) || 'About ' + school.name)}</h1>
    ${esc(content) ? '<div class="ws-prose">' + esc(content).replace(/\n/g, '<br/>') + '</div>' : ''}
    ${config.mission ? '<div class="ws-callout"><h3>Our Mission</h3><p>' + esc(config.mission) + '</p></div>' : ''}
    ${config.vision  ? '<div class="ws-callout"><h3>Our Vision</h3><p>'  + esc(config.vision)  + '</p></div>' : ''}
    ${config.history ? '<div class="ws-prose"><h2>Our History</h2>'       + esc(config.history).replace(/\n/g,'<br/>') + '</div>' : ''}
  </div>
</section>`;

    return res.send(htmlShell({
      school, config,
      title:       esc('About — ' + school.name),
      currentPage: 'about',
      body
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/about:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ---- News listing ---- */
router.get('/:slug/news', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolWebsitePost = require('../models/SchoolWebsitePost.model');
    var posts = await SchoolWebsitePost.find({
      schoolId: school._id, /* TENANT SCOPE */
      status:   'published'
    }).sort({ publishedAt: -1 }).limit(20).lean();

    var base = '/school/' + esc(school.slug || '');
    var postsHtml = posts.length
      ? '<div class="ws-card-grid">' + posts.map(function(p) {
          return '<a href="' + base + '/news/' + esc(p.slug) + '" class="ws-card">' +
            (p.featuredImageUrl ? '<div class="ws-card-img"><img src="' + escUrl(p.featuredImageUrl) + '" alt="' + esc(p.title) + '" loading="lazy" /></div>' : '') +
            '<div class="ws-card-body">' +
            (p.category ? '<span class="ws-tag">' + esc(p.category) + '</span>' : '') +
            '<h2 class="ws-card-title">' + esc(p.title) + '</h2>' +
            (p.excerpt ? '<p class="ws-card-excerpt">' + esc(p.excerpt) + '</p>' : '') +
            '<div class="ws-card-date">' + fmtDate(p.publishedAt) + '</div>' +
            '</div></a>';
        }).join('') + '</div>'
      : '<div class="ws-empty">No news articles published yet.</div>';

    var body = `<section class="ws-section">
  <div class="ws-container">
    <div class="ws-section-label">Latest</div>
    <h1 class="ws-page-title">School News</h1>
    ${postsHtml}
  </div>
</section>`;

    return res.send(htmlShell({
      school, config,
      title:       esc('News — ' + school.name),
      currentPage: 'news',
      body
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/news:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ---- Single news post ---- */
router.get('/:slug/news/:postSlug', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolWebsitePost = require('../models/SchoolWebsitePost.model');
    var post = await SchoolWebsitePost.findOne({
      schoolId: school._id,             /* TENANT SCOPE */
      slug:     req.params.postSlug,
      status:   'published'
    }).lean();

    if (!post) return sendNotFound(res);

    var body = `<section class="ws-section">
  <div class="ws-container ws-article">
    ${post.featuredImageUrl ? '<div class="ws-article-hero"><img src="' + escUrl(post.featuredImageUrl) + '" alt="' + esc(post.title) + '" /></div>' : ''}
    <div class="ws-article-meta">
      ${post.category ? '<span class="ws-tag">' + esc(post.category) + '</span>' : ''}
      <span class="ws-article-date">${fmtDate(post.publishedAt)}</span>
      ${post.authorDisplayName ? '<span class="ws-article-author">By ' + esc(post.authorDisplayName) + '</span>' : ''}
    </div>
    <h1 class="ws-article-title">${esc(post.title)}</h1>
    ${post.excerpt ? '<p class="ws-article-excerpt">' + esc(post.excerpt) + '</p>' : ''}
    <div class="ws-prose">${esc(post.content).replace(/\n/g, '<br/>')}</div>
    <a href="/school/${esc(school.slug)}/news" class="ws-back-link">← Back to News</a>
  </div>
</section>`;

    return res.send(htmlShell({
      school, config,
      title:       esc((post.metaTitle || post.title) + ' — ' + school.name),
      description: esc(post.metaDesc || post.excerpt || ''),
      currentPage: 'news',
      body,
      extraHead: post.featuredImageUrl
        ? '<meta property="og:image" content="' + escUrl(post.featuredImageUrl) + '" />'
        : ''
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/news/:postSlug:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ---- Contact page ---- */
router.get('/:slug/contact', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var body = `<section class="ws-section">
  <div class="ws-container ws-page-content">
    <div class="ws-section-label">Reach Us</div>
    <h1 class="ws-page-title">Contact ${esc(school.name)}</h1>
    <div class="ws-contact-grid">
      <div class="ws-contact-info">
        ${school.address ? '<div class="ws-contact-item">📍 <strong>Address</strong><br/>' + esc(school.address) + '</div>' : ''}
        ${(config.publicPhone || school.phone) ? '<div class="ws-contact-item">📞 <strong>Phone</strong><br/>' + esc(config.publicPhone || school.phone) + '</div>' : ''}
        ${config.publicEmail ? '<div class="ws-contact-item">✉️ <strong>Email</strong><br/><a href="mailto:' + esc(config.publicEmail) + '">' + esc(config.publicEmail) + '</a></div>' : ''}
      </div>
      ${config.mapEmbedUrl ? '<div class="ws-map-wrap"><iframe src="' + escUrl(config.mapEmbedUrl) + '" width="100%" height="350" style="border:0;border-radius:12px;" allowfullscreen loading="lazy"></iframe></div>' : ''}
    </div>
  </div>
</section>`;

    return res.send(htmlShell({
      school, config,
      title:       esc('Contact — ' + school.name),
      currentPage: 'contact',
      body
    }));
  } catch(err) {
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ---- Events listing ---- */
router.get('/:slug/events', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var SchoolEvent = require('../models/SchoolEvent.model');
    var events = await SchoolEvent.find({
      schoolId:      school._id, /* TENANT SCOPE */
      showOnWebsite: true,
      status:        'published',
      date:          { $gte: new Date() }
    }).sort({ date: 1 }).limit(20).lean();

    var eventsHtml = events.length
      ? '<div class="ws-event-list">' + events.map(function(ev) {
          var dt = ev.date ? new Date(ev.date) : null;
          return '<div class="ws-event-item">' +
            (dt ? '<div class="ws-event-date"><span class="ws-event-day">' + dt.getDate() +
              '</span><span class="ws-event-month">' + dt.toLocaleString('en',{month:'short'}) +
              '</span></div>' : '') +
            '<div class="ws-event-info">' +
            '<h2 class="ws-event-title">' + esc(ev.title) + '</h2>' +
            (ev.description ? '<p>' + esc(ev.description.substring(0,200)) + '</p>' : '') +
            (ev.location && ev.location.address ? '<div class="ws-event-loc">📍 ' + esc(ev.location.address) + '</div>' : '') +
            '</div></div>';
        }).join('') + '</div>'
      : '<div class="ws-empty">No upcoming events.</div>';

    var body = `<section class="ws-section">
  <div class="ws-container">
    <div class="ws-section-label">What\'s On</div>
    <h1 class="ws-page-title">Upcoming Events</h1>
    ${eventsHtml}
  </div>
</section>`;

    return res.send(htmlShell({
      school, config,
      title:       esc('Events — ' + school.name),
      currentPage: 'events',
      body
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/events:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

module.exports = router;