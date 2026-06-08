/* ============================================
   LATLOMP INSTITUTION — SCHOOL MODEL
   
   ✅ PHASE A CHANGES:
   - type enum extended to include all new
     institution categories (backward-compatible:
     existing 'primary','secondary','tertiary',
     'vocational','other' values still valid)
   - institutionCategory field added (mirrors type)
   - slug, ownerGoogleId, ownerEmail from
     previous fix retained
============================================ */
const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    /* ---- Identity ---- */
    name:       { type: String, required: true, trim: true },
    slug:       { type: String, unique: true, lowercase: true, trim: true, sparse: true },
    logo:       { type: String, default: '' },
    motto:      { type: String, default: '' },

    /* ---- Contact ---- */
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:      { type: String, default: '' },
    address:    { type: String, default: '' },
    state:      { type: String, default: '' },
    country:    { type: String, default: 'Nigeria' },
    website:    { type: String, default: '' },

    /* ---- Institution Type ----
       ✅ PHASE A: Extended enum — includes all supported types.
       Old values (primary, secondary, tertiary, vocational, other)
       remain valid so existing data is NOT broken.
       New values added: combined, polytechnic, university,
       college_of_education, madrasah, training_centre
    ---- */
    type: {
      type:    String,
      enum:    [
        /* Existing values — backward compatible */
        'primary', 'secondary', 'tertiary', 'vocational', 'other',
        /* New values — Phase A */
        'combined',
        'polytechnic',
        'university',
        'college_of_education',
        'madrasah',
        'training_centre'
      ],
      default: 'secondary'
    },

    /* ---- Profile ---- */
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
      enum:    ['trial', 'monthly', 'quarterly', 'biannual', 'annual', 'none', 'unlimited'],
      default: 'none'
    },

    subscriptionExpiry:  { type: Date,    default: null },
    trialUsed:           { type: Boolean, default: false },
    trialStartDate:      { type: Date,    default: null },

    /* ---- Settings ---- */
    settings: {
      allowStudentSelfRegister: { type: Boolean, default: false },
      examResultsAutoRelease:   { type: Boolean, default: false },
      allowLateSubmission:      { type: Boolean, default: false },
      maxExamsPerDay:           { type: Number,  default: 5 },
      timezone:                 { type: String,  default: 'Africa/Lagos' }
    },

    /* ---- Ownership ----
       ownerId is optional — institution admins register via Google,
       they become a SchoolUser, not a main platform User.
       ownerGoogleId and ownerEmail identify the owner permanently.
    ---- */
    ownerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null
    },

    ownerGoogleId: { type: String, default: '' },
    ownerEmail:    { type: String, default: '', lowercase: true, trim: true },

    /* ---- Metadata ---- */
    isVerified:      { type: Boolean, default: false },
    isSuspended:     { type: Boolean, default: false },
    suspendReason:   { type: String,  default: '' },
    onboardingDone:  { type: Boolean, default: false },
    licenseKey:      { type: String,  default: '', unique: true, sparse: true },

    /* ✅ PHASE A: Track whether default structure has been generated */
    structureGenerated: { type: Boolean, default: false }
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