module.exports = (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Authentication Successful</h1>
        <p>Your access token: ${req.query.token}</p>
        <p>Use this token in your API requests.</p>
      </body>
    </html>
  `);
};
