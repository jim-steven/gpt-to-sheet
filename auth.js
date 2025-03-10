const { google } = require('googleapis');
const { pool } = require('./db');
require('dotenv').config();

// Configure OAuth client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Generate auth URL with offline access (to get refresh token)
const getAuthUrl = () => {
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',  // This is crucial for getting a refresh token
    prompt: 'consent',       // Force showing the consent screen to get refresh token each time
    scope: scopes
  });
};

// Store tokens in database
const storeTokens = async (userId, tokens) => {
  const { access_token, refresh_token, expiry_date } = tokens;
  
  try {
    await pool.query(
      `INSERT INTO auth_tokens (user_id, access_token, refresh_token, token_expiry) 
       VALUES ($1, $2, $3, to_timestamp($4/1000))
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         access_token = $2, 
         refresh_token = CASE WHEN $3 = '' THEN auth_tokens.refresh_token ELSE $3 END,
         token_expiry = to_timestamp($4/1000),
         last_used = CURRENT_TIMESTAMP`,
      [userId, access_token, refresh_token || '', expiry_date]
    );
    return true;
  } catch (error) {
    console.error('Error storing tokens:', error);
    return false;
  }
};

// Get tokens from database
const getTokensById = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT access_token, refresh_token, token_expiry FROM auth_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const { access_token, refresh_token, token_expiry } = result.rows[0];
    
    return {
      access_token,
      refresh_token,
      expiry_date: new Date(token_expiry).getTime()
    };
  } catch (error) {
    console.error('Error getting tokens:', error);
    return null;
  }
};

// Get authenticated OAuth client for a user
const getAuthClient = async (userId) => {
  try {
    const tokens = await getTokensById(userId);
    
    if (!tokens) {
      return null;
    }
    
    oauth2Client.setCredentials(tokens);
    
    // Check if token needs refreshing
    if (Date.now() > tokens.expiry_date - 60000) { // 1 minute buffer
      const { credentials } = await oauth2Client.refreshAccessToken();
      await storeTokens(userId, credentials);
      oauth2Client.setCredentials(credentials);
    }
    
    return oauth2Client;
  } catch (error) {
    console.error('Error in getAuthClient:', error);
    return null;
  }
};

module.exports = {
  oauth2Client,
  getAuthUrl,
  storeTokens,
  getTokensById,
  getAuthClient
};
