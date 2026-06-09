import { useState } from "react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { PieChart, ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

export default function ProfitLossCalculator() {
  const [tradeType, setTradeType] = useState("buy")
  const [entryPrice, setEntryPrice] = useState("")
  const [exitPrice, setExitPrice] = useState("")
  const [quantity, setQuantity] = useState("")
  const [leverage, setLeverage] = useState("1")
  const [results, setResults] = useState(null)

  const calculatePnL = () => {
    const entry = parseFloat(entryPrice) || 0
    const exit = parseFloat(exitPrice) || 0
    const qty = parseInt(quantity) || 0
    const lev = parseInt(leverage) || 1

    const investment = entry * qty
    const currentValue = exit * qty
    
    let pnl = 0
    if (tradeType === "buy") {
      pnl = (exit - entry) * qty
    } else {
      pnl = (entry - exit) * qty
    }

    const pnlWithLeverage = pnl * lev
    const percentageReturn = ((pnl / investment) * 100) || 0
    const percentageWithLeverage = percentageReturn * lev

    setResults({
      investment: investment.toFixed(2),
      currentValue: currentValue.toFixed(2),
      pnl: pnl.toFixed(2),
      pnlWithLeverage: pnlWithLeverage.toFixed(2),
      percentageReturn: percentageReturn.toFixed(2),
      percentageWithLeverage: percentageWithLeverage.toFixed(2),
      isProfit: pnl >= 0,
    })
  }

  return (
    <main className="min-h-screen bg-deep-blue">
      <Navbar />
      
      <section className="pt-28 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back Link */}
          <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-yellow-accent mb-8 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          {/* Header */}
          <div className="text-center mb-12">
            <div className="w-16 h-16 bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <PieChart className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Profit & Loss Calculator
            </h1>
            <p className="text-white/70 max-w-xl mx-auto">
              Estimate your potential profits and losses before placing trades.
            </p>
          </div>

          {/* Calculator Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-8">
            {/* Trade Type */}
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setTradeType("buy")}
                className={`flex-1 py-4 rounded-xl font-semibold transition-all ${
                  tradeType === "buy"
                    ? "bg-green-500 text-white"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                Buy (Long)
              </button>
              <button
                onClick={() => setTradeType("sell")}
                className={`flex-1 py-4 rounded-xl font-semibold transition-all ${
                  tradeType === "sell"
                    ? "bg-red-500 text-white"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                Sell (Short)
              </button>
            </div>

            {/* Input Fields */}
            <div className="grid sm:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Entry Price ()</label>
                <input
                  type="number"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Exit Price ()</label>
                <input
                  type="number"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Quantity</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Leverage</label>
                <select
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                >
                  <option value="1" className="bg-deep-blue">1x (No Leverage)</option>
                  <option value="2" className="bg-deep-blue">2x</option>
                  <option value="5" className="bg-deep-blue">5x</option>
                  <option value="10" className="bg-deep-blue">10x</option>
                  <option value="20" className="bg-deep-blue">20x</option>
                </select>
              </div>
            </div>

            <Button
              onClick={calculatePnL}
              className="w-full bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold py-6 text-lg rounded-xl"
            >
              Calculate P&L
            </Button>

            {/* Results */}
            {results && (
              <div className="mt-8 pt-8 border-t border-white/20">
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  <div className="bg-white/5 rounded-xl p-4">
                    <div className="text-white/70 text-sm mb-1">Investment</div>
                    <div className="text-xl font-bold text-white">{results.investment}</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4">
                    <div className="text-white/70 text-sm mb-1">Current Value</div>
                    <div className="text-xl font-bold text-white">{results.currentValue}</div>
                  </div>
                </div>

                {/* Main Results */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className={`rounded-xl p-6 text-center ${results.isProfit ? "bg-green-500/20" : "bg-red-500/20"}`}>
                    <div className="text-white/70 text-sm mb-2">Profit/Loss</div>
                    <div className={`text-3xl font-bold ${results.isProfit ? "text-green-400" : "text-red-400"}`}>
                      {results.isProfit ? "+" : ""}{results.pnl}
                    </div>
                    <div className={`text-sm mt-1 ${results.isProfit ? "text-green-400/70" : "text-red-400/70"}`}>
                      {results.isProfit ? "+" : ""}{results.percentageReturn}%
                    </div>
                  </div>
                  {parseInt(leverage) > 1 && (
                    <div className={`rounded-xl p-6 text-center ${results.isProfit ? "bg-green-500/20" : "bg-red-500/20"}`}>
                      <div className="text-white/70 text-sm mb-2">With {leverage}x Leverage</div>
                      <div className={`text-3xl font-bold ${results.isProfit ? "text-green-400" : "text-red-400"}`}>
                        {results.isProfit ? "+" : ""}{results.pnlWithLeverage}
                      </div>
                      <div className={`text-sm mt-1 ${results.isProfit ? "text-green-400/70" : "text-red-400/70"}`}>
                        {results.isProfit ? "+" : ""}{results.percentageWithLeverage}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
