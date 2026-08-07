/* ============================================
   LATLOMP PLATFORM — EXAMINATION BLUEPRINT MODEL
   Stage 1: Model + admin interface only.
   Stage 4: Live session/start will read this.

   IDENTITY:
     Each Blueprint is uniquely identified by
     the combination of (subjectId, examType, questionType).
     One Biology JAMB Objective Blueprint.
     One Biology JAMB Theory Blueprint.
     One Biology WAEC Objective Blueprint.
     All independent configurations.

   RELATIONSHIP TO SESSION (Stage 4):
     session/start currently reads subject.questionCount directly.
     After Stage 4, it will read blueprint.count instead.
     blueprint.difficultyDistribution will drive engine.assemble().
     Nothing in this model changes that future path — it is
     already designed for it.

   BACKWARD COMPATIBILITY:
     During Stage 1 and Stage 2, nothing reads this model
     for live exam assembly. It is admin-facing only.
     All existing examinations continue unchanged.
============================================ */
'use strict';

var mongoose = require('mongoose');

/* ---- Difficulty distribution sub-document ---- */
var difficultyDistributionSchema = new mongoose.Schema({
  easy:   { type: Number, default: 33, min: 0, max: 100 },
  medium: { type: Number, default: 34, min: 0, max: 100 },
  hard:   { type: Number, default: 33, min: 0, max: 100 }
}, { _id: false });

/* ---- Security options sub-document (for ECE integration, Stage 4+) ---- */
var securityOptionsSchema = new mongoose.Schema({
  fullscreen:       { type: Boolean, default: false },
  tabSwitchDetect:  { type: Boolean, default: false },
  copyProtection:   { type: Boolean, default: false },
  rightClickDisable:{ type: Boolean, default: false }
}, { _id: false });

var examinationBlueprintSchema = new mongoose.Schema(
  {
    /* ---- Identity ---- */
    subjectId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Subject',
      required: true,
      index:    true
    },

    /* Single exam type per blueprint.
       A subject can have one blueprint per examType per questionType. */
    /* ✅ STAGE 6: Enum replaced by dynamic ExamType collection. */
    examType: {
      type:      String,
      required:  true,
      lowercase: true,
      trim:      true
    },
    /* Which examination mode this blueprint configures */
    questionType: {
      type:     String,
      enum:     ['objective', 'theory', 'practical', 'oral'],
      required: true,
      default:  'objective'
    },

    /* ---- Denormalized display names ---- */
    subjectName:    { type: String, default: '', trim: true },
    departmentName: { type: String, default: '', trim: true },

    /* ---- Examination configuration ----
       These fields will drive session/start in Stage 4.
       During Stage 1, they are admin-visible only. */
    count:    { type: Number, default: 40,  min: 1, max: 500 },  /* questions per session */
    duration: { type: Number, default: 30,  min: 1, max: 600 },  /* minutes */
    passMark: { type: Number, default: 50,  min: 0, max: 100 },  /* percentage */

    /* ---- Difficulty distribution ----
       Percentages should sum to ~100.
       Engine uses these weights during assembly (Stage 4).
       During Stage 1 stored but not enforced at runtime. */
    difficultyDistribution: {
      type:    difficultyDistributionSchema,
      default: function () { return { easy: 33, medium: 34, hard: 33 }; }
    },

    /* ---- Behaviour ---- */
    randomize:      { type: Boolean, default: true  },
    shuffleOptions: { type: Boolean, default: false },

    /* ---- Content ---- */
    instructions: { type: String, default: '', trim: true },

    /* ---- Future ECE integration ---- */
    securityOptions: {
      type:    securityOptionsSchema,
      default: function () { return {}; }
    },

    /* ---- Status ----
       Computed and stored for display purposes.
       'ready'      — pool has >= count approved questions
       'incomplete' — pool exists but has fewer than count
       'draft'      — no configuration or empty pool */
    status: {
      type:    String,
      enum:    ['ready', 'incomplete', 'draft'],
      default: 'draft'
    },

    /* ---- Audit ---- */
    lastModifiedBy: { type: String, default: 'system' },
    lastModifiedAt: { type: Date,   default: Date.now }
  },
  { timestamps: true }
);

/* ---- Unique compound index ----
   One blueprint per subject + examType + questionType combination.
   Enforced at the DB level — upserts use this key. */
examinationBlueprintSchema.index(
  { subjectId: 1, examType: 1, questionType: 1 },
  { unique: true }
);

examinationBlueprintSchema.index({ subjectId: 1, status: 1 });

/* ============================================
   STATIC: getOrCreate
   Returns the blueprint for a subject + examType + questionType.
   Creates it with defaults if it does not exist.
   Called by admin UI when opening blueprint editor.
============================================ */
examinationBlueprintSchema.statics.getOrCreate = async function (
  subjectId, examType, questionType, defaults
) {
  questionType = questionType || 'objective';
  examType     = examType     || 'all';
  defaults     = defaults     || {};

  var existing = await this.findOne({ subjectId, examType, questionType });
  if (existing) { return existing; }

  return await this.create({
    subjectId:      subjectId,
    examType:       examType,
    questionType:   questionType,
    subjectName:    defaults.subjectName    || '',
    departmentName: defaults.departmentName || '',
    count:          defaults.count          || 40,
    duration:       defaults.duration       || 30,
    passMark:       defaults.passMark       || 50,
    status:         'draft',
    lastModifiedBy: defaults.modifiedBy     || 'system'
  });
};

module.exports = mongoose.model('ExaminationBlueprint', examinationBlueprintSchema);