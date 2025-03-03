const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();
app.use(express.json());

// OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Step 1: Redirect user to Google OAuth
app.get("/auth", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [process.env.GOOGLE_SCOPE],
  });
  res.redirect(authUrl);
});

// Option 2: Add token persistence with cookie-based sessions
const cookieParser = require('cookie-parser');

app.use(cookieParser());

// Modify the callback handler to redirect with the token in the URL
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Redirect to a success page with the access token as a query parameter
    res.redirect(`/auth-success?token=${encodeURIComponent(tokens.access_token)}`);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Add a success page that displays the token
app.get("/auth-success", (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Authentication Successful</h1>
        <p>Your access token: ${req.query.token}</p>
        <p>Use this token in your API requests.</p>
      </body>
    </html>
  `);
});

// Add this new endpoint with a non-standard name
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
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
