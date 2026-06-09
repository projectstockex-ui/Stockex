/**
 * Integration smoke test: place 1 BTC Up/Down bet UP, then 1 DOWN.
 *
 * Requires: running API + MongoDB, user with games wallet balance.
 *
 * Usage (from server/):
 *   set USER_TOKEN=your_jwt&& npm run test:btc-updown
 *   # optional: API_URL=http://localhost:5001 AMOUNT=300
 *
 * PowerShell:
 *   $env:USER_TOKEN="..."; npm run test:btc-updown
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API_URL = (process.env.API_URL || 'http://localhost:5001').replace(/\/$/, '');
const USER_TOKEN = process.env.USER_TOKEN || '';

function client() {
  return axios.create({
    baseURL: API_URL,
    headers: USER_TOKEN ? { Authorization: `Bearer ${USER_TOKEN}` } : {},
    validateStatus: () => true,
  });
}

async function main() {
  console.log('BTC Up/Down place test — API:', API_URL);

  if (!USER_TOKEN) {
    console.error('Missing USER_TOKEN. Set env USER_TOKEN to a user JWT (games wallet must have balance).');
    process.exit(1);
  }

  const http = client();

  const walletRes = await http.get('/api/user/wallet');
  if (walletRes.status !== 200) {
    console.error('GET /api/user/wallet failed:', walletRes.status, walletRes.data);
    process.exit(1);
  }

  const gamesBal = Number(walletRes.data?.gamesWallet?.balance ?? 0);
  console.log('Games wallet balance:', gamesBal);

  const settingsRes = await http.get('/api/user/game-settings');
  if (settingsRes.status !== 200) {
    console.error('GET /api/user/game-settings failed:', settingsRes.status, settingsRes.data);
    process.exit(1);
  }

  const tokenValue = Number(settingsRes.data?.tokenValue) || 300;
  const btc = settingsRes.data?.games?.btcUpDown;
  const minTickets = Number(btc?.minTickets) || 1;
  const amount = Number(process.env.AMOUNT) || minTickets * tokenValue;

  if (!btc?.enabled) {
    console.error('BTC Up/Down is disabled in game settings.');
    process.exit(1);
  }

  if (gamesBal < amount * 2) {
    console.error(`Need games wallet ≥ ${amount * 2} for two bets (using ${amount} each).`);
    process.exit(1);
  }

  const windowNumber = Math.floor(Date.now() / 60000) % 100000;
  const entryPrice = 95000 + (Math.random() * 1000);

  const baseBody = {
    gameId: 'btcupdown',
    amount,
    entryPrice: parseFloat(entryPrice.toFixed(2)),
    windowNumber,
  };

  for (const prediction of ['UP', 'DOWN']) {
    const res = await http.post('/api/user/game-bet/place', {
      ...baseBody,
      prediction,
    });

    if (res.status !== 200) {
      console.error(`Place ${prediction} failed:`, res.status, res.data);
      process.exit(1);
    }

    console.log(`Place ${prediction}: OK — newBalance ${res.data?.newBalance}`, res.data?.message || '');
  }

  console.log('PASS: 1× UP and 1× DOWN placed successfully.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.response?.data || e.message || e);
  process.exit(1);
});
