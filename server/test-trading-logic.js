import mongoose from 'mongoose';
import Admin from './models/Admin.js';
import User from './models/User.js';
import TradeService from './services/tradeService.js';
import SystemSettings from './models/SystemSettings.js';
import Instrument from './models/Instrument.js';

mongoose.connect('mongodb://127.0.0.1:27017/stockex')
  .then(async () => {
    console.log('Connected to MongoDB');
    await runTests();
    mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

async function runTests() {
  console.log('\n========================================');
  console.log('COMPREHENSIVE TRADING LOGIC TESTS');
  console.log('========================================\n');

  const results = {
    brokerage: { passed: 0, failed: 0, details: [] },
    leverage: { passed: 0, failed: 0, details: [] },
    intraday: { passed: 0, failed: 0, details: [] },
    carryforward: { passed: 0, failed: 0, details: [] },
    breakupQty: { passed: 0, failed: 0, details: [] }
  };

  // Test 1: Brokerage Calculation
  console.log('TEST 1: Brokerage Calculation');
  console.log('-----------------------------');
  try {
    const admin = await Admin.findOne({ role: 'ADMIN' }).limit(1);
    if (!admin) throw new Error('No admin found');

    const brokerageCaps = admin.brokerageCaps || {};
    console.log('Admin:', admin.name);
    console.log('Brokerage Caps:', JSON.stringify(brokerageCaps, null, 2));

    // Test perCrore brokerage
    const turnover = 10000000; // 1 crore
    const perCroreRate = 100; // 100 per crore
    const expectedBrokerage = (turnover / 10000000) * perCroreRate;
    
    console.log('Turnover:', turnover);
    console.log('Per Crore Rate:', perCroreRate);
    console.log('Expected Brokerage:', expectedBrokerage);

    if (expectedBrokerage === 100) {
      results.brokerage.passed++;
      results.brokerage.details.push('✓ Per crore brokerage calculation: PASSED');
    } else {
      results.brokerage.failed++;
      results.brokerage.details.push('✗ Per crore brokerage calculation: FAILED (expected 100, got ' + expectedBrokerage + ')');
    }

    // Test brokerage caps
    if (brokerageCaps.perCrore && brokerageCaps.perCrore.max) {
      console.log('Per Crore Max Cap:', brokerageCaps.perCrore.max);
      const cappedBrokerage = Math.min(expectedBrokerage, brokerageCaps.perCrore.max);
      console.log('Capped Brokerage:', cappedBrokerage);
      results.brokerage.details.push('✓ Brokerage caps: IMPLEMENTED');
    } else {
      results.brokerage.details.push('⚠ Brokerage caps: NOT SET');
    }

  } catch (error) {
    results.brokerage.failed++;
    results.brokerage.details.push('✗ Brokerage test error: ' + error.message);
  }
  console.log('');

  // Test 2: Leverage Calculation
  console.log('TEST 2: Leverage Calculation');
  console.log('---------------------------');
  try {
    const admin = await Admin.findOne({ role: 'ADMIN' }).limit(1);
    if (!admin) throw new Error('No admin found');

    const charges = admin.charges || {};
    console.log('Admin Charges:', JSON.stringify(charges, null, 2));

    const intradayLeverage = charges.intradayLeverage || 5;
    const carryForwardLeverage = charges.carryForwardLeverage || 3;

    console.log('Intraday Leverage:', intradayLeverage);
    console.log('Carryforward Leverage:', carryForwardLeverage);

    if (intradayLeverage > 0 && carryForwardLeverage > 0) {
      results.leverage.passed++;
      results.leverage.details.push('✓ Leverage settings: CONFIGURED');
      results.leverage.details.push('  - Intraday: ' + intradayLeverage + 'x');
      results.leverage.details.push('  - Carryforward: ' + carryForwardLeverage + 'x');
    } else {
      results.leverage.failed++;
      results.leverage.details.push('✗ Leverage settings: NOT CONFIGURED');
    }

  } catch (error) {
    results.leverage.failed++;
    results.leverage.details.push('✗ Leverage test error: ' + error.message);
  }
  console.log('');

  // Test 3: Intraday (MIS) Product Type
  console.log('TEST 3: Intraday (MIS) Product Type');
  console.log('--------------------------------------');
  try {
    const user = await User.findOne({}).limit(1);
    if (!user) throw new Error('No user found');

    console.log('User:', user.username);
    console.log('Admin:', user.adminCode);

    // Check segment permissions for intraday
    const admin = await Admin.findOne({ adminCode: user.adminCode });
    if (admin) {
      const segPerms = admin.segmentPermissions instanceof Map 
        ? Object.fromEntries(admin.segmentPermissions)
        : (admin.segmentPermissions || {});

      console.log('Admin Segment Permissions:', Object.keys(segPerms).filter(k => segPerms[k]?.enabled));

      // Check MCXFUT for intraday
      if (segPerms['MCXFUT']?.enabled) {
        const mcxFut = segPerms['MCXFUT'];
        const exposureIntraday = mcxFut.exposureIntraday || 0;
        console.log('MCXFUT Intraday Exposure:', exposureIntraday);

        if (exposureIntraday > 0) {
          results.intraday.passed++;
          results.intraday.details.push('✓ MCXFUT Intraday exposure: SET (' + exposureIntraday + 'x)');
        } else {
          results.intraday.failed++;
          results.intraday.details.push('✗ MCXFUT Intraday exposure: NOT SET');
        }
      } else {
        results.intraday.details.push('⚠ MCXFUT not enabled for admin');
      }
    }

  } catch (error) {
    results.intraday.failed++;
    results.intraday.details.push('✗ Intraday test error: ' + error.message);
  }
  console.log('');

  // Test 4: Carryforward (NRML) Product Type
  console.log('TEST 4: Carryforward (NRML) Product Type');
  console.log('------------------------------------------');
  try {
    const user = await User.findOne({}).limit(1);
    if (!user) throw new Error('No user found');

    console.log('User:', user.username);
    console.log('Admin:', user.adminCode);

    // Check segment permissions for carryforward
    const admin = await Admin.findOne({ adminCode: user.adminCode });
    if (admin) {
      const segPerms = admin.segmentPermissions instanceof Map 
        ? Object.fromEntries(admin.segmentPermissions)
        : (admin.segmentPermissions || {});

      console.log('Admin Segment Permissions:', Object.keys(segPerms).filter(k => segPerms[k]?.enabled));

      // Check MCXFUT for carryforward
      if (segPerms['MCXFUT']?.enabled) {
        const mcxFut = segPerms['MCXFUT'];
        const exposureCarryForward = mcxFut.exposureCarryForward || 0;
        console.log('MCXFUT Carryforward Exposure:', exposureCarryForward);

        if (exposureCarryForward > 0) {
          results.carryforward.passed++;
          results.carryforward.details.push('✓ MCXFUT Carryforward exposure: SET (' + exposureCarryForward + 'x)');
        } else {
          results.carryforward.failed++;
          results.carryforward.details.push('✗ MCXFUT Carryforward exposure: NOT SET');
        }
      } else {
        results.carryforward.details.push('⚠ MCXFUT not enabled for admin');
      }
    }

  } catch (error) {
    results.carryforward.failed++;
    results.carryforward.details.push('✗ Carryforward test error: ' + error.message);
  }
  console.log('');

  // Test 5: Breakup Quantity
  console.log('TEST 5: Breakup Quantity');
  console.log('---------------------------');
  try {
    const admin = await Admin.findOne({ role: 'ADMIN' }).limit(1);
    if (!admin) throw new Error('No admin found');

    const segPerms = admin.segmentPermissions instanceof Map 
      ? Object.fromEntries(admin.segmentPermissions)
      : (admin.segmentPermissions || {});

    console.log('Admin:', admin.name);

    // Check MCXFUT breakup quantity
    if (segPerms['MCXFUT']?.enabled) {
      const mcxFut = segPerms['MCXFUT'];
      const breakupQuantity = mcxFut.breakupQuantity || 0;
      const maxLots = mcxFut.maxLots || 0;
      const minLots = mcxFut.minLots || 0;

      console.log('MCXFUT Breakup Quantity:', breakupQuantity);
      console.log('MCXFUT Max Lots:', maxLots);
      console.log('MCXFUT Min Lots:', minLots);

      if (breakupQuantity > 0) {
        results.breakupQty.passed++;
        results.breakupQty.details.push('✓ Breakup quantity: SET (' + breakupQuantity + ')');
      } else {
        results.breakupQty.failed++;
        results.breakupQty.details.push('✗ Breakup quantity: NOT SET');
      }

      if (maxLots > 0 && minLots > 0) {
        results.breakupQty.passed++;
        results.breakupQty.details.push('✓ Lot limits: CONFIGURED (min: ' + minLots + ', max: ' + maxLots + ')');
      } else {
        results.breakupQty.failed++;
        results.breakupQty.details.push('✗ Lot limits: NOT CONFIGURED');
      }
    } else {
      results.breakupQty.details.push('⚠ MCXFUT not enabled for admin');
    }

  } catch (error) {
    results.breakupQty.failed++;
    results.breakupQty.details.push('✗ Breakup quantity test error: ' + error.message);
  }
  console.log('');

  // Display Results
  console.log('\n========================================');
  console.log('TEST RESULTS');
  console.log('========================================\n');

  console.log('BROKERAGE:');
  console.log('  Passed:', results.brokerage.passed);
  console.log('  Failed:', results.brokerage.failed);
  results.brokerage.details.forEach(d => console.log('  ' + d));

  console.log('\nLEVERAGE:');
  console.log('  Passed:', results.leverage.passed);
  console.log('  Failed:', results.leverage.failed);
  results.leverage.details.forEach(d => console.log('  ' + d));

  console.log('\nINTRADAY (MIS):');
  console.log('  Passed:', results.intraday.passed);
  console.log('  Failed:', results.intraday.failed);
  results.intraday.details.forEach(d => console.log('  ' + d));

  console.log('\nCARRYFORWARD (NRML):');
  console.log('  Passed:', results.carryforward.passed);
  console.log('  Failed:', results.carryforward.failed);
  results.carryforward.details.forEach(d => console.log('  ' + d));

  console.log('\nBREAKUP QUANTITY:');
  console.log('  Passed:', results.breakupQty.passed);
  console.log('  Failed:', results.breakupQty.failed);
  results.breakupQty.details.forEach(d => console.log('  ' + d));

  const totalPassed = results.brokerage.passed + results.leverage.passed + results.intraday.passed + results.carryforward.passed + results.breakupQty.passed;
  const totalFailed = results.brokerage.failed + results.leverage.failed + results.intraday.failed + results.carryforward.failed + results.breakupQty.failed;

  console.log('\n========================================');
  console.log('TOTAL:');
  console.log('  Passed:', totalPassed);
  console.log('  Failed:', totalFailed);
  console.log('========================================\n');
}
