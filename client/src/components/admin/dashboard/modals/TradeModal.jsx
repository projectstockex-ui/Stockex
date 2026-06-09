import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import axios from '../../../../config/axios';

const TradeModal = ({ 
  instrument, 
  isSuperAdmin, 
  admins, 
  users,
  selectedAdmin,
  setSelectedAdmin,
  selectedUser, 
  setSelectedUser,
  userSearch,
  setUserSearch,
  filteredUsers,
  token, 
  onClose, 
  onSuccess,
  fetchUsersByAdmin
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [priceMode, setPriceMode] = useState('MANUAL'); // MARKET or MANUAL - default to MANUAL since live data may not be available
  const [livePrice, setLivePrice] = useState(instrument.lastPrice || instrument.ltp || 0);
  const [priceLoading, setPriceLoading] = useState(true);
  const [lots, setLots] = useState(1);

  // Always use lot size from DB (no hardcoded fallbacks)
  const getLotSizeForInstrument = () => instrument.lotSize || 1;
  const lotSize = getLotSizeForInstrument();
  const calculatedQuantity = lots * lotSize;

  // Check if this is NSE segment (quantity-based) or other segments (lot-based)
  const segment = instrument.displaySegment || instrument.segment || 'NSE';
  const isNSE = segment === 'NSE' || segment === 'NSE SPOT' || segment.includes('NSE') && !segment.includes('F&O');
  const isLotBased = !isNSE; // MCX, F&O, Currency, etc. are lot-based

  const [formData, setFormData] = useState({
    side: 'BUY',
    productType: 'INTRADAY',
    quantity: lotSize,
    entryPrice: '',
    tradeDate: new Date().toISOString().split('T')[0],
    tradeTime: new Date().toTimeString().slice(0, 5)
  });

  // Fetch live price from market data API
  useEffect(() => {
    const fetchLivePrice = async () => {
      setPriceLoading(true);
      try {
        const { data } = await axios.get('/api/zerodha/market-data', {
          headers: { Authorization: `Bearer ${token}` }
        });

        // Find price for this instrument by token
        const instrumentToken = instrument.token?.toString();
        if (instrumentToken && data[instrumentToken]) {
          const price = data[instrumentToken].ltp || data[instrumentToken].last_price || 0;
          setLivePrice(price);
          if (priceMode === 'MARKET' && price > 0) {
            setFormData(prev => ({ ...prev, entryPrice: price }));
          }
        } else {
          // Try to find by any matching token
          const foundPrice = Object.values(data).find(d => 
            d.symbol === instrument.symbol || d.tradingSymbol === instrument.tradingSymbol
          );
          if (foundPrice) {
            const price = foundPrice.ltp || foundPrice.last_price || 0;
            setLivePrice(price);
            if (priceMode === 'MARKET' && price > 0) {
              setFormData(prev => ({ ...prev, entryPrice: price }));
            }
          }
        }
      } catch (err) {
        console.log('Could not fetch live price:', err.message);
      } finally {
        setPriceLoading(false);
      }
    };

    fetchLivePrice();

    // Refresh price every 5 seconds if in MARKET mode
    const interval = setInterval(() => {
      if (priceMode === 'MARKET') {
        fetchLivePrice();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [instrument, token]);

  // Update quantity when lots change
  useEffect(() => {
    setFormData(prev => ({ ...prev, quantity: calculatedQuantity }));
  }, [lots, calculatedQuantity]);

  // Update entry price when price mode changes to MARKET
  useEffect(() => {
    if (priceMode === 'MARKET' && livePrice > 0) {
      setFormData(prev => ({ ...prev, entryPrice: livePrice }));
    }
  }, [priceMode, livePrice]);

  const handleAdminChange = (adminCode) => {
    setSelectedAdmin(adminCode);
    setSelectedUser(null);
    setUserSearch('');
    if (adminCode) {
      fetchUsersByAdmin(adminCode);
    }
  };

  const [inputMode, setInputMode] = useState('lots'); // 'lots' or 'quantity'
  const [quantityInput, setQuantityInput] = useState(lotSize);

  const handleLotsChange = (value) => {
    const newLots = Math.max(1, parseInt(value) || 1);
    setLots(newLots);
    setQuantityInput(newLots * lotSize);
    setInputMode('lots');
  };

  const handleQuantityChange = (value) => {
    const newQty = Math.max(1, parseInt(value) || 1);
    setQuantityInput(newQty);
    // Calculate lots (round to nearest lot)
    const calculatedLots = Math.max(1, Math.round(newQty / lotSize));
    setLots(calculatedLots);
    setInputMode('quantity');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedUser) return setError('Please select a user');
    const finalPrice = priceMode === 'MARKET' ? livePrice : Number(formData.entryPrice);
    if (!finalPrice || finalPrice <= 0) return setError('Please enter valid entry price');

    // Use quantity based on segment type
    // NSE: always use quantityInput directly
    // MCX/F&O/Currency: use lots calculation or quantityInput based on inputMode
    const finalQuantity = isNSE ? quantityInput : (inputMode === 'lots' ? calculatedQuantity : quantityInput);
    if (!finalQuantity || finalQuantity <= 0) return setError('Please enter valid quantity');

    setLoading(true);
    setError('');
    try {
      await axios.post('/api/trade/admin/create-trade', {
        userId: selectedUser._id,
        symbol: instrument.tradingSymbol || instrument.symbol,
        instrumentToken: instrument.token,
        segment: instrument.displaySegment || instrument.segment || 'NSE',
        side: formData.side,
        productType: formData.productType,
        orderType: priceMode, // MARKET, LIMIT, or MANUAL
        quantity: finalQuantity,
        entryPrice: finalPrice,
        tradeDate: formData.tradeDate,
        tradeTime: formData.tradeTime
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Error creating trade');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-dark-800 p-4 border-b border-dark-600 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Place Trade</h2>
            <div className="text-sm text-gray-400">
              {instrument.tradingSymbol || instrument.symbol} • {instrument.displaySegment || instrument.segment}
              {lotSize > 1 && <span className="ml-2 text-yellow-400">(Lot: {lotSize})</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>

        {/* Live Price Display */}
        <div className="px-4 pt-4">
          <div className="bg-dark-700 rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400">Live Price {priceLoading && <RefreshCw size={10} className="inline animate-spin ml-1" />}</div>
              <div className={`text-xl font-bold ${livePrice > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                {livePrice > 0 ? `${livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Not Available'}
              </div>
              {livePrice === 0 && !priceLoading && (
                <div className="text-xs text-yellow-500">Use Manual mode to enter price</div>
              )}
            </div>
            <div className="text-right">
              {isLotBased ? (
                <>
                  <div className="text-xs text-gray-400">Lot Size</div>
                  <div className="text-lg font-semibold">{lotSize}</div>
                </>
              ) : (
                <>
                  <div className="text-xs text-gray-400">Trade Type</div>
                  <div className="text-sm font-semibold text-blue-400">Quantity Based</div>
                </>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-2 rounded">{error}</div>}

          {/* Super Admin: Select Admin */}
          {isSuperAdmin && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Select Admin</label>
              <select
                value={selectedAdmin}
                onChange={(e) => handleAdminChange(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              >
                <option value="">All Admins</option>
                {admins.map(adm => (
                  <option key={adm._id} value={adm.adminCode}>
                    {adm.name || adm.username} ({adm.adminCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* User Selection */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Select User *</label>
            <input
              type="text"
              placeholder="Search by name or ID..."
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); if (selectedUser) setSelectedUser(null); }}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 mb-2"
            />
            {userSearch && !selectedUser && filteredUsers.length > 0 && (
              <div className="bg-dark-700 border border-dark-600 rounded max-h-40 overflow-y-auto">
                {filteredUsers.map(u => (
                  <div
                    key={u._id}
                    onClick={() => setSelectedUser(u)}
                    className="px-3 py-2 hover:bg-dark-600 cursor-pointer"
                  >
                    <div className="font-medium">{u.fullName || u.username}</div>
                    <div className="text-xs text-gray-400">@{u.username} • {u.userId} {isSuperAdmin && `• ${u.adminCode}`}</div>
                  </div>
                ))}
              </div>
            )}
            {selectedUser && (
              <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                <div>
                  <span className="text-green-400">{selectedUser.fullName || selectedUser.username}</span>
                  {isSuperAdmin && <span className="text-xs text-gray-400 ml-2">({selectedUser.adminCode})</span>}
                </div>
                <button type="button" onClick={() => { setSelectedUser(null); setUserSearch(''); }} className="text-gray-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Side & Product Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Side *</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, side: 'BUY' })}
                  className={`flex-1 py-2 rounded font-medium ${formData.side === 'BUY' ? 'bg-green-600' : 'bg-dark-700'}`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, side: 'SELL' })}
                  className={`flex-1 py-2 rounded font-medium ${formData.side === 'SELL' ? 'bg-red-600' : 'bg-dark-700'}`}
                >
                  SELL
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Product Type *</label>
              <select
                value={formData.productType}
                onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              >
                <option value="INTRADAY">INTRADAY</option>
                <option value="DELIVERY">DELIVERY</option>
                <option value="CARRYFORWARD">CARRYFORWARD</option>
              </select>
            </div>
          </div>

          {/* Price Mode Toggle */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Order Type *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => livePrice > 0 && setPriceMode('MARKET')}
                disabled={livePrice === 0}
                className={`flex-1 py-2 rounded font-medium text-sm ${priceMode === 'MARKET' ? 'bg-blue-600' : 'bg-dark-700'} ${livePrice === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                MARKET
              </button>
              <button
                type="button"
                onClick={() => setPriceMode('LIMIT')}
                className={`flex-1 py-2 rounded font-medium text-sm ${priceMode === 'LIMIT' ? 'bg-orange-600' : 'bg-dark-700'}`}
              >
                LIMIT
              </button>
              <button
                type="button"
                onClick={() => setPriceMode('MANUAL')}
                className={`flex-1 py-2 rounded font-medium text-sm ${priceMode === 'MANUAL' ? 'bg-purple-600' : 'bg-dark-700'}`}
              >
                MANUAL
              </button>
            </div>
          </div>

          {/* Lots & Quantity - Show based on segment type */}
          {isLotBased ? (
            /* MCX, F&O, Currency - Show Lots and Quantity (bidirectional) */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Lots * {inputMode === 'lots' && <span className="text-green-400 text-xs">(Active)</span>}
                </label>
                <input
                  type="number"
                  value={lots}
                  onChange={(e) => handleLotsChange(e.target.value)}
                  className={`w-full bg-dark-700 border rounded px-3 py-2 ${inputMode === 'lots' ? 'border-green-500' : 'border-dark-600'}`}
                  min="1"
                />
                {inputMode === 'quantity' && (
                  <div className="text-xs text-gray-500 mt-1">= {lots} lots (rounded)</div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Quantity * {inputMode === 'quantity' && <span className="text-green-400 text-xs">(Active)</span>}
                </label>
                <input
                  type="number"
                  value={inputMode === 'lots' ? calculatedQuantity : quantityInput}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  className={`w-full bg-dark-700 border rounded px-3 py-2 ${inputMode === 'quantity' ? 'border-green-500' : 'border-dark-600'}`}
                  min="1"
                />
                {inputMode === 'lots' && lotSize > 1 && (
                  <div className="text-xs text-gray-500 mt-1">= {lots} × {lotSize}</div>
                )}
              </div>
            </div>
          ) : (
            /* NSE - Only show Quantity field */
            <div>
              <label className="block text-sm text-gray-400 mb-1">Quantity *</label>
              <input
                type="number"
                value={quantityInput}
                onChange={(e) => handleQuantityChange(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                min="1"
                placeholder="Enter quantity"
              />
            </div>
          )}

          {/* Entry Price */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Entry Price * 
              {priceMode === 'MARKET' && <span className="text-blue-400 ml-1">(Market Price)</span>}
              {priceMode === 'LIMIT' && <span className="text-orange-400 ml-1">(Limit Price)</span>}
              {priceMode === 'MANUAL' && <span className="text-purple-400 ml-1">(Manual Entry)</span>}
            </label>
            {priceMode === 'MARKET' ? (
              <div className="w-full bg-dark-600 border border-blue-500/50 rounded px-3 py-2 text-green-400 font-medium">
                {livePrice > 0 ? livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
              </div>
            ) : (
              <input
                type="number"
                step="0.01"
                value={formData.entryPrice}
                onChange={(e) => setFormData({ ...formData, entryPrice: e.target.value })}
                className={`w-full bg-dark-700 border rounded px-3 py-2 ${priceMode === 'LIMIT' ? 'border-orange-500/50' : 'border-dark-600'}`}
                placeholder={priceMode === 'LIMIT' ? 'Enter limit price' : 'Enter manual price'}
                required
              />
            )}
            {priceMode === 'LIMIT' && livePrice > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                Current market: {livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Trade Date</label>
              <input
                type="date"
                value={formData.tradeDate}
                onChange={(e) => setFormData({ ...formData, tradeDate: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Trade Time</label>
              <input
                type="time"
                value={formData.tradeTime}
                onChange={(e) => setFormData({ ...formData, tradeTime: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 hover:bg-dark-500 py-2 rounded">Cancel</button>
            <button 
              type="submit" 
              disabled={loading || !selectedUser} 
              className={`flex-1 py-2 rounded font-medium disabled:opacity-50 ${formData.side === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {loading ? 'Placing...' : `${formData.side} ${instrument.tradingSymbol || instrument.symbol}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TradeModal;
