/**
 * Complete Zerodha WebSocket Data Structure
 * This shows ALL data that will be captured once WebSocket is connected
 */

console.log('📊 COMPLETE ZERODHA WEBSOCKET DATA STRUCTURE:');
console.log('===============================================');
console.log('');

console.log('📡 FULL DATA PER INSTRUMENT:');
console.log('{');
console.log('  "instrument_token": 256265,');
console.log('  "tradingsymbol": "NIFTY 50",');
console.log('  "name": "NIFTY 50",');
console.log('  "last_price": 24052.15,');
console.log('  "last_quantity": 100,');
console.log('  "average_price": 24050.00,');
console.log('  "volume": 1500000,');
console.log('  "buy_quantity": 750000,');
console.log('  "sell_quantity": 750000,');
console.log('  "ohlc": {');
console.log('    "open": 24000.00,');
console.log('    "high": 24060.00,');
console.log('    "low": 23980.00,');
console.log('    "close": 24052.15');
console.log('  },');
console.log('  "change": 52.15,');
console.log('  "change_percent": 0.22,');
console.log('  "timestamp": "2026-05-06T09:15:00.000Z",');
console.log('  "oi": 5000000,');
console.log('  "oi_day_high": 5200000,');
console.log('  "oi_day_low": 4800000,');
console.log('  "depth": {');
console.log('    "buy": [');
console.log('      { "price": 24052.00, "quantity": 100 },');
console.log('      { "price": 24051.00, "quantity": 200 },');
console.log('      { "price": 24050.00, "quantity": 300 },');
console.log('      { "price": 24049.00, "quantity": 400 },');
console.log('      { "price": 24048.00, "quantity": 500 }');
console.log('    ],');
console.log('    "sell": [');
console.log('      { "price": 24053.00, "quantity": 100 },');
console.log('      { "price": 24054.00, "quantity": 200 },');
console.log('      { "price": 24055.00, "quantity": 300 },');
console.log('      { "price": 24056.00, "quantity": 400 },');
console.log('      { "price": 24057.00, "quantity": 500 }');
console.log('    ]');
console.log('  },');
console.log('  "last_trade_time": "2026-05-06T09:15:00.000Z",');
console.log('  "total_buy_quantity": 750000,');
console.log('  "total_sell_quantity": 750000,');
console.log('  "tradable": true,');
console.log('  "mode": "full",');
console.log('  "exchange": "NSE",');
console.log('  "exchange_token": "256265"');
console.log('}');
console.log('');

console.log('🏭 MCX SPECIFIC DATA (GOLD, CRUDE, etc):');
console.log('{');
console.log('  "instrument_token": 735236001,');
console.log('  "tradingsymbol": "GOLD26AUGFUT",');
console.log('  "last_price": 75141,');
console.log('  "ohlc": {');
console.log('    "open": 75000,');
console.log('    "high": 75200,');
console.log('    "low": 74900,');
console.log('    "close": 75141');
console.log('  },');
console.log('  "volume": 15000,');
console.log('  "oi": 25000,');
console.log('  "oi_day_high": 26000,');
console.log('  "oi_day_low": 24000,');
console.log('  "depth": {');
console.log('    "buy": [{"price": 75140, "quantity": 10}],');
console.log('    "sell": [{"price": 75142, "quantity": 10}]');
console.log('  },');
console.log('  "change": 141,');
console.log('  "change_percent": 0.19');
console.log('}');
console.log('');

console.log('📈 CLEARING PRICE & SETTLEMENT DATA:');
console.log('- Clearing price: Available in OHLC.close');
console.log('- Settlement price: Available at market close');
console.log('- LTP prices: Real-time last_price');
console.log('- Volume weighted average price: average_price');
console.log('- Open Interest: oi, oi_day_high, oi_day_low');
console.log('- Market depth: Complete order book (5 levels)');
console.log('- Timestamps: Precise trade timestamps');
console.log('');

console.log('✅ SYSTEM ALREADY CAPTURES:');
console.log('1. ✅ LTP Prices (last_price)');
console.log('2. ✅ Clearing Price (OHLC.close)');
console.log('3. ✅ OHLC Data (open, high, low, close)');
console.log('4. ✅ Volume & OI data');
console.log('5. ✅ Market Depth (bid/ask)');
console.log('6. ✅ Change percentages');
console.log('7. ✅ Exchange timestamps');
console.log('8. ✅ Trade quantities');
console.log('9. ✅ Buy/Sell pressure');
console.log('10. ✅ MCX specific data');
console.log('');

console.log('🔗 TO GET THIS DATA:');
console.log('Click: https://kite.zerodha.com/connect/login?v=3&api_key=53r0sajsgkxligxv');
console.log('Authorize once → WebSocket connects → Complete data flows!');
