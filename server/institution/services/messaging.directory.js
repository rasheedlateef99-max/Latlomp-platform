'use strict';
/* ============================================
   LATLOMP — MESSAGING DIRECTORY (B1)

   Browse by category or search by name / role word /
   exact registered email. Every rule is enforced here
   on the server; the frontend only displays results.

   - schoolId always comes from the authenticated actor.
   - Email search is EXACT only (no partial matching) so the
     directory cannot be used to enumerate addresses.
   - Name search is escaped (never a raw regular expression).
   - Students and alumni have no verified email: their email
     is never searched or returned.
   - Output goes through policy.shapeMember (field whitelist).
============================================ */
const SchoolUser       = require('../models/SchoolUser.model');
const SchoolParent     = require('../models/SchoolParent.model');
const SchoolStudent    = require('../models/SchoolStudent.model');
const AlumniProfile    = require('../models/AlumniProfile.model');
const SchoolConnection = require('../models/SchoolConnection.model');
const policy           = require('./messaging.policy');
const members          = require('./messaging.members');

const EMPTY = { items: [], total: 0 };

function verifiedStaffFilter(actor) {
  return { schoolId: actor.schoolId, isActive: true, isVerified: { $ne: false } };
}

async function queryStaff(actor, parsed, paging, viewerType) {
  const filter = verifiedStaffFilter(actor);
  if (actor.kind === 'staff') { filter._id = { $ne: actor.id }; }
  const roleList = policy.staffRoleFilter(viewerType, parsed.category);
  if (Array.isArray(roleList)) {
    if (!roleList.length) { return EMPTY; }
    filter.$or = [{ role: { $in: roleList } }, { additionalRoles: { $in: roleList } }];
  }
  if (parsed.mode === 'email')     { filter.email = parsed.email; }
  else if (parsed.mode === 'name') { filter.name  = policy.nameRegex(parsed.name); }
  const rows = await SchoolUser.find(filter).select(members.STAFF_FIELDS)
    .sort({ name: 1 }).skip(paging.skip).limit(paging.limit).lean();
  const total = await SchoolUser.countDocuments(filter);
  return { items: rows.map(members.staffDescriptor), total: total };
}

async function queryParents(actor, parsed, paging) {
  const ids = await SchoolStudent.distinct('_id', { schoolId: actor.schoolId, status: 'active' });
  if (!ids.length) { return EMPTY; }
  const filter = {
    isActive: true,
    linkedStudents: { $elemMatch: { schoolId: actor.schoolId, studentId: { $in: ids } } }
  };
  if (parsed.mode === 'email')     { filter.email = parsed.email; }
  else if (parsed.mode === 'name') { filter.name  = policy.nameRegex(parsed.name); }
  const rows = await SchoolParent.find(filter).select('name email')
    .sort({ name: 1 }).skip(paging.skip).limit(paging.limit).lean();
  const total = await SchoolParent.countDocuments(filter);
  return { items: rows.map(members.parentDescriptor), total: total };
}

async function queryStudents(actor, parsed, paging) {
  if (parsed.mode === 'email') { return EMPTY; } /* student emails are unverified: never searched */
  const scope = policy.studentScopeConds(actor);
  if (!scope) { return EMPTY; }                  /* fail closed */
  const filter = { schoolId: actor.schoolId, status: 'active' };
  if (scope !== 'all') { filter.$or = scope; }
  if (parsed.mode === 'name') { filter.name = policy.nameRegex(parsed.name); }
  const rows = await SchoolStudent.find(filter).select(members.STUDENT_FIELDS)
    .sort({ name: 1 }).skip(paging.skip).limit(paging.limit).lean();
  const total = await SchoolStudent.countDocuments(filter);
  return { items: rows.map(function (s) { return members.studentDescriptor(s, null); }), total: total };
}

async function queryAlumni(actor, parsed, paging) {
  if (parsed.mode === 'email') { return EMPTY; }
  const filter = {
    schoolId: actor.schoolId, status: 'active',
    directoryVisibility: { $in: ['alumni_only', 'public'] } /* 'private' is hidden from everyone */
  };
  if (parsed.mode === 'name') { filter.displayName = policy.nameRegex(parsed.name); }
  const profiles = await AlumniProfile.find(filter).select(members.PROFILE_FIELDS)
    .sort({ displayName: 1 }).skip(paging.skip).limit(paging.limit).lean();
  const total = await AlumniProfile.countDocuments(filter);
  if (!profiles.length) { return EMPTY; }
  const grads = await SchoolStudent.find({
    _id: { $in: profiles.map(function (p) { return String(p.studentId); }) },
    schoolId: actor.schoolId, status: 'graduated'
  }).select(members.STUDENT_FIELDS).lean();
  const gradMap = new Map(grads.map(function (s) { return [String(s._id), s]; }));
  const items = [];
  profiles.forEach(function (p) {
    const s = gradMap.get(String(p.studentId));
    if (s) { items.push(members.studentDescriptor(s, p)); }
  });
  return { items: items, total: total };
}

