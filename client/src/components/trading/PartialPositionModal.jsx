import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';

function fmtNum(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Circuit rules only for NSE / BSE / MCX — not crypto or forex. */
function isCryptoOrForexPosition(pos) {
  if (!pos) return false;
  if (pos.isCrypto === true || pos.exchange === 'BINANCE') return true;
  if (pos.isForex === true || pos.exchange === 'FOREX') return true;
  const seg = String(pos.segment || pos.displaySegment || '').toUpperCase();
  if (['CRYPTOFUT', 'CRYPTOOPT', 'CRYPTO', 'FOREXFUT', 'FOREXOPT', 'FOREX'].includes(seg)) return true;
  const pair = String(pos.pair || pos.symbol || '').toUpperCase();
  if (pair.endsWith('USDT')) return true;
  return false;
}

export default function PartialPositionModal({
  position,
  user,
  marketData,
  getUsdSpotBidAsk,
  onClose,
  onSuccess,
}) {
  const openQty = Number(position?.quantity) || 0;
  const [closeQty, setCloseQty] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [closeGate, setCloseGate] = useState({ checked: false, canClose: true, reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef(null);

  const legs =
    Array.isArray(position?._legs) && position._legs.length > 0
      ? position._legs
      : position?._id
        ? [{ _id: position._id, quantity: openQty }]
        : [];
  const tradeId = legs[0]?._id || position?._id;
  const isCryptoOrForex = isCryptoOrForexPosition(position);
  const applyIndianCircuit = !isCryptoOrForex;
  const isUsdSpot = isCryptoOrForex;

  const getExecutionBidAsk = useCallback(() => {
    // Crypto/forex can continue using existing quote helper behavior.
    if (isUsdSpot) return getUsdSpotBidAsk(marketData, position);

    const token = position?.token != null ? String(position.token) : null;
    const symbol = String(position?.symbol || '').toUpperCase();

    const asArray =
      Array.isArray(marketData)
        ? marketData
        : marketData && typeof marketData === 'object'
          ? Object.values(marketData)
          : [];

    const row = asArray.find((r) => {
      if (!r || typeof r !== 'object') return false;
      const rToken = r.token != null ? String(r.token) : null;
      const rSym = String(r.symbol || r.tradingSymbol || '').toUpperCase();
      return (token && rToken === token) || (symbol && rSym === symbol);
    });

    const bidPrice = Number(row?.rawBid ?? row?.bid ?? position?.lastBid ?? 0);
    const askPrice = Number(row?.rawAsk ?? row?.ask ?? position?.lastAsk ?? 0);

    // Avoid synthetic LTP fallback for circuit checks; keep zeros if side unavailable.
    return {
      bidPrice: Number.isFinite(bidPrice) && bidPrice > 0 ? bidPrice : 0,
      askPrice: Number.isFinite(askPrice) && askPrice > 0 ? askPrice : 0,
    };
  }, [isUsdSpot, getUsdSpotBidAsk, marketData, position]);

  const fetchPreview = useCallback(
    async (qty) => {
      if (!tradeId || !user?.token) return;
      const q = Number(qty);
      if (!Number.isFinite(q) || q <= 0 || q > openQty) {
        setPreview(null);
        setPreviewError(q > openQty ? `Max ${openQty}` : 'Enter quantity to close');
        return;
      }
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const { bidPrice, askPrice } = getExecutionBidAsk();
        const { data } = await axios.get(
          `/api/trading/positions/${tradeId}/partial-close/preview`,
          {
            params: { quantity: q, bidPrice, askPrice },
            headers: { Authorization: `Bearer ${user.token}` },
          }
        );
        setPreview(data);
        setCloseGate({
          checked: true,
          canClose: data?.canClose !== false,
          reason: data?.blockReason || '',
        });
      } catch (err) {
        setPreview(null);
        setPreviewError(err.response?.data?.message || 'Could not load preview');
      } finally {
        setPreviewLoading(false);
      }
    },
    [tradeId, user?.token, openQty, getExecutionBidAsk]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPreview(closeQty);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [closeQty, fetchPreview]);

  // Indian markets only: circuit warning before quantity input.
  useEffect(() => {
    if (!applyIndianCircuit) {
      setCloseGate({ checked: true, canClose: true, reason: '' });
      return;
    }
    const fetchCloseGate = async () => {
      if (!tradeId || !user?.token || !(openQty > 0)) return;
      try {
        const { bidPrice, askPrice } = getExecutionBidAsk();
        const { data } = await axios.get(
          `/api/trading/positions/${tradeId}/partial-close/preview`,
          {
            params: { quantity: Math.min(openQty, 1), bidPrice, askPrice },
            headers: { Authorization: `Bearer ${user.token}` },
          }
        );
        setCloseGate({
          checked: true,
          canClose: data?.canClose !== false,
          reason: data?.blockReason || '',
        });
      } catch {
        // keep silent; quantity-based preview flow will still handle API errors
      }
    };
    fetchCloseGate();
  }, [tradeId, user?.token, openQty, getExecutionBidAsk, applyIndianCircuit]);

  const closeQtyNum = Number(closeQty);
  const qtyValid =
    Number.isFinite(closeQtyNum) && closeQtyNum > 0 && closeQtyNum <= openQty;

  const circuitBlocksClose =
    applyIndianCircuit && (closeGate.canClose === false || preview?.canClose === false);

  const confirmDisabled =
    submitting ||
    previewLoading ||
    !qtyValid ||
    circuitBlocksClose ||
    (!isCryptoOrForex && !preview);

  const handleSubmit = async () => {
    const q = Number(closeQty);
    if (!Number.isFinite(q) || q <= 0) {
      setPreviewError('Enter a valid quantity');
      return;
    }
    const { bidPrice, askPrice } = getExecutionBidAsk();
    const payloadBase = {
      bidPrice,
      askPrice,
      isCrypto: !!(position?.isCrypto || position?.exchange === 'BINANCE'),
      isForex: !!(position?.isForex || position?.exchange === 'FOREX'),
    };
    setSubmitting(true);
    try {
      let remaining = q;
      for (const leg of legs) {
        if (remaining <= 0) break;
        const legId = leg._id;
        if (!legId) continue;
        const legQty = Number(leg.quantity) || 0;
        if (legQty <= 0) continue;
        const slice = Math.min(remaining, legQty);
        const isFullLeg = slice >= legQty - 1e-9;
        if (isFullLeg) {
          await axios.post(`/api/trading/close/${legId}`, payloadBase, {
            headers: { Authorization: `Bearer ${user.token}` },
          });
        } else {
          await axios.post(
            `/api/trading/positions/${legId}/partial-close`,
            { quantity: slice, ...payloadBase },
            { headers: { Authorization: `Bearer ${user.token}` } }
          );
        }
        remaining -= slice;
      }
      if (remaining > 1e-9) {
        setPreviewError('Could not close full quantity across fills');
        return;
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setPreviewError(err.response?.data?.message || 'Failed to close');
    } finally {
      setSubmitting(false);
    }
  };

  const setPct = (pct) => {
    const q = Math.max(0, Math.min(openQty, (openQty * pct) / 100));
    const rounded = openQty >= 1 && openQty % 1 === 0 ? Math.round(q) : Number(q.toFixed(4));
    setCloseQty(String(rounded > 0 ? rounded : ''));
  };

  const closeGateMessage =
    applyIndianCircuit &&
    (closeGate.reason ||
      (closeGate.canClose === false
        ? position?.side === 'SELL'
          ? 'Upper circuit is active. BUY side is unavailable, so close is blocked right now.'
          : 'Lower circuit is active. SELL side is unavailable, so close is blocked right now.'
        : ''));

  if (!position) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-dark-600 bg-dark-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-dark-600 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Partial close</h3>
            <p className="text-xs text-gray-400">
              {position.symbol}{' '}
              <span className={position.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                {position.side}
              </span>{' '}
              · open {openQty}
              {position._legCount > 1 ? (
                <span className="text-blue-400/90">
                  {' '}
                  · {position._legCount} fills · avg {fmtNum(position.entryPrice)}
                </span>
              ) : null}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {closeGate.checked && closeGateMessage && (
            <div className="rounded border border-amber-600/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
              {closeGateMessage}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-400">Quantity to close</label>
            <input
              type="number"
              min={0}
              max={openQty}
              step="any"
              value={closeQty}
              onChange={(e) => setCloseQty(e.target.value)}
              className="w-full rounded border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-white"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setPct(pct)}
                  className="rounded bg-dark-700 px-2 py-1 text-xs text-gray-300 hover:bg-dark-600"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {previewLoading && (
            <p className="text-xs text-gray-500">Updating margin preview…</p>
          )}

          {preview && !previewLoading && (
            <div className="rounded border border-dark-600 bg-dark-900/80 p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Remaining qty</span>
                <span className="text-white">{preview.remainingQuantity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Est. P&amp;L (wallet)</span>
                <span className={preview.walletPnL >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {preview.walletPnL >= 0 ? '+' : ''}
                  {fmtNum(preview.walletPnL)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Margin release</span>
                <span className="text-amber-300">{fmtNum(preview.marginRelease)}</span>
              </div>
              <hr className="border-dark-600" />
              <div className="flex justify-between">
                <span className="text-gray-400">Available (before)</span>
                <span>{fmtNum(preview.margin?.before?.available)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Used margin (before)</span>
                <span>{fmtNum(preview.margin?.before?.usedMargin)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-gray-300">Available (after)</span>
                <span className="text-emerald-400">{fmtNum(preview.margin?.after?.available)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-gray-300">Used margin (after)</span>
                <span className="text-emerald-400">{fmtNum(preview.margin?.after?.usedMargin)}</span>
              </div>
              {preview.willFullyClose && (
                <p className="text-amber-400/90">This will fully close the position.</p>
              )}
            </div>
          )}

          {previewError && !previewLoading && (
            <p className="text-xs text-red-400">{previewError}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-dark-600 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-dark-600 py-2 text-sm text-gray-300 hover:bg-dark-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={handleSubmit}
            className="flex-1 rounded bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Closing…' : 'Confirm close'}
          </button>
        </div>
      </div>
    </div>
  );
}
