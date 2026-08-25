'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — PLATFORM CONFIGURATION
   DB-backed, admin-controlled settings.
   Updated from admin.html without code changes.

   Keys used by R2:
     platform_fee_percent   — e.g. 0.5 (0.5%)
     paystack_enabled       — true/false
     online_payments_enabled — true/false
============================================ */
const platformConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String, default: '' },
  updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, default: '' }
}, { timestamps: true });

platformConfigSchema.statics.getValue = async function (key, defaultValue) {
  try {
    const doc = await this.findOne({ key }).lean();
    return (doc !== null && doc.value !== undefined) ? doc.value : defaultValue;
  } catch (e) { return defaultValue; }
};

platformConfigSchema.statics.setValue = async function (key, value, description, updatedBy, updatedByName) {
  return this.findOneAndUpdate(
    { key },
    { $set: { value, description: description || '', updatedBy: updatedBy || null, updatedByName: updatedByName || '' } },
    { upsert: true, new: true }
  );
};

/* Seed defaults on first use */
platformConfigSchema.statics.seedDefaults = async function () {
  const defaults = [
    { key: 'platform_fee_percent',    value: 0.5,  description: 'LatLomp platform fee percentage on online fee payments' },
    { key: 'paystack_enabled',        value: true,  description: 'Whether Paystack is available as a payment provider' },
    { key: 'online_payments_enabled', value: true,  description: 'Master switch for all online fee payments' }
  ];
  for (const d of defaults) {
    await this.findOneAndUpdate({ key: d.key }, { $setOnInsert: d }, { upsert: true });
  }
};

module.exports = mongoose.model('PlatformConfig', platformConfigSchema);