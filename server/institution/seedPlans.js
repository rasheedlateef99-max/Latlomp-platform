require('dotenv').config();
const mongoose = require('mongoose');
const { SubscriptionPlan } = require('./models/Subscription.model');

async function seedPlans() {
  await mongoose.connect(process.env.MONGODB_URI);

  await SubscriptionPlan.deleteMany({});

  await SubscriptionPlan.insertMany([
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
      sortOrder:    3
    }
  ]);

  console.log('✅ Subscription plans seeded.');
  await mongoose.disconnect();
}

seedPlans().catch(console.error);