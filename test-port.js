const net = require('net');

// Test port binding
function testPortBinding() {
  const PORT = process.env.PORT || 3000;
  console.log(`Testing port binding on ${PORT}...`);
  
  const server = net.createServer();
  
  server.on('error', (err) => {
    console.error(`Port binding test failed: ${err.message}`);
    process.exit(1);
  });
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Successfully bound to port ${PORT}`);
    server.close(() => {
      console.log('Port binding test complete');
    });
  });
}

testPortBinding(); 