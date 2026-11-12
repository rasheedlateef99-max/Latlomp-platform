'use strict';
/* ============================================
   LATLOMP — MESSAGING CONNECTIONS (B1)

   request / respond / remove / list.

   Rules enforced here (never in the browser):
   - the target is re-checked against the database on every call
     and must be a CURRENT member the actor is allowed to ask
   - one record per pair (unique pairKey); the same record is
     re-opened after a rejection or removal
   - A→B while B→A is pending = both want it → auto-accepted
   - only the OTHER party may accept or reject
   - state changes are single atomic findOneAndUpdate calls
     guarded by the expected current status (no read-then-write races)
   - deactivated / removed members make a connection "unavailable"
     whatever its stored status says
============================================ */
const SchoolConnection = require('../models/SchoolConnection.model');
const notifSvc         = require('./inst.notification.service');
const policy           = require('./messaging.policy');
const members          = require('./messaging.members');

const RECIPIENT_TYPE = { staff: 'staff', parent: 'parent', student: 'student' };

function partyOfActor(actor)  { return { kind: actor.kind, uid: actor.id }; }
function partyOfMember(m)     { return { kind: m.kind, uid: m.id }; }
function isMe(party, actor)   { return !!party && party.kind === actor.kind && String(party.uid) === String(actor.id); }
function otherParty(conn, actor) { return isMe(conn.a, actor) ? conn.b : conn.a; }

function participantFilter(actor) {
  return { $or: [
    { 'a.kind': actor.kind, 'a.uid': actor.id },
    { 'b.kind': actor.kind, 'b.uid': actor.id }
  ] };
}

function historyPush(status, party, at) {
  return { history: { $each: [{ status: status, by: party, at: at }], $slice: -20 } };
}

function notify(actor, otherKind, otherId, conn, title, body) {
  /* fire and forget — notifyOne never throws */
  return notifSvc.notifyOne(actor.schoolId, RECIPIENT_TYPE[otherKind], otherId, {
    title: title, body: body, entityType: 'connection', entityId: conn._id,
    dedupeKey: 'conn:' + String(conn._id)
  });
}

function plain(doc) { return doc && typeof doc.toObject === 'function' ? doc.toObject() : doc; }

function present(conn, actor) {
  return {
    id: String(conn._id), status: conn.status,
    requestedByMe: isMe(conn.requestedBy, actor),
    requestedAt: conn.requestedAt || null, respondedAt: conn.respondedAt || null, removedAt: conn.removedAt || null
  };
}

/* ---------- request ---------- */
async function requestConnection(actor, targetRef, rawMessage, _retry) {
  if (!targetRef || policy.KINDS.indexOf(targetRef.kind) === -1 || !policy.isObjectIdString(targetRef.id)) {
    throw policy.httpError(400, 'BAD_TARGET', 'Invalid person.');
  }
  if (targetRef.kind === actor.kind && String(targetRef.id) === String(actor.id)) {
    throw policy.httpError(400, 'SELF_REQUEST', 'You cannot connect with yourself.');
  }
  /* Same answer for "does not exist" and "not allowed": no probing. */
  const target = await members.loadMember(actor.schoolId, { kind: targetRef.kind, id: targetRef.id });
  if (!target || !policy.canRequestConnection(actor, target)) {
    throw policy.httpError(404, 'TARGET_UNAVAILABLE', 'This person is not available.');
  }

  const me = partyOfActor(actor), them = partyOfMember(target);
  const key = policy.pairKey(actor.schoolIdStr, me, them);
  const message = policy.cleanText(rawMessage, 300);
  const now = new Date();
  const ordered = policy.orderedParties(me, them);

  try {
    const created = plain(await SchoolConnection.create({
      schoolId: actor.schoolId, pairKey: key, a: ordered[0], b: ordered[1],
      requestedBy: me, status: 'pending', message: message, requestedAt: now,
      requestCount: 1, history: [{ status: 'pending', by: me, at: now }]
    }));
    notify(actor, target.kind, target.id, created, (actor.name || 'Someone') + ' sent you a connection request', message || 'Open Messages to respond.');
    return { outcome: 'requested', connection: present(created, actor) };
  } catch (err) {
    if (!err || err.code !== 11000) { throw err; }
  }

  /* A record for this pair already exists. */
  const existing = await SchoolConnection.findOne({ pairKey: key, schoolId: actor.schoolId }).lean();
  if (!existing) { throw policy.httpError(409, 'CONFLICT', 'Please try again.'); }

  if (existing.status === 'accepted') {
    throw policy.httpError(409, 'ALREADY_CONNECTED', 'You are already connected.');
  }
  if (existing.status === 'pending') {
    if (isMe(existing.requestedBy, actor)) {
      return { outcome: 'already_requested', connection: present(existing, actor) };
    }
    /* They asked me first: both sides want it. */
    const accepted = await SchoolConnection.findOneAndUpdate(
      { _id: existing._id, schoolId: actor.schoolId, status: 'pending' },
      { $set: { status: 'accepted', respondedAt: now }, $push: historyPush('accepted', me, now) },
      { new: true }
    ).lean();
    if (accepted) {
      notify(actor, target.kind, target.id, accepted, (actor.name || 'Someone') + ' accepted your connection request', 'You can now message each other.');
      return { outcome: 'accepted', connection: present(accepted, actor) };
    }
    throw policy.httpError(409, 'CONFLICT', 'Please try again.');
  }

  /* rejected or removed: either side may ask again (same record re-opened) */
  const reopened = await SchoolConnection.findOneAndUpdate(
    { _id: existing._id, schoolId: actor.schoolId, status: { $in: ['rejected', 'removed'] } },
    {
      $set: { status: 'pending', requestedBy: me, requestedAt: now, message: message, respondedAt: null, removedAt: null, removedBy: null },
      $inc: { requestCount: 1 },
      $push: historyPush('pending', me, now)
    },
    { new: true }
  ).lean();
  if (reopened) {
    notify(actor, target.kind, target.id, reopened, (actor.name || 'Someone') + ' sent you a connection request', message || 'Open Messages to respond.');
    return { outcome: 'requested', connection: present(reopened, actor) };
  }
  if (!_retry) { return requestConnection(actor, targetRef, rawMessage, true); } /* state moved under us: re-evaluate once */
  throw policy.httpError(409, 'CONFLICT', 'Please try again.');
}

