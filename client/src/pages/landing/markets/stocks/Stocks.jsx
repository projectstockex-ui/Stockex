import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { TrendingUp, TrendingDown, BarChart3, ArrowRight } from "lucide-react"
import { OpenAccountDialog } from "@/components/landing/auth-dialogs"

const popularStocks = [
  { symbol: "RELIANCE", name: "Reliance Industries", price: "2,847.50", change: "+1.25%", isUp: true },
  { symbol: "TCS", name: "Tata Consultancy Services", price: "3,892.30", change: "+0.85%", isUp: true },
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd", price: "1,678.45", change: "-0.32%", isUp: false },
  { symbol: "INFY", name: "Infosys Ltd", price: "1,456.20", change: "+1.12%", isUp: true },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd", price: "1,089.75", change: "+0.67%", isUp: true },
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd", price: "987.60", change: "+2.35%", isUp: true },
  { symbol: "SBIN", name: "State Bank of India", price: "756.80", change: "-0.45%", isUp: false },
  { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd", price: "1,234.50", change: "+0.92%", isUp: true },
]

const features = [
  "Trade 5000+ Indian stocks",
  "Real-time market data",
  "Zero delivery brokerage",
  "Advanced charting tools",
  "IPO & Mutual Fund access",
  "Portfolio analytics",
]

export default function Stocks() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-32 pb-20" style={{ background: 'linear-gradient(135deg, #0B3C6D 0%, #1A73E8 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 mb-6">
                <TrendingUp className="w-4 h-4 text-yellow-accent" />
                <span className="text-sm text-white">Indian Equities</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
                Trade Indian Stocks
              </h1>
              <p className="text-xl text-white/80 mb-8">
                Access 5000+ stocks listed on NSE & BSE with real-time market data, advanced charts, and zero delivery brokerage.
              </p>
              <div className="flex flex-wrap gap-4">
                <OpenAccountDialog
                  trigger={
                    <Button size="lg" className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-8">
                      Start Trading
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  }
                />
              </div>
            </div>

            {/* Features List */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
              <h3 className="text-xl font-bold text-white mb-6">Why Trade Stocks with STOCKEX?</h3>
              <ul className="space-y-4">
                {features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-white">
                    <div className="w-6 h-6 bg-yellow-accent/20 rounded-full flex items-center justify-center">
                      <BarChart3 className="w-3 h-3 text-yellow-accent" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Stocks */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">Popular Stocks</h2>
            <p className="text-lg text-muted-foreground">Most traded stocks on STOCKEX</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {popularStocks.map((stock, index) => (
              <div key={index} className="bg-white rounded-xl p-5 border border-border hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-deep-blue">{stock.symbol}</span>
                  <span className={`flex items-center gap-1 text-sm font-medium ${stock.isUp ? "text-green-500" : "text-red-500"}`}>
                    {stock.isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {stock.change}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{stock.name}</p>
                <p className="text-lg font-semibold text-foreground">{stock.price}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <OpenAccountDialog
              trigger={
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-8">
                  Open Free Account
                </Button>
              }
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
