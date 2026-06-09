/**
 * BTC Up/Down: user credit vs brokerage T vs hierarchy % of T (matches plan / GameSettings btcUpDown defaults).
 * Run (from server/): npm run test:btc-updown-payout-accounting
 */

import { computeUpDownWinPayout } from '../utils/upDownSettlementMath.js';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function assertApprox(a, e, label, eps = 0.02) {
  if (!Number.isFinite(a) || !Number.isFinite(e) || Math.abs(a - e) > eps) {
    fail(`${label}: expected ${e}, got ${a}`);
  }
}

/** Same rounding as distributeWinBrokerage for hierarchy slice of T */
function sliceOfT(T, pct) {
  return parseFloat(((T * pct) / 100).toFixed(2));
}

function main() {
  const brokeragePct = 5;
  const sb = 5;
  const br = 1;
  const ad = 1;

  // Exact decimals (avoids float edge cases on 1.78×)
  const stake = 1000;
  const mult = 2.5;
  const parts = computeUpDownWinPayout(stake, mult, brokeragePct);
  const grossWin = 2500;
  const profit = 1500;
  const T = 75;

  assertApprox(parts.grossWin, grossWin, 'grossWin');
  assertApprox(parts.creditTotal, grossWin, 'creditTotal equals gross (full payout to games wallet)');
  assertApprox(parts.brokerage, T, 'T = 5% of profit');
  assertApprox(parts.pnl, profit, 'pnl');

  assertApprox(sliceOfT(parts.brokerage, sb), 3.75, 'SB share of T');
  assertApprox(sliceOfT(parts.brokerage, br), 0.75, 'B share of T');
  assertApprox(sliceOfT(parts.brokerage, ad), 0.75, 'Admin share of T');
  const sbAmt = sliceOfT(parts.brokerage, sb);
  const brAmt = sliceOfT(parts.brokerage, br);
  const adAmt = sliceOfT(parts.brokerage, ad);
  const saAmt = parseFloat((parts.brokerage - sbAmt - brAmt - adAmt).toFixed(2));
  assertApprox(sbAmt + brAmt + adAmt + saAmt, parts.brokerage, 'splits sum to T');
  assertApprox(saAmt, 69.75, 'SA remainder of T');

  // Real-world example from plan: 1,500 @ 1.78×, brokeragePercent 5
  const plan = computeUpDownWinPayout(1500, 1.78, 5);
  if (plan.creditTotal !== 2670) fail(`plan credit expected 2670, got ${plan.creditTotal}`);
  if (plan.brokerage !== 58.5) fail(`plan T expected 58.50, got ${plan.brokerage}`);

  console.log('btcUpDownWinPayoutAccounting tests OK');
}

main();
