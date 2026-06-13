import React, { useState, useEffect } from 'react';
import { TrendingUp, X, RefreshCw } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { isNseCashMarketOpen, runZerodhaBackgroundSync } from '../utils';
import ZerodhaSyncProgressBar from './ZerodhaSyncProgressBar.jsx';

const MarketControl = () => {
  const { admin } = useAuth();
  const [marketState, setMarketState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [zerodhaStatus, setZerodhaStatus] = useState(null);
  const [zerodhaSyncJob, setZerodhaSyncJob] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [editingSegment, setEditingSegment] = useState(null);
  const [segmentForm, setSegmentForm] = useState({});

  useEffect(() => {
    fetchMarketState();
    fetchBrokerStatus();

    // Check URL params for Zerodha callback
    const params = new URLSearchParams(window.location.search);
    const zerodhaResult = params.get('zerodha');
    if (zerodhaResult === 'success' || zerodhaResult === 'connected') {
      window.history.replaceState({}, '', window.location.pathname);
      // Fetch status multiple times to ensure it's updated
      const refreshStatus = async () => {
        for (let i = 0; i < 3; i++) {
          await fetchBrokerStatus();
          await new Promise(r => setTimeout(r, 1000));
        }
        alert('Zerodha connected successfully!');
      };
      refreshStatus();
    } else if (zerodhaResult === 'error') {
      alert('Zerodha connection failed: ' + (params.get('message') || 'Unknown error'));
      window.history.replaceState({}, '', window.location.pathname);
    } else if (zerodhaResult === 'cancelled') {
      alert('Zerodha login was cancelled');
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Refresh broker status every 10 seconds
    const interval = setInterval(fetchBrokerStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchBrokerStatus = async () => {
    try {
      const { data } = await axios.get('/api/zerodha/status');
      setZerodhaStatus(data);
    } catch (error) {
      console.error('Error fetching broker status:', error);
    }
  };

  const fetchMarketState = async () => {
    try {
      const { data } = await axios.get('/api/trade/market-state');
      setMarketState(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMarket = async () => {
    setUpdating(true);
    try {
      const { data } = await axios.put('/api/trade/market-state', {
        isMarketOpen: !marketState.isMarketOpen
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMarketState(data);
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating market state');
    } finally {
      setUpdating(false);
    }
  };

  const toggleSegment = async (segment) => {
    try {
      const { data } = await axios.put(`/api/trade/market-state/segment/${segment}/toggle`, {}, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMarketState(data);
    } catch (error) {
      alert(error.response?.data?.message || 'Error toggling segment');
    }
  };

  const updateSegmentTimings = async (segment) => {
    try {
      const { data } = await axios.put(`/api/trade/market-state/segment/${segment}`, segmentForm, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMarketState(data);
      setEditingSegment(null);
      setSegmentForm({});
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating segment');
    }
  };

  const openEditModal = (segment) => {
    const seg = marketState.segments[segment];
    setSegmentForm({
      dataStartTime: seg.dataStartTime || '09:00',
      tradingStartTime: seg.tradingStartTime || '09:15',
      tradingEndTime: seg.tradingEndTime || '15:30',
      dataEndTime: seg.dataEndTime || '15:30',
      intradaySquareOffTime: seg.intradaySquareOffTime || '15:15',
      preMarketDataOnly: seg.preMarketDataOnly !== false,
      closedDays: seg.closedDays || [0, 6] // Default: Sunday and Saturday closed
    });
    setEditingSegment(segment);
  };

  const toggleClosedDay = (day) => {
    const currentDays = segmentForm.closedDays || [];
    if (currentDays.includes(day)) {
      setSegmentForm({ ...segmentForm, closedDays: currentDays.filter(d => d !== day) });
    } else {
      setSegmentForm({ ...segmentForm, closedDays: [...currentDays, day].sort() });
    }
  };

  const connectZerodha = async () => {
    try {
      const { data } = await axios.get('/api/zerodha/login-url', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      window.location.href = data.loginUrl;
    } catch (error) {
      alert(error.response?.data?.message || 'Error getting Zerodha login URL');
    }
  };

  const disconnectZerodha = async () => {
    try {
      await axios.post('/api/zerodha/logout', {}, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      fetchBrokerStatus();
      alert('Zerodha disconnected');
    } catch (error) {
      alert(error.response?.data?.message || 'Error disconnecting Zerodha');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin" size={32} /></div>;
  }

  const segments = ['EQUITY', 'FNO', 'MCX'];
  const segmentColors = {
    EQUITY: 'blue',
    FNO: 'purple',
    MCX: 'yellow'
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-6">Market Control</h1>

      {/* Broker Connections */}
      <div className="bg-dark-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Zerodha Kite Connect</h2>
        <p className="text-gray-400 text-sm mb-4">Connect to Zerodha Kite API for live market data feed</p>

        <div className="grid md:grid-cols-1 gap-4">
          <div className="bg-dark-700 rounded-lg p-4 border border-dark-600">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <TrendingUp className="text-blue-400" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">Zerodha Kite</h3>
                  <p className="text-xs text-gray-400">Kite Connect API</p>
                </div>
              </div>
              <div className={`px-2 py-1 rounded text-xs ${zerodhaStatus?.connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {zerodhaStatus?.connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
            {zerodhaStatus?.connected ? (
              <>
                <div className="text-xs text-gray-400 mb-3">User ID: {zerodhaStatus.userId}</div>
                <ZerodhaSyncProgressBar
                  job={zerodhaSyncJob}
                  hint={syncBusy ? 'Full reset takes 2–5 min. Use Sync Popular for a faster daily refresh.' : null}
                />
                <div className="flex gap-2 mb-2">
                  <button disabled={syncBusy} onClick={async (ev) => {
                    if (!confirm('This will DELETE all Zerodha instruments (NSE/NFO/MCX etc.) and resync from Kite. Crypto/Forex rows are kept. Continue?')) return;
                    const btn = ev.currentTarget;
                    btn.disabled = true;
                    setSyncBusy(true);
                    setZerodhaSyncJob({ progress: 0, message: 'Starting reset & sync…' });
                    try {
                      const data = await runZerodhaBackgroundSync(
                        admin.token,
                        '/api/zerodha/reset-and-sync',
                        { onProgress: setZerodhaSyncJob },
                      );
                      const countsStr = Object.entries(data.counts || {})
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n');
                      alert(
                        `${data.message}\n\nDeleted: ${data.deleted}\n\n${countsStr}\n\nAdded: ${data.added}\nTotal in DB: ${data.totalInDatabase}\nSubscribed: ${data.subscribedTokens ?? 0}`
                      );
                    } catch (error) {
                      alert(error.response?.data?.message || error.message || 'Error resetting');
                    } finally {
                      btn.disabled = false;
                      setSyncBusy(false);
                      setZerodhaSyncJob(null);
                    }
                  }} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm disabled:opacity-50">Reset & Sync</button>
                  <button disabled={syncBusy} onClick={async (ev) => {
                    const btn = ev.currentTarget;
                    btn.disabled = true;
                    setSyncBusy(true);
                    setZerodhaSyncJob({ progress: 0, message: 'Syncing popular instruments…' });
                    try {
                      const data = await runZerodhaBackgroundSync(
                        admin.token,
                        '/api/zerodha/sync-all-instruments',
                        { onProgress: setZerodhaSyncJob },
                      );
                      alert(`${data.message}\n\nAdded/Updated: ${data.added ?? data.inserted}\nTotal in DB: ${data.totalInDatabase}\nSubscribed: ${data.subscribedTokens ?? 0}`);
                    } catch (error) {
                      alert(error.response?.data?.message || error.message || 'Error syncing instruments');
                    } finally {
                      btn.disabled = false;
                      setSyncBusy(false);
                      setZerodhaSyncJob(null);
                    }
                  }} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded text-sm disabled:opacity-50">Sync Popular</button>
                </div>
                <div className="flex gap-2 mb-2">
                  <button onClick={async () => {
                    try {
                      const btn = document.activeElement;
                      btn.disabled = true;
                      btn.textContent = 'Subscribing...';
                      const { data } = await axios.post('/api/zerodha/subscribe-all', {}, { headers: { Authorization: `Bearer ${admin.token}` } });
                      alert(`${data.message}\n\nSubscribed: ${data.subscribed}\nTotal Active: ${data.total}\nRequested: ${data.requested}`);
                      btn.disabled = false;
                      btn.textContent = 'Subscribe All';
                    } catch (error) { 
                      alert(error.response?.data?.message || 'Error subscribing'); 
                      const btn = document.activeElement;
                      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe All'; }
                    }
                  }} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm disabled:opacity-50">Subscribe All</button>
                  <button onClick={async () => {
                    try {
                      const btn = document.activeElement;
                      btn.disabled = true;
                      btn.textContent = 'Syncing Lots...';
                      const { data } = await axios.post('/api/zerodha/sync-lot-sizes', {}, { headers: { Authorization: `Bearer ${admin.token}` } });
                      alert(`${data.message}\n\nUpdated: ${data.updated}\nNot Found: ${data.notFound}\nTotal: ${data.total}`);
                      btn.disabled = false;
                      btn.textContent = 'Sync Lot Sizes';
                    } catch (error) { 
                      alert(error.response?.data?.message || 'Error syncing lot sizes'); 
                      const btn = document.activeElement;
                      if (btn) { btn.disabled = false; btn.textContent = 'Sync Lot Sizes'; }
                    }
                  }} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-2 rounded text-sm disabled:opacity-50">Sync Lot Sizes</button>
                </div>
                <div className="flex gap-2 mb-2">
                  <button onClick={async () => {
                    try {
                      const { data } = await axios.get('/api/zerodha/subscription-status', { headers: { Authorization: `Bearer ${admin.token}` } });
                      alert(`WebSocket: ${data.connected ? 'Connected' : 'Disconnected'}\nSubscribed Tokens: ${data.subscribedTokens}\nTotal Enabled: ${data.totalEnabledInstruments}\nAll Subscribed: ${data.allSubscribed ? 'Yes' : 'No'}`);
                    } catch (error) { alert(error.response?.data?.message || 'Error fetching status'); }
                  }} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm">Check Status</button>
                  <button onClick={async () => {
                    const BATCH = 40;
                    const btn = document.activeElement;
                    try {
                      if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'Fetching...';
                      }
                      let offset = 0;
                      let totalOk = 0;
                      let totalErr = 0;
                      let total = null;
                      let hasMore = true;
                      while (hasMore) {
                        if (btn) {
                          btn.textContent =
                            total != null ? `Fetching... ${offset}/${total}` : 'Fetching...';
                        }
                        const prevOffset = offset;
                        const { data } = await axios.post(
                          '/api/zerodha/historical-bulk',
                          { interval: '15minute', offset, limit: BATCH },
                          { headers: { Authorization: `Bearer ${admin.token}` } }
                        );
                        totalOk += Number(data.success) || 0;
                        totalErr += Number(data.errors) || 0;
                        if (data.total != null) total = data.total;
                        hasMore = data.hasMore === true;
                        if (!hasMore) break;
                        offset =
                          data.nextOffset != null && Number.isFinite(Number(data.nextOffset))
                            ? Number(data.nextOffset)
                            : prevOffset + BATCH;
                        if (offset <= prevOffset) break;
                        await new Promise((r) => setTimeout(r, 100));
                      }
                      alert(
                        `Historical fetch complete.\n\nTotal success: ${totalOk}\nTotal errors: ${totalErr}` +
                          (total != null ? `\nInstruments: ${total}` : '')
                      );
                    } catch (error) {
                      alert(
                        error.response?.data?.message ||
                          error.message ||
                          'Error fetching historical data'
                      );
                    } finally {
                      if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Fetch Historical';
                      }
                    }
                  }} className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded text-sm disabled:opacity-50">Fetch Historical</button>
                </div>
                <button onClick={disconnectZerodha} className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm">Disconnect</button>
              </>
            ) : (
              <button onClick={connectZerodha} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm">Connect to Kite</button>
            )}
          </div>
        </div>

        <div className="mt-4 p-3 bg-dark-700 rounded-lg border border-dark-600">
          <h4 className="text-sm font-medium mb-2">Kite Connect Redirect URL</h4>
          <p className="text-xs text-gray-400 mb-2">Add this URL in your Kite Connect app settings:</p>
          <code className="block bg-dark-900 p-2 rounded text-xs text-green-400 break-all">
            {window.location.origin.replace(':3000', ':5001')}/api/zerodha/callback
          </code>
        </div>
      </div>

      {/* Main Market Switch */}
      <div className="bg-dark-800 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Global Market Status</h2>
            <p className="text-gray-400 text-sm mt-1">
              {marketState?.isMarketOpen ? 'Market is OPEN - Trading is allowed' : 'Market is CLOSED - Trading is disabled'}
            </p>
          </div>
          <button
            onClick={toggleMarket}
            disabled={updating}
            className={`px-8 py-4 rounded-lg text-lg font-bold transition ${marketState?.isMarketOpen ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {updating ? 'Updating...' : marketState?.isMarketOpen ? 'CLOSE MARKET' : 'OPEN MARKET'}
          </button>
        </div>
        <div className="mt-6 flex items-center gap-4">
          <div className={`w-4 h-4 rounded-full ${marketState?.isMarketOpen ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className={`text-lg font-bold ${marketState?.isMarketOpen ? 'text-green-400' : 'text-red-400'}`}>
            {marketState?.isMarketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
          </span>
        </div>
      </div>

      {/* Segment-wise Timing Controls */}
      <div className="bg-dark-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Segment Timings</h2>
        <p className="text-gray-400 text-sm mb-4">
          Configure market data and trading hours for each segment. Data can start before trading hours (pre-market data only mode).
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {segments.map(segment => {
            const seg = marketState?.segments?.[segment] || {};
            const color = segmentColors[segment];
            return (
              <div key={segment} className={`bg-dark-700 rounded-lg p-4 border ${seg.isOpen ? `border-${color}-500/50` : 'border-dark-600'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-${color}-400`}>{segment}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${seg.isOpen ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {seg.isOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(segment)}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                    >
                      Edit Timings
                    </button>
                    <button
                      onClick={() => toggleSegment(segment)}
                      className={`px-2 py-1 rounded text-xs ${seg.isOpen ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                      {seg.isOpen ? 'Close' : 'Open'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-dark-800 rounded p-2">
                    <div className="text-gray-500">Data Start</div>
                    <div className="font-mono text-blue-400">{seg.dataStartTime || '09:00'}</div>
                  </div>
                  <div className="bg-dark-800 rounded p-2">
                    <div className="text-gray-500">Trading Start</div>
                    <div className="font-mono text-green-400">{seg.tradingStartTime || '09:15'}</div>
                  </div>
                  <div className="bg-dark-800 rounded p-2">
                    <div className="text-gray-500">Trading End</div>
                    <div className="font-mono text-red-400">{seg.tradingEndTime || '15:30'}</div>
                  </div>
                  <div className="bg-dark-800 rounded p-2">
                    <div className="text-gray-500">Data End</div>
                    <div className="font-mono text-purple-400">{seg.dataEndTime || '15:30'}</div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                  Square-off: {seg.intradaySquareOffTime || '15:15'} | 
                  Pre-market data: {seg.preMarketDataOnly !== false ? 'Yes' : 'No'}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-xs text-gray-500">Closed:</span>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                    <span
                      key={index}
                      className={`w-5 h-5 flex items-center justify-center rounded text-xs ${
                        (seg.closedDays || [0, 6]).includes(index)
                          ? 'bg-red-600/30 text-red-400'
                          : 'bg-dark-600 text-gray-500'
                      }`}
                    >
                      {day}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-dark-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-blue-400">Pre-Market Data Mode</h3>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>📊 Market data is visible to users</li>
            <li>❌ Trading is NOT allowed</li>
            <li>⏰ Active between Data Start and Trading Start times</li>
            <li>💡 Users can analyze market before trading begins</li>
          </ul>
        </div>

        <div className="bg-dark-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-green-400">Trading Hours</h3>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>✅ Full trading allowed</li>
            <li>📊 Market data visible</li>
            <li>⏰ Active between Trading Start and Trading End</li>
            <li>🔄 Auto square-off at configured time</li>
          </ul>
        </div>
      </div>

      {/* Last Updated */}
      {marketState?.lastUpdatedAt && (
        <div className="text-sm text-gray-500">
          Last updated: {new Date(marketState.lastUpdatedAt).toLocaleString()}
        </div>
      )}

      {/* Edit Segment Modal */}
      {editingSegment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-bold">Edit {editingSegment} Timings</h2>
              <button onClick={() => setEditingSegment(null)}><X size={24} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Data Start Time</label>
                  <input
                    type="time"
                    step="1"
                    value={segmentForm.dataStartTime}
                    onChange={e => setSegmentForm({...segmentForm, dataStartTime: e.target.value})}
                    className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">When market data becomes visible (HH:MM:SS)</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Trading Start Time</label>
                  <input
                    type="time"
                    step="1"
                    value={segmentForm.tradingStartTime}
                    onChange={e => setSegmentForm({...segmentForm, tradingStartTime: e.target.value})}
                    className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">When trading is allowed (HH:MM:SS)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Trading End Time</label>
                  <input
                    type="time"
                    step="1"
                    value={segmentForm.tradingEndTime}
                    onChange={e => setSegmentForm({...segmentForm, tradingEndTime: e.target.value})}
                    className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">When trading stops (HH:MM:SS)</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Data End Time</label>
                  <input
                    type="time"
                    step="1"
                    value={segmentForm.dataEndTime}
                    onChange={e => setSegmentForm({...segmentForm, dataEndTime: e.target.value})}
                    className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">When market data stops (HH:MM:SS)</p>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Intraday Square-off Time</label>
                <input
                  type="time"
                  step="1"
                  value={segmentForm.intradaySquareOffTime}
                  onChange={e => setSegmentForm({...segmentForm, intradaySquareOffTime: e.target.value})}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">Auto square-off intraday positions (HH:MM:SS)</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="preMarketDataOnly"
                  checked={segmentForm.preMarketDataOnly}
                  onChange={e => setSegmentForm({...segmentForm, preMarketDataOnly: e.target.checked})}
                  className="w-4 h-4"
                />
                <label htmlFor="preMarketDataOnly" className="text-sm text-gray-400">
                  Enable pre-market data only mode (show data but no trading before trading start)
                </label>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Closed Days (Market closed on these days)</label>
                <div className="flex flex-wrap gap-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleClosedDay(index)}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                        (segmentForm.closedDays || []).includes(index)
                          ? 'bg-red-600 text-white'
                          : 'bg-dark-600 text-gray-400 hover:bg-dark-500'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">Click to toggle. Red = Market closed on that day</p>
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setEditingSegment(null)} className="flex-1 bg-dark-600 py-2 rounded">Cancel</button>
                <button onClick={() => updateSegmentTimings(editingSegment)} className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded">Save Timings</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketControl;
