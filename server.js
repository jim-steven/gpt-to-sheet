// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const crypto = require('node:crypto');

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();

// Default configuration
const DEFAULT_SPREADSHEET_ID = '1zlC8E46a3lD6z6jNglA5IrrNIQv_5pLhRF0T7fOPhXs';
const DEFAULT_SHEET_NAME = 'Transactions';

// Configure CORS with specific options
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle preflight requests
app.options('*', cors(corsOptions));

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

// Initialize sheets API
const sheets = google.sheets({ 
  version: 'v4', 
  auth: getServiceAccountAuth()
});

// Get service account email
app.get('/api/service-account', async (req, res) => {
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
    console.error("Service account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get service account",
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

// Log data to sheet
app.post('/api/log-data-to-sheet', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = DEFAULT_SHEET_NAME, data } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        message: "Missing required data parameter",
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

    console.log(`Attempting to log data to spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);
    const auth = getServiceAccountAuth();
    await auth.authorize();
    console.log('Service account authorized successfully');

    // Convert data to array format
    const values = Array.isArray(data) ? data : [data];
    
    // Define headers in the correct order
    const headers = [
      'Transaction ID', 'Date', 'Time', 'Account Name', 'Transaction Type', 
      'Category', 'Allowances', 'Deductions', 'Items', 'Establishment', 
      'Receipt Number', 'Amount', 'Payment Method', 'Card Used', 
      'Linked Budget Category', 'Online Transaction ID', 'Mapped Online Vendor', 
      'Reimbursable', 'Reimbursement Status', 'Interest Type', 'Tax Withheld', 
      'Tax Deductible', 'Tax Category', 'Bank Identifier', 'Transaction Method', 
      'Transfer Method', 'Reference ID', 'Notes', 'Processed'
    ];

    // Generate receipt ID for bulk transactions or transaction ID for single transactions
    const receiptId = Array.isArray(data) ? generateTransactionId('REC') : null;
    
    const rows = values.map((item, index) => {
      // Generate transaction ID
      const transactionId = Array.isArray(data) 
        ? `${receiptId}-ITEM-${index + 1}`
        : generateTransactionId('TXN');

      return [
        transactionId,
        item.date || '',
        item.time || '',
        item.accountName || '',
        item.transactionType || '',
        item.category || '',
        item.allowances || '',
        item.deductions || '',
        item.items || '',
        item.establishment || '',
        item.receiptNumber || '',
        item.amount || 0,
        item.paymentMethod || '',
        item.cardUsed || '',
        item.linkedBudgetCategory || '',
        item.onlineTransactionId || '',
        item.mappedOnlineVendor || '',
        item.reimbursable || '',
        item.reimbursementStatus || '',
        item.interestType || '',
        item.taxWithheld || 0,
        item.taxDeductible || '',
        item.taxCategory || '',
        item.bankIdentifier || '',
        item.transactionMethod || '',
        item.transferMethod || '',
        item.referenceId || '',
        item.notes || '',
        item.processed || 'No'
      ];
    });

    console.log('Prepared rows for insertion:', rows);
    
    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:AC`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows
      }
    });

    console.log('Data appended successfully:', response.data);

    res.json({
      success: true,
      message: "Transaction logged successfully",
      transactionId: Array.isArray(data) ? receiptId : rows[0][0],
      receiptId: Array.isArray(data) ? receiptId : null,
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
    console.error("Error logging data:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      message: "Failed to log data",
      error: error.message,
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

// Get sheet data
app.post('/api/get-sheet-data', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = DEFAULT_SHEET_NAME } = req.body;

    console.log(`Attempting to get data from spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);
    const auth = getServiceAccountAuth();
    await auth.authorize();
    console.log('Service account authorized successfully');

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:AA`
    });

    console.log('Data retrieved successfully');
    res.json({
      data: response.data.values || []
    });
  } catch (error) {
    console.error("Error getting sheet data:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      message: "Failed to get sheet data",
      error: error.message,
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Root path route
app.get('/', (req, res) => {
  res.json({
    message: "GPT to Sheet API",
    endpoints: {
      logData: "POST /api/log-data-to-sheet",
      getSheetData: "POST /api/get-sheet-data",
      serviceAccount: "GET /api/service-account"
    },
    defaults: {
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
      sheetName: DEFAULT_SHEET_NAME
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

