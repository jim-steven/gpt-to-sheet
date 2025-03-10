const express = require("express");
const { google } = require("googleapis");
const cookieParser = require('cookie-parser');
const session = require('express-session');
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cookieParser());

// Add session management
app.use(session({
  secret: process.env.SESSION_SECRET || 'test-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// OAuth2 Client
const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// Auth middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.tokens) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth');
};

// Auth routes
app.get("/auth", (req, res) => {
  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    const returnTo = req.session.returnTo || '/auth-success';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

app.get("/auth-success", (req, res) => {
  res.send(`
    <html><body>
      <h1>Authentication Successful</h1>
      <p>You are now authenticated with Google Sheets.</p>
      <p><a href="/test-log">Test logging to sheets</a></p>
    </body></html>
  `);
});

// Test endpoint for logging
app.get("/test-log", isAuthenticated, (req, res) => {
  res.send(`
    <html><body>
      <h1>Test Logging</h1>
      <form id="logForm">
        <p>Spreadsheet ID: <input type="text" id="spreadsheetId" required></p>
        <p>Sheet Name: <input type="text" id="sheetName" value="Sheet1" required></p>
        <p>User Message: <input type="text" id="userMessage" value="Test user message" required></p>
        <p>Assistant Response: <input type="text" id="assistantResponse" value="Test assistant response" required></p>
        <button type="submit">Log to Sheet</button>
      </form>
      <div id="result"></div>
      
      <script>
        document.getElementById('logForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const result = document.getElementById('result');
          result.textContent = 'Logging...';
          
          try {
            const response = await fetch('/api/log-data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                spreadsheetId: document.getElementById('spreadsheetId').value,
                sheetName: document.getElementById('sheetName').value,
                userMessage: document.getElementById('userMessage').value,
                assistantResponse: document.getElementById('assistantResponse').value,
                timestamp: new Date().toISOString()
              })
            });
            
            const data = await response.json();
            result.textContent = 'Success: ' + JSON.stringify(data);
          } catch (error) {
            result.textContent = 'Error: ' + error.message;
          }
        });
      </script>
    </body></html>
  `);
});

// Auth status endpoint
app.get('/auth-status', (req, res) => {
  res.json({ authenticated: !!req.session.tokens });
});

// Simplified logging endpoint
app.post("/api/log-data", isAuthenticated, async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp } = req.body;
  
  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(req.session.tokens);
    
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
    console.error('Logging error:', error);
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Test server running on http://localhost:${PORT}`));
