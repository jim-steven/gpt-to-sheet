// Core Node modules
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { JWT } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { Configuration, OpenAIApi } = require('openai');
const { GoogleAuth } = require('google-auth-library');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const { createHash } = require('crypto');
const { createHmac } = require('crypto');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const { createSign, createVerify } = require('crypto');
const { createPublicKey, createPrivateKey } = require('crypto');
const { generateKeyPairSync } = require('crypto');
const { createECDH } = require('crypto');
const { createDiffieHellman } = require('crypto');
const { createDiffieHellmanGroup } = require('crypto');
const { createHkdf } = require('crypto');
const { createSecretKey } = require('crypto');
const { createCipher, createDecipher } = require('crypto');
const { createHash: createHashLegacy } = require('crypto');
const { createHmac: createHmacLegacy } = require('crypto');
const { createSign: createSignLegacy, createVerify: createVerifyLegacy } = require('crypto');
const { createPublicKey: createPublicKeyLegacy, createPrivateKey: createPrivateKeyLegacy } = require('crypto');
const { generateKeyPairSync: generateKeyPairSyncLegacy } = require('crypto');
const { createECDH: createECDHLegacy } = require('crypto');
const { createDiffieHellman: createDiffieHellmanLegacy } = require('crypto');
const { createDiffieHellmanGroup: createDiffieHellmanGroupLegacy } = require('crypto');
const { createHkdf: createHkdfLegacy } = require('crypto');
const { createSecretKey: createSecretKeyLegacy } = require('crypto');
const { createCipher: createCipherLegacy, createDecipher: createDecipherLegacy } = require('crypto');

// Environment configuration
require("dotenv").config();

// Express app setup
const app = express();

// Define default values
const DEFAULT_SPREADSHEET_ID = '1zlC8E46a3lD6z6jNglA5IrrNIQv_5pLhRF0T7fOPhXs';
const DEFAULT_SHEET_NAME = 'Transactions';

// Define sheet names for different endpoints
const SHEET_NAMES = {
  transactions: 'Transactions',
  workouts: 'Workouts',
  food: 'Meals',
  journal: 'Journal',
  status: 'Status',
  chat: 'Chat'  // Add chat sheet name
};

// Add backup spreadsheet ID
const BACKUP_SPREADSHEET_ID = '1m6e-HTb1W_trKMKgkkM-ItcuwJJW-Ab6lM_TKmOAee4';

// Enhanced CORS and security configuration
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: false,
  maxAge: 86400,
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Add permissive security headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'notifications=*, geolocation=*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced security headers middleware
app.use((req, res, next) => {
  // CORS headers - most permissive configuration
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Max-Age', '86400');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  // Security headers - relaxed for API access
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'ALLOWALL');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Powered-By');
  
  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

// Remove any authentication requirements for endpoints
app.use((req, res, next) => {
  // Skip authentication checks
  next();
});

// Add notification middleware with less verbose logging
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log('📨 Message Detected:', {
      endpoint: req.path,
      timestamp: new Date().toISOString()
    });
  }
  next();
});

// Modify the response middleware to include notifications
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    // Add notification for successful sheet updates
    if (data.success && req.method === 'POST' && req.path.includes('/api/log-')) {
      console.log('📝 Message sent to sheet:', {
        endpoint: req.path,
        timestamp: new Date().toISOString(),
        transactionId: data.transactionId
      });
    }
    return originalJson.call(this, data);
  };
  next();
});

// Helper function to generate transaction IDs
const generateTransactionId = (prefix = 'TXN') => {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
};

// Error logging helper
const logErrorDetails = (error, context = '') => {
  console.error(`Error in ${context}:`, {
    message: error.message,
    code: error.code,
    status: error.status,
    details: error.response?.data || 'No response data',
    stack: error.stack?.split('\n').slice(0, 3).join('\n') || 'No stack trace'
  });
  return error;
};

