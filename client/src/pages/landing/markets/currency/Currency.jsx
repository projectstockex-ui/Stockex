import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { Banknote, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import { OpenAccountDialog } from "@/components/landing/auth-dialogs"

const currencyPairs = [
  { pair: "USD/INR", name: "US Dollar / Indian Rupee", price: "83.42", change: "+0.12%", isUp: true },
  { pair: "EUR/INR", name: "Euro / Indian Rupee", price: "90.85", change: "+0.25%", isUp: true },
  { pair: "GBP/INR", name: "British Pound / Indian Rupee", price: "105.32", change: "-0.18%", isUp: false },
  { pair: "JPY/INR", name: "Japanese Yen / Indian Rupee", price: "0.56", change: "+0.08%", isUp: true },
  { pair: "AUD/INR", name: "Australian Dollar / Indian Rupee", price: "54.20", change: "-0.22%", isUp: false },
  { pair: "CAD/INR", name: "Canadian Dollar / Indian Rupee", price: "61.45", change: "+0.15%", isUp: true },
]

const features = [
  "Trade major currency pairs",
  "Tight spreads from 0.1 pips",
  "24/5 market access",
  "Leverage up to 1:50",
  "Real-time forex news",
  "Economic calendar",
]

export default function Currency() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-32 pb-20" style={{ background: 'linear-gradient(135deg, #0B3C6D 0%, #1A73E8 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 mb-6">
                <Banknote className="w-4 h-4 text-yellow-accent" />
                <span className="text-sm text-white">Currency Trading</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
                Trade Currency Pairs
              </h1>
              <p className="text-xl text-white/80 mb-8">
                Access the forex market with competitive spreads and leverage. Trade USD/INR, EUR/INR, GBP/INR and more.
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
              <h3 className="text-xl font-bold text-white mb-6">Currency Trading Features</h3>
              <ul className="space-y-4">
                {features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-white">
                    <div className="w-6 h-6 bg-yellow-accent/20 rounded-full flex items-center justify-center">
                      <Banknote className="w-3 h-3 text-yellow-accent" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Currency Pairs */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">Popular Currency Pairs</h2>
            <p className="text-lg text-muted-foreground">Trade major INR currency pairs</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {currencyPairs.map((currency, index) => (
              <div key={index} className="bg-white rounded-xl p-5 border border-border hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-deep-blue">{currency.pair}</span>
                  <span className={`flex items-center gap-1 text-sm font-medium ${currency.isUp ? "text-green-500" : "text-red-500"}`}>
                    {currency.isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {currency.change}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{currency.name}</p>
                <p className="text-lg font-semibold text-foreground">{currency.price}</p>
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
