// TEMPORARY TEST FILE — delete after testing
require('dotenv').config();
const mongoose = require('mongoose');

console.log('🔄 Testing MongoDB connection...');
console.log('URI starts with:', process.env.MONGODB_URI?.substring(0, 30) + '...');

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
})
.then(() => {
  console.log('✅ SUCCESS! MongoDB connected!');
  console.log('Database:', mongoose.connection.name);
  console.log('Host:', mongoose.connection.host);
  process.exit(0);
})
.catch(err => {
  console.log('❌ FAILED:', err.message);
  console.log('\nError type:', err.name);
  console.log('\nFull error code:', err.code);
  process.exit(1);
});