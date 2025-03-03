const { google } = require("googleapis");
require("dotenv").config();

module.exports = (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [process.env.GOOGLE_SCOPE],
  });
  
  res.redirect(authUrl);
};
