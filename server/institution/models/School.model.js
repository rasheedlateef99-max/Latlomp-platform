/* ============================================
   LATLOMP INSTITUTION — SCHOOL MODEL
   
   Core tenant record. Every other model
   references schoolId for tenant isolation.
============================================ */
const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    /* ---- Identity ---- */
    name:       { type: String, required: true, trim: true },
    slug:       { type: String, unique: true, lowercase: true, trim: true },
    logo:       { type: String, default: '' },
    motto:      { type: String, default: '' },

    /* ---- Contact ---- */
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:      { type: String, default: '' },
    address:    { type: String, default: '' },
    state:      { type: String, default: '' },
    country:    { type: String, default: 'Nigeria' },
    website:    { type: String, default: '' },

    /* ---- Profile ---- */
    type: {
      type:    String,
      enum:    ['primary', 'secondary', 'tertiary', 'vocational', 'other'],
      default: 'secondary'
    },
    principalName:  { type: String, default: '' },
    totalStudents:  { type: Number, default: 0 },
    totalTeachers:  { type: Number, default: 0 },

    /* ---- Branding ---- */
    primaryColor:   { type: String, default: '#6c63ff' },
    secondaryColor: { type: String, default: '#43e97b' },

    /* ---- Subscription status ---- */
    status: {
      type:    String,
      enum:    ['pending_setup', 'trial', 'active', 'expired', 'suspended'],
      default: 'pending_setup'
    },

    subscriptionPlan: {
      type:    String,
      enum:    ['trial', 'monthly', 'quarterly', 'biannual', 'annual', 'none'],
      default: 'none'
    },

    subscriptionExpiry:  { type: Date, default: null },
    trialUsed:           { type: Boolean, default: false },
    trialStartDate:      { type: Date, default: null },

    /* ---- Settings ---- */
    settings: {
      allowStudentSelfRegister: { type: Boolean, default: false },
      examResultsAutoRelease:   { type: Boolean, default: false },
      allowLateSubmission:      { type: Boolean, default: false },
      maxExamsPerDay:           { type: Number, default: 5 },
      timezone:                 { type: String, default: 'Africa/Lagos' }
    },

    /* ---- Ownership ---- */
    /*
      ✅ FIX: required removed.

      ownerId was designed to link a school to a main platform
      User account. However, institution admins register via
      Google Sign-In directly — they become a SchoolUser, not
      a main platform User. platformUserId is never available
      during institution Google registration, so this field
      was always null, crashing school creation.

      ownerGoogleId stores the Google sub (permanent unique ID)
      so we can always identify the original school owner even
      without a main platform User account.
    */
    ownerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      default:  null        /* ✅ optional — not required */
    },

    /* ✅ ADDED: stores Google sub as permanent owner identifier */
    ownerGoogleId: {
      type:    String,
      default: ''
    },

    /* ✅ ADDED: stores owner email for admin lookup */
    ownerEmail: {
      type:    String,
      default: '',
      lowercase: true,
      trim: true
    },

    /* ---- Metadata ---- */
    isVerified:      { type: Boolean, default: false },
    isSuspended:     { type: Boolean, default: false },
    suspendReason:   { type: String, default: '' },
    onboardingDone:  { type: Boolean, default: false },
    licenseKey:      { type: String, default: '', unique: true, sparse: true }
  },
  { timestamps: true }
);

/* Indexes */
schoolSchema.index({ email: 1 });
schoolSchema.index({ slug: 1 });
schoolSchema.index({ status: 1 });
schoolSchema.index({ subscriptionExpiry: 1 });
schoolSchema.index({ ownerGoogleId: 1 });

/* Generate slug from name */
schoolSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

/* Generate license key */
schoolSchema.pre('save', function(next) {
  if (!this.licenseKey) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var key   = 'SCH-';
    for (var i = 0; i < 16; i++) {
      if (i === 4 || i === 8 || i === 12) key += '-';
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.licenseKey = key;
  }
  next();
});

/* Virtual: is subscription currently valid */
schoolSchema.virtual('isSubscriptionActive').get(function() {
  if (this.isSuspended) return false;
  if (this.status === 'active' || this.status === 'trial') {
    if (!this.subscriptionExpiry) return false;
    return new Date() < new Date(this.subscriptionExpiry);
  }
  return false;
});

schoolSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('School', schoolSchema);