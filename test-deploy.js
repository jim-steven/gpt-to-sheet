// Simple script to test if all dependencies are installed
try {
  // Test loading all required modules
  require('express');
  require('googleapis');
  require('jwt-decode');
  require('dotenv').config();
  
  // Add any other modules your server.js uses
  
  console.log('✅ All dependencies loaded successfully!');
  
  // Test database connection
  const { pool, initDatabase } = require('./db');
  
  // Test a simple query
  async function testDatabase() {
    try {
      const result = await pool.query('SELECT NOW()');
      console.log('✅ Database connection successful!');
      console.log('Current time from database:', result.rows[0].now);
      
      // Test database initialization
      await initDatabase();
      console.log('✅ Database initialization successful!');
      
      // All tests passed
      console.log('\n🎉 All tests passed! Ready for deployment.');
      process.exit(0);
    } catch (error) {
      console.error('❌ Database test failed:', error);
      process.exit(1);
    }
  }
  
  testDatabase();
  
} catch (error) {
  console.error('❌ Dependency test failed:', error);
  process.exit(1);
} 