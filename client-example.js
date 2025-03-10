// Example client code to log chat
async function logChat(spreadsheetId, sheetName, userMessage, assistantResponse) {
  try {
    const response = await fetch('/api/log-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Important: include cookies/session
      body: JSON.stringify({
        spreadsheetId,
        sheetName,
        userMessage,
        assistantResponse,
        timestamp: new Date().toISOString(),
      }),
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error logging chat:', error);
    throw error;
  }
}
