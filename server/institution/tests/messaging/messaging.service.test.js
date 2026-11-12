'use strict';
/* Run: node tests/messaging/messaging.service.test.js
   No database needed: models are replaced by tests/messaging/fakeDb.js */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const H = require('./harness');
const M = H.models;

const dir  = require(H.ROOT + '/services/messaging.directory.js');
const conn = require(H.ROOT + '/services/messaging.connections.js');
const guard = require(H.ROOT + '/middleware/messaging.guard.js');

const S1 = 'a00000000000000000000001', S2 = 'a00000000000000000000002', S3 = 'a00000000000000000000003';
const C1 = 'c00000000000000000000001', C2 = 'c00000000000000000000002', D1 = 'd00000000000000000000001';
let n = 0;
const oid = function () { return 'b' + ('00000000000000000000000' + (++n).toString(16)).slice(-23); };

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

let ids;
function seed() {
  H.resetAll();
  const staff = function (name, role, extra) {
    return M.SchoolUser.__seed(Object.assign({ name: name, email: name.toLowerCase().replace(/\s/g, '') + '@gmail.com',
      schoolId: S1, role: role, additionalRoles: [], isActive: true, isVerified: true, phone: '0800SECRET', googleId: 'g' }, extra || {}));
  };
  ids = {};
  ids.admin     = staff('Ada Admin', 'school_admin');
  ids.principal = staff('Pat Principal', 'principal');
  ids.teacher   = staff('Tola Teacher', 'teacher');
  ids.ct        = staff('Cleo ClassTeacher', 'class_teacher', { classId: C1 });
  ids.ctNoClass = staff('Nia NoClass', 'class_teacher');
  ids.hod       = staff('Hal Hod', 'hod', { departmentId: D1 });
  ids.bursar    = staff('Bola Bursar', 'bursar');
  ids.inactive  = staff('Ina Inactive', 'teacher', { isActive: false });
  ids.unverif   = staff('Una Unverified', 'teacher', { isVerified: false });
  ids.otherSch  = staff('Olu Other', 'teacher', { schoolId: S2 });

  const kid = function (name, extra) { return M.SchoolStudent.__seed(Object.assign({ name: name, schoolId: S1, status: 'active', class: 'JSS1', classId: C1, admissionNo: 'A' + (++n), pinCode: 'HASH', email: 'kid@x.com' }, extra || {})); };
  ids.kid1 = kid('Kemi Kid');
  ids.kid2 = kid('Kunle Kid', { classId: C2, class: 'JSS2' });
  ids.kidD = kid('Dara Dept', { classId: null, departmentId: D1 });
  ids.grad = kid('Gina Grad', { status: 'graduated' });
  ids.grad2 = kid('Gus Grad', { status: 'graduated' });
  ids.gradNoProfile = kid('Gil Nope', { status: 'graduated' });
  ids.kidS2 = kid('Sam Other', { schoolId: S2 });
  M.AlumniProfile.__seed({ schoolId: S1, studentId: ids.grad._id,  displayName: 'Gina Grad', status: 'active', directoryVisibility: 'public', graduationSession: '2020', profession: 'Engineer' });
  M.AlumniProfile.__seed({ schoolId: S1, studentId: ids.grad2._id, displayName: 'Gus Grad',  status: 'active', directoryVisibility: 'private' });

  const parent = function (name, children, extra) {
    return M.SchoolParent.__seed(Object.assign({ name: name, email: name.toLowerCase().replace(/\s/g, '') + '@gmail.com', isActive: true, googleId: 'g',
      linkedStudents: children.map(function (c) { return { studentId: c._id, schoolId: c.schoolId }; }) }, extra || {}));
  };
  ids.par1 = parent('Peter Parent', [ids.kid1, ids.kidS2]);
  ids.par2 = parent('Paula Parent', [ids.kid2]);
  ids.parOff = parent('Pia Inactive', [ids.kid1], { isActive: false });
  ids.parGrad = parent('Pam Graduate', [ids.grad]);

  M.School.__seed({ _id: S1, name: 'School One', isSubscriptionActive: true });
  M.School.__seed({ _id: S2, name: 'School Two', isSubscriptionActive: true });
  M.School.findById = function (id) {
    const d = M.School.__docs.find(function (x) { return x._id === String(id); });
    return { select: function () { return Promise.resolve(d); } };
  };
}

