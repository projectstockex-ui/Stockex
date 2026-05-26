/** Map instrument segment/displaySegment to hierarchy admin segment key (matches server TradeService.resolveMarketWatchSegmentKey). */
export function resolveInstrumentAdminSegmentKey(inst) {
  const segmentUpper = String(inst?.displaySegment || inst?.segment || '').toUpperCase();
  const instrumentType = inst?.instrumentType || '';
  const isOptions = instrumentType === 'OPTIONS' || instrumentType === 'OPT';

  const marketWatchSegments = [
    'NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT',
    'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT',
  ];
  if (marketWatchSegments.includes(segmentUpper)) return segmentUpper;

  if (segmentUpper === 'EQUITY' || segmentUpper === 'EQ' || segmentUpper === 'NSE' || segmentUpper === 'NSEEQ') {
    return 'NSE-EQ';
  }
  if (segmentUpper === 'FNO' || segmentUpper === 'NFO' || segmentUpper === 'NSEINDEX' || segmentUpper === 'NSESTOCK') {
    return isOptions ? 'NSEOPT' : 'NSEFUT';
  }
  if (segmentUpper === 'MCX' || segmentUpper === 'COMMODITY') {
    return isOptions ? 'MCXOPT' : 'MCXFUT';
  }
  if (segmentUpper === 'BSE' || segmentUpper === 'BFO') {
    return isOptions ? 'BSE-OPT' : 'BSE-FUT';
  }
  if (segmentUpper === 'FOREX') {
    return isOptions ? 'FOREXOPT' : 'FOREXFUT';
  }
  if (segmentUpper === 'BINANCE' || segmentUpper === 'CRYPTO') {
    return isOptions ? 'CRYPTOOPT' : 'CRYPTOFUT';
  }
  return segmentUpper || 'NSEFUT';
}

export const DEFAULT_INSTRUMENT_SEGMENT_PROFILE = {
  enabled: true,
  exposureIntraday: 0,
  exposureCarryForward: 0,
  defaultIntradayOnly: false,
  allowLimitPendingOrders: true,
  commissionType: 'PER_LOT',
  commissionLot: 0,
  commissionUnit: 'INR',
  maxLots: 100,
  minLots: 1,
  lotSettings: { intradayLeverage: 1, carryForwardLeverage: 1, breakupLots: 0 },
  quantityModeSettings: {
    intradayLeverage: 1,
    carryForwardLeverage: 1,
    maxQuantity: 1000,
    minQuantity: 1,
    breakupQuantity: 0,
  },
  maxIntradayQty: 0,
  maxCarryQty: 0,
  superAdminIncentive: 0,
  superAdminBrokerageCharge: 0,
  superAdminIncentiveInCrore: 0,
  superAdminBrokerageChargeInCrore: 0,
  optionBuy: {
    allowed: true,
    commissionType: 'PER_LOT',
    commission: 0,
    strikeSelection: 50,
    maxExchangeLots: 100,
    intradayLeverage: 1,
    carryForwardLeverage: 1,
  },
  optionSell: {
    allowed: true,
    commissionType: 'PER_LOT',
    commission: 0,
    strikeSelection: 50,
    maxExchangeLots: 100,
    intradayLeverage: 1,
    carryForwardLeverage: 1,
  },
};
