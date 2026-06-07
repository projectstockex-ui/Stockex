import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bell, X } from 'lucide-react';
import {
  listActivePriceAlerts,
  markPriceAlertTriggered,
  dispatchPriceAlertFired,
  PRICE_ALERT_UPDATE_EVENT,
} from '../utils/priceAlertStorage';
import { resolveLtpForPriceAlert, isPriceAlertHit } from '../utils/priceAlertLtp';
import { playPriceAlertSound, speakPriceAlert } from '../utils/tradingAlertSound';

/**
 * Watches saved price alerts against live marketData ticks (works even when trading panel is closed).
 */
export default function PriceAlertMonitor({ marketData = {} }) {
  const { user } = useAuth();
  const userId = String(user?._id || user?.id || '');
  const prevLtpRef = useRef(new Map());
  const [toast, setToast] = useState(null);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(dismissToast, 8000);
    return () => clearTimeout(id);
  }, [toast, dismissToast]);

  useEffect(() => {
    if (!userId) return undefined;

    const checkAlerts = () => {
      const alerts = listActivePriceAlerts(userId);
      for (const alert of alerts) {
        if (alert.triggered || alert.enabled === false) continue;
        const key = alert.instrumentKey;
        const ltp = resolveLtpForPriceAlert(marketData, alert);
        if (ltp <= 0) continue;

        const prev = prevLtpRef.current.get(key) ?? ltp;
        prevLtpRef.current.set(key, ltp);

        if (!isPriceAlertHit(prev, ltp, alert.price)) continue;

        markPriceAlertTriggered(userId, key);
        playPriceAlertSound();
        const sym = alert.symbol || 'Price';
        const msg = `${sym} reached ${Number(alert.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        speakPriceAlert(msg);
        const detail = { ...alert, ltp, message: msg };
        dispatchPriceAlertFired(detail);
        setToast(detail);
      }
    };

    checkAlerts();

    const onUpdated = (e) => {
      if (e?.detail?.userId && String(e.detail.userId) !== userId) return;
      const alerts = listActivePriceAlerts(userId);
      const activeKeys = new Set(alerts.map((a) => a.instrumentKey));
      for (const k of [...prevLtpRef.current.keys()]) {
        if (!activeKeys.has(k)) prevLtpRef.current.delete(k);
      }
    };

    window.addEventListener(PRICE_ALERT_UPDATE_EVENT, onUpdated);
    return () => window.removeEventListener(PRICE_ALERT_UPDATE_EVENT, onUpdated);
  }, [marketData, userId]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[calc(100%-2rem)]">
      <div className="bg-amber-900/95 border border-amber-500 text-amber-50 px-4 py-3 rounded-lg shadow-xl flex items-start gap-3">
        <Bell size={20} className="text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Price Alert</div>
          <div className="text-sm text-amber-100">{toast.message}</div>
          <div className="text-xs text-amber-300/80 mt-1">
            LTP {Number(toast.ltp).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <button
          type="button"
          onClick={dismissToast}
          className="text-amber-300 hover:text-white shrink-0 p-1"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
