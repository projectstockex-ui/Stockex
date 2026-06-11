import React, { useState, useEffect } from 'react';
import { normalizeCryptoIstClock24, formatStoredCryptoIstClock } from '../utils/cryptoUtils';

/** NSE/BSE (NSEFUT): IST session gates — Super Admin only. */
function NseBseSegmentAdminExtras({ slice, onFieldChange, segmentKey, canEdit = false }) {
  const [startDraft, setStartDraft] = useState(() =>
    formatStoredCryptoIstClock(slice?.nseStartTime || slice?.startTime)
  );
  const [closeDraft, setCloseDraft] = useState(() =>
    formatStoredCryptoIstClock(slice?.nseClosingTime || slice?.closingTime)
  );

  useEffect(() => {
    setStartDraft(formatStoredCryptoIstClock(slice?.nseStartTime || slice?.startTime));
  }, [slice?.nseStartTime, slice?.startTime]);

  useEffect(() => {
    setCloseDraft(formatStoredCryptoIstClock(slice?.nseClosingTime || slice?.closingTime));
  }, [slice?.nseClosingTime, slice?.closingTime]);

  if (!canEdit) return null;

  if (segmentKey !== 'NSEFUT') {
    return (
      <div className="mb-4 rounded-lg border border-dark-600 bg-dark-800/60 p-3">
        <p className="text-xs text-gray-400">NSE/BSE timing is managed in NSEFUT settings only.</p>
      </div>
    );
  }

  const commitStartBlur = () => {
    const n = normalizeCryptoIstClock24(startDraft);
    if (n === null) {
      setStartDraft(formatStoredCryptoIstClock(slice?.nseStartTime || slice?.startTime));
      return;
    }
    setStartDraft(n);
    const prev =
      slice?.nseStartTime != null
        ? String(slice.nseStartTime).trim()
        : slice?.startTime != null
          ? String(slice.startTime).trim()
          : '';
    if ((n || '') !== prev) onFieldChange('nseStartTime', n);
  };

  const commitCloseBlur = () => {
    const n = normalizeCryptoIstClock24(closeDraft);
    if (n === null) {
      setCloseDraft(formatStoredCryptoIstClock(slice?.nseClosingTime || slice?.closingTime));
      return;
    }
    setCloseDraft(n);
    const prev =
      slice?.nseClosingTime != null
        ? String(slice.nseClosingTime).trim()
        : slice?.closingTime != null
          ? String(slice.closingTime).trim()
          : '';
    if ((n || '') !== prev) {
      onFieldChange('nseClosingTime', n);
      if (!slice?.closingTime || String(slice.closingTime).trim() === '') {
        onFieldChange('closingTime', n);
      }
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-green-700/40 bg-dark-800/60 p-3 space-y-3">
      <p className="text-xs text-green-400/90">
        Super Admin only. Session times apply to this admin and all users/brokers below. End time triggers
        carry-forward + wallet update.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
        <div>
          <label className="block text-xs text-gray-400 mb-1">NSE/BSE start time (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="09:15:00"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={commitStartBlur}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">NSE/BSE session close (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="15:30:00"
            value={closeDraft}
            onChange={(e) => setCloseDraft(e.target.value)}
            onBlur={commitCloseBlur}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>
    </div>
  );
}

export default NseBseSegmentAdminExtras;
