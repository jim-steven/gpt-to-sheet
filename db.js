const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Needed for Render.com PostgreSQL
  }
});

// Initialize the database table
const initDatabase = async () => {
  try {
    // Create tables in a single transaction
    await pool.query('BEGIN');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        user_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_expiry TIMESTAMP NOT NULL,
        email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query('COMMIT');
    console.log('Database initialized successfully');
    
    // Verify tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Available tables:', tables.rows.map(row => row.table_name));
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error initializing database:', error);
  }
};

// Add a function to ensure the users table exists
const ensureUsersTable = async () => {
  try {
    // Check if users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('Users table does not exist, creating it now');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Users table created successfully');
    } else {
      console.log('Users table already exists');
    }
    
    return true;
  } catch (error) {
    console.error('Error ensuring users table exists:', error);
    return false;
  }
};

// Add a function to store user data safely
const storeUser = async (userId, email, name = null) => {
  try {
    // Ensure users table exists before trying to insert
    await ensureUsersTable();
    
    // Insert or update user
    await pool.query(`
      INSERT INTO users (id, email, name, last_login)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (id) 
      DO UPDATE SET 
        email = $2,
        name = COALESCE($3, users.name),
        last_login = CURRENT_TIMESTAMP
    `, [userId, email, name]);
    
    console.log(`User ${userId} stored successfully`);
    return true;
  } catch (error) {
    console.error('Error storing user:', error);
    return false;
  }
};

module.exports = { 
  pool, 
  initDatabase,
  ensureUsersTable,
  storeUser
};
