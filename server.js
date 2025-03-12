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

// Helper function to get tokens from database
const getTokensFromDB = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT access_token, refresh_token, token_expiry FROM auth_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const { access_token, refresh_token, token_expiry } = result.rows[0];
    
    return {
      access_token,
      refresh_token,
      expiry_date: new Date(token_expiry).getTime()
    };
  } catch (error) {
    console.error('Error getting tokens from DB:', error);
    return null;
  }
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
    let params = {};
    
    // Combine all possible sources of parameters
    Object.assign(params, req.query || {});
    Object.assign(params, req.body || {});
    
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
    } else if (effectiveGrantType === 'refresh_token') {
      if (!params.refresh_token) {
        return res.status(400).json({ error: 'refresh_token is required for refresh_token grant type' });
      }
      
      // Refresh the tokens
      oauth2Client.setCredentials({
        refresh_token: params.refresh_token
      });
      tokenResponse = await oauth2Client.refreshAccessToken();
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
          button { background: #4285f4; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; }
          .success { color: green; display: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful</h1>
        <p>You're now authenticated with Google Sheets!</p>
        <p>Your user ID:</p>
        <div class="id-box">
          <code id="userId">${userId}</code>
        </div>
        <button id="copy-btn">Copy User ID</button>
        <p class="success" id="success-msg">User ID copied to clipboard!</p>
        <p>Important: Save this ID somewhere safe. You'll need it if you want to use this integration in a different conversation.</p>
        <p>Return to your GPT conversation - it can now access your Google Sheets without requiring a token.</p>
        
        <script>
          document.getElementById('copy-btn').addEventListener('click', function() {
            const idText = document.getElementById('userId').textContent;
            navigator.clipboard.writeText(idText).then(function() {
              document.getElementById('success-msg').style.display = 'block';
              setTimeout(function() {
                document.getElementById('success-msg').style.display = 'none';
              }, 3000);
            });
          });
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
// Simplified endpoint to log data with userId
app.post("/api/log-data-v1", async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, userId } = req.body;
  
  console.log('Logging request received:', {
    spreadsheetId,
    sheetName,
    userId,
    messageLength: userMessage?.length,
    responseLength: assistantResponse?.length
  });
  
  // Get userId from request body or Authorization header if using OAuth
  const authUserId = userId || req.get('Authorization')?.split(' ')[1];
  
  if (!authUserId) {
    console.error('Log attempt failed: No user ID provided');
    return res.status(401).json({ error: "User ID is required" });
  }
  
  console.log(`Log attempt for user ID: ${authUserId}`);
  
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
    // Get a valid token for this user
    console.log(`Getting token for user: ${authUserId}`);
    const token = await getValidTokenForUser(authUserId);
    console.log(`Successfully obtained token for user: ${authUserId}`);
    
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

