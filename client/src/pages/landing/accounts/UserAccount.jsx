import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { User, Check, Shield, Zap, BarChart3, Wallet, HeadphonesIcon, Smartphone } from "lucide-react"
import { OpenAccountDialog } from "@/components/landing/auth-dialogs"

const features = [
  { icon: BarChart3, title: "Trade All Markets", desc: "Access Stocks, Indices, Commodities, and Currency markets." },
  { icon: Zap, title: "Real-Time Data", desc: "Get live market quotes, charts, and news." },
  { icon: Shield, title: "Secure Trading", desc: "Bank-grade security with 2FA authentication." },
  { icon: Wallet, title: "Easy Fund Transfer", desc: "Instant deposits via UPI, Net Banking." },
  { icon: Smartphone, title: "Trade Anywhere", desc: "Access from web, mobile, or desktop." },
  { icon: HeadphonesIcon, title: "24/7 Support", desc: "Dedicated customer support team." },
]

const benefits = [
  "Zero account opening charges",
  "Free demat account",
  "Competitive brokerage rates",
  "Advanced charting tools",
  "Portfolio analytics dashboard",
  "Market research & tips",
  "IPO & Mutual Fund access",
  "Margin trading facility",
]

export default function UserAccount() {
  return (
    <main className="min-h-screen bg-deep-blue">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="w-16 h-16 bg-yellow-accent/20 rounded-2xl flex items-center justify-center mb-6">
                <User className="w-8 h-8 text-yellow-accent" />
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                User Trading Account
              </h1>
              <p className="text-xl text-white/70 mb-8">
                Start your trading journey with our comprehensive trading account. Access all Indian markets with professional tools.
              </p>
              
              <div className="flex flex-wrap gap-4 mb-8">
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-yellow-accent">Free</div>
                  <div className="text-sm text-white/60">Account Opening</div>
                </div>
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-yellow-accent">0</div>
                  <div className="text-sm text-white/60">Delivery Brokerage</div>
                </div>
                <div className="bg-white/10 rounded-xl px-6 py-4 text-center">
                  <div className="text-2xl font-bold text-yellow-accent">20</div>
                  <div className="text-sm text-white/60">Per Intraday Order</div>
                </div>
              </div>

              <OpenAccountDialog
                trigger={
                  <Button size="lg" className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-10 py-6 text-lg">
                    Open Account Now
                  </Button>
                }
              />
            </div>

            {/* Benefits Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-8">
              <h3 className="text-xl font-bold text-white mb-6">Account Benefits</h3>
              <ul className="space-y-4">
                {benefits.map((benefit, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 bg-yellow-accent/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-yellow-accent" />
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
              Everything You Need to Trade
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our trading account comes packed with features to help you succeed.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-deep-blue mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to Open Section */}
      <section className="py-20 bg-secondary/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-deep-blue mb-4">Open Account in 3 Simple Steps</h2>
            <p className="text-muted-foreground">Get started in minutes with our paperless process.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Sign Up", desc: "Enter your mobile number and email." },
              { step: "2", title: "Verify KYC", desc: "Complete Aadhaar-based eKYC online." },
              { step: "3", title: "Start Trading", desc: "Fund your account and start trading." },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="w-16 h-16 bg-yellow-accent text-deep-blue rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="text-lg font-bold text-deep-blue mb-2">{item.title}</h3>
                <p className="text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <OpenAccountDialog
              trigger={
                <Button size="lg" className="bg-deep-blue hover:bg-deep-blue/90 text-white font-semibold px-10 py-6 text-lg">
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
