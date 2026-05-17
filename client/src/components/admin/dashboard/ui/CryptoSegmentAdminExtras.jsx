import React, { useState, useEffect } from 'react';
import { normalizeCryptoIstClock24, formatStoredCryptoIstClock } from '../utils/cryptoUtils';

/** Crypto (CRYPTOFUT / CRYPTOOPT): IST session gates only — no lot↔qty mapping UI. */
function CryptoSegmentAdminExtras({ slice, onFieldChange }) {
  const [startDraft, setStartDraft] = useState(() => formatStoredCryptoIstClock(slice?.cryptoStartTime));
  const [closeDraft, setCloseDraft] = useState(() => formatStoredCryptoIstClock(slice?.cryptoClosingTime));

  useEffect(() => {
    setStartDraft(formatStoredCryptoIstClock(slice?.cryptoStartTime));
  }, [slice?.cryptoStartTime]);

  useEffect(() => {
    setCloseDraft(formatStoredCryptoIstClock(slice?.cryptoClosingTime));
  }, [slice?.cryptoClosingTime]);

  const commitStartBlur = () => {
    const n = normalizeCryptoIstClock24(startDraft);
    if (n === null) {
      setStartDraft(formatStoredCryptoIstClock(slice?.cryptoStartTime));
      return;
    }
    setStartDraft(n);
    const prev = slice?.cryptoStartTime != null ? String(slice.cryptoStartTime).trim() : '';
    if ((n || '') !== prev) onFieldChange('cryptoStartTime', n);
  };

  const commitCloseBlur = () => {
    const n = normalizeCryptoIstClock24(closeDraft);
    if (n === null) {
      setCloseDraft(formatStoredCryptoIstClock(slice?.cryptoClosingTime));
      return;
    }
    setCloseDraft(n);
    const prev = slice?.cryptoClosingTime != null ? String(slice.cryptoClosingTime).trim() : '';
    if ((n || '') !== prev) onFieldChange('cryptoClosingTime', n);
  };

  return (
    <div className="mb-4 rounded-lg border border-dark-600 bg-dark-800/60 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Crypto start time (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="00:00:00"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={commitStartBlur}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-[10px] text-gray-600 mt-1">
            Earliest time users may trade this segment (server-enforced). Leave empty for no start restriction.
          </p>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Crypto session close (IST, 24h HH:mm:ss)</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="23:59:59"
            value={closeDraft}
            onChange={(e) => setCloseDraft(e.target.value)}
            onBlur={commitCloseBlur}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-[10px] text-gray-600 mt-1">Optional daily square-off hint time (stored per segment).</p>
        </div>
      </div>
    </div>
  );
}

export default CryptoSegmentAdminExtras;
