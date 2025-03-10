/**
 * Client library for GPT-to-Sheet integration
 */
class GptSheetClient {
  constructor(baseUrl = 'https://gpt-to-sheet.onrender.com') {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if user is authenticated via SSO
   * @returns {Promise<Object>} Authentication status and userId if authenticated
   */
  async checkAuth() {
    try {
      const response = await fetch(`${this.baseUrl}/auth/check`, {
        method: 'GET',
        credentials: 'include' // Important for cookies
      });
      
      return await response.json();
    } catch (error) {
      console.error('Auth check failed:', error);
      return { authenticated: false };
    }
  }

  /**
   * Log conversation to Google Sheet
   * @param {Object} data Conversation data
   * @returns {Promise<Object>} Operation result
   */
  async logConversation(data) {
    try {
      const response = await fetch(`${this.baseUrl}/api/log-data-v1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      
      return await response.json();
    } catch (error) {
      console.error('Logging failed:', error);
      throw new Error(`Failed to log conversation: ${error.message}`);
    }
  }

  /**
   * Get data from Google Sheet
   * @param {Object} params Query parameters
   * @returns {Promise<Object>} Sheet data
   */
  async getSheetData(params) {
    try {
      const response = await fetch(`${this.baseUrl}/api/get-sheet-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      });
      
      return await response.json();
    } catch (error) {
      console.error('Data retrieval failed:', error);
      throw new Error(`Failed to get sheet data: ${error.message}`);
    }
  }

  /**
   * Get authentication URLs
   * @returns {Object} Auth URLs
   */
  getAuthUrls() {
    return {
      standard: `${this.baseUrl}/auth`,
      sso: `${this.baseUrl}/auth/sso`
    };
  }
}

// Export the client
module.exports = GptSheetClient;