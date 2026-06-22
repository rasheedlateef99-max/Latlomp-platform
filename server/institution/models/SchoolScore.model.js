'use strict';

const mongoose = require('mongoose');

const schoolScoreSchema = new mongoose.Schema(
  {
    schoolId:   { type: mongoose.Schema.Types.ObjectId, ref: 'School',       required: true },
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolStudent', required: true },
    classId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass',   required: true },
    subjectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolSubject', required: true },
    termId:     { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm',  required: true },
    academicYear: { type: String, default: '' },
    configId:   { type: mongoose.Schema.Types.ObjectId, ref: 'ScoreConfig',   default: null },

    scores: {
      type:    Map,
      of:      Number,
      default: {}
    },

    total:       { type: Number, default: 0 },
    maxPossible: { type: Number, default: 0 },
    percentage:  { type: Number, default: 0 },
    grade:       { type: String, default: '' },
    remark:      { type: String, default: '' },

    position:             { type: Number, default: null },
    positionOutOf:        { type: Number, default: null },
    positionCalculatedAt: { type: Date,   default: null },

    enteredBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    enteredAt:    { type: Date, default: Date.now },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    lastEditedAt: { type: Date, default: null },

    approved:   { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null },
    approvedAt: { type: Date, default: null },

    teacherComment: { type: String, default: '' }
  },
  { timestamps: true }
);

schoolScoreSchema.index({ schoolId: 1, studentId: 1, subjectId: 1, termId: 1 }, { unique: true });
schoolScoreSchema.index({ schoolId: 1, classId: 1, subjectId: 1, termId: 1 });
schoolScoreSchema.index({ schoolId: 1, studentId: 1, termId: 1 });
schoolScoreSchema.index({ schoolId: 1, approved: 1 });

module.exports = mongoose.model('SchoolScore', schoolScoreSchema);