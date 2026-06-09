import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { PlayCircle, Check, Wallet, Activity, Shield, Monitor } from "lucide-react"
import { DemoTradingDialog } from "@/components/landing/auth-dialogs"

const features = [
  { icon: Wallet, title: "1,00,000 Virtual Balance", desc: "Practice with virtual money without any risk." },
  { icon: Activity, title: "Real-Time Simulation", desc: "Experience live market conditions." },
  { icon: Shield, title: "Risk-Free Learning", desc: "Learn trading without losing real money." },
  { icon: Monitor, title: "Full Platform Access", desc: "Access all trading tools and features." },
]

const benefits = [
  "No time limit on demo account",
  "Real-time market data",
  "All trading instruments available",
  "Practice different strategies",
  "Track your performance",
  "Switch to live anytime",
  "Educational resources included",
  "24/7 platform access",
]

export default function DemoAccount() {
  return (
    <main className="min-h-screen bg-deep-blue">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="w-16 h-16 bg-green-500/20 rounded-2xl flex items-center justify-center mb-6">
                <PlayCircle className="w-8 h-8 text-green-400" />
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Demo Trading Account
              </h1>
              <p className="text-xl text-white/70 mb-8">
                Practice trading with virtual money. Perfect for beginners to learn strategies without risking real capital.
              </p>
              
              <div className="flex flex-wrap gap-4 mb-8">
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-green-400">1,00,000</div>
                  <div className="text-sm text-white/60">Virtual Balance</div>
                </div>
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-green-400">Free</div>
                  <div className="text-sm text-white/60">No Charges</div>
                </div>
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-green-400">Unlimited</div>
                  <div className="text-sm text-white/60">Time Period</div>
                </div>
              </div>

              <DemoTradingDialog
                trigger={
                  <Button size="lg" className="bg-green-500 hover:bg-green-600 text-white font-semibold px-10 py-6 text-lg">
                    Start Demo Trading
                  </Button>
                }
              />
            </div>

            {/* Benefits Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-8">
              <h3 className="text-xl font-bold text-white mb-6">Demo Account Benefits</h3>
              <ul className="space-y-4">
                {benefits.map((benefit, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                    <span className="text-white">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">
              Learn Trading Risk-Free
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our demo account gives you everything you need to practice and learn.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow text-center">
                <div className="w-14 h-14 bg-green-500/10 rounded-xl flex items-center justify-center mb-4 mx-auto">
                  <feature.icon className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="text-lg font-bold text-deep-blue mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <DemoTradingDialog
              trigger={
                <Button size="lg" className="bg-green-600 hover:bg-green-700 text-white font-semibold px-10 py-6 text-lg">
                  Open Demo Account
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
