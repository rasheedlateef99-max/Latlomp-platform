'use strict';
const jwt          = require('jsonwebtoken');
const SchoolParent = require('../models/SchoolParent.model');

/* Token payload: { parentId } — intentionally separate from schoolUserId */
function signParentToken(parentId) {
  return jwt.sign(
    { parentId: parentId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function parentProtect(req, res, next) {
  try {
    var token = null;
    var auth  = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) { token = auth.split(' ')[1]; }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    /* Reject institution/platform tokens — parentId field required */
    if (!decoded.parentId) {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }
    var parent = await SchoolParent.findById(decoded.parentId);
    if (!parent) {
      return res.status(401).json({ success: false, message: 'Account not found.' });
    }
    if (!parent.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });
    }
    req.parent = parent;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

module.exports = { signParentToken, parentProtect };