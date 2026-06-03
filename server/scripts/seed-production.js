/* ============================================
   LATLOMP PLATFORM — PRODUCTION SEED SCRIPT
   
   Run ONCE before first deployment:
     node server/scripts/seed-production.js
   
   What it does:
   1. Creates admin user from ENV vars
   2. Seeds institution subscription plans
   3. Verifies existing data before writing
      (safe to re-run — never duplicates)
============================================ */
require('dotenv').config();
const mongoose = require('mongoose');

async function seed() {
  console.log('');
  console.log('🌱 LatLomp Production Seed');
  console.log('══════════════════════════');

  /* ---- Connect ---- */
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB Atlas\n');

  /* ============================================
     1. ADMIN USER
  ============================================ */
  console.log('── Admin User ──────────────────────────');

  var adminEmail    = (process.env.ADMIN_EMAIL    || '').trim().toLowerCase();
  var adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

  if (!adminEmail || !adminPassword) {
    console.warn('⚠️  ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin user seed.');
    console.warn('   Set these in Railway → Variables then re-run this script.\n');
  } else {
    var User  = require('../models/User.model');
    var bcrypt = require('bcryptjs');

    var existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      /* Update role to admin if somehow incorrect */
      if (existingAdmin.role !== 'admin') {
        await User.findByIdAndUpdate(existingAdmin._id, { $set: { role: 'admin' } });
        console.log('🔧 Updated existing user role to admin:', adminEmail);
      } else {
        console.log('✅ Admin user already exists:', adminEmail);
      }
    } else {
      var salt   = await bcrypt.genSalt(12);
      var hashed = await bcrypt.hash(adminPassword, salt);

      await User.create({
        name:       'Platform Admin',
        email:      adminEmail,
        password:   hashed,
        role:       'admin',
        isVerified: true,
        isActive:   true
      });

      console.log('✅ Admin user created:', adminEmail);
    }
  }

  /* ============================================
     2. INSTITUTION SUBSCRIPTION PLANS
  ============================================ */
  console.log('\n── Subscription Plans ──────────────────');

  var { SubscriptionPlan } = require('../institution/models/Subscription.model');

  var plans = [
    {
      name:         'Free Trial',
      code:         'trial',
      price:        0,
      durationDays: 7,
      maxTeachers:  3,
      maxStudents:  50,
      maxExams:     5,
      features:     ['3 teachers', '50 students', '5 exams', '7-day trial'],
      isActive:     true,
      isPopular:    false,
      sortOrder:    0
    },
    {
      name:         'Monthly Plan',
      code:         'monthly',
      price:        5000,
      durationDays: 30,
      maxTeachers:  10,
      maxStudents:  200,
      maxExams:     -1,
      features:     ['10 teachers', '200 students', 'Unlimited exams', 'Email support'],
      isActive:     true,
      isPopular:    false,
      sortOrder:    1
    },
    {
      name:         'Quarterly Plan',
      code:         'quarterly',
      price:        13000,
      durationDays: 90,
      maxTeachers:  20,
      maxStudents:  500,
      maxExams:     -1,
      features:     ['20 teachers', '500 students', 'Unlimited exams', 'Priority support', 'Save ₦2,000'],
      isActive:     true,
      isPopular:    true,
      sortOrder:    2
    },
    {
      name:         'Annual Plan',
      code:         'annual',
      price:        45000,
      durationDays: 365,
      maxTeachers:  -1,
      maxStudents:  -1,
      maxExams:     -1,
      features:     ['Unlimited teachers', 'Unlimited students', 'Unlimited exams', 'Dedicated support', 'Analytics dashboard', 'Save ₦15,000'],
      isActive:     true,
      isPopular:    false,
      sortOrder:    3
    }
  ];

  for (var i = 0; i < plans.length; i++) {
    var plan     = plans[i];
    var existing = await SubscriptionPlan.findOne({ code: plan.code });

    if (existing) {
      console.log('  ✓ Plan already exists: ' + plan.code + ' (₦' + plan.price.toLocaleString() + ')');
    } else {
      await SubscriptionPlan.create(plan);
      console.log('  ✅ Created plan: ' + plan.code + ' (₦' + plan.price.toLocaleString() + ')');
    }
  }

  /* ============================================
     3. SUMMARY
  ============================================ */
  console.log('\n── Summary ─────────────────────────────');

  var userCount = await User.countDocuments();
  var planCount = await SubscriptionPlan.countDocuments();

  console.log('  Platform users:        ' + userCount);
  console.log('  Subscription plans:    ' + planCount);

  console.log('\n✅ Seed complete. Ready for production.\n');

  await mongoose.disconnect();
}

seed().catch(function(err) {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});