'use strict';
/* Run: node tests/messaging/messaging.policy.test.js   (no database needed) */
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', '..', 'server', 'institution', 'services', 'messaging.policy.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const staff   = function (roles, extra) { return Object.assign({ kind: 'staff', id: 's1', roles: roles }, extra || {}); };
const parent  = { kind: 'parent', id: 'p1', roles: [] };
const alumnus = { kind: 'student', id: 'a1', roles: [], isAlumni: true };
const student = { kind: 'student', id: 'x1', roles: [], isAlumni: false };

console.log('ids and text');
test('only 24-hex strings are ids', function () {
  assert(P.isObjectIdString('64a2b1c3d4e5f6789012abcd'));
  assert(!P.isObjectIdString({ $ne: null }));
  assert(!P.isObjectIdString(['64a2b1c3d4e5f6789012abcd']));
  assert(!P.isObjectIdString('short'));
});
test('regex characters in a name are escaped', function () {
  const rx = P.nameRegex('.*');
  assert(!rx.test('Mary Jones'));
  assert(rx.test('Dr. .* Smith'));
});
test('cleanText rejects non-strings and strips control characters', function () {
  assert.strictEqual(P.cleanText({ a: 1 }, 10), '');
  assert.strictEqual(P.cleanText('a\u0000b', 10), 'a b');
  assert.strictEqual(P.cleanText('abcdef', 3), 'abc');
});

console.log('query parsing');
test('role words become categories', function () {
  assert.strictEqual(P.parseQuery('parents').category, 'parents');
  assert.strictEqual(P.parseQuery('Teachers').category, 'teachers');
  assert.strictEqual(P.parseQuery('administrators').category, 'admin');
  assert.strictEqual(P.parseQuery('Finance').category, 'finance');
  assert.strictEqual(P.parseQuery('Finance').mode, 'browse');
});
test('full email is exact mode; partial email is only a name search', function () {
  const e = P.parseQuery('Jane.Doe@Gmail.com');
  assert.strictEqual(e.mode, 'email'); assert.strictEqual(e.email, 'jane.doe@gmail.com');
  assert.strictEqual(P.parseQuery('jane.doe@').mode, 'name');
});
test('one character is rejected, empty browses', function () {
  assert.strictEqual(P.parseQuery('a').mode, 'invalid');
  assert.strictEqual(P.parseQuery('').mode, 'browse');
  assert.strictEqual(P.parseQuery({ $ne: 1 }).mode, 'browse');
});
test('unknown or object categories fall back to all', function () {
  assert.strictEqual(P.parseQuery('', 'hackers').category, 'all');
  assert.strictEqual(P.parseQuery('', { $ne: 'x' }).category, 'all');
});
test('paging is clamped', function () {
  assert.deepStrictEqual(P.parsePaging('0', '999'), { page: 1, limit: 20, skip: 0 });
  assert.strictEqual(P.parsePaging('3', '10').skip, 20);
  assert.strictEqual(P.parsePaging({}, []).page, 1);
});

console.log('who can see whom');
test('viewer categories', function () {
  assert(P.VIEWER_CATEGORIES.staff.includes('parents'));
  assert(!P.VIEWER_CATEGORIES.parent.includes('parents'));
  assert(!P.VIEWER_CATEGORIES.parent.includes('students'));
  assert.deepStrictEqual(P.VIEWER_CATEGORIES.student, []);
});
test('parents see teaching staff and leadership but not the bursar', function () {
  assert(P.staffVisibleTo('parent', ['class_teacher']));
  assert(P.staffVisibleTo('parent', ['principal']));
  assert(!P.staffVisibleTo('parent', ['bursar']));
  assert(P.staffVisibleTo('parent', ['bursar', 'teacher']));
});
test('alumni see only leadership', function () {
  assert(P.staffVisibleTo('alumni', ['vice_principal']));
  assert(!P.staffVisibleTo('alumni', ['teacher']));
});
test('role filters are intersected with what the viewer may see', function () {
  assert.strictEqual(P.staffRoleFilter('staff', 'all'), null);
  assert(P.staffRoleFilter('parent', 'teachers').includes('class_teacher'));
  assert(!P.staffRoleFilter('parent', 'admin').includes('bursar'));
  assert.deepStrictEqual(P.staffRoleFilter('alumni', 'teachers'), []);
});
test('kinds searched per viewer', function () {
  assert(P.kindsFor('staff', 'all').includes('parent'));
  assert(!P.kindsFor('parent', 'all').includes('parent'));
  assert.deepStrictEqual(P.kindsFor('student', 'all'), []);
});

