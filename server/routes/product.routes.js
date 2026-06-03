/* ============================================
   PRODUCT ROUTES — Phase 3 (MongoDB Version)
   ============================================ */

const express  = require('express');
const router   = express.Router();
const Product  = require('../models/Product.model');
const { protect, adminOnly } = require('../middleware/auth.middleware');

/* ============================================
   GET /api/products — All active products
   ============================================ */
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;

    const products = await Product.find(filter).sort({ isFeatured: -1, createdAt: -1 });
    return res.status(200).json({ success: true, count: products.length, products });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

/* ============================================
   GET /api/products/:id — Single product
   ============================================ */
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({ success: true, product });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

/* ============================================
   POST /api/products — Admin: Create product
   ============================================ */
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, createdBy: req.user.id });
    return res.status(201).json({ success: true, message: 'Product created!', product });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(', ') });
    }
    return res.status(500).json({ success: false, message: 'Error creating product' });
  }
});

module.exports = router;