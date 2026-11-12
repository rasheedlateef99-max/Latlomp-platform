'use strict';
/* ============================================
   LATLOMP — MESSAGING MEMBERS (B1)

   Answers one question from the database:
   "Is this person a CURRENT member of this school?"

   staff   → record exists, isActive, not explicitly unverified
   parent  → isActive AND at least one linked child in this school
             who is currently status 'active'
   student → status 'active', OR status 'graduated' with an
             active AlumniProfile (= alumnus)

   Deleted / deactivated / transferred people simply do not come
   back from here, so every caller treats them as "unavailable".
============================================ */
const SchoolUser    = require('../models/SchoolUser.model');
const SchoolParent  = require('../models/SchoolParent.model');
const SchoolStudent = require('../models/SchoolStudent.model');
const AlumniProfile = require('../models/AlumniProfile.model');
const policy        = require('./messaging.policy');

function staffDescriptor(u) {
  const roles = policy.roleSet(u);
  return {
    kind: 'staff', id: u._id, subtype: 'staff',
    name: u.name, email: u.email, roles: roles,
    roleKey: roles[0] || 'staff', roleLabel: policy.staffRoleLabel(roles),
    classId: u.classId || null, departmentId: u.departmentId || null
  };
}

function parentDescriptor(p) {
  return {
    kind: 'parent', id: p._id, subtype: 'parent',
    name: p.name, email: p.email, roles: [],
    roleKey: 'parent', roleLabel: 'Parent'
  };
}

function studentDescriptor(s, profile) {
  const alumni = !!profile;
  const subtitle = alumni
    ? ['Alumni', profile.graduationSession ? 'Class of ' + profile.graduationSession : '', profile.profession || ''].filter(Boolean).join(' · ')
    : [s.class || '', s.admissionNo || ''].filter(Boolean).join(' · ');
  return {
    kind: 'student', id: s._id, subtype: alumni ? 'alumni' : 'student',
    name: alumni ? (profile.displayName || s.name) : s.name,
    roles: [], roleKey: alumni ? 'alumni' : 'student', roleLabel: alumni ? 'Alumni' : 'Student',
    subtitle: subtitle,
    classId: s.classId || null, departmentId: s.departmentId || null,
    visibility: alumni ? (profile.directoryVisibility || 'alumni_only') : null
  };
}

const STAFF_FIELDS   = 'name email role additionalRoles classId departmentId';
const STUDENT_FIELDS = 'name class classId departmentId admissionNo status';
const PROFILE_FIELDS = 'studentId displayName graduationSession profession directoryVisibility';

/* refs: [{ kind, id }] → Map('kind:id' → descriptor). Missing = not a current member. */
async function loadMembers(schoolId, refs) {
  const ids = { staff: [], parent: [], student: [] };
  (refs || []).forEach(function (r) { if (r && ids[r.kind]) { ids[r.kind].push(String(r.id)); } });
  const out = new Map();
  const jobs = [];

  if (ids.staff.length) {
    jobs.push((async function () {
      const rows = await SchoolUser.find({
        _id: { $in: ids.staff }, schoolId: schoolId, isActive: true, isVerified: { $ne: false }
      }).select(STAFF_FIELDS).lean();
      rows.forEach(function (u) { out.set('staff:' + u._id, staffDescriptor(u)); });
    })());
  }

  if (ids.parent.length) {
    jobs.push((async function () {
      const parents = await SchoolParent.find({
        _id: { $in: ids.parent }, isActive: true, 'linkedStudents.schoolId': schoolId
      }).select('name email linkedStudents').lean();
      const childIds = [];
      parents.forEach(function (p) {
        (p.linkedStudents || []).forEach(function (ls) {
          if (String(ls.schoolId) === String(schoolId)) { childIds.push(String(ls.studentId)); }
        });
      });
      const active = childIds.length
        ? await SchoolStudent.find({ _id: { $in: childIds }, schoolId: schoolId, status: 'active' }).select('_id').lean()
        : [];
      const activeSet = new Set(active.map(function (s) { return String(s._id); }));
      parents.forEach(function (p) {
        const ok = (p.linkedStudents || []).some(function (ls) {
          return String(ls.schoolId) === String(schoolId) && activeSet.has(String(ls.studentId));
        });
        if (ok) { out.set('parent:' + p._id, parentDescriptor(p)); }
      });
    })());
  }

  if (ids.student.length) {
    jobs.push((async function () {
      const rows = await SchoolStudent.find({
        _id: { $in: ids.student }, schoolId: schoolId, status: { $in: ['active', 'graduated'] }
      }).select(STUDENT_FIELDS).lean();
      const gradIds = rows.filter(function (s) { return s.status === 'graduated'; }).map(function (s) { return String(s._id); });
      const profiles = gradIds.length
        ? await AlumniProfile.find({ studentId: { $in: gradIds }, schoolId: schoolId, status: 'active' }).select(PROFILE_FIELDS).lean()
        : [];
      const profMap = new Map(profiles.map(function (p) { return [String(p.studentId), p]; }));
      rows.forEach(function (s) {
        if (s.status === 'active') { out.set('student:' + s._id, studentDescriptor(s, null)); }
        else {
          const p = profMap.get(String(s._id));
          if (p) { out.set('student:' + s._id, studentDescriptor(s, p)); }
        }
      });
    })());
  }

  await Promise.all(jobs);
  return out;
}

async function loadMember(schoolId, ref) {
  const m = await loadMembers(schoolId, [ref]);
  return m.get(ref.kind + ':' + ref.id) || null;
}

module.exports = {
  loadMembers, loadMember,
  staffDescriptor, parentDescriptor, studentDescriptor,
  STAFF_FIELDS, STUDENT_FIELDS, PROFILE_FIELDS
};
