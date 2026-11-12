'use strict';
/* ============================================
   LATLOMP — MESSAGING POLICY (B1)

   Pure functions only. No database access.
   Every "who may see / contact whom" decision lives
   here so it can be tested without a database and
   changed in one place.

   Identity model:
     kind 'staff'   → SchoolUser._id
     kind 'parent'  → SchoolParent._id
     kind 'student' → SchoolStudent._id (an alumnus is a
                      graduated student: same id, subtype 'alumni')
   A person is NEVER matched by email across kinds.
============================================ */

const ROLE = Object.freeze({
  TEACHER:    Object.freeze(['teacher', 'subject_teacher', 'class_teacher', 'lecturer', 'instructor', 'hod']),
  ADMIN:      Object.freeze(['school_admin', 'principal', 'vice_principal', 'dean', 'department_admin']),
  LEADERSHIP: Object.freeze(['school_admin', 'principal', 'vice_principal']),
  FINANCE:    Object.freeze(['bursar', 'school_admin', 'principal', 'vice_principal']),
  SENIOR:     Object.freeze(['school_admin', 'principal', 'vice_principal', 'dean'])
});

const ROLE_LABELS = Object.freeze({
  school_admin: 'School Admin', principal: 'Principal', vice_principal: 'Vice Principal',
  dean: 'Dean', hod: 'Head of Department', department_admin: 'Department Administrator',
  class_teacher: 'Class Teacher', subject_teacher: 'Subject Teacher', teacher: 'Teacher',
  lecturer: 'Lecturer', instructor: 'Instructor', bursar: 'Bursar'
});

const KINDS = Object.freeze(['staff', 'parent', 'student']);
const CATEGORY_LIST = Object.freeze(['all', 'staff', 'teachers', 'admin', 'finance', 'parents', 'students', 'alumni']);

const VIEWER_CATEGORIES = Object.freeze({
  staff:   CATEGORY_LIST,
  parent:  Object.freeze(['all', 'teachers', 'admin', 'finance']),
  alumni:  Object.freeze(['all', 'admin', 'finance']),
  student: Object.freeze([])
});

const WORD_CATEGORY = Object.freeze({
  parent: 'parents', parents: 'parents', guardian: 'parents', guardians: 'parents',
  teacher: 'teachers', teachers: 'teachers', lecturer: 'teachers', lecturers: 'teachers',
  admin: 'admin', admins: 'admin', administrator: 'admin', administrators: 'admin',
  administration: 'admin', principal: 'admin', leadership: 'admin', management: 'admin',
  finance: 'finance', bursar: 'finance', bursary: 'finance', accounts: 'finance', fees: 'finance',
  student: 'students', students: 'students', pupil: 'students', pupils: 'students',
  alumni: 'alumni', alumnus: 'alumni', alumna: 'alumni',
  staff: 'staff'
});

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/* ---------- small helpers ---------- */
function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code   = code;
  return e;
}

/* Strict: only a 24-hex STRING passes. Objects such as {"$ne":null} never do. */
function isObjectIdString(v) { return typeof v === 'string' && OBJECT_ID_RE.test(v); }

