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
      
      // Clear the sheet completely
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:AC`
      });

      // Add headers with new expanded format
      const headers = [
        ["Transaction ID", "Date", "Time", "Account Name", "Transaction Type", "Category", "Allowances", "Deductions", "Items", "Establishment", "Receipt Number", "Amount", "Payment Method", "Card Used", "Linked Budget Category", "Online Transaction ID", "Mapped Online Vendor", "Reimbursable", "Reimbursement Status", "Interest Type", "Tax Withheld", "Tax Deductible", "Tax Category", "Bank Identifier", "Transaction Method", "Transfer Method", "Reference ID", "Notes", "Processed"]
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:AC1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: headers }
      });

      // Add data starting from row 2 with expanded columns
      const values = data.map((item, index) => [
        `${receiptId}-ITEM-${index + 1}`,  // Transaction ID
        meta.date || "",                    // Date
        meta.time || "",                    // Time
        meta.accountName || "",             // Account Name
        meta.transactionType || "",         // Transaction Type
        meta.category || "",                // Category
        meta.allowances || "",              // Allowances
        meta.deductions || "",              // Deductions
        item.item || "",                    // Items
        meta.establishment || "",           // Establishment
        meta.receiptNumber || "",           // Receipt Number
        item.amount || "",                  // Amount
        meta.paymentMethod || "",           // Payment Method
        meta.cardUsed || "",                // Card Used
        meta.linkedBudgetCategory || "",    // Linked Budget Category
        meta.onlineTransactionId || "",     // Online Transaction ID
        meta.mappedOnlineVendor || "",      // Mapped Online Vendor
        meta.reimbursable || "",            // Reimbursable
        meta.reimbursementStatus || "",     // Reimbursement Status
        meta.interestType || "",            // Interest Type
        meta.taxWithheld || "",             // Tax Withheld
        meta.taxDeductible || "",           // Tax Deductible
        meta.taxCategory || "",             // Tax Category
        meta.bankIdentifier || "",          // Bank Identifier
        meta.transactionMethod || "",       // Transaction Method
        meta.transferMethod || "",          // Transfer Method
        meta.referenceId || "",             // Reference ID
        meta.notes || "",                   // Notes
        meta.processed || ""                // Processed
      ]);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A2:AC${values.length + 1}`,
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
    const transactionId = generateTransactionId();
    
    // Clear the sheet completely
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:AC`
    });

    // Add headers with new expanded format
    const headers = [
      ["Transaction ID", "Date", "Time", "Account Name", "Transaction Type", "Category", "Allowances", "Deductions", "Items", "Establishment", "Receipt Number", "Amount", "Payment Method", "Card Used", "Linked Budget Category", "Online Transaction ID", "Mapped Online Vendor", "Reimbursable", "Reimbursement Status", "Interest Type", "Tax Withheld", "Tax Deductible", "Tax Category", "Bank Identifier", "Transaction Method", "Transfer Method", "Reference ID", "Notes", "Processed"]
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:AC1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: headers }
    });

    // Add data in row 2 with expanded columns
    const values = [[
      transactionId,                    // Transaction ID
      data.date || "",                  // Date
      data.time || "",                  // Time
      data.accountName || "",           // Account Name
      data.transactionType || "",       // Transaction Type
      data.category || "",              // Category
      data.allowances || "",            // Allowances
      data.deductions || "",            // Deductions
      data.items?.join(', ') || "",     // Items
      data.establishment || "",         // Establishment
      data.receiptNumber || "",         // Receipt Number
      data.amount || "",                // Amount
      data.paymentMethod || "",         // Payment Method
      data.cardUsed || "",              // Card Used
      data.linkedBudgetCategory || "",  // Linked Budget Category
      data.onlineTransactionId || "",   // Online Transaction ID
      data.mappedOnlineVendor || "",    // Mapped Online Vendor
      data.reimbursable || "",          // Reimbursable
      data.reimbursementStatus || "",   // Reimbursement Status
      data.interestType || "",          // Interest Type
      data.taxWithheld || "",           // Tax Withheld
      data.taxDeductible || "",         // Tax Deductible
      data.taxCategory || "",           // Tax Category
      data.bankIdentifier || "",        // Bank Identifier
      data.transactionMethod || "",     // Transaction Method
      data.transferMethod || "",        // Transfer Method
      data.referenceId || "",           // Reference ID
      data.notes || "",                 // Notes
      data.processed || ""              // Processed
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A2:AC2`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
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

// Get sheet data
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;

  if (!spreadsheetId || !sheetName) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // First set the headers to ensure all columns are present
    const headers = [
      ["Transaction ID", "Date", "Time", "Account Name", "Transaction Type", "Category", "Allowances", "Deductions", "Items", "Establishment", "Receipt Number", "Amount", "Payment Method", "Card Used", "Linked Budget Category", "Online Transaction ID", "Mapped Online Vendor", "Reimbursable", "Reimbursement Status", "Interest Type", "Tax Withheld", "Tax Deductible", "Tax Category", "Bank Identifier", "Transaction Method", "Transfer Method", "Reference ID", "Notes", "Processed"]
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:AC1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: headers }
    });

    // Now get the data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:AC`,
      majorDimension: 'ROWS'
    });

    res.json({ data: response.data.values || [] });
  } catch (error) {
    console.error("Error getting sheet data:", error);
    res.status(500).json({ error: "Failed to get sheet data" });
  }
});

// Set headers in Google Sheets
app.post("/api/set-sheet-headers", async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;

  if (!spreadsheetId || !sheetName) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // Add headers
    const headers = [
      ["Transaction ID", "Date", "Time", "Account Name", "Transaction Type", "Category", "Allowances", "Deductions", "Items", "Establishment", "Receipt Number", "Amount", "Payment Method", "Card Used", "Linked Budget Category", "Online Transaction ID", "Mapped Online Vendor", "Reimbursable", "Reimbursement Status", "Interest Type", "Tax Withheld", "Tax Deductible", "Tax Category", "Bank Identifier", "Transaction Method", "Transfer Method", "Reference ID", "Notes", "Processed"]
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:AC1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: headers }
    });

    res.json({
      success: true,
      message: "Headers set successfully"
    });
  } catch (error) {
    console.error("Error setting headers:", error);
    res.status(500).json({ error: "Failed to set headers", details: error.message });
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

