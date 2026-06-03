/* ============================================
   LATLOMP PLATFORM — STORE ROUTES

   Public (no auth required):
     GET  /api/store/products           — browse
     GET  /api/store/products/:id       — single product
     GET  /api/store/categories         — all categories
     GET  /api/store/config             — Paystack public key

   Admin only:
     GET    /api/store/admin/products   — full list
     POST   /api/store/products         — create
     PUT    /api/store/products/:id     — update
     DELETE /api/store/products/:id     — delete
     POST   /api/store/upload-image     — image upload
============================================ */

const express  = require('express');
const router   = express.Router();
const Product  = require('../models/Product.model');

/*
  Import from auth.middleware — same file as exam.routes
  and teacher.routes use. No separate admin.middleware needed.
*/
const { protect, adminOnly } = require('../middleware/auth.middleware');

/* ---- Cloudinary setup (optional) ---- */
var cloudinary = null;
var upload     = null;

function initCloudinary() {
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY    &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    try {
      cloudinary = require('cloudinary').v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
      });

      var multerStorage = require('multer-storage-cloudinary');
      var multer        = require('multer');

      var storage = new multerStorage.CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
          folder:          'latlomp-products',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation:  [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }]
        }
      });

      upload = multer({
        storage: storage,
        limits:  { fileSize: 5 * 1024 * 1024 } /* 5MB */
      });

      console.log('✅ Cloudinary configured for product images');
    } catch (err) {
      console.warn('⚠️  Cloudinary packages not installed:', err.message);
      cloudinary = null;
      upload     = null;
    }
  } else {
    console.log('ℹ️  Cloudinary not configured — products will use image URLs');
  }
}

initCloudinary();

/* ============================================
   PUBLIC ROUTES — no auth needed
============================================ */

/* GET /api/store/config — Paystack public key */
router.get('/config', function(req, res) {
  return res.status(200).json({
    success:   true,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || ''
  });
});

/* GET /api/store/categories */
router.get('/categories', async function(req, res) {
  try {
    var cats = await Product.distinct('category', { isActive: true });
    return res.status(200).json({
      success:    true,
      categories: cats.filter(Boolean).sort()
    });
  } catch (err) {
    return res.status(500).json({ success: false, categories: [] });
  }
});

/* GET /api/store/products */
router.get('/products', async function(req, res) {
  try {
    var filter = { isActive: true };

    if (req.query.category && req.query.category !== 'all') {
      filter.category = req.query.category;
    }

    if (req.query.search) {
      /* Text search if index exists, fallback to regex */
      try {
        filter.$text = { $search: req.query.search };
      } catch (e) {
        filter.name = { $regex: req.query.search, $options: 'i' };
      }
    }

    var sort  = req.query.sort === 'price_asc'  ? { price: 1 }
              : req.query.sort === 'price_desc' ? { price: -1 }
              : req.query.sort === 'newest'     ? { createdAt: -1 }
              : { isFeatured: -1, createdAt: -1 };

    var limit = Math.min(parseInt(req.query.limit) || 50, 100);

    var products = await Product.find(filter)
      .sort(sort)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success:  true,
      products: products,
      total:    products.length
    });

  } catch (err) {
    console.error('GET /store/products error:', err.message);
    return res.status(500).json({
      success:  false,
      message:  'Failed to load products.',
      products: []
    });
  }
});

/* GET /api/store/products/:id */
router.get('/products/:id', async function(req, res) {
  try {
    var product = await Product.findOne({
      _id:      req.params.id,
      isActive: true
    }).lean();

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.status(200).json({ success: true, product: product });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load product.' });
  }
});

/* ============================================
   ADMIN ROUTES — protect + adminOnly
============================================ */

/* GET /api/store/admin/products */
router.get('/admin/products', protect, adminOnly, async function(req, res) {
  try {
    var products = await Product.find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success:  true,
      products: products,
      total:    products.length
    });

  } catch (err) {
    console.error('GET /store/admin/products error:', err.message);
    return res.status(500).json({
      success:  false,
      message:  'Failed to load products.',
      products: []
    });
  }
});

/* POST /api/store/products */
router.post('/products', protect, adminOnly, async function(req, res) {
  try {
    var body = req.body;

    if (!body.name || body.name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Product name is required.' });
    }

    var price = parseFloat(body.price);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ success: false, message: 'A valid price is required.' });
    }

    var product = await Product.create({
      name:        body.name.trim(),
      description: (body.description || '').trim(),
      category:    (body.category    || 'General').trim(),
      price:       price,
      stock:       parseInt(body.stock) || 0,
      image:       (body.image || '').trim(),
      imagePublicId: (body.imagePublicId || '').trim(),
      tags:        Array.isArray(body.tags)
                     ? body.tags
                     : (body.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean),
      isActive:    body.isActive   !== false && body.isActive   !== 'false',
      isFeatured:  body.isFeatured === true   || body.isFeatured === 'true',
      createdBy:   req.user._id
    });

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: product
    });

  } catch (err) {
    console.error('POST /store/products error:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A product with this slug already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Failed to create product: ' + err.message });
  }
});

/* PUT /api/store/products/:id */
router.put('/products/:id', protect, adminOnly, async function(req, res) {
  try {
    var body    = req.body;
    var updates = {};

    if (body.name        !== undefined) updates.name        = body.name.trim();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.category    !== undefined) updates.category    = body.category.trim();
    if (body.price       !== undefined) updates.price       = parseFloat(body.price);
    if (body.stock       !== undefined) updates.stock       = parseInt(body.stock) || 0;
    if (body.image       !== undefined) updates.image       = body.image.trim();
    if (body.imagePublicId !== undefined) updates.imagePublicId = body.imagePublicId.trim();
    if (body.isActive    !== undefined) updates.isActive    = body.isActive !== false && body.isActive !== 'false';
    if (body.isFeatured  !== undefined) updates.isFeatured  = body.isFeatured === true || body.isFeatured === 'true';
    if (body.tags        !== undefined) {
      updates.tags = Array.isArray(body.tags)
        ? body.tags
        : (body.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    }

    var product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully.',
      product: product
    });

  } catch (err) {
    console.error('PUT /store/products/:id error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

/* DELETE /api/store/products/:id */
router.delete('/products/:id', protect, adminOnly, async function(req, res) {
  try {
    var product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    /* Delete Cloudinary image if configured */
    if (cloudinary && product.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(product.imagePublicId);
      } catch (cloudErr) {
        console.warn('Cloudinary delete failed:', cloudErr.message);
      }
    }

    await Product.findByIdAndDelete(req.params.id);

    return res.status(200).json({ success: true, message: 'Product deleted.' });

  } catch (err) {
    console.error('DELETE /store/products/:id error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
});

/* POST /api/store/upload-image */
router.post('/upload-image', protect, adminOnly, async function(req, res) {

  if (upload) {
    /* Cloudinary configured — use multer */
    upload.single('image')(req, res, function(err) {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided.' });
      }
      return res.status(200).json({
        success:  true,
        message:  'Image uploaded.',
        imageUrl: req.file.path,
        publicId: req.file.filename
      });
    });
    return;
  }

  /* No Cloudinary — accept direct URL */
  var imageUrl = (req.body.imageUrl || '').trim();

  if (!imageUrl) {
    return res.status(400).json({
      success:            false,
      cloudinaryRequired: true,
      message:            'No Cloudinary configured. Paste an image URL in the Image URL field instead.'
    });
  }

  return res.status(200).json({
    success:  true,
    message:  'Image URL accepted.',
    imageUrl: imageUrl,
    publicId: ''
  });
});

module.exports = router;