/* ---------- respond (accept / reject) ---------- */
async function respondToRequest(actor, id, action) {
  if (!policy.isObjectIdString(id)) { throw policy.httpError(400, 'BAD_ID', 'Invalid request.'); }
  if (action !== 'accept' && action !== 'reject') { throw policy.httpError(400, 'BAD_ACTION', 'Action must be accept or reject.'); }

  const conn = await SchoolConnection.findOne(
    Object.assign({ _id: id, schoolId: actor.schoolId }, participantFilter(actor))
  ).lean();
  if (!conn) { throw policy.httpError(404, 'NOT_FOUND', 'Connection request not found.'); }
  if (conn.status !== 'pending') { throw policy.httpError(409, 'NOT_PENDING', 'This request has already been handled.'); }
  if (isMe(conn.requestedBy, actor)) { throw policy.httpError(403, 'OWN_REQUEST', 'You cannot answer your own request.'); }

  const other = otherParty(conn, actor);
  const sender = await members.loadMember(actor.schoolId, { kind: other.kind, id: other.uid });
  if (!sender) { throw policy.httpError(409, 'REQUESTER_UNAVAILABLE', 'The sender is no longer available.'); }

  const next = action === 'accept' ? 'accepted' : 'rejected';
  const now = new Date();
  const updated = await SchoolConnection.findOneAndUpdate(
    { _id: conn._id, schoolId: actor.schoolId, status: 'pending' },
    { $set: { status: next, respondedAt: now }, $push: historyPush(next, partyOfActor(actor), now) },
    { new: true }
  ).lean();
  if (!updated) { throw policy.httpError(409, 'NOT_PENDING', 'This request has already been handled.'); }

  if (next === 'accepted') {
    notify(actor, sender.kind, sender.id, updated, (actor.name || 'Someone') + ' accepted your connection request', 'You can now message each other.');
  }
  return { outcome: next, connection: present(updated, actor) };
}

/* ---------- remove (unfriend, or withdraw my own pending request) ---------- */
async function removeConnection(actor, id) {
  if (!policy.isObjectIdString(id)) { throw policy.httpError(400, 'BAD_ID', 'Invalid connection.'); }
  const conn = await SchoolConnection.findOne(
    Object.assign({ _id: id, schoolId: actor.schoolId }, participantFilter(actor))
  ).lean();
  if (!conn) { throw policy.httpError(404, 'NOT_FOUND', 'Connection not found.'); }
  if (conn.status !== 'accepted' && conn.status !== 'pending') {
    throw policy.httpError(409, 'NOT_ACTIVE', 'This connection is already closed.');
  }
  if (conn.status === 'pending' && !isMe(conn.requestedBy, actor)) {
    throw policy.httpError(403, 'USE_RESPOND', 'Accept or reject this request instead.');
  }
  const now = new Date();
  const updated = await SchoolConnection.findOneAndUpdate(
    { _id: conn._id, schoolId: actor.schoolId, status: conn.status },
    { $set: { status: 'removed', removedAt: now, removedBy: partyOfActor(actor) }, $push: historyPush('removed', partyOfActor(actor), now) },
    { new: true }
  ).lean();
  if (!updated) { throw policy.httpError(409, 'CONFLICT', 'Please try again.'); }
  return { outcome: 'removed', connection: present(updated, actor) };
}

/* ---------- list ---------- */
async function listConnections(actor) {
  const rows = await SchoolConnection.find(
    Object.assign({ schoolId: actor.schoolId }, participantFilter(actor))
  ).sort({ updatedAt: -1 }).limit(200).lean();

  const refs = rows.map(function (c) { const o = otherParty(c, actor); return { kind: o.kind, id: o.uid }; });
  const found = await members.loadMembers(actor.schoolId, refs);

  const out = { incoming: [], outgoing: [], accepted: [], past: [] };
  rows.forEach(function (c) {
    const o = otherParty(c, actor);
    const m = found.get(o.kind + ':' + o.uid) || null;
    const item = Object.assign(present(c, actor), {
      message: c.status === 'pending' ? (c.message || '') : '',
      available: !!m,
      person: m ? policy.shapeMember(m)
                : { kind: o.kind, id: String(o.uid), displayName: 'Former member', subtitle: '', roleKey: o.kind, roleLabel: '' }
    });
    if (c.status === 'accepted') { out.accepted.push(item); }
    else if (c.status === 'pending') { (item.requestedByMe ? out.outgoing : out.incoming).push(item); }
    else { out.past.push(item); }
  });
  return out;
}

module.exports = { requestConnection, respondToRequest, removeConnection, listConnections, participantFilter, isMe, otherParty };
