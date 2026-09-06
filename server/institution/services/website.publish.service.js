'use strict';
/* ============================================
   LATLOMP — WEBSITE PUBLISH SERVICE (E8E)

   validatePublish  — pre-publish checklist.
   saveVersionSnapshot — creates SchoolWebsiteVersion
                         and prunes old versions.

   Called by the enhanced POST /publish route
   and the GET /publish/validate dry-run endpoint.
   Defence-in-depth: server always validates even
   if builder JS skips the dry-run step.
============================================ */

var MAX_VERSIONS = 10;

/* ============================================
   validatePublish(school, website)
   Returns { canPublish, errors, warnings }
   errors   — block publish
   warnings — advisory, do not block
============================================ */
async function validatePublish(school, website) {
  var errors   = [];
  var warnings = [];
  var config   = (website && website.draftConfig) || {};

  /* ---- CRITICAL (block publish) ---- */

  if (!school.slug || !school.slug.trim()) {
    errors.push({
      field:   'slug',
      message: 'Your school does not have a URL slug. Configure it in School Settings before publishing.'
    });
  }

  if (!config || Object.keys(config).length === 0) {
    errors.push({
      field:   'config',
      message: 'No website configuration found. Configure your website before publishing.'
    });
    return { canPublish: false, errors, warnings };
  }

  var sections        = config.homepageSections || [];
  var enabledSections = sections.filter(function(s) { return s.enabled; });
  if (!enabledSections.length) {
    errors.push({
      field:   'homepage',
      message: 'No homepage sections are enabled. Enable at least one section in Homepage settings.'
    });
  }

  var enabledModules = config.enabledModules || [];
  if (!enabledModules.length) {
    errors.push({
      field:   'navigation',
      message: 'No navigation pages are enabled. Enable at least Home in Navigation settings.'
    });
  }

  /* ---- WARNINGS (advisory) ---- */

  if (!config.logoUrl && !school.logo) {
    warnings.push({
      field:   'logo',
      message: 'No logo set. Add a logo in Design settings for a professional appearance.'
    });
  }

  if (!config.publicEmail && !config.publicPhone && !school.phone) {
    warnings.push({
      field:   'contact',
      message: 'No contact information set. Add contact details in Identity settings.'
    });
  }

  if (!config.about && !config.description && !config.tagline) {
    warnings.push({
      field:   'about',
      message: 'No school description or tagline configured. Add school information in Identity settings.'
    });
  }

  var seo = config.seo || {};
  if (!seo.metaTitle && !seo.metaDescription) {
    warnings.push({
      field:   'seo',
      message: 'No SEO metadata configured. Add a page title and description in SEO settings to improve search engine visibility.'
    });
  }

  var pm = config.principalMessage || {};
  if (!pm.text) {
    warnings.push({
      field:   'principal',
      message: 'No principal message configured. Add one in Identity settings.'
    });
  }

  return {
    canPublish: errors.length === 0,
    errors,
    warnings
  };
}

/* ============================================
   saveVersionSnapshot(schoolId, configToSnapshot, schoolUser, source, rolledBackFromVersion)

   Saves configToSnapshot as a new version document.
   Prunes older versions so at most MAX_VERSIONS remain.
   Returns the created version document.
============================================ */
async function saveVersionSnapshot(schoolId, configToSnapshot, schoolUser, source, rolledBackFromVersion) {
  var SchoolWebsiteVersion = require('../models/SchoolWebsiteVersion.model');

  /* Next sequential version number for this school */
  var lastVersion = await SchoolWebsiteVersion.findOne({ schoolId: schoolId })
    .sort({ versionNumber: -1 })
    .select('versionNumber')
    .lean();

  var nextVersionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;

  var snapshot = await SchoolWebsiteVersion.create({
    schoolId:              schoolId,
    versionNumber:         nextVersionNumber,
    configSnapshot:        configToSnapshot || {},
    publishedAt:           new Date(),
    publishedBy:           schoolUser._id,
    publishedByName:       schoolUser.name || '',
    source:                source || 'publish',
    rolledBackFromVersion: rolledBackFromVersion || null
  });

  /* Prune oldest versions — keep most recent MAX_VERSIONS */
  var allVersions = await SchoolWebsiteVersion.find({ schoolId: schoolId })
    .sort({ versionNumber: -1 })
    .select('_id versionNumber')
    .lean();

  if (allVersions.length > MAX_VERSIONS) {
    var toDelete = allVersions.slice(MAX_VERSIONS).map(function(v) { return v._id; });
    await SchoolWebsiteVersion.deleteMany({ _id: { $in: toDelete } });
  }

  return snapshot;
}

module.exports = {
  validatePublish,
  saveVersionSnapshot,
  MAX_VERSIONS
};