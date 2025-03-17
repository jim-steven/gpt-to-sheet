const axios = require('axios');

async function testFinanceLog() {
  const baseUrl = 'http://localhost:3000';

  // Get authentication token first
  try {
    console.log('\nGetting authentication token...');
    const authResponse = await axios.get(`${baseUrl}/auth/chatgpt-key`);
    const token = authResponse.data.access_token;
    
    // Test case 1: Basic transaction
    const basicTransaction = {
      accountName: "Maya Savings - 1442",
      transactionType: "Expense (Spent)",
      category: "Groceries",
      amount: -1250.75,
      establishment: "SM Supermarket",
      paymentMethod: "Mobile Wallet (Maya)",
      items: ["Milk", "Bread", "Eggs"],
      receiptNo: "SM-2024-03-15-1234",
      date: "2024-03-15",
      time: "14:30:00",
      notes: "Weekly grocery shopping"
    };

    console.log('\nTesting basic expense transaction...');
    const basicResponse = await axios.post(
      `${baseUrl}/api/finance-log`, 
      basicTransaction,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Basic transaction response:', JSON.stringify(basicResponse.data, null, 2));

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Run the tests
testFinanceLog(); 