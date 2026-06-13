/** Binance crypto client spread: $ per side widens bid (−) and ask (+) in USDT. */

export function pickCryptoUsdSpreadPerSide(segmentPermissions = {}) {
  for (const seg of ['CRYPTOFUT', 'CRYPTOOPT']) {
    const v = Number(segmentPermissions?.[seg]?.cryptoSpreadUsdPerSide);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

export function isBinanceCryptoInstrument(item) {
  return !!(item?.isCrypto || String(item?.exchange || '').toUpperCase() === 'BINANCE');
}

export function applyCryptoUsdSpreadPerSide(bidUsd, askUsd, usdPerSide) {
  const us = Number(usdPerSide);
  const b = Number(bidUsd);
  const a = Number(askUsd);
  if (!(us > 0) || !Number.isFinite(b) || !Number.isFinite(a)) {
    return { bidUsd: b, askUsd: a };
  }
  return { bidUsd: b - us, askUsd: a + us };
}

export function widenBinanceCryptoQuote(bidUsd, askUsd, segmentPermissions) {
  const spread = pickCryptoUsdSpreadPerSide(segmentPermissions);
  return applyCryptoUsdSpreadPerSide(bidUsd, askUsd, spread);
}
