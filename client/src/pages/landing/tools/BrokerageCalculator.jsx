import { useState } from "react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { Calculator, ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

export default function BrokerageCalculator() {
  const [segment, setSegment] = useState("equity-delivery")
  const [buyPrice, setBuyPrice] = useState("")
  const [sellPrice, setSellPrice] = useState("")
  const [quantity, setQuantity] = useState("")
  const [results, setResults] = useState(null)

  const segments = [
    { id: "equity-delivery", label: "Equity Delivery" },
    { id: "equity-intraday", label: "Equity Intraday" },
    { id: "futures", label: "F&O Futures" },
    { id: "options", label: "F&O Options" },
  ]

  const calculateCharges = () => {
    const buy = parseFloat(buyPrice) || 0
    const sell = parseFloat(sellPrice) || 0
    const qty = parseInt(quantity) || 0

    const turnover = (buy + sell) * qty
    const buyValue = buy * qty
    const sellValue = sell * qty

    let brokerage = 0
    let sttBuy = 0
    let sttSell = 0
    let exchangeCharges = 0
    let gst = 0
    let sebiCharges = 0
    let stampDuty = 0

    if (segment === "equity-delivery") {
      brokerage = 0 // Zero brokerage for delivery
      sttBuy = buyValue * 0.001 // 0.1% on buy
      sttSell = sellValue * 0.001 // 0.1% on sell
      exchangeCharges = turnover * 0.0000345
      sebiCharges = turnover * 0.000001
      stampDuty = buyValue * 0.00015
    } else if (segment === "equity-intraday") {
      brokerage = Math.min(turnover * 0.0003, 40) // 0.03% or max 20 per order
      sttSell = sellValue * 0.00025 // 0.025% on sell
      exchangeCharges = turnover * 0.0000345
      sebiCharges = turnover * 0.000001
      stampDuty = buyValue * 0.00003
    } else if (segment === "futures") {
      brokerage = Math.min(turnover * 0.0003, 40)
      sttSell = sellValue * 0.000125
      exchangeCharges = turnover * 0.0000019
      sebiCharges = turnover * 0.000001
      stampDuty = buyValue * 0.00002
    } else if (segment === "options") {
      brokerage = 40 // Flat 20 per order
      sttSell = sellValue * 0.000625
      exchangeCharges = turnover * 0.00053
      sebiCharges = turnover * 0.000001
      stampDuty = buyValue * 0.00003
    }

    const totalStt = sttBuy + sttSell
    gst = (brokerage + exchangeCharges) * 0.18
    const totalCharges = brokerage + totalStt + exchangeCharges + gst + sebiCharges + stampDuty
    const netPnL = sellValue - buyValue - totalCharges
    const breakeven = buy + (totalCharges / qty)

    setResults({
      turnover: turnover.toFixed(2),
      brokerage: brokerage.toFixed(2),
      stt: totalStt.toFixed(2),
      exchangeCharges: exchangeCharges.toFixed(2),
      gst: gst.toFixed(2),
      sebiCharges: sebiCharges.toFixed(2),
      stampDuty: stampDuty.toFixed(2),
      totalCharges: totalCharges.toFixed(2),
      netPnL: netPnL.toFixed(2),
      breakeven: breakeven.toFixed(2),
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
            <div className="w-16 h-16 bg-yellow-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Calculator className="w-8 h-8 text-yellow-accent" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Brokerage Calculator
            </h1>
            <p className="text-white/70 max-w-xl mx-auto">
              Calculate your trading costs including brokerage, STT, exchange charges, GST, and other fees.
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
            <div className="grid sm:grid-cols-3 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Buy Price ()</label>
                <input
                  type="number"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-yellow-accent focus:border-yellow-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Sell Price ()</label>
                <input
                  type="number"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
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
            </div>

            <Button
              onClick={calculateCharges}
              className="w-full bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold py-6 text-lg rounded-xl"
            >
              Calculate Charges
            </Button>

            {/* Results */}
            {results && (
              <div className="mt-8 pt-8 border-t border-white/20">
                <h3 className="text-lg font-semibold text-white mb-6">Breakdown</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { label: "Turnover", value: `${results.turnover}` },
                    { label: "Brokerage", value: `${results.brokerage}` },
                    { label: "STT", value: `${results.stt}` },
                    { label: "Exchange Charges", value: `${results.exchangeCharges}` },
                    { label: "GST (18%)", value: `${results.gst}` },
                    { label: "SEBI Charges", value: `${results.sebiCharges}` },
                    { label: "Stamp Duty", value: `${results.stampDuty}` },
                    { label: "Breakeven Price", value: `${results.breakeven}` },
                  ].map((item, i) => (
                    <div key={i} className="flex justify-between items-center bg-white/5 rounded-xl p-4">
                      <span className="text-white/70">{item.label}</span>
                      <span className="text-white font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="mt-6 grid sm:grid-cols-2 gap-4">
                  <div className="bg-white/10 rounded-xl p-6 text-center">
                    <div className="text-white/70 text-sm mb-2">Total Charges</div>
                    <div className="text-2xl font-bold text-yellow-accent">{results.totalCharges}</div>
                  </div>
                  <div className={`rounded-xl p-6 text-center ${parseFloat(results.netPnL) >= 0 ? "bg-green-500/20" : "bg-red-500/20"}`}>
                    <div className="text-white/70 text-sm mb-2">Net P&L</div>
                    <div className={`text-2xl font-bold ${parseFloat(results.netPnL) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {results.netPnL}
                    </div>
                  </div>
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
