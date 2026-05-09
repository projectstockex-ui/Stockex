import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('🔍 ENVIRONMENT VARIABLES FROM .env:');
console.log('CLIENT_URL:', process.env.CLIENT_URL || 'NOT SET');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'NOT SET');
console.log('SERVER_URL:', process.env.SERVER_URL || 'NOT SET');
console.log('PORT:', process.env.PORT || 'NOT SET');
console.log('');

// Test environment config
import environmentConfig from './utils/environmentConfig.js';
console.log('📊 ENVIRONMENT CONFIG RESULTS:');
console.log('getBaseUrl():', environmentConfig.getBaseUrl());
console.log('getDashboardUrls():', JSON.stringify(environmentConfig.getDashboardUrls(), null, 2));
console.log('');

console.log('💡 SOLUTION:');
console.log('Add CLIENT_URL=http://localhost:3000 to your .env file');
