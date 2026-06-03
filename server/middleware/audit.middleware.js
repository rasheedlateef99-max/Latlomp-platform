/* ============================================
   LATLOMP PLATFORM — AUDIT MIDDLEWARE
   
   Two exports:
   
   1. auditLog(action, resource, options)
      → Express middleware factory
      → Logs after response sends
   
   2. logAudit(data)
      → Direct async helper
      → Call from route handlers for precise logging
============================================ */
const AuditLog = require('../models/AuditLog.model');

/* ============================================
   Get real IP — handles proxies and Railway
============================================ */
function getIp(req) {
  return (
    req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown'
  );
}

/* ============================================
   Get user agent — truncated
============================================ */
function getUa(req) {
  var ua = req.headers['user-agent'] || '';
  return ua.slice(0, 200);
}

/* ============================================
   DIRECT LOG HELPER
   
   Usage inside a route handler:
   
   await logAudit({
     req,
     action:   'exam.published',
     resource: 'SchoolExam',
     resourceId: exam._id.toString(),
     success:  true,
     message:  'Exam published by teacher'
   });
============================================ */
async function logAudit(opts) {
  try {
    var req        = opts.req;
    var schoolUser = req && req.schoolUser;
    var user       = req && req.user;

    var entry = {
      action:     opts.action     || 'unknown',
      resource:   opts.resource   || '',
      resourceId: opts.resourceId || '',
      success:    opts.success    !== false,
      message:    opts.message    || '',
      meta:       opts.meta       || {}
    };

    /* Actor from institution schoolUser */
    if (schoolUser) {
      entry.actorId    = schoolUser._id;
      entry.actorEmail = schoolUser.email   || '';
      entry.actorRole  = schoolUser.role    || '';
      entry.actorType  = 'school_user';
      entry.schoolId   = req.schoolId       || null;
    }
    /* Actor from main platform user */
    else if (user) {
      entry.actorId    = user.id || user._id;
      entry.actorEmail = user.email || '';
      entry.actorRole  = user.role  || '';
      entry.actorType  = 'platform_user';
    }
    /* Anonymous */
    else {
      entry.actorType = opts.actorType || 'anonymous';
    }

    /* HTTP context */
    if (req) {
      entry.method    = req.method    || '';
      entry.path      = req.path      || '';
      entry.ip        = opts.ip       || getIp(req);
      entry.userAgent = getUa(req);
    }

    entry.statusCode = opts.statusCode || 0;

    /* ✅ Fire-and-forget — never block the response */
    AuditLog.create(entry).catch(function(e) {
      console.warn('[AuditLog] Write failed:', e.message);
    });

  } catch (e) {
    /* Audit failures must NEVER crash the app */
    console.warn('[AuditLog] logAudit error:', e.message);
  }
}

/* ============================================
   MIDDLEWARE FACTORY
   
   Usage:
   router.post('/publish',
     instProtect,
     auditLog('exam.publish.attempt', 'SchoolExam'),
     async (req, res) => { ... }
   );
   
   Logs automatically after response.
============================================ */
function auditLog(action, resource) {
  return function(req, res, next) {
    /* Intercept res.json to capture status after send */
    var originalJson = res.json.bind(res);

    res.json = function(body) {
      var success = res.statusCode >= 200 && res.statusCode < 400;

      logAudit({
        req,
        action,
        resource:    resource || '',
        resourceId:  (body && (body.id || (body.result && body.result.id))) || '',
        success,
        statusCode:  res.statusCode,
        message:     (body && body.message) || ''
      });

      return originalJson(body);
    };

    next();
  };
}

module.exports = { logAudit, auditLog, getIp };