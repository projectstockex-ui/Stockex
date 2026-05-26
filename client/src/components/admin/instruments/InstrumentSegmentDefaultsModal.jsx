import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import axios from '../../../config/axios.js';
import AdminSegmentDefaultsFields from './AdminSegmentDefaultsFields.jsx';
import { normalizeMongoMapOfObjects } from '../dashboard/utils/dataUtils.js';

/**
 * Super Admin: segment defaults (Hierarchy-style) for Instruments → Market Select → Rules.
 */
export default function InstrumentSegmentDefaultsModal({
  open,
  onClose,
  segmentKey,
  categoryLabel = '',
  adminToken,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [allDefaults, setAllDefaults] = useState({});
  const [slice, setSlice] = useState({});

  useEffect(() => {
    if (!open || !segmentKey || !adminToken) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMessage('');
      try {
        const { data } = await axios.get('/api/admin/manage/system-settings', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (cancelled) return;
        const map = normalizeMongoMapOfObjects(data.adminSegmentDefaults);
        setAllDefaults(map);
        setSlice(map[segmentKey] ? { ...map[segmentKey] } : {});
      } catch (err) {
        if (!cancelled) {
          setMessage(err.response?.data?.message || 'Failed to load segment settings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, segmentKey, adminToken]);

  const handleSave = async () => {
    if (!adminToken || !segmentKey) return;
    setSaving(true);
    setMessage('');
    try {
      const cloneJson = (x) => {
        try {
          return structuredClone(x);
        } catch {
          return JSON.parse(JSON.stringify(x ?? {}));
        }
      };
      const merged = { ...allDefaults, [segmentKey]: cloneJson(slice) };
      await axios.put(
        '/api/admin/manage/system-settings',
        { adminSegmentDefaults: merged },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      setAllDefaults(merged);
      setMessage('Saved. New admins and hierarchy inherit these segment defaults.');
      setTimeout(() => onClose?.(), 600);
    } catch (err) {
      setMessage(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title = categoryLabel
    ? `${segmentKey} — ${categoryLabel}`
    : segmentKey;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Segment defaults — {title}</h2>
            <p className="text-xs text-gray-500 mt-1">
              Same fields as Hierarchy → Settings. Applies to this segment for the platform (not per contract).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-dark-700 text-gray-400"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
          ) : (
            <AdminSegmentDefaultsFields
              segmentKey={segmentKey}
              slice={slice}
              onChange={setSlice}
            />
          )}
          {message ? (
            <p
              className={`mt-4 text-sm ${message.includes('Saved') ? 'text-green-400' : 'text-red-400'}`}
            >
              {message}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-dark-600 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save segment defaults'}
          </button>
        </div>
      </div>
    </div>
  );
}
