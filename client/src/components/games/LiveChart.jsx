import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { RefreshCw } from 'lucide-react';

/** lightweight-charts requires consistent UTCTimestamp (seconds). Objects/strings from APIs cause "Cannot update oldest data, last time=[object Object]". */
function normalizeChartTime(t) {
  if (t == null) return null;
  if (typeof t === 'number' && Number.isFinite(t)) {
    return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
  }
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  if (typeof t === 'object') {
    if ('year' in t && 'month' in t && 'day' in t) {
      const y = Number(t.year);
      const m = Number(t.month);
      const d = Number(t.day);
      if ([y, m, d].every(Number.isFinite)) {
        return Math.floor(Date.UTC(y, m - 1, d) / 1000);
      }
    }
  }
  return null;
}

/** OHLC row for the strip under the chart (IST labels). */
function candleToHud(bar, timeSec) {
  if (!bar || timeSec == null || !Number.isFinite(timeSec)) return null;
  const o = Number(bar.open);
  const h = Number(bar.high);
  const l = Number(bar.low);
  const c = Number(bar.close);
  if (![o, h, l, c].every((x) => Number.isFinite(x))) return null;
  const d = new Date(timeSec * 1000);
  const dateStr = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return { timeSec, dateStr, timeStr, open: o, high: h, low: l, close: c };
}

