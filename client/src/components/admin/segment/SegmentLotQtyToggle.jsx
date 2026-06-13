/**
 * Lot / Qty segment mode switch — off state stays visible on dark admin panels.
 */
export default function SegmentLotQtyToggle({ enabled, variant = 'lot', onToggle, className = '' }) {
  const isLot = variant === 'lot';
  const trackOn = isLot
    ? 'bg-yellow-600 border-yellow-400/80 shadow-yellow-900/30'
    : 'bg-blue-600 border-blue-400/80 shadow-blue-900/30';
  const trackOff =
    'bg-slate-500 border-slate-300/70 shadow-inner ring-1 ring-inset ring-white/10 hover:bg-slate-400/90';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled === true}
      onClick={onToggle}
      className={`w-12 h-6 rounded-full p-1 border transition-all shrink-0 shadow-sm ${
        enabled ? trackOn : trackOff
      } ${className}`}
    >
      <div
        className={`w-4 h-4 rounded-full shadow-md transition-transform ${
          enabled ? 'translate-x-6 bg-white' : 'translate-x-0 bg-gray-100'
        }`}
      />
    </button>
  );
}
