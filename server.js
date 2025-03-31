// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const crypto = require('node:crypto');

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();

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
    const { spreadsheetId, sheetName, data } = req.body;

    if (!spreadsheetId || !sheetName || !data) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
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

    const auth = getServiceAccountAuth();
    await auth.authorize();

    // Convert data to array format
    const values = Array.isArray(data) ? data : [data];
    const headers = [
      'Date', 'Time', 'Account Name', 'Transaction Type', 'Category',
      'Allowances', 'Deductions', 'Amount', 'Establishment', 'Receipt Number',
      'Payment Method', 'Card Used', 'Linked Budget Category', 'Online Transaction ID',
      'Mapped Online Vendor', 'Reimbursable', 'Reimbursement Status', 'Interest Type',
      'Tax Withheld', 'Tax Deductible', 'Tax Category', 'Bank Identifier',
      'Transaction Method', 'Transfer Method', 'Reference ID', 'Notes', 'Processed'
    ];

    const rows = values.map(item => {
      return headers.map(header => {
        const key = header.toLowerCase().replace(/\s+/g, '');
        return item[key] || '';
      });
    });

    // Append data to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:AA`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows
      }
    });

    res.json({
      success: true,
      message: "Transaction logged successfully",
      transactionId: generateTransactionId(),
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
    res.status(500).json({
      success: false,
      message: "Failed to log data",
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
    const { spreadsheetId, sheetName } = req.body;

    if (!spreadsheetId || !sheetName) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
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

    const auth = getServiceAccountAuth();
    await auth.authorize();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:AA`
    });

    res.json({
      data: response.data.values || []
    });
  } catch (error) {
    console.error("Error getting sheet data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sheet data",
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
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

