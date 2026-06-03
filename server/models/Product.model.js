/* ============================================
   LATLOMP PLATFORM — PRODUCT MODEL
   ============================================ */
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Product name is required'],
      trim:     true,
      maxlength: [120, 'Product name cannot exceed 120 characters']
    },

    slug: {
      type:   String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim:   true
    },

    description: {
      type:    String,
      default: '',
      trim:    true,
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },

    category: {
      type:    String,
      default: 'General',
      trim:    true
    },

    price: {
      type:     Number,
      required: [true, 'Price is required'],
      min:      [0, 'Price cannot be negative']
    },

    stock: {
      type:    Number,
      default: 0,
      min:     [0, 'Stock cannot be negative']
    },

    /* Primary image URL — Cloudinary or direct URL */
    image: {
      type:    String,
      default: ''
    },

    /* Cloudinary public_id for deletion */
    imagePublicId: {
      type:    String,
      default: ''
    },

    /* Additional images array */
    images: {
      type:    [String],
      default: []
    },

    tags: {
      type:    [String],
      default: []
    },

    isActive: {
      type:    Boolean,
      default: true
    },

    isFeatured: {
      type:    Boolean,
      default: false
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User'
    }
  },
  {
    timestamps: true
  }
);

/* Auto-generate slug from name before saving */
productSchema.pre('save', function(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') +
      '-' + Date.now().toString(36);
  }
  next();
});

/* Text index for search */
productSchema.index({ name: 'text', description: 'text', category: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);