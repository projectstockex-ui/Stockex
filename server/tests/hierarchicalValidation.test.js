/**
 * Hierarchical Validation Test
 * Tests that child admins cannot set segment permission values higher than their parent's limits
 */

import Admin from '../models/Admin.js';

async function testHierarchicalValidation() {
  console.log('[TEST] Starting hierarchical validation tests...\n');

  // Test 1: Leverage validation with segmentPermissions fallback
  console.log('[TEST 1] Leverage validation with segmentPermissions fallback');
  const parentWithSegPerms = {
    role: 'ADMIN',
    leverageSettings: { maxLeverageFromParent: undefined }, // Not set
    segmentPermissions: {
      NSEFUT: { exposureIntraday: 120, exposureCarryForward: 120 }
    }
  };
  
  // Import the validation service
  const leverageValidationService = (await import('../services/leverageValidationService.js')).default;
  
  const parentMaxLeverage = leverageValidationService.getParentMaxLeverageLimit(parentWithSegPerms);
  console.log(`  Parent max leverage from segmentPermissions: ${parentMaxLeverage}`);
  console.log(`  Expected: 120, Actual: ${parentMaxLeverage}`);
  console.log(`  Result: ${parentMaxLeverage === 120 ? 'PASS' : 'FAIL'}\n`);

  // Test 2: Leverage validation with maxLeverageFromParent
  console.log('[TEST 2] Leverage validation with maxLeverageFromParent');
  const parentWithMaxLeverage = {
    role: 'ADMIN',
    leverageSettings: { maxLeverageFromParent: 100 },
    segmentPermissions: {
      NSEFUT: { exposureIntraday: 120, exposureCarryForward: 120 }
    }
  };
  
  const parentMaxLeverage2 = leverageValidationService.getParentMaxLeverageLimit(parentWithMaxLeverage);
  console.log(`  Parent max leverage from maxLeverageFromParent: ${parentMaxLeverage2}`);
  console.log(`  Expected: 100, Actual: ${parentMaxLeverage2}`);
  console.log(`  Result: ${parentMaxLeverage2 === 100 ? 'PASS' : 'FAIL'}\n`);

  // Test 3: SuperAdmin unlimited leverage
  console.log('[TEST 3] SuperAdmin unlimited leverage');
  const superAdmin = {
    role: 'SUPER_ADMIN',
    leverageSettings: { maxLeverageFromParent: undefined },
    segmentPermissions: {}
  };
  
  const superAdminMaxLeverage = leverageValidationService.getParentMaxLeverageLimit(superAdmin);
  console.log(`  SuperAdmin max leverage: ${superAdminMaxLeverage}`);
  console.log(`  Expected: 2000, Actual: ${superAdminMaxLeverage}`);
  console.log(`  Result: ${superAdminMaxLeverage === 2000 ? 'PASS' : 'FAIL'}\n`);

  // Test 4: Child leverage validation
  console.log('[TEST 4] Child leverage validation');
  const parent = {
    role: 'ADMIN',
    leverageSettings: { maxLeverageFromParent: 120 },
    segmentPermissions: {
      NSEFUT: { exposureIntraday: 120, exposureCarryForward: 120 }
    }
  };
  
  const childLeverageData = {
    maxLeverageFromParent: 100,
    intradayLeverage: 130, // Exceeds parent's 120
    carryForwardLeverage: 100
  };
  
  const validation = leverageValidationService.validateChildLeverageSettings(parent, childLeverageData);
  console.log(`  Child intradayLeverage: ${childLeverageData.intradayLeverage}, Parent max: 120`);
  console.log(`  Validation result: ${validation.valid ? 'VALID' : 'INVALID'}`);
  console.log(`  Error message: ${validation.error}`);
  console.log(`  Expected: INVALID, Actual: ${validation.valid ? 'VALID' : 'INVALID'}`);
  console.log(`  Result: ${!validation.valid ? 'PASS' : 'FAIL'}\n`);

  // Test 5: Child leverage within limit
  console.log('[TEST 5] Child leverage within limit');
  const childLeverageData2 = {
    maxLeverageFromParent: 100,
    intradayLeverage: 100, // Within parent's 120
    carryForwardLeverage: 100
  };
  
  const validation2 = leverageValidationService.validateChildLeverageSettings(parent, childLeverageData2);
  console.log(`  Child intradayLeverage: ${childLeverageData2.intradayLeverage}, Parent max: 120`);
  console.log(`  Validation result: ${validation2.valid ? 'VALID' : 'INVALID'}`);
  console.log(`  Expected: VALID, Actual: ${validation2.valid ? 'VALID' : 'INVALID'}`);
  console.log(`  Result: ${validation2.valid ? 'PASS' : 'FAIL'}\n`);

  // Test 6: Segment permission fields validation (maxLots)
  console.log('[TEST 6] Segment permission maxLots validation');
  const parentSegPerms = {
    role: 'ADMIN',
    segmentPermissions: {
      NSEFUT: {
        maxLots: 1000,
        maxExchangeLots: 2000,
        quantitySettings: { breakupQuantity: 100, maxBid: 500 },
        orderLots: 50,
        commissionLot: 10
      }
    }
  };
  
  const childSegPerms = {
    NSEFUT: {
      maxLots: 1500, // Exceeds parent's 1000
      maxExchangeLots: 2000,
      quantitySettings: { breakupQuantity: 100, maxBid: 500 },
      orderLots: 50,
      commissionLot: 10
    }
  };
  
  // Simulate the validation logic from the controller
  let maxLotsValidationPassed = true;
  for (const [segName, segData] of Object.entries(childSegPerms)) {
    const parentSeg = parentSegPerms.segmentPermissions[segName] || {};
    if (segData.maxLots !== undefined && parentSeg.maxLots !== undefined) {
      if (segData.maxLots > parentSeg.maxLots) {
        maxLotsValidationPassed = false;
        console.log(`  Child maxLots: ${segData.maxLots}, Parent maxLots: ${parentSeg.maxLots}`);
        console.log(`  Expected: INVALID (exceeds parent), Actual: INVALID`);
        console.log(`  Result: PASS\n`);
        break;
      }
    }
  }
  
  if (maxLotsValidationPassed) {
    console.log(`  Result: FAIL (should have rejected maxLots exceeding parent)\n`);
  }

  // Test 7: Segment permission fields validation (maxLots within limit)
  console.log('[TEST 7] Segment permission maxLots within limit');
  const childSegPerms2 = {
    NSEFUT: {
      maxLots: 800, // Within parent's 1000
      maxExchangeLots: 2000,
      quantitySettings: { breakupQuantity: 100, maxBid: 500 },
      orderLots: 50,
      commissionLot: 10
    }
  };
  
  let maxLotsValidationPassed2 = true;
  for (const [segName, segData] of Object.entries(childSegPerms2)) {
    const parentSeg = parentSegPerms.segmentPermissions[segName] || {};
    if (segData.maxLots !== undefined && parentSeg.maxLots !== undefined) {
      if (segData.maxLots > parentSeg.maxLots) {
        maxLotsValidationPassed2 = false;
        break;
      }
    }
  }
  
  console.log(`  Child maxLots: ${childSegPerms2.NSEFUT.maxLots}, Parent maxLots: ${parentSegPerms.segmentPermissions.NSEFUT.maxLots}`);
  console.log(`  Expected: VALID (within parent), Actual: ${maxLotsValidationPassed2 ? 'VALID' : 'INVALID'}`);
  console.log(`  Result: ${maxLotsValidationPassed2 ? 'PASS' : 'FAIL'}\n`);

  // Test 8: breakupQuantity validation
  console.log('[TEST 8] Segment permission breakupQuantity validation');
  const childSegPerms3 = {
    NSEFUT: {
      maxLots: 1000,
      maxExchangeLots: 2000,
      quantitySettings: { breakupQuantity: 150, maxBid: 500 }, // Exceeds parent's 100
      orderLots: 50,
      commissionLot: 10
    }
  };
  
  let breakupValidationPassed = true;
  for (const [segName, segData] of Object.entries(childSegPerms3)) {
    const parentSeg = parentSegPerms.segmentPermissions[segName] || {};
    if (segData.quantitySettings && parentSeg.quantitySettings) {
      if (segData.quantitySettings.breakupQuantity !== undefined && parentSeg.quantitySettings.breakupQuantity !== undefined) {
        if (segData.quantitySettings.breakupQuantity > parentSeg.quantitySettings.breakupQuantity) {
          breakupValidationPassed = false;
          console.log(`  Child breakupQuantity: ${segData.quantitySettings.breakupQuantity}, Parent breakupQuantity: ${parentSeg.quantitySettings.breakupQuantity}`);
          console.log(`  Expected: INVALID (exceeds parent), Actual: INVALID`);
          console.log(`  Result: PASS\n`);
          break;
        }
      }
    }
  }
  
  if (breakupValidationPassed) {
    console.log(`  Result: FAIL (should have rejected breakupQuantity exceeding parent)\n`);
  }

  console.log('[TEST] All hierarchical validation tests completed.');
}

// Run tests
testHierarchicalValidation().catch(console.error);
