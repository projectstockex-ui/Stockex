import { useState } from "react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { BarChart2, ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

export default function MarginCalculator() {
  const [segment, setSegment] = useState("equity-intraday")
  const [stockPrice, setStockPrice] = useState("")
  const [quantity, setQuantity] = useState("")
  const [results, setResults] = useState(null)

  const segments = [
    { id: "equity-intraday", label: "Equity Intraday", margin: 20 },
    { id: "equity-delivery", label: "Equity Delivery", margin: 100 },
    { id: "futures", label: "F&O Futures", margin: 15 },
    { id: "options-buy", label: "Options Buy", margin: 100 },
    { id: "options-sell", label: "Options Sell", margin: 25 },
  ]

  const calculateMargin = () => {
    const price = parseFloat(stockPrice) || 0
    const qty = parseInt(quantity) || 0
    const selectedSegment = segments.find(s => s.id === segment)
    const marginPercent = selectedSegment?.margin || 100

    const totalValue = price * qty
    const marginRequired = (totalValue * marginPercent) / 100
    const leverage = 100 / marginPercent
    const exposureValue = totalValue

    setResults({
      totalValue: totalValue.toFixed(2),
      marginRequired: marginRequired.toFixed(2),
      marginPercent: marginPercent,
      leverage: leverage.toFixed(1),
      exposureValue: exposureValue.toFixed(2),
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
            <div className="w-16 h-16 bg-yellow-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <BarChart2 className="w-8 h-8 text-yellow-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Margin Calculator
            </h1>
            <p className="text-white/70 max-w-xl mx-auto">
              Calculate margin requirements for your positions across different segments.
            </p>
          </div>

          {/* Calculator Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-8">
            {/* Segment Tabs */}
            <div className="flex flex-wrap gap-2 mb-8">
              {segments.map((seg) => (
                <button
                  key={seg.id}
                  onClick={() => setSegment(seg.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    segment === seg.id
                      ? "bg-yellow-accent text-deep-blue"
                      : "bg-white/10 text-white/70 hover:bg-white/20"
                  }`}
                >
                  {seg.label}
                </button>
              ))}
            </div>

            {/* Input Fields */}
            <div className="grid sm:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Stock/Contract Price ()</label>
                <input
                  type="number"
                  value={stockPrice}
                  onChange={(e) => setStockPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Quantity / Lot Size</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
            </div>

            <Button
              onClick={calculateMargin}
              className="w-full bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold py-6 text-lg rounded-xl"
            >
              Calculate Margin
            </Button>

            {/* Results */}
            {results && (
              <div className="mt-8 pt-8 border-t border-white/20">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-white/5 rounded-xl p-6 text-center">
                    <div className="text-white/70 text-sm mb-2">Total Position Value</div>
                    <div className="text-2xl font-bold text-white">{results.totalValue}</div>
                  </div>
                  <div className="bg-yellow-accent/20 rounded-xl p-6 text-center">
                    <div className="text-white/70 text-sm mb-2">Margin Required</div>
                    <div className="text-2xl font-bold text-yellow-accent">{results.marginRequired}</div>
                    <div className="text-sm text-white/50 mt-1">{results.marginPercent}% of value</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-6 text-center">
                    <div className="text-white/70 text-sm mb-2">Leverage</div>
                    <div className="text-2xl font-bold text-white">{results.leverage}x</div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="mt-6 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <p className="text-sm text-blue-300">
                    <strong>Note:</strong> Margin requirements may vary based on market conditions, stock volatility, and broker policies. 
                    Always check with your broker for exact margin requirements.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Margin Info Table */}
          <div className="mt-8 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Margin Requirements by Segment</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-3 text-white/70 text-sm font-medium">Segment</th>
                    <th className="text-right py-3 text-white/70 text-sm font-medium">Margin %</th>
                    <th className="text-right py-3 text-white/70 text-sm font-medium">Leverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {segments.map((seg) => (
                    <tr key={seg.id}>
                      <td className="py-3 text-white">{seg.label}</td>
                      <td className="py-3 text-right text-white">{seg.margin}%</td>
                      <td className="py-3 text-right text-yellow-accent">{(100 / seg.margin).toFixed(1)}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
