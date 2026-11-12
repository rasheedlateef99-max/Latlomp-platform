'use strict';
/* Run: node tests/messaging/messaging.schema.test.js  (validates the two Mongoose schemas; no database) */
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'server', 'institution');
const Conn = require(path.join(ROOT, 'models', 'SchoolConnection.model.js'));
const Notif = require(path.join(ROOT, 'models', 'SchoolNotification.model.js'));
let ok = 0, bad = 0;
function t(n, f) { try { f(); ok++; console.log('  ok   ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n       ' + e.message); } }
const id = '64a2b1c3d4e5f6789012abcd', id2 = '64a2b1c3d4e5f6789012abce';
const party = function (k, u) { return { kind: k, uid: u }; };

t('valid connection passes validation', function () {
  const d = new Conn({ schoolId: id, pairKey: 'k', a: party('staff', id), b: party('parent', id2), requestedBy: party('staff', id) });
  assert.strictEqual(d.validateSync(), undefined); assert.strictEqual(d.status, 'pending'); assert.strictEqual(d.requestCount, 1);
});
t('unknown kind, status or missing pairKey are rejected', function () {
  const e1 = new Conn({ schoolId: id, pairKey: 'k', a: party('admin', id), b: party('parent', id2), requestedBy: party('staff', id) }).validateSync();
  assert(e1 && e1.errors['a.kind']);
  const e2 = new Conn({ schoolId: id, pairKey: 'k', a: party('staff', id), b: party('parent', id2), requestedBy: party('staff', id), status: 'blocked' }).validateSync();
  assert(e2 && e2.errors.status);
  const e3 = new Conn({ schoolId: id, a: party('staff', id), b: party('parent', id2), requestedBy: party('staff', id) }).validateSync();
  assert(e3 && e3.errors.pairKey);
});
t('message longer than 300 characters is rejected', function () {
  const e = new Conn({ schoolId: id, pairKey: 'k', a: party('staff', id), b: party('parent', id2), requestedBy: party('staff', id), message: 'x'.repeat(301) }).validateSync();
  assert(e && e.errors.message);
});
t('connection indexes: unique pairKey plus both participant lookups', function () {
  const idx = Conn.schema.indexes();
  assert(idx.some(function (i) { return i[0].pairKey === 1 && i[1].unique === true; }));
  assert(idx.some(function (i) { return i[0]['a.uid'] === 1; }) && idx.some(function (i) { return i[0]['b.uid'] === 1; }));
});
t('notification keeps the old shape and gains dedupeKey', function () {
  const d = new Notif({ schoolId: id, recipientType: 'staff', recipientId: id2, type: 'general', title: 'Hi' });
  assert.strictEqual(d.validateSync(), undefined); assert.strictEqual(d.dedupeKey, undefined);
  assert.strictEqual(new Notif({ schoolId: id, recipientType: 'alumni', type: 'general', title: 'x' }).validateSync().errors.recipientType.kind, 'enum');
});
t('notification partial unique index is scoped to unread, non-deleted, string dedupeKey', function () {
  const hit = Notif.schema.indexes().find(function (i) { return i[0].dedupeKey === 1; });
  assert(hit && hit[1].unique === true);
  assert.deepStrictEqual(hit[1].partialFilterExpression, { dedupeKey: { $type: 'string' }, isRead: false, isDeleted: false });
});
t('original notification indexes are still present (incl. 90-day expiry)', function () {
  const idx = Notif.schema.indexes();
  assert(idx.some(function (i) { return i[1] && i[1].expireAfterSeconds === 7776000; }));
  assert(idx.some(function (i) { return i[0].recipientId === 1 && i[0].isRead === 1; }));
});
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
