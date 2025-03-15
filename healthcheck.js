const http = require('http');

const options = {
  host: '0.0.0.0',
  port: process.env.PORT || 3000,
  path: '/health',
  timeout: 2000
};

const healthCheck = http.request(options, (res) => {
  console.log(`HEALTHCHECK: ${res.statusCode}`);
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

healthCheck.on('error', (err) => {
  console.error('HEALTHCHECK FAILED:', err);
  process.exit(1);
});

healthCheck.end(); 