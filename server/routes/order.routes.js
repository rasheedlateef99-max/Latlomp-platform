/* ============================================
   LATLOMP PLATFORM — ORDER ROUTES
   ============================================

   POST /api/orders/checkout     → Place a new order
   GET  /api/orders/my-orders    → Get user's order history
   GET  /api/orders/:id          → Get one order details
   GET  /api/orders/admin/all    → Admin: see all orders
   ============================================ */

const express  = require('express');
const router   = express.Router();
const Order    = require('../models/Order.model');
const Product  = require('../models/Product.model');
const { protect } = require('../middleware/auth.middleware');

/* ============================================
   POST /api/orders/checkout
   Protected — must be logged in to buy

   Body: {
     items: [
       { productId: "...", quantity: 1 },
       ...
     ],
     customerEmail: "buyer@email.com",
     customerName:  "Emeka Okafor"
   }
   ============================================ */
router.post('/checkout', protect, async (req, res) => {
  try {
    const { items, customerEmail, customerName } = req.body;

    // Validate
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your cart is empty. Please add items before checking out.'
      });
    }

    // Fetch all products from database to get current prices
    // (We never trust prices sent from the browser — always use database prices)
    const productIds = items.map(item => item.productId);
    const products   = await Product.find({
      _id:      { $in: productIds },
      isActive: true
    });

    if (products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'None of the items in your cart are available.'
      });
    }

    // Build order items with real prices from database
    let totalAmount = 0;
    const orderItems = [];

    for (const cartItem of items) {
      const product = products.find(
        p => p._id.toString() === cartItem.productId
      );

      if (!product) {
        // Skip items that no longer exist
        continue;
      }

      const quantity = parseInt(cartItem.quantity) || 1;
      const price    = product.price;

      orderItems.push({
        productId:   product._id,
        productName: product.name,
        price,
        quantity
      });

      totalAmount += price * quantity;
    }

    if (orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Could not process your cart items. Please refresh and try again.'
      });
    }

    // Create the order in the database
    const order = await Order.create({
      userId:        req.user.id,
      items:         orderItems,
      totalAmount,
      status:        'completed',   // Digital products deliver instantly
      paymentMethod: 'manual',      // Real payment (Paystack/Flutterwave) in Phase 7
      paidAt:        new Date(),
      customerEmail: customerEmail || req.user.email || '',
      customerName:  customerName  || req.user.name  || ''
    });

    // Update sales count for each product
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { totalSales: item.quantity }
      });
    }

    console.log(`✅ Order placed by ${req.user.id}: ₦${totalAmount.toLocaleString()} (${orderItems.length} items)`);

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully! Thank you for your purchase.',
      order: {
        id:          order._id,
        items:       orderItems,
        totalAmount,
        status:      order.status,
        paidAt:      order.paidAt,
        createdAt:   order.createdAt
      }
    });

  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing your order. Please try again.'
    });
  }
});

/* ============================================
   GET /api/orders/my-orders
   Protected — get logged-in user's order history
   ============================================ */
router.get('/my-orders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching your orders.'
    });
  }
});

/* ============================================
   GET /api/orders/:id
   Protected — get one specific order
   (only the owner can see their own order)
   ============================================ */
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.'
      });
    }

    // Make sure the logged-in user owns this order
    if (order.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      });
    }

    return res.status(200).json({
      success: true,
      order
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching order.'
    });
  }
});

/* ============================================
   GET /api/orders/admin/all
   Admin only — see all orders across all users
   ============================================ */
router.get('/admin/all', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.'
      });
    }

    const { page = 1, limit = 20 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await Order.countDocuments({});

    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'name email');

    return res.status(200).json({
      success: true,
      total,
      page:   parseInt(page),
      pages:  Math.ceil(total / parseInt(limit)),
      orders
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching orders.'
    });
  }
});

module.exports = router;