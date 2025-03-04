const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const cookieParser = require('cookie-parser');
const session = require('express-session');
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cookieParser());

// Add session management
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// OAuth2 Client
const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// Auth middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.tokens) {
    return next();
  }
  
  // Save the original request URL to redirect back after auth
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth');
};

// Step 1: Redirect user to Google OAuth
app.get("/auth", (req, res) => {
  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [process.env.GOOGLE_SCOPE],
    prompt: 'consent' // Force to get refresh token
  });
  res.redirect(authUrl);
});

// Auth callback that stores tokens in session
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in session
    req.session.tokens = tokens;
    
    // Redirect back to original request or success page
    const returnTo = req.session.returnTo || '/auth-success';
    req.session.returnTo = undefined;
    res.redirect(returnTo);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Modify the existing success page handler to display token
app.get("/auth-success", (req, res) => {
  const token = req.session.tokens ? req.session.tokens.access_token : "No token available";
  
  res.send(`
    <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .token-box { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; word-break: break-all; }
          button { background: #4285f4; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; }
          .success { color: green; display: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful</h1>
        <p>You are now authenticated with Google Sheets.</p>
        <p>Your access token for GPT integrations:</p>
        <div class="token-box">
          <code id="token">${token}</code>
        </div>
        <button id="copy-btn">Copy Token</button>
        <p class="success" id="success-msg">Token copied to clipboard!</p>
        <p>Return to your GPT conversation and paste this token when prompted.</p>
        
        <script>
          document.getElementById('copy-btn').addEventListener('click', function() {
            const tokenText = document.getElementById('token').textContent;
            navigator.clipboard.writeText(tokenText).then(function() {
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

// Simplified logging endpoint that uses session tokens
app.post("/api/log-data", isAuthenticated, async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp } = req.body;
  
  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(req.session.tokens);
    
    // Handle token refresh if needed
    if (req.session.tokens.expiry_date < Date.now()) {
      const { tokens } = await oauth2Client.refreshToken(req.session.tokens.refresh_token);
      req.session.tokens = tokens;
    }
    
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
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// Add this route
app.get('/auth-status', (req, res) => {
  if (req.session.tokens) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});
+// Add this after other app.use() calls
app.use(express.static('public'));

// Add a route for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// Add this new endpoint to your existing server.js file
// Place this before the "Start Server" section

// Endpoint to get data from a sheet
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName, range, token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Please include the access token." });
  }

  // Create a new OAuth client with the provided token
  const newOAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  newOAuth2Client.setCredentials({ access_token: token });
  
  const sheets = google.sheets({ version: "v4", auth: newOAuth2Client });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: range || `${sheetName}!A:C`,
    });

    res.json({ data: response.data.values });
  } catch (error) {
    res.status(500).json({ error: "Failed to read from sheet", details: error.message });
  }
});
