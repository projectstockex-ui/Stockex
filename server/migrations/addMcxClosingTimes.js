import mongoose from 'mongoose';
import SystemSettings from '../models/SystemSettings.js';

/**
 * Migration: Add closing times to SystemSettings for auto-square
 */

async function migrate() {
  try {
    console.log('[Migration] Starting: Add closing times for auto-square');
    
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockex');
    console.log('[Migration] Connected to MongoDB');
    
    const settings = await SystemSettings.findOne({ settingsType: 'global' });
    
    if (!settings) {
      console.error('[Migration] SystemSettings not found');
      process.exit(1);
    }
    
    if (!settings.adminSegmentDefaults) {
      settings.adminSegmentDefaults = new Map();
    }
    
    // Set closing times for all segments
    const closingTimes = {
      MCXFUT: '23:30',
      MCXOPT: '23:30',
      NSEFUT: '15:30',
      NSEOPT: '15:30',
      'NSE-EQ': '15:30',
      'BSE-FUT': '15:30',
      'BSE-OPT': '15:30',
      CRYPTOFUT: '23:30',
      CRYPTOOPT: '23:30',
      FOREXFUT: '23:30',
      FOREXOPT: '23:30'
    };
    
    for (const [segment, time] of Object.entries(closingTimes)) {
      let segmentData = settings.adminSegmentDefaults.get(segment);
      if (!segmentData) {
        segmentData = {
          enabled: false,
          maxExchangeLots: 100,
          commissionType: 'PER_LOT',
          commissionUnit: null,
          commissionLot: 0,
          commission: 0,
          maxLots: 50,
          minLots: 1,
          orderLots: 10,
          exposureIntraday: 1,
          exposureCarryForward: 1,
          allowClientIntradayOnly: true,
          defaultIntradayOnly: false,
          cryptoSpreadInr: 0,
          cryptoSpreadUsdPerSide: 0,
          cryptoStartTime: '',
          cryptoClosingTime: '',
          closingTime: time,
          cryptoReferenceSymbol: '',
          cryptoPricePerLotInr: 0,
          cryptoLotSizeLots: 1,
          cryptoLotSizeQuantity: 0,
          maxIntradayQty: 2000,
          maxCarryQty: 1000
        };
        // For crypto segments, also set cryptoClosingTime
        if (segment.startsWith('CRYPTO') || segment.startsWith('FOREX')) {
          segmentData.cryptoClosingTime = time;
        }
        settings.adminSegmentDefaults.set(segment, segmentData);
      } else {
        segmentData.closingTime = time;
        // For crypto segments, also set cryptoClosingTime
        if (segment.startsWith('CRYPTO') || segment.startsWith('FOREX')) {
          segmentData.cryptoClosingTime = time;
        }
        settings.adminSegmentDefaults.set(segment, segmentData);
      }
      console.log(`[Migration] Set ${segment}.closingTime = ${time}`);
    }
    
    settings.markModified('adminSegmentDefaults');
    await settings.save();
    console.log('[Migration] Document saved to database');
    
    console.log('[Migration] Success: Closing times set for all segments');
    console.log('[Migration] Closing times:', JSON.stringify(closingTimes, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

migrate();
