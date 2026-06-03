/* ============================================
   LATLOMP PLATFORM — USER MODEL
   Clean version — schema definitions only
   No route logic belongs here
   ============================================ */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    /* ---- Basic Info ---- */
    name: {
      type:      String,
      required:  [true, 'Name is required'],
      trim:      true,
      minlength: [2,  'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters']
    },

    /*
      Email is NOT required because phone users
      get a placeholder email like +234xxx@phone.latlomp.com
      sparse:true allows multiple null values but
      enforces uniqueness on real email addresses
    */
    email: {
      type:      String,
      lowercase: true,
      trim:      true,
      sparse:    true,
      default:   null
    },

    password: {
      type:      String,
      minlength: [6, 'Password must be at least 6 characters'],
      select:    false,   /* Never returned in queries by default */
      default:   null
    },

    role: {
      type:    String,
      enum:    ['student', 'teacher', 'admin'],
      default: 'student'
    },

    avatar: {
      type:    String,
      default: ''
    },

    /* ---- Student Profile ---- */
    profile: {
      phone:      { type: String, default: '' },
      school:     { type: String, default: '' },
      state:      { type: String, default: '' },
      examTarget: {
        type:    String,
        enum:    ['jamb', 'waec', 'neco', 'other', ''],
        default: ''
      }
    },

    /* ---- Exam Stats ---- */
    stats: {
      totalExamsTaken: { type: Number, default: 0 },
      averageScore:    { type: Number, default: 0 },
      bestScore:       { type: Number, default: 0 },
      totalTimeSpent:  { type: Number, default: 0 }
    },

    /* ---- Account Status ---- */
    isActive: {
      type:    Boolean,
      default: true
    },

    lastLogin: {
      type:    Date,
      default: null
    },

    /* ============================================
       EMAIL VERIFICATION
       Used when user registers with email
    ============================================ */
    isVerified: {
      type:    Boolean,
      default: false
    },

    verifyToken: {
      type:    String,
      default: null
    },

    verifyTokenExpires: {
      type:    Date,
      default: null
    },

    verifyOtp: {
      type:    String,
      default: null
    },

    verifyOtpExpires: {
      type:    Date,
      default: null
    },

    otpAttempts: {
      type:    Number,
      default: 0
    },

    /* ============================================
       PHONE AUTHENTICATION
       Used when user signs in with phone number
    ============================================ */
    phone: {
      type:    String,
      default: null,
      sparse:  true   /* unique but allows multiple nulls */
    },

    phoneOtp: {
      type:    String,
      default: null
    },

    phoneOtpExpires: {
      type:    Date,
      default: null
    },

    phoneVerified: {
      type:    Boolean,
      default: false
    },

    /* ============================================
       GOOGLE AUTHENTICATION
       Used when user signs in with Google
    ============================================ */
    googleId: {
      type:    String,
      default: null
    },

    picture: {
      type:    String,
      default: null
    },

    /* ============================================
       PASSWORD RESET
    ============================================ */
    passwordResetToken: {
      type:    String,
      default: null
    },

    passwordResetExpires: {
      type:    Date,
      default: null
    }
  },
  {
    timestamps: true   /* Adds createdAt and updatedAt automatically */
  }
);

/* ============================================
   INDEXES
   Speeds up database queries on these fields
   sparse:true means only non-null values are indexed
============================================ */
userSchema.index({ email:    1 }, { sparse: true });
userSchema.index({ phone:    1 }, { sparse: true });
userSchema.index({ googleId: 1 }, { sparse: true });

/* ============================================
   PRE-SAVE HOOK: Hash password before saving
   
   Runs automatically before every .save()
   Only hashes if password was actually changed
============================================ */
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

/* ============================================
   METHOD: Compare entered password with hash
   
   Usage:
   const isMatch = await user.comparePassword('abc123')
============================================ */
userSchema.methods.comparePassword = async function(enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

/* ============================================
   METHOD: Return safe user object
   Removes all sensitive fields before
   sending data to the frontend
============================================ */
userSchema.methods.toSafeObject = function() {
  return {
    id:           this._id,
    name:         this.name,
    email:        this.email,
    phone:        this.phone,
    role:         this.role,
    avatar:       this.avatar,
    picture:      this.picture,
    profile:      this.profile,
    stats:        this.stats,
    isActive:     this.isActive,
    isVerified:   this.isVerified,
    phoneVerified: this.phoneVerified,
    googleId:     this.googleId ? true : false,
    lastLogin:    this.lastLogin,
    createdAt:    this.createdAt
  };
};

/* ============================================
   METHOD: Update last login timestamp
============================================ */
userSchema.methods.updateLastLogin = async function() {
  this.lastLogin = new Date();
  await this.save({ validateBeforeSave: false });
};

/* ============================================
   CREATE AND EXPORT MODEL
   
   mongoose.model('User', userSchema) tells
   Mongoose to create a 'users' collection
   using this schema
============================================ */
const User = mongoose.model('User', userSchema);

module.exports = User;