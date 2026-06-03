/* ============================================
   LATLOMP PLATFORM — ORDER MODEL
   Updated with Paystack payment fields
============================================ */

const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name:       { type: String, required: true },
  price:      { type: Number, required: true },
  quantity:   { type: Number, default: 1 },
  totalPrice: { type: Number, required: true }
});

const orderSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true
    },

    items:       [orderItemSchema],
    totalAmount: { type: Number, required: true },

    /* ---- Payment fields ---- */
    paymentRef: {
      type:   String,
      unique: true,
      sparse: true
    },

    paymentStatus: {
      type:    String,
      enum:    ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },

    paidAt:           { type: Date,   default: null },
    paidAmount:       { type: Number, default: null },
    paystackChannel:  { type: String, default: null },
    paystackCardType: { type: String, default: null },

    /* ---- Order status ---- */
    status: {
      type:    String,
      enum:    ['pending', 'confirmed', 'processing', 'delivered', 'cancelled'],
      default: 'pending'
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Order', orderSchema);