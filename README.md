# GPT-to-Sheet

A web application that integrates OpenAI's GPT models with spreadsheet functionality. This application provides API endpoints for logging chat data to spreadsheets and retrieving spreadsheet data.

## Overview

GPT-to-Sheet allows you to:
- Log chat interactions with GPT models to spreadsheets
- Retrieve and use data from spreadsheets
- Build applications that leverage both AI conversations and structured data storage

## Setup

### Prerequisites
- Node.js (v14 or later recommended)
- npm or yarn
- OpenAI API key
- Google Sheets API credentials

### Installation

```bash
git clone https://github.com/yourusername/gpt-to-sheet.git
```

```bash
cd gpt-to-sheet
```

```bash
npm install
```

### Environment Configuration

Create a `.env` file in the root directory:

```
OPENAI_API_KEY=your_openai_api_key
GOOGLE_APPLICATION_CREDENTIALS=path_to_your_credentials.json
SPREADSHEET_ID=your_google_spreadsheet_id
```

### Google Sheets Setup
1. Create a project in Google Cloud Console
2. Enable Google Sheets API
3. Create service account credentials and download the JSON file
4. Share your target spreadsheet with the service account email

## Running the Application

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## API Endpoints

### Log Chat
- **URL**: `/api/log-chat`
- **Method**: POST
- **Body**:
  ```json
  {
    "user": "User message",
    "assistant": "Assistant response",
    "metadata": {}
  }
  ```

### Get Sheet Data
- **URL**: `/api/get-sheet-data`
- **Method**: GET
- **Query Parameters**: 
  - `sheet`: Sheet name (optional)
  - `range`: Cell range (optional)

## Technology Stack

- Express.js for the server
- CORS support for cross-origin requests
- OpenAI API for GPT integration
- Google Sheets API for spreadsheet operations
