/* ============================================
   LATLOMP PLATFORM — DATABASE SEEDER
   ============================================
   
   This script fills the database with:
   - 1 Admin user
   - 3 Sample exams
   - 25 Sample questions
   - 4 Sample products
   
   Run with: npm run seed
   ============================================ */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./database');

// Import all models
const User     = require('../models/User.model');
const Exam     = require('../models/Exam.model');
const Question = require('../models/Question.model');
const Product  = require('../models/Product.model');
const Game     = require('../models/Game.model');

/* ============================================
   SEED DATA — EXAMS
   ============================================ */
const examsData = [
  {
    title: 'JAMB UTME Practice Test',
    description: 'Full JAMB-style practice covering General Knowledge, English, and Science.',
    type: 'jamb',
    subject: 'General',
    duration: 120,
    passMark: 50,
    difficulty: 'mixed',
    instructions: 'Read all questions carefully. You have 120 minutes. The exam will auto-submit when time ends.',
    isActive: true
  },
  {
    title: 'WAEC Mathematics Practice',
    description: 'Practice WAEC-style mathematics questions covering algebra, geometry, and arithmetic.',
    type: 'waec',
    subject: 'Mathematics',
    duration: 60,
    passMark: 50,
    difficulty: 'mixed',
    instructions: 'Answer all questions. Show working where necessary. You have 60 minutes.',
    isActive: true
  },
  {
    title: 'General Knowledge Quick Test',
    description: 'A quick 5-question test on Nigerian history, geography, and culture.',
    type: 'custom',
    subject: 'General Knowledge',
    duration: 15,
    passMark: 60,
    difficulty: 'easy',
    instructions: 'Answer all 5 questions. You have 15 minutes. Good luck!',
    isActive: true
  }
];

/* ============================================
   SEED DATA — PRODUCTS
   ============================================ */
const productsData = [
  {
    name: 'JAMB Mathematics Masterclass',
    description: 'Complete JAMB mathematics preparation guide with 500+ past questions and detailed solutions. Covers all topics from 2015 to 2024.',
    category: 'books',
    price: 2500,
    originalPrice: 5000,
    imageEmoji: '📗',
    isFeatured: true,
    isActive: true
  },
  {
    name: 'WAEC English Language Guide',
    description: 'Comprehensive WAEC English preparation with model answers, comprehension passages, and essay writing techniques.',
    category: 'books',
    price: 1800,
    imageEmoji: '📘',
    isActive: true
  },
  {
    name: 'Professional CV Template',
    description: 'Modern, ATS-friendly CV template designed for Nigerian job seekers. Editable Microsoft Word format. Includes cover letter template.',
    category: 'templates',
    price: 500,
    imageEmoji: '📄',
    isActive: true
  },
  {
    name: 'Web Development Fundamentals Course',
    description: 'Learn HTML, CSS, and JavaScript from scratch. 20 video lessons, projects, and certificate of completion. Perfect for beginners.',
    category: 'courses',
    price: 4000,
    originalPrice: 8000,
    imageEmoji: '🎓',
    isFeatured: true,
    isActive: true
  }
];

/* ============================================
   SEED DATA — GAMES
   ============================================ */
const gamesData = [
  {
    title: 'Quick Quiz Challenge',
    description: 'Test your general knowledge with 5 rapid-fire questions!',
    type: 'quiz',
    subject: 'General Knowledge',
    difficulty: 'easy',
    isActive: true
  },
  {
    title: 'Math Blitz',
    description: 'Speed math challenge — answer as many as you can in 60 seconds!',
    type: 'mathblitz',
    subject: 'Mathematics',
    difficulty: 'medium',
    isActive: true
  }
];

/* ============================================
   SEED DATA — QUESTIONS
   (We add these after exams are created,
   linking each question to its exam by ID)
   ============================================ */
