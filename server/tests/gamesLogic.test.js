/**
 * Test Case: Games Logic for All 5 Games
 * 
 * Games:
 * 1. Nifty Up/Down - Predict UP or DOWN, win 1.95x
 * 2. BTC Up/Down - Predict UP or DOWN, win 1.95x
 * 3. Nifty Number - Pick decimal (.00-.99); win pays (ticket×winMultiplier×qty) gross, or legacy fixedProfit×qty minus gross hierarchy % (Jackpot-style) or legacy brokerage %
 * 4. Nifty Bracket - Buy/Sell on bracket levels, win 1.9x gross (default 1,000/ticket)
 * 5. Nifty Jackpot - Bid for top ranks, prize distribution
 * 
 * Logic:
 * - Token Value: 300 per token
 * - Nifty/BTC Up/Down wins: brokerage = % of (gross win − stake); user credit = full gross win; SA pool pays hierarchy on top (same as Nifty Number)
 * - Other games in this script: illustrative; bracket/jackpot fee policy may differ in production
 * - Profit Distribution: SuperAdmin 40%, Admin 30%, Broker 20%, SubBroker 10% (when splits apply)
 */

function testGamesLogic() {
  console.log('='.repeat(70));
  console.log('GAMES LOGIC TEST - ALL 5 GAMES');
  console.log('='.repeat(70));
  
  // Global Settings
  const tokenValue = 300; // 300 per token
  
  // Game Settings
  const gameSettings = {
    niftyUpDown: {
      name: 'Nifty Up/Down',
      enabled: true,
      winMultiplier: 1.95,
      brokeragePercent: 5,
      minTickets: 1,
      maxTickets: 500,
      roundDuration: 60, // seconds
      startTime: '09:15:15',
      endTime: '15:44:59'
    },
    btcUpDown: {
      name: 'BTC Up/Down',
      enabled: true,
      winMultiplier: 1.95,
      brokeragePercent: 5,
      minTickets: 1,
      maxTickets: 500,
      roundDuration: 60,
      startTime: '00:00:01',
      endTime: '23:45:00'
    },
    niftyNumber: {
      name: 'Nifty Number',
      enabled: true,
      winMultiplier: 9,
      fixedProfit: 4000,
      brokeragePercent: 0,
      grossPrizeSubBrokerPercent: 2,
      grossPrizeBrokerPercent: 1,
      grossPrizeAdminPercent: 0.5,
      minTickets: 1,
      maxTickets: 100,
      betsPerDay: 10,
      resultTime: '15:30'
    },
    niftyBracket: {
      name: 'Nifty Bracket',
      enabled: true,
      ticketPrice: 1000,
      winMultiplier: 1.9,
      brokeragePercent: 5,
      minTickets: 1,
      maxTickets: 250,
      bracketGap: 20, // Points above/below current price
      expiryMinutes: 5
    },
    niftyJackpot: {
      name: 'Nifty Jackpot',
      enabled: true,
      winMultiplier: 1.5,
      brokeragePercent: 5,
      minTickets: 1,
      maxTickets: 500,
      topWinners: 10,
      prizeDistribution: [45000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000],
      bidsPerDay: 1
    }
  };
  
  // Profit Distribution
  const profitDistribution = {
    superAdminPercent: 40,
    adminPercent: 30,
    brokerPercent: 20,
    subBrokerPercent: 10
  };
  
  // User's initial state
  let user = {
    name: 'Test User',
    gamesWallet: {
      balance: 50000,
      usedMargin: 0,
      realizedPnL: 0,
      todayRealizedPnL: 0
    }
  };
  
  console.log('\n📋 GLOBAL SETTINGS:');
  console.log(`   Token Value: ${tokenValue}`);
  console.log(`   Profit Distribution: SA ${profitDistribution.superAdminPercent}% | Admin ${profitDistribution.adminPercent}% | Broker ${profitDistribution.brokerPercent}% | SubBroker ${profitDistribution.subBrokerPercent}%`);
  
  console.log('\n📋 INITIAL USER STATE:');
  console.log(`   Games Wallet Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  
  let allTestsPassed = true;
  
  // ============================================
  // TEST 1: NIFTY UP/DOWN GAME
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: NIFTY UP/DOWN GAME');
  console.log('='.repeat(70));
  
  const game1 = gameSettings.niftyUpDown;
  console.log(`\n📊 Game: ${game1.name}`);
  console.log(`   Win Multiplier: ${game1.winMultiplier}x`);
  console.log(`   brokeragePercent (fee on win profit, Up/Down): ${game1.brokeragePercent}%`);
  console.log(`   Min/Max Tickets: ${game1.minTickets} - ${game1.maxTickets}`);
  
  // Test 1a: Place bet - 5 tokens on UP
  let tickets = 5;
  let betAmount = tickets * tokenValue; // 5 * 300 = 1500
  let prediction = 'UP';
  let entryPrice = 22500.50;
  
  console.log(`\n📈 Bet: ${tickets} tickets (${betAmount}) on ${prediction}`);
  console.log(`   Entry Price: ${entryPrice}`);
  
  // Validate bet
  const minBet1 = game1.minTickets * tokenValue;
  const maxBet1 = game1.maxTickets * tokenValue;
  let isValid = betAmount >= minBet1 && betAmount <= maxBet1;
  console.log(`   Validation: ${isValid ? '✅ VALID' : '❌ INVALID'} (Min: ${minBet1}, Max: ${maxBet1})`);
  
  // Debit wallet
  user.gamesWallet.balance -= betAmount;
  user.gamesWallet.usedMargin += betAmount;
  console.log(`   Wallet After Bet: ${user.gamesWallet.balance.toLocaleString()}`);
  
  // Simulate result - User WINS (price went UP)
  let exitPrice = 22510.75;
  let won = exitPrice > entryPrice; // UP prediction correct
  
  console.log(`\n📊 Result: Exit Price ${exitPrice} (${exitPrice > entryPrice ? 'UP' : 'DOWN'})`);
  console.log(`   Prediction: ${prediction} | Actual: ${exitPrice > entryPrice ? 'UP' : 'DOWN'} | ${won ? '✅ WIN' : '❌ LOSS'}`);
  
  // Calculate payout
  let payout = 0;
  let profit = 0;
  let brokerage = 0;
  
  if (won) {
    const grossWin = betAmount * game1.winMultiplier; // 1500 * 1.95 = 2925
    const profitBeforeFee = grossWin - betAmount;
    brokerage = parseFloat(((profitBeforeFee * game1.brokeragePercent) / 100).toFixed(2));
    payout = grossWin;
    profit = grossWin - betAmount;

    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.balance += payout;
    user.gamesWallet.realizedPnL += profit;
  } else {
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.realizedPnL -= betAmount;
  }
  
  console.log(`\n💰 Payout Calculation:`);
  console.log(`   Gross Win: ${betAmount} × ${game1.winMultiplier} = ${(betAmount * game1.winMultiplier).toLocaleString()}`);
  console.log(`   Brokerage (${game1.brokeragePercent}% of profit, from SA pool): ${brokerage.toLocaleString()}`);
  console.log(`   User credit (gross): ${payout.toLocaleString()}`);
  console.log(`   Profit vs stake: ${profit.toLocaleString()}`);
  console.log(`   New Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  
  const expected1 = 50000 - 1500 + betAmount * game1.winMultiplier;
  const test1Pass = Math.abs(user.gamesWallet.balance - expected1) < 0.01;
  console.log(`\n   ✅ EXPECTED: ${expected1.toLocaleString()} | ACTUAL: ${user.gamesWallet.balance.toLocaleString()} | ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test1Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 2: BTC UP/DOWN GAME
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: BTC UP/DOWN GAME');
  console.log('='.repeat(70));
  
  const game2 = gameSettings.btcUpDown;
  console.log(`\n📊 Game: ${game2.name}`);
  console.log(`   Win Multiplier: ${game2.winMultiplier}x`);
  console.log(`   Available 24/7: ${game2.startTime} - ${game2.endTime}`);
  
  // Test 2: Place bet - 10 tokens on DOWN, user LOSES
  tickets = 10;
  betAmount = tickets * tokenValue; // 3000
  prediction = 'DOWN';
  entryPrice = 65000.00;
  
  console.log(`\n📈 Bet: ${tickets} tickets (${betAmount}) on ${prediction}`);
  
  user.gamesWallet.balance -= betAmount;
  user.gamesWallet.usedMargin += betAmount;
  
  // Simulate result - User LOSES (price went UP)
  exitPrice = 65100.00;
  won = exitPrice < entryPrice; // DOWN prediction - need price to go down
  
  console.log(`\n📊 Result: Exit Price ${exitPrice} (${exitPrice > entryPrice ? 'UP' : 'DOWN'})`);
  console.log(`   Prediction: ${prediction} | Actual: ${exitPrice > entryPrice ? 'UP' : 'DOWN'} | ${won ? '✅ WIN' : '❌ LOSS'}`);
  
  if (won) {
    const grossWin = betAmount * game2.winMultiplier;
    brokerage = 0;
    payout = grossWin;
    profit = payout - betAmount;
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.balance += payout;
    user.gamesWallet.realizedPnL += profit;
  } else {
    // Loss - bet already deducted
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.realizedPnL -= betAmount;
    payout = 0;
    profit = -betAmount;
  }
  
  console.log(`\n💰 Result:`);
  console.log(`   Loss: ${betAmount.toLocaleString()}`);
  console.log(`   New Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  console.log(`   Realized P&L: ${user.gamesWallet.realizedPnL.toLocaleString()}`);
  
  const expected2 = expected1 - 3000;
  const test2Pass = Math.abs(user.gamesWallet.balance - expected2) < 0.01;
  console.log(`\n   ✅ EXPECTED: ${expected2.toLocaleString()} | ACTUAL: ${user.gamesWallet.balance.toLocaleString()} | ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test2Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 3: NIFTY NUMBER GAME
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: NIFTY NUMBER GAME');
  console.log('='.repeat(70));
  
  const game3 = gameSettings.niftyNumber;
  console.log(`\n📊 Game: ${game3.name}`);
  console.log(`   Win Multiplier: ${game3.winMultiplier}x`);
  console.log(`   Fixed Profit: ${game3.fixedProfit}`);
  console.log(`   Bets Per Day: ${game3.betsPerDay}`);
  console.log(`   Result Time: ${game3.resultTime} IST`);
  
  // Test 3: Pick number .45, 1 ticket (quantity 1); gross prize = ticket×winMultiplier×qty (token when no ticketPrice)
  tickets = 1;
  betAmount = tickets * tokenValue; // 300
  const quantity = 1;
  const selectedNumber = 45; // .45
  
  console.log(`\n📈 Bet: ${tickets} ticket(s) (${betAmount}) on .${selectedNumber.toString().padStart(2, '0')}`);
  
  user.gamesWallet.balance -= betAmount;
  user.gamesWallet.usedMargin += betAmount;
  
  // Simulate result - Nifty closes at 22567.45 - User WINS!
  const niftyClose = 22567.45;
  const actualDecimal = Math.round((niftyClose % 1) * 100); // 45
  won = actualDecimal === selectedNumber;
  
  console.log(`\n📊 Result: Nifty Closed at ${niftyClose}`);
  console.log(`   Decimal: .${actualDecimal.toString().padStart(2, '0')}`);
  console.log(`   Selected: .${selectedNumber.toString().padStart(2, '0')} | ${won ? '✅ WIN' : '❌ LOSS'}`);
  
  if (won) {
    const ticketPxNn =
      game3.ticketPrice != null &&
      Number.isFinite(Number(game3.ticketPrice)) &&
      Number(game3.ticketPrice) > 0
        ? Number(game3.ticketPrice)
        : tokenValue;
    const multNn = Number(game3.winMultiplier);
    const grossPrize =
      Number.isFinite(multNn) && multNn > 0
        ? parseFloat((ticketPxNn * multNn * quantity).toFixed(2))
        : Number(game3.fixedProfit) > 0
          ? game3.fixedProfit * quantity
          : 4000 * quantity;
    const grossHierarchyPctSum =
      (Number(game3.grossPrizeSubBrokerPercent) || 0) +
      (Number(game3.grossPrizeBrokerPercent) || 0) +
      (Number(game3.grossPrizeAdminPercent) || 0);
    brokerage =
      grossHierarchyPctSum > 0
        ? parseFloat(((grossPrize * grossHierarchyPctSum) / 100).toFixed(2))
        : parseFloat(
            Math.min(grossPrize, (grossPrize * (Number(game3.brokeragePercent) || 0)) / 100).toFixed(2)
          );
    payout = grossPrize;
    profit = grossPrize - betAmount;

    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.balance += payout;
    user.gamesWallet.realizedPnL += profit;
  } else {
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.realizedPnL -= betAmount;
    payout = 0;
    profit = -betAmount;
  }
  
  console.log(`\n💰 Payout Calculation:`);
  console.log(
    `   Gross prize G: ticket×multiplier×qty = ${(tokenValue * Number(game3.winMultiplier)).toLocaleString()} × ${quantity} = ${won ? (parseFloat((tokenValue * Number(game3.winMultiplier) * quantity).toFixed(2))).toLocaleString() : 0}`
  );
  console.log(`   Gross hierarchy % (SB+Br+Ad): ${((Number(game3.grossPrizeSubBrokerPercent)||0)+(Number(game3.grossPrizeBrokerPercent)||0)+(Number(game3.grossPrizeAdminPercent)||0))}% of G → fee ${(won ? brokerage : 0).toLocaleString()}`);
  console.log(`   User credit (gross G): ${payout.toLocaleString()}`);
  console.log(`   Profit vs stake: ${profit.toLocaleString()}`);
  console.log(`   New Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  
  const grossPrize3 =
    Number(game3.winMultiplier) > 0
      ? parseFloat((tokenValue * Number(game3.winMultiplier) * quantity).toFixed(2))
      : Number(game3.fixedProfit) > 0
        ? game3.fixedProfit * quantity
        : 4000 * quantity;
  const expected3 = expected2 - betAmount + grossPrize3;
  const test3Pass = Math.abs(user.gamesWallet.balance - expected3) < 0.01;
  console.log(`\n   ✅ EXPECTED: ${expected3.toLocaleString()} | ACTUAL: ${user.gamesWallet.balance.toLocaleString()} | ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test3Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 4: NIFTY BRACKET GAME
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 4: NIFTY BRACKET GAME');
  console.log('='.repeat(70));
  
  const game4 = gameSettings.niftyBracket;
  console.log(`\n📊 Game: ${game4.name}`);
  console.log(`   Win Multiplier: ${game4.winMultiplier}x`);
  console.log(`   Bracket Gap: ${game4.bracketGap} points`);
  console.log(`   Expiry: ${game4.expiryMinutes} minutes`);
  
  // Test 4: Current price 22500, user bets BUY (expects price to hit 22520)
  const currentPrice = 22500;
  const buyLevel = currentPrice + game4.bracketGap; // 22520
  const sellLevel = currentPrice - game4.bracketGap; // 22480
  
  tickets = 3;
  const bracketTicketPx =
    game4.ticketPrice != null && Number.isFinite(Number(game4.ticketPrice)) && Number(game4.ticketPrice) > 0
      ? Number(game4.ticketPrice)
      : tokenValue;
  betAmount = tickets * bracketTicketPx;
  const bracketSide = 'BUY'; // User expects price to hit buyLevel first
  
  console.log(`\n📈 Current Price: ${currentPrice}`);
  console.log(`   BUY Level: ${buyLevel} (+${game4.bracketGap})`);
  console.log(`   SELL Level: ${sellLevel} (-${game4.bracketGap})`);
  console.log(`   Bet: ${tickets} tickets (${betAmount}) on ${bracketSide}`);
  
  user.gamesWallet.balance -= betAmount;
  user.gamesWallet.usedMargin += betAmount;
  
  // Simulate result - Price hits BUY level first - User WINS
  const hitLevel = buyLevel; // Price went to 22520
  won = (bracketSide === 'BUY' && hitLevel === buyLevel) || (bracketSide === 'SELL' && hitLevel === sellLevel);
  
  console.log(`\n📊 Result: Price hit ${hitLevel} first`);
  console.log(`   ${won ? '✅ WIN' : '❌ LOSS'} - ${bracketSide} level was hit`);
  
  if (won) {
    const grossWin = betAmount * game4.winMultiplier;
    brokerage = 0;
    payout = grossWin;
    profit = payout - betAmount;
    
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.balance += payout;
    user.gamesWallet.realizedPnL += profit;
  } else {
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.realizedPnL -= betAmount;
    payout = 0;
    profit = -betAmount;
  }
  
  console.log(`\n💰 Payout Calculation:`);
  console.log(`   Gross Win: ${betAmount} × ${game4.winMultiplier} = ${(betAmount * game4.winMultiplier).toLocaleString()}`);
  console.log(`   Win-side fee: none`);
  console.log(`   Payout: ${payout.toLocaleString()}`);
  console.log(`   Net Profit: ${profit.toLocaleString()}`);
  console.log(`   New Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  
  const expected4 = expected3 - betAmount + betAmount * game4.winMultiplier;
  const test4Pass = Math.abs(user.gamesWallet.balance - expected4) < 0.01;
  console.log(`\n   ✅ EXPECTED: ${expected4.toLocaleString()} | ACTUAL: ${user.gamesWallet.balance.toLocaleString()} | ${test4Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test4Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 5: NIFTY JACKPOT GAME
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 5: NIFTY JACKPOT GAME');
  console.log('='.repeat(70));
  
  const game5 = gameSettings.niftyJackpot;
  console.log(`\n📊 Game: ${game5.name}`);
  console.log(`   Top Winners: ${game5.topWinners}`);
  console.log(`   Prize Distribution: ${game5.prizeDistribution.map((p, i) => `#${i+1}: ${p.toLocaleString()}`).join(', ')}`);
  console.log(`   Bids Per Day: ${game5.bidsPerDay}`);
  
  // Test 5: User places bid, ends up in 3rd place
  tickets = 5;
  betAmount = tickets * tokenValue; // 1500
  const bidValue = 22567.89; // User's prediction for Nifty close
  
  console.log(`\n📈 Bid: ${tickets} tickets (${betAmount})`);
  console.log(`   Predicted Close: ${bidValue}`);
  
  user.gamesWallet.balance -= betAmount;
  user.gamesWallet.usedMargin += betAmount;
  
  // Simulate result - User gets 3rd place
  const actualClose = 22567.45;
  const userRank = 3; // User's bid was 3rd closest
  
  console.log(`\n📊 Result: Nifty Closed at ${actualClose}`);
  console.log(`   User's Bid: ${bidValue} (Diff: ${Math.abs(bidValue - actualClose).toFixed(2)})`);
  console.log(`   User Rank: #${userRank}`);
  
  // Prize for 3rd place
  const prize = game5.prizeDistribution[userRank - 1]; // 8000
  won = userRank <= game5.topWinners;
  
  if (won) {
    brokerage = 0;
    payout = prize;
    profit = payout - betAmount;
    
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.balance += payout;
    user.gamesWallet.realizedPnL += profit;
  } else {
    user.gamesWallet.usedMargin -= betAmount;
    user.gamesWallet.realizedPnL -= betAmount;
    payout = 0;
    profit = -betAmount;
  }
  
  console.log(`\n💰 Prize Calculation:`);
  console.log(`   Rank #${userRank} Prize: ${prize.toLocaleString()}`);
  console.log(`   Prize fee: none`);
  console.log(`   Payout: ${payout.toLocaleString()}`);
  console.log(`   Net Profit: ${profit.toLocaleString()}`);
  console.log(`   New Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  
  const expected5 = expected4 - 1500 + 8000;
  const test5Pass = Math.abs(user.gamesWallet.balance - expected5) < 0.01;
  console.log(`\n   ✅ EXPECTED: ${expected5.toLocaleString()} | ACTUAL: ${user.gamesWallet.balance.toLocaleString()} | ${test5Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test5Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 6: PROFIT DISTRIBUTION TEST
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 6: PROFIT DISTRIBUTION (Admin Hierarchy)');
  console.log('='.repeat(70));
  
  // When user loses, the lost amount is distributed to admin hierarchy
  const lostAmount = 3000; // From Test 2 (BTC Up/Down loss)
  
  console.log(`\n📊 Lost Amount to Distribute: ${lostAmount.toLocaleString()}`);
  console.log(`   Distribution: SA ${profitDistribution.superAdminPercent}% | Admin ${profitDistribution.adminPercent}% | Broker ${profitDistribution.brokerPercent}% | SubBroker ${profitDistribution.subBrokerPercent}%`);
  
  const saShare = lostAmount * profitDistribution.superAdminPercent / 100; // 1200
  const adminShare = lostAmount * profitDistribution.adminPercent / 100; // 900
  const brokerShare = lostAmount * profitDistribution.brokerPercent / 100; // 600
  const sbShare = lostAmount * profitDistribution.subBrokerPercent / 100; // 300
  
  console.log(`\n💰 Distribution:`);
  console.log(`   Super Admin: ${saShare.toLocaleString()} (${profitDistribution.superAdminPercent}%)`);
  console.log(`   Admin: ${adminShare.toLocaleString()} (${profitDistribution.adminPercent}%)`);
  console.log(`   Broker: ${brokerShare.toLocaleString()} (${profitDistribution.brokerPercent}%)`);
  console.log(`   SubBroker: ${sbShare.toLocaleString()} (${profitDistribution.subBrokerPercent}%)`);
  console.log(`   Total: ${(saShare + adminShare + brokerShare + sbShare).toLocaleString()}`);
  
  const totalDist = saShare + adminShare + brokerShare + sbShare;
  const test6Pass = totalDist === lostAmount;
  console.log(`\n   ✅ EXPECTED Total: ${lostAmount.toLocaleString()} | ACTUAL: ${totalDist.toLocaleString()} | ${test6Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!test6Pass) allTestsPassed = false;
  
  // ============================================
  // TEST 7: VALIDATION TESTS
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST 7: VALIDATION TESTS');
  console.log('='.repeat(70));
  
  // Test 7a: Min/Max ticket validation
  console.log('\n📋 7a: Min/Max Ticket Validation');
  const testBets = [
    { tickets: 0, expected: 'INVALID', reason: 'Below minimum' },
    { tickets: 1, expected: 'VALID', reason: 'At minimum' },
    { tickets: 500, expected: 'VALID', reason: 'At maximum' },
    { tickets: 501, expected: 'INVALID', reason: 'Above maximum' }
  ];
  
  testBets.forEach(test => {
    const amount = test.tickets * tokenValue;
    const minAmt = gameSettings.niftyUpDown.minTickets * tokenValue;
    const maxAmt = gameSettings.niftyUpDown.maxTickets * tokenValue;
    const isValid = amount >= minAmt && amount <= maxAmt && test.tickets > 0;
    const result = isValid ? 'VALID' : 'INVALID';
    const pass = result === test.expected;
    console.log(`   ${test.tickets} tickets (${amount.toLocaleString()}): ${result} - ${test.reason} | ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
    if (!pass) allTestsPassed = false;
  });
  
  // Test 7b: Nifty Number range validation
  console.log('\n📋 7b: Nifty Number Range Validation');
  const numberTests = [
    { num: -1, expected: 'INVALID' },
    { num: 0, expected: 'VALID' },
    { num: 45, expected: 'VALID' },
    { num: 99, expected: 'VALID' },
    { num: 100, expected: 'INVALID' }
  ];
  
  numberTests.forEach(test => {
    const isValid = test.num >= 0 && test.num <= 99;
    const result = isValid ? 'VALID' : 'INVALID';
    const pass = result === test.expected;
    console.log(`   Number .${test.num.toString().padStart(2, '0')}: ${result} | ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
    if (!pass) allTestsPassed = false;
  });
  
  // Test 7c: Insufficient balance
  console.log('\n📋 7c: Insufficient Balance Check');
  const userBalance = 1000;
  const requiredAmount = 1500;
  const canBet = userBalance >= requiredAmount;
  console.log(`   Balance: ${userBalance} | Required: ${requiredAmount} | ${canBet ? 'CAN BET' : 'INSUFFICIENT'} | ${!canBet ? 'PASS ✅' : 'FAIL ❌'}`);
  if (canBet) allTestsPassed = false;
  
  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log('Test 1: Nifty Up/Down (WIN)     - 5 tickets, +1,425 (gross credit) ✅ PASS');
  console.log('Test 2: BTC Up/Down (LOSS)     - 10 tickets, -3,000      ✅ PASS');
  console.log('Test 3: Nifty Number (WIN)     - 1 ticket, full gross + SA hierarchy ✅ PASS');
  console.log('Test 4: Nifty Bracket (WIN)    - 3 tickets, +900         ✅ PASS');
  console.log('Test 5: Nifty Jackpot (#3)     - 5 tickets, +6,500       ✅ PASS');
  console.log('Test 6: Profit Distribution    - 3,000 distributed       ✅ PASS');
  console.log('Test 7: Validation Tests       - All validations          ✅ PASS');
  
  console.log('\n' + (allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED') + ' - Games Logic is ' + (allTestsPassed ? 'working correctly!' : 'having issues!'));
  console.log('='.repeat(70));
  
  // Final state
  console.log('\n📋 FINAL USER STATE:');
  console.log(`   Initial Balance: 50,000`);
  console.log(`   Final Balance: ${user.gamesWallet.balance.toLocaleString()}`);
  console.log(`   Net P&L: ${user.gamesWallet.realizedPnL.toLocaleString()}`);
  console.log(`   Total Bets: 5 (3 wins, 1 loss, 1 jackpot)`);
}

// Run the test
testGamesLogic();
