/* ============================================
   LATLOMP PLATFORM — PAYMENT ROUTES
   Paystack integration
   
   POST /api/payment/initialize  → Start payment
   POST /api/payment/webhook     → Paystack callback
   GET  /api/payment/verify/:ref → Verify after redirect
============================================ */

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const crypto   = require('crypto');
const Order    = require('../models/Order.model');
const Product  = require('../models/Product.model');
const User     = require('../models/User.model');
const { protect } = require('../middleware/auth.middleware');
const {
  sendVerificationEmail,
  sendPasswordResetEmail
} = require('../utils/emailService');

/* ---- Helper: get Paystack secret ---- */
function paystackSecret() {
  return process.env.PAYSTACK_SECRET_KEY || '';
}

/* ---- Helper: Paystack headers ---- */
function paystackHeaders() {
  return {
    Authorization: 'Bearer ' + paystackSecret(),
    'Content-Type': 'application/json'
  };
}

/* ============================================
   POST /api/payment/initialize
   
   Called when user clicks "Pay Now"
   Creates a PENDING order and returns
   Paystack payment URL to redirect user to.
   
   User is only charged when they complete
   payment on Paystack's page.
============================================ */
router.post('/initialize', protect, async function(req, res) {
  try {
    var items    = req.body.items;    /* Array of { productId, quantity } */
    var email    = req.body.email;    /* User email for Paystack */

    /* Validate */
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No items in cart.'
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required for payment.'
      });
    }

    /* ---- Build order items and calculate total ---- */
    var orderItems   = [];
    var totalAmount  = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      var product = await Product.findById(item.productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found: ' + item.productId
        });
      }

      if (!product.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Product is no longer available: ' + product.name
        });
      }

      var quantity  = parseInt(item.quantity) || 1;
      var itemTotal = product.price * quantity;

      orderItems.push({
        product:    product._id,
        name:       product.name,
        price:      product.price,
        quantity:   quantity,
        totalPrice: itemTotal
      });

      totalAmount += itemTotal;
    }

    /* ---- Generate unique payment reference ---- */
    var reference = 'LATLOMP_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8).toUpperCase();

    /* ---- Create PENDING order in database ---- */
    /* Order is pending — NOT confirmed yet */
    /* It only becomes confirmed after webhook/verify */
    var order = await Order.create({
      user:          req.user.id,
      items:         orderItems,
      totalAmount:   totalAmount,
      paymentRef:    reference,
      paymentStatus: 'pending',
      status:        'pending'
    });

    console.log('Order created (pending): ' + order._id + ' ref: ' + reference);

    /* ---- Get APP_URL for callback ---- */
    var appUrl = (process.env.APP_URL || 'http://localhost:3000')
      .split(' ')[0].trim().replace(/\/$/, '');

    /* ---- Initialize payment with Paystack ---- */
    var paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email:        email,
        amount:       Math.round(totalAmount * 100), /* Paystack uses kobo (multiply by 100) */
        reference:    reference,
        callback_url: appUrl + '/order-confirm.html?ref=' + reference,
        metadata: {
          order_id:    order._id.toString(),
          user_id:     req.user.id.toString(),
          order_items: orderItems.length + ' item(s)'
        }
      },
      { headers: paystackHeaders() }
    );

    var paystackData = paystackRes.data;

    if (!paystackData.status) {
      /* Paystack rejected the request */
      await Order.findByIdAndDelete(order._id);
      return res.status(400).json({
        success: false,
        message: 'Payment initialization failed: ' + (paystackData.message || 'Unknown error')
      });
    }

    console.log('Paystack initialized: ' + reference);

    return res.status(200).json({
      success:      true,
      reference:    reference,
      orderId:      order._id,
      paymentUrl:   paystackData.data.authorization_url,
      accessCode:   paystackData.data.access_code,
      totalAmount:  totalAmount
    });

  } catch (error) {
    console.error('Payment initialize error:', error.message);
    if (error.response) {
      console.error('Paystack error:', error.response.data);
    }
    return res.status(500).json({
      success: false,
      message: 'Payment initialization failed. Please try again.'
    });
  }
});