function buildQuestionsData(exams) {
  const jamb = exams.find(e => e.type === 'jamb');
  const waec = exams.find(e => e.type === 'waec');
  const custom = exams.find(e => e.type === 'custom');

  return [
    // ============ JAMB QUESTIONS (10) ============
    {
      examId: jamb._id,
      question: 'What is the capital city of Nigeria?',
      options: ['Kano', 'Lagos', 'Abuja', 'Ibadan'],
      correctAnswer: 2,
      explanation: 'Abuja became Nigeria\'s capital in December 1991, replacing Lagos.',
      subject: 'Government', topic: 'Nigeria Geography', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'In which year did Nigeria gain independence?',
      options: ['1960', '1963', '1956', '1970'],
      correctAnswer: 0,
      explanation: 'Nigeria gained independence from Britain on October 1, 1960.',
      subject: 'History', topic: 'Nigerian History', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'What is the longest river in Africa?',
      options: ['Congo River', 'Niger River', 'Nile River', 'Zambezi River'],
      correctAnswer: 2,
      explanation: 'The Nile River is Africa\'s longest at approximately 6,650 km, flowing through 11 countries.',
      subject: 'Geography', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'What is the chemical symbol for Gold?',
      options: ['Go', 'Gd', 'Au', 'Ag'],
      correctAnswer: 2,
      explanation: 'Au comes from the Latin word "Aurum" meaning gold. Ag is silver (Argentum).',
      subject: 'Chemistry', topic: 'Periodic Table', difficulty: 'medium'
    },
    {
      examId: jamb._id,
      question: 'What is 25% of 400?',
      options: ['75', '100', '125', '50'],
      correctAnswer: 1,
      explanation: '25% of 400 = (25 ÷ 100) × 400 = 0.25 × 400 = 100.',
      subject: 'Mathematics', topic: 'Percentages', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'Which planet is closest to the Sun?',
      options: ['Venus', 'Earth', 'Mercury', 'Mars'],
      correctAnswer: 2,
      explanation: 'Mercury is the closest planet to the Sun, orbiting at about 57.9 million km.',
      subject: 'Physics', topic: 'Solar System', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'Who wrote the novel "Things Fall Apart"?',
      options: ['Wole Soyinka', 'Ngugi wa Thiong\'o', 'Chinua Achebe', 'Ben Okri'],
      correctAnswer: 2,
      explanation: 'Things Fall Apart was written by Chinua Achebe and published in 1958. It\'s one of the most widely read African novels.',
      subject: 'Literature', topic: 'African Literature', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'What does CPU stand for?',
      options: ['Central Power Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Core Processing Unit'],
      correctAnswer: 1,
      explanation: 'CPU stands for Central Processing Unit — the main chip that runs programs in a computer.',
      subject: 'Computer Science', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'Water boils at what temperature (°C) at sea level?',
      options: ['90°C', '95°C', '98°C', '100°C'],
      correctAnswer: 3,
      explanation: 'Water boils at 100°C (212°F) at standard sea-level atmospheric pressure (1 atm).',
      subject: 'Chemistry', topic: 'States of Matter', difficulty: 'easy'
    },
    {
      examId: jamb._id,
      question: 'What is the value of π (pi) to 2 decimal places?',
      options: ['3.12', '3.14', '3.16', '3.18'],
      correctAnswer: 1,
      explanation: 'π ≈ 3.14159265... so to 2 decimal places it is 3.14.',
      subject: 'Mathematics', topic: 'Constants', difficulty: 'easy'
    },

    // ============ WAEC MATHS QUESTIONS (10) ============
    {
      examId: waec._id,
      question: 'Simplify: 3x + 2x - x',
      options: ['4x', '5x', '6x', '3x'],
      correctAnswer: 0,
      explanation: '3x + 2x - x = (3 + 2 - 1)x = 4x.',
      subject: 'Mathematics', topic: 'Algebra', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'Find x if 2x + 6 = 14',
      options: ['3', '4', '5', '6'],
      correctAnswer: 1,
      explanation: '2x = 14 - 6 = 8, therefore x = 8 ÷ 2 = 4.',
      subject: 'Mathematics', topic: 'Linear Equations', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'What is the area of a rectangle with length 8cm and width 5cm?',
      options: ['30cm²', '35cm²', '40cm²', '45cm²'],
      correctAnswer: 2,
      explanation: 'Area of rectangle = length × width = 8 × 5 = 40cm².',
      subject: 'Mathematics', topic: 'Mensuration', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'Calculate: 5² + 3²',
      options: ['30', '32', '34', '36'],
      correctAnswer: 2,
      explanation: '5² = 25, 3² = 9. So 25 + 9 = 34.',
      subject: 'Mathematics', topic: 'Indices', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'If a = 3 and b = 4, find √(a² + b²)',
      options: ['4', '5', '6', '7'],
      correctAnswer: 1,
      explanation: '√(3² + 4²) = √(9 + 16) = √25 = 5. This is the Pythagorean theorem!',
      subject: 'Mathematics', topic: 'Pythagoras', difficulty: 'medium'
    },
    {
      examId: waec._id,
      question: 'What is 20% of 250?',
      options: ['40', '45', '50', '55'],
      correctAnswer: 2,
      explanation: '20% of 250 = (20 ÷ 100) × 250 = 0.20 × 250 = 50.',
      subject: 'Mathematics', topic: 'Percentages', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'Factorize: x² - 9',
      options: ['(x-3)(x+3)', '(x+3)²', '(x-3)²', '(x-9)(x+1)'],
      correctAnswer: 0,
      explanation: 'x² - 9 = x² - 3² = (x-3)(x+3). This is the "difference of two squares" pattern.',
      subject: 'Mathematics', topic: 'Factorization', difficulty: 'medium'
    },
    {
      examId: waec._id,
      question: 'What is the LCM of 4 and 6?',
      options: ['8', '10', '12', '24'],
      correctAnswer: 2,
      explanation: 'LCM(4,6) = 12. The multiples of 4 are 4,8,12... and of 6 are 6,12... The first common one is 12.',
      subject: 'Mathematics', topic: 'LCM and HCF', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'Convert 0.75 to a fraction in lowest terms',
      options: ['1/2', '2/3', '3/4', '4/5'],
      correctAnswer: 2,
      explanation: '0.75 = 75/100 = 3/4 (dividing both by 25).',
      subject: 'Mathematics', topic: 'Fractions', difficulty: 'easy'
    },
    {
      examId: waec._id,
      question: 'The sum of interior angles in a triangle equals:',
      options: ['90°', '180°', '270°', '360°'],
      correctAnswer: 1,
      explanation: 'The sum of all three interior angles in any triangle is always 180°.',
      subject: 'Mathematics', topic: 'Geometry', difficulty: 'easy'
    },

    // ============ GENERAL KNOWLEDGE QUESTIONS (5) ============
    {
      examId: custom._id,
      question: 'How many states are in Nigeria?',
      options: ['34', '35', '36', '37'],
      correctAnswer: 2,
      explanation: 'Nigeria has 36 states and 1 FCT (Federal Capital Territory, Abuja).',
      subject: 'General Knowledge', difficulty: 'easy'
    },
    {
      examId: custom._id,
      question: 'What is the official language of Nigeria?',
      options: ['Yoruba', 'Hausa', 'Igbo', 'English'],
      correctAnswer: 3,
      explanation: 'English is Nigeria\'s official language, a legacy from British colonial rule.',
      subject: 'General Knowledge', difficulty: 'easy'
    },
    {
      examId: custom._id,
      question: 'What is the currency of Nigeria?',
      options: ['Dollar', 'Pound', 'Naira', 'Cedis'],
      correctAnswer: 2,
      explanation: 'The Nigerian Naira (₦) is the official currency of Nigeria.',
      subject: 'General Knowledge', difficulty: 'easy'
    },
    {
      examId: custom._id,
      question: 'Which continent is Nigeria located in?',
      options: ['Asia', 'Europe', 'Africa', 'South America'],
      correctAnswer: 2,
      explanation: 'Nigeria is located in West Africa, bordered by Benin, Niger, Chad, and Cameroon.',
      subject: 'General Knowledge', difficulty: 'easy'
    },
    {
      examId: custom._id,
      question: 'What does HTML stand for?',
      options: ['High Text ML', 'HyperText Markup Language', 'Home Tool Language', 'Hyperlink Text Mode'],
      correctAnswer: 1,
      explanation: 'HTML (HyperText Markup Language) is the standard language for creating web pages.',
      subject: 'Computer Science', difficulty: 'easy'
    }
  ];
}