const actor = {
  staff: function (rec) { return { kind: 'staff', id: rec._id, idStr: rec._id, schoolId: S1, schoolIdStr: S1, name: rec.name, roles: [rec.role].concat(rec.additionalRoles || []), classId: rec.classId || null, departmentId: rec.departmentId || null }; },
  parent: function (rec) { return { kind: 'parent', id: rec._id, idStr: rec._id, schoolId: S1, schoolIdStr: S1, name: rec.name, roles: [] }; },
  student: function (rec, isAlumni) { return { kind: 'student', id: rec._id, idStr: rec._id, schoolId: S1, schoolIdStr: S1, name: rec.name, roles: [], isAlumni: !!isAlumni }; }
};
const names = function (r) { return r.items.map(function (i) { return i.displayName; }).sort(); };
async function rejects(p, status, code) {
  try { await p; } catch (e) { assert.strictEqual(e.status, status, 'status ' + e.status + ' / ' + e.message); if (code) { assert.strictEqual(e.code, code); } return; }
  assert.fail('expected rejection ' + status);
}

/* ================= DIRECTORY ================= */
test('staff browsing "teachers": only active verified same-school teachers, no private fields', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.admin), { category: 'teachers' });
  assert.deepStrictEqual(names(r), ['Cleo ClassTeacher', 'Hal Hod', 'Nia NoClass', 'Tola Teacher']);
  r.items.forEach(function (i) {
    assert(!('phone' in i) && !('googleId' in i) && !('pinCode' in i));
    assert(i.email && i.roleLabel);
  });
});
test('typing the word "teacher" behaves like the Teachers category', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.admin), { q: 'teacher' });
  assert.strictEqual(r.category, 'teachers'); assert.strictEqual(r.items.length, 4);
});
test('exact email finds one person; partial email finds nobody', async function () {
  const a = actor.staff(ids.admin);
  assert.strictEqual((await dir.searchDirectory(a, { q: 'tolateacher@gmail.com' })).items.length, 1);
  assert.strictEqual((await dir.searchDirectory(a, { q: 'TolaTeacher@Gmail.COM' })).items.length, 1);
  assert.strictEqual((await dir.searchDirectory(a, { q: 'tolateacher@' })).items.length, 0);
  assert.strictEqual((await dir.searchDirectory(a, { q: 'tolateacher@gmail.co' })).items.length, 0);
});
test('a regular-expression query matches nothing', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.admin), { q: '.*' });
  assert.strictEqual(r.items.length, 0);
});
test('staff browsing parents: only active parents with an active child here', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.teacher), { category: 'parents' });
  assert.deepStrictEqual(names(r), ['Paula Parent', 'Peter Parent']);
  r.items.forEach(function (i) { assert(i.email); });
});
test('parent cannot browse parents, students or alumni', async function () {
  const a = actor.parent(ids.par1);
  for (const c of ['parents', 'students', 'alumni']) {
    assert.strictEqual((await dir.searchDirectory(a, { category: c })).items.length, 0, c);
  }
  assert.strictEqual((await dir.searchDirectory(a, { q: 'parents' })).items.length, 0);
  assert.strictEqual((await dir.searchDirectory(a, { q: 'paulaparent@gmail.com' })).items.length, 0);
});
test('parent sees teaching staff and leadership, never the bursar, and a Finance Office entry', async function () {
  const r = await dir.searchDirectory(actor.parent(ids.par1), { category: 'all' });
  const ns = names(r);
  assert(ns.includes('Tola Teacher') && ns.includes('Pat Principal') && ns.includes('Finance Office'));
  assert(!ns.includes('Bola Bursar') && !ns.includes('Paula Parent'));
  const fin = r.items.find(function (i) { return i.kind === 'finance'; });
  assert.strictEqual(fin.canMessage, true); assert(!('email' in fin));
});
test('Finance Office is flagged unavailable when the school has no finance staff', async function () {
  H.resetAll();
  M.SchoolStudent.__seed({ _id: 'e0000000000000000000000a', schoolId: S1, status: 'active', name: 'K' });
  const par = M.SchoolParent.__seed({ name: 'P', email: 'p@gmail.com', isActive: true, linkedStudents: [{ studentId: 'e0000000000000000000000a', schoolId: S1 }] });
  const r = await dir.searchDirectory(actor.parent(par), { category: 'finance' });
  assert.strictEqual(r.items[0].available, false); assert.strictEqual(r.items[0].canMessage, false);
});
test('finance staff do not see a Finance Office entry (they are the inbox)', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.bursar), { category: 'finance' });
  assert.strictEqual(r.items.length, 0);
});
test('an active student has no directory at all', async function () {
  await rejects(dir.searchDirectory(actor.student(ids.kid1, false), { category: 'all' }), 403, 'DIRECTORY_NOT_AVAILABLE');
});
test('alumnus sees leadership and Finance Office only', async function () {
  const r = await dir.searchDirectory(actor.student(ids.grad, true), { category: 'all' });
  assert.deepStrictEqual(names(r), ['Ada Admin', 'Finance Office', 'Pat Principal']);
});
test('students are scoped: class teacher sees own class, no-class teacher sees none, admin sees all active', async function () {
  const s = function (rec) { return dir.searchDirectory(actor.staff(rec), { category: 'students' }); };
  assert.deepStrictEqual(names(await s(ids.ct)), ['Kemi Kid']);
  assert.strictEqual((await s(ids.ctNoClass)).items.length, 0);
  assert.strictEqual((await s(ids.teacher)).items.length, 0);
  assert.deepStrictEqual(names(await s(ids.hod)), ['Dara Dept']);
  assert.deepStrictEqual(names(await s(ids.admin)), ['Dara Dept', 'Kemi Kid', 'Kunle Kid']);
});
test('student output has no email, pin or phone', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.admin), { category: 'students' });
  r.items.forEach(function (i) { assert(!('email' in i) && !('pinCode' in i)); });
  assert.strictEqual((await dir.searchDirectory(actor.staff(ids.admin), { q: 'kid@x.com' })).items.filter(function (i) { return i.kind === 'student'; }).length, 0);
});
test('alumni: public shown, private hidden from staff, graduated without profile hidden', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.admin), { category: 'alumni' });
  assert.deepStrictEqual(names(r), ['Gina Grad']);
  assert.strictEqual(r.items[0].subtype, 'alumni');
});
test('staff search never returns themselves', async function () {
  const r = await dir.searchDirectory(actor.staff(ids.teacher), { category: 'teachers' });
  assert(!names(r).includes('Tola Teacher'));
});
test('connection status and permissions are attached to results', async function () {
  const a = actor.staff(ids.admin);
  await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id }, 'hello');
  const r = await dir.searchDirectory(a, { category: 'parents' });
  const p = r.items.find(function (i) { return i.id === ids.par1._id; });
  assert.strictEqual(p.connection.status, 'pending'); assert.strictEqual(p.connection.requestedByMe, true);
  assert.strictEqual(p.canRequest, false);
  const p2 = r.items.find(function (i) { return i.id === ids.par2._id; });
  assert.strictEqual(p2.canRequest, true); assert.strictEqual(p2.connection, null);
});
test('too-short query is rejected with 400', async function () {
  await rejects(dir.searchDirectory(actor.staff(ids.admin), { q: 'a' }), 400, 'QUERY_TOO_SHORT');
});

