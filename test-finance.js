const axios = require('axios');

async function testFinanceLog() {
  try {
    const response = await axios.post('https://gpt-to-sheet.onrender.com/api/finance-log', {
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
    });

    console.log('Response:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testFinanceLog(); 