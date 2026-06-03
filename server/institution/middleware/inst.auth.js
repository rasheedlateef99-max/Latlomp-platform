/* ============================================
   LATLOMP INSTITUTION — AUTH MIDDLEWARE
   
   Separate from main platform auth.
   Uses same JWT secret but separate role checks.
============================================ */
const jwt       = require('jsonwebtoken');
const SchoolUser = require('../models/SchoolUser.model');
const School    = require('../models/School.model');

/* Verify JWT and attach school user to req */
async function instProtect(req, res, next) {
  try {
    var token = null;

    var authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }

    var decoded = jwt.verify(token, process.env.JWT_SECRET);

    /* Must be a school user token */
    if (!decoded.schoolUserId) {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }

    var user = await SchoolUser.findById(decoded.schoolUserId).populate('schoolId');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });
    }

    req.schoolUser = user;
    req.schoolId   = user.schoolId._id || user.schoolId;
    next();

  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

/* School admin only */
function schoolAdminOnly(req, res, next) {
  if (!req.schoolUser || req.schoolUser.role !== 'school_admin') {
    return res.status(403).json({ success: false, message: 'School admin access required.' });
  }
  next();
}

/* Teacher or school admin */
function teacherOrAdmin(req, res, next) {
  var allowed = ['school_admin', 'teacher', 'vice_principal'];
  if (!req.schoolUser || !allowed.includes(req.schoolUser.role)) {
    return res.status(403).json({ success: false, message: 'Teacher access required.' });
  }
  next();
}

/* Sign token for school user */
function signInstToken(schoolUserId, schoolId) {
  return jwt.sign(
    { schoolUserId: schoolUserId, schoolId: schoolId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { instProtect, schoolAdminOnly, teacherOrAdmin, signInstToken };