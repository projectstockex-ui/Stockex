import React, { useState, useEffect } from 'react';
import { normalizeCryptoIstClock24, formatStoredCryptoIstClock } from '../utils/cryptoUtils';

/** MCX (MCXFUT): IST session gates — Super Admin only. */
function McxSegmentAdminExtras({ slice, onFieldChange, segmentKey, canEdit = false }) {
  const [startDraft, setStartDraft] = useState(() =>
    formatStoredCryptoIstClock(slice?.mcxStartTime || slice?.startTime)
  );
  const [closeDraft, setCloseDraft] = useState(() =>
    formatStoredCryptoIstClock(slice?.mcxClosingTime || slice?.closingTime)
  );

  useEffect(() => {
    setStartDraft(formatStoredCryptoIstClock(slice?.mcxStartTime || slice?.startTime));
  }, [slice?.mcxStartTime, slice?.startTime]);

  useEffect(() => {
    setCloseDraft(formatStoredCryptoIstClock(slice?.mcxClosingTime || slice?.closingTime));
  }, [slice?.mcxClosingTime, slice?.closingTime]);

  if (!canEdit) return null;

  if (segmentKey === 'MCXOPT') {
    return (
      <div className="mb-4 rounded-lg border border-dark-600 bg-dark-800/60 p-3">
        <p className="text-xs text-gray-400">MCX timing is managed in MCXFUT settings only.</p>
      </div>
    );
  }

  const commitStartBlur = () => {
    const n = normalizeCryptoIstClock24(startDraft);
    if (n === null) {
      setStartDraft(formatStoredCryptoIstClock(slice?.mcxStartTime || slice?.startTime));
      return;
    }
    setStartDraft(n);
    const prev =
      slice?.mcxStartTime != null
        ? String(slice.mcxStartTime).trim()
        : slice?.startTime != null
          ? String(slice.startTime).trim()
          : '';
    if ((n || '') !== prev) onFieldChange('mcxStartTime', n);
  };

  const commitCloseBlur = () => {
    const n = normalizeCryptoIstClock24(closeDraft);
    if (n === null) {
      setCloseDraft(formatStoredCryptoIstClock(slice?.mcxClosingTime || slice?.closingTime));
      return;
    }
    setCloseDraft(n);
    const prev =
      slice?.mcxClosingTime != null
        ? String(slice.mcxClosingTime).trim()
        : slice?.closingTime != null
          ? String(slice.closingTime).trim()
          : '';
    if ((n || '') !== prev) {
      onFieldChange('mcxClosingTime', n);
      if (!slice?.closingTime || String(slice.closingTime).trim() === '') {
        onFieldChange('closingTime', n);
      }
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-yellow-700/40 bg-dark-800/60 p-3 space-y-3">
      <p className="text-xs text-yellow-400/90">
        Super Admin only. Session times apply to this admin and all users/brokers below. End time triggers
        carry-forward + wallet update.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
        <div>
          <label className="block text-xs text-gray-400 mb-1">MCX start time (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="09:00:00"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={commitStartBlur}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">MCX session close (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="23:30:00"
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

export default McxSegmentAdminExtras;