const LiveChart = ({ 
  symbol, 
  isBTC, 
  livePrice, 
  isLiveConnected, 
  priceLines = [],
  historicalData = [],
  /** Show only the last N bars in view (x-axis); full series still used for OHLC. Nifty: 3. */
  visibleBarCount = null,
}) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const priceLineRefs = useRef({});
  const lastBarTimeRef = useRef(null);
  /** Last candle from history + live: update() must use this bar's time (Kite/interval), never `Date.now` — that created fake 1m bars. */
  const lastFormingCandleRef = useRef(null);
  const crosshairHandlerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [defaultHud, setDefaultHud] = useState(null);
  const [crosshairHud, setCrosshairHud] = useState(null);

  const displayHud = crosshairHud ?? defaultHud;

  const formatPx = useCallback(
    (n) => {
      if (!Number.isFinite(n)) return '—';
      /** Fixed locale — `undefined` follows browser (e.g. de-DE swaps . and ,) and Nifty OHLC looked wrong vs chart. */
      const s = n.toLocaleString(isBTC ? 'en-US' : 'en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return isBTC ? `$${s}` : `${s}`;
    },
    [isBTC],
  );

  const getDefaultChartHeight = () =>
    Math.max(180, Math.min(320, Math.round((typeof window !== 'undefined' ? window.innerHeight : 600) * 0.28)));

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const el = chartContainerRef.current;
    const w = Math.max(200, el.clientWidth || 300);
    const h = Math.max(160, el.clientHeight || getDefaultChartHeight());

    const chart = createChart(el, {
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      width: w,
      height: h,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2a2a',
        fixRightEdge: true,
        rightBarStaysOnScroll: true,
        tickMarkMaxCharacterLength: 8,
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(168,85,247,0.55)', labelBackgroundColor: '#475569' },
        horzLine: { color: 'rgba(168,85,247,0.35)', labelBackgroundColor: '#475569' },
      },
      localization: {
        locale: 'en-IN',
        timeFormatter: (time) => {
          if (typeof time !== 'number' || !Number.isFinite(time)) return '';
          const date = new Date(time * 1000);
          return date.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        },
      },
    });

    chart.applyOptions({
      timeScale: {
        tickMarkFormatter: (time) => {
          if (typeof time !== 'number' || !Number.isFinite(time)) return '';
          const date = new Date(time * 1000);
          return date.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const onCrosshairMove = (param) => {
      if (!param) {
        setCrosshairHud(null);
        return;
      }
      const pt = param.point;
      const insideChart =
        pt && pt.x >= 0 && pt.y >= 0 && candleSeriesRef.current && chartRef.current?.timeScale();
      if (!insideChart) {
        setCrosshairHud(null);
        return;
      }

      const data = param.seriesData?.get(candleSeriesRef.current);
      const tRaw = param.time;

      let timeSec =
        typeof tRaw === 'number' && Number.isFinite(tRaw)
          ? tRaw > 1e12
            ? Math.floor(tRaw / 1000)
            : Math.floor(tRaw)
          : normalizeChartTime(tRaw);

      if (data && typeof data === 'object' && 'open' in data && Number.isFinite(timeSec)) {
        const row = candleToHud(data, timeSec);
        if (row) setCrosshairHud(row);
      } else if (!param.time) {
        setCrosshairHud(null);
      }
    };

    crosshairHandlerRef.current = onCrosshairMove;
    chart.subscribeCrosshairMove(onCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    setChartReady(true);

    const applySize = () => {
      if (!chartContainerRef.current || !chartRef.current) return;
      const cw = Math.max(200, chartContainerRef.current.clientWidth);
      const ch = Math.max(160, chartContainerRef.current.clientHeight || getDefaultChartHeight());
      chartRef.current.applyOptions({ width: cw, height: ch });
    };

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => applySize())
      : null;
    if (ro) ro.observe(el);

    window.addEventListener('resize', applySize);

    return () => {
      window.removeEventListener('resize', applySize);
      if (ro) ro.disconnect();
      try {
        if (chartRef.current && crosshairHandlerRef.current) {
          chartRef.current.unsubscribeCrosshairMove(crosshairHandlerRef.current);
        }
      } catch {
        /* ignore */
      }
      crosshairHandlerRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
      }
      setChartReady(false);
    };
  }, []);

  // Load historical data
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return;
    if (!historicalData || historicalData.length === 0) return;

    try {
      setLoading(true);
      const formattedData = historicalData
        .map((candle) => {
          const time =
            normalizeChartTime(candle.time) ??
            normalizeChartTime(candle.timestamp) ??
            (candle.timestamp != null
              ? Math.floor(new Date(candle.timestamp).getTime() / 1000)
              : null);
          if (time == null || !Number.isFinite(time)) return null;
          return {
            time,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);

      if (formattedData.length === 0) {
        setLoading(false);
        lastBarTimeRef.current = null;
        lastFormingCandleRef.current = null;
        setDefaultHud(null);
        return;
      }

      const deduped = [];
      for (const row of formattedData) {
        if (deduped.length && deduped[deduped.length - 1].time === row.time) {
          deduped[deduped.length - 1] = row;
        } else {
          deduped.push(row);
        }
      }

      candleSeriesRef.current.setData(deduped);
      const last = deduped[deduped.length - 1];
      lastBarTimeRef.current = last.time;
      lastFormingCandleRef.current = {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      };
      const hud = candleToHud(last, last.time);
      if (hud) setDefaultHud(hud);

      const n = deduped.length;
      const want = Number(visibleBarCount);
      if (Number.isFinite(want) && want > 0 && chartRef.current) {
        const from = Math.max(0, n - want);
        const to = n - 1;
        requestAnimationFrame(() => {
          try {
            chartRef.current?.timeScale().setVisibleLogicalRange({ from, to });
          } catch {
            /* ignore invalid range */
          }
        });
      }
      setLoading(false);
    } catch (error) {
      console.error('LiveChart - Error loading historical data:', error);
      setLoading(false);
    }
  }, [historicalData, chartReady, visibleBarCount]);

  // Update the forming candle in place: same `time` as the last Kite/Binance bar (5m/15m/30m/1h). Never use wall-clock `now` as bar time
  // or the chart will inject extra sub-interval bars and the x-axis will look like 1m ticks.
  useEffect(() => {
    if (!candleSeriesRef.current || livePrice == null || !Number.isFinite(Number(livePrice))) return;

    const base = lastFormingCandleRef.current;
    if (base == null || base.time == null) return;

    const p = Number(livePrice);
    const open = Number(base.open);
    const hi0 = Number(base.high);
    const lo0 = Number(base.low);
    if (![open, hi0, lo0].every((x) => Number.isFinite(x))) return;

    const next = {
      time: base.time,
      open,
      high: Math.max(hi0, p),
      low: Math.min(lo0, p),
      close: p,
    };

    try {
      candleSeriesRef.current.update(next);
      lastFormingCandleRef.current = next;
      const hud = candleToHud(next, next.time);
      if (hud) setDefaultHud(hud);
    } catch (e) {
      console.warn('LiveChart - update skipped:', e?.message || e);
    }
  }, [livePrice, isLiveConnected]);

  // Draw price lines for active trades
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove old price lines
    Object.values(priceLineRefs.current).forEach(line => {
      if (line) {
        candleSeriesRef.current.removePriceLine(line);
      }
    });
    priceLineRefs.current = {};

    // Add new price lines
    priceLines.forEach(pl => {
      const color = pl.prediction === 'UP' || pl.prediction === 'BUY' ? '#10b981' : '#ef4444';
      const priceLine = candleSeriesRef.current.createPriceLine({
        price: pl.price,
        color: color,
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: pl.prediction,
      });
      priceLineRefs.current[pl.id] = priceLine;
    });
  }, [priceLines]);

  const handleChartAreaLeave = () => {
    setCrosshairHud(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col w-full rounded-lg overflow-hidden bg-dark-800/90 border border-dark-700/80">
        <div className="flex items-center justify-center h-[min(280px,35vh)] min-h-[180px] w-full bg-dark-700 rounded-lg">
          <div className="text-center">
            <RefreshCw className="animate-spin mx-auto mb-2 text-gray-400" size={24} />
            <div className="text-sm text-gray-400">Loading chart...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full rounded-lg overflow-hidden bg-dark-800/90 border border-dark-700/80">
      <div
        className="relative w-full flex-1 min-h-[160px] h-[min(30vh,220px)] sm:min-h-[180px] sm:h-[min(32vh,240px)] md:h-[min(34vh,260px)] lg:h-[270px]"
        onMouseLeave={handleChartAreaLeave}
      >
        <div ref={chartContainerRef} className="rounded-t-lg overflow-hidden w-full h-full" />
        {!isLiveConnected && (
          <div className="absolute top-2 right-2 bg-yellow-900/80 text-yellow-300 px-3 py-1 rounded text-xs font-medium">
            Historical Data
          </div>
        )}
        {isLiveConnected && (
          <div className="absolute top-2 right-2 bg-green-900/80 text-green-300 px-3 py-1 rounded text-xs font-medium flex items-center gap-1">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            LIVE
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-dark-600 bg-dark-900/95 px-2 py-2 sm:px-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] sm:text-xs text-gray-400">
          <span
            className="font-semibold text-cyan-300/95 truncate max-w-[min(220px,50vw)]"
            title={symbol}
          >
            {symbol || (isBTC ? 'BTC/USDT' : 'NIFTY 50')} · IST
          </span>
          {displayHud ? (
            <>
              <span className="text-gray-500 tabular-nums">{displayHud.dateStr}</span>
              <span className="text-gray-500 tabular-nums">{displayHud.timeStr}</span>
              <span className="text-gray-500">O</span>
              <span className="text-slate-100 font-mono tabular-nums">{formatPx(displayHud.open)}</span>
              <span className="text-gray-500">H</span>
              <span className="text-slate-100 font-mono tabular-nums">{formatPx(displayHud.high)}</span>
              <span className="text-gray-500">L</span>
              <span className="text-slate-100 font-mono tabular-nums">{formatPx(displayHud.low)}</span>
              <span className="text-gray-500">C</span>
              <span className="text-slate-100 font-semibold font-mono tabular-nums">{formatPx(displayHud.close)}</span>
              {crosshairHud && (
                <span className="text-purple-400/90 text-[10px] sm:text-[11px] font-medium">Hovered bar</span>
              )}
            </>
          ) : (
            <span className="text-gray-600">Hover chart to see OHLC</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveChart;
