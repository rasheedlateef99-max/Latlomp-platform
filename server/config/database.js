/* ============================================
   LATLOMP PLATFORM — DATABASE CONNECTION
   Phase 3 — Network-resilient version
   ============================================ */

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    console.log('📡 URI type:', process.env.MONGODB_URI?.startsWith('mongodb+srv') ? 'SRV (DNS)' : 'Direct');

    const options = {
      serverSelectionTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 20000,
      // Force direct connection to bypass SRV DNS lookup
      directConnection: false,
      // Try these if SRV fails
      ssl: true,
      tls: true,
    };

    const conn = await mongoose.connect(process.env.MONGODB_URI, options);

    console.log('==========================================');
    console.log('  ✅ MONGODB CONNECTED SUCCESSFULLY!');
    console.log(`  📦 Database: ${conn.connection.name}`);
    console.log(`  🌐 Host:     ${conn.connection.host}`);
    console.log('==========================================\n');

    return conn;

  } catch (error) {
    console.error('==========================================');
    console.error('  ❌ MONGODB CONNECTION FAILED!');
    console.error(`  Error: ${error.message}`);
    console.error('==========================================');

    // Give specific advice based on error type
    if (error.message.includes('ECONNREFUSED') || error.message.includes('querySrv')) {
      console.error('\n🇳🇬 NIGERIA NETWORK FIX:');
      console.error('  Your ISP is blocking MongoDB SRV DNS.');
      console.error('  Solutions:');
      console.error('  1. Change DNS to 8.8.8.8 (Google DNS)');
      console.error('  2. Use a VPN');
      console.error('  3. Use direct connection string (not +srv)');
    } else if (error.message.includes('Authentication')) {
      console.error('\n🔑 PASSWORD ERROR:');
      console.error('  Check your password in .env file');
      console.error('  Special characters must be URL-encoded');
    }

    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected!');
});

module.exports = connectDB;