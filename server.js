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

    // Add user_preferences table to store spreadsheet associations and settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        email TEXT PRIMARY KEY,
        default_spreadsheet_id TEXT,
        default_categories JSONB,
        budget_limits JSONB,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  console.log('OAuth authorize request received with params:', params.toString());
  
  // Log the redirect_uri to check if it's properly set
  console.log('Redirect URI:', params.get('redirect_uri'));
  
  // Check if state parameter is present (needed for ChatGPT plugin flow)
  if (!params.get('state')) {
    console.log('Warning: No state parameter in OAuth request');
  }
  
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  console.log('Redirecting to Google OAuth URL:', googleAuthUrl);
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
      client_secret,
      state
    } = params;
    
    // Log state parameter which is important for ChatGPT plugin flow
    if (state) {
      console.log('State parameter present:', state);
    } else {
      console.log('Warning: No state parameter in token request');
    }
    
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
        console.error('Error: code is required for authorization_code grant type');
        return res.status(400).json({ error: 'code is required for authorization_code grant type' });
      }
      
      // Exchange authorization code for tokens
      try {
        tokenResponse = await oauth2Client.getToken(code);
        console.log('Got token response:', JSON.stringify(tokenResponse));
      } catch (tokenError) {
        console.error('Error getting token from Google:', tokenError);
        return res.status(400).json({ 
          error: 'Failed to exchange authorization code', 
          details: tokenError.message,
          code: tokenError.code || 'UNKNOWN'
        });
      }
      
      // Ensure we have a refresh token by requesting offline access
      if (!tokenResponse.tokens.refresh_token) {
        console.warn('No refresh token received! This will cause problems later.');
      }
      
      // Store the tokens and generate a user ID
      let userId;
      try {
        userId = await storeAccessToken(
          tokenResponse.tokens.access_token,
          tokenResponse.tokens.refresh_token,
          tokenResponse.tokens.expiry_date
        );
      } catch (storeError) {
        console.error('Error storing tokens:', storeError);
      }
      
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
    } 
    
    if (effectiveGrantType === 'refresh_token') {
      if (!params.refresh_token) {
        console.error('Error: refresh_token is required for refresh_token grant type');
        return res.status(400).json({ error: 'refresh_token is required for refresh_token grant type' });
      }
      
      // Refresh the tokens
      oauth2Client.setCredentials({
        refresh_token: params.refresh_token
      });
      
      try {
        tokenResponse = await oauth2Client.refreshAccessToken();
      } catch (refreshError) {
        console.error('Error refreshing token:', refreshError);
        return res.status(400).json({ 
          error: 'Failed to refresh token', 
          details: refreshError.message,
          code: refreshError.code || 'UNKNOWN'
        });
      }
      
      // Update the stored tokens with the same user ID
      const userId = await getUserIdByAccessToken(params.access_token);
      if (userId) {
        await storeAccessToken(
          tokenResponse.tokens.access_token,
          tokenResponse.tokens.refresh_token || params.refresh_token,
          tokenResponse.tokens.expiry_date
        );
      }
    } else if (effectiveGrantType !== 'authorization_code') {
      console.error('Error: Invalid or missing grant_type:', effectiveGrantType);
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

// Auth callback that stores tokens, email, and returns user ID
app.get("/auth/callback", async (req, res) => {
  console.log('Auth callback received with query params:', req.query);
  
  const { code, state, error } = req.query;
  
  // Check for OAuth errors
  if (error) {
    console.error('OAuth error returned in callback:', error, req.query.error_description);
    return res.redirect(`/auth-error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(req.query.error_description || '')}`);
  }
  
  if (!code) {
    console.error('No authorization code in callback');
    return res.redirect('/auth-error?error=no_code&description=No+authorization+code+received');
  }
  
  if (!state) {
    console.warn('No state parameter in callback - this may cause issues with ChatGPT plugin flow');
  }
  
  const userId = state; // Retrieve user ID from state
  console.log(`Using state as userId: ${userId}`);
  
  try {
    const oauth2Client = createOAuth2Client();
    
    let tokens;
    try {
      const tokenResponse = await oauth2Client.getToken(code);
      tokens = tokenResponse.tokens;
      console.log('Successfully exchanged code for tokens');
    } catch (tokenError) {
      console.error('Error exchanging code for tokens:', tokenError);
      return res.redirect(`/auth-error?error=token_exchange&description=${encodeURIComponent(tokenError.message)}`);
    }
    
    // Get user email from Google API
    let userEmail = null;
    try {
      oauth2Client.setCredentials(tokens);
      const people = google.people({ version: 'v1', auth: oauth2Client });
      const profile = await people.people.get({
        resourceName: 'people/me',
        personFields: 'emailAddresses',
      });
      
      if (profile.data.emailAddresses && profile.data.emailAddresses.length > 0) {
        userEmail = profile.data.emailAddresses[0].value;
        console.log(`Retrieved email: ${userEmail} for user ${userId}`);
      }
    } catch (emailError) {
      console.error('Error retrieving user email:', emailError);
      // Continue without email if retrieval fails
    }
    
    // Save tokens with user ID
    const users = readUsers();
    users[userId] = {
      tokens: tokens,
      email: userEmail,
      created: new Date().toISOString()
    };
    saveUsers(users);
    console.log(`Saved user ${userId} to file storage`);
    
    // For SSO flow, store in session and cookie
    if (req.session.userId === userId) {
      // Set a persistent cookie
      res.cookie('gpt_sheet_user_id', userId, {
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        httpOnly: false, // Allow JavaScript access
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
      console.log(`Set cookie for SSO user ${userId}`);
      
      // Store tokens in database for SSO
      try {
        await pool.query(
          'INSERT INTO auth_tokens(user_id, access_token, refresh_token, token_expiry, email) VALUES($1, $2, $3, $4, $5) ' +
          'ON CONFLICT (user_id) DO UPDATE SET access_token = $2, refresh_token = $3, token_expiry = $4, email = $5, last_used = CURRENT_TIMESTAMP',
          [
            userId, 
            tokens.access_token, 
            tokens.refresh_token, 
            new Date(tokens.expiry_date),
            userEmail
          ]
        );
        console.log(`Stored tokens in database for user ${userId}`);
      } catch (dbError) {
        console.error('Database error storing tokens:', dbError);
      }
    }
    
    // Redirect to success page with user ID
    res.redirect(`/auth-success?userId=${userId}&email=${encodeURIComponent(userEmail || '')}`);
  } catch (error) {
    console.error('Authentication callback error:', error);
    res.redirect(`/auth-error?error=general&description=${encodeURIComponent(error.message)}`);
  }
});

// Add an error page for authentication failures
app.get("/auth-error", (req, res) => {
  const error = req.query.error || 'unknown';
  const description = req.query.description || 'An unknown error occurred during authentication';
  
  res.send(`
    <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .error-box { background: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f44336; }
          .button { background: #4285f4; color: white; border: none; padding: 10px 15px; border-radius: 5px; text-decoration: none; display: inline-block; margin-top: 20px; }
        </style>
      </head>
      <body>
        <h1>Authentication Failed ❌</h1>
        
        <div class="error-box">
          <h3>Error: ${error}</h3>
          <p>${description}</p>
        </div>
        
        <p>Please try again or contact support if the issue persists.</p>
        
        <a href="/" class="button">Return to Home</a>
      </body>
    </html>
  `);
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
  const email = req.query.email || 'Not available';
  
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
          .email-info { color: #4285f4; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful! ✅</h1>
        <p>You're now authenticated with Google Sheets.</p>
        
        <div class="instructions">
          <h3>What happens next:</h3>
          <p>1. This window will automatically close in <span class="countdown" id="countdown">5</span> seconds.</p>
          <p>2. Return to your ChatGPT conversation - it will continue automatically.</p>
          <p>3. If the conversation doesn't continue, simply type "next" in ChatGPT.</p>
        </div>
        
        <p>Your account information:</p>
        <p>Email: <span class="email-info">${email}</span></p>
        <p>User ID (save for future reference):</p>
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
    console.log('User ID appears to be a token, returning it directly');
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
    
    if (!user?.tokens) {
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
  console.log('Log data request received:', {
    headers: {
      authorization: req.headers.authorization ? 'Bearer [REDACTED]' : undefined,
      'content-type': req.headers['content-type']
    },
    body: {
      spreadsheetId: req.body.spreadsheetId,
      sheetName: req.body.sheetName,
      userId: req.body.userId,
      messageLength: req.body.userMessage?.length,
      responseLength: req.body.assistantResponse?.length
    }
  });

  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, userId } = req.body;
  
  let authUserId = userId;
  let accessToken = null;
  
  // SOLUTION 1: Check for Authorization header (Bearer token)
  const authHeader = req.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
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
    authUserId = `temp_${crypto.randomBytes(8).toString('hex')}`;
    
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
      try {
        token = await getValidTokenForUser(authUserId);
      } catch (tokenError) {
        console.error(`Error getting token for user ${authUserId}:`, tokenError);
        return res.status(401).json({ 
          error: "Authentication failed", 
          details: tokenError.message,
          code: 'AUTH_ERROR'
        });
      }
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
      console.log('Sheet error:', sheetError.message);
      
      if (sheetError.code === 404 || sheetError.message.includes('not found')) {
        // Sheet doesn't exist, create it
        console.log(`Sheet "${actualSheetName}" doesn't exist, creating it`);
        try {
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
        } catch (createError) {
          console.error('Error creating sheet:', createError);
          return res.status(500).json({ 
            error: "Failed to create sheet", 
            details: createError.message,
            code: createError.code || 'SHEET_CREATE_ERROR'
          });
        }
      } else if (sheetError.code === 403 || sheetError.message.includes('permission')) {
        // Permission error
        console.error('Permission denied to access spreadsheet');
        return res.status(403).json({ 
          error: "Permission denied to access the spreadsheet", 
          details: sheetError.message,
          code: 'PERMISSION_DENIED'
        });
      } else {
        // Some other error with the sheet
        throw sheetError;
      }
    }
    
    // Now append the data
    try {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${actualSheetName}!A:C`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[userMessage, assistantResponse, timestamp || new Date().toISOString()]],
        },
      });
      
      console.log('Data logged successfully!');
      res.json({ 
        message: "Data logged successfully!", 
        response: response.data,
        userId: authUserId // Return the userId that was used
      });
    } catch (appendError) {
      console.error('Error appending data:', appendError);
      return res.status(500).json({ 
        error: "Failed to append data to sheet", 
        details: appendError.message,
        code: appendError.code || 'APPEND_ERROR'
      });
    }
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
  const userId = req.query.userId || req.cookies.gpt_sheet_user_id;
  
  // First check for specific user ID if provided
  if (userId) {
    try {
      const result = await pool.query(
        'SELECT user_id, email, created_at, last_used FROM auth_tokens WHERE user_id = $1',
        [userId]
      );
      
      if (result.rows.length > 0) {
        const userData = result.rows[0];
        
        // Get user preferences if email is available
        let preferences = null;
        if (userData.email) {
          const prefResult = await pool.query(
            'SELECT default_spreadsheet_id, default_categories, budget_limits FROM user_preferences WHERE email = $1',
            [userData.email]
          );
          
          if (prefResult.rows.length > 0) {
            preferences = prefResult.rows[0];
          }
        }
        
        return res.json({
          authenticated: true,
          userId: userData.user_id,
          email: userData.email,
          authenticatedAt: userData.created_at,
          lastUsed: userData.last_used,
          preferences: preferences,
          message: 'Authentication successful'
        });
      }
    } catch (error) {
      console.error('Error checking user authentication:', error);
    }
  }
  
  // If no specific user ID or not found, check for recent authentication
  if (!sessionId) {
    return res.status(404).json({ 
      authenticated: false,
      message: 'No session found'
    });
  }
  
  try {
    // Check if the sessionId is in our db of authenticated sessions
    const result = await pool.query(
      'SELECT user_id, email, created_at FROM auth_tokens WHERE created_at > NOW() - INTERVAL \'1 day\' ORDER BY created_at DESC LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        authenticated: false,
        message: 'No recent authentication found'
      });
    }
    
    // Return the most recently authenticated user
    const userData = result.rows[0];
    
    // Get user preferences if email is available
    let preferences = null;
    if (userData.email) {
      const prefResult = await pool.query(
        'SELECT default_spreadsheet_id, default_categories, budget_limits FROM user_preferences WHERE email = $1',
        [userData.email]
      );
      
      if (prefResult.rows.length > 0) {
        preferences = prefResult.rows[0];
      }
    }
    
    return res.json({
      authenticated: true,
      userId: userData.user_id,
      email: userData.email,
      authenticatedAt: userData.created_at,
      preferences: preferences,
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

// New endpoint to store user preferences
app.post('/api/user/preferences', async (req, res) => {
  const { email, spreadsheetId, categories, budgetLimits } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    await pool.query(
      `INSERT INTO user_preferences (email, default_spreadsheet_id, default_categories, budget_limits)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) 
       DO UPDATE SET 
         default_spreadsheet_id = COALESCE($2, user_preferences.default_spreadsheet_id),
         default_categories = COALESCE($3, user_preferences.default_categories),
         budget_limits = COALESCE($4, user_preferences.budget_limits),
         last_updated = CURRENT_TIMESTAMP`,
      [
        email, 
        spreadsheetId || null, 
        categories ? JSON.stringify(categories) : null, 
        budgetLimits ? JSON.stringify(budgetLimits) : null
      ]
    );
    
    res.json({ 
      success: true, 
      message: 'User preferences updated successfully' 
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ 
      error: 'Failed to update user preferences', 
      details: error.message 
    });
  }
});

// New endpoint to get user preferences
app.get('/api/user/preferences', async (req, res) => {
  const { email, userId } = req.query;
  
  if (!email && !userId) {
    return res.status(400).json({ error: 'Email or userId is required' });
  }
  
  try {
    let userEmail = email;
    
    // If userId is provided but not email, try to get email from auth_tokens
    if (!userEmail && userId) {
      const userResult = await pool.query(
        'SELECT email FROM auth_tokens WHERE user_id = $1',
        [userId]
      );
      
      if (userResult.rows.length > 0 && userResult.rows[0].email) {
        userEmail = userResult.rows[0].email;
      } else {
        return res.status(404).json({ error: 'User not found or email not available' });
      }
    }
    
    const result = await pool.query(
      'SELECT default_spreadsheet_id, default_categories, budget_limits, last_updated FROM user_preferences WHERE email = $1',
      [userEmail]
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        found: false,
        message: 'No preferences found for this user'
      });
    }
    
    res.json({
      found: true,
      email: userEmail,
      preferences: result.rows[0]
    });
  } catch (error) {
    console.error('Error retrieving user preferences:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve user preferences', 
      details: error.message 
    });
  }
});

// Enhanced function to check and setup all required sheets at once
const setupFinanceSheets = async (sheets, spreadsheetId) => {
  console.log(`Setting up finance sheets for spreadsheet: ${spreadsheetId}`);
  
  // Define all required sheets with their headers
  const requiredSheets = {
    'Finances': [
      'Unique ID', 'Date', 'Category', 'Subcategory', 'Amount', 'Type', 'Payment Method', 'Notes'
    ],
    'Budget Tracking': [
      'Category', 'Budget Limit', 'Spent', 'Remaining Budget', 'Status'
    ],
    'Grocery Receipts': [
      'Unique ID', 'Date', 'Store', 'Item', 'Price'
    ],
    'Online Transactions': [
      'Unique ID', 'Date', 'Vendor', 'Item', 'Price'
    ],
    'Credit Utilization': [
      'Unique ID', 'Date', 'Account', 'Credit Limit', 'Credit Used', 'Remaining Credit', 'Utilization %'
    ],
    'Predictive Alerts': [
      'Unique ID', 'Date', 'Type', 'Message', 'Trigger'
    ],
    'Token Usage': [
      'Unique ID', 'Date', 'Tokens Used', 'Estimated Cost', 'Query'
    ],
    'Data': [
      'User Message', 'Assistant Response', 'Timestamp'
    ]
  };
  
  // First, get all existing sheets
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title'
  });
  
  const existingSheets = spreadsheet.data.sheets.map(sheet => sheet.properties.title);
  console.log(`Existing sheets: ${existingSheets.join(', ')}`);
  
  // Create batch requests for missing sheets
  const batchRequests = [];
  const sheetsToCreate = [];
  
  for (const [sheetName, headers] of Object.entries(requiredSheets)) {
    if (!existingSheets.includes(sheetName)) {
      sheetsToCreate.push(sheetName);
      batchRequests.push({
        addSheet: {
          properties: {
            title: sheetName
          }
        }
      });
    }
  }
  
  // Create missing sheets in a single batch request if needed
  if (batchRequests.length > 0) {
    console.log(`Creating missing sheets: ${sheetsToCreate.join(', ')}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: batchRequests
      }
    });
  }
  
  // Now check and update headers for all sheets
  const headerUpdates = [];
  
  for (const [sheetName, headers] of Object.entries(requiredSheets)) {
    try {
      // Check if headers exist and match expected headers
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:Z1`
      });
      
      const existingHeaders = headerResponse.data.values?.[0] || [];
      
      // If headers don't match or are missing, update them
      if (existingHeaders.length === 0 || !headers.every(h => existingHeaders.includes(h))) {
        console.log(`Updating headers for sheet "${sheetName}"`);
        headerUpdates.push(
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [headers]
            }
          })
        );
      }
    } catch (error) {
      console.error(`Error checking headers for sheet ${sheetName}:`, error);
    }
  }
  
  // Execute all header updates in parallel
  if (headerUpdates.length > 0) {
    await Promise.all(headerUpdates);
    console.log('All headers updated successfully');
  }
  
  return {
    success: true,
    sheetsCreated: sheetsToCreate,
    message: 'Finance sheets setup completed successfully'
  };
};

// New endpoint to setup all finance sheets at once
app.post('/api/finance/setup-sheets', async (req, res) => {
  const { spreadsheetId, userId, email } = req.body;
  
  console.log('Finance sheets setup request received:', {
    spreadsheetId,
    userId,
    email
  });
  
  let authUserId = userId;
  let accessToken = null;
  
  // Authentication logic (same as other endpoints)
  const authHeader = req.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
    console.log('Got Bearer token from Authorization header');
    
    try {
      const tokenUserId = await getUserIdByAccessToken(accessToken);
      if (tokenUserId) {
        console.log(`Found user ID ${tokenUserId} for this Bearer token`);
        authUserId = tokenUserId;
      }
    } catch (authError) {
      console.error('Error looking up user ID from token:', authError);
      authUserId = accessToken;
    }
  }
  
  if (!authUserId && userId && userId.startsWith('ya29.')) {
    accessToken = userId;
    authUserId = userId;
  }
  
  if (!authUserId && accessToken) {
    try {
      authUserId = await storeAccessToken(accessToken, '', Date.now() + 3600000);
    } catch (storeError) {
      authUserId = accessToken;
    }
  }
  
  if (!authUserId) {
    authUserId = `temp_${crypto.randomBytes(8).toString('hex')}`;
    try {
      global.tempUsers = global.tempUsers || {};
      global.tempUsers[authUserId] = {
        created: new Date().toISOString()
      };
    } catch (tempError) {
      console.error('Failed to store temporary user:', tempError);
    }
  }
  
  // Validate required fields
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required" });
  }
  
  try {
    // Get token
    let token;
    if (authUserId.startsWith('ya29.')) {
      token = authUserId;
    } else if (accessToken) {
      token = accessToken;
    } else {
      token = await getValidTokenForUser(authUserId);
    }
    
    // Create OAuth client with the token
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ access_token: token });
    
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    // Setup all finance sheets
    const result = await setupFinanceSheets(sheets, spreadsheetId);
    
    // If email is provided, store spreadsheet ID in user preferences
    if (email) {
      try {
        await pool.query(
          `INSERT INTO user_preferences (email, default_spreadsheet_id)
           VALUES ($1, $2)
           ON CONFLICT (email) 
           DO UPDATE SET 
             default_spreadsheet_id = $2,
             last_updated = CURRENT_TIMESTAMP`,
          [email, spreadsheetId]
        );
        console.log(`Associated spreadsheet ${spreadsheetId} with email ${email}`);
      } catch (prefError) {
        console.error('Error storing spreadsheet preference:', prefError);
      }
    }
    
    res.json({
      message: "Finance sheets setup successfully",
      result
    });
  } catch (error) {
    console.error("Finance sheets setup error:", error);
    
    let errorMessage = "Failed to setup finance sheets";
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

// Modify the processFinancialData function to use the setupFinanceSheets function
const processFinancialData = async (sheets, spreadsheetId, data) => {
  const transactionId = generateTransactionId();
  const timestamp = new Date().toISOString();
  const results = [];
  
  // Define sheet structures with their headers
  const sheetStructures = {
    'Finances': [
      'Unique ID', 'Date', 'Category', 'Subcategory', 'Amount', 'Type', 'Payment Method', 'Notes'
    ],
    'Budget Tracking': [
      'Category', 'Budget Limit', 'Spent', 'Remaining Budget', 'Status'
    ],
    'Grocery Receipts': [
      'Unique ID', 'Date', 'Store', 'Item', 'Price'
    ],
    'Online Transactions': [
      'Unique ID', 'Date', 'Vendor', 'Item', 'Price'
    ],
    'Credit Utilization': [
      'Unique ID', 'Date', 'Account', 'Credit Limit', 'Credit Used', 'Remaining Credit', 'Utilization %'
    ],
    'Predictive Alerts': [
      'Unique ID', 'Date', 'Type', 'Message', 'Trigger'
    ],
    'Token Usage': [
      'Unique ID', 'Date', 'Tokens Used', 'Estimated Cost', 'Query'
    ]
  };
  
  // Ensure all required sheets exist with proper headers
  // Use the new setupFinanceSheets function instead of individual calls
  await setupFinanceSheets(sheets, spreadsheetId);
  
  // Process main transaction data
  if (data.transaction) {
    const { 
      category, 
      subcategory = '', 
      amount, 
      type, // 'Income' or 'Expense'
      paymentMethod = '',
      notes = ''
    } = data.transaction;
    
    // Add to main Finances sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Finances!A:H',
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          transactionId, 
          timestamp, 
          category, 
          subcategory, 
          amount, 
          type, 
          paymentMethod, 
          notes
        ]],
      },
    });
    results.push({ sheet: 'Finances', status: 'success' });
    
    // Update Budget Tracking sheet
    if (type === 'Expense') {
      try {
        // Get current budget data for this category
        const budgetResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `Budget Tracking!A:E`
        });
        
        const budgetRows = budgetResponse.data.values || [];
        let categoryRow = budgetRows.findIndex(row => row[0] === category);
        
        if (categoryRow > 0) { // Skip header row
          // Category exists, update spent amount
          const currentBudget = parseFloat(budgetRows[categoryRow][1]) || 0;
          const currentSpent = parseFloat(budgetRows[categoryRow][2]) || 0;
          const newSpent = currentSpent + parseFloat(amount);
          const remaining = currentBudget - newSpent;
          const status = remaining < 0 ? 'OVER BUDGET' : 
                        (remaining < 0.1 * currentBudget ? 'WARNING' : 'OK');
          
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Budget Tracking!C${categoryRow + 1}:E${categoryRow + 1}`,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [[newSpent, remaining, status]]
            }
          });
          
          // If over budget, add to Predictive Alerts
          if (status !== 'OK') {
            await sheets.spreadsheets.values.append({
              spreadsheetId,
              range: 'Predictive Alerts!A:E',
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[
                  transactionId,
                  timestamp,
                  'Budget Alert',
                  `${category} is ${status}: ${remaining < 0 ? 'Overspent by' : 'Only'} $${Math.abs(remaining).toFixed(2)} ${remaining < 0 ? 'over budget' : 'remaining'}`,
                  'Budget Tracking'
                ]],
              },
            });
            results.push({ sheet: 'Predictive Alerts', status: 'success', alert: status });
          }
        } else {
          // Category doesn't exist, add it with default budget
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Budget Tracking!A:E',
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [[
                category,
                '1000', // Default budget
                amount,
                (1000 - parseFloat(amount)).toString(),
                'OK'
              ]],
            },
          });
        }
        results.push({ sheet: 'Budget Tracking', status: 'success' });
      } catch (budgetError) {
        console.error('Error updating budget tracking:', budgetError);
        results.push({ sheet: 'Budget Tracking', status: 'error', message: budgetError.message });
      }
    }
  }
  
  // Process grocery receipt items
  if (data.groceryItems && data.groceryItems.length > 0) {
    try {
      const store = data.store || 'Unknown Store';
      const groceryRows = data.groceryItems.map(item => [
        transactionId,
        timestamp,
        store,
        item.name,
        item.price
      ]);
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Grocery Receipts!A:E',
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: groceryRows,
        },
      });
      results.push({ sheet: 'Grocery Receipts', status: 'success', itemCount: groceryRows.length });
    } catch (groceryError) {
      console.error('Error logging grocery items:', groceryError);
      results.push({ sheet: 'Grocery Receipts', status: 'error', message: groceryError.message });
    }
  }
  
  // Process online transaction
  if (data.onlineTransaction) {
    try {
      const { vendor, item, price } = data.onlineTransaction;
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Online Transactions!A:E',
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            transactionId,
            timestamp,
            vendor,
            item,
            price
          ]],
        },
      });
      results.push({ sheet: 'Online Transactions', status: 'success' });
    } catch (onlineError) {
      console.error('Error logging online transaction:', onlineError);
      results.push({ sheet: 'Online Transactions', status: 'error', message: onlineError.message });
    }
  }
  
  // Process credit card usage
  if (data.creditUsage) {
    try {
      const { account, creditLimit, creditUsed } = data.creditUsage;
      const remainingCredit = parseFloat(creditLimit) - parseFloat(creditUsed);
      const utilizationPercent = (parseFloat(creditUsed) / parseFloat(creditLimit) * 100).toFixed(2);
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Credit Utilization!A:G',
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            transactionId,
            timestamp,
            account,
            creditLimit,
            creditUsed,
            remainingCredit,
            utilizationPercent
          ]],
        },
      });
      
      // Add alert if utilization is high
      if (parseFloat(utilizationPercent) > 80) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Predictive Alerts!A:E',
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              transactionId,
              timestamp,
              'Credit Alert',
              `High credit utilization (${utilizationPercent}%) on account ${account}`,
              'Credit Utilization'
            ]],
          },
        });
        results.push({ sheet: 'Predictive Alerts', status: 'success', alert: 'High Credit Utilization' });
      }
      
      results.push({ sheet: 'Credit Utilization', status: 'success' });
    } catch (creditError) {
      console.error('Error logging credit usage:', creditError);
      results.push({ sheet: 'Credit Utilization', status: 'error', message: creditError.message });
    }
  }
  
  // Log token usage if provided
  if (data.tokenUsage) {
    try {
      const { tokensUsed, estimatedCost, query } = data.tokenUsage;
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Token Usage!A:E',
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            transactionId,
            timestamp,
            tokensUsed,
            estimatedCost,
            query
          ]],
        },
      });
      results.push({ sheet: 'Token Usage', status: 'success' });
    } catch (tokenError) {
      console.error('Error logging token usage:', tokenError);
      results.push({ sheet: 'Token Usage', status: 'error', message: tokenError.message });
    }
  }
  
  return {
    transactionId,
    timestamp,
    results
  };
};

