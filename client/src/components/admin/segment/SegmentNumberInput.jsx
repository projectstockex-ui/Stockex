import React, { useState } from 'react';
import { numInputValue } from '../../../utils/segmentFormValues.js';

const PARTIAL_RE = /^-?\d*\.?\d*$/;

/**
 * Text-based numeric input: backspace works, empty stays empty, typing "600" is natural.
 */
export default function SegmentNumberInput({ value, onChange, className = '', integer = false }) {
  const [draft, setDraft] = useState(null);

  const committed = numInputValue(value);
  const display =
    draft !== null ? draft : committed === '' ? '' : String(committed);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw !== '' && !PARTIAL_RE.test(raw)) return;
    setDraft(raw);
    if (raw === '' || raw === '-' || raw === '.') {
      onChange(undefined);
      return;
    }
    const n = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isNaN(n)) onChange(n);
  };

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      className={className}
      value={display}
      onChange={handleChange}
      onBlur={() => setDraft(null)}
    />
  );
}