/* ============================================
   GET /api/payment/verify/:reference
   
   Called after user returns from Paystack.
   Verifies the payment with Paystack API.
   Confirms order only if payment is verified.
============================================ */
router.get('/verify/:reference', protect, async function(req, res) {
  try {
    var reference = req.params.reference;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required.'
      });
    }

    /* ---- Find the order ---- */
    var order = await Order.findOne({ paymentRef: reference })
      .populate('items.product');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found for this reference.'
      });
    }

    /* ---- Already verified — return existing data ---- */
    if (order.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        order:   order
      });
    }

    /* ---- Verify with Paystack ---- */
    var verifyRes = await axios.get(
      'https://api.paystack.co/transaction/verify/' + reference,
      { headers: paystackHeaders() }
    );

    var verifyData = verifyRes.data;

    if (!verifyData.status || verifyData.data.status !== 'success') {
      /* Payment failed or not completed */
      await Order.findByIdAndUpdate(order._id, {
        paymentStatus: 'failed',
        status:        'cancelled'
      });

      return res.status(400).json({
        success:  false,
        failed:   true,
        message:  'Payment was not completed. Your order has been cancelled.',
        status:   verifyData.data ? verifyData.data.status : 'unknown'
      });
    }

    /* ---- Payment verified ✅ ---- */
    var paidAmount = verifyData.data.amount / 100; /* Convert from kobo back to naira */

    /* Update order to confirmed */
    var updatedOrder = await Order.findByIdAndUpdate(
      order._id,
      {
        paymentStatus:    'paid',
        status:           'confirmed',
        paidAt:           new Date(),
        paidAmount:       paidAmount,
        paystackChannel:  verifyData.data.channel,
        paystackCardType: verifyData.data.authorization ? verifyData.data.authorization.card_type : null
      },
      { new: true }
    ).populate('user items.product');

    console.log('Payment verified and order confirmed: ' + order._id);

    /* ---- Send confirmation email ---- */
    var user = await User.findById(order.user);
    if (user && user.email && !user.email.includes('@phone.latlomp.com')) {
      await sendOrderConfirmationEmail(user, updatedOrder, reference);
    }

    return res.status(200).json({
      success:    true,
      message:    'Payment verified! Your order is confirmed.',
      order:      updatedOrder,
      reference:  reference
    });

  } catch (error) {
    console.error('Payment verify error:', error.message);
    if (error.response) {
      console.error('Paystack verify error:', error.response.data);
    }
    return res.status(500).json({
      success: false,
      message: 'Payment verification failed. Please contact support with your reference: ' + req.params.reference
    });
  }
});

/* ============================================
   POST /api/payment/webhook
   
   Called by Paystack automatically after payment.
   This is the SECURE server-to-server verification.
   Paystack sends a signature we must validate.
   
   IMPORTANT: This route does NOT use protect middleware
   because Paystack calls it directly, not the user.
============================================ */
router.post('/webhook', async function(req, res) {
  try {
    /* ---- Validate Paystack signature ---- */
    var hash = crypto
      .createHmac('sha512', paystackSecret())
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('Webhook: Invalid Paystack signature — rejected');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    /* ---- Process the event ---- */
    var event = req.body;
    console.log('Webhook received: ' + event.event);

    if (event.event === 'charge.success') {
      var data      = event.data;
      var reference = data.reference;
      var amount    = data.amount / 100;

      /* Find the order */
      var order = await Order.findOne({ paymentRef: reference });

      if (!order) {
        console.warn('Webhook: Order not found for reference ' + reference);
        return res.status(200).json({ message: 'OK' }); /* Always return 200 to Paystack */
      }

      /* Skip if already processed */
      if (order.paymentStatus === 'paid') {
        return res.status(200).json({ message: 'Already processed' });
      }

      /* Confirm the order */
      var updatedOrder = await Order.findByIdAndUpdate(
        order._id,
        {
          paymentStatus:   'paid',
          status:          'confirmed',
          paidAt:          new Date(),
          paidAmount:      amount,
          paystackChannel: data.channel
        },
        { new: true }
      );

      console.log('Webhook: Order confirmed via webhook — ' + order._id);

      /* Send confirmation email */
      var user = await User.findById(order.user);
      if (user && user.email && !user.email.includes('@phone.latlomp.com')) {
        await sendOrderConfirmationEmail(user, updatedOrder, reference);
      }
    }

    /* Always return 200 to Paystack so it stops retrying */
    return res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(200).json({ message: 'OK' }); /* Still return 200 */
  }
});

