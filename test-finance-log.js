const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:3000'; // Change to your server URL if different
const DEFAULT_SPREADSHEET_ID = '1m6e-HTb1W_trKMKgkkM-ItcuwJJW-Ab6lM_TKmOAee4';

// Test cases
const testCases = [
  {
    name: 'Basic Expense',
    data: {
      accountName: 'Personal Account',
      transactionType: 'Expense (Spent)',
      category: 'Groceries',
      amount: -50.25,
      establishment: 'Walmart',
      paymentMethod: 'Credit Card',
      items: ['Groceries', 'Household items'],
      notes: 'Weekly grocery shopping'
    }
  },
  {
    name: 'Salary Income',
    data: {
      accountName: 'Main Account',
      transactionType: 'Income (Salary)',
      category: 'Monthly Salary',
      amount: 5000.00,
      allowances: ['Transportation', 'Meal'],
      deductions: ['Tax', 'Insurance'],
      notes: 'March 2024 salary'
    }
  }
];

// Function to run tests
async function runTests() {
  console.log('Starting finance log tests...\n');

  for (const test of testCases) {
    console.log(`Testing: ${test.name}`);
    try {
      const response = await axios.post(
        `${API_URL}/api/finance-log`,
        test.data,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Status:', response.status);
      console.log('Response:', JSON.stringify(response.data, null, 2));
      console.log('Test passed!\n');
    } catch (error) {
      console.error('Test failed!');
      console.error('Error:', error.response ? error.response.data : error.message);
      console.log('\n');
    }
  }
}

// Run the tests
runTests().catch(console.error); 