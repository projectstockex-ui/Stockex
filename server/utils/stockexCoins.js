/** Stockex coin symbol — replaces ₹ in API messages */



export const COIN_SYMBOL = '◉';



export function formatCoins(amount, options = {}) {

  const {

    minDecimals = 2,

    maxDecimals = 2,

    withSymbol = true,

    withSuffix = false,

    showPlus = false,

    suffix = 'Coins',

  } = options;

  const n = Number(amount);

  if (!Number.isFinite(n)) {

    return withSymbol ? `${COIN_SYMBOL}0` : withSuffix ? `0 ${suffix}` : '0';

  }

  const abs = Math.abs(n).toLocaleString('en-IN', {

    minimumFractionDigits: minDecimals,

    maximumFractionDigits: maxDecimals,

  });

  const sign = n < 0 ? '-' : showPlus && n > 0 ? '+' : '';

  if (withSymbol) return `${sign}${COIN_SYMBOL}${abs}`;

  if (withSuffix) return `${sign}${abs} ${suffix}`;

  return `${sign}${abs}`;

}



export function formatCoinsSigned(amount, options = {}) {

  const n = Number(amount) || 0;

  return formatCoins(n, { ...options, showPlus: n > 0 });

}


