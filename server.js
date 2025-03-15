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

// Database initialization function
const initDatabase = async () => {
  try {
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
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

// Initialize database on startup
initDatabase().catch(console.error);

// Helper function to get tokens from all possible storage methods
const getTokensFromDB = async (userId) => {
  // SOLUTION 1: Try database first
  try {
    const result = await pool.query(
      'SELECT access_token, refresh_token, token_expiry FROM auth_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length > 0) {
      const { access_token, refresh_token, token_expiry } = result.rows[0];
      console.log('Found token in database');
      return {
        access_token,
        refresh_token,
        expiry_date: new Date(token_expiry).getTime()
      };
    }
  } catch (dbError) {
    console.error('Database token retrieval failed:', dbError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 2: Try file storage
  try {
    if (fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      const user = users[userId];
      
      if (user && user.tokens) {
        console.log('Found token in file storage');
        return user.tokens;
      }
    }
  } catch (fileError) {
    console.error('File token retrieval failed:', fileError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 3: Try in-memory cache
  try {
    if (global.tokenCache && global.tokenCache[userId]) {
      console.log('Found token in memory cache');
      const cachedToken = global.tokenCache[userId];
      return {
        access_token: cachedToken.access_token,
        refresh_token: cachedToken.refresh_token,
        expiry_date: cachedToken.expiry_date
      };
    }
  } catch (memoryError) {
    console.error('Memory cache token retrieval failed:', memoryError);
    // Continue to fallback solutions
  }
  
  // SOLUTION 4: Check if userId itself is a token (starts with ya29.)
  if (userId.startsWith('ya29.')) {
    console.log('User ID appears to be a token, using it directly');
    return {
      access_token: userId,
      refresh_token: '',
      expiry_date: Date.now() + 3600000 // Assume 1 hour validity
    };
  }
  
  // SOLUTION 5: No token found in any storage
  console.log('No token found for user ID in any storage');
  return null;
};

// Helper function to read users data from file
const readUsers = () => {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading users file:', error);
  }
  return {};
};

// Helper function to save users data to file
const saveUsers = (users) => {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
};

// Function to create OAuth2 client
const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// Generate a unique user ID
const generateUserId = () => {
  return crypto.randomBytes(16).toString('hex');
};
// OAuth proxy endpoints for GPT integration
app.get('/oauth/authorize', (req, res) => {
  const params = new URLSearchParams(req.query);
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  res.redirect(googleAuthUrl);
});

app.post('/oauth/token', async (req, res) => {
  try {
    console.log('Token exchange request headers:', req.headers);
    console.log('Token exchange request body:', req.body);
    console.log('Token exchange request query:', req.query);
    
    // Support multiple input formats (JSON body, form data, query parameters)
    const params = { ...req.query || {}, ...req.body || {} };
    
    // Check if content type is form-encoded and parse accordingly
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/x-www-form-urlencoded') && typeof req.body === 'string') {
      const formParams = new URLSearchParams(req.body);
      formParams.forEach((value, key) => {
        params[key] = value;
      });
    }
    
    console.log('Combined parameters:', params);
    
    // Extract parameters from the combined sources
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      client_secret
    } = params;
    
    // Assume authorization_code if no grant_type specified (helps with ChatGPT integration)
    const effectiveGrantType = grant_type || (code ? 'authorization_code' : 'refresh_token');
    
    // Create OAuth client
    const oauth2Client = new google.auth.OAuth2(
      client_id || process.env.GOOGLE_CLIENT_ID,
      client_secret || process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri || process.env.GOOGLE_REDIRECT_URI
    );
    
    let tokenResponse;
    
    // Handle different grant types
    if (effectiveGrantType === 'authorization_code') {
      if (!code) {
        return res.status(400).json({ error: 'code is required for authorization_code grant type' });
      }
      
      // Exchange authorization code for tokens
      tokenResponse = await oauth2Client.getToken(code);
      console.log('Got token response:', JSON.stringify(tokenResponse));
      
      // Ensure we have a refresh token by requesting offline access
      if (!tokenResponse.tokens.refresh_token) {
        console.warn('No refresh token received! This will cause problems later.');
      }
      
      // Store the tokens and generate a user ID
      const userId = await storeAccessToken(
        tokenResponse.tokens.access_token,
        tokenResponse.tokens.refresh_token,
        tokenResponse.tokens.expiry_date
      );
      
      if (!userId) {
        console.error('Failed to store tokens and generate userId');
        return res.status(500).json({ error: 'Failed to store authentication data' });
      }
      
      console.log(`Generated userId ${userId} for this token`);
      
      // Format response properly for ChatGPT, including the userId
      const formattedResponse = {
        access_token: tokenResponse.tokens.access_token,
        token_type: "bearer",
        refresh_token: tokenResponse.tokens.refresh_token,
        expires_in: Math.floor((tokenResponse.tokens.expiry_date - Date.now()) / 1000),
        user_id: userId  // Include the user ID in the response!
      };
      
      console.log('Token exchange successful - formatted response:', formattedResponse);
      return res.json(formattedResponse);
      
    } else if (effectiveGrantType === 'refresh_token') {
      if (!params.refresh_token) {
        return res.status(400).json({ error: 'refresh_token is required for refresh_token grant type' });
      }
      
      // Refresh the tokens
      oauth2Client.setCredentials({
        refresh_token: params.refresh_token
      });
      tokenResponse = await oauth2Client.refreshAccessToken();
      
      // Update the stored tokens with the same user ID
      const userId = await getUserIdByAccessToken(params.access_token);
      if (userId) {
        await storeAccessToken(
          tokenResponse.tokens.access_token,
          tokenResponse.tokens.refresh_token || params.refresh_token,
          tokenResponse.tokens.expiry_date
        );
      }
    } else {
      return res.status(400).json({ error: 'Invalid or missing grant_type' });
    }
    
    // Format response properly for ChatGPT
    const formattedResponse = {
      access_token: tokenResponse.tokens.access_token,
      token_type: "bearer",
      refresh_token: tokenResponse.tokens.refresh_token || params.refresh_token,
      expires_in: Math.floor((tokenResponse.tokens.expiry_date - Date.now()) / 1000)
    };
    
    console.log('Token exchange successful - formatted response:', formattedResponse);
    res.json(formattedResponse);
  } catch (error) {
    console.error('Token exchange error:', error);
    console.error('Error details:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to exchange token',
      details: error.message
    });
  }
});

// Step 1: Generate user ID and redirect to Google OAuth
app.get("/auth", (req, res) => {
  const userId = generateUserId();
  const oauth2Client = createOAuth2Client();
  
  // Store the user ID in the state parameter
  const state = userId;
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
    prompt: 'consent',
    state: state // Pass user ID as state
  });
  
  res.redirect(authUrl);
});

