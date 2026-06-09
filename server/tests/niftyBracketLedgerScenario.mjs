/**
 * Nifty Bracket ledger scenario (LTP 23951) — bet is on the spread line:
 * BUY on **upper** (centre+gap) → win iff LTP > upper; SELL on **lower** (centre−gap) → win iff LTP < lower.
 * Session-close `directionVsEntry` uses `entryPrice` = that line, so it matches this.
 *
 * Run: cd server && node tests/niftyBracketLedgerScenario.mjs
 */

const BRACKET_GAP = 20;
const LTP = 23951;
const TICKET_RUPEES = 1000;
const TICKETS_PER_TRADE = 5;
const STAKE = TICKET_RUPEES * TICKETS_PER_TRADE;
const WIN_MULT = 1.9;
const GROSS_WIN = STAKE * WIN_MULT;

const GROSS_PCT_SUB_BROKER = 0.08;
const GROSS_PCT_BROKER = 0.02;
const GROSS_PCT_ADMIN = 0.01;
const GROSS_HIERARCHY_FRAC = GROSS_PCT_SUB_BROKER + GROSS_PCT_BROKER + GROSS_PCT_ADMIN;

const PER_WIN_SB = GROSS_WIN * GROSS_PCT_SUB_BROKER;
const PER_WIN_BR = GROSS_WIN * GROSS_PCT_BROKER;
const PER_WIN_AD = GROSS_WIN * GROSS_PCT_ADMIN;
const PER_WIN_SA_TOTAL = PER_WIN_SB + PER_WIN_BR + PER_WIN_AD;

const TRADES = [
  { id: 1, user: 'Manish', prediction: 'BUY', centre: 23940 },
  { id: 2, user: 'Manish', prediction: 'SELL', centre: 23877 },
  { id: 3, user: 'Manish', prediction: 'SELL', centre: 24014 },
  { id: 4, user: 'Manish', prediction: 'SELL', centre: 24000 },
  { id: 5, user: 'Hari', prediction: 'BUY', centre: 23950 },
  { id: 6, user: 'Hari', prediction: 'BUY', centre: 23900 },
  { id: 7, user: 'Hari', prediction: 'SELL', centre: 24005 },
  { id: 8, user: 'Aayush', prediction: 'BUY', centre: 23960 },
  { id: 9, user: 'Aayush', prediction: 'SELL', centre: 24506 },
  { id: 10, user: 'Aayush', prediction: 'SELL', centre: 24010 },
];

const INITIAL = { Manish: 100_000, Hari: 110_000, Aayush: 118_000 };

function settleTrade(prediction, centre) {
  const upper = centre + BRACKET_GAP;
  const lower = centre - BRACKET_GAP;
  const hitUpper = LTP > upper;
  const hitLower = LTP < lower;
  let status;
  if (prediction === 'BUY') {
    status = hitUpper ? 'won' : 'lost';
  } else {
    status = hitLower ? 'won' : 'lost';
  }
  return { status, upper, lower, hitUpper, hitLower };
}

function netWalletDeltaForTrade(status) {
  if (status === 'lost') return -STAKE;
  if (status === 'won') return GROSS_WIN - STAKE;
  throw new Error(`unknown status ${status}`);
}

function Stockex coins (n) {
  return `${Number(n).toLocaleString('en-IN')}`;
}

function assertApprox(a, b, label, eps = 0.01) {
  if (Math.abs(a - b) > eps) {
    throw new Error(`${label}: expected ${b}, got ${a}`);
  }
}

function printTable1(rows) {
  console.log('\n## Table 1 — Every trade (bands and outcome; no refund on mid-band)\n');
  console.log('# | User | Side | Centre | Upper | Lower | LTP>upper? | LTP<lower? | Outcome');
  console.log('-'.repeat(100));
  for (const r of rows) {
    const gu = r.hitUpper ? 'Yes' : 'No';
    const gl = r.hitLower ? 'Yes' : 'No';
    const out = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    console.log(
      `${r.id} | ${r.user} | ${r.prediction} | ${r.centre} | ${r.upper} | ${r.lower} | ${gu} | ${gl} | ${out}`
    );
  }
}

function printTable2(rows) {
  console.log('\n## Table 2 — Games wallet: per trade (no stake refund on loss)\n');
  console.log('# | User | On settle balance Δ | On settle margin Δ | Net P&L vs before trade');
  console.log('--- | --- | --- | --- | ---');
  for (const r of rows) {
    const net = netWalletDeltaForTrade(r.status);
    const bal = r.status === 'won' ? GROSS_WIN : 0;
    const m = -STAKE;
    console.log(`${r.id} | ${r.user} | ${Stockex coins (bal)} | ${Stockex coins (m)} | ${Stockex coins (net)}`);
  }
}

function printTable3(byUser, final) {
  console.log('\n## Table 3 — Per user totals (games wallet)\n');
  console.log('User | Initial | Stake placed | Net P&L | Final');
  console.log('--- | --- | --- | --- | ---');
  const stakes = { Manish: 4 * STAKE, Hari: 3 * STAKE, Aayush: 3 * STAKE };
  for (const u of ['Manish', 'Hari', 'Aayush']) {
    console.log(
      `${u} | ${Stockex coins (INITIAL[u])} | ${Stockex coins (stakes[u])} | ${Stockex coins (byUser[u])} | ${Stockex coins (final[u])}`
    );
  }
  console.log(`\nAggregate net (three users): ${Stockex coins (byUser.Manish + byUser.Hari + byUser.Aayush)}`);
}

