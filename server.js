// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();
app.use(express.json());
app.use(cors());

// Create service account client
let auth;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // For production: use JSON string from environment variable
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
} else {
  // For local development: use file path
  auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

// Initialize sheets API
const sheets = google.sheets({ version: 'v4', auth });

// Log data to Google Sheets
app.post("/api/log-data", async (req, res) => {
  const { spreadsheetId, sheetName, userMessage, assistantResponse, timestamp } = req.body;

  if (!spreadsheetId || !sheetName || !userMessage || !assistantResponse) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:C`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[userMessage, assistantResponse, timestamp || new Date().toISOString()]],
      },
    });

    res.json({ message: "Data logged successfully!", response: response.data });
  } catch (error) {
    console.error("Logging error:", error);
    res.status(500).json({ error: "Failed to write to sheet", details: error.message });
  }
});

// Get data from Google Sheets
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName, range } = req.body;

  if (!spreadsheetId) {
    return res.status(400).json({ error: "Missing spreadsheetId" });
  }

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
  res.json({
    message: "GPT to Sheet API",
    endpoints: {
      logData: "POST /api/log-data",
      getSheetData: "POST /api/get-sheet-data"
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

