import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { TrendingUp, TrendingDown } from "lucide-react"
import { io } from "socket.io-client"
import axios from "@/config/axios"

/** Must match server/utils/landingTickerConfig.js labels */
const TICKER_LABELS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "NIFTY 50", "BANKNIFTY", "SENSEX", "GOLD", "CRUDE", "USDINR", "TATAMOTORS",
]

const TICKER_ITEMS = [
  { label: "RELIANCE", symbols: ["RELIANCE"] },
  { label: "TCS", symbols: ["TCS"] },
  { label: "HDFCBANK", symbols: ["HDFCBANK", "HDFC BANK"] },
  { label: "INFY", symbols: ["INFY", "INFOSYS"] },
  { label: "ICICIBANK", symbols: ["ICICIBANK", "ICICI BANK"] },
  { label: "NIFTY 50", symbols: ["NIFTY 50", "NIFTY"], tokens: ["256265", "99926000"] },
  { label: "BANKNIFTY", symbols: ["NIFTY BANK", "BANKNIFTY", "BANK NIFTY"], tokens: ["260105", "99926009"] },
  { label: "SENSEX", symbols: ["SENSEX", "BSE SENSEX"], tokens: ["265", "99919000"] },
  { label: "GOLD", symbols: ["GOLD"], tokens: [] },
  { label: "CRUDE", symbols: ["CRUDEOIL", "CRUDE"] },
  { label: "USDINR", symbols: ["USDINR"], tokens: ["USDINR"] },
  { label: "TATAMOTORS", symbols: ["TATAMOTORS", "TATA MOTORS", "TMPV"] },
]

const POLL_MS = 8000

function norm(s) {
  return String(s || "").trim().toUpperCase()
}

function parseTickDirection(tick) {
  const cp = parseFloat(tick?.changePercent)
  if (Number.isFinite(cp)) return { changePercent: cp, isUp: cp >= 0 }
  const ch = Number(tick?.change)
  if (Number.isFinite(ch)) return { changePercent: null, isUp: ch >= 0 }
  const open = parseFloat(tick?.open ?? tick?.close)
  const ltp = parseFloat(tick?.ltp)
  if (Number.isFinite(open) && Number.isFinite(ltp) && open > 0) {
    const pct = ((ltp - open) / open) * 100
    return { changePercent: pct, isUp: pct >= 0 }
  }
  return { changePercent: null, isUp: true }
}

function formatPrice(label, price) {
  if (!Number.isFinite(price)) return "—"
  const formatted = price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return label === "USDINR" ? formatted : `₹${formatted}`
}

function formatChange(changePercent, isUp) {
  if (changePercent == null || !Number.isFinite(changePercent)) return "—"
  const sign = changePercent >= 0 ? "+" : ""
  return `${sign}${changePercent.toFixed(2)}%`
}

function quotesArrayToState(quotes, tokenMapOut) {
  const next = {}
  const map = { ...tokenMapOut }
  for (const q of quotes || []) {
    if (!q?.label || !Number.isFinite(q.price)) continue
    next[q.label] = {
      price: q.price,
      changePercent: q.changePercent,
      isUp: q.isUp ?? true,
    }
    if (q.token) map[String(q.token)] = q.label
    if (q.symbol) map[norm(q.symbol)] = q.label
  }
  return { quotes: next, tokenMap: map }
}

function tickMatchesItem(tick, item, tokenToLabel) {
  if (!tick) return false
  const token = String(tick.token ?? "")
  if (token && tokenToLabel[token]) return tokenToLabel[token] === item.label
  if (item.tokens?.some((t) => String(t) === token)) return true
  const sym = norm(tick.symbol)
  const trading = norm(tick.tradingsymbol || tick.tradingSymbol)
  return item.symbols?.some((s) => {
    const want = norm(s)
    return sym === want || trading === want || sym.startsWith(want) || trading.startsWith(want)
  })
}

function mergeTicksIntoQuotes(prev, ticks, tokenToLabel) {
  if (!ticks || typeof ticks !== "object") return prev
  const next = { ...prev }
  for (const [key, tick] of Object.entries(ticks)) {
    if (!tick) continue
    const ltp = parseFloat(tick.ltp ?? tick.last_price ?? tick.close)
    if (!Number.isFinite(ltp) || ltp <= 0) continue
    const { changePercent, isUp } = parseTickDirection(tick)

    const labelFromKey = tokenToLabel[String(key)] || tokenToLabel[String(tick.token)]
    if (labelFromKey) {
      next[labelFromKey] = { price: ltp, changePercent, isUp }
      continue
    }

    for (const item of TICKER_ITEMS) {
      if (!tickMatchesItem(tick, item, tokenToLabel)) continue
      next[item.label] = { price: ltp, changePercent, isUp }
      break
    }
  }
  return next
}

export function LiveTicker() {
  const [quotes, setQuotes] = useState({})
  const tokenMapRef = useRef({})

  const applyServerQuotes = useCallback((data) => {
    const { quotes: qState, tokenMap } = quotesArrayToState(data?.quotes, tokenMapRef.current)
    tokenMapRef.current = tokenMap
    setQuotes((prev) => ({ ...qState, ...prev })) // keep newer WebSocket ticks over poll
  }, [])

  const fetchQuotes = useCallback(() => {
    axios
      .get("/api/zerodha/landing-ticker-quotes")
      .then((res) => applyServerQuotes(res.data))
      .catch(() => {})
  }, [applyServerQuotes])

  useEffect(() => {
    axios.post("/api/zerodha/landing-ticker-subscribe").catch(() => {})
    fetchQuotes()
    const id = setInterval(fetchQuotes, POLL_MS)
    return () => clearInterval(id)
  }, [fetchQuotes])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:5001"
    const socket = io(socketUrl, { transports: ["websocket", "polling"] })

    const onTicks = (ticks) => {
      setQuotes((prev) => mergeTicksIntoQuotes(prev, ticks, tokenMapRef.current))
    }

    socket.on("market_tick", onTicks)
    socket.on("crypto_tick", onTicks)
    socket.on("forex_tick", onTicks)

    return () => {
      socket.off("market_tick", onTicks)
      socket.off("crypto_tick", onTicks)
      socket.off("forex_tick", onTicks)
      socket.disconnect()
    }
  }, [])

  const displayItems = useMemo(() => {
    return TICKER_LABELS.map((label) => {
      const q = quotes[label]
      return {
        label,
        price: q?.price,
        changePercent: q?.changePercent,
        isUp: q?.isUp ?? true,
        hasData: q != null && Number.isFinite(q.price),
      }
    })
  }, [quotes])

  const row = (item, index) => {
    const up = item.isUp
    const priceColor = up ? "text-green-500" : "text-red-500"
    const changeStr = formatChange(item.changePercent, up)

    return (
      <div
        key={`${item.label}-${index}`}
        className="flex items-center gap-3 px-6 py-2.5 border-r border-white/15 whitespace-nowrap"
      >
        <span className="font-semibold text-yellow-400 text-sm">{item.label}</span>
        <span className={`text-sm font-medium tabular-nums ${priceColor}`}>
          {item.hasData ? formatPrice(item.label, item.price) : "—"}
        </span>
        <span className={`flex items-center gap-1 text-sm font-medium tabular-nums ${priceColor}`}>
          {item.hasData ? (
            <>
              {up ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
              {changeStr}
            </>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-black border-b border-white/10 overflow-hidden shadow-md">
      <div className="flex animate-ticker">
        {[...displayItems, ...displayItems].map((item, index) => row(item, index))}
      </div>
    </div>
  )
}
