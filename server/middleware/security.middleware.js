/* ============================================
   LATLOMP PLATFORM — SECURITY MIDDLEWARE
   
   Exports: applySecurityMiddleware(app)
   Called once from server.js before routes.
   
   Includes:
   1. Helmet — HTTP security headers
   2. Rate limiting — per IP, per route group
   3. MongoDB injection sanitisation
   4. XSS input sanitisation
   5. Suspicious request detector
   6. Brute-force protection
============================================ */

let helmet, rateLimit, mongoSanitize, xssClean;

try { helmet        = require('helmet');                   } catch (e) { console.warn('[Security] helmet not installed.'); }
try { rateLimit     = require('express-rate-limit');       } catch (e) { console.warn('[Security] express-rate-limit not installed.'); }
try { mongoSanitize = require('express-mongo-sanitize');   } catch (e) { console.warn('[Security] express-mongo-sanitize not installed.'); }
try { xssClean      = require('xss-clean');                } catch (e) { console.warn('[Security] xss-clean not installed.'); }

/* ============================================
   RATE LIMIT FACTORY
   
   ✅ FIX: No custom keyGenerator.
   express-rate-limit v7 requires the ipKeyGenerator()
   helper if you manually access req.ip in keyGenerator.
   With app.set('trust proxy', 1) set in server.js, the
   default behaviour already handles IPv4/IPv6 correctly
   and extracts the real IP from x-forwarded-for.
============================================ */
function makeLimit(windowMinutes, maxRequests, message) {
  if (!rateLimit) return function(req, res, next) { next(); };

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
    skip: function(req) {
      /* Never rate-limit health checks */
      return req.path === '/api/health';
    }
    /* No custom keyGenerator — default uses req.ip correctly */
  });
}

/* ============================================
   SUSPICIOUS REQUEST DETECTOR
============================================ */
function suspiciousRequestGuard(req, res, next) {
  var path  = req.path  || '';
  var query = JSON.stringify(req.query) || '';
  var body  = '';

  try { body = JSON.stringify(req.body) || ''; } catch (e) {}

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

      /* Log to audit (non-blocking) */
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
        }).catch(function() {});
      } catch (e) {}

      return res.status(400).json({ success: false, message: 'Bad request.' });
    }
  }

  next();
}

/* ============================================
   BRUTE-FORCE PROTECTION
   In-memory per-IP tracker.
============================================ */
var _failedAttempts   = {};
var BLOCK_THRESHOLD   = 10;
var BLOCK_WINDOW_MS   = 15 * 60 * 1000;
var BLOCK_DURATION_MS = 30 * 60 * 1000;

function recordFailedAttempt(ip, action) {
  var key = ip + ':' + action;
  var now = Date.now();
  if (!_failedAttempts[key]) _failedAttempts[key] = { count: 0, firstAt: now, blockedUntil: 0 };
  var r = _failedAttempts[key];
  if (now - r.firstAt > BLOCK_WINDOW_MS) { r.count = 0; r.firstAt = now; r.blockedUntil = 0; }
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

/* Clean old entries every hour */
setInterval(function() {
  var now = Date.now();
  Object.keys(_failedAttempts).forEach(function(k) {
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
  return function(req, res, next) {
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
    req.recordFailedAttempt = function() { recordFailedAttempt(ip, action); };
    req.clearFailedAttempts = function() { clearFailedAttempts(ip, action); };

    next();
  };
}

/* ============================================
   HELMET CONFIG
   Tuned for Railway + Google OAuth + Chart.js CDN
============================================ */
function getHelmetConfig() {
  if (!helmet) return null;

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        /* Allows <script> blocks and external scripts */
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://accounts.google.com",
          "https://apis.google.com",
          "https://cdnjs.cloudflare.com"
        ],

        /* ✅ THE FIX — this was missing.
           Helmet defaults script-src-attr to 'none' which
           blocks ALL onclick="..." attributes on every element.
           Adding 'unsafe-inline' here restores onclick behaviour
           across admin, teacher, and every other page. */
        scriptSrcAttr: ["'unsafe-inline'"],

        /* ✅ Added accounts.google.com — fixes GSI stylesheet
           warning visible in all three console outputs */
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

  /* 1. Helmet */
  var helmetCfg = getHelmetConfig();
  if (helmetCfg) { app.use(helmetCfg); console.log('✅ Security: Helmet headers active'); }

  /* 2. Trust proxy for Railway */
  app.set('trust proxy', 1);

  /* 3. MongoDB injection sanitisation */
  if (mongoSanitize) {
    app.use(mongoSanitize({
      replaceWith: '_',
      onSanitizeRequest: function(req) {
        console.warn('[Security] MongoDB injection attempt sanitised | path:', req.path);
      }
    }));
    console.log('✅ Security: MongoDB sanitisation active');
  }

  /* 4. XSS cleaning */
  if (xssClean) {
    app.use(xssClean());
    console.log('✅ Security: XSS cleaning active');
  }

  /* 5. Suspicious request detector */
  app.use(suspiciousRequestGuard);
  console.log('✅ Security: Suspicious request guard active');

  /* ---- RATE LIMITS ---- */
  if (rateLimit) {
    app.use('/api/',                              makeLimit(15, 300,  'Too many requests. Please slow down.'));
    app.use('/api/auth/',                         makeLimit(15, 30,   'Too many authentication attempts. Please wait 15 minutes.'));
    app.use('/api/institution/auth/',             makeLimit(15, 20,   'Too many institution login attempts. Please wait 15 minutes.'));
    app.use('/api/institution/payment/webhook',   makeLimit(1,  100,  'Webhook rate limit exceeded.'));
    app.use('/api/payment/webhook',               makeLimit(1,  100,  'Webhook rate limit exceeded.'));
    app.use('/api/institution/student/submit',    makeLimit(5,  10,   'Too many exam submissions. Please wait.'));
    console.log('✅ Security: Rate limiting active');
  }

  console.log('✅ Security middleware stack applied (' + (isProd ? 'PRODUCTION' : 'DEVELOPMENT') + ' mode)');
}

module.exports = {
  applySecurityMiddleware,
  bruteForceGuard,
  recordFailedAttempt,
  isBlocked,
  clearFailedAttempts
};