'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL WEBSITE (E8A)
   
   One document per school.
   draftConfig → all edits land here.
   publishedConfig → public renderer reads this ONLY.
   Publish = atomic copy of draftConfig → publishedConfig.
   
   Does NOT duplicate School model fields.
   Supplements them with website-specific config.
============================================ */

var SocialLinksSchema = new mongoose.Schema({
  facebook:  { type: String, default: '' },
  twitter:   { type: String, default: '' },
  instagram: { type: String, default: '' },
  youtube:   { type: String, default: '' },
  linkedin:  { type: String, default: '' },
  whatsapp:  { type: String, default: '' }
}, { _id: false });

var AdmissionsSchema = new mongoose.Schema({
  isOpen:         { type: Boolean, default: false },
  deadline:       { type: Date,    default: null },
  requirements:   { type: String,  default: '' },
  howToApply:     { type: String,  default: '' },
  applicationUrl: { type: String,  default: '' },
  contactEmail:   { type: String,  default: '' },
  contactPhone:   { type: String,  default: '' }
}, { _id: false });

var SeoSchema = new mongoose.Schema({
  metaTitle:       { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  ogImageUrl:      { type: String, default: '' },
  keywords:        { type: [String], default: [] }
}, { _id: false });

var PrincipalMessageSchema = new mongoose.Schema({
  text:     { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  name:     { type: String, default: '' },
  title:    { type: String, default: 'Principal' }
}, { _id: false });

var HomepageSectionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'hero', 'about', 'principal_message', 'stats',
      'news', 'events', 'contact', 'cta',
      'programmes', 'departments', 'facilities', 'admissions'
    ],
    required: true
  },
  enabled: { type: Boolean, default: true },
  order:   { type: Number,  default: 0 },
  config: {
    /* hero */
    headline:       { type: String, default: '' },
    subtext:        { type: String, default: '' },
    heroImageUrl:   { type: String, default: '' },
    overlayOpacity: { type: Number, default: 0.5, min: 0, max: 1 },
    buttonText:     { type: String, default: '' },
    buttonUrl:      { type: String, default: '' },
    /* stats */
    stats: [{
      label: { type: String, default: '' },
      value: { type: String, default: '' },
      _id:   false
    }],
    /* cta */
    ctaText:        { type: String, default: '' },
    ctaButtonText:  { type: String, default: '' },
    ctaButtonUrl:   { type: String, default: '' }
  }
}, { _id: false });

/* ============================================
   WEBSITE CONFIG — shared shape for
   draftConfig and publishedConfig.
   Defined as plain object shape (not sub-schema)
   so both draft and published use same structure.
============================================ */
var configFields = {
  /* IDENTITY (supplements School model) */
  tagline:     { type: String, default: '' },
  description: { type: String, default: '' },
  about:       { type: String, default: '' },
  history:     { type: String, default: '' },
  mission:     { type: String, default: '' },
  vision:      { type: String, default: '' },
  values:      { type: String, default: '' },
  foundedYear: { type: Number, default: null },

  /* CONTACT — supplements School.phone/address */
  publicEmail:  { type: String, default: '' },
  publicPhone:  { type: String, default: '' },
  mapEmbedUrl:  { type: String, default: '' },
  socialLinks:  { type: SocialLinksSchema, default: () => ({}) },

  /* DESIGN */
  theme:          {
    type: String,
    enum: ['modern', 'classic', 'bold'],
    default: 'modern'
  },
  primaryColor:   { type: String, default: '' },
  secondaryColor: { type: String, default: '' },
  accentColor:    { type: String, default: '' },
  fontTheme: {
    type: String,
    enum: ['inter', 'poppins', 'merriweather'],
    default: 'inter'
  },
  navStyle: {
    type: String,
    enum: ['light', 'dark', 'transparent'],
    default: 'dark'
  },
  footerStyle: {
    type: String,
    enum: ['minimal', 'rich', 'columns'],
    default: 'rich'
  },

  /* LOGO / FAVICON (URLs from SchoolWebsiteMedia) */
  logoUrl:     { type: String, default: '' },
  faviconUrl:  { type: String, default: '' },
  logoMediaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'SchoolWebsiteMedia',
    default: null
  },

  /* HOMEPAGE */
  homepageSections: { type: [HomepageSectionSchema], default: [] },

  /* NAVIGATION */
  enabledModules: {
    type:    [String],
    default: ['home', 'about', 'news', 'events', 'contact']
  },
  navOrder:       { type: [String], default: [] },
  /* Custom nav labels: { about: "Our School", news: "Latest News" } */
  customNavLabels: {
    type: Map,
    of:   String,
    default: () => new Map()
  },

  /* SEO */
  seo: { type: SeoSchema, default: () => ({}) },

  /* ADMISSIONS */
  admissions: { type: AdmissionsSchema, default: () => ({}) },

  /* PRINCIPAL MESSAGE */
  principalMessage: { type: PrincipalMessageSchema, default: () => ({}) }
};

var schoolWebsiteSchema = new mongoose.Schema({
  schoolId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'School',
    required: true,
    unique:   true
  },

  /* PUBLISHING STATE */
  status: {
    type:    String,
    enum:    ['draft', 'published', 'unpublished'],
    default: 'draft'
  },
  publishedAt:      { type: Date, default: null },
  publishedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  publishedByName:  { type: String, default: '' },
  unpublishedAt:    { type: Date, default: null },
  unpublishedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  lastEditedAt:     { type: Date, default: Date.now },
  lastEditedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
  lastEditedByName: { type: String, default: '' },

  /* DRAFT CONFIG — edits always write here */
  draftConfig:     { type: configFields, default: () => ({}) },
  /* PUBLISHED SNAPSHOT — public renderer reads this ONLY */
  publishedConfig: { type: configFields, default: () => ({}) }

}, { timestamps: true });

schoolWebsiteSchema.index({ schoolId: 1 }, { unique: true });
schoolWebsiteSchema.index({ status: 1 });

module.exports = mongoose.model('SchoolWebsite', schoolWebsiteSchema);