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
/* ============================================
   adminOrPlatformStaff(requiredPermission)
   
   Factory that returns middleware accepting EITHER:
     (a) Root admin token  → decoded.id → user.role === 'admin'
     (b) Platform staff token → decoded.platformStaffId →
         staff.permissions.includes(requiredPermission)
         AND staff.status === 'active'
   
   Used by exam.routes.js and store.routes.js to allow
   platform staff with the correct permission to manage
   CBT and Store modules through the same admin interface.
   
   Sets req.user in both cases so existing route handlers
   that read req.user.id work without modification.
   
   Usage:
     router.get('/admin/xyz', adminOrPlatformStaff('cbt'), handler)
     router.post('/admin/xyz', adminOrPlatformStaff('store'), handler)
============================================ */
function adminOrPlatformStaff(requiredPermission) {
  return async function (req, res, next) {
    try {
      /* Extract token */
      var token = null;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
      }
      if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized. Please log in.' });
      }

      /* Verify JWT */
      var decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtErr) {
        return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
      }

      /* PATH A: Root Admin (main platform token — has decoded.id, no platformStaffId) */
      var mainUserId = decoded.userId || decoded.id || null;
      if (mainUserId && !decoded.platformStaffId) {
        var user = await User.findById(mainUserId).select('role email name isActive');
        if (!user || user.role !== 'admin' || !user.isActive) {
          return res.status(403).json({ success: false, message: 'Admin access required.' });
        }
        req.user = {
          id:    user._id.toString(),
          _id:   user._id,
          name:  user.name,
          email: user.email,
          role:  user.role
        };
        req.isRoot = true;
        return next();
      }

      /* PATH B: Platform Staff token (has decoded.platformStaffId) */
      if (decoded.platformStaffId) {
        /* Lazy-require prevents circular dependency */
        var PlatformStaff = require('../platform/models/PlatformStaff.model');
        var staff = await PlatformStaff.findById(decoded.platformStaffId)
          .select('name email platformRole permissions status isActive');

        if (!staff || staff.status !== 'active' || !staff.isActive) {
          return res.status(403).json({ success: false, message: 'Platform staff account is not active.' });
        }

        var staffPerms = (staff.permissions && staff.permissions.length > 0)
          ? staff.permissions : [];

        if (!staffPerms.includes(requiredPermission)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have ' + requiredPermission + ' permission to perform this action.'
          });
        }

        /* Set req.user so existing handlers that read req.user.id work unchanged */
        req.user = {
          id:    staff._id.toString(),
          _id:   staff._id,
          name:  staff.name,
          email: staff.email,
          role:  'platform_staff'
        };
        req.platformStaff  = staff;
        req.isPlatformStaff = true;
        return next();
      }

      /* Neither path matched */
      return res.status(401).json({ success: false, message: 'Invalid token type.' });

    } catch (err) {
      console.error('adminOrPlatformStaff error:', err.message);
      return res.status(500).json({ success: false, message: 'Authentication error.' });
    }
  };
}

module.exports = { protect, adminOnly, adminOrPlatformStaff };