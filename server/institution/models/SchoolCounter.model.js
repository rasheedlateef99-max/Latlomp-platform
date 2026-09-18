'use strict';
const mongoose = require('mongoose');

/* ============================================
   LATLOMP — SCHOOL COUNTER (P2)

   Generic atomic sequence counter for the
   institution subsystem. Used for receipt number
   generation (replaces racy countDocuments approach).

   Each counter is keyed by a string _id:
     'rcpt:<schoolId>'  — receipt sequences
   
   findOneAndUpdate with $inc is a single atomic
   MongoDB operation — concurrency-safe.
   No application-level locking required.
============================================ */
const schoolCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.model('SchoolCounter', schoolCounterSchema);