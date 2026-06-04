import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { getRuntimeSocketUrl, getSocketClientOptions } from '../lib/runtimeApiUrl';
import { triggerAutosquareSound, primeTradingSounds } from '../utils/tradingAlertSound';

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
    const socket = io(getRuntimeSocketUrl(), getSocketClientOptions());

    const handleAutosquare = (data) => {
      if (!isEventForUser(data, myId)) return;
      triggerAutosquareSound();
      window.dispatchEvent(new CustomEvent('stockex:ledger-autosquare', { detail: data }));
    };

    socket.on('connect', () => {
      if (myId) socket.emit('register_user', myId);
    });

    socket.on('ledger_autosquare', handleAutosquare);
    socket.on('trade_update', (data) => {
      if (isTradeClosedForUser(data, myId)) handleAutosquare(data);
    });

    return () => {
      socket.off('ledger_autosquare', handleAutosquare);
      socket.disconnect();
    };
  }, [user?.token, user?._id, user?.id, location.pathname]);

  return null;
}
