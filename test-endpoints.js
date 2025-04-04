const axios = require('axios');

const BASE_URL = 'https://gpt-to-sheet.onrender.com';

async function testEndpoints() {
  try {
    // Test health endpoint
    console.log('Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('Health endpoint:', healthResponse.status === 200 ? '✅ OK' : '❌ Failed');

    // Test service account endpoint
    console.log('\nTesting service account endpoint...');
    const serviceAccountResponse = await axios.get(`${BASE_URL}/api/service-account`);
    console.log('Service account endpoint:', serviceAccountResponse.data.success ? '✅ OK' : '❌ Failed');

    // Test log transactions endpoint
    console.log('\nTesting log transactions endpoint...');
    const transactionData = {
      data: {
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().split(' ')[0],
        accountName: 'Test Account',
        transactionType: 'Test',
        amount: 100,
        category: 'Test Category'
      }
    };
    const transactionResponse = await axios.post(`${BASE_URL}/api/log-transactions`, transactionData);
    console.log('Log transactions endpoint:', transactionResponse.data.success ? '✅ OK' : '❌ Failed');

    // Test get sheet data endpoint
    console.log('\nTesting get sheet data endpoint...');
    const sheetDataResponse = await axios.post(`${BASE_URL}/api/get-sheet-data`, {
      spreadsheetId: '1zlC8E46a3lD6z6jNglA5IrrNIQv_5pLhRF0T7fOPhXs',
      sheetName: 'Transactions'
    });
    console.log('Get sheet data endpoint:', sheetDataResponse.data.data ? '✅ OK' : '❌ Failed');

    // Test log workouts endpoint
    console.log('\nTesting log workouts endpoint...');
    const workoutData = {
      data: {
        date: new Date().toISOString().split('T')[0],
        workoutType: 'Test Workout',
        exercises: 'Test Exercise',
        sets: 3,
        reps: 10
      }
    };
    const workoutResponse = await axios.post(`${BASE_URL}/api/log-workouts`, workoutData);
    console.log('Log workouts endpoint:', workoutResponse.data.success ? '✅ OK' : '❌ Failed');

    // Test log food endpoint
    console.log('\nTesting log food endpoint...');
    const foodData = {
      data: {
        date: new Date().toISOString().split('T')[0],
        mealType: 'Test Meal',
        description: 'Test Food',
        calories: 500
      }
    };
    const foodResponse = await axios.post(`${BASE_URL}/api/log-food`, foodData);
    console.log('Log food endpoint:', foodResponse.data.success ? '✅ OK' : '❌ Failed');

    // Test log journal endpoint
    console.log('\nTesting log journal endpoint...');
    const journalData = {
      data: {
        date: new Date().toISOString().split('T')[0],
        whatHappened: 'Test Entry',
        whereGod: 'Test Location',
        response: 'Test Response'
      }
    };
    const journalResponse = await axios.post(`${BASE_URL}/api/log-journal`, journalData);
    console.log('Log journal endpoint:', journalResponse.data.success ? '✅ OK' : '❌ Failed');

    // Test log status endpoint
    console.log('\nTesting log status endpoint...');
    const statusData = {
      data: {
        date: new Date().toISOString().split('T')[0],
        timeBlock: 'Test Time',
        activity: 'Test Activity',
        category: 'Test Category'
      }
    };
    const statusResponse = await axios.post(`${BASE_URL}/api/log-status`, statusData);
    console.log('Log status endpoint:', statusResponse.data.success ? '✅ OK' : '❌ Failed');

  } catch (error) {
    console.error('Error testing endpoints:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testEndpoints(); 