function printTable4(winsByUser) {
  console.log('\n## Table 4 — Super Admin: gross hierarchy (8% / 2% / 1% of gross win)\n');
  console.log('Per win (G = 9,500) | Rate | Amount');
  console.log('--- | --- | ---');
  console.log(`Sub-broker | 8% | ${Stockex coins (PER_WIN_SB)}`);
  console.log(`Broker | 2% | ${Stockex coins (PER_WIN_BR)}`);
  console.log(`Admin | 1% | ${Stockex coins (PER_WIN_AD)}`);
  console.log(`Total SA per win | 11% | ${Stockex coins (PER_WIN_SA_TOTAL)}`);
  const totalWins = winsByUser.Manish + winsByUser.Hari + winsByUser.Aayush;
  console.log(`\nWins: Manish ${winsByUser.Manish} | Hari ${winsByUser.Hari} | Aayush ${winsByUser.Aayush} | Total ${totalWins}`);
  console.log(`Total SA debited (hierarchy): ${Stockex coins (totalWins * PER_WIN_SA_TOTAL)}`);
  console.log('\nSA hierarchy by winner chain:');
  for (const u of ['Manish', 'Hari', 'Aayush']) {
    const w = winsByUser[u];
    console.log(`  ${u}: ${w} win(s) → ${Stockex coins (w * PER_WIN_SA_TOTAL)}`);
  }
}

function printTable5(lostCount) {
  console.log('\n## Table 5 — Lost stakes (no refund)\n');
  console.log(
    `Each lost trade forfeit ${Stockex coins (STAKE)} (${lostCount} trades → ${Stockex coins (lostCount * STAKE)} total). Loss stakes do not fund admin/broker hierarchy; only win-side paths (gross hierarchy / win brokerage) debit the SA pool.`
  );
}

function printTable6(grossCredits, userNet) {
  console.log('\n## Table 6 — Sanity (money flow)\n');
  console.log(`Total staked (10 trades): ${Stockex coins (10 * STAKE)}`);
  console.log(`Gross win credits to wallets: ${Stockex coins (grossCredits)} (no refund path)`);
  console.log(`Net user P&L vs opening balances: ${Stockex coins (userNet)}`);
}

function run() {
  console.log('=== Nifty Bracket — detailed ledger (LTP 23951, bet on spread line) ===');
  console.log(`Stake/trade: ${Stockex coins (STAKE)} | Gross/win: ${Stockex coins (GROSS_WIN)} | Gap: ±${BRACKET_GAP}`);

  const rows = TRADES.map((t) => {
    const { status, upper, lower, hitUpper, hitLower } = settleTrade(t.prediction, t.centre);
    return { ...t, status, upper, lower, hitUpper, hitLower };
  });

  const byUser = { Manish: 0, Hari: 0, Aayush: 0 };
  const winsByUser = { Manish: 0, Hari: 0, Aayush: 0 };
  let winCount = 0;
  let lostCount = 0;
  let saHierarchyTotal = 0;

  for (const r of rows) {
    byUser[r.user] += netWalletDeltaForTrade(r.status);
    if (r.status === 'won') {
      winCount += 1;
      winsByUser[r.user] += 1;
      saHierarchyTotal += GROSS_WIN * GROSS_HIERARCHY_FRAC;
    } else {
      lostCount += 1;
    }
  }

  const final = {
    Manish: INITIAL.Manish + byUser.Manish,
    Hari: INITIAL.Hari + byUser.Hari,
    Aayush: INITIAL.Aayush + byUser.Aayush,
  };

  printTable1(rows);
  printTable2(rows);
  printTable3(byUser, final);
  printTable4(winsByUser);
  printTable5(lostCount);
  const grossCredits = winCount * GROSS_WIN;
  const userNet = byUser.Manish + byUser.Hari + byUser.Aayush;
  printTable6(grossCredits, userNet);

  console.log(`\nSummary: ${lostCount} lost | ${winCount} won\n`);

  assertApprox(lostCount, 4, 'lost count');
  assertApprox(winCount, 6, 'win count');

  assertApprox(byUser.Manish, -1000, 'Manish net delta');
  assertApprox(byUser.Hari, 4000, 'Hari net delta');
  assertApprox(byUser.Aayush, 4000, 'Aayush net delta');

  assertApprox(final.Manish, 99_000, 'Manish final balance');
  assertApprox(final.Hari, 114_000, 'Hari final balance');
  assertApprox(final.Aayush, 122_000, 'Aayush final balance');

  assertApprox(saHierarchyTotal, 6270, 'total SA hierarchy debit');
  assertApprox(winsByUser.Manish, 2, 'Manish wins');
  assertApprox(winsByUser.Hari, 2, 'Hari wins');
  assertApprox(winsByUser.Aayush, 2, 'Aayush wins');

  assertApprox(grossCredits, 57_000, 'gross win credits');
  assertApprox(userNet, 7000, 'aggregate user net');

  console.log('niftyBracketLedgerScenario: all assertions passed.');
}

run();
