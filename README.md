# GPT-to-Sheet

A simple API service that allows logging GPT conversations to Google Sheets using a service account.

## Setup

1. Create a Google Cloud Project and enable the Google Sheets API
2. Create a service account and download the credentials JSON file
3. Share your target Google Sheet with the service account email address
4. Set up environment variables:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account.json
   PORT=3001  # Optional, defaults to 3001
   ```

## Installation

```bash
npm install
```

## Running the Server

Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Log Conversation
- **URL**: `POST /api/log-data`
- **Body**:
  ```json
  {
    "spreadsheetId": "your-spreadsheet-id",
    "sheetName": "Sheet1",
    "userMessage": "User's message",
    "assistantResponse": "Assistant's response",
    "timestamp": "2024-03-21T12:00:00Z"  // Optional
  }
  ```

### Get Sheet Data
- **URL**: `POST /api/get-sheet-data`
- **Body**:
  ```json
  {
    "spreadsheetId": "your-spreadsheet-id",
    "sheetName": "Sheet1",  // Optional
    "range": "A1:C10"      // Optional
  }
  ```

## Security Note

This version uses a service account for authentication. Make sure to:
1. Keep your service account credentials secure
2. Only share the specific Google Sheets that the service account needs to access
3. Never commit the credentials file to version control
