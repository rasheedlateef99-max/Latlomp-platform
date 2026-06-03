/* ============================================
   LATLOMP PLATFORM — PRE-DEPLOYMENT CHECK
   
   Run this before every Railway deployment:
     node server/scripts/pre-deploy-check.js
   
   Checks:
   1. All required environment variables set
   2. MongoDB Atlas connection works
   3. Admin user exists
   4. Subscription plans seeded
   5. Critical routes accessible (if APP_URL set)
   
   Exit 0 = safe to deploy
   Exit 1 = problems found — fix before deploying
============================================ */
require('dotenv').config();

var passed  = 0;
var failed  = 0;
var warnings = 0;

function pass(msg)  { console.log('  ✅ ' + msg); passed++; }
function fail(msg)  { console.log('  ❌ ' + msg); failed++; }
function warn(msg)  { console.log('  ⚠️  ' + msg); warnings++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 40 - t.length))); }

async function run() {
  console.log('');
  console.log('🚀 LatLomp Pre-Deploy Check');
  console.log('════════════════════════════════════════');

  /* ============================================
     1. ENVIRONMENT VARIABLES
  ============================================ */
  section('Environment Variables');

  var required = {
    'MONGODB_URI':   'MongoDB Atlas connection string',
    'JWT_SECRET':    'JWT signing secret (min 32 chars recommended)'
  };

  var recommended = {
    'GOOGLE_CLIENT_ID':     'Google OAuth — sign-in will fail without this',
    'GOOGLE_CLIENT_SECRET': 'Google OAuth — sign-in will fail without this',
    'PAYSTACK_SECRET_KEY':  'Paystack — payments will fail without this',
    'PAYSTACK_PUBLIC_KEY':  'Paystack — frontend checkout will fail',
    'SENDGRID_API_KEY':     'Email delivery — invites and alerts will not send',
    'SENDGRID_FROM_EMAIL':  'Email sender address',
    'ADMIN_EMAIL':          'Admin dashboard login',
    'ADMIN_PASSWORD':       'Admin dashboard password',
    'APP_URL':              'Public URL — used in invite emails and redirects',
    'NODE_ENV':             'Should be "production" on Railway'
  };

  var allRequiredOk = true;

  Object.keys(required).forEach(function(key) {
    if (process.env[key]) {
      pass(key + ' — set');
    } else {
      fail(key + ' — MISSING (' + required[key] + ')');
      allRequiredOk = false;
    }
  });

  Object.keys(recommended).forEach(function(key) {
    if (process.env[key]) {
      pass(key + ' — set');
    } else {
      warn(key + ' — not set (' + recommended[key] + ')');
    }
  });

  /* JWT secret strength check */
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    warn('JWT_SECRET is only ' + process.env.JWT_SECRET.length + ' chars — use 32+ for production');
  } else if (process.env.JWT_SECRET) {
    pass('JWT_SECRET strength: OK (' + process.env.JWT_SECRET.length + ' chars)');
  }

  /* NODE_ENV check */
  if (process.env.NODE_ENV !== 'production') {
    warn('NODE_ENV is "' + (process.env.NODE_ENV || 'not set') + '" — should be "production" on Railway');
  }

  if (!allRequiredOk) {
    console.log('\n❌ Required env vars missing. Cannot continue checks.\n');
    process.exit(1);
  }

  /* ============================================
     2. MONGODB CONNECTION
  ============================================ */
  section('MongoDB Atlas Connection');

  var mongoose;
  try {
    mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    var state = mongoose.connection.readyState;
    if (state === 1) {
      pass('Connected to MongoDB Atlas');
      var adminDb = mongoose.connection.db.admin();
      var info    = await adminDb.serverInfo();
      pass('MongoDB version: ' + info.version);
    } else {
      fail('Connection state: ' + state + ' (expected 1)');
    }
  } catch (err) {
    fail('MongoDB connection failed: ' + err.message);
    console.log('\n❌ Cannot proceed without database. Check MONGODB_URI.\n');
    process.exit(1);
  }

  /* ============================================
     3. ADMIN USER
  ============================================ */
  section('Admin User');

  try {
    var User = require('../models/User.model');
    var adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    var admin = await User.findOne({ email: adminEmail, role: 'admin' });

    if (admin) {
      pass('Admin user exists: ' + adminEmail);
    } else {
      fail('Admin user NOT found for: ' + adminEmail);
      fail('Run: node server/scripts/seed-production.js');
    }
  } catch (err) {
    fail('Admin user check failed: ' + err.message);
  }

  /* ============================================
     4. INSTITUTION PLANS
  ============================================ */
  section('Subscription Plans');

  try {
    var { SubscriptionPlan } = require('../institution/models/Subscription.model');
    var planCount = await SubscriptionPlan.countDocuments({ isActive: true });

    if (planCount >= 4) {
      pass('Subscription plans seeded: ' + planCount + ' active plans');
    } else if (planCount > 0) {
      warn('Only ' + planCount + ' plans found — expected at least 4');
      warn('Run: node server/scripts/seed-production.js');
    } else {
      fail('No subscription plans found');
      fail('Run: node server/scripts/seed-production.js');
    }
  } catch (err) {
    fail('Plan check failed: ' + err.message);
  }

  /* ============================================
     5. PACKAGE DEPENDENCIES
  ============================================ */
  section('Critical npm Packages');

  var criticalPkgs = [
    'express', 'mongoose', 'jsonwebtoken', 'bcryptjs',
    'cors', 'dotenv', 'google-auth-library',
    '@sendgrid/mail', 'twilio'
  ];

  var securityPkgs = [
    'helmet', 'express-rate-limit',
    'express-mongo-sanitize', 'xss-clean', 'compression'
  ];

  criticalPkgs.forEach(function(pkg) {
    try { require(pkg); pass(pkg); }
    catch (e) { fail(pkg + ' — NOT INSTALLED (run: npm install ' + pkg + ')'); }
  });

  securityPkgs.forEach(function(pkg) {
    try { require(pkg); pass(pkg + ' (security)'); }
    catch (e) { warn(pkg + ' not installed — run: npm install ' + pkg); }
  });

  /* ============================================
     6. HTTP HEALTH CHECK (if APP_URL set)
  ============================================ */
  if (process.env.APP_URL) {
    section('Live Health Check');
    var appUrl = process.env.APP_URL.replace(/\/$/, '');

    try {
      var https = require('https');
      var http  = require('http');
      var mod   = appUrl.startsWith('https') ? https : http;

      await new Promise(function(resolve, reject) {
        var req = mod.get(appUrl + '/api/health', { timeout: 8000 }, function(res) {
          var body = '';
          res.on('data', function(d) { body += d; });
          res.on('end', function() {
            try {
              var data = JSON.parse(body);
              if (res.statusCode === 200 && data.success) {
                pass('Live health check: ' + appUrl + '/api/health');
                pass('Server status: ' + data.status + ' | uptime: ' + data.uptime);
              } else {
                warn('Health check returned status ' + res.statusCode);
              }
            } catch (e) { warn('Health check response not JSON'); }
            resolve();
          });
        });
        req.on('error', function(e) { warn('Health check request failed: ' + e.message); resolve(); });
        req.on('timeout', function() { warn('Health check timed out'); req.destroy(); resolve(); });
      });
    } catch (e) {
      warn('Health check skipped: ' + e.message);
    }
  }

  /* ============================================
     FINAL REPORT
  ============================================ */
  await mongoose.disconnect();

  console.log('\n════════════════════════════════════════');
  console.log('Passed   : ' + passed);
  console.log('Warnings : ' + warnings);
  console.log('Failed   : ' + failed);
  console.log('');

  if (failed === 0 && warnings <= 3) {
    console.log('🟢 READY FOR DEPLOYMENT\n');
    process.exit(0);
  } else if (failed === 0) {
    console.log('🟡 DEPLOY WITH CAUTION — address warnings before going live\n');
    process.exit(0);
  } else {
    console.log('🔴 NOT READY — fix failed checks before deploying\n');
    process.exit(1);
  }
}

run().catch(function(err) {
  console.error('\n❌ Pre-deploy check crashed:', err.message);
  process.exit(1);
});