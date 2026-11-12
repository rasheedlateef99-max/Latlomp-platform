'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL CONNECTION (messaging B1)

   ONE shared connection model for every account type.
   AlumniConnection is left untouched (alumni network feature).

   A party is { kind, uid }:
     staff   → SchoolUser._id
     parent  → SchoolParent._id
     student → SchoolStudent._id  (alumni = graduated student)
   Never an email address.

   One record per pair per school. pairKey is built from the two
   parties in sorted order, so A→B and B→A are the SAME record and
   the unique index blocks duplicates and simultaneous cross-requests.

   Status: pending | accepted | rejected | removed
   rejected / removed pairs may be requested again (same record is
   re-opened); history is kept (last 20 changes).
============================================ */
const partySchema = new mongoose.Schema({
  kind: { type: String, enum: ['staff', 'parent', 'student'], required: true },
  uid:  { type: mongoose.Schema.Types.ObjectId, required: true }
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  by:     { type: partySchema, default: null },
  at:     { type: Date, default: Date.now }
}, { _id: false });

const schoolConnectionSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  pairKey:     { type: String, required: true },
  a:           { type: partySchema, required: true },
  b:           { type: partySchema, required: true },
  requestedBy: { type: partySchema, required: true },
  status: {
    type:    String,
    enum:    ['pending', 'accepted', 'rejected', 'removed'],
    default: 'pending'
  },
  message:      { type: String, default: '', maxlength: 300 },
  requestedAt:  { type: Date, default: Date.now },
  respondedAt:  { type: Date, default: null },
  removedAt:    { type: Date, default: null },
  removedBy:    { type: partySchema, default: null },
  requestCount: { type: Number, default: 1 },
  history:      { type: [historySchema], default: [] }
}, { timestamps: true });

schoolConnectionSchema.index({ pairKey: 1 }, { unique: true });
schoolConnectionSchema.index({ schoolId: 1, 'a.kind': 1, 'a.uid': 1, status: 1 });
schoolConnectionSchema.index({ schoolId: 1, 'b.kind': 1, 'b.uid': 1, status: 1 });

module.exports = mongoose.model('SchoolConnection', schoolConnectionSchema);
