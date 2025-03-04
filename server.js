const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// OAuth2 Client
const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// Step 1: Redirect user to Google OAuth
app.get("/auth", (req, res) => {
  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
    prompt: 'consent' // Force to get refresh token
  });
  res.redirect(authUrl);
});

// Auth callback that provides token to user
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Redirect to success page with token
    res.redirect(`/auth-success?token=${encodeURIComponent(tokens.access_token)}`);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Success page that displays the token
app.get("/auth-success", (req, res) => {
  const token = req.query.token || "No token available";
  
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

// Token-based endpoint for logging data
app.post("/api/log-data-v1", async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, token } = req.body;

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
    console.error("Reading error:", error);
    res.status(500).json({ error: "Failed to read from sheet", details: error.message });
  }
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
        </style>
      </head>
      <body>
        <h1>GPT to Google Sheets Integration</h1>
        <p>This service allows GPTs to log conversations to Google Sheets.</p>
        <p>To get started:</p>
        <ol>
          <li>Click the authentication button below</li>
          <li>Complete the Google authentication process</li>
          <li>Copy the provided access token</li>
          <li>Return to your GPT conversation and paste the token when prompted</li>
        </ol>
        <a href="/auth" class="button">Authenticate with Google</a>
      </body>
    </html>
  `);
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));