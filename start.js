const { spawn } = require('child_process');
const waitPort = require('wait-port'); // You might need to install this: npm install wait-port

// Function to start the server
async function startServer() {
  try {
    // Check if port 3000 is in use
    const isPortInUse = await waitPort({ 
      host: 'localhost', 
      port: 3000,
      timeout: 1000,
      output: 'silent'
    });
    
    if (isPortInUse) {
      console.log('Port 3000 is already in use. Waiting for it to be available...');
      // Wait for port to be free (up to 30 seconds)
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    // Start the server
    const server = spawn('node', ['server.js'], { stdio: 'inherit' });
    
    server.on('close', (code) => {
      if (code !== 0) {
        console.error(`Server exited with code ${code}`);
        process.exit(code);
      }
    });
  } catch (error) {
 