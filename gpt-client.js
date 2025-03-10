// Simple client for GPT to use
const API_BASE_URL = "https://your-deployed-server.com"; // Update with your server URL

export async function logToSheet(spreadsheetId, sheetName, userMessage, assistantResponse) {
  const response = await fetch(`${API_BASE_URL}/api/log-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      spreadsheetId,
      sheetName,
      userMessage,
      assistantResponse,
      timestamp: new Date().toISOString()
    })
  });
  
  return response.json();
}
