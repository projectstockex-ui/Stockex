/**
 * Binance crypto orders: quantity-only validation (exchange step/min/max + hierarchy bounds).
 * Hierarchy minLots / maxLots / orderLots are step multiples when a grid applies;
 * otherwise raw base quantity caps for spot-style rows without synced filters.
 */

import { orderIsCrypto } from './tradingUsdSpot.js';

export function isBinanceCryptoOrder(order) {
  const ex = String(order?.exchange || '').toUpperCase();
  return !!(orderIsCrypto(order) && ex === 'BINANCE');
}

export function qtyAlignedToExchangeStep(qty, step) {
  if (!Number.isFinite(step) || step <= 0) return true;
  if (!Number.isFinite(qty) || qty <= 0) return false;
  const ratio = qty / step;
  const rounded = Math.round(ratio);
  return Math.abs(ratio - rounded) < 1e-8;
}

function resolveMaxMinOrderSteps(segmentSettings, scriptSettings) {
  // For crypto qty mode: prefer quantityModeSettings over lotSettings
  const qtyMode = segmentSettings?.quantityModeSettings;
  const scrQtyMode = scriptSettings?.quantitySettings;

  // Max quantity: quantityModeSettings.maxQuantity > scriptSettings.quantitySettings.maxQuantity > lotSettings.maxLots > segmentSettings.maxLots
  const maxQtyFromQtyMode = qtyMode?.maxQuantity;
  const maxQtyFromScript = scrQtyMode?.maxQuantity || scrQtyMode?.perOrderQuantity;
  const maxLotsScr = scriptSettings?.lotSettings?.maxLots;
  const maxLotsSeg = segmentSettings?.maxLots;

  // Min quantity: quantityModeSettings.minQuantity > scriptSettings > segmentSettings.minLots
  const minQtyFromQtyMode = qtyMode?.minQuantity;
  const minQtyFromScript = scrQtyMode?.minQuantity;
  const minLotsScr = scriptSettings?.lotSettings?.minLots;
  const minLotsSeg = segmentSettings?.minLots;

  // Breakup/order quantity: quantityModeSettings.breakupQuantity > quantitySettings.breakupQuantity > orderLots
  const breakupFromQtyMode = qtyMode?.breakupQuantity;
  const breakupFromSeg = segmentSettings?.quantitySettings?.breakupQuantity;
  const orderLotsScr = scriptSettings?.lotSettings?.orderLots;
  const orderLotsSeg = segmentSettings?.orderLots;

  // Resolve max: prefer qty mode first (crypto uses qty, not lots)
  const maxLots =
    Number.isFinite(Number(maxQtyFromQtyMode)) && Number(maxQtyFromQtyMode) > 0
      ? Number(maxQtyFromQtyMode)
      : Number.isFinite(Number(maxQtyFromScript)) && Number(maxQtyFromScript) > 0
        ? Number(maxQtyFromScript)
        : Number.isFinite(Number(maxLotsScr)) && Number(maxLotsScr) > 0
          ? Number(maxLotsScr)
          : Number.isFinite(Number(maxLotsSeg)) && Number(maxLotsSeg) > 0
            ? Number(maxLotsSeg)
            : null;

  // Resolve min: prefer qty mode first
  const minLots =
    Number.isFinite(Number(minQtyFromQtyMode)) && Number(minQtyFromQtyMode) > 0
      ? Number(minQtyFromQtyMode)
      : Number.isFinite(Number(minQtyFromScript)) && Number(minQtyFromScript) > 0
        ? Number(minQtyFromScript)
        : Number.isFinite(Number(minLotsScr)) && Number(minLotsScr) > 0
          ? Number(minLotsScr)
          : Number.isFinite(Number(minLotsSeg)) && Number(minLotsSeg) > 0
            ? Number(minLotsSeg)
            : 1;

  // Resolve per-order cap (breakup qty): prefer qty mode breakup
  const orderLots =
    Number.isFinite(Number(breakupFromQtyMode)) && Number(breakupFromQtyMode) > 0
      ? Number(breakupFromQtyMode)
      : Number.isFinite(Number(breakupFromSeg)) && Number(breakupFromSeg) > 0
        ? Number(breakupFromSeg)
        : Number.isFinite(Number(orderLotsScr)) && Number(orderLotsScr) > 0
          ? Number(orderLotsScr)
          : Number.isFinite(Number(orderLotsSeg)) && Number(orderLotsSeg) > 0
            ? Number(orderLotsSeg)
            : null;

  const capSteps =
    maxLots != null && orderLots != null
      ? Math.min(maxLots, orderLots)
      : maxLots != null
        ? maxLots
        : orderLots != null
          ? orderLots
          : null;

  return { minSteps: minLots, capSteps };
}

/**
 * @throws {Error}
 */
export function assertBinanceCryptoQuantityValidated({
  symbol,
  qty,
  instrument,
  segmentSettings,
  scriptSettings,
}) {
  const label = symbol || 'symbol';
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`Enter a valid quantity for ${label}`);
  }

  const step =
    instrument && Number(instrument.lotSize) > 0 ? Number(instrument.lotSize) : null;
  const ds = String(instrument?.displaySegment || '').toUpperCase();
  const useStepGrid =
    step != null &&
    (instrument?.qtyFilterMin != null ||
      ds === 'CRYPTOFUT' ||
      ds === 'CRYPTOOPT' ||
      ((instrument?.instrumentType === 'FUTURES' || instrument?.instrumentType === 'OPTIONS') &&
        instrument?.exchange === 'BINANCE'));

  const { minSteps, capSteps } = resolveMaxMinOrderSteps(segmentSettings, scriptSettings);

  if (useStepGrid) {
    if (!qtyAlignedToExchangeStep(qty, step)) {
      throw new Error(`${label}: quantity must be a multiple of ${step} (exchange step size)`);
    }
    const qtyMinRaw =
      instrument?.qtyFilterMin != null ? Number(instrument.qtyFilterMin) : null;
    const exchMin =
      qtyMinRaw != null && Number.isFinite(qtyMinRaw) && qtyMinRaw > 0 ? qtyMinRaw : step;
    if (qty < exchMin - 1e-12) {
      throw new Error(`${label}: minimum quantity is ${exchMin}`);
    }
    const qtyMaxRaw =
      instrument?.qtyFilterMax != null ? Number(instrument.qtyFilterMax) : null;
    if (
      qtyMaxRaw != null &&
      Number.isFinite(qtyMaxRaw) &&
      qtyMaxRaw > 0 &&
      qty > qtyMaxRaw + 1e-12
    ) {
      throw new Error(`${label}: quantity exceeds exchange maximum (${qtyMaxRaw})`);
    }

    const steps = qty / step;
    if (steps + 1e-8 < minSteps) {
      throw new Error(
        `${label}: minimum ${minSteps} step(s) per order (≈ ${(minSteps * step).toFixed(8)} at step ${step})`
      );
    }
    if (capSteps != null && steps > capSteps + 1e-8) {
      throw new Error(
        `${label}: exceeds max ${capSteps} step(s) per order (≈ ${(capSteps * step).toFixed(8)} at step ${step})`
      );
    }
    return;
  }

  if (qty + 1e-8 < minSteps) {
    throw new Error(`${label}: minimum quantity is ${minSteps}`);
  }
  if (capSteps != null && qty > capSteps + 1e-12) {
    throw new Error(`${label}: maximum quantity per order is ${capSteps}`);
  }
}
