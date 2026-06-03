/* ============================================
   USER ROUTES — Phase 3 (MongoDB Version)
   ============================================ */

const express = require('express');
const router  = express.Router();
const User    = require('../models/User.model');
const Result  = require('../models/Result.model');
const { protect } = require('../middleware/auth.middleware');

/* ============================================
   GET /api/users/dashboard — Protected
   ============================================ */
router.get('/dashboard', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Get recent results
    const recentResults = await Result.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('examTitle scorePercent isPassed createdAt');

    return res.status(200).json({
      success: true,
      dashboard: {
        user: user.toSafeObject(),
        stats: user.stats,
        recentResults
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching dashboard' });
  }
});

/* ============================================
   GET /api/users/profile — Protected
   ============================================ */
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.status(200).json({ success: true, user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
});

/* ============================================
   PUT /api/users/profile — Protected
   Update profile
   ============================================ */
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, profile } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (profile) updates.profile = profile;

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true });
    return res.status(200).json({ success: true, message: 'Profile updated!', user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

module.exports = router;