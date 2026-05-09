import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('🔍 ENVIRONMENT VARIABLES CHECK:');
console.log('ZERODHA_API_KEY:', process.env.ZERODHA_API_KEY);
console.log('ZERODHA_API_SECRET:', process.env.ZERODHA_API_SECRET ? '***SET***' : 'NOT SET');
console.log('');

if (process.env.ZERODHA_API_KEY) {
  console.log('✅ LOGIN URL:');
  console.log(`https://kite.zerodha.com/connect/login?v=3&api_key=${process.env.ZERODHA_API_KEY}`);
} else {
  console.log('❌ ZERODHA_API_KEY not found in .env file');
  console.log('Please check your .env file contains:');
  console.log('ZERODHA_API_KEY=53r0sajsgkxligxv');
  console.log('ZERODHA_API_SECRET=4fwf650wqofv06wr0nct6lw6boqs0voz');
}