// Update OpenAPI specification to include finance endpoints
app.get('/openapi.json', (req, res) => {
  // Serve a static OpenAPI specification
  const openApiSpec = {
    "openapi": "3.1.0",
    "info": {
      "title": "Finance Tracker API",
      "description": "API for logging financial data and chat conversations with Google Sheets",
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
        "FinanceTransactionRequest": {
          "type": "object",
          "properties": {
            "spreadsheetId": {
              "type": "string",
              "description": "Google Spreadsheet ID"
            },
            "userId": {
              "type": "string",
              "description": "User ID for authentication"
            },
            "data": {
              "type": "object",
              "description": "Financial data to process",
              "properties": {
                "transaction": {
                  "type": "object",
                  "description": "Main transaction details",
                  "properties": {
                    "category": {
                      "type": "string",
                      "description": "Transaction category"
                    },
                    "subcategory": {
                      "type": "string",
                      "description": "Transaction subcategory"
                    },
                    "amount": {
                      "type": "string",
                      "description": "Transaction amount"
                    },
                    "type": {
                      "type": "string",
                      "description": "Transaction type (Income or Expense)"
                    },
                    "paymentMethod": {
                      "type": "string",
                      "description": "Payment method used"
                    },
                    "notes": {
                      "type": "string",
                      "description": "Additional notes"
                    }
                  }
                },
                "groceryItems": {
                  "type": "array",
                  "description": "Itemized grocery receipt items",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "Item name"
                      },
                      "price": {
                        "type": "string",
                        "description": "Item price"
                      }
                    }
                  }
                },
                "onlineTransaction": {
                  "type": "object",
                  "description": "Online purchase details",
                  "properties": {
                    "vendor": {
                      "type": "string",
                      "description": "Vendor name"
                    },
                    "item": {
                      "type": "string",
                      "description": "Item purchased"
                    },
                    "price": {
                      "type": "string",
                      "description": "Purchase price"
                    }
                  }
                },
                "creditUsage": {
                  "type": "object",
                  "description": "Credit card usage details",
                  "properties": {
                    "account": {
                      "type": "string",
                      "description": "Credit card account"
                    },
                    "creditLimit": {
                      "type": "string",
                      "description": "Credit limit"
                    },
                    "creditUsed": {
                      "type": "string",
                      "description": "Amount of credit used"
                    }
                  }
                },
                "tokenUsage": {
                  "type": "object",
                  "description": "API token usage details",
                  "properties": {
                    "tokensUsed": {
                      "type": "string",
                      "description": "Number of tokens used"
                    },
                    "estimatedCost": {
                      "type": "string",
                      "description": "Estimated cost of token usage"
                    },
                    "query": {
                      "type": "string",
                      "description": "Original query that generated the token usage"
                    }
                  }
                }
              }
            }
          },
          "required": ["spreadsheetId", "data"]
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
      "/api/finance/log-transaction": {
        "post": {
          "summary": "Log financial transaction data",
          "operationId": "logFinanceTransaction",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/FinanceTransactionRequest"
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Successfully processed financial transaction"
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

// Add a specific endpoint for ChatGPT plugin debugging
app.get('/chatgpt-debug', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>ChatGPT Plugin Debug</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .debug-box { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; }
          pre { white-space: pre-wrap; word-break: break-all; }
          .section { border-left: 4px solid #4285f4; padding-left: 15px; margin: 20px 0; }
          h2 { color: #4285f4; }
        </style>
      </head>
      <body>
        <h1>ChatGPT Plugin Debug Information</h1>
        
        <div class="section">
          <h2>Environment</h2>
          <p>Node Environment: ${process.env.NODE_ENV || 'development'}</p>
          <p>Server URL: ${process.env.GOOGLE_REDIRECT_URI ? process.env.GOOGLE_REDIRECT_URI.split('/auth')[0] : 'Not configured'}</p>
        </div>
        
        <div class="section">
          <h2>OAuth Configuration</h2>
          <p>Redirect URI: ${process.env.GOOGLE_REDIRECT_URI || 'Not configured'}</p>
          <p>Client ID: ${process.env.GOOGLE_CLIENT_ID ? '✓ Configured' : '✗ Missing'}</p>
          <p>Client Secret: ${process.env.GOOGLE_CLIENT_SECRET ? '✓ Configured' : '✗ Missing'}</p>
        </div>
        
        <div class="section">
          <h2>Database Status</h2>
          <p>Database URL: ${process.env.DATABASE_URL ? '✓ Configured' : '✗ Missing'}</p>
        </div>
        
        <div class="section">
          <h2>Recent Authentication Activity</h2>
          <div id="recent-auth">Loading...</div>
        </div>
        
        <div class="section">
          <h2>Test OAuth Flow</h2>
          <p>Click the button below to test the OAuth flow:</p>
          <button id="test-oauth">Test OAuth Flow</button>
          <div id="oauth-result" style="margin-top: 10px;"></div>
        </div>
        
        <script>
          // Fetch recent authentication activity
          fetch('/api/debug/recent-auth')
            .then(response => response.json())
            .then(data => {
              document.getElementById('recent-auth').innerHTML = 
                data.recentAuth.length > 0 
                  ? '<pre>' + JSON.stringify(data.recentAuth, null, 2) + '</pre>'
                  : '<p>No recent authentication activity</p>';
            })
            .catch(error => {
              document.getElementById('recent-auth').innerHTML = 
                '<p>Error fetching authentication data: ' + error.message + '</p>';
            });
          
          // Test OAuth flow
          document.getElementById('test-oauth').addEventListener('click', function() {
            const resultDiv = document.getElementById('oauth-result');
            resultDiv.innerHTML = '<p>Initiating OAuth test...</p>';
            
            fetch('/api/debug/test-oauth')
              .then(response => response.json())
              .then(data => {
                if (data.url) {
                  resultDiv.innerHTML = '<p>Redirecting to OAuth URL...</p>';
                  window.location.href = data.url;
                } else {
                  resultDiv.innerHTML = '<p>Error: ' + (data.error || 'Unknown error') + '</p>';
                }
              })
              .catch(error => {
                resultDiv.innerHTML = '<p>Error: ' + error.message + '</p>';
              });
          });
        </script>
      </body>
    </html>
  `);
});

// Debug endpoint to get recent authentication activity
app.get('/api/debug/recent-auth', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT user_id, email, created_at, last_used FROM auth_tokens ORDER BY last_used DESC LIMIT 5'
    );
    
    // Redact sensitive information
    const recentAuth = result.rows.map(row => ({
      user_id: row.user_id.substring(0, 8) + '...',
      email: row.email ? row.email.split('@')[0] + '@...' : null,
      created_at: row.created_at,
      last_used: row.last_used
    }));
    
    res.json({ recentAuth });
  } catch (error) {
    console.error('Error fetching recent auth:', error);
    res.status(500).json({ error: 'Failed to fetch recent authentication data' });
  }
});

// Debug endpoint to test OAuth flow
app.get('/api/debug/test-oauth', (req, res) => {
  try {
    const oauth2Client = createOAuth2Client();
    const testState = 'debug-' + crypto.randomBytes(8).toString('hex');
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/spreadsheets"],
      prompt: 'consent',
      state: testState
    });
    
    res.json({ url: authUrl });
  } catch (error) {
    console.error('Error generating test OAuth URL:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// Add a specific endpoint for ChatGPT plugin to check connection
app.get('/api/plugin/check', (req, res) => {
  res.json({
    status: 'ok',
    message: 'GPT to Sheet plugin is connected and working',
    timestamp: new Date().toISOString()
  });
});

// Add a specific endpoint for ChatGPT plugin to get user ID
app.get('/api/plugin/get-user-id', async (req, res) => {
  const authHeader = req.get('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'No authorization token provided',
      message: 'Please authenticate with Google first'
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    // Try to get or create user ID for this token
    const userId = await getUserIdByAccessToken(token);
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Failed to identify user',
        message: 'Could not find or create user ID for the provided token'
      });
    }
    
    // Update last used timestamp
    try {
      await pool.query(
        'UPDATE auth_tokens SET last_used = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
    } catch (dbError) {
      console.error('Error updating last used timestamp:', dbError);
      // Continue anyway
    }
    
    return res.json({
      userId: userId,
      message: 'User ID retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting user ID for plugin:', error);
    return res.status(500).json({ 
      error: 'Failed to process authentication',
      message: error.message
    });
  }
});

