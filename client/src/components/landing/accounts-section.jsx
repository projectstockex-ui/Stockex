import { Button } from "@/components/landing/ui/button"
import { User, PlayCircle, Building2, TrendingUp, PieChart, Wrench, Wallet, Activity, BookOpen, Users, BarChart3, DollarSign } from "lucide-react"
import { Link } from "react-router-dom"

const accounts = [
  {
    icon: User,
    title: "User Trading Account",
    description: "For individual traders and investors.",
    features: [
      { icon: TrendingUp, text: "Stock trading" },
      { icon: PieChart, text: "Portfolio dashboard" },
      { icon: Wrench, text: "Market tools" },
    ],
    buttonText: "Open User Account",
    buttonStyle: "bg-primary hover:bg-primary/90 text-white",
    cardStyle: "border-primary/20 hover:border-primary/50",
    dialogType: "user",
  },
  {
    icon: PlayCircle,
    title: "Demo Trading Account",
    description: "Practice trading with virtual money.",
    features: [
      { icon: Wallet, text: "₹1 lakh demo balance" },
      { icon: Activity, text: "Real-time market data" },
      { icon: BookOpen, text: "Risk free learning" },
    ],
    buttonText: "Start Demo Trading",
    buttonStyle: "bg-yellow-accent hover:bg-yellow-500 text-deep-blue",
    cardStyle: "border-yellow-accent/20 hover:border-yellow-accent/50 bg-yellow-50/30",
    featured: true,
    dialogType: "demo",
  },
  {
    icon: Building2,
    title: "Broker Account",
    description: "Start your own brokerage business.",
    features: [
      { icon: Users, text: "White label platform" },
      { icon: BarChart3, text: "Client dashboard" },
      { icon: DollarSign, text: "Revenue sharing" },
    ],
    buttonText: "Become a Broker",
    buttonStyle: "bg-deep-blue hover:bg-deep-blue/90 text-white",
    cardStyle: "border-deep-blue/20 hover:border-deep-blue/50",
    dialogType: "broker",
  },
]

function AccountButton({ account }) {
  const buttonElement = (
    <Button className={`w-full py-6 font-semibold ${account.buttonStyle}`}>
      {account.buttonText}
    </Button>
  )

  // Map dialog types to URLs
  const urlMap = {
    user: "/login?register=true",
    demo: "/login?demo=true",
    broker: "/broker/login"
  }

  const url = urlMap[account.dialogType]
  if (url) {
    return <Link to={url}>{buttonElement}</Link>
  }
  return buttonElement
}

export function AccountsSection() {
  return (
    <section className="py-20 lg:py-28 bg-secondary/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Accounts</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-deep-blue mb-4 text-balance">
            Join Stockex as a Broker
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Select the account that best fits your trading needs and goals.
          </p>
        </div>

        {/* Account Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {accounts.map((account, index) => (
            <div
              key={index}
              className={`relative bg-white rounded-2xl p-8 border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 ${account.cardStyle}`}
            >
              {account.featured && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-yellow-accent text-deep-blue text-xs font-bold px-4 py-1.5 rounded-full">
                    POPULAR
                  </span>
                </div>
              )}

              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <account.icon className="w-8 h-8 text-primary" />
              </div>

              <h3 className="text-xl font-bold text-deep-blue mb-2">{account.title}</h3>
              <p className="text-muted-foreground mb-6">{account.description}</p>

              {/* Features */}
              <div className="space-y-3 mb-8">
                {account.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                      <feature.icon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm text-foreground">{feature.text}</span>
                  </div>
                ))}
              </div>

              <AccountButton account={account} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