function cleanText(v, max) {
  if (typeof v !== 'string') { return ''; }
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function nameRegex(s)   { return new RegExp(escapeRegex(s), 'i'); }

function normalizeEmail(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function looksLikeEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }

function unique(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }
function hasAny(roles, list) { return Array.isArray(roles) && roles.some(function (r) { return list.indexOf(r) !== -1; }); }

function roleSet(user) {
  const out = [];
  if (user && typeof user.role === 'string') { out.push(user.role); }
  if (user && Array.isArray(user.additionalRoles)) {
    user.additionalRoles.forEach(function (r) { if (typeof r === 'string' && out.indexOf(r) === -1) { out.push(r); } });
  }
  return out;
}

function staffRoleLabel(roles) {
  const labels = (roles || []).map(function (r) { return ROLE_LABELS[r]; }).filter(Boolean);
  return labels.length ? labels.slice(0, 2).join(' · ') : 'Staff';
}

/* ---------- who is looking ---------- */
function viewerTypeOf(actor) {
  if (!actor) { return 'student'; }
  if (actor.kind === 'staff')  { return 'staff'; }
  if (actor.kind === 'parent') { return 'parent'; }
  return actor.isAlumni ? 'alumni' : 'student';
}

/* Which staff roles may this viewer discover? null = all roles. */
function staffRolesVisibleTo(viewerType) {
  if (viewerType === 'staff')  { return null; }
  if (viewerType === 'parent') { return unique(ROLE.TEACHER.concat(ROLE.ADMIN)); }
  if (viewerType === 'alumni') { return ROLE.LEADERSHIP.slice(); }
  return [];
}

function staffVisibleTo(viewerType, roles) {
  const allowed = staffRolesVisibleTo(viewerType);
  if (allowed === null) { return true; }
  return hasAny(roles, allowed);
}

/* Returns null (no role filter), [] (nothing visible) or a list of roles. */
function staffRoleFilter(viewerType, category) {
  const visible = staffRolesVisibleTo(viewerType);
  let wanted = null;
  if (category === 'teachers')   { wanted = ROLE.TEACHER.slice(); }
  else if (category === 'admin') { wanted = ROLE.ADMIN.slice(); }
  if (visible === null) { return wanted; }
  if (wanted === null)  { return visible; }
  return wanted.filter(function (r) { return visible.indexOf(r) !== -1; });
}

/* Which result kinds are searched for this viewer + category. */
function kindsFor(viewerType, category) {
  if (viewerType === 'staff') {
    switch (category) {
      case 'all':      return ['staff', 'parent', 'student', 'alumni', 'finance'];
      case 'staff':
      case 'teachers':
      case 'admin':    return ['staff'];
      case 'finance':  return ['finance'];
      case 'parents':  return ['parent'];
      case 'students': return ['student'];
      case 'alumni':   return ['alumni'];
      default:         return [];
    }
  }
  if (viewerType === 'parent' || viewerType === 'alumni') {
    switch (category) {
      case 'all':     return ['staff', 'finance'];
      case 'teachers':
      case 'admin':   return ['staff'];
      case 'finance': return ['finance'];
      default:        return [];
    }
  }
  return [];
}

/* ---------- student scope for staff (fails CLOSED) ---------- */
/* Returns null (no students), 'all', or an array of Mongo conditions. */
function studentScopeConds(actor) {
  const roles = (actor && actor.roles) || [];
  if (hasAny(roles, ROLE.SENIOR)) { return 'all'; }
  const conds = [];
  if (roles.indexOf('class_teacher') !== -1 && actor.classId) { conds.push({ classId: actor.classId }); }
  if ((roles.indexOf('hod') !== -1 || roles.indexOf('department_admin') !== -1) && actor.departmentId) {
    conds.push({ departmentId: actor.departmentId });
  }
  return conds.length ? conds : null;
}

function inStudentScope(actor, student) {
  const scope = studentScopeConds(actor);
  if (!scope) { return false; }
  if (scope === 'all') { return true; }
  return scope.some(function (c) {
    if (c.classId)      { return !!student.classId      && String(student.classId)      === String(c.classId); }
    if (c.departmentId) { return !!student.departmentId && String(student.departmentId) === String(c.departmentId); }
    return false;
  });
}

/* ---------- may actor ASK target for a connection? ---------- */
function canRequestConnection(actor, target) {
  if (!actor || !target) { return false; }
  if (actor.kind === target.kind && String(actor.id) === String(target.id)) { return false; }
  const v = viewerTypeOf(actor);
  if (v === 'staff') {
    if (target.kind === 'staff')  { return true; }
    if (target.kind === 'parent') { return true; }
    if (target.kind === 'student') {
      if (target.subtype === 'alumni') { return target.visibility !== 'private'; }
      return inStudentScope(actor, target);
    }
    return false;
  }
  if (v === 'parent') { return target.kind === 'staff' && staffVisibleTo('parent', target.roles); }
  if (v === 'alumni') { return target.kind === 'staff' && staffVisibleTo('alumni', target.roles); }
  return false; /* active students never start requests */
}

/* ---------- pair keys ---------- */
function partyKey(p) { return p.kind + ':' + String(p.uid); }
function orderedParties(a, b) { return partyKey(a) <= partyKey(b) ? [a, b] : [b, a]; }
function pairKey(schoolId, a, b) {
  const o = orderedParties(a, b);
  return String(schoolId) + '|' + partyKey(o[0]) + '|' + partyKey(o[1]);
}

/* ---------- query parsing ---------- */
function parseQuery(rawQ, rawCategory) {
  const q = cleanText(rawQ, 80);
  const category = (typeof rawCategory === 'string' && CATEGORY_LIST.indexOf(rawCategory) !== -1) ? rawCategory : 'all';
  if (!q) { return { mode: 'browse', category: category, q: '' }; }
  if (looksLikeEmail(q)) { return { mode: 'email', category: category, email: normalizeEmail(q), q: q }; }
  const word = q.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WORD_CATEGORY, word)) {
    return { mode: 'browse', category: WORD_CATEGORY[word], q: '', viaWord: true };
  }
  if (q.length < 2) { return { mode: 'invalid', category: category, error: 'QUERY_TOO_SHORT' }; }
  return { mode: 'name', category: category, name: q, q: q };
}

function parsePaging(rawPage, rawLimit) {
  let page = parseInt(rawPage, 10);
  if (!(page >= 1)) { page = 1; }
  if (page > 500) { page = 500; }
  let limit = parseInt(rawLimit, 10);
  if (!(limit >= 1)) { limit = 20; }
  if (limit > 20) { limit = 20; }
  return { page: page, limit: limit, skip: (page - 1) * limit };
}

/* ---------- output whitelist ---------- */
function shapeMember(m) {
  const out = {
    kind:        m.kind,
    id:          String(m.id),
    subtype:     m.subtype,
    displayName: cleanText(m.name, 120) || 'Unnamed',
    subtitle:    cleanText(m.subtitle || '', 160),
    roleKey:     m.roleKey || m.subtype,
    roleLabel:   m.roleLabel || ''
  };
  if ((m.kind === 'staff' || m.kind === 'parent') && typeof m.email === 'string' && m.email) { out.email = m.email; }
  return out;
}

module.exports = {
  ROLE, ROLE_LABELS, KINDS, CATEGORY_LIST, VIEWER_CATEGORIES,
  httpError, isObjectIdString, cleanText, escapeRegex, nameRegex, normalizeEmail, looksLikeEmail,
  unique, hasAny, roleSet, staffRoleLabel,
  viewerTypeOf, staffRolesVisibleTo, staffVisibleTo, staffRoleFilter, kindsFor,
  studentScopeConds, inStudentScope, canRequestConnection,
  partyKey, orderedParties, pairKey,
  parseQuery, parsePaging, shapeMember
};
