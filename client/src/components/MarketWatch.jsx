import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, RefreshCw, TrendingUp, TrendingDown, Star } from 'lucide-react';

const MarketWatch = ({ user, onSelectInstrument, onQuickTrade, marketData, mergeMarketDataPatch }) => {
  const [instruments, setInstruments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const categories = ['ALL', 'INDICES', 'NIFTY', 'BANKNIFTY', 'STOCKS'];

  useEffect(() => {
    fetchInstruments();
    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchInstruments, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchInstruments = async () => {
    try {
      const { data } = await axios.get('/api/instruments/public');
      setInstruments(data.instruments || []);
    } catch (error) {
      console.error('Error fetching instruments:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchInstruments();
  };

  const filteredInstruments = instruments.filter(inst => {
    const matchesSearch = !search || 
      inst.symbol.toLowerCase().includes(search.toLowerCase()) ||
      inst.name.toLowerCase().includes(search.toLowerCase());
    
    const matchesCategory = activeCategory === 'ALL' || inst.category === activeCategory;
    
    return matchesSearch && matchesCategory;
  });

  const handleInstrumentClick = (instrument) => {
    if (onSelectInstrument) {
      onSelectInstrument(instrument);
    }
  };

  // Get live price from marketData
  const getLivePrice = (instrument) => {
    if (!marketData || !instrument) return null;
    
    // Try to find live data by token, symbol, or tradingSymbol
    const tokenKey = String(instrument.token || '').trim();
    const symbolKey = String(instrument.symbol || '').trim();
    const tradingSymbolKey = String(instrument.tradingSymbol || '').trim();
    
    const liveData = marketData[tokenKey] || 
                   marketData[symbolKey] || 
                   marketData[tradingSymbolKey] ||
                   Object.values(marketData).find(d => 
                     d.tradingsymbol === tradingSymbolKey || 
                     d.symbol === symbolKey
                   );
    
    return liveData;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-800">
      {/* Search */}
      <div className="p-2 border-b border-dark-600">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-dark-700 border border-dark-600 rounded pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:border-green-500"
          />
          <button 
            onClick={handleRefresh}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-dark-600 overflow-x-auto scrollbar-hide">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition ${
              activeCategory === cat 
                ? 'text-green-400 border-b-2 border-green-400' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Instruments List */}
      <div className="flex-1 overflow-y-auto">
        {filteredInstruments.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No instruments found
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {filteredInstruments.map(inst => {
              const liveData = getLivePrice(inst);
              const currentPrice = liveData?.last_price || liveData?.ltp || inst.ltp || 0;
              const change = liveData?.change || 0;
              const changePercent = liveData?.change_percent || 0;
              const isLive = !!liveData?.last_price;
              
              return (
              <div
                key={inst._id || inst.token}
                onClick={() => handleInstrumentClick(inst)}
                className="px-3 py-2 hover:bg-dark-700 cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {inst.isFeatured && <Star size={12} className="text-yellow-400 flex-shrink-0" />}
                      <span className="font-medium text-sm truncate">{inst.symbol}</span>
                      {isLive && (
                        <span className="text-xs text-green-400 px-1 py-0.5 bg-green-500/20 rounded animate-pulse">
                          LIVE
                        </span>
                      )}
                      <span className="text-xs text-gray-500 px-1 py-0.5 bg-dark-600 rounded">
                        {inst.exchange}
                      </span>
                      {inst.expiry && (
                        <span className="text-xs text-blue-400 px-1 py-0.5 bg-blue-500/20 rounded">
                          {new Date(inst.expiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{inst.name}</div>
                  </div>
                  
                  <div className="text-right ml-2">
                    <div className={`font-mono text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {currentPrice > 0 ? `₹${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                    </div>
                    {changePercent !== 0 && (
                      <div className={`text-xs flex items-center justify-end gap-0.5 ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {change >= 0 ? '+' : ''}{changePercent?.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Trade Buttons - Show on hover */}
                {onQuickTrade && (
                  <div className="hidden group-hover:flex gap-2 mt-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickTrade('buy', inst); }}
                      className="flex-1 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium"
                    >
                      BUY
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickTrade('sell', inst); }}
                      className="flex-1 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium"
                    >
                      SELL
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-3 py-2 border-t border-dark-600 text-xs text-gray-500 flex justify-between">
        <span>{filteredInstruments.length} instruments</span>
        <span>Auto-refresh: 5s</span>
      </div>
    </div>
  );
};

export default MarketWatch;