// SSO authentication route
app.get("/auth/sso", (req, res) => {
  const userId = generateUserId();
  const oauth2Client = createOAuth2Client();
  
  // Store the user ID in session for SSO flow
  req.session.userId = userId;
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
    prompt: 'consent',
    state: userId
  });
  
  res.redirect(authUrl);
});

// Auth callback that stores tokens and returns user ID
app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = state; // Retrieve user ID from state
  
  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens with user ID
    const users = readUsers();
    users[userId] = {
      tokens: tokens,
      created: new Date().toISOString()
    };
    saveUsers(users);
    
    // For SSO flow, store in session and cookie
    if (req.session.userId === userId) {
      // Set a persistent cookie
      res.cookie('gpt_sheet_user_id', userId, {
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        httpOnly: false, // Allow JavaScript access
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
      
      // Store tokens in database for SSO
      try {
        await pool.query(
          'INSERT INTO auth_tokens(user_id, access_token, refresh_token, token_expiry) VALUES($1, $2, $3, $4) ' +
          'ON CONFLICT (user_id) DO UPDATE SET access_token = $2, refresh_token = $3, token_expiry = $4, last_used = CURRENT_TIMESTAMP',
          [
            userId, 
            tokens.access_token, 
            tokens.refresh_token, 
            new Date(tokens.expiry_date)
          ]
        );
      } catch (dbError) {
        console.error('Database error storing tokens:', dbError);
      }
    }
    
    // Redirect to success page with user ID
    res.redirect(`/auth-success?userId=${userId}`);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed", details: error.message });
  }
});

// Route to check authentication status for SSO users
app.get('/auth/check', async (req, res) => {
  // Check for user ID in session or cookie
  const userId = req.session.userId || req.cookies.gpt_sheet_user_id;
  
  if (!userId) {
    return res.status(401).json({ authenticated: false });
  }
  
  // Try to get tokens from database
  const tokens = await getTokensFromDB(userId);
  
  if (!tokens) {
    return res.status(401).json({ authenticated: false });
  }
  
  return res.json({ 
    authenticated: true,
    userId: userId
  });
});

