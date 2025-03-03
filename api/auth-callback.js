const { google } = require("googleapis");
require("dotenv").config();

module.exports = async (req, res) => {
  const { code } = req.query;
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Redirect to a success page with the access token
    res.redirect(`/api/auth-success?token=${encodeURIComponent(tokens.access_token)}`);
  } catch (error) {
    res.status(500).json({ error: "Authentication failed" });
  }
};
