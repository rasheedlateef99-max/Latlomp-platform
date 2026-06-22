'use strict';

const mongoose = require('mongoose');

const scoreComponentSchema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true },
  label:     { type: String, required: true, trim: true },
  maxScore:  { type: Number, required: true, min: 1 },
  sortOrder: { type: Number, default: 0 }
}, { _id: false });

const gradeBoundarySchema = new mongoose.Schema({
  grade:    { type: String, required: true, trim: true },
  remark:   { type: String, required: true, trim: true },
  minScore: { type: Number, required: true },
  maxScore: { type: Number, required: true }
}, { _id: false });

const scoreConfigSchema = new mongoose.Schema(
  {
    schoolId:        { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name:            { type: String, default: 'Default Score Structure', trim: true },
    isDefault:       { type: Boolean, default: true },
    isActive:        { type: Boolean, default: true },
    components:      { type: [scoreComponentSchema], default: [] },
    gradeBoundaries: { type: [gradeBoundarySchema],  default: [] },
    createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', default: null }
  },
  { timestamps: true }
);

scoreConfigSchema.index({ schoolId: 1 });
scoreConfigSchema.index({ schoolId: 1, isDefault: 1, isActive: 1 });

scoreConfigSchema.statics.getDefaultComponents = function () {
  return [
    { key: 'firstTest',   label: 'First Test',   maxScore: 10, sortOrder: 1 },
    { key: 'secondTest',  label: 'Second Test',  maxScore: 10, sortOrder: 2 },
    { key: 'assignment',  label: 'Assignment',   maxScore: 10, sortOrder: 3 },
    { key: 'practical',   label: 'Practical',    maxScore: 10, sortOrder: 4 },
    { key: 'examination', label: 'Examination',  maxScore: 60, sortOrder: 5 }
  ];
};

scoreConfigSchema.statics.getDefaultGradeBoundaries = function () {
  return [
    { grade: 'A1', remark: 'Excellent', minScore: 75, maxScore: 100 },
    { grade: 'B2', remark: 'Very Good', minScore: 70, maxScore: 74  },
    { grade: 'B3', remark: 'Good',      minScore: 65, maxScore: 69  },
    { grade: 'C4', remark: 'Credit',    minScore: 60, maxScore: 64  },
    { grade: 'C5', remark: 'Credit',    minScore: 55, maxScore: 59  },
    { grade: 'C6', remark: 'Credit',    minScore: 50, maxScore: 54  },
    { grade: 'D7', remark: 'Pass',      minScore: 45, maxScore: 49  },
    { grade: 'E8', remark: 'Pass',      minScore: 40, maxScore: 44  },
    { grade: 'F9', remark: 'Fail',      minScore: 0,  maxScore: 39  }
  ];
};

scoreConfigSchema.statics.getOrCreateDefault = async function (schoolId, createdBy) {
  var existing = await this.findOne({ schoolId: schoolId, isDefault: true, isActive: true });
  if (existing) { return existing; }
  return this.create({
    schoolId:        schoolId,
    name:            'Default Score Structure',
    isDefault:       true,
    isActive:        true,
    components:      this.getDefaultComponents(),
    gradeBoundaries: this.getDefaultGradeBoundaries(),
    createdBy:       createdBy || null
  });
};

scoreConfigSchema.statics.resolveGrade = function (gradeBoundaries, percentScore) {
  var boundaries = (gradeBoundaries && gradeBoundaries.length)
    ? gradeBoundaries
    : this.getDefaultGradeBoundaries();
  for (var i = 0; i < boundaries.length; i++) {
    var b = boundaries[i];
    if (percentScore >= b.minScore && percentScore <= b.maxScore) {
      return { grade: b.grade, remark: b.remark };
    }
  }
  return { grade: '—', remark: 'Ungraded' };
};

module.exports = mongoose.model('ScoreConfig', scoreConfigSchema);