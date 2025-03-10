const GptSheetClient = require('./gpt-client');

async function example() {
  // Create client instance
  const client = new GptSheetClient();
  
  // Check if user is authenticated via SSO
  const authStatus = await client.checkAuth();
  
  if (authStatus.authenticated) {
    console.log(`User is authenticated with ID: ${authStatus.userId}`);
    
    // Log a conversation
    const result = await client.logConversation({
      spreadsheetId: '1ABC123DEF456GHI789',
      sheetName: 'Conversations',
      userMessage: 'What is the weather today?',
      assistantResponse: 'The weather is sunny with a high of 75°F.',
      timestamp: new Date().toISOString(),
      userId: authStatus.userId
    });
    
    console.log('Logging result:', result);
    
    // Get sheet data
    const sheetData = await client.getSheetData({
      spreadsheetId: '1ABC123DEF456GHI789',
      sheetName: 'Conversations',
      userId: authStatus.userId
    });
    
    console.log('Sheet data:', sheetData);
  } else {
    // User is not authenticated, provide auth links
    const authUrls = client.getAuthUrls();
    console.log('Please authenticate using one of these links:');
    console.log(`Standard auth: ${authUrls.standard}`);
    console.log(`SSO auth: ${authUrls.sso}`);
  }
}

example().catch(console.error);
