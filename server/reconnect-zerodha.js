/**
 * Zerodha Reconnect Script
 * Easy way to reconnect to Zerodha WebSocket without daily API key generation
 */

import axios from 'axios';

/**
 * Get Zerodha login URL
 */
async function getLoginUrl() {
  const apiKey = process.env.ZERODHA_API_KEY;
  const callbackUrl = 'http://localhost:5001/api/zerodha/callback';
  
  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;
  
  console.log('🔗 ZERODHA LOGIN URL:');
  console.log(loginUrl);
  console.log('');
  console.log('📋 STEPS TO CONNECT:');
  console.log('1. Click the above link');
  console.log('2. Login to Zerodha');
  console.log('3. Authorize the app');
  console.log('4. You will be redirected back to stockex');
  console.log('5. WebSocket will connect automatically');
  console.log('');
  console.log('✅ After authorization, your WebSocket will stay connected for market hours!');
  
  return loginUrl;
}

/**
 * Check current connection status
 */
async function checkConnectionStatus() {
  try {
    const response = await axios.get('http://localhost:5001/api/zerodha/status');
    console.log('📊 CURRENT STATUS:');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.log('❌ Error checking status:', error.message);
    return null;
  }
}

/**
 * Main reconnect function
 */
async function reconnectZerodha() {
  console.log('🔄 ZERODHA WEBSOCKET RECONNECT');
  console.log('=====================================');
  console.log('');
  
  // Check current status
  await checkConnectionStatus();
  console.log('');
  
  // Get login URL
  await getLoginUrl();
  console.log('');
  console.log('🎯 MARKET HOURS: 9:15 AM - 3:30 PM IST');
  console.log('📈 WebSocket will show live prices when market is open');
  console.log('🔄 Connection will auto-reconnect if disconnected');
  console.log('');
  console.log('💡 TIP: This connection will work for multiple days!');
}

// Run the reconnect function
reconnectZerodha().catch(console.error);