console.log('connection permissions');
test('staff may ask staff, parents and alumni', function () {
  assert(P.canRequestConnection(staff(['teacher']), { kind: 'staff', id: 's2', roles: ['teacher'] }));
  assert(P.canRequestConnection(staff(['teacher']), { kind: 'parent', id: 'p1' }));
  assert(P.canRequestConnection(staff(['teacher']), { kind: 'student', id: 'a1', subtype: 'alumni', visibility: 'public' }));
  assert(!P.canRequestConnection(staff(['teacher']), { kind: 'student', id: 'a1', subtype: 'alumni', visibility: 'private' }));
});
test('self request is refused', function () {
  assert(!P.canRequestConnection(staff(['teacher']), { kind: 'staff', id: 's1', roles: ['teacher'] }));
});
test('parents may only ask visible staff', function () {
  assert(P.canRequestConnection(parent, { kind: 'staff', id: 's2', roles: ['teacher'] }));
  assert(!P.canRequestConnection(parent, { kind: 'staff', id: 's3', roles: ['bursar'] }));
  assert(!P.canRequestConnection(parent, { kind: 'parent', id: 'p2' }));
  assert(!P.canRequestConnection(parent, { kind: 'student', id: 'x2', subtype: 'student' }));
});
test('alumni may ask leadership only; active students ask nobody', function () {
  assert(P.canRequestConnection(alumnus, { kind: 'staff', id: 's9', roles: ['principal'] }));
  assert(!P.canRequestConnection(alumnus, { kind: 'staff', id: 's2', roles: ['teacher'] }));
  assert(!P.canRequestConnection(student, { kind: 'staff', id: 's9', roles: ['principal'] }));
});
test('student scope fails closed', function () {
  const ct = staff(['class_teacher'], { classId: 'C1' });
  assert(P.canRequestConnection(ct, { kind: 'student', id: 'x1', subtype: 'student', classId: 'C1' }));
  assert(!P.canRequestConnection(ct, { kind: 'student', id: 'x2', subtype: 'student', classId: 'C2' }));
  assert(!P.canRequestConnection(staff(['class_teacher']), { kind: 'student', id: 'x1', subtype: 'student', classId: 'C1' }));
  assert(!P.canRequestConnection(staff(['teacher']), { kind: 'student', id: 'x1', subtype: 'student', classId: 'C1' }));
  assert(P.canRequestConnection(staff(['principal']), { kind: 'student', id: 'x2', subtype: 'student', classId: 'C2' }));
});

console.log('pair keys and output');
test('pair key is the same in both directions and differs by kind', function () {
  const a = { kind: 'staff', uid: 'aaa' }, b = { kind: 'parent', uid: 'bbb' };
  assert.strictEqual(P.pairKey('S1', a, b), P.pairKey('S1', b, a));
  assert.notStrictEqual(P.pairKey('S1', a, b), P.pairKey('S1', a, { kind: 'staff', uid: 'bbb' }));
});
test('shapeMember exposes only whitelisted fields', function () {
  const out = P.shapeMember({
    kind: 'staff', id: 'x', subtype: 'staff', name: 'Ada', email: 'ada@gmail.com', roleLabel: 'Teacher',
    phone: '0800', googleId: 'g', pinCode: 'hash', avatar: 'u'
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['displayName', 'email', 'id', 'kind', 'roleKey', 'roleLabel', 'subtitle', 'subtype'].sort());
});
test('students and alumni never get an email in output', function () {
  const out = P.shapeMember({ kind: 'student', id: 'x', subtype: 'student', name: 'Tobi', email: 'kid@x.com' });
  assert(!('email' in out));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
