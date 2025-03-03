const { google } = require("googleapis");
require("dotenv").config();

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    res.status(200).json({ message: "Data logged successfully!", response: response.data });
  } catch (error) {
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
};
