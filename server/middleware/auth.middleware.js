/* ============================================
   LATLOMP PLATFORM — AUTH MIDDLEWARE
   
   Exports:
     protect   — verify JWT + attach req.user (with role)
     adminOnly — check req.user.role === 'admin'
   
   Both are exported from this ONE file so that
   ALL existing routes (exam, teacher, store, etc.)
   can import from here without breaking.
============================================ */
const jwt  = require('jsonwebtoken');
const User = require('../models/User.model');

/* ============================================
   protect
   Verifies JWT and attaches full user to req.user
   including role — fixes the admin access denied bug
============================================ */
async function protect(req, res, next) {
  try {
    var token = null;

    /* Get token from Authorization: Bearer <token> */
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    /* Fallback: cookie (if you ever use cookies) */
    if (!token && req.cookies && req.cookies.latlomp_token) {
      token = req.cookies.latlomp_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Please log in.'
      });
    }

    /* Verify the token signature */
    var decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.'
      });
    }

    /* 
      Fetch the FULL user from DB.
      This is the key fix for the "admin access denied" bug:
      previously req.user only had { id } with no role.
      Now it has the complete user including role.
    */
    var user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found. Please log in again.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated. Contact support.'
      });
    }

    /* Attach full user object to request */
    req.user = {
      id:         user._id.toString(),
      _id:        user._id,
      name:       user.name,
      email:      user.email || null,
      phone:      user.phone || null,
      role:       user.role,
      isVerified: user.isVerified,
      isActive:   user.isActive
    };

    next();

  } catch (err) {
    console.error('protect middleware error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Authentication error. Please try again.'
    });
  }
}

/* ============================================
   adminOnly
   Must be used AFTER protect middleware.
   protect sets req.user.role from DB.
   This checks that role === 'admin'.
   
   Used by: exam.routes.js, teacher.routes.js,
            store.routes.js, and any future
            admin-only routes.
============================================ */
function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please log in.'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }

  next();
}

/*
  Export BOTH from this single file.
  This is the one-line fix that stops the server crash.
  exam.routes.js, teacher.routes.js, store.routes.js
  all import from here — all will work.
*/
module.exports = { protect, adminOnly };