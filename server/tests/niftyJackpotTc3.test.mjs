/**
 * TC3: % of kitty for rank → G; hierarchy 2% / 1% / 0.5% of G; net prize to winner (prize-only credit).
 * No DB — asserts formulas match declare + gameProfitDistribution rounding.
 */
import assert from 'node:assert/strict';
import { resolveJackpotPrizePercentForRank } from '../utils/niftyJackpotPrize.js';

const KITTY = 30_000;
const RANK1_PCT = resolveJackpotPrizePercentForRank(1, {});
assert.equal(RANK1_PCT, 45, 'rank 1 should resolve to 45% of pool (default ladder)');

const G = Math.round((KITTY * RANK1_PCT) / 100);
assert.equal(G, 13_500, '45% of 30,000 kitty = 13,500 gross G');

const gc = {
  grossPrizeSubBrokerPercent: 2,
  grossPrizeBrokerPercent: 1,
  grossPrizeAdminPercent: 0.5,
};

const sbAmt = parseFloat(((G * gc.grossPrizeSubBrokerPercent) / 100).toFixed(2));
const brAmt = parseFloat(((G * gc.grossPrizeBrokerPercent) / 100).toFixed(2));
const adAmt = parseFloat(((G * gc.grossPrizeAdminPercent) / 100).toFixed(2));
const totalHierarchy = parseFloat((sbAmt + brAmt + adAmt).toFixed(2));

assert.equal(sbAmt, 270, 'sub-broker 2% of G');
assert.equal(brAmt, 135, 'broker 1% of G');
assert.equal(adAmt, 67.5, 'admin 0.5% of G (2dp)');
assert.equal(totalHierarchy, 472.5, 'total hierarchy from G');

const netPrize = parseFloat((G - totalHierarchy).toFixed(2));
assert.equal(netPrize, 13_027.5, 'net prize credited to winner (G − hierarchy); stake not added');

const stake = 1000;
const prizeCredit = netPrize;
const winnerRoundPnL = parseFloat((prizeCredit - stake).toFixed(2));
assert.equal(winnerRoundPnL, 12_027.5, 'realized PnL increment = net prize − stake (example stake 1000)');

console.log('niftyJackpotTc3.test.mjs: all assertions passed');
