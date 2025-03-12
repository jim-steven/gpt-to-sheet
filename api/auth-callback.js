const { google } = require("googleapis");
require("dotenv").config();
const { oauth2Client, storeTokens } = require('./auth');
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code is missing' });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info to use as userId
    const oauth2 = google.oauth2('v2');
    const userInfo = await oauth2.userinfo.get({ auth: oauth2Client });
    const userId = userInfo.data.email;

    await storeTokens(userId, tokens);

    // Check if this is a ChatGPT plugin callback
    const referer = req.get('Referer') || '';
    if (referer.includes('chat.openai.com') || referer.includes('chatgpt.com')) {
      // Return JSON response for ChatGPT plugin
      return res.json({ 
        success: true, 
        userId: userId
      });
    }

    // Regular web application flow
    res.redirect('/auth/success');
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ 
      error: 'Failed to exchange token',
      details: error.message
    });
  }
});

module.exports = router;
