import test from 'node:test';
import assert from 'node:assert/strict';
import { ZerodhaSyncService } from '../services/zerodha/ZerodhaSyncService.js';

class MockLogger {
  info() {}
  warn() {}
  error() {}
}

class MockProgress {
  startJob() {}
  updateJob() {}
  updateProgress() {}
  completeJob() {}
  failJob() {}
}

const sync = new ZerodhaSyncService({}, new MockLogger(), new MockProgress());

const SAMPLE_CSV = [
  'instrument_token,exchange,tradingsymbol,name,instrument_type,lot_size,tick_size,expiry,strike',
  '256265,NSE,NIFTY 50,NIFTY 50,EQ,1,0.05,,',
  '260105,NSE,NIFTY BANK,NIFTY BANK,EQ,1,0.05,,',
  '999001,NFO,NIFTY24JUN25000CE,NIFTY,CE,50,0.05,2024-06-27,25000',
  '888001,MCX,GOLDPETAL24JUNFUT,GOLDPETAL,FUT,1,1,2024-06-28,',
  '777001,BCD,USDINR,USDINR,EQ,1,0.0025,,',
  '666001,NSE,RANDOMOBSCURE,RANDOMOBSCURE,EQ,1,0.05,,',
].join('\n');

test('parseInstruments full mode keeps Zerodha exchanges only', async () => {
  const rows = await sync.parseInstruments(SAMPLE_CSV, { filterMode: 'full', minCount: 1 });
  const exchanges = new Set(rows.map((r) => r.exchange));
  assert.ok(exchanges.has('NSE'));
  assert.ok(exchanges.has('NFO'));
  assert.ok(exchanges.has('MCX'));
  assert.equal(exchanges.has('BCD'), false);
  assert.equal(rows.length, 5);
});

test('parseInstruments popular mode filters to high-traffic symbols', async () => {
  const rows = await sync.parseInstruments(SAMPLE_CSV, { filterMode: 'popular', minCount: 1 });
  const symbols = rows.map((r) => r.tradingsymbol);
  assert.ok(symbols.some((s) => s.includes('NIFTY')));
  assert.ok(symbols.some((s) => s.startsWith('GOLD')));
  assert.equal(symbols.includes('RANDOMOBSCURE'), false);
});

test('shouldIncludePopularInstrument respects index underlyings', () => {
  assert.equal(
    sync.shouldIncludePopularInstrument(
      { exchange: 'NFO', tradingsymbol: 'BANKNIFTY24JUN52000CE', instrument_type: 'CE', expiry: '2024-06-27' },
      Date.now() + 86400000,
    ),
    true,
  );
});
