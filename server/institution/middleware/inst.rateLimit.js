/* ============================================
   LATLOMP INSTITUTION — INSTITUTION-SPECIFIC
   RATE LIMITS
   
   Per-school rate limiting using schoolId
   as the key (not just IP).
   
   This prevents one school from hammering
   the API and affecting others.
============================================ */

let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch (e) {}

/* ============================================
   PER-SCHOOL RATE LIMIT FACTORY
============================================ */
function makeSchoolLimit(windowMinutes, maxRequests, message) {
  if (!rateLimit) return function(req, res, next) { next(); };

  return rateLimit({
    windowMs:        windowMinutes * 60 * 1000,
    max:             maxRequests,
    standardHeaders: true,
    legacyHeaders:   false,
    /* Key by schoolId instead of IP */
    keyGenerator: function(req) {
      var schoolId = req.schoolId ? req.schoolId.toString() : 'unknown';
      return 'school:' + schoolId + ':' + req.path.split('/')[1];
    },
    message: {
      success: false,
      message: message || 'School API rate limit exceeded. Please slow down.',
      code:    'SCHOOL_RATE_LIMITED'
    }
  });
}

/* ============================================
   RESULT RELEASE GUARD
   Prevent accidental mass-release spam
============================================ */
var releaseLimit = makeSchoolLimit(5, 10,
  'Too many result release requests in a short time. Please wait 5 minutes.'
);

/* ============================================
   INVITE LIMIT
   Max 20 invites per hour per school
============================================ */
var inviteLimit = makeSchoolLimit(60, 20,
  'Too many invitations sent this hour. Limit is 20 per hour.'
);

/* ============================================
   EXAM CREATION LIMIT
   Max 30 exams per hour per school
============================================ */
var examCreateLimit = makeSchoolLimit(60, 30,
  'Too many exams created this hour. Please wait before creating more.'
);

/* ============================================
   QUESTION ADD LIMIT
   Max 200 questions per hour per school
============================================ */
var questionAddLimit = makeSchoolLimit(60, 200,
  'Too many questions added this hour. Please wait before adding more.'
);

module.exports = {
  releaseLimit,
  inviteLimit,
  examCreateLimit,
  questionAddLimit
};