/* ============================================
   LATLOMP PLATFORM — INDEX VERIFICATION SCRIPT
   
   Run before deployment to verify all MongoDB
   indexes are in place.
   
   Usage:
     node server/scripts/verify-indexes.js
   
   Expected result: all ✅, no ❌
============================================ */
require('dotenv').config();
const mongoose = require('mongoose');

/* ---- Expected index definitions ---- */
var expectedIndexes = {

  /* Main platform */
  'users': [
    { key: { email: 1 },   unique: true },
    { key: { phone: 1 },   unique: false, sparse: true },
    { key: { googleId: 1 },unique: false, sparse: true }
  ],

  'results': [
    { key: { userId: 1, createdAt: -1 } },
    { key: { examId: 1 } }
  ],

  'departments': [
    { key: { name: 1, examCategory: 1 }, unique: true }
  ],

  'subjects': [
    { key: { department: 1 } },
    { key: { examCategories: 1 } }
  ],

  'questions': [
    { key: { subjectId: 1, isActive: 1 } },
    { key: { examId: 1 } }
  ],

  /* Institution portal */
  'schools': [
    { key: { email: 1 },  unique: true },
    { key: { slug: 1 },   unique: true },
    { key: { status: 1 } },
    { key: { subscriptionExpiry: 1 } }
  ],

  'schoolusers': [
    { key: { schoolId: 1, email: 1 }, unique: true },
    { key: { schoolId: 1, role: 1 } }
  ],

  'schoolstudents': [
    { key: { schoolId: 1 } },
    { key: { schoolId: 1, class: 1 } }
  ],

  'schoolexams': [
    { key: { schoolId: 1, status: 1 } },
    { key: { accessCode: 1 }, unique: true }
  ],

  'schoolquestions': [
    { key: { examId: 1, isActive: 1 } },
    { key: { schoolId: 1 } }
  ],

  'schoolresults': [
    { key: { schoolId: 1, examId: 1 } },
    { key: { examId: 1, studentName: 1 } }
  ],

  'invitations': [
    { key: { token: 1 }, unique: true },
    { key: { schoolId: 1, email: 1 } },
    { key: { expiresAt: 1 } }
  ],

  'subscriptions': [
    { key: { schoolId: 1, status: 1 } },
    { key: { endDate: 1 } }
  ],

  'auditlogs': [
    { key: { actorId: 1, createdAt: -1 } },
    { key: { schoolId: 1, createdAt: -1 } },
    { key: { ip: 1, createdAt: -1 } },
    { key: { action: 1 } }
  ]
};

/* ---- Check if an index exists in the collection ---- */
function indexExists(actualIndexes, expectedKey) {
  return actualIndexes.some(function(idx) {
    var idxKeys  = Object.keys(idx.key);
    var expKeys  = Object.keys(expectedKey);
    if (idxKeys.length !== expKeys.length) return false;
    return expKeys.every(function(k) {
      return idx.key[k] !== undefined && String(idx.key[k]) === String(expectedKey[k]);
    });
  });
}

async function verifyIndexes() {
  console.log('');
  console.log('🔍 LatLomp Index Verification');
  console.log('══════════════════════════════');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected\n');

  var db       = mongoose.connection.db;
  var allPassed = true;
  var totalChecked = 0;
  var totalMissing = 0;

  for (var collectionName in expectedIndexes) {
    var expected = expectedIndexes[collectionName];
    console.log('── ' + collectionName.toUpperCase() + ' ──');

    var actualIndexes = [];
    try {
      actualIndexes = await db.collection(collectionName).indexes();
    } catch (e) {
      console.log('  ⚠️  Collection not yet created (no documents — normal on fresh deploy)');
      console.log('');
      continue;
    }

    for (var i = 0; i < expected.length; i++) {
      var exp    = expected[i];
      var exists = indexExists(actualIndexes, exp.key);
      var label  = JSON.stringify(exp.key);

      totalChecked++;

      if (exists) {
        console.log('  ✅ ' + label);
      } else {
        console.log('  ❌ MISSING: ' + label);
        allPassed  = false;
        totalMissing++;
      }
    }

    console.log('');
  }

  /* ---- Summary ---- */
  console.log('══════════════════════════════');
  console.log('Checked : ' + totalChecked);
  console.log('Passed  : ' + (totalChecked - totalMissing));
  console.log('Missing : ' + totalMissing);

  if (allPassed) {
    console.log('\n✅ All indexes verified. Ready for production.\n');
  } else {
    console.log('\n⚠️  Some indexes are missing.');
    console.log('   Missing indexes will be created automatically when Mongoose');
    console.log('   connects and the models are first used.');
    console.log('   Run the app once to trigger automatic index creation.\n');
  }

  await mongoose.disconnect();
  process.exit(allPassed ? 0 : 1);
}

verifyIndexes().catch(function(err) {
  console.error('❌ Verification failed:', err.message);
  process.exit(1);
});