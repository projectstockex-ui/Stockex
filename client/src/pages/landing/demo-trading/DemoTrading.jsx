import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { PlayCircle, TrendingUp, Shield, Zap, BarChart3, BookOpen, Target, RefreshCw } from "lucide-react"

const features = [
  {
    icon: TrendingUp,
    title: "1,00,000 Virtual Balance",
    description: "Start with a generous virtual balance to practice trading across all markets without any risk.",
  },
  {
    icon: Zap,
    title: "Real-Time Market Simulation",
    description: "Experience live market conditions with real-time price feeds and order execution.",
  },
  {
    icon: Shield,
    title: "Risk-Free Learning",
    description: "Make mistakes, learn strategies, and build confidence without risking real money.",
  },
  {
    icon: BarChart3,
    title: "Full Platform Access",
    description: "Access all trading tools, charts, and features available in the live trading platform.",
  },
  {
    icon: BookOpen,
    title: "Educational Resources",
    description: "Learn trading with our comprehensive guides, tutorials, and market analysis.",
  },
  {
    icon: Target,
    title: "Practice All Strategies",
    description: "Test different trading strategies including day trading, swing trading, and investing.",
  },
  {
    icon: RefreshCw,
    title: "Reset Anytime",
    description: "Reset your demo balance whenever you want to start fresh with new strategies.",
  },
  {
    icon: PlayCircle,
    title: "No Time Limit",
    description: "Practice for as long as you need. Your demo account never expires.",
  },
]

const steps = [
  {
    step: "1",
    title: "Create Demo Account",
    description: "Sign up in seconds with just your email. No documents required.",
  },
  {
    step: "2",
    title: "Get Virtual Funds",
    description: "Receive 1,00,000 virtual balance instantly credited to your account.",
  },
  {
    step: "3",
    title: "Start Trading",
    description: "Practice trading stocks, indices, commodities, and currencies risk-free.",
  },
  {
    step: "4",
    title: "Go Live When Ready",
    description: "Switch to a live account anytime and start trading with real money.",
  },
]

export default function DemoTrading() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0B3C6D 0%, #1A73E8 100%)' }}>
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-yellow-accent/20 text-yellow-accent px-4 py-2 rounded-full text-sm font-medium mb-6">
                <PlayCircle className="w-4 h-4" />
                Risk-Free Trading
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
                Practice Trading with a Demo Account
              </h1>
              <p className="text-xl text-white/80 mb-8">
                Start learning trading with virtual money and real market simulation. Build your skills and confidence before trading with real capital.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-8 py-6 text-lg">
                  Open Demo Account
                </Button>
                <Button className="bg-white hover:bg-white/90 text-deep-blue font-semibold px-8 py-6 text-lg">
                  Watch Tutorial
                </Button>
              </div>
            </div>
            
            {/* Demo Dashboard Preview */}
            <div className="relative">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                <div className="bg-gray-900 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-white font-semibold">Demo Account</span>
                    <span className="text-yellow-accent text-sm">Virtual Trading</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-800 rounded-lg p-3">
                      <div className="text-gray-400 text-xs mb-1">Balance</div>
                      <div className="text-white font-bold text-lg">1,00,000</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-3">
                      <div className="text-gray-400 text-xs mb-1">P&L Today</div>
                      <div className="text-green-400 font-bold text-lg">+2,450</div>
                    </div>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white text-sm">NIFTY 50</span>
                      <span className="text-green-400 text-sm">+0.85%</span>
                    </div>
                    <div className="h-16 flex items-end gap-1">
                      {[40, 45, 42, 48, 52, 50, 55, 58, 54, 60, 65, 62].map((h, i) => (
                        <div key={i} className="flex-1 bg-green-500/50 rounded-t" style={{ height: `${h}%` }}></div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">
              Everything You Need to Learn Trading
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our demo account gives you full access to all trading features with zero risk.
            </p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg hover:border-primary/30 transition-all duration-300">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-deep-blue mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-secondary/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">
              How to Get Started
            </h2>
            <p className="text-lg text-muted-foreground">
              Start practicing in just a few simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                <div className="bg-white rounded-2xl p-6 text-center border border-border">
                  <div className="w-12 h-12 bg-yellow-accent text-deep-blue rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                    {step.step}
                  </div>
                  <h3 className="text-lg font-bold text-deep-blue mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-border"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-deep-blue">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Start Learning?
          </h2>
          <p className="text-lg text-white/70 mb-8">
            Open your free demo account today and start practicing with 1,00,000 virtual balance.
          </p>
          <Button className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-8 py-6 text-lg">
            Open Demo Account - It's Free
          </Button>
        </div>
      </section>

      <Footer />
    </main>
  )
}
