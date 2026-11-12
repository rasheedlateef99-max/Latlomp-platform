'use strict';
/* Test harness: replaces the database models, auth middleware and the
   notification service with in-memory fakes BEFORE the messaging code loads.
   Works inside the real repo too (the real files are never executed). */
const path = require('path');
const { makeModel, newId } = require('./fakeDb');
const ROOT = path.join(__dirname, '..', '..', 'server', 'institution');

function stub(rel, exportsObj) {
  const f = require.resolve(path.join(ROOT, rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const models = {
  SchoolUser:       makeModel('SchoolUser'),
  SchoolParent:     makeModel('SchoolParent'),
  SchoolStudent:    makeModel('SchoolStudent'),
  AlumniProfile:    makeModel('AlumniProfile'),
  School:           makeModel('School'),
  SchoolConnection: makeModel('SchoolConnection', { unique: ['pairKey'] })
};
Object.keys(models).forEach(function (n) { stub('models/' + n + '.model.js', models[n]); });

const notifications = [];
stub('services/inst.notification.service.js', {
  notifyOne: async function (schoolId, recipientType, recipientId, opts) {
    notifications.push({ schoolId: String(schoolId), recipientType: recipientType, recipientId: String(recipientId), opts: opts });
    return {};
  }
});
stub('middleware/inst.auth.js',   { instProtect: function (q, s, n) { n(); }, teacherOrAdmin: function (q, s, n) { n(); } });
stub('middleware/inst.tenant.js', { requireActiveSubscription: function (q, s, n) { n(); } });
stub('middleware/parent.auth.js', { parentProtect: function (q, s, n) { n(); } });

function resetAll() { Object.keys(models).forEach(function (n) { models[n].__reset(); }); notifications.length = 0; }

module.exports = { models, notifications, resetAll, newId, ROOT };