/* ================= CONNECTIONS ================= */
test('request creates a pending record and notifies the other person once', async function () {
  const a = actor.staff(ids.admin);
  const out = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id }, 'Hi');
  assert.strictEqual(out.outcome, 'requested'); assert.strictEqual(M.SchoolConnection.__docs.length, 1);
  assert.strictEqual(H.notifications.length, 1);
  assert.strictEqual(H.notifications[0].recipientType, 'parent'); assert.strictEqual(H.notifications[0].recipientId, ids.par1._id);
  assert(H.notifications[0].opts.dedupeKey.startsWith('conn:'));
});
test('asking twice does not create a second record or a second notification', async function () {
  const a = actor.staff(ids.admin);
  await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  const again = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  assert.strictEqual(again.outcome, 'already_requested');
  assert.strictEqual(M.SchoolConnection.__docs.length, 1); assert.strictEqual(H.notifications.length, 1);
});
test('only the other person can accept; the sender cannot answer their own request', async function () {
  const a = actor.staff(ids.admin), p = actor.parent(ids.par1);
  const r = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  await rejects(conn.respondToRequest(a, r.connection.id, 'accept'), 403, 'OWN_REQUEST');
  const ok = await conn.respondToRequest(p, r.connection.id, 'accept');
  assert.strictEqual(ok.outcome, 'accepted');
  await rejects(conn.respondToRequest(p, r.connection.id, 'accept'), 409, 'NOT_PENDING');
  assert(H.notifications.some(function (x) { return x.recipientType === 'staff' && x.opts.title.indexOf('accepted') !== -1; }));
});
test('a stranger cannot answer someone else\'s request', async function () {
  const r = await conn.requestConnection(actor.staff(ids.admin), { kind: 'parent', id: ids.par1._id });
  await rejects(conn.respondToRequest(actor.parent(ids.par2), r.connection.id, 'accept'), 404, 'NOT_FOUND');
  await rejects(conn.respondToRequest(actor.staff(ids.teacher), r.connection.id, 'accept'), 404, 'NOT_FOUND');
});
test('requests that cross each other are auto-accepted', async function () {
  await conn.requestConnection(actor.staff(ids.admin), { kind: 'staff', id: ids.teacher._id });
  const back = await conn.requestConnection(actor.staff(ids.teacher), { kind: 'staff', id: ids.admin._id });
  assert.strictEqual(back.outcome, 'accepted'); assert.strictEqual(M.SchoolConnection.__docs.length, 1);
  assert.strictEqual(M.SchoolConnection.__docs[0].status, 'accepted');
});
test('after a rejection either side may ask again; the same record is re-opened', async function () {
  const a = actor.staff(ids.admin), p = actor.parent(ids.par1);
  const r = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  await conn.respondToRequest(p, r.connection.id, 'reject');
  assert.strictEqual(M.SchoolConnection.__docs[0].status, 'rejected');
  const again = await conn.requestConnection(p, { kind: 'staff', id: ids.admin._id }, 'please?');
  assert.strictEqual(again.outcome, 'requested');
  const d = M.SchoolConnection.__docs[0];
  assert.strictEqual(M.SchoolConnection.__docs.length, 1); assert.strictEqual(d.status, 'pending'); assert.strictEqual(d.requestCount, 2);
  assert.strictEqual(d.requestedBy.kind, 'parent');
});
test('unfriend then ask again works; already connected is refused', async function () {
  const a = actor.staff(ids.admin), p = actor.parent(ids.par1);
  const r = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  await conn.respondToRequest(p, r.connection.id, 'accept');
  await rejects(conn.requestConnection(a, { kind: 'parent', id: ids.par1._id }), 409, 'ALREADY_CONNECTED');
  await conn.removeConnection(p, r.connection.id);
  assert.strictEqual(M.SchoolConnection.__docs[0].status, 'removed');
  assert.strictEqual((await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id })).outcome, 'requested');
});
test('the sender can withdraw a pending request; the receiver must use respond', async function () {
  const a = actor.staff(ids.admin), p = actor.parent(ids.par1);
  const r = await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  await rejects(conn.removeConnection(p, r.connection.id), 403, 'USE_RESPOND');
  assert.strictEqual((await conn.removeConnection(a, r.connection.id)).outcome, 'removed');
});
test('forbidden pairs look exactly like "not available"', async function () {
  await rejects(conn.requestConnection(actor.parent(ids.par1), { kind: 'parent', id: ids.par2._id }), 404, 'TARGET_UNAVAILABLE');
  await rejects(conn.requestConnection(actor.parent(ids.par1), { kind: 'student', id: ids.kid1._id }), 404, 'TARGET_UNAVAILABLE');
  await rejects(conn.requestConnection(actor.parent(ids.par1), { kind: 'staff', id: ids.bursar._id }), 404, 'TARGET_UNAVAILABLE');
  await rejects(conn.requestConnection(actor.student(ids.kid1, false), { kind: 'staff', id: ids.principal._id }), 404, 'TARGET_UNAVAILABLE');
  await rejects(conn.requestConnection(actor.student(ids.grad, true), { kind: 'staff', id: ids.teacher._id }), 404, 'TARGET_UNAVAILABLE');
  assert.strictEqual((await conn.requestConnection(actor.student(ids.grad, true), { kind: 'staff', id: ids.principal._id })).outcome, 'requested');
});
test('people who are inactive, unverified, in another school, or nonexistent cannot be asked', async function () {
  const a = actor.staff(ids.admin);
  for (const t of [{ kind: 'staff', id: ids.inactive._id }, { kind: 'staff', id: ids.unverif._id }, { kind: 'staff', id: ids.otherSch._id },
    { kind: 'parent', id: ids.parOff._id }, { kind: 'parent', id: ids.parGrad._id }, { kind: 'student', id: ids.kidS2._id },
    { kind: 'student', id: ids.gradNoProfile._id }, { kind: 'staff', id: oid() }]) {
    await rejects(conn.requestConnection(a, t), 404, 'TARGET_UNAVAILABLE');
  }
});
test('self requests and malformed targets are rejected before any lookup', async function () {
  const a = actor.staff(ids.admin);
  await rejects(conn.requestConnection(a, { kind: 'staff', id: ids.admin._id }), 400, 'SELF_REQUEST');
  await rejects(conn.requestConnection(a, { kind: { $ne: 1 }, id: ids.teacher._id }), 400, 'BAD_TARGET');
  await rejects(conn.requestConnection(a, { kind: 'staff', id: { $ne: null } }), 400, 'BAD_TARGET');
  await rejects(conn.requestConnection(a, { kind: 'admin', id: ids.teacher._id }), 400, 'BAD_TARGET');
  await rejects(conn.respondToRequest(a, { $ne: 1 }, 'accept'), 400, 'BAD_ID');
  await rejects(conn.respondToRequest(a, oid(), 'maybe'), 400, 'BAD_ACTION');
});
test('two simultaneous requests for the same pair leave exactly one record', async function () {
  const a = actor.staff(ids.admin);
  const rs = await Promise.all([
    conn.requestConnection(a, { kind: 'staff', id: ids.teacher._id }),
    conn.requestConnection(a, { kind: 'staff', id: ids.teacher._id })
  ]);
  assert.strictEqual(M.SchoolConnection.__docs.length, 1);
  assert(rs.every(function (r) { return r.outcome === 'requested' || r.outcome === 'already_requested'; }));
});
test('simultaneous cross-requests leave one accepted record', async function () {
  await Promise.all([
    conn.requestConnection(actor.staff(ids.admin), { kind: 'staff', id: ids.teacher._id }),
    conn.requestConnection(actor.staff(ids.teacher), { kind: 'staff', id: ids.admin._id })
  ]);
  assert.strictEqual(M.SchoolConnection.__docs.length, 1);
  assert.strictEqual(M.SchoolConnection.__docs[0].status, 'accepted');
});
test('deactivating a member makes the connection unavailable and hides their details', async function () {
  const a = actor.staff(ids.admin), t = actor.staff(ids.teacher);
  const r = await conn.requestConnection(a, { kind: 'staff', id: ids.teacher._id });
  await conn.respondToRequest(t, r.connection.id, 'accept');
  let list = await conn.listConnections(a);
  assert.strictEqual(list.accepted.length, 1); assert.strictEqual(list.accepted[0].available, true);
  M.SchoolUser.__docs.find(function (d) { return d._id === ids.teacher._id; }).isActive = false;
  list = await conn.listConnections(a);
  assert.strictEqual(list.accepted[0].available, false);
  assert.strictEqual(list.accepted[0].person.displayName, 'Former member');
  assert(!('email' in list.accepted[0].person));
});
test('a pending request from someone who was removed cannot be accepted', async function () {
  const r = await conn.requestConnection(actor.staff(ids.teacher), { kind: 'staff', id: ids.admin._id });
  M.SchoolUser.__docs.splice(M.SchoolUser.__docs.findIndex(function (d) { return d._id === ids.teacher._id; }), 1);
  await rejects(conn.respondToRequest(actor.staff(ids.admin), r.connection.id, 'accept'), 409, 'REQUESTER_UNAVAILABLE');
});
test('listConnections groups incoming / outgoing / accepted / past', async function () {
  const a = actor.staff(ids.admin);
  await conn.requestConnection(a, { kind: 'parent', id: ids.par1._id });
  await conn.requestConnection(actor.staff(ids.teacher), { kind: 'staff', id: ids.admin._id });
  const rej = await conn.requestConnection(actor.staff(ids.principal), { kind: 'staff', id: ids.admin._id });
  await conn.respondToRequest(a, rej.connection.id, 'reject');
  const l = await conn.listConnections(a);
  assert.strictEqual(l.outgoing.length, 1); assert.strictEqual(l.incoming.length, 1);
  assert.strictEqual(l.past.length, 1); assert.strictEqual(l.accepted.length, 0);
});
test('history is capped at 20 entries', async function () {
  const a = actor.staff(ids.admin), t = actor.staff(ids.teacher);
  const first = await conn.requestConnection(a, { kind: 'staff', id: ids.teacher._id });
  for (let i = 0; i < 15; i++) {
    await conn.respondToRequest(t, first.connection.id, 'reject');
    await conn.requestConnection(a, { kind: 'staff', id: ids.teacher._id });
  }
  assert(M.SchoolConnection.__docs[0].history.length <= 20);
});

