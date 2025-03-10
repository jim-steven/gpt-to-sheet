const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/get-sheet-data', async (req, res) => {
  const { spreadsheetId, sheetName, range, token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Please include the access token." });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({ access_token: token });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
