/* ============================================
   LATLOMP INSTITUTION — SUBSCRIPTION MODEL
   Tracks all subscription plans and history.
============================================ */
const mongoose = require('mongoose');

/* Pricing plan definition */
const planSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true },     /* e.g. "Annual Plan" */
    code:        { type: String, required: true, unique: true }, /* e.g. "annual" */
    price:       { type: Number, required: true },     /* in Naira */
    durationDays:{ type: Number, required: true },
    maxTeachers: { type: Number, default: 20 },
    maxStudents: { type: Number, default: 500 },
    maxExams:    { type: Number, default: -1 },        /* -1 = unlimited */
    features:    [String],
    isActive:    { type: Boolean, default: true },
    isPopular:   { type: Boolean, default: false },
    sortOrder:   { type: Number, default: 0 }
  },
  { timestamps: true }
);

/* Subscription transaction record */
const subscriptionSchema = new mongoose.Schema(
  {
    schoolId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'School',
      required: true
    },

    plan:       { type: String, required: true },      /* plan code */
    planName:   { type: String, required: true },
    amount:     { type: Number, required: true },
    currency:   { type: String, default: 'NGN' },

    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },

    status: {
      type:    String,
      enum:    ['pending', 'active', 'expired', 'cancelled', 'refunded'],
      default: 'pending'
    },

    paymentRef:      { type: String, default: '' },
    paymentChannel:  { type: String, default: '' },
    paidAt:          { type: Date, default: null },
    paidAmount:      { type: Number, default: 0 },

    isTrial:         { type: Boolean, default: false },
    activatedBy:     { type: String, default: 'payment' }, /* 'payment' | 'admin' */

    invoiceNumber:   { type: String, default: '' },
    notes:           { type: String, default: '' }
  },
  { timestamps: true }
);

subscriptionSchema.index({ schoolId: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });

module.exports = {
  SubscriptionPlan: mongoose.model('SubscriptionPlan', planSchema),
  Subscription:     mongoose.model('Subscription',     subscriptionSchema)
};