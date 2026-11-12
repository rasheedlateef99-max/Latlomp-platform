'use strict';
/* ============================================
   LATLOMP — MESSAGING ROUTES (B1: directory + connections)
   Mounted at /api/institution/messaging

     /staff/...    staff login   (latlomp_inst_token)
     /parent/...   parent login  (parentToken)
     /student/...  student or alumni login (latlomp_student_token)

   Same handlers for all three; the guard in front of each
   builds req.msgActor. Nothing here reads schoolId, role or
   sender from the request body.
============================================ */
const express     = require('express');
const guard       = require('../middleware/messaging.guard');
const policy      = require('../services/messaging.policy');
const directory   = require('../services/messaging.directory');
const connections = require('../services/messaging.connections');

function sendError(res, err) {
  if (err && err.status) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
  console.error('[messaging]', (err && err.stack) || err);
  return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
}

function wrap(fn) {
  return function (req, res) {
    Promise.resolve().then(function () { return fn(req, res); }).catch(function (e) { sendError(res, e); });
  };
}

function api() {
  const r = express.Router();

  r.get('/me', wrap(async function (req, res) {
    const a = req.msgActor;
    const viewerType = policy.viewerTypeOf(a);
    res.json({
      success: true,
      me: { kind: a.kind, id: a.idStr, name: a.name, isAlumni: !!a.isAlumni },
      school: { id: a.schoolIdStr, name: a.school.name },
      writable: !!a.school.writable,
      categories: policy.VIEWER_CATEGORIES[viewerType] || []
    });
  }));

  r.get('/directory', guard.searchLimiter, wrap(async function (req, res) {
    res.json(await directory.searchDirectory(req.msgActor, {
      q: req.query.q, category: req.query.category, page: req.query.page, limit: req.query.limit
    }));
  }));

  r.get('/connections', wrap(async function (req, res) {
    const groups = await connections.listConnections(req.msgActor);
    res.json({ success: true, incoming: groups.incoming, outgoing: groups.outgoing, accepted: groups.accepted, past: groups.past });
  }));

  r.post('/connections/request', guard.requireWritable, guard.requestLimiter, wrap(async function (req, res) {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) { throw policy.httpError(400, 'BAD_BODY', 'Invalid request.'); }
    const out = await connections.requestConnection(req.msgActor, { kind: b.kind, id: b.id }, b.message);
    res.status(out.outcome === 'requested' ? 201 : 200).json({ success: true, outcome: out.outcome, connection: out.connection });
  }));

  r.post('/connections/:id/respond', guard.requireWritable, wrap(async function (req, res) {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) { throw policy.httpError(400, 'BAD_BODY', 'Invalid request.'); }
    const out = await connections.respondToRequest(req.msgActor, req.params.id, b.action);
    res.json({ success: true, outcome: out.outcome, connection: out.connection });
  }));

  r.delete('/connections/:id', guard.requireWritable, wrap(async function (req, res) {
    const out = await connections.removeConnection(req.msgActor, req.params.id);
    res.json({ success: true, outcome: out.outcome, connection: out.connection });
  }));

  return r;
}

const router = express.Router();
router.use('/staff',   guard.staffGuard,  api());
router.use('/parent',  guard.parentGuard, api());
router.use('/student', guard.studentGuard, api());

module.exports = router;
