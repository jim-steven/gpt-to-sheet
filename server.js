// Imports - grouped by functionality
// Core Node modules
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// External dependencies
const { google } = require("googleapis");
const { Pool } = require('pg');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const axios = require('axios');

// Environment configuration
require("dotenv").config();

// Default spreadsheet ID to use when none is provided
const DEFAULT_SPREADSHEET_ID = '1m6e-HTb1W_trKMKgkkM-ItcuwJJW-Ab6lM_TKmOAee4';
const DEFAULT_SHEET_NAME = 'Data';

// Store access token with a user ID for ChatGPT API - with multiple fallback mechanisms
const storeAccessToken = async (accessToken, refreshToken, expiryDate) => {
  // Generate a unique ID for this token
  const tokenId = crypto.randomBytes(16).toString('hex');
  console.log(`Storing access token with ID: ${tokenId}`);
  
  // SOLUTION 1: Try PostgreSQL storage with proper timestamp handling
  try {
    // Convert JavaScript timestamp to PostgreSQL timestamp safely
    const expiryDateObj = new Date(expiryDate);
    const formattedDate = expiryDateObj.toISOString();
    
    await pool.query(
      `INSERT INTO auth_tokens (user_id, access_token, refresh_token, token_expiry) 
       VALUES ($1, $2, $3, $4::timestamp)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         access_token = $2, 
         refresh_token = CASE WHEN $3 = '' THEN auth_tokens.refresh_token ELSE $3 END,
         token_expiry = $4::timestamp,
         last_used = CURRENT_TIMESTAMP`,
      [tokenId, accessToken, refreshToken || '', formattedDate]
    );
    
    console.log('Successfully stored token in database');
  } catch (dbError) {
    console.error('Database storage failed (Solution 1):', dbError);
    
    // SOLUTION 2: Try simplified database schema (no timestamp conversion)
    try {
      // Store expiry as a string instead of timestamp
      await pool.query(
        `INSERT INTO auth_tokens (user_id, access_token, refresh_token, token_expiry) 
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
         ON CONFLICT (user_id) 
         DO UPDATE SET 
           access_token = $2, 
           refresh_token = CASE WHEN $3 = '' THEN auth_tokens.refresh_token ELSE $3 END,
           token_expiry = NOW() + INTERVAL '1 hour',
           last_used = CURRENT_TIMESTAMP`,
        [tokenId, accessToken, refreshToken || '']
      );
      
      console.log('Successfully stored token with simplified schema');
    } catch (simpleDbError) {
      console.error('Simplified database storage failed (Solution 2):', simpleDbError);
      // Continue to fallback solutions
    }
  }
  
  // SOLUTION 3: Always store in file system as backup
  try {
    const users = readUsers();
    users[tokenId] = {
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken || '',
        expiry_date: expiryDate
      },
      created: new Date().toISOString()
    };
    saveUsers(users);
    console.log('Successfully stored token in file system');
  } catch (fileError) {
    console.error('File storage failed (Solution 3):', fileError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 4: Store in global in-memory cache
  try {
    if (!global.tokenCache) {
      global.tokenCache = {};
    }
    global.tokenCache[tokenId] = {
      access_token: accessToken,
      refresh_token: refreshToken || '',
      expiry_date: expiryDate,
      created: new Date().toISOString()
    };
    console.log('Successfully stored token in memory cache');
  } catch (memoryError) {
    console.error('Memory cache storage failed (Solution 4):', memoryError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 5: If all else fails, at least return the token ID
  // This allows direct token usage as a last resort
  console.log('Returning token ID for direct usage if needed');
  return tokenId;
};

// Get user ID by access token - with multiple fallback mechanisms
const getUserIdByAccessToken = async (accessToken) => {
  // SOLUTION 1: Try database first
  try {
    const result = await pool.query(
      'SELECT user_id FROM auth_tokens WHERE access_token = $1',
      [accessToken]
    );
    
    if (result.rows.length > 0) {
      console.log('Found user ID in database');
      return result.rows[0].user_id;
    }
  } catch (dbError) {
    console.error('Database user ID lookup failed:', dbError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 2: Try file storage
  try {
    if (fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      
      // Find user with matching access token
      for (const [userId, userData] of Object.entries(users)) {
        if (userData.tokens && userData.tokens.access_token === accessToken) {
          console.log('Found user ID in file storage');
          return userId;
        }
      }
    }
  } catch (fileError) {
    console.error('File user ID lookup failed:', fileError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 3: Try in-memory cache
  try {
    if (global.tokenCache) {
      for (const [userId, tokenData] of Object.entries(global.tokenCache)) {
        if (tokenData.access_token === accessToken) {
          console.log('Found user ID in memory cache');
          return userId;
        }
      }
    }
  } catch (memoryError) {
    console.error('Memory cache user ID lookup failed:', memoryError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 4: Generate a new user ID for this token
  try {
    const newUserId = await storeAccessToken(accessToken, '', Date.now() + 3600000);
    if (newUserId) {
      console.log('Created new user ID for token');
      return newUserId;
    }
  } catch (storeError) {
    console.error('Failed to create new user ID:', storeError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 5: Use the token itself as the user ID (last resort)
  console.log('Using token itself as user ID (last resort)');
  return accessToken;
};

// Express app setup
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());
app.use(cors({
  origin: [
    'https://chat.openai.com',
    'https://chatgpt.com',
    'http://localhost:3000',
    'https://gpt-to-sheet.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Database connection setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Needed for Render.com PostgreSQL
  }
});
// Constants and file paths
const USERS_FILE = path.join(__dirname, 'users.json');

// Import the database module
const { initDatabase, ensureUsersTable } = require('./db');

// Initialize the database before starting the server
(async () => {
  try {
    console.log('Initializing database...');
    await initDatabase();
    await ensureUsersTable();
    console.log('Database initialization complete');
    
    // Start the server with better error handling
    const PORT = process.env.PORT || 3000;
    
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} is already in use. Trying again in 5 seconds...`);
        setTimeout(() => {
          server.close();
          server.listen(PORT);
        }, 5000);
      } else {
        console.error('Server error:', error);
      }
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
    // This should never happen, but just in case
    logToConsole(`Unexpected error in log-conversation endpoint: ${error.message}`, 'error');
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
      sheetName: DEFAULT_SHEET_NAME
    });
  }
});

// Update the status endpoint to include the default sheet name
app.get('/api/chatgpt/status', (req, res) => {
  logToConsole('Status endpoint called');
  
  // Count pending conversations
  const pendingCount = global.pendingConversations ? global.pendingConversations.length : 0;
  
  // Check if we have a service account key
  const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account-key.json';
  const hasServiceAccount = fs.existsSync(keyFilePath);
  
  // Return status information
  res.json({
    status: 'operational',
    pendingConversations: pendingCount,
    hasServiceAccount,
    defaultSpreadsheetId: DEFAULT_SPREADSHEET_ID,
    defaultSheetName: DEFAULT_SHEET_NAME,
    defaultSpreadsheetUrl: `https://docs.google.com/spreadsheets/d/${DEFAULT_SPREADSHEET_ID}/edit`,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Update the background worker to use the sheet name from the conversation data
setInterval(async () => {
  try {
    // Skip if no pending conversations
    if (!global.pendingConversations || global.pendingConversations.length === 0) return;
    
    logToConsole(`Background worker: Processing ${global.pendingConversations.length} pending conversations`);
    
    // Process each conversation
    for (let i = 0; i < global.pendingConversations.length; i++) {
      const conversation = global.pendingConversations[i];
      
      // Skip if too many attempts
      if (conversation.attempts >= 5) {
        logToConsole(`Skipping conversation ${conversation.id} - too many attempts (${conversation.attempts})`);
        continue;
      }
      
      // Increment attempt counter
      conversation.attempts++;
      
      try {
        // Try to use service account
        const auth = new google.auth.GoogleAuth({
          keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account-key.json',
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        // Use the sheet name from the conversation data or default to 'Data'
        const sheetName = conversation.sheetName || DEFAULT_SHEET_NAME;
        
        // Append data to the sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: conversation.spreadsheetId || DEFAULT_SPREADSHEET_ID,
          range: `${sheetName}!A:C`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: [[conversation.userMessage, conversation.assistantResponse, conversation.timestamp]],
          },
        });
        
        logToConsole(`Successfully synced conversation ${conversation.id} on attempt ${conversation.attempts}`);
        
        // Remove from pending list
        global.pendingConversations.splice(i, 1);
        i--; // Adjust index since we removed an item
        
        // Update database if available
        if (pool) {
          await pool.query(
            'UPDATE pending_conversations SET synced = TRUE, synced_at = NOW() WHERE id = $1',
            [conversation.id]
          );
        }
      } catch (error) {
        logToConsole(`Failed to sync conversation ${conversation.id} on attempt ${conversation.attempts}: ${error.message}`, 'error');
      }
    }
  } catch (error) {
    logToConsole(`Error in background worker: ${error.message}`, 'error');
  }
}, 60000); // Run every minute

let jwtDecode;
try {
  jwtDecode = require('jwt-decode');
} catch (error) {
  console.warn('jwt-decode not available, using fallback implementation');
  jwtDecode = (token) => {
    // Simple fallback implementation
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map((c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error('Error decoding token:', e);
      return {};
    }
  };
}

const getUserEmailFromTokens = (tokens) => {
  try {
    // If we have an id_token, we can decode it to get the email
    if (tokens.id_token) {
      const decoded = jwtDecode(tokens.id_token);
      if (decoded.email) {
        return decoded.email;
      }
    }
    return null;
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
};

const handleAuthCallback = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  
  // Try to get email from token first
  let userId = getUserEmailFromTokens(tokens);
  
  // If that fails, try API calls
  if (!userId) {
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      userId = userInfo.data.email;
    } catch (error) {
      // Final fallback - use a random ID
      userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    }
  }
  
  return { userId, tokens };
};

