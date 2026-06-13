import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { acquireStockexSocket, releaseStockexSocket } from '../lib/stockexSocket';
import {
  triggerAutosquareSound,
  triggerMarginWarningSound,
  primeTradingSounds,
  playStopLossHitSound,
  playTargetHitSound,
} from '../utils/tradingAlertSound';

const AUTO_CLOSE_REASONS = new Set([
  'AUTO_SQUARE',
  'AUTO_SQUARE_330',
  'TIME_BASED',
  'EOD_SQUAREOFF',
  'RMS',
  'MARGIN_CALL',
  'STOP_OUT',
]);

function isEventForUser(data, myId) {
  if (!myId) return true;
  const target = data?.targetUserId ?? data?.userId;
  if (!target) return true;
  return String(target) === String(myId);
}

function isTradeClosedForUser(data, myId) {
  if (data?.type !== 'TRADE_CLOSED') return false;
  const reason = data?.trade?.closeReason;
  if (!AUTO_CLOSE_REASONS.has(reason)) return false;
  const tradeUser = data?.trade?.user;
  if (myId && tradeUser && String(tradeUser) !== String(myId)) return false;
  return true;
}

function isSlTpCloseForUser(data, myId) {
  if (data?.type !== 'TRADE_CLOSED') return false;
  const reason = data?.trade?.closeReason;
  if (reason !== 'STOP_LOSS' && reason !== 'TARGET') return false;
  const tradeUser = data?.trade?.user;
  if (myId && tradeUser && String(tradeUser) !== String(myId)) return false;
  return true;
}

/**
 * Real-time sound when available-margin autosquare closes positions.
 * Joins user socket room + listens for ledger_autosquare / auto trade close.
 */
export default function TradingSoundAlerts() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const onFirstTap = () => primeTradingSounds();
    window.addEventListener('pointerdown', onFirstTap, { once: true });
    return () => window.removeEventListener('pointerdown', onFirstTap);
  }, []);

  useEffect(() => {
    if (!user?.token || !location.pathname.startsWith('/user')) return undefined;

    const myId = String(user._id || user.id || '');
    const socket = acquireStockexSocket(user._id || user.id);

    const handleAutosquare = (data) => {
      if (!isEventForUser(data, myId)) return;
      triggerAutosquareSound();
      window.dispatchEvent(new CustomEvent('stockex:ledger-autosquare', { detail: data }));
    };

    const handleMarginWarning = (data) => {
      if (!isEventForUser(data, myId)) return;
      triggerMarginWarningSound();
      window.dispatchEvent(new CustomEvent('stockex:margin-warning', { detail: data }));
    };

    const onTradeUpdate = (data) => {
      if (isSlTpCloseForUser(data, myId)) {
        const reason = data?.trade?.closeReason;
        if (reason === 'STOP_LOSS') playStopLossHitSound();
        else if (reason === 'TARGET') playTargetHitSound();
        return;
      }
      if (isTradeClosedForUser(data, myId)) handleAutosquare(data);
    };

    socket.on('ledger_autosquare', handleAutosquare);
    socket.on('margin_call', handleMarginWarning);
    socket.on('trade_update', onTradeUpdate);

    return () => {
      socket.off('ledger_autosquare', handleAutosquare);
      socket.off('margin_call', handleMarginWarning);
      socket.off('trade_update', onTradeUpdate);
      releaseStockexSocket();
    };
  }, [user?.token, user?._id, user?.id, location.pathname]);

  return null;
}