/* ============================================
   MAIN SEED FUNCTION
   ============================================ */
async function seedDatabase() {
  try {
    // Connect to database
    await connectDB();

    console.log('\n🌱 Starting database seeding...\n');

    // ---- Step 1: Clear existing data ----
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Exam.deleteMany({});
    await Question.deleteMany({});
    await Product.deleteMany({});
    await Game.deleteMany({});
    console.log('✅ Existing data cleared\n');

   // ---- Step 2: Create admin user ----
console.log('👤 Creating admin user...');
const adminUser = await User.create({
  name: process.env.ADMIN_NAME || 'Platform Admin',
  email: process.env.ADMIN_EMAIL || 'admin@latlomp.com',
  password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  role: 'admin',
  isVerified: true
});
console.log(`✅ Admin created: ${adminUser.email}\n`);

// ---- Step 3: Create sample teacher ----
console.log('👤 Creating sample teacher...');
const teacherUser = await User.create({
  name: 'Mr. Adebayo',
  email: 'teacher@latlomp.com',
  password: 'Teacher@12345',
  role: 'teacher',
  isVerified: true
});
console.log(`✅ Teacher created: ${teacherUser.email}\n`);

// ---- Step 4: Create sample student account ----
console.log('👤 Creating sample student...');
await User.create({
  name: 'Test Student',
  email: 'student@latlomp.com',
  password: 'Student@12345',
  role: 'student',
  isVerified: true,
  profile: {
    school: 'Federal Government College',
    state: 'Lagos',
    examTarget: 'jamb'
  }
});
console.log('✅ Sample student created: student@latlomp.com\n');

    // ---- Step 4: Create exams ----
    console.log('📝 Creating exams...');
    const examsWithAdmin = examsData.map(e => ({ ...e, createdBy: adminUser._id }));
    const createdExams = await Exam.insertMany(examsWithAdmin);
    console.log(`✅ ${createdExams.length} exams created\n`);

    // ---- Step 5: Create questions ----
    console.log('❓ Creating questions...');
    const questionsData = buildQuestionsData(createdExams);
    const createdQuestions = await Question.insertMany(questionsData);
    console.log(`✅ ${createdQuestions.length} questions created\n`);

    // ---- Step 6: Update exam question counts ----
    console.log('🔄 Updating exam question counts...');
    for (const exam of createdExams) {
      const count = await Question.countDocuments({ examId: exam._id });
      await Exam.findByIdAndUpdate(exam._id, { totalQuestions: count });
    }
    console.log('✅ Exam question counts updated\n');

    // ---- Step 7: Create products ----
    console.log('🛒 Creating products...');
    const productsWithAdmin = productsData.map(p => ({ ...p, createdBy: adminUser._id }));
    const createdProducts = await Product.insertMany(productsWithAdmin);
    console.log(`✅ ${createdProducts.length} products created\n`);

   // ---- Step 8: Create games ----
console.log('🎮 Creating games...');
const gamesData = [
  {
    title:       'Quick Quiz Challenge',
    description: 'Answer 10 general knowledge questions as fast as you can!',
    type:        'quiz',
    subject:     'General Knowledge',
    difficulty:  'easy',
    isActive:    true,
    totalPlays:  0,
    highScore:   0
  },
  {
    title:       'Math Blitz',
    description: 'Speed maths challenge — answer as many as you can in 60 seconds!',
    type:        'mathblitz',
    subject:     'Mathematics',
    difficulty:  'medium',
    isActive:    true,
    totalPlays:  0,
    highScore:   0
  },
  {
    title:       'Word Challenge',
    description: 'Unscramble the letters to form the correct word before time runs out!',
    type:        'wordgame',
    subject:     'English / Vocabulary',
    difficulty:  'medium',
    isActive:    true,
    totalPlays:  0,
    highScore:   0
  }
];
const createdGames = await Game.insertMany(gamesData);
console.log(`✅ ${createdGames.length} games created\n`);

    // ---- Done! ----
    console.log('==========================================');
    console.log('  🌱 DATABASE SEEDING COMPLETE!');
    console.log('==========================================');
    console.log(`  👤 Users:     2 (admin + student)`);
    console.log(`  📝 Exams:     ${createdExams.length}`);
    console.log(`  ❓ Questions: ${createdQuestions.length}`);
    console.log(`  🛒 Products:  ${createdProducts.length}`);
    console.log(`  🎮 Games:     ${createdGames.length}`);
    console.log('==========================================');
console.log('\n🔑 SEEDED CREDENTIALS (TERMINAL ONLY — NEVER SHOW ON SCREEN):');
console.log(`  Admin:   ${process.env.ADMIN_EMAIL}`);
console.log('  Teacher: teacher@latlomp.com');
console.log('  Student: student@latlomp.com');
console.log('  ⚠️  Passwords are in your .env file only');
console.log('==========================================\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedDatabase();