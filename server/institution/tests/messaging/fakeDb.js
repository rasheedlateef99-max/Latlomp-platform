'use strict';
/* In-memory stand-in for the few Mongoose calls the messaging services make.
   It is NOT MongoDB: it proves the application logic (filters built, rules
   applied, state machine) but not index behaviour or real query planning. */

let SEQ = 0;
function newId() { return ('000000000000000000000000' + (++SEQ).toString(16)).slice(-24); }

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v), reviveDates); }
function reviveDates(k, v) { return (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)) ? new Date(v) : v; }

function getRaw(doc, path) {
  return path.split('.').reduce(function (c, p) { return c == null ? undefined : c[p]; }, doc);
}
function getValues(doc, path) {
  let cur = [doc];
  path.split('.').forEach(function (p) {
    const next = [];
    cur.forEach(function (c) {
      if (c == null) { return; }
      const v = c[p];
      if (Array.isArray(v)) { v.forEach(function (x) { next.push(x); }); } else if (v !== undefined) { next.push(v); }
    });
    cur = next;
  });
  return cur;
}
function eq(a, b) {
  if (a == null || b == null) { return a == b; }
  return String(a) === String(b);
}
function isOps(c) { return c && typeof c === 'object' && !(c instanceof Date) && !(c instanceof RegExp) && Object.keys(c).some(function (k) { return k[0] === '$'; }); }

function condMatch(values, cond) {
  if (cond instanceof RegExp) { return values.some(function (v) { return typeof v === 'string' && cond.test(v); }); }
  if (isOps(cond)) {
    return Object.keys(cond).every(function (op) {
      const arg = cond[op];
      if (op === '$in')     { return values.some(function (v) { return arg.some(function (a) { return eq(v, a); }); }); }
      if (op === '$nin')    { return !values.some(function (v) { return arg.some(function (a) { return eq(v, a); }); }); }
      if (op === '$ne')     { return !values.some(function (v) { return eq(v, arg); }); }
      if (op === '$exists') { return arg ? values.length > 0 : values.length === 0; }
      throw new Error('fakeDb: unsupported operator ' + op);
    });
  }
  if (cond === null) { return values.length === 0 || values.every(function (v) { return v == null; }); }
  return values.some(function (v) { return eq(v, cond); });
}

function matches(doc, filter) {
  return Object.keys(filter || {}).every(function (k) {
    const cond = filter[k];
    if (k === '$or')  { return cond.some(function (f) { return matches(doc, f); }); }
    if (k === '$and') { return cond.every(function (f) { return matches(doc, f); }); }
    if (cond && typeof cond === 'object' && cond.$elemMatch) {
      const raw = getRaw(doc, k);
      return Array.isArray(raw) && raw.some(function (el) { return matches(el, cond.$elemMatch); });
    }
    return condMatch(getValues(doc, k), cond);
  });
}

function setPath(doc, path, val) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null) { cur[parts[i]] = {}; } cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val;
}
function applyUpdate(doc, upd) {
  Object.keys(upd.$set || {}).forEach(function (k) { setPath(doc, k, clone(upd.$set[k])); });
  Object.keys(upd.$inc || {}).forEach(function (k) { setPath(doc, k, (getRaw(doc, k) || 0) + upd.$inc[k]); });
  Object.keys(upd.$push || {}).forEach(function (k) {
    const spec = upd.$push[k];
    const arr = getRaw(doc, k) || [];
    if (spec && spec.$each) {
      spec.$each.forEach(function (x) { arr.push(clone(x)); });
      setPath(doc, k, typeof spec.$slice === 'number' && spec.$slice < 0 ? arr.slice(spec.$slice) : arr);
    } else { arr.push(clone(spec)); setPath(doc, k, arr); }
  });
}

function project(doc, fields) {
  if (!fields) { return clone(doc); }
  const out = { _id: doc._id };
  fields.split(/\s+/).filter(Boolean).forEach(function (f) { if (doc[f] !== undefined) { out[f] = clone(doc[f]); } });
  return out;
}

class Query {
  constructor(run, raw) { this._run = run; this._raw = !!raw; this._sel = null; this._sort = null; this._skip = 0; this._lim = null; }
  select(s) { this._sel = s; return this; }
  sort(s)   { this._sort = s; return this; }
  skip(n)   { this._skip = n; return this; }
  limit(n)  { this._lim = n; return this; }
  lean()    { return this; }
  then(res, rej) { return this._exec().then(res, rej); }
  async _exec() {
    let rows = this._run();
    if (typeof rows === 'number' || this._raw) { return rows; }
    if (Array.isArray(rows)) {
      if (this._sort) {
        const key = Object.keys(this._sort)[0], dir = this._sort[key];
        rows = rows.slice().sort(function (a, b) {
          const x = a[key], y = b[key];
          const c = (typeof x === 'string' && typeof y === 'string') ? x.localeCompare(y) : (x > y ? 1 : x < y ? -1 : 0);
          return c * dir;
        });
      }
      rows = rows.slice(this._skip, this._lim == null ? undefined : this._skip + this._lim);
      return rows.map(function (d) { return project(d, this._sel); }, this);
    }
    return rows ? project(rows, this._sel) : null;
  }
}

function makeModel(name, opts) {
  opts = opts || {};
  const docs = [];
  const M = {
    modelName: name,
    __docs: docs,
    __seed: function (d) { const x = clone(d); if (!x._id) { x._id = newId(); } docs.push(x); return x; },
    __reset: function () { docs.length = 0; },
    find: function (f) { return new Query(function () { return docs.filter(function (d) { return matches(d, f); }); }); },
    findOne: function (f) { return new Query(function () { return docs.find(function (d) { return matches(d, f); }) || null; }); },
    countDocuments: function (f) { return new Query(function () { return docs.filter(function (d) { return matches(d, f); }).length; }); },
    distinct: function (field, f) { return new Query(function () { return docs.filter(function (d) { return matches(d, f); }).map(function (d) { return getRaw(d, field); }); }, true); },
    create: async function (d) {
      const x = clone(d);
      (opts.unique || []).forEach(function (u) {
        if (docs.some(function (e) { return eq(e[u], x[u]); })) { const err = new Error('E11000 duplicate key'); err.code = 11000; throw err; }
      });
      if (!x._id) { x._id = newId(); }
      x.createdAt = x.updatedAt = new Date();
      docs.push(x);
      return clone(x);
    },
    findOneAndUpdate: function (f, upd) {
      return new Query(function () {
        const d = docs.find(function (e) { return matches(e, f); });
        if (!d) { return null; }
        applyUpdate(d, upd); d.updatedAt = new Date();
        return d;
      });
    }
  };
  return M;
}

module.exports = { makeModel, newId, matches };
