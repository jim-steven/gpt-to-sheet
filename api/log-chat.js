// This is a serverless function for Render.com
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/log-chat', async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp, token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Please include the access token." });
  }

  // Create OAuth client with the token
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({ access_token: token });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
