const express = require("express");
const { google } = require("googleapis");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config();

// Add these imports at the top of your file
const { Pool } = require('pg');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

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

// File to store user tokens
const USERS_FILE = path.join(__dirname, 'users.json');
// Helper function to read users data
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

// Helper function to save users data
const saveUsers = (users) => {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
};

// OAuth2 Client
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
    
    // Redirect to success page with user ID
    res.redirect(`/auth-success?userId=${userId}`);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed", details: error.message });
  }
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
    throw new Error("User ID is required");
  }
  
  const users = readUsers();
  const user = users[userId];
  
  if (!user || !user.tokens) {
    throw new Error("User not found or not authenticated");
  }
  
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(user.tokens);
  
  // Check if token needs refresh
  if (Date.now() >= user.tokens.expiry_date) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      users[userId].tokens = credentials;
      saveUsers(users);
      return credentials.access_token;
    } catch (error) {
      console.error("Token refresh error:", error);
      throw new Error("Failed to refresh token");
    }
  }
  
  return user.tokens.access_token;
};

// Simplified endpoint to log data with userId
app.post("/api/log-data-v1", async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, userId } = req.body;
  
  if (!userId) {
    return res.status(401).json({ error: "User ID is required" });
  }
  
  try {
    // Get a valid token for this user
    const token = await getValidTokenForUser(userId);
    
    // Create OAuth client with the token
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ access_token: token });
    
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:C`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[userMessage, assistantResponse, timestamp]],
      },
    });
    
    res.json({ message: "Data logged successfully!", response: response.data });
  } catch (error) {
    console.error("Logging error:", error);
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
});

// Simplified endpoint to get sheet data with userId
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName, range, userId } = req.body;
  
  if (!userId) {
    return res.status(401).json({ error: "User ID is required" });
  }
  
  try {
    // Get a valid token for this user
    const token = await getValidTokenForUser(userId);
    
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
  res.json({
    "openapi": "3.1.0",
    "info": {
      "title": "Chat Logger API",
      "description": "API for logging and retrieving chat conversations with Google Sheets",
      "version": "1.0ותיקון"
    },
    "servers": [
      {
        "url": "https://gpt-to-sheet.onrender.com"
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
                    },
                    "userId": {
                      "type": "string",
                      "description": "User ID from authentication"
                    }
                  },
                  "required": ["spreadsheetId", "sheetName", "userMessage", "assistantResponse", "userId"]
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
                    },
                    "userId": {
                      "type": "string",
                      "description": "User ID from authentication"
                    }
                  },
                  "required": ["spreadsheetId", "userId"]
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
  });
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



// Setup database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Needed for Render.com PostgreSQL
  }
});

// Initialize the database table
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

// Call initDatabase when the server starts
initDatabase().catch(console.error);

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Add these additional middleware
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Start Server
const PORT = process.env.PORT || 3001;
// Add a route to check authentication status for SSO users
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

// Add this right after your pool definition, but before your routes
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

// Add this simple test route
app.get('/auth/test', (req, res) => {
  res.json({ status: 'working' });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));