/* ================= GUARDS ================= */
function fakeRes() { const r = { code: 200, body: null }; r.status = function (c) { r.code = c; return r; }; r.json = function (b) { r.body = b; return r; }; return r; }
async function runGuard(fn, req) { const res = fakeRes(); let nexted = false; await fn(req, res, function () { nexted = true; }); return { res: res, nexted: nexted, req: req }; }
process.env.JWT_SECRET = 'test-secret';

test('parent with one school gets it automatically; read-only follows the subscription', async function () {
  const par = M.SchoolParent.__seed({ name: 'Solo', email: 's@gmail.com', isActive: true, linkedStudents: [{ studentId: ids.kid1._id, schoolId: S1 }] });
  const out = await runGuard(guard.attachParentActor, { parent: par, query: {}, get: function () { return ''; } });
  assert(out.nexted); assert.strictEqual(out.req.msgActor.schoolIdStr, S1); assert.strictEqual(out.req.msgActor.school.writable, true);
});
test('parent with two schools must choose; a school they are not linked to is refused', async function () {
  const par = M.SchoolParent.__seed({ name: 'Duo', email: 'd@gmail.com', isActive: true, linkedStudents: [{ studentId: ids.kid1._id, schoolId: S1 }, { studentId: ids.kidS2._id, schoolId: S2 }] });
  const none = await runGuard(guard.attachParentActor, { parent: par, query: {}, get: function () { return ''; } });
  assert.strictEqual(none.res.code, 409); assert.strictEqual(none.res.body.code, 'SCHOOL_REQUIRED');
  const bad = await runGuard(guard.attachParentActor, { parent: par, query: {}, get: function (h) { return h === 'x-school-id' ? S3 : ''; } });
  assert.strictEqual(bad.res.code, 403); assert.strictEqual(bad.res.body.code, 'SCHOOL_NOT_LINKED');
  const good = await runGuard(guard.attachParentActor, { parent: par, query: { schoolId: S2 }, get: function () { return ''; } });
  assert(good.nexted); assert.strictEqual(good.req.msgActor.schoolIdStr, S2);
  const inj = await runGuard(guard.attachParentActor, { parent: par, query: { schoolId: { $ne: 1 } }, get: function () { return ''; } });
  assert.strictEqual(inj.res.code, 409);
});
test('parent with no linked school is refused', async function () {
  const par = M.SchoolParent.__seed({ name: 'None', email: 'n@gmail.com', isActive: true, linkedStudents: [] });
  const out = await runGuard(guard.attachParentActor, { parent: par, query: {}, get: function () { return ''; } });
  assert.strictEqual(out.res.code, 403); assert.strictEqual(out.res.body.code, 'NO_SCHOOL_LINK');
});
test('student guard: valid token works; wrong school, inactive, and alumni-without-profile are refused', async function () {
  const tok = function (sid, school, role) { return jwt.sign({ studentId: sid, schoolId: school, role: role || 'student' }, 'test-secret'); };
  const req = function (t) { return { headers: { authorization: 'Bearer ' + t } }; };
  const ok = await runGuard(guard.studentGuard, req(tok(ids.kid1._id, S1)));
  assert(ok.nexted); assert.strictEqual(ok.req.msgActor.isAlumni, false);
  const al = await runGuard(guard.studentGuard, req(tok(ids.grad._id, S1)));
  assert(al.nexted); assert.strictEqual(al.req.msgActor.isAlumni, true);
  assert.strictEqual((await runGuard(guard.studentGuard, req(tok(ids.kid1._id, S2)))).res.code, 401);
  assert.strictEqual((await runGuard(guard.studentGuard, req(tok(ids.gradNoProfile._id, S1)))).res.code, 403);
  M.SchoolStudent.__docs.find(function (d) { return d._id === ids.kid2._id; }).status = 'inactive';
  assert.strictEqual((await runGuard(guard.studentGuard, req(tok(ids.kid2._id, S1)))).res.code, 401);
  assert.strictEqual((await runGuard(guard.studentGuard, req(tok(ids.kid1._id, S1, 'teacher')))).res.code, 401);
  assert.strictEqual((await runGuard(guard.studentGuard, { headers: {} })).res.code, 401);
  assert.strictEqual((await runGuard(guard.studentGuard, req('garbage'))).res.code, 401);
  assert.strictEqual((await runGuard(guard.studentGuard, req(jwt.sign({ studentId: ids.kid1._id, schoolId: S1, role: 'student' }, 'wrong-secret')))).res.code, 401);
});
test('requireWritable blocks non-staff when the school is read-only', async function () {
  const blocked = await runGuard(guard.requireWritable, { msgActor: { school: { writable: false } } });
  assert.strictEqual(blocked.res.code, 403); assert.strictEqual(blocked.res.body.code, 'SCHOOL_READ_ONLY');
  assert((await runGuard(guard.requireWritable, { msgActor: { school: { writable: true } } })).nexted);
});

