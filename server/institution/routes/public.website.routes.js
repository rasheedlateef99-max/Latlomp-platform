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
    parent_portal:  '/institution/parent/dashboard.html',
    school_portal:  '/institution/school/dashboard.html'
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
/* ✅ E8G: Extended htmlShell with JSON-LD, meta robots, sitemap link, og:type */
function htmlShell({ school, config, title, description, currentPage, body, extraHead, ogType, isPublished }) {
  var theme    = esc(config.theme || 'modern');
  var seo      = config.seo || {};
  var pageTitle= title || esc(seo.metaTitle || school.name);
  var pageDesc = description || esc(seo.metaDescription || config.description || '');
  var ogImage  = escUrl(seo.ogImageUrl || config.logoUrl || '');
  var favicon  = escUrl(config.faviconUrl || '');
  var cssVars  = buildCSSVars(config, school);
  var appUrl   = process.env.APP_URL || '';
  var baseUrl  = appUrl + '/school/' + esc(school.slug || '');
  var canonical = baseUrl + (currentPage && currentPage !== 'home' ? '/' + currentPage : '');

  /* ✅ E8G: Meta robots — only published, active websites get indexed */
  var metaRobots = (isPublished === false)
    ? '<meta name="robots" content="noindex, nofollow" />'
    : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />';

  /* ✅ E8G: og:type — article for news pages, website for all others */
  var resolvedOgType = ogType || 'website';

  /* ✅ E8G: Sitemap link */
  var sitemapLink = school.slug
    ? '<link rel="sitemap" type="application/xml" title="Sitemap" href="' + esc(baseUrl) + '/sitemap.xml" />'
    : '';

  /* ✅ E8G: JSON-LD structured data — EducationalOrganization */
  var jsonLdObj = {
    '@context': 'https://schema.org',
    '@type':    'EducationalOrganization',
    'name':     school.name || '',
    'url':      baseUrl,
    'logo':     config.logoUrl || school.logo || '',
    'description': config.description || config.tagline || '',
    'address': school.address ? {
      '@type':           'PostalAddress',
      'streetAddress':   school.address,
      'addressLocality': ''
    } : undefined,
    'telephone': config.publicPhone || school.phone || undefined,
    'email':     config.publicEmail || undefined,
    'foundingDate': config.foundedYear ? String(config.foundedYear) : undefined
  };
  /* Strip undefined keys */
  Object.keys(jsonLdObj).forEach(function(k) {
    if (jsonLdObj[k] === undefined || jsonLdObj[k] === '') delete jsonLdObj[k];
  });
  var jsonLdScript = '<script type="application/ld+json">' +
    JSON.stringify(jsonLdObj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') +
    '<\/script>';

  /* ✅ E8G: Keywords meta tag */
  var keywordsMeta = (seo.keywords && seo.keywords.length)
    ? '<meta name="keywords" content="' + esc(seo.keywords.join(', ')) + '" />'
    : '';

  var fontUrl = googleFontsUrl(config.fontTheme);

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '<title>' + esc(pageTitle) + '</title>\n' +
    '<meta name="description" content="' + esc(pageDesc) + '" />\n' +
    keywordsMeta + '\n' +
    metaRobots + '\n' +
    '<link rel="canonical" href="' + esc(canonical) + '" />\n' +
    sitemapLink + '\n' +
    '<meta property="og:type"        content="' + esc(resolvedOgType) + '" />\n' +
    '<meta property="og:title"       content="' + esc(pageTitle) + '" />\n' +
    '<meta property="og:description" content="' + esc(pageDesc) + '" />\n' +
    '<meta property="og:url"         content="' + esc(canonical) + '" />\n' +
    '<meta property="og:site_name"   content="' + esc(school.name) + '" />\n' +
    (ogImage ? '<meta property="og:image" content="' + ogImage + '" />\n' +
               '<meta property="og:image:width"  content="1200" />\n' +
               '<meta property="og:image:height" content="630" />\n' : '') +
    '<meta name="twitter:card"        content="summary_large_image" />\n' +
    '<meta name="twitter:title"       content="' + esc(pageTitle) + '" />\n' +
    '<meta name="twitter:description" content="' + esc(pageDesc) + '" />\n' +
    (ogImage ? '<meta name="twitter:image" content="' + ogImage + '" />\n' : '') +
    (favicon ? '<link rel="icon" href="' + escUrl(favicon) + '" />\n' : '') +
    '<link rel="stylesheet" href="' + esc(fontUrl) + '" />\n' +
    '<link rel="stylesheet" href="/school/themes/' + theme + '.css" />\n' +
    '<style>:root { ' + cssVars + ' }</style>\n' +
    jsonLdScript + '\n' +
    (extraHead || '') + '\n' +
    '</head>\n<body>\n' +
    renderNav(school, config, currentPage) + '\n' +
    '<main class="ws-main">\n' +
    body + '\n' +
    '</main>\n' +
    renderFooter(school, config) + '\n' +
    '<script>\n' +
    '/* Minimal platform JS — mobile nav only. No school-authored code. */\n' +
    '(function() {\n' +
    '  var toggle = document.querySelector(\'.ws-nav-toggle\');\n' +
    '  var menu   = document.querySelector(\'.ws-nav-menu\');\n' +
    '  if (toggle && menu) {\n' +
    '    toggle.addEventListener(\'click\', function() {\n' +
    '      menu.classList.toggle(\'open\');\n' +
    '      toggle.classList.toggle(\'open\');\n' +
    '    });\n' +
    '  }\n' +
    '})();\n' +
    '<\/script>\n' +
    '</body>\n</html>';
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

    var bodyHtml = await renderHomepageSections(sections, school, config, school._id);

    return res.send(htmlShell({
      school,
      config,
      title:       config.seo && config.seo.metaTitle ? esc(config.seo.metaTitle) : esc(school.name),
      description: config.seo && config.seo.metaDescription ? esc(config.seo.metaDescription) : esc(config.description || ''),
      currentPage: 'home',
      body:        bodyHtml,
      isPublished: true
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
      schoolId: school._id,
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
      body,
      isPublished: true
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
      schoolId: school._id,
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
      body,
      isPublished: true
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
      schoolId: school._id,
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
      ogType:      'article',
      isPublished: true,
      body,
      extraHead: [
        post.featuredImageUrl
          ? '<meta property="og:image"            content="' + escUrl(post.featuredImageUrl) + '" />'
          : '',
        post.publishedAt
          ? '<meta property="article:published_time" content="' + new Date(post.publishedAt).toISOString() + '" />'
          : '',
        '<meta property="article:section" content="' + esc(post.category || 'News') + '" />'
      ].filter(Boolean).join('\n')
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
      body,
      isPublished: true
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
      schoolId:      school._id,
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
      body,
      isPublished: true
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/events:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8C: PUBLIC GALLERY INDEX
============================================ */
router.get('/:slug/gallery', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};
    var base   = '/school/' + esc(school.slug || '');

    var SchoolGalleryAlbum = require('../models/SchoolGalleryAlbum.model');
    var albums = await SchoolGalleryAlbum.find({
      schoolId: school._id,
      status:   'published'
    })
    .select('title description slug coverImageUrl items displayOrder isFeatured publishedAt')
    .sort({ displayOrder: 1, publishedAt: -1 })
    .lean();

    var albumsHtml = albums.length
      ? '<div class="ws-gallery-grid">' +
        albums.map(function(a) {
          var count = (a.items || []).length;
          var cover = escUrl(a.coverImageUrl || '');
          return '<a href="' + base + '/gallery/' + esc(a._id.toString()) + '" class="ws-album-card">' +
            '<div class="ws-album-cover">' +
              (cover
                ? '<img src="' + cover + '" alt="' + esc(a.title) + '" loading="lazy" />'
                : '<div class="ws-album-cover-placeholder">🖼️</div>') +
              '<div class="ws-album-count">' + count + ' photo' + (count !== 1 ? 's' : '') + '</div>' +
            '</div>' +
            '<div class="ws-album-meta">' +
              '<h3 class="ws-album-title">' + esc(a.title) + '</h3>' +
              (a.description ? '<p class="ws-album-desc">' + esc(a.description.substring(0, 100)) + '</p>' : '') +
            '</div>' +
          '</a>';
        }).join('') +
        '</div>'
      : '<div class="ws-empty"><div class="ws-empty-icon">🖼️</div><p>Gallery coming soon.</p></div>';

    return res.send(htmlShell({
      school, config,
      title:       esc('Gallery — ' + school.name),
      currentPage: 'gallery',
      body:
        '<section class="ws-section"><div class="ws-container">' +
        '<div class="ws-section-label">Photos</div>' +
        '<h1 class="ws-page-title">Photo Gallery</h1>' +
        albumsHtml +
        '</div></section>',
      isPublished: true
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/gallery:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8C: PUBLIC SINGLE ALBUM VIEW
============================================ */
router.get('/:slug/gallery/:albumId', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);
    var { school, website } = resolved;
    var config = website.publishedConfig || {};
    var base   = '/school/' + esc(school.slug || '');

    if (!req.params.albumId || !req.params.albumId.match(/^[a-f\d]{24}$/i)) {
      return sendNotFound(res);
    }

    var SchoolGalleryAlbum = require('../models/SchoolGalleryAlbum.model');
    var album = await SchoolGalleryAlbum.findOne({
      _id:      req.params.albumId,
      schoolId: school._id,
      status:   'published'
    }).lean();

    if (!album) return sendNotFound(res);

    var items = (album.items || []).sort(function(a, b) {
      return (a.displayOrder || 0) - (b.displayOrder || 0);
    });

    var photosHtml = items.length
      ? '<div class="ws-photo-grid" id="photoGrid">' +
        items.map(function(item, i) {
          var thumbUrl = escUrl(item.thumbnailUrl || item.url || '');
          var fullUrl  = escUrl(item.url || '');
          var alt      = esc(item.altText || item.caption || album.title);
          return '<div class="ws-photo-item" ' +
            'onclick="openLightbox(' + i + ')" ' +
            'data-full="' + fullUrl + '" ' +
            'data-caption="' + esc(item.caption || '') + '">' +
            '<img src="' + thumbUrl + '" alt="' + alt + '" loading="lazy" />' +
            (item.caption ? '<div class="ws-photo-caption">' + esc(item.caption) + '</div>' : '') +
          '</div>';
        }).join('') +
        '</div>'
      : '<div class="ws-empty"><p>No photos in this album yet.</p></div>';

    var lightboxData = JSON.stringify(items.map(function(item) {
      return { url: item.url || '', caption: item.caption || '' };
    })).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    var lightboxHtml =
      '<div id="lightbox" class="ws-lightbox" style="display:none;" onclick="closeLightbox(event)">' +
        '<button class="ws-lb-close" onclick="closeLightbox()" aria-label="Close">✕</button>' +
        '<button class="ws-lb-prev"  onclick="lbPrev(event)"   aria-label="Previous">‹</button>' +
        '<button class="ws-lb-next"  onclick="lbNext(event)"   aria-label="Next">›</button>' +
        '<div class="ws-lb-content">' +
          '<img id="lbImg" src="" alt="" />' +
          '<div id="lbCaption" class="ws-lb-caption"></div>' +
          '<div id="lbCounter" class="ws-lb-counter"></div>' +
        '</div>' +
      '</div>';

    var body =
      '<section class="ws-section"><div class="ws-container">' +
        '<a href="' + base + '/gallery" class="ws-back-link" style="display:inline-block;margin-bottom:20px;">← All Albums</a>' +
        '<div class="ws-section-label">Gallery</div>' +
        '<h1 class="ws-page-title">' + esc(album.title) + '</h1>' +
        (album.description ? '<p class="ws-album-full-desc">' + esc(album.description) + '</p>' : '') +
        '<div class="ws-album-info" style="font-size:13px;color:var(--ws-text-light);margin-bottom:28px;">' +
          items.length + ' photo' + (items.length !== 1 ? 's' : '') +
          (album.publishedAt ? ' · ' + fmtDate(album.publishedAt) : '') +
        '</div>' +
        photosHtml +
      '</div></section>' +
      lightboxHtml;

    var extraHead = '<style>' +
      '.ws-lightbox{position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;cursor:zoom-out;}' +
      '.ws-lb-content{position:relative;max-width:90vw;max-height:90vh;text-align:center;}' +
      '#lbImg{max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;}' +
      '.ws-lb-caption{color:rgba(255,255,255,0.8);font-size:14px;margin-top:12px;}' +
      '.ws-lb-counter{color:rgba(255,255,255,0.5);font-size:12px;margin-top:6px;}' +
      '.ws-lb-close,.ws-lb-prev,.ws-lb-next{position:fixed;background:rgba(255,255,255,0.15);' +
        'border:none;color:#fff;font-size:24px;cursor:pointer;border-radius:50%;' +
        'width:44px;height:44px;display:flex;align-items:center;justify-content:center;' +
        'transition:background 0.2s;z-index:10000;}' +
      '.ws-lb-close{top:20px;right:20px;font-size:18px;}' +
      '.ws-lb-prev{left:20px;top:50%;transform:translateY(-50%);}' +
      '.ws-lb-next{right:20px;top:50%;transform:translateY(-50%);}' +
      '.ws-lb-close:hover,.ws-lb-prev:hover,.ws-lb-next:hover{background:rgba(255,255,255,0.3);}' +
      '</style>';

    var extraScript =
      '<script>' +
      '(function(){' +
        'var _photos=' + lightboxData + ';' +
        'var _idx=0;' +
        'var _lb=document.getElementById("lightbox");' +
        'var _img=document.getElementById("lbImg");' +
        'var _cap=document.getElementById("lbCaption");' +
        'var _ctr=document.getElementById("lbCounter");' +
        'window.openLightbox=function(i){' +
          '_idx=i;' +
          'showPhoto();' +
          '_lb.style.display="flex";' +
          'document.body.style.overflow="hidden";' +
        '};' +
        'function showPhoto(){' +
          'var p=_photos[_idx]||{};' +
          '_img.src=p.url||"";' +
          '_cap.textContent=p.caption||"";' +
          '_ctr.textContent=(_idx+1)+" / "+_photos.length;' +
        '}' +
        'window.closeLightbox=function(e){' +
          'if(e&&e.target!==_lb&&!e.target.classList.contains("ws-lb-close"))return;' +
          '_lb.style.display="none";' +
          'document.body.style.overflow="";' +
        '};' +
        'window.lbPrev=function(e){e&&e.stopPropagation();_idx=(_idx-1+_photos.length)%_photos.length;showPhoto();};' +
        'window.lbNext=function(e){e&&e.stopPropagation();_idx=(_idx+1)%_photos.length;showPhoto();};' +
        'document.addEventListener("keydown",function(e){' +
          'if(_lb.style.display!=="flex")return;' +
          'if(e.key==="Escape")closeLightbox({target:_lb});' +
          'if(e.key==="ArrowLeft")lbPrev();' +
          'if(e.key==="ArrowRight")lbNext();' +
        '});' +
      '})();' +
      '<\/script>';

    return res.send(htmlShell({
      school, config,
      title:       esc(album.title + ' — Gallery — ' + school.name),
      currentPage: 'gallery',
      body:        body + extraScript,
      extraHead,
      isPublished: true
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/gallery/:albumId:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8F: PUBLIC ALUMNI DIRECTORY PAGE
============================================ */
router.get('/:slug/alumni', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) return sendNotFound(res);

    var { school, website } = resolved;
    var config = website.publishedConfig || {};

    var AlumniProfile = require('../models/AlumniProfile.model');

    var alumni = await AlumniProfile.find({
      schoolId:            school._id,
      directoryVisibility: 'public',
      showOnWebsite:       true,
      status:              'active'
    })
    .populate('studentId', 'name')
    .select([
      'displayName', 'bio', 'profession', 'industry',
      'organisation', 'graduationSession', 'lastClassName',
      'alumniSince', 'location', 'mentorshipAvailable',
      'studentId'
    ].join(' '))
    .sort({ alumniSince: -1 })
    .limit(100)
    .lean();

    var safeList = alumni.map(function(a) {
      var gradYear = a.alumniSince
        ? new Date(a.alumniSince).getFullYear()
        : (a.graduationSession || '');
      return {
        displayName:         a.displayName || (a.studentId && a.studentId.name) || 'Alumnus',
        bio:                 (a.bio || '').substring(0, 300),
        profession:          a.profession   || '',
        industry:            a.industry     || '',
        organisation:        a.organisation || '',
        graduationYear:      gradYear,
        lastClassName:       a.lastClassName || '',
        city:                (a.location && a.location.city)    || '',
        country:             (a.location && a.location.country) || '',
        mentorshipAvailable: !!a.mentorshipAvailable
      };
    });

    var byYear = {};
    safeList.forEach(function(a) {
      var yr = a.graduationYear ? String(a.graduationYear) : 'Unknown Year';
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(a);
    });

    var sortedYears = Object.keys(byYear).sort(function(a, b) {
      var numA = parseInt(a) || 0;
      var numB = parseInt(b) || 0;
      return numB - numA;
    });

    function renderAlumniCard(a) {
      var initials = a.displayName.split(' ').slice(0, 2)
        .map(function(w) { return w.charAt(0).toUpperCase(); }).join('');
      var location = [a.city, a.country].filter(Boolean).join(', ');
      return '<div class="ws-alumni-card">' +
        '<div class="ws-alumni-avatar">' + esc(initials || '?') + '</div>' +
        '<div class="ws-alumni-info">' +
          '<h3 class="ws-alumni-name">' + esc(a.displayName) + '</h3>' +
          (a.profession ? '<div class="ws-alumni-role">' + esc(a.profession) +
            (a.organisation ? ' · ' + esc(a.organisation) : '') + '</div>' : '') +
          (a.industry  ? '<div class="ws-alumni-industry">' + esc(a.industry)  + '</div>' : '') +
          (location    ? '<div class="ws-alumni-location">📍 ' + esc(location) + '</div>' : '') +
          (a.lastClassName ? '<div class="ws-alumni-class">Class: ' + esc(a.lastClassName) + '</div>' : '') +
          (a.bio       ? '<p class="ws-alumni-bio">' + esc(a.bio) + '</p>' : '') +
          (a.mentorshipAvailable ? '<div class="ws-alumni-mentor">🤝 Open to mentorship</div>' : '') +
        '</div>' +
      '</div>';
    }

    var alumniHtml;
    if (!safeList.length) {
      alumniHtml = '<div class="ws-empty"><div class="ws-empty-icon">🎓</div><p>Alumni profiles coming soon.</p></div>';
    } else {
      alumniHtml = sortedYears.map(function(yr) {
        return '<div class="ws-alumni-year-group">' +
          '<h2 class="ws-alumni-year-heading">Class of ' + esc(yr) + '</h2>' +
          '<div class="ws-alumni-grid">' +
          byYear[yr].map(renderAlumniCard).join('') +
          '</div>' +
        '</div>';
      }).join('');
    }

    return res.send(htmlShell({
      school, config,
      title:       esc('Alumni — ' + school.name),
      currentPage: 'alumni',
      body:
        '<section class="ws-section"><div class="ws-container">' +
          '<div class="ws-section-label">Our Graduates</div>' +
          '<h1 class="ws-page-title">Alumni Directory</h1>' +
          '<p class="ws-section-body" style="margin-bottom:32px;">' +
            'Celebrating the achievements of our graduates. ' +
            'Alumni appearing here have chosen to make their profile public.' +
          '</p>' +
          alumniHtml +
        '</div></section>',
      isPublished: true
    }));
  } catch(err) {
    console.error('[public-website] GET /:slug/alumni:', err.message);
    return res.status(500).send('<h1>An error occurred.</h1>');
  }
});

/* ============================================
   E8G: SITEMAP XML
   GET /school/:slug/sitemap.xml
   
   Dynamic sitemap for this school's public website.
   Only published websites get a sitemap.
   Only enabled modules included.
   Individual news posts and gallery albums included.
   Portal links (student/parent) excluded — they
   are authenticated, not crawlable public pages.
   
   All URLs scoped to school._id from slug.
   No private data. No draft content.
============================================ */
router.get('/:slug/sitemap.xml', async function(req, res) {
  try {
    var resolved = await resolvePublishedWebsite(req.params.slug);
    if (!resolved || !resolved.website) {
      res.status(404).set('Content-Type', 'text/plain').send('Not found.');
      return;
    }

    var { school, website } = resolved;
    var config  = website.publishedConfig || {};
    var appUrl  = process.env.APP_URL || (req.protocol + '://' + req.get('host'));
    var base    = appUrl + '/school/' + (school.slug || '');
    var now     = new Date().toISOString().split('T')[0];
    var lastPub = website.publishedAt
      ? new Date(website.publishedAt).toISOString().split('T')[0]
      : now;

    var enabledModules = config.enabledModules || ['home', 'about', 'news', 'events', 'contact'];

    /* Skip portal links and modules that are authenticated external links */
    var SKIP_MODULES = new Set(['student_portal', 'parent_portal', 'school_portal']);

    /* Module → URL path mapping */
    var MODULE_PATHS = {
      home:              '',
      about:             '/about',
      news:              '/news',
      events:            '/events',
      gallery:           '/gallery',
      staff:             '/staff',
      departments:       '/departments',
      programmes:        '/programmes',
      facilities:        '/facilities',
      admissions:        '/admissions',
      contact:           '/contact',
      alumni:            '/alumni',
      academic_calendar: '/academic-calendar'
    };

    var urls = [];

    /* Static module pages */
    enabledModules.forEach(function(mod) {
      if (SKIP_MODULES.has(mod)) return;
      if (!MODULE_PATHS.hasOwnProperty(mod)) return;
      var path     = MODULE_PATHS[mod];
      var priority = (mod === 'home') ? '1.0' :
                     (['about','admissions','staff','departments'].includes(mod)) ? '0.8' : '0.7';
      var freq     = (mod === 'news') ? 'daily' :
                     (mod === 'events') ? 'weekly' : 'monthly';
      urls.push({
        loc:        base + path,
        lastmod:    lastPub,
        changefreq: freq,
        priority:   priority
      });
    });

    /* Dynamic: published news posts */
    if (enabledModules.includes('news')) {
      var SchoolWebsitePost = require('../models/SchoolWebsitePost.model');
      var posts = await SchoolWebsitePost.find({
        schoolId: school._id, /* TENANT SCOPE */
        status:   'published'
      }).select('slug publishedAt updatedAt').sort({ publishedAt: -1 }).limit(200).lean();

      posts.forEach(function(p) {
        var postDate = (p.updatedAt || p.publishedAt)
          ? new Date(p.updatedAt || p.publishedAt).toISOString().split('T')[0]
          : now;
        urls.push({
          loc:        base + '/news/' + (p.slug || ''),
          lastmod:    postDate,
          changefreq: 'monthly',
          priority:   '0.6'
        });
      });
    }

    /* Dynamic: published gallery albums */
    if (enabledModules.includes('gallery')) {
      var SchoolGalleryAlbum = require('../models/SchoolGalleryAlbum.model');
      var albums = await SchoolGalleryAlbum.find({
        schoolId: school._id, /* TENANT SCOPE */
        status:   'published'
      }).select('_id publishedAt updatedAt').sort({ publishedAt: -1 }).limit(100).lean();

      albums.forEach(function(a) {
        var albumDate = (a.updatedAt || a.publishedAt)
          ? new Date(a.updatedAt || a.publishedAt).toISOString().split('T')[0]
          : now;
        urls.push({
          loc:        base + '/gallery/' + a._id.toString(),
          lastmod:    albumDate,
          changefreq: 'monthly',
          priority:   '0.5'
        });
      });
    }

    /* Build XML */
    var urlElements = urls.map(function(u) {
      return '  <url>\n' +
        '    <loc>' + esc(u.loc) + '</loc>\n' +
        '    <lastmod>' + esc(u.lastmod) + '</lastmod>\n' +
        '    <changefreq>' + esc(u.changefreq) + '</changefreq>\n' +
        '    <priority>' + esc(u.priority) + '</priority>\n' +
        '  </url>';
    }).join('\n');

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
      '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9\n' +
      '          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n' +
      urlElements + '\n' +
      '</urlset>';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600'); /* 1 hour cache */
    return res.send(xml);

  } catch(err) {
    console.error('[public-website] GET /:slug/sitemap.xml:', err.message);
    res.status(500).set('Content-Type', 'text/plain').send('Sitemap generation error.');
  }
});

/* ============================================
   E8G: ROBOTS.TXT
   GET /school/:slug/robots.txt
   
   Published websites: allow all crawlers.
   Unpublished/draft/not-found: disallow all.
   Points crawlers to this school's sitemap.
   
   Note: When custom domains are added (future),
   robots.txt will be served at the domain root.
   For now slug-based routing handles it.
============================================ */
router.get('/:slug/robots.txt', async function(req, res) {
  try {
    var School        = require('../models/School.model');
    var SchoolWebsite = require('../models/SchoolWebsite.model');

    var slug = (req.params.slug || '').toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
      res.set('Content-Type', 'text/plain').send('User-agent: *\nDisallow: /\n');
      return;
    }

    var school = await School.findOne({ slug }).select('_id slug').lean();
    if (!school) {
      res.set('Content-Type', 'text/plain').send('User-agent: *\nDisallow: /\n');
      return;
    }

    var website = await SchoolWebsite.findOne({
      schoolId: school._id, /* TENANT SCOPE */
      status:   'published'
    }).select('status').lean();

    var appUrl  = process.env.APP_URL || (req.protocol + '://' + req.get('host'));
    var base    = appUrl + '/school/' + esc(slug);
    var content;

    if (website) {
      /* Published — allow all, reference sitemap */
      content = [
        'User-agent: *',
        'Allow: /',
        '',
        '# Disallow private/authenticated paths',
        'Disallow: /api/',
        'Disallow: /institution/',
        '',
        '# Sitemap',
        'Sitemap: ' + base + '/sitemap.xml',
        ''
      ].join('\n');
    } else {
      /* Not published — block all crawlers */
      content = [
        'User-agent: *',
        'Disallow: /',
        ''
      ].join('\n');
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400'); /* 24 hour cache */
    return res.send(content);

  } catch(err) {
    console.error('[public-website] GET /:slug/robots.txt:', err.message);
    res.set('Content-Type', 'text/plain').send('User-agent: *\nDisallow: /\n');
  }
});

module.exports = router;