// Initialize service account auth with timeout handling
const getServiceAccountAuth = async () => {
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

// Initialize sheets API with timeout handling - use async function to properly handle auth
let sheetsApi;
const getSheets = async () => {
  if (!sheetsApi) {
    const auth = await getServiceAccountAuth();
    sheetsApi = google.sheets({ 
      version: 'v4', 
      auth,
      timeout: 30000 // 30 second timeout for API requests
    });
  }
  return sheetsApi;
};

// Get service account email
app.get('/api/service-account', async (req, res) => {
  try {
    const auth = await getServiceAccountAuth();
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

// Rename the existing endpoint
app.post('/api/log-transactions', async (req, res) => {
  try {
    const sheets = await getSheets();
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = SHEET_NAMES.transactions, data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    console.log(`Attempting to log data to spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);
    const auth = await getServiceAccountAuth();
    await auth.authorize();
    console.log('Service account authorized successfully');

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

    // First, check if headers exist with timeout handling
    let headerResponse;
    try {
      const sheets = await getSheets();
      headerResponse = await Promise.race([
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!A1:AC1`
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout checking headers')), 15000))
      ]);
    } catch (error) {
      logErrorDetails(error, 'checking spreadsheet headers');
      throw new Error(`Failed to check spreadsheet headers: ${error.message}`);
    }

    // If no headers exist or they don't match, set them
    if (!headerResponse.data.values || headerResponse.data.values[0].join('\t') !== headers.join('\t')) {
      console.log('Setting headers in sheet');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:AC1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers]
        }
      });
    }

    // Convert data to array format
    const values = Array.isArray(data) ? data : [data];
    
    // Generate receipt ID for bulk transactions or transaction ID for single transactions
    const receiptId = Array.isArray(data) ? generateTransactionId('REC') : null;
    
    const rows = values.map((item, index) => {
      // Generate transaction ID
      const transactionId = Array.isArray(data) 
        ? `${receiptId}-ITEM-${index + 1}`
        : generateTransactionId('TXN');

      console.log('Processing item:', item); // Debug log

      // Return array in the same order as headers
      return [
        transactionId,                    // Transaction ID
        item.date || 'NA',               // Date
        item.time || 'NA',               // Time
        item.accountName || 'NA',        // Account Name
        item.transactionType || 'NA',    // Transaction Type
        item.category || 'NA',           // Category
        item.allowances || 'NA',         // Allowances
        item.deductions || 'NA',         // Deductions
        item.items || 'NA',              // Items
        item.establishment || 'NA',       // Establishment
        item.receiptNumber || 'NA',      // Receipt Number
        item.amount || 0,                // Amount
        item.paymentMethod || 'NA',      // Payment Method
        item.cardUsed || 'NA',           // Card Used
        item.linkedBudgetCategory || 'NA', // Linked Budget Category
        item.onlineTransactionId || 'NA', // Online Transaction ID
        item.mappedOnlineVendor || 'NA', // Mapped Online Vendor
        item.reimbursable || 'NA',       // Reimbursable
        item.reimbursementStatus || 'NA', // Reimbursement Status
        item.interestType || 'NA',       // Interest Type
        item.taxWithheld || 0,           // Tax Withheld
        item.taxDeductible || 'NA',      // Tax Deductible
        item.taxCategory || 'NA',        // Tax Category
        item.bankIdentifier || 'NA',     // Bank Identifier
        item.transactionMethod || 'NA',  // Transaction Method
        item.transferMethod || 'NA',     // Transfer Method
        item.referenceId || 'NA',        // Reference ID
        item.notes || 'NA',              // Notes
        item.processed || 'No'           // Processed
      ];
    });

    console.log('Prepared rows for insertion:', rows);
    
    // Append data to sheet with timeout handling
    let response;
    try {
      const sheets = await getSheets();
      response = await Promise.race([
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A:AC`,
          valueInputOption: 'RAW',
          requestBody: {
            values: rows
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout appending data')), 20000))
      ]);
    } catch (error) {
      logErrorDetails(error, 'appending data to spreadsheet');
      throw new Error(`Failed to append data to spreadsheet: ${error.message}`);
    }

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
      range: `${sheetName}!A:AC`  // Updated to include all 29 columns
    });
    
    // Ensure all rows have exactly 29 columns
    const data = (response.data.values || []).map(row => {
      const paddedRow = [...row];
      while (paddedRow.length < 29) {
        paddedRow.push('NA');
      }
      return paddedRow.slice(0, 29);
    });
    
    console.log('Data retrieved successfully');
    res.json({
      data: data
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
      logData: "POST /api/log-transactions",
      getSheetData: "POST /api/get-sheet-data",
      serviceAccount: "GET /api/service-account"
    },
    defaults: {
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
      sheetName: DEFAULT_SHEET_NAME
    }
  });
});

// Add new endpoint for workouts
app.post('/api/log-workouts', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = SHEET_NAMES.workouts, data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const auth = await getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Convert data to array format
    const dataArray = Array.isArray(data) ? data : [data];
    const workoutId = Array.isArray(data) ? `REC-${generateTransactionId()}` : `TXN-${generateTransactionId()}`;

    // Define headers for workouts
    const headers = [
      'Date', 'Workout Type', 'Exercises', 'Sets', 'Reps', 
      'Progression / Notes', 'Time / Duration', 'RPE', 
      'Energy / Mood', 'Next Focus / Adjustment'
    ];

    // Map the data to match the headers
    const values = dataArray.map(item => {
      console.log('Processing workout:', item);
      return [
        item.date || 'NA',
        item.workoutType || 'NA',
        item.exercises || 'NA',
        item.sets || 'NA',
        item.reps || 'NA',
        item.progression || 'NA',
        item.duration || 'NA',
        item.rpe || 'NA',
        item.energy || 'NA',
        item.nextFocus || 'NA'
      ];
    });

    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:J`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log('Data appended successfully:', response.data);

    res.json({
      success: true,
      message: 'Workout logged successfully',
      transactionId: workoutId,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
    } catch (error) {
    console.error('Error logging workout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log workout',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Add new endpoint for food logging
app.post('/api/log-food', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = SHEET_NAMES.food, data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const auth = await getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Convert data to array format
    const dataArray = Array.isArray(data) ? data : [data];
    const mealId = Array.isArray(data) ? `REC-${generateTransactionId()}` : `TXN-${generateTransactionId()}`;

    // Define headers for meals
    const headers = [
      'Date', 'Meal Type', 'Time Eaten', 'Food / Meal Description',
      'Portion / Serving Size', 'Calories', 'Macros',
      'Mood / Energy After Eating', 'Notes'
    ];

    // Map the data to match the headers
    const values = dataArray.map(item => {
      console.log('Processing meal:', item);
      return [
        item.date || 'NA',
        item.mealType || 'NA',
        item.timeEaten || 'NA',
        item.description || 'NA',
        item.portion || 'NA',
        item.calories || 'NA',
        item.macros || 'NA',
        item.mood || 'NA',
        item.notes || 'NA'
      ];
    });

    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:I`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log('Data appended successfully:', response.data);

    res.json({
      success: true,
      message: 'Meal logged successfully',
      transactionId: mealId,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
  } catch (error) {
    console.error('Error logging meal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log meal',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Add new endpoint for journal entries
app.post('/api/log-journal', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = SHEET_NAMES.journal, data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const auth = await getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Convert data to array format
    const dataArray = Array.isArray(data) ? data : [data];
    const entryId = Array.isArray(data) ? `REC-${generateTransactionId()}` : `TXN-${generateTransactionId()}`;

    // Define headers for journal entries
    const headers = [
      'Date', 'What happened?', 'Where did I see God?',
      'What is God teaching me?', 'How can I respond in faith?',
      'Prayer / Conversation with God', 'Scripture', 'Gratitude'
    ];

    // Map the data to match the headers
    const values = dataArray.map(item => {
      console.log('Processing journal entry:', item);
      return [
        item.date || 'NA',
        item.whatHappened || 'NA',
        item.whereGod || 'NA',
        item.teaching || 'NA',
        item.response || 'NA',
        item.prayer || 'NA',
        item.scripture || 'NA',
        item.gratitude || 'NA'
      ];
    });

    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:G`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log('Data appended successfully:', response.data);

    res.json({
      success: true,
      message: 'Journal entry logged successfully',
      transactionId: entryId,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
  } catch (error) {
    console.error('Error logging journal entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log journal entry',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Add new endpoint for status updates
app.post('/api/log-status', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName = SHEET_NAMES.status, data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const auth = await getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Convert data to array format
    const dataArray = Array.isArray(data) ? data : [data];
    const statusId = Array.isArray(data) ? `REC-${generateTransactionId()}` : `TXN-${generateTransactionId()}`;

    // Define headers for status updates
    const headers = [
      'Date', 'Time / Time Block', 'Activity / Task',
      'Category', 'Location', 'Mood', 'Energy Level',
      'Focus Level', 'Notes / Observations'
    ];

    // Map the data to match the headers
    const values = dataArray.map(item => {
      console.log('Processing status update:', item);
      return [
        item.date || 'NA',
        item.timeBlock || 'NA',
        item.activity || 'NA',
        item.category || 'NA',
        item.location || 'NA',
        item.mood || 'NA',
        item.energyLevel || 'NA',
        item.focusLevel || 'NA',
        item.notes || 'NA'
      ];
    });

    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:I`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log('Data appended successfully:', response.data);

    res.json({
      success: true,
      message: 'Status update logged successfully',
      transactionId: statusId,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
  } catch (error) {
    console.error('Error logging status update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log status update',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Add new endpoint for setting headers
app.post('/api/set-headers', async (req, res) => {
  try {
    const { spreadsheetId = DEFAULT_SPREADSHEET_ID, sheetName, headers } = req.body;
    if (!sheetName || !headers) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const auth = await getServiceAccountAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`
    });

    // Set new headers
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers]
      }
    });

    res.json({
      success: true,
      message: 'Headers set successfully',
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
  } catch (error) {
    console.error('Error setting headers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set headers',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Add new endpoint for chat logging backup
app.post('/api/log-chat-backup', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const sheets = await getSheets();

    // Convert data to array format
    const dataArray = Array.isArray(data) ? data : [data];
    const chatId = Array.isArray(data) ? `CHAT-${generateTransactionId()}` : `CHAT-${generateTransactionId()}`;

    // Define headers for chat logs
    const headers = [
      'Chat ID', 'Timestamp', 'Message Type', 'Message Content', 
      'Source', 'Status', 'Notes'
    ];

    // First, check if headers exist
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: BACKUP_SPREADSHEET_ID,
      range: `${SHEET_NAMES.chat}!A1:G1`
    });

    // If no headers exist or they don't match, set them
    if (!headerResponse.data.values || headerResponse.data.values[0].join('\t') !== headers.join('\t')) {
      console.log('Setting headers in chat sheet');
      await sheets.spreadsheets.values.update({
        spreadsheetId: BACKUP_SPREADSHEET_ID,
        range: `${SHEET_NAMES.chat}!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers]
        }
      });
    }

    // Map the data to match the headers
    const values = dataArray.map(item => {
      console.log('Processing chat message:', item);
      return [
        chatId,                                    // Chat ID
        new Date().toISOString(),                 // Timestamp
        item.type || 'message',                   // Message Type
        item.content || item.message || 'NA',     // Message Content
        item.source || 'user',                    // Source
        item.status || 'logged',                  // Status
        item.notes || 'Backup log entry'          // Notes
      ];
    });

    // Append data to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: BACKUP_SPREADSHEET_ID,
      range: `${SHEET_NAMES.chat}!A:G`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log('Chat backup logged successfully:', response.data);

    res.json({
      success: true,
      message: 'Chat backup logged successfully',
      chatId: chatId,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: true
      }
    });
  } catch (error) {
    console.error('Error logging chat backup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log chat backup',
      error: error.message,
      results: {
        methods: {
          serviceAccount: true,
          oauth: false,
          queue: false
        },
        primaryMethod: 'serviceAccount',
        success: false
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle 404 - add this before the error handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error('Unhandled error:', err);
  
  // Don't expose stack trace in production
  const errorResponse = {
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'production' ? {} : err
  };
  
  res.status(statusCode).json(errorResponse);
});

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle server timeouts
server.timeout = 60000; // 60 second timeout

