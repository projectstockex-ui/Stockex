import React, { useEffect, useState } from 'react';

/**
 * Per-instrument % up/down from LTP (dynamic bracket for enrolled users).
 */
export default function InstrumentLtpBracketInputs({ inst, onSave, saving }) {
  const [up, setUp] = useState('');
  const [down, setDown] = useState('');

  useEffect(() => {
    const u = inst?.ltpBracketPercentUp;
    const d = inst?.ltpBracketPercentDown;
    setUp(u != null && u !== '' ? String(u) : '');
    setDown(d != null && d !== '' ? String(d) : '');
  }, [inst?._id, inst?.ltpBracketPercentUp, inst?.ltpBracketPercentDown]);

  const commit = () => {
    onSave(inst._id, {
      ltpBracketPercentUp: up.trim() === '' ? null : parseFloat(up),
      ltpBracketPercentDown: down.trim() === '' ? null : parseFloat(down),
    });
  };

  const disabled = saving === inst._id;
  const ltp = Number(inst?.ltp) || 0;
  const upN = parseFloat(up);
  const downN = parseFloat(down);
  const preview =
    ltp > 0 && Number.isFinite(upN) && upN > 0 && Number.isFinite(downN) && downN > 0
      ? {
          lower: ltp * (1 - downN / 100),
          upper: ltp * (1 + upN / 100),
        }
      : null;

  return (
    <div className="flex flex-col gap-1 min-w-[7rem]">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 w-8">%↑</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={up}
          onChange={(e) => setUp(e.target.value)}
          onBlur={commit}
          disabled={disabled}
          placeholder="—"
          className="w-14 bg-dark-700 border border-dark-600 rounded px-1 py-0.5 text-xs"
          title="% up from current LTP"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 w-8">%↓</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={down}
          onChange={(e) => setDown(e.target.value)}
          onBlur={commit}
          disabled={disabled}
          placeholder="—"
          className="w-14 bg-dark-700 border border-dark-600 rounded px-1 py-0.5 text-xs"
          title="% down from current LTP"
        />
      </div>
      {preview ? (
        <span className="text-[9px] text-amber-400/90 font-mono">
          {preview.lower.toFixed(0)}–{preview.upper.toFixed(0)}
        </span>
      ) : (
        <span className="text-[9px] text-gray-600">empty = off</span>
      )}
    </div>
  );
}