async function queryFinance(actor, parsed) {
  if (policy.hasAny(actor.roles || [], policy.ROLE.FINANCE)) { return EMPTY; } /* they ARE the inbox */
  const showEntry = parsed.mode === 'browse' ||
    (parsed.mode === 'name' && 'finance office'.indexOf(parsed.name.toLowerCase()) !== -1);
  if (!showEntry) { return EMPTY; }
  const f = verifiedStaffFilter(actor);
  f.$or = [{ role: { $in: policy.ROLE.FINANCE } }, { additionalRoles: { $in: policy.ROLE.FINANCE } }];
  const count = await SchoolUser.countDocuments(f);
  return {
    items: [{
      kind: 'finance', id: String(actor.schoolId), subtype: 'finance',
      name: 'Finance Office', subtitle: 'Shared inbox · no connection needed',
      roleKey: 'finance', roleLabel: 'Finance', available: count > 0
    }],
    total: 1
  };
}

const QUERY = {
  staff: queryStaff, parent: queryParents, student: queryStudents,
  alumni: queryAlumni, finance: queryFinance
};

function samePartyRef(party, actor) {
  return !!party && party.kind === actor.kind && String(party.uid) === String(actor.id);
}

function toResult(actor, d, conn) {
  const base = policy.shapeMember(d);
  if (d.kind === 'finance') {
    base.action = 'contact_finance';
    base.available = d.available !== false;
    base.connection = null; base.canRequest = false; base.canRespond = false;
    base.canMessage = base.available;
    return base;
  }
  let canRequest = policy.canRequestConnection(actor, d);
  let canMessage = false, canRespond = false, connection = null;
  if (conn) {
    const mine = samePartyRef(conn.requestedBy, actor);
    connection = { id: String(conn._id), status: conn.status, requestedByMe: mine };
    if (conn.status === 'accepted') { canRequest = false; canMessage = true; }
    else if (conn.status === 'pending') { canRequest = false; canRespond = !mine; }
  }
  return Object.assign(base, { connection: connection, canRequest: canRequest, canMessage: canMessage, canRespond: canRespond });
}

async function searchDirectory(actor, params) {
  params = params || {};
  const viewerType = policy.viewerTypeOf(actor);
  const allowed = policy.VIEWER_CATEGORIES[viewerType] || [];
  if (!allowed.length) {
    throw policy.httpError(403, 'DIRECTORY_NOT_AVAILABLE', 'Your account cannot browse the directory.');
  }
  const parsed = policy.parseQuery(params.q, params.category);
  if (parsed.mode === 'invalid') {
    throw policy.httpError(400, parsed.error, 'Type at least 2 characters to search.');
  }
  const paging = policy.parsePaging(params.page, params.limit);
  const base = { success: true, query: parsed.q, category: parsed.category, categories: allowed.slice() };

  if (allowed.indexOf(parsed.category) === -1) {
    return Object.assign(base, { items: [], total: 0, page: 1, pages: 1 });
  }

  const kinds = policy.kindsFor(viewerType, parsed.category);
  const single = kinds.length === 1;
  const per = single ? paging : { page: 1, limit: 8, skip: 0 };
  let descriptors = [];
  let total = 0;
  for (let i = 0; i < kinds.length; i++) {
    const r = await QUERY[kinds[i]](actor, parsed, per, viewerType);
    descriptors = descriptors.concat(r.items);
    total += r.total;
  }

  const real = descriptors.filter(function (d) { return d.kind !== 'finance'; });
  const keys = real.map(function (d) {
    return policy.pairKey(actor.schoolIdStr, { kind: actor.kind, uid: actor.id }, { kind: d.kind, uid: d.id });
  });
  const conns = keys.length
    ? await SchoolConnection.find({ pairKey: { $in: keys } }).select('pairKey status requestedBy').lean()
    : [];
  const byKey = new Map(conns.map(function (c) { return [c.pairKey, c]; }));

  const items = descriptors.map(function (d) {
    const key = d.kind === 'finance' ? null
      : policy.pairKey(actor.schoolIdStr, { kind: actor.kind, uid: actor.id }, { kind: d.kind, uid: d.id });
    return toResult(actor, d, key ? byKey.get(key) : null);
  });
  if (!single) { items.sort(function (x, y) { return x.displayName.localeCompare(y.displayName); }); }

  return Object.assign(base, {
    items: items, total: total,
    page: single ? paging.page : 1,
    pages: single ? Math.max(1, Math.ceil(total / paging.limit)) : 1
  });
}

module.exports = { searchDirectory, toResult };
