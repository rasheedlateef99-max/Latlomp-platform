/* ============================================
   LATLOMP INSTITUTION — SCHOOL MODEL

   ✅ PHASE A: type enum extended
   ✅ PHASE E: slugUpdatedAt field added
              Allows tracking when admin last
              changed their slug (for cooldown)
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

    /* ---- Institution Type ---- */
    type: {
      type:    String,
      enum:    [
        'primary', 'secondary', 'tertiary', 'vocational', 'other',
        'combined', 'polytechnic', 'university',
        'college_of_education', 'madrasah', 'training_centre'
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
    subscriptionExpiry: { type: Date,    default: null },
    trialUsed:          { type: Boolean, default: false },
    trialStartDate:     { type: Date,    default: null },

    /* ---- Settings ---- */
    settings: {
      allowStudentSelfRegister: { type: Boolean, default: false },
      examResultsAutoRelease:   { type: Boolean, default: false },
      allowLateSubmission:      { type: Boolean, default: false },
      maxExamsPerDay:           { type: Number,  default: 5 },
      timezone:                 { type: String,  default: 'Africa/Lagos' }
    },

    /* ---- Ownership ---- */
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
    structureGenerated: { type: Boolean, default: false },

    /* ✅ PHASE E: Track last manual slug change for cooldown enforcement */
    slugUpdatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

/* Indexes */
schoolSchema.index({ email:         1 });
schoolSchema.index({ slug:          1 });
schoolSchema.index({ status:        1 });
schoolSchema.index({ subscriptionExpiry: 1 });
schoolSchema.index({ ownerGoogleId: 1 });

/* Auto-generate slug from school name on first save */
schoolSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
  next();
});

/* Auto-generate license key */
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

/* Virtual: is subscription currently active */
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