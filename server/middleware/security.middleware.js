/* ============================================
   LATLOMP PLATFORM — SECURITY MIDDLEWARE

   Exports: applySecurityMiddleware(app)
   Called once from server.js before routes.

   Includes:
   1. Helmet — HTTP security headers
   2. Rate limiting — per IP, per route group
   3. MongoDB injection sanitisation
   4. XSS input sanitisation (inline, no package)
   5. Suspicious request detector
   6. Brute-force protection

   ✅ FIX: xss-clean removed.
   It used internal Node.js APIs removed in
   Node.js 17+. Replaced with an inline
   sanitizer that strips <script>, javascript:,
   and HTML tags from req.body, req.query,
   and req.params without any npm dependency.
============================================ */

'use strict';

var helmet, rateLimit, mongoSanitize;

try {
  helmet = require('helmet');
} catch (e) {
  console.warn('[Security] helmet not installed — run npm install helmet');
}

try {
  rateLimit = require('express-rate-limit');
} catch (e) {
  console.warn('[Security] express-rate-limit not installed — run npm install express-rate-limit');
}

try {
  mongoSanitize = require('express-mongo-sanitize');
} catch (e) {
  console.warn('[Security] express-mongo-sanitize not installed — run npm install express-mongo-sanitize');
}

/* ============================================
   INLINE XSS SANITIZER
   Replaces xss-clean (abandoned, Node 22 broken).
   Recursively walks req.body, req.query, and
   req.params and strips dangerous HTML patterns
   from every string value.
============================================ */
function sanitizeValue(val) {
  if (typeof val !== 'string') { return val; }
  return val
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') { return obj; }
  Object.keys(obj).forEach(function (key) {
    var val = obj[key];
    if (typeof val === 'string') {
      obj[key] = sanitizeValue(val);
    } else if (typeof val === 'object' && val !== null) {
      sanitizeObject(val);
    }
  });
  return obj;
}

function xssSanitizer(req, res, next) {
  try {
    if (req.body)   { sanitizeObject(req.body);   }
    if (req.query)  { sanitizeObject(req.query);  }
    if (req.params) { sanitizeObject(req.params); }
  } catch (e) {
    /* Never block a request due to sanitizer error */
  }
  next();
}

/* ============================================
   RATE LIMIT FACTORY

   ✅ No custom keyGenerator.
   express-rate-limit v7 with app.set('trust proxy', 1)
   extracts the real IP from x-forwarded-for
   automatically. No manual key needed.
============================================ */
function makeLimit(windowMinutes, maxRequests, message) {
  if (!rateLimit) { return function (req, res, next) { next(); }; }

  return rateLimit({
    windowMs:        windowMinutes * 60 * 1000,
    max:             maxRequests,
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
      success: false,
      message: message || 'Too many requests. Please slow down and try again.',
      code:    'RATE_LIMITED'
    },
    skip: function (req) {
      return req.path === '/api/health';
    }
  });
}

/* ============================================
   SUSPICIOUS REQUEST DETECTOR
   Blocks path traversal, NoSQL injection probes,
   script injection, and common scanner patterns.
============================================ */
function suspiciousRequestGuard(req, res, next) {
  var path  = req.path || '';
  var query = '';
  var body  = '';

  try { query = JSON.stringify(req.query)  || ''; } catch (e) {}
  try { body  = JSON.stringify(req.body)   || ''; } catch (e) {}

  var badPatterns = [
    /\$where/i,
    /\$expr/i,
    /\$function/i,
    /\$accumulator/i,
    /\.\.\//,
    /\.\.%2[Ff]/,
    /<script/i,
    /javascript:/i,
    /;\s*(rm|curl|wget|bash|sh|nc|ncat)\s/i,
    /\/etc\/passwd/i,
    /\/proc\/self/i,
    /wp-admin/i,
    /phpMyAdmin/i,
    /\.env$/i,
    /\.git\//i
  ];

  var combined = path + query + body;

  for (var i = 0; i < badPatterns.length; i++) {
    if (badPatterns[i].test(combined)) {
      var ip = (req.headers['x-forwarded-for']
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip) || 'unknown';

      console.warn(
        '[Security] Suspicious request blocked | IP:', ip,
        '| Pattern:', badPatterns[i].toString().slice(0, 40),
        '| Path:', path.slice(0, 80)
      );

      try {
        var AuditLog = require('../models/AuditLog.model');
        AuditLog.create({
          action:    'suspicious_request_blocked',
          actorType: 'anonymous',
          ip:        ip,
          userAgent: (req.headers['user-agent'] || '').slice(0, 200),
          method:    req.method,
          path:      path.slice(0, 200),
          success:   false,
          message:   'Pattern: ' + badPatterns[i].toString().slice(0, 60)
        }).catch(function () {});
      } catch (e) {}

      return res.status(400).json({ success: false, message: 'Bad request.' });
    }
  }

  next();
}

/* ============================================
   BRUTE-FORCE PROTECTION
   In-memory per-IP tracker.
   Resets automatically via setInterval cleanup.
============================================ */
var _failedAttempts   = {};
var BLOCK_THRESHOLD   = 10;
var BLOCK_WINDOW_MS   = 15 * 60 * 1000;
var BLOCK_DURATION_MS = 30 * 60 * 1000;

