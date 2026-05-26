import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { Link } from "react-router-dom"
import { User, PlayCircle, Building2, Check, ArrowRight } from "lucide-react"

const accountTypes = [
  {
    icon: User,
    title: "User Trading Account",
    subtitle: "For Individual Traders & Investors",
    description: "Start your trading journey with our comprehensive trading account. Access all Indian markets with professional tools.",
    price: "Free",
    priceNote: "No account opening charges",
    features: [
      "Trade Stocks, Indices, Commodities, Currency",
      "Real-time market data & quotes",
      "Advanced charting tools",
      "Portfolio dashboard",
      "Market research & analysis",
      "Mobile & web trading",
      "Dedicated customer support",
      "Secure fund transfers",
    ],
    cta: "Open User Account",
    href: "/accounts/user",
    featured: false,
    color: "bg-primary",
  },
  {
    icon: PlayCircle,
    title: "Demo Trading Account",
    subtitle: "Practice Risk-Free Trading",
    description: "Learn trading with virtual money. Perfect for beginners to practice strategies without risking real capital.",
    price: "₹1,00,000",
    priceNote: "Virtual balance",
    features: [
      "₹1 Lakh virtual trading balance",
      "Real-time market simulation",
      "Full platform access",
      "Risk-free learning environment",
      "Practice all trading strategies",
      "No time limit",
      "Switch to live anytime",
      "Educational resources",
    ],
    cta: "Start Demo Trading",
    href: "/demo-trading",
    featured: true,
    color: "bg-yellow-accent",
  },
  {
    icon: Building2,
    title: "Broker Account",
    subtitle: "Start Your Brokerage Business",
    description: "Launch your own brokerage with our white-label solution. Get everything you need to run a successful trading business.",
    price: "Custom",
    priceNote: "Contact for pricing",
    features: [
      "White-label trading platform",
      "Client management dashboard",
      "Revenue sharing model",
      "Back-office support",
      "Risk management tools",
      "Compliance assistance",
      "Marketing support",
      "Dedicated account manager",
    ],
    cta: "Become a Broker",
    href: "/broker-program",
    featured: false,
    color: "bg-deep-blue",
  },
]

export default function Accounts() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-32 pb-20" style={{ background: 'linear-gradient(135deg, #0B3C6D 0%, #1A73E8 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
            Join Stockex as a Broker
          </h1>
          <p className="text-xl text-white/80 max-w-3xl mx-auto">
            Whether you're a beginner, experienced trader, or looking to start a brokerage business, we have the right account for you.
          </p>
        </div>
      </section>

      {/* Account Types */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8">
            {accountTypes.map((account, index) => (
              <div 
                key={index} 
                className={`relative bg-white rounded-2xl p-8 transition-all duration-300 ${
                  account.featured 
                    ? "border-2 border-yellow-accent shadow-xl scale-105" 
                    : "border-2 border-border hover:border-primary/30 hover:shadow-lg"
                }`}
              >
                {account.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-yellow-accent text-deep-blue text-sm font-bold px-4 py-1 rounded-full">
                    Most Popular
                  </div>
                )}
                
                <div className={`w-14 h-14 ${account.color} rounded-2xl flex items-center justify-center mb-6 ${account.featured ? "text-deep-blue" : "text-white"}`}>
                  <account.icon className="w-7 h-7" />
                </div>
                
                <h2 className="text-2xl font-bold text-deep-blue mb-2">{account.title}</h2>
                <p className="text-sm text-primary font-medium mb-4">{account.subtitle}</p>
                <p className="text-muted-foreground mb-6">{account.description}</p>
                
                <div className="mb-6">
                  <span className="text-3xl font-bold text-deep-blue">{account.price}</span>
                  <span className="text-sm text-muted-foreground ml-2">{account.priceNote}</span>
                </div>
                
                <ul className="space-y-3 mb-8">
                  {account.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-profit-green flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <Link to={account.href}>
                  <Button 
                    className={`w-full ${
                      account.featured 
                        ? "bg-yellow-accent hover:bg-yellow-500 text-deep-blue" 
                        : "bg-primary hover:bg-primary/90 text-white"
                    }`}
                  >
                    {account.cta}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-20 bg-secondary/50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-deep-blue text-center mb-12">Account Comparison</h2>
          
          <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-deep-blue text-white">
                  <th className="text-left p-4 font-semibold">Feature</th>
                  <th className="text-center p-4 font-semibold">User Account</th>
                  <th className="text-center p-4 font-semibold">Demo Account</th>
                  <th className="text-center p-4 font-semibold">Broker Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Real Money Trading", "✓", "✗", "✓"],
                  ["Virtual Balance", "✗", "₹1 Lakh", "✗"],
                  ["All Markets Access", "✓", "✓", "✓"],
                  ["Advanced Charts", "✓", "✓", "✓"],
                  ["Client Management", "✗", "✗", "✓"],
                  ["White-label Platform", "✗", "✗", "✓"],
                  ["Revenue Sharing", "✗", "✗", "✓"],
                  ["Account Opening Fee", "Free", "Free", "Custom"],
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-muted/50">
                    <td className="p-4 font-medium text-foreground">{row[0]}</td>
                    <td className="p-4 text-center">{row[1] === "✓" ? <Check className="w-5 h-5 text-profit-green mx-auto" /> : row[1] === "✗" ? <span className="text-muted-foreground">—</span> : row[1]}</td>
                    <td className="p-4 text-center">{row[2] === "✓" ? <Check className="w-5 h-5 text-profit-green mx-auto" /> : row[2] === "✗" ? <span className="text-muted-foreground">—</span> : row[2]}</td>
                    <td className="p-4 text-center">{row[3] === "✓" ? <Check className="w-5 h-5 text-profit-green mx-auto" /> : row[3] === "✗" ? <span className="text-muted-foreground">—</span> : row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
