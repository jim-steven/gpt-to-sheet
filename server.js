// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const crypto = require('node:crypto');

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();
app.use(express.json());
app.use(cors());

// Helper function to generate transaction IDs
const generateTransactionId = (prefix = 'TXN') => {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

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

// Get service account email
app.get("/api/service-account", async (req, res) => {
  try {
    const client = await auth.getClient();
    const serviceAccount = client.email;
    res.json({ serviceAccount });
  } catch (error) {
    console.error("Error getting service account:", error);
    res.status(500).json({ error: "Failed to get service account email" });
  }
});

// Log data to Google Sheets with legacy format support
app.post("/api/log-data-to-sheet", async (req, res) => {
  const { spreadsheetId, sheetName, data, meta } = req.body;

  if (!spreadsheetId || !sheetName) {
    return res.status(400).json({ 
      success: false,
      message: "Missing required parameters",
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: "serviceAccount",
        success: false
      }
    });
  }

  try {
    // Handle bulk transaction
    if (Array.isArray(data)) {
      const receiptId = generateTransactionId('REC');
      const values = data.map((item, index) => {
        const txnId = `${receiptId}-ITEM-${index + 1}`;
        return [
          meta.date,
          meta.time,
          meta.accountName,
          meta.transactionType,
          meta.category,
          item.amount,
          meta.establishment,
          meta.receiptNumber,
          item.item,
          meta.paymentMethod,
          txnId
        ];
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:K`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values }
      });

      return res.json({
        success: true,
        message: `Successfully logged all ${data.length} items from receipt`,
        receiptId,
        results: data.map((item, index) => ({
          item: item.item,
          transactionId: `${receiptId}-ITEM-${index + 1}`,
          success: true,
          method: "serviceAccount"
        })),
        method: "serviceAccount"
      });
    }
    
    // Handle single transaction
    else {
      const transactionId = generateTransactionId();
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:K`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            data.date,
            data.time,
            data.accountName,
            data.transactionType,
            data.category,
            data.amount,
            data.establishment,
            data.receiptNumber,
            data.items.join(", "),
            data.paymentMethod,
            transactionId
          ]]
        }
      });

      return res.json({
        success: true,
        message: "Transaction logged successfully",
        transactionId,
        results: {
          methods: {
            serviceAccount: true,
            oauth: false,
            queue: false
          },
          primaryMethod: "serviceAccount",
          success: true
        }
      });
    }
  } catch (error) {
    console.error("Logging error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to write to sheet",
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: "serviceAccount",
        success: false,
        error: error.message
      }
    });
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
      range: range || `${sheetName}!A:K`,
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
      logData: "POST /api/log-data-to-sheet",
      getSheetData: "POST /api/get-sheet-data",
      serviceAccount: "GET /api/service-account"
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

