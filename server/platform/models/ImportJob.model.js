/* ============================================
   LATLOMP PLATFORM — IMPORT JOB MODEL
   Audit record for every QMS import operation.
============================================ */
'use strict';

const mongoose = require('mongoose');

const rejectionEntrySchema = new mongoose.Schema({
  row:      { type: Number },
  question: { type: String, default: '' },
  reason:   { type: String, default: '' }
}, { _id: false });

const importJobSchema = new mongoose.Schema(
  {
    importedBy:       { type: String, required: true },

    /* Source */
    sourceType:       {
      type:    String,
      enum:    ['paste', 'txt', 'csv', 'xlsx', 'docx'],
      default: 'paste'
    },
    originalFilename: { type: String, default: '' },

    /* Target */
    examType:       { type: String, required: true },
    departmentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    subjectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Subject',    default: null },
    departmentName: { type: String, default: '' },
    subjectName:    { type: String, default: '' },

    /* Status */
    status: {
      type:    String,
      enum:    ['processing', 'completed', 'failed', 'partial'],
      default: 'processing'
    },

    /* Stats */
    stats: {
      detected:  { type: Number, default: 0 },
      valid:     { type: Number, default: 0 },
      duplicate: { type: Number, default: 0 },
      rejected:  { type: Number, default: 0 },
      imported:  { type: Number, default: 0 }
    },

    processingMs:  { type: Number, default: 0 },
    rejectionLog:  { type: [rejectionEntrySchema], default: [] },
    errorMessage:  { type: String, default: '' }
  },
  { timestamps: true }
);

importJobSchema.index({ importedBy: 1, createdAt: -1 });
importJobSchema.index({ examType: 1,   subjectId: 1  });

module.exports = mongoose.model('ImportJob', importJobSchema);