function recordFailedAttempt(ip, action) {
  var key = ip + ':' + action;
  var now = Date.now();
  if (!_failedAttempts[key]) {
    _failedAttempts[key] = { count: 0, firstAt: now, blockedUntil: 0 };
  }
  var r = _failedAttempts[key];
  if (now - r.firstAt > BLOCK_WINDOW_MS) {
    r.count = 0; r.firstAt = now; r.blockedUntil = 0;
  }
  r.count++;
  if (r.count >= BLOCK_THRESHOLD) {
    r.blockedUntil = now + BLOCK_DURATION_MS;
    console.warn('[Security] IP blocked for brute force:', ip, '| action:', action);
  }
}

function isBlocked(ip, action) {
  var r = _failedAttempts[ip + ':' + action];
  return r && r.blockedUntil > Date.now();
}

function clearFailedAttempts(ip, action) {
  delete _failedAttempts[ip + ':' + action];
}

/* Clean old entries every hour to prevent memory leak */
setInterval(function () {
  var now = Date.now();
  Object.keys(_failedAttempts).forEach(function (k) {
    var r = _failedAttempts[k];
    if (r.blockedUntil < now && (now - r.firstAt) > BLOCK_WINDOW_MS * 2) {
      delete _failedAttempts[k];
    }
  });
}, 60 * 60 * 1000);

/* ============================================
   BRUTE-FORCE MIDDLEWARE FACTORY
============================================ */
function bruteForceGuard(action) {
  return function (req, res, next) {
    var ip = (req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip) || 'unknown';

    if (isBlocked(ip, action)) {
      console.warn('[Security] Brute-force block enforced | IP:', ip, '| action:', action);
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please try again in 30 minutes.',
        code:    'BRUTE_FORCE_BLOCKED'
      });
    }

    req._securityIp         = ip;
    req._securityAction     = action;
    req.recordFailedAttempt = function () { recordFailedAttempt(ip, action); };
    req.clearFailedAttempts = function () { clearFailedAttempts(ip, action); };

    next();
  };
}

/* ============================================
   HELMET CONFIG
   Tuned for Railway + Google OAuth + CDN assets.
============================================ */
function getHelmetConfig() {
  if (!helmet) { return null; }

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://accounts.google.com",
          "https://apis.google.com",
          "https://cdnjs.cloudflare.com"
        ],
        /* Allows onclick="..." inline event handlers */
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://accounts.google.com"
        ],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://accounts.google.com", "https://api.paystack.co"],
        frameSrc:   ["https://accounts.google.com"],
        objectSrc:  ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge:            31536000,
      includeSubDomains: true,
      preload:           true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
}

/* ============================================
   MAIN EXPORT — applySecurityMiddleware(app)
============================================ */
function applySecurityMiddleware(app) {
  var isProd = process.env.NODE_ENV === 'production';

  /* 1. Trust proxy for Railway (must be first) */
  app.set('trust proxy', 1);

  /* 2. Helmet HTTP headers */
  var helmetCfg = getHelmetConfig();
  if (helmetCfg) {
    app.use(helmetCfg);
    console.log('✅ Security: Helmet headers active');
  }

  /* 3. MongoDB injection sanitisation */
  if (mongoSanitize) {
    app.use(mongoSanitize({
      replaceWith: '_',
      onSanitizeRequest: function (req) {
        console.warn('[Security] MongoDB injection attempt sanitised | path:', req.path);
      }
    }));
    console.log('✅ Security: MongoDB sanitisation active');
  }

  /* 4. XSS sanitisation (inline, no external package) */
  app.use(xssSanitizer);
  console.log('✅ Security: XSS sanitisation active');

  /* 5. Suspicious request detector */
  app.use(suspiciousRequestGuard);
  console.log('✅ Security: Suspicious request guard active');

  /* 6. Rate limiting */
  if (rateLimit) {
    app.use('/api/',
      makeLimit(15, 300,  'Too many requests. Please slow down.'));
    app.use('/api/auth/',
      makeLimit(15, 30,   'Too many authentication attempts. Please wait 15 minutes.'));
    app.use('/api/institution/auth/',
      makeLimit(15, 20,   'Too many institution login attempts. Please wait 15 minutes.'));
    app.use('/api/institution/student-portal/portal/login',
      makeLimit(15, 10,   'Too many login attempts. Please wait 15 minutes.'));
    app.use('/api/institution/payment/webhook',
      makeLimit(1,  100,  'Webhook rate limit exceeded.'));
    app.use('/api/payment/webhook',
      makeLimit(1,  100,  'Webhook rate limit exceeded.'));
    app.use('/api/institution/student/submit',
      makeLimit(5,  10,   'Too many exam submissions. Please wait.'));
    console.log('✅ Security: Rate limiting active');
  }

  console.log(
    '✅ Security middleware stack applied (' +
    (isProd ? 'PRODUCTION' : 'DEVELOPMENT') + ' mode)'
  );
}

module.exports = {
  applySecurityMiddleware,
  bruteForceGuard,
  recordFailedAttempt,
  isBlocked,
  clearFailedAttempts
};