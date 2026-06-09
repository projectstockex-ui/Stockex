import { COIN_SYMBOL } from '../utils/stockexCoins.js';



/** Stockex coin icon — replaces ₹ / IndianRupee in the UI */

export { COIN_SYMBOL };



export function StockexCoinSymbol({ size = 16, className = '' }) {

  const s = Number(size) || 16;

  return (

    <svg

      width={s}

      height={s}

      viewBox="0 0 24 24"

      className={`inline-block shrink-0 ${className}`.trim()}

      aria-hidden

    >

      <circle cx="12" cy="12" r="10" fill="#F59E0B" />

      <circle cx="12" cy="12" r="7.5" fill="#FBBF24" />

      <circle cx="8.5" cy="8.5" r="2" fill="#FDE68A" opacity="0.75" />

      <text

        x="12"

        y="16.5"

        textAnchor="middle"

        fontSize="9"

        fontWeight="700"

        fill="#78350F"

        fontFamily="system-ui, sans-serif"

      >

        S

      </text>

    </svg>

  );

}


