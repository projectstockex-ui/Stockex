import React from 'react';
import { formatZerodhaSyncProgress } from '../utils/tradingUtils';

/** Live progress bar shown while Zerodha background sync jobs run. */
export default function ZerodhaSyncProgressBar({ job, hint }) {
  if (!job) return null;

  const pct = Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
  const label = formatZerodhaSyncProgress(job);

  return (
    <div className="mb-3 rounded-lg border border-dark-600 bg-dark-900/80 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-gray-300">{label}</span>
        <span className="shrink-0 text-blue-400">{pct > 0 ? `${pct}%` : '…'}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-dark-600">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${Math.max(pct, 8)}%` }}
        />
      </div>
      {hint ? <p className="mt-2 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}
