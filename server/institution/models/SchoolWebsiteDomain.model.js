'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE DOMAIN (E8A)
   
   SKELETON ONLY in E8A.
   Custom domains are a future phase (E8G).
   Architecture established now to avoid future
   schema migration. Not actively used in E8A.
   
   In E8A: slug-based routing only.
   /school/:slug resolves tenant.
============================================ */
var schoolWebsiteDomainSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true,
    unique:   true
  },

  /* Platform slug — primary routing in E8 */
  slug:     { type: String, default: '' },

  /* Custom domain — future E8G */
  customDomain:       { type: String, default: '' },
  domainType:         { type: String, enum: ['slug', 'custom'], default: 'slug' },
  verificationStatus: {
    type:    String,
    enum:    ['not_started', 'pending', 'verified', 'failed'],
    default: 'not_started'
  },
  verificationToken: { type: String, default: '' },
  verifiedAt:        { type: Date, default: null },
  isPrimary:         { type: Boolean, default: true },

  /* DNS records needed for future custom domain verification */
  dnsRecords: [{
    type:  { type: String, default: 'CNAME' },
    name:  { type: String, default: '' },
    value: { type: String, default: '' },
    _id:   false
  }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null }

}, { timestamps: true });

schoolWebsiteDomainSchema.index({ schoolId:    1 }, { unique: true });
schoolWebsiteDomainSchema.index({ customDomain: 1 }, { sparse: true });
schoolWebsiteDomainSchema.index({ slug:         1 }, { sparse: true });

module.exports = mongoose.model('SchoolWebsiteDomain', schoolWebsiteDomainSchema);