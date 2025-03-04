module.exports = (req, res) => {
  const token = req.query.token;
  
  res.send(`
    <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .token-box { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; }
          button { background: #4285f4; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; }
          .success { color: green; display: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful</h1>
        <p>Your access token:</p>
        <div class="token-box">
          <code id="token">${token}</code>
        </div>
        <button id="copy-btn">Copy Token</button>
        <p class="success" id="success-msg">Token copied to clipboard!</p>
        <p>Return to your GPT conversation and paste this token when prompted.</p>
        
        <script>
          document.getElementById('copy-btn').addEventListener('click', function() {
            const tokenText = document.getElementById('token').textContent;
            navigator.clipboard.writeText(tokenText).then(function() {
              document.getElementById('success-msg').style.display = 'block';
              setTimeout(function() {
                document.getElementById('success-msg').style.display = 'none';
              }, 3000);
            });
          });
        </script>
      </body>
    </html>
  `);
};