/* ================= ROUTES (HTTP) ================= */
test('HTTP: validation, injection payloads, and error shape', async function () {
  const express = require('express');
  const routesPath = H.ROOT + '/routes/messaging.routes.js';
  const gpath = require.resolve(H.ROOT + '/middleware/messaging.guard.js');
  const real = require.cache[gpath].exports;
  const setActor = function (q, s, nx) { q.msgActor = JSON.parse(q.headers['x-test-actor']); nx(); };
  require.cache[gpath].exports = Object.assign({}, real, { staffGuard: [setActor], parentGuard: [setActor], studentGuard: setActor });
  delete require.cache[require.resolve(routesPath)];
  const router = require(routesPath);
  require.cache[gpath].exports = real;

  const app = express(); app.use(express.json()); app.use('/m', router);
  const server = await new Promise(function (r) { const s = app.listen(0, function () { r(s); }); });
  const port = server.address().port;
  const call = function (method, url, body, a) {
    return new Promise(function (resolve, reject) {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request({ port: port, path: url, method: method, headers: Object.assign({ 'content-type': 'application/json', 'x-test-actor': JSON.stringify(a) }, data ? { 'content-length': Buffer.byteLength(data) } : {}) }, function (res) {
        let buf = ''; res.on('data', function (c) { buf += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      req.on('error', reject); if (data) { req.write(data); } req.end();
    });
  };
  try {
    const admin = Object.assign(actor.staff(ids.admin), { school: { name: 'S', writable: true } });
    const me = await call('GET', '/m/staff/me', undefined, admin);
    assert.strictEqual(me.status, 200); assert(me.body.categories.includes('parents'));
    const d = await call('GET', '/m/staff/directory?category=teachers', undefined, admin);
    assert.strictEqual(d.status, 200); assert.strictEqual(d.body.items.length, 4);
    const inj = await call('GET', '/m/staff/directory?category[$ne]=x&q[$ne]=y', undefined, admin);
    assert.strictEqual(inj.status, 200); assert.strictEqual(inj.body.category, 'all');
    const bad1 = await call('POST', '/m/staff/connections/request', { kind: { $ne: null }, id: { $gt: '' } }, admin);
    assert.strictEqual(bad1.status, 400); assert.strictEqual(bad1.body.code, 'BAD_TARGET');
    const bad2 = await call('POST', '/m/staff/connections/request', [1, 2], admin);
    assert.strictEqual(bad2.status, 400);
    const bad3 = await call('POST', '/m/staff/connections/request', { kind: 'student', id: ids.kid1._id, schoolId: S2, role: 'admin' }, admin);
    assert.strictEqual(bad3.status, 201); /* extra body fields are ignored */
    assert.strictEqual(M.SchoolConnection.__docs[0].schoolId, S1);
    const ok = await call('POST', '/m/staff/connections/request', { kind: 'parent', id: ids.par1._id, message: 'Hi' }, admin);
    assert.strictEqual(ok.status, 201); assert.strictEqual(ok.body.outcome, 'requested');
    const ro = await call('POST', '/m/parent/connections/request', { kind: 'staff', id: ids.teacher._id }, Object.assign(actor.parent(ids.par1), { school: { writable: false } }));
    assert.strictEqual(ro.status, 403); assert.strictEqual(ro.body.code, 'SCHOOL_READ_ONLY');
    const rd = await call('GET', '/m/parent/directory?category=all', undefined, Object.assign(actor.parent(ids.par1), { school: { writable: false } }));
    assert.strictEqual(rd.status, 200); /* reading still works */
    const st = await call('GET', '/m/student/directory', undefined, Object.assign(actor.student(ids.kid1, false), { school: { writable: true } }));
    assert.strictEqual(st.status, 403);
    const bad4 = await call('POST', '/m/staff/connections/abc/respond', { action: 'accept' }, admin);
    assert.strictEqual(bad4.status, 400);
    const l = await call('GET', '/m/staff/connections', undefined, admin);
    assert.strictEqual(l.status, 200); assert(Array.isArray(l.body.outgoing));
  } finally { server.close(); }
});

/* ================= RUN ================= */
(async function () {
  let passed = 0, failed = 0;
  for (const t of tests) {
    seed(); const origErr = console.error; console.error = function () {};
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); }
    console.error = origErr;
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
