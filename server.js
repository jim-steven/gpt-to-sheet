// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const crypto = require('node:crypto');

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to generate transaction IDs
const generateTransactionId = (prefix = 'TXN') => {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

// Initialize service account auth
const getServiceAccountAuth = () => {
  try {
    // Get credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    
    // Create a new JWT client
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    // Set the key algorithm
    auth.keyAlgorithm = 'RS256';
    
    return auth;
  } catch (error) {
    console.error('Error initializing service account:', error);
    throw error;
  }
};

// Get service account email
app.get("/api/service-account", async (req, res) => {
  try {
    const auth = getServiceAccountAuth();
    await auth.authorize();
    
    res.json({ 
      serviceAccount: auth.email,
      success: true,
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
    console.error("Error getting service account:", error);
    res.status(500).json({ 
      error: "Failed to get service account email",
      success: false,
      results: {
        methods: {
          serviceAccount: false,
          oauth: false,
          queue: false
        },
        primaryMethod: "serviceAccount",
        success: false
      }
    });
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
    // Get service account auth
    const auth = getServiceAccountAuth();
    await auth.authorize();
    
    // Create sheets client
    const sheets = google.sheets({ version: 'v4', auth });

    // Handle single transaction
    if (!Array.isArray(data)) {
      const transactionId = generateTransactionId();
      
      // Prepare the row data
      const rowData = [
        transactionId,
        data.date || "",
        data.time || "",
        data.accountName || "",
        data.transactionType || "",
        data.category || "",
        data.allowances || "",
        data.deductions || "",
        "", // Items (empty for single transaction)
        data.establishment || "",
        data.receiptNumber || "",
        data.amount || 0,
        data.paymentMethod || "",
        data.cardUsed || "",
        data.linkedBudgetCategory || "",
        data.onlineTransactionId || "",
        data.mappedOnlineVendor || "",
        data.reimbursable || "",
        data.reimbursementStatus || "",
        data.interestType || "",
        data.taxWithheld || 0,
        data.taxDeductible || "",
        data.taxCategory || "",
        data.bankIdentifier || "",
        data.transactionMethod || "",
        data.transferMethod || "",
        data.referenceId || "",
        data.notes || "",
        data.processed || "false"
      ];

      // Append the row to the sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:AC`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowData] }
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

    // Handle bulk transaction
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
      range: `${sheetName}!A1`,
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
      item.amount || 0,                   // Amount
      meta.paymentMethod || "",           // Payment Method
      meta.cardUsed || "",                // Card Used
      meta.linkedBudgetCategory || "",    // Linked Budget Category
      meta.onlineTransactionId || "",     // Online Transaction ID
      meta.mappedOnlineVendor || "",      // Mapped Online Vendor
      meta.reimbursable || "",            // Reimbursable
      meta.reimbursementStatus || "",     // Reimbursement Status
      meta.interestType || "",            // Interest Type
      meta.taxWithheld || 0,              // Tax Withheld
      meta.taxDeductible || "",           // Tax Deductible
      meta.taxCategory || "",             // Tax Category
      meta.bankIdentifier || "",          // Bank Identifier
      meta.transactionMethod || "",       // Transaction Method
      meta.transferMethod || "",          // Transfer Method
      meta.referenceId || "",             // Reference ID
      meta.notes || "",                   // Notes
      meta.processed || "false"           // Processed
    ]);

    // Append the data to the sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });

    return res.json({
      success: true,
      message: "Bulk transactions logged successfully",
      receiptId,
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
    console.error("Error writing to sheet:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to write to sheet",
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
});

// Get sheet data
app.post("/api/get-sheet-data", async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;

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
    // Get service account auth
    const auth = getServiceAccountAuth();
    await auth.authorize();
    
    // Create sheets client
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:AC`
    });

    return res.json({
      data: response.data.values || []
    });
  } catch (error) {
    console.error("Error reading from sheet:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to read from sheet",
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
});

// Set headers in Google Sheets
app.post("/api/set-sheet-headers", async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;

  if (!spreadsheetId || !sheetName) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  
  try {
    // Get service account auth
    const auth = getServiceAccountAuth();
    await auth.authorize();
    
    // Create sheets client
    const sheets = google.sheets({ version: 'v4', auth });

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

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