// Simple test route
app.get('/auth/test', (req, res) => {
  res.json({ status: 'working' });
});
// Success page that displays the user ID
app.get("/auth-success", (req, res) => {
  const userId = req.query.userId;
  
  res.send(`
    <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .id-box { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; word-break: break-all; }
          button { background: #4285f4; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin-right: 10px; }
          .auto-close { background: #34a853; }
          .success { color: green; display: none; margin-top: 10px; }
          .countdown { font-weight: bold; color: #4285f4; }
          .instructions { border-left: 4px solid #fbbc05; padding-left: 15px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful! ✅</h1>
        <p>You're now authenticated with Google Sheets.</p>
        
        <div class="instructions">
          <h3>What happens next:</h3>
          <p>1. This window will automatically close in <span class="countdown" id="countdown">5</span> seconds.</p>
          <p>2. Return to your ChatGPT conversation - it will continue automatically.</p>
          <p>3. If the conversation doesn't continue, simply type "continue" in ChatGPT.</p>
        </div>
        
        <p>Your user ID (save for future reference):</p>
        <div class="id-box">
          <code id="userId">${userId}</code>
        </div>
        
        <div>
          <button id="copy-btn">Copy User ID</button>
          <button class="auto-close" id="close-btn">Close Window Now</button>
        </div>
        <p class="success" id="success-msg">User ID copied to clipboard!</p>
        
        <script>
          // Copy button functionality
          document.getElementById('copy-btn').addEventListener('click', function() {
            const idText = document.getElementById('userId').textContent;
            navigator.clipboard.writeText(idText).then(function() {
              document.getElementById('success-msg').style.display = 'block';
              setTimeout(function() {
                document.getElementById('success-msg').style.display = 'none';
              }, 3000);
            });
          });
          
          // Close button
          document.getElementById('close-btn').addEventListener('click', function() {
            window.close();
          });
          
          // Countdown and auto-close
          let seconds = 5;
          const countdownElement = document.getElementById('countdown');
          
          const countdownInterval = setInterval(function() {
            seconds--;
            countdownElement.textContent = seconds;
            
            if (seconds <= 0) {
              clearInterval(countdownInterval);
              window.close();
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
});

// Helper function to get valid token for a user
const getValidTokenForUser = async (userId) => {
  if (!userId) {
    console.error("User ID is missing!");
    throw new Error("User ID is required");
  }
  
  // Special case: If userId looks like an access token (starts with ya29.), return it directly
  if (userId.startsWith('ya29.')) {
    console.log(`User ID appears to be a token, returning it directly`);
    return userId;
  }
  
  console.log(`Attempting to get token for user: ${userId}`);
  
  // First try to get tokens from database (for SSO users)
  let tokens = await getTokensFromDB(userId);
  console.log(`Database tokens for ${userId}:`, tokens ? "Found" : "Not found");
  
  // If not found in database, try file storage
  if (!tokens) {
    console.log(`Looking for user ${userId} in file storage...`);
    const users = readUsers();
    const user = users[userId];
    
    if (!user || !user.tokens) {
      console.error(`User ${userId} not found in file storage either!`);
      throw new Error("User not found or not authenticated");
    }
    
    console.log(`Found user ${userId} in file storage!`);
    tokens = user.tokens;
  }
  
  // Check if we have the required token fields
  if (!tokens.access_token) {
    console.error(`Missing access_token for user ${userId}`);
    throw new Error("Invalid token: missing access_token");
  }
  
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(tokens);
  
  // Check if token needs refresh
  if (!tokens.expiry_date || Date.now() >= tokens.expiry_date) {
    console.log(`Token expired for user ${userId}, attempting refresh...`);
    try {
      // Only try to refresh if we have a refresh token
      if (!tokens.refresh_token) {
        console.error(`No refresh_token available for user ${userId}`);
        throw new Error("Cannot refresh: missing refresh_token");
      }
      
      const { credentials } = await oauth2Client.refreshAccessToken();
      console.log(`Successfully refreshed token for user ${userId}`);
      
      // Update tokens in both storage systems
      // Update file storage
      const users = readUsers();
      if (users[userId]) {
        users[userId].tokens = credentials;
        saveUsers(users);
        console.log(`Updated file storage tokens for user ${userId}`);
      }
      
      // Update database
      try {
        await pool.query(
          'UPDATE auth_tokens SET access_token = $1, refresh_token = $2, token_expiry = $3, last_used = CURRENT_TIMESTAMP WHERE user_id = $4',
          [credentials.access_token, credentials.refresh_token, new Date(credentials.expiry_date), userId]
        );
        console.log(`Updated database tokens for user ${userId}`);
      } catch (dbError) {
        console.error(`Database error updating tokens for user ${userId}:`, dbError);
      }
      
      return credentials.access_token;
    } catch (error) {
      console.error(`Token refresh error for user ${userId}:`, error);
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }
  
  console.log(`Using existing valid token for user ${userId}`);
  return tokens.access_token;
};
// Simplified endpoint to log data with userId - with multiple fallback mechanisms
app.post("/api/log-data-v1", async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, userId } = req.body;
  
  console.log('Logging request received:', {
    spreadsheetId,
    sheetName,
    userId,
    messageLength: userMessage?.length,
    responseLength: assistantResponse?.length
  });
  
  let authUserId = userId;
  let accessToken = null;
  
  // SOLUTION 1: Check for Authorization header (Bearer token)
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    console.log('Got Bearer token from Authorization header');
    
    // Try to get user ID from token
    try {
      const tokenUserId = await getUserIdByAccessToken(accessToken);
      if (tokenUserId) {
        console.log(`Found user ID ${tokenUserId} for this Bearer token`);
        authUserId = tokenUserId;
      }
    } catch (authError) {
      console.error('Error looking up user ID from token:', authError);
      // Use token directly as fallback
      authUserId = accessToken;
      console.log('Using token directly as user ID (fallback)');
    }
  }
  
  // SOLUTION 2: Check if userId looks like an access token
  if (!authUserId && userId && userId.startsWith('ya29.')) {
    console.log('User ID appears to be an access token, using directly');
    accessToken = userId;
    authUserId = userId; // Use token directly
  }
  
  // SOLUTION 3: Try to create a new user ID if we have a token but no user ID
  if (!authUserId && accessToken) {
    try {
      console.log('Creating new user ID for token');
      authUserId = await storeAccessToken(accessToken, '', Date.now() + 3600000);
    } catch (storeError) {
      console.error('Failed to create user ID:', storeError);
      // Use token directly as fallback
      authUserId = accessToken;
      console.log('Using token directly as user ID (fallback)');
    }
  }
  
  // SOLUTION 4: Generate a temporary user ID if nothing else works
  if (!authUserId) {
    console.log('No user ID or token available, generating temporary ID');
    authUserId = 'temp_' + crypto.randomBytes(8).toString('hex');
    
    // Store the temporary ID with empty credentials
    // This allows at least some form of session continuity
    try {
      global.tempUsers = global.tempUsers || {};
      global.tempUsers[authUserId] = {
        created: new Date().toISOString()
      };
    } catch (tempError) {
      console.error('Failed to store temporary user:', tempError);
    }
  }
  
  console.log(`Final user ID for logging: ${authUserId}`);
  
  // Validate required fields
  if (!spreadsheetId) {
    console.error('Log attempt failed: No spreadsheetId provided');
    return res.status(400).json({ error: "spreadsheetId is required" });
  }
  
  if (!userMessage || !assistantResponse) {
    console.error('Log attempt failed: Missing message content');
    return res.status(400).json({ error: "userMessage and assistantResponse are required" });
  }
  
  try {
    // SOLUTION 5: Direct token usage if it's a token
    let token;
    if (authUserId.startsWith('ya29.')) {
      console.log('Using user ID directly as token');
      token = authUserId;
    } else if (accessToken) {
      console.log('Using stored access token');
      token = accessToken;
    } else {
      // Get a valid token for this user through normal means
      console.log(`Getting token for user: ${authUserId}`);
      token = await getValidTokenForUser(authUserId);
    }
    
    console.log('Successfully obtained token for request');
    
    // Create OAuth client with the token
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ access_token: token });
    
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const actualSheetName = sheetName || "Data"; // Default to "Data" if not specified
    
    console.log(`Writing to sheet "${actualSheetName}" in spreadsheet "${spreadsheetId}"`);
    
    // First check if the sheet exists, create it if it doesn't
    try {
      // Try to get the sheet info
      await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [`${actualSheetName}!A1`]
      });
      console.log(`Sheet "${actualSheetName}" exists`);
    } catch (sheetError) {
      if (sheetError.code === 404 || sheetError.message.includes('not found')) {
        // Sheet doesn't exist, create it
        console.log(`Sheet "${actualSheetName}" doesn't exist, creating it`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: actualSheetName
                }
              }
            }]
          }
        });
        
        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${actualSheetName}!A1:C1`,
          valueInputOption: "USER_ENTERED",
          resource: {
            values: [["User Message", "Assistant Response", "Timestamp"]]
          }
        });
        console.log(`Created sheet "${actualSheetName}" with headers`);
      } else {
        // Some other error with the sheet
        throw sheetError;
      }
    }
    
    // Now append the data
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${actualSheetName}!A:C`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[userMessage, assistantResponse, timestamp || new Date().toISOString()]],
      },
    });
    
    console.log('Data logged successfully!');
    res.json({ message: "Data logged successfully!", response: response.data });
  } catch (error) {
    console.error("Logging error:", error);
    
    // Provide a more specific error message based on the error type
    let errorMessage = "Failed to write to sheet";
    let statusCode = 500;
    
    if (error.message.includes('User not found')) {
      errorMessage = "User not found or not authenticated";
      statusCode = 401;
    } else if (error.message.includes('invalid_grant')) {
      errorMessage = "Authentication expired, please re-authenticate";
      statusCode = 401;
    } else if (error.code === 403 || error.message.includes('permission')) {
      errorMessage = "Permission denied to access the spreadsheet";
      statusCode = 403;
    } else if (error.code === 404 || error.message.includes('not found')) {
      errorMessage = "Spreadsheet not found";
      statusCode = 404;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage, 
      details: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
});

