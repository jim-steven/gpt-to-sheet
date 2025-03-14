const { google } = require("googleapis");
require("dotenv").config();
const { oauth2Client, storeTokens } = require('./auth');
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

router.get('/', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    console.error('Authorization code is missing');
    return res.status(400).json({ error: 'Authorization code is missing' });
  }

  try {
    console.log('Getting token with code');
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log('Successfully obtained tokens');

    // Get user info to use as userId
    const oauth2 = google.oauth2('v2');
    const userInfo = await oauth2.userinfo.get({ auth: oauth2Client });
    const userId = userInfo.data.email;
    console.log(`User authenticated: ${userId}`);

    // Ensure tokens are properly stored
    const storedSuccessfully = await storeTokens(userId, tokens);
    
    if (!storedSuccessfully) {
      console.error(`Failed to store tokens for user ${userId}`);
      return res.status(500).json({ 
        error: 'Failed to store authentication tokens',
        userId: userId // Include userId in the response
      });
    }
    
    console.log(`Tokens stored successfully for user ${userId}`);

    // Check if this is a ChatGPT plugin callback
    const referer = req.get('Referer') || '';
    if (referer.includes('chat.openai.com') || referer.includes('chatgpt.com')) {
      console.log('Responding to ChatGPT plugin with JSON');
      // Return JSON response for ChatGPT plugin
      return res.json({ 
        success: true, 
        userId: userId,
        message: 'Authentication successful, you can now use this service with ChatGPT'
      });
    }

    // Regular web application flow
    console.log('Redirecting to success page');
    res.redirect(`/auth-success?userId=${userId}`);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ 
      error: 'Failed to exchange token',
      details: error.message
    });
  }
});

// Add this to your server startup
try {
  const testDir = path.join(__dirname, 'pending_conversations');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
    console.log(`Created test directory: ${testDir}`);
  } else {
    console.log(`Test directory exists: ${testDir}`);
  }
  
  const testFile = path.join(testDir, 'test.txt');
  fs.writeFileSync(testFile, `Test file created at ${new Date().toISOString()}`);
  console.log(`Successfully wrote to test file: ${testFile}`);
} catch (error) {
  console.error('File system test failed:', error.message);
}

console.log('Environment variables check:');
const requiredVars = [
  'PORT', 
  'NODE_ENV', 
  'GOOGLE_CLIENT_ID', 
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI'
];
requiredVars.forEach(varName => {
  console.log(`${varName}: ${process.env[varName] ? 'Set ✓' : 'MISSING ✗'}`);
});

module.exports = router;
