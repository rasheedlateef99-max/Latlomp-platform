/* ============================================
   LATLOMP INSTITUTION — INVITATION MODEL

   ✅ PHASE B: Admin-controlled invitation expiry
   ✅ RESTRUCTURE STAGE 5:
   Added new fields for role delegation:
     assignedClassId    — class ownership for class_teacher
     assignedDepartmentId — dept ownership for hod/dept_admin
     additionalRoles    — multiple responsibilities
   Also expanded role enum to include all valid roles.
   All additions have safe defaults — existing
   invitations are not broken.
============================================ */
'use strict';

const mongoose = require('mongoose');
const crypto   = require('crypto');

var EXPIRY_MS = {
  '5min':  5  * 60 * 1000,
  '10min': 10 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1hr':   1  * 60 * 60 * 1000,
  '24hr':  24 * 60 * 60 * 1000,
  '7days': 7  * 24 * 60 * 60 * 1000
};

var EXPIRY_LABELS = {
  '5min':  '5 minutes',
  '10min': '10 minutes',
  '30min': '30 minutes',
  '1hr':   '1 hour',
  '24hr':  '24 hours',
  '7days': '7 days'
};

/* ============================================
   ALL VALID ROLE VALUES
   ✅ STAGE 5: Expanded from ['teacher','vice_principal']
   to include all roles defined in SchoolUser.model.js.
   Backward compatible — existing invitations keep
   their existing role values.
============================================ */
var VALID_ROLES = [
  'teacher',
  'vice_principal',
  'bursar',
  'class_teacher',
  'subject_teacher',
  'lecturer',
  'instructor',
  'hod',
  'dean',
  'department_admin',
  'principal'
];

const invitationSchema = new mongoose.Schema(
  {
    schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School',     required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolUser', required: true },

    email:    { type: String, required: true, lowercase: true, trim: true },
    name:     { type: String, default: '' },

    /* ✅ STAGE 5: expanded enum to include all roles */
    role: {
      type:    String,
      enum:    VALID_ROLES,
      default: 'teacher'
    },

    subjects: [String],
    classes:  [String],

    /* ✅ STAGE 5: Class ownership scope.
       Stored on invitation so FLOW 1 can copy it
       to SchoolUser.classId when teacher accepts.
       Required when role = 'class_teacher'. */
    assignedClassId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'SchoolClass',
      default: null
    },

    /* ✅ STAGE 5: Department ownership scope.
       Stored on invitation so FLOW 1 can copy it
       to SchoolUser.departmentId when staff accepts.
       Used when role = 'hod' or 'department_admin'. */
    assignedDepartmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Department',
      default: null
    },

    /* ✅ STAGE 5: Additional responsibilities.
       Stored on invitation so FLOW 1 can copy them
       to SchoolUser.additionalRoles when staff accepts.
       Each value must be a valid role string. */
    additionalRoles: {
      type: [{
        type: String,
        enum: VALID_ROLES
      }],
      default: []
    },

    token:     { type: String, required: true, unique: true },
    expiresAt: { type: Date,   required: true },

    /* ✅ PHASE B: admin-chosen expiry window */
    expiryDuration: {
      type:    String,
      enum:    ['5min', '10min', '30min', '1hr', '24hr', '7days'],
      default: '7days'
    },

    status: {
      type:    String,
      enum:    ['pending', 'accepted', 'expired', 'cancelled'],
      default: 'pending'
    },

    acceptedAt: { type: Date,   default: null },
    message:    { type: String, default: '' }
  },
  { timestamps: true }
);

invitationSchema.index({ token:    1 });
invitationSchema.index({ schoolId: 1, email: 1 });
invitationSchema.index({ expiresAt: 1 });

invitationSchema.pre('validate', function (next) {
  if (!this.token) {
    this.token = crypto.randomBytes(32).toString('hex');
  }
  if (!this.expiresAt) {
    var ms = EXPIRY_MS[this.expiryDuration] || EXPIRY_MS['7days'];
    this.expiresAt = new Date(Date.now() + ms);
  }
  next();
});

invitationSchema.statics.getExpiryLabel = function (key) {
  return EXPIRY_LABELS[key] || '7 days';
};

module.exports = mongoose.model('Invitation', invitationSchema);