// Simplified endpoint to get sheet data with userId
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName, range, userId } = req.body;
  
  // Get userId from request body or Authorization header if using OAuth
  const authUserId = userId || req.get('Authorization')?.split(' ')[1];
  
  if (!authUserId) {
    return res.status(401).json({ error: "User ID is required" });
  }
  
  try {
    // Get a valid token for this user
    const token = await getValidTokenForUser(authUserId);
    
    // Create OAuth client with the token
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ access_token: token });
    
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: range || `${sheetName}!A:C`,
    });
    
    res.json({ data: response.data.values });
  } catch (error) {
    console.error("Reading error:", error);
    res.status(500).json({ error: "Failed to read from sheet", details: error.message });
  }
});
// Endpoint for ChatGPT to check if a user is authenticated
app.get('/auth/check-session', async (req, res) => {
  const sessionId = req.query.session || req.cookies.auth_session;
  
  if (!sessionId) {
    return res.status(404).json({ 
      authenticated: false,
      message: 'No session found'
    });
  }
  
  try {
    // Check if the sessionId is in our db of authenticated sessions
    const result = await pool.query(
      'SELECT user_id, created_at FROM auth_tokens WHERE created_at > NOW() - INTERVAL \'10 minutes\' ORDER BY created_at DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        authenticated: false,
        message: 'No recent authentication found'
      });
    }
    
    // Return the most recently authenticated user
    const userId = result.rows[0].user_id;
    const createdAt = result.rows[0].created_at;
    
    return res.json({
      authenticated: true,
      userId: userId,
      authenticatedAt: createdAt,
      message: 'Authentication successful'
    });
  } catch (error) {
    console.error('Error checking session:', error);
    return res.status(500).json({ 
      authenticated: false,
      message: 'Error checking authentication status'
    });
  }
});