/* ============================================
   GET /api/payment/order/:orderId
   Get a specific order by ID (must belong to user)
============================================ */
router.get('/order/:orderId', protect, async function(req, res) {
  try {
    var order = await Order.findOne({
      _id:  req.params.orderId,
      user: req.user.id
    }).populate('items.product');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.'
      });
    }

    return res.status(200).json({
      success: true,
      order:   order
    });

  } catch (error) {
    console.error('Get order error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ============================================
   GET /api/payment/my-orders
   Get all orders for the logged-in user
============================================ */
router.get('/my-orders', protect, async function(req, res) {
  try {
    var orders = await Order.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate('items.product');

    return res.status(200).json({
      success: true,
      count:   orders.length,
      orders:  orders
    });

  } catch (error) {
    console.error('My orders error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ============================================
   HELPER: Send order confirmation email
============================================ */
async function sendOrderConfirmationEmail(user, order, reference) {
  try {
    /* Only import if SendGrid is configured */
    if (process.env.EMAIL_ENABLED !== 'true' || !process.env.SENDGRID_API_KEY) {
      console.log('Order confirmation email (dev mode): ' + user.email);
      console.log('Order ID: ' + order._id);
      console.log('Reference: ' + reference);
      return;
    }

    var sgMail  = require('@sendgrid/mail');
    var fromName = process.env.EMAIL_FROM_NAME || 'LatLomp Platform';
    var fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    var itemsHtml = order.items.map(function(item) {
      return '<tr>' +
        '<td style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06); color:#a0a0c0; font-size:14px;">' +
          (item.name || 'Product') + ' × ' + item.quantity +
        '</td>' +
        '<td style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06); color:#fff; font-size:14px; text-align:right;">' +
          '₦' + (item.totalPrice || 0).toLocaleString() +
        '</td>' +
      '</tr>';
    }).join('');

    await sgMail.send({
      to:   user.email,
      from: { email: fromEmail, name: fromName },
      subject: '✅ Order Confirmed — ' + fromName,
      html: '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0f1a;font-family:Arial,sans-serif;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">' +
        '<tr><td align="center">' +
        '<table width="100%" style="max-width:520px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">' +
        '<tr><td style="background:linear-gradient(135deg,#43e97b,#38f9d7);padding:28px;text-align:center;">' +
          '<div style="font-size:36px;margin-bottom:8px;">🎉</div>' +
          '<h1 style="margin:0;font-size:20px;font-weight:800;color:#0f0f1a;">Order Confirmed!</h1>' +
          '<p style="margin:8px 0 0;font-size:13px;color:rgba(0,0,0,0.6);">Payment successful</p>' +
        '</td></tr>' +
        '<tr><td style="padding:28px;">' +
          '<p style="font-size:16px;font-weight:700;color:#fff;margin:0 0 8px;">Hello ' + user.name + '! 👋</p>' +
          '<p style="font-size:14px;color:#a0a0c0;margin:0 0 24px;">Your order has been confirmed and payment received.</p>' +
          '<div style="background:rgba(67,233,123,0.06);border:1px solid rgba(67,233,123,0.2);border-radius:10px;padding:16px;margin-bottom:20px;">' +
            '<div style="font-size:12px;color:#a0a0c0;margin-bottom:4px;">ORDER REFERENCE</div>' +
            '<div style="font-size:16px;font-weight:800;color:#43e97b;font-family:monospace;letter-spacing:1px;">' + reference + '</div>' +
          '</div>' +
          '<table width="100%" style="border-collapse:collapse;margin-bottom:20px;">' +
            itemsHtml +
            '<tr><td style="padding:12px 0;font-weight:700;color:#fff;font-size:15px;">Total Paid</td>' +
            '<td style="padding:12px 0;font-weight:900;color:#43e97b;font-size:18px;text-align:right;">₦' + (order.paidAmount || order.totalAmount || 0).toLocaleString() + '</td></tr>' +
          '</table>' +
          '<p style="font-size:13px;color:#a0a0c0;margin:0;">Your digital items are ready. Log in to your account to access them.</p>' +
        '</td></tr>' +
        '<tr><td style="background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);padding:16px;text-align:center;">' +
          '<p style="margin:0;font-size:12px;color:#6b6b8a;">© 2025 ' + fromName + ' · Built for Nigeria 🇳🇬</p>' +
        '</td></tr>' +
        '</table></td></tr></table></body></html>'
    });

    console.log('✅ Order confirmation email sent to ' + user.email);

  } catch (err) {
    console.error('Order email error:', err.message);
  }
}

/* ============================================
   GET /api/payment/config
   Returns Paystack public key safely.
   Public key is designed to be publicly visible.
============================================ */
router.get('/config', function(req, res) {
  return res.status(200).json({
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || ''
  });
});

module.exports = router;