// OpenAPI specification with userId instead of token
app.get('/openapi.json', (req, res) => {
  // Serve a static OpenAPI specification
  const openApiSpec = {
    "openapi": "3.1.0",
    "info": {
      "title": "Chat Logger API",
      "description": "API for logging and retrieving chat conversations with Google Sheets",
      "version": "1.0.0"
    },
    "servers": [
      {
        "url": "https://gpt-to-sheet.onrender.com"
      }
    ],
    "components": {
      "schemas": {
        "LogRequest": {
          "type": "object",
          "properties": {
            "spreadsheetId": {
              "type": "string",
              "description": "Google Spreadsheet ID"
            },
            "sheetName": {
              "type": "string",
              "description": "Name of the sheet within the spreadsheet"
            },
            "userMessage": {
              "type": "string",
              "description": "Message from the user"
            },
            "assistantResponse": {
              "type": "string",
              "description": "Response from the assistant"
            },
            "timestamp": {
              "type": "string",
              "description": "ISO timestamp of the conversation"
            }
          },
          "required": ["spreadsheetId", "sheetName", "userMessage", "assistantResponse"]
        },
        "SheetDataRequest": {
          "type": "object",
          "properties": {
            "spreadsheetId": {
              "type": "string",
              "description": "Google Spreadsheet ID"
            },
            "sheetName": {
              "type": "string",
              "description": "Name of the sheet within the spreadsheet"
            },
            "range": {
              "type": "string",
              "description": "Optional range in A1 notation (e.g. 'A1:C10')"
            }
          },
          "required": ["spreadsheetId"]
        }
      },
      "securitySchemes": {
        "oauth2": {
          "type": "oauth2",
          "flows": {
            "authorizationCode": {
              "authorizationUrl": "https://gpt-to-sheet.onrender.com/oauth/authorize",
              "tokenUrl": "https://gpt-to-sheet.onrender.com/oauth/token",
              "scopes": {
                "https://www.googleapis.com/auth/spreadsheets": "Read and write access to Google Sheets"
              }
            }
          }
        }
      }
    },
    "security": [
      {
        "oauth2": ["https://www.googleapis.com/auth/spreadsheets"]
      }
    ],
    "paths": {
      "/api/log-data-v1": {
        "post": {
          "summary": "Log chat conversation",
          "operationId": "logChat",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LogRequest"
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Successfully logged the conversation"
            }
          }
        }
      },
      "/api/get-sheet-data": {
        "post": {
          "summary": "Get data from Google Sheet",
          "operationId": "getSheetData",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SheetDataRequest"
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Successfully retrieved sheet data"
            }
          }
        }
      },
      "/get-user-id": {
        "get": {
          "summary": "Get user ID for an authenticated session",
          "operationId": "getUserId",
          "security": [{ "oauth2": ["https://www.googleapis.com/auth/spreadsheets"] }],
          "responses": {
            "200": {
              "description": "Successfully retrieved user ID",
              "content": {
                "application/json": {
                  "schema": {
                    "type": "object",
                    "properties": {
                      "user_id": {
                        "type": "string",
                        "description": "User ID to use with other API endpoints"
                      },
                      "message": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/auth/check-session": {
        "get": {
          "summary": "Check if a recent authentication exists",
          "operationId": "checkAuthSession",
          "parameters": [
            {
              "name": "session",
              "in": "query",
              "required": false,
              "schema": {
                "type": "string"
              },
              "description": "Session identifier (optional)"
            }
          ],
          "responses": {
            "200": {
              "description": "Authentication check successful",
              "content": {
                "application/json": {
                  "schema": {
                    "type": "object",
                    "properties": {
                      "authenticated": {
                        "type": "boolean"
                      },
                      "userId": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
  
  res.set('Content-Type', 'application/json');
  res.json(openApiSpec);
});

// Root path route
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>GPT to Sheet</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { background: #4285f4; color: white; border: none; padding: 10px 15px; 
                   border-radius: 5px; text-decoration: none; display: inline-block; margin-top: 20px; }
          .button-secondary { background: #34a853; }
          .options { display: flex; gap: 15px; margin-top: 20px; }
          .option { border: 1px solid #ddd; padding: 15px; border-radius: 8px; flex: 1; }
          h2 { margin-top: 0; }
        </style>
      </head>
      <body>
        <h1>GPT to Google Sheets Integration</h1>
        <p>This service allows GPTs to log conversations to Google Sheets.</p>
        
        <div class="options">
          <div class="option">
            <h2>Standard Authentication</h2>
            <p>Get a token ID that you'll need to provide to your GPT each time.</p>
            <a href="/auth" class="button">Standard Auth</a>
          </div>
          
          <div class="option">
            <h2>Enhanced Authentication (SSO)</h2>
            <p>Your browser remembers your authentication - no need to re-authenticate in future sessions.</p>
            <a href="/auth/sso" class="button button-secondary">SSO Auth</a>
          </div>
        </div>
      </body>
    </html>
  `);
});
// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: "Server error", 
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message 
  });
});

// Catch-all route for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found", message: "The requested resource does not exist" });
});

// Start Server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Log important URLs
  console.log(`Auth URL: http://localhost:${PORT}/auth`);
  console.log(`SSO Auth URL: http://localhost:${PORT}/auth/sso`);
  console.log(`OpenAPI Spec: http://localhost:${PORT}/openapi.json`);
  
  if (process.env.NODE_ENV === 'production') {
    console.log(`Production server running at: ${process.env.GOOGLE_REDIRECT_URI.split('/auth')[0]}`);
  }
});

// Export app for testing
module.exports = app;

