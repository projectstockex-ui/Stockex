import { useState } from "react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Button } from "@/components/landing/ui/button"
import { Link } from "react-router-dom"
import {
  TrendingUp, TrendingDown, Hash, Trophy, Target, Timer, Users, Coins,
  Gamepad2, Zap, Star, Gift, ChevronRight, Bitcoin, Info, Crown, Award,
  HelpCircle, X, ArrowRight, Shield
} from "lucide-react"

const games = [
  {
    id: 'updown',
    name: 'Nifty Up/Down',
    description: 'Predict if Nifty will go UP or DOWN over each 15-minute IST window.',
    icon: TrendingUp,
    color: 'from-green-600 to-emerald-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    prize: '2x Returns',
    players: '1.2K',
    timeframe: '15 Min'
  },
  {
    id: 'btcupdown',
    name: 'BTC Up/Down',
    description: 'Predict if Bitcoin will go UP or DOWN — trade 24/7',
    icon: Bitcoin,
    color: 'from-orange-500 to-amber-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    prize: '2x Returns',
    players: '3.1K',
    timeframe: '15 Min'
  },
  {
    id: 'niftynumber',
    name: 'Nifty Number',
    description: 'Pick the decimal (.00-.99) of Nifty closing price & win',
    icon: Hash,
    color: 'from-purple-600 to-indigo-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    prize: 'Fixed Profit',
    players: '850',
    timeframe: '1 Day'
  },
  {
    id: 'niftybracket',
    name: 'Nifty Bracket',
    description: 'Buy or Sell on bracket levels around Nifty price',
    icon: Target,
    color: 'from-cyan-500 to-teal-500',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
    prize: '2x Returns',
    players: '1.2K',
    timeframe: '5 Min'
  },
  {
    id: 'niftyjackpot',
    name: 'Nifty Jackpot',
    description: 'Bid high & rank in top 20 to win big prizes from the kitty!',
    icon: Trophy,
    color: 'from-yellow-500 to-orange-500',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    prize: 'Top Prizes',
    players: '2.5K',
    timeframe: '1 Day'
  },
  {
    id: 'btcjackpot',
    name: 'BTC Jackpot',
    description: 'Predict BTC USD price — top 20 nearest bids share the daily prize pool',
    icon: Crown,
    color: 'from-amber-500 to-yellow-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    prize: 'Top 20 Prizes',
    players: '1.8K',
    timeframe: '1 Day'
  },
  {
    id: 'btcnumber',
    name: 'BTC Number',
    description: 'Pick the decimal (.00–.99) of BTC spot at result time & win',
    icon: Hash,
    color: 'from-amber-600 to-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    prize: 'Fixed Profit',
    players: '920',
    timeframe: '1 Day'
  }
]

export default function GamesPage() {
  const [howToPlayGame, setHowToPlayGame] = useState(null)

  const selectedGame = games.find(g => g.id === howToPlayGame)

  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0B3C6D 0%, #1A73E8 100%)' }}>
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 bg-yellow-accent/20 text-yellow-accent px-4 py-2 rounded-full text-sm font-medium mb-6">
              <Gamepad2 className="w-4 h-4" />
              Fantasy Games
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
              Predict & Win with<br />
              <span className="text-yellow-accent">7 Exciting Games</span>
            </h1>
            <p className="text-xl text-white/80 mb-8 max-w-2xl mx-auto">
              Test your market prediction skills across Nifty 50, Bitcoin, and more.
              Place bets using tickets and win multiplied returns!
            </p>
            <Link to="/login?register=true">
              <Button className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-8 py-6 text-lg">
                Open Account & Start Playing
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Games Grid */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">
              Our 7 Fantasy Games
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Each game has unique mechanics. Click "How to Play" to learn the rules before you start.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {games.map(game => (
              <div
                key={game.id}
                className={`${game.bgColor} ${game.borderColor} border rounded-2xl p-6 hover:shadow-lg transition-all duration-300 flex flex-col`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center shadow-lg`}>
                    <game.icon size={28} className="text-white" />
                  </div>
                  <div className="flex items-center gap-1 bg-white/80 px-3 py-1 rounded-full border border-gray-200">
                    <Zap size={12} className="text-yellow-500" />
                    <span className="text-xs font-semibold text-gray-700">{game.prize}</span>
                  </div>
                </div>

                <h3 className="text-xl font-bold text-deep-blue mb-2">{game.name}</h3>
                <p className="text-sm text-muted-foreground mb-4 flex-1">{game.description}</p>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {game.players} playing
                  </span>
                  <span className="flex items-center gap-1">
                    <Timer size={12} />
                    {game.timeframe}
                  </span>
                </div>

                <button
                  onClick={() => setHowToPlayGame(game.id)}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r ${game.color} text-white hover:opacity-90 transition-all flex items-center justify-center gap-2`}
                >
                  <HelpCircle size={16} />
                  How to Play
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Summary */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-deep-blue mb-4">
              How It Works
            </h2>
            <p className="text-lg text-muted-foreground">Get started in 3 easy steps</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Create Account", desc: "Sign up and fund your Games Wallet with tickets. 1 Ticket = ₹300.", icon: Shield },
              { step: "2", title: "Choose a Game", desc: "Pick any of the 7 games, read the rules, and place your bet or bid.", icon: Gamepad2 },
              { step: "3", title: "Win Rewards", desc: "Get multiplied returns, fixed profits, or jackpot prizes based on the game!", icon: Trophy },
            ].map((s, idx) => (
              <div key={idx} className="relative">
                <div className="bg-white rounded-2xl p-6 text-center border border-gray-200 hover:shadow-lg transition-all">
                  <div className="w-12 h-12 bg-yellow-accent text-deep-blue rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                    {s.step}
                  </div>
                  <h3 className="text-lg font-bold text-deep-blue mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
                {idx < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-gray-300"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-deep-blue">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Test Your Prediction Skills?
          </h2>
          <p className="text-lg text-white/70 mb-8">
            Open your account and start playing 7 exciting games today.
          </p>
          <Link to="/login?register=true">
            <Button className="bg-yellow-accent hover:bg-yellow-500 text-deep-blue font-semibold px-8 py-6 text-lg">
              Open Account & Play Now
            </Button>
          </Link>
        </div>
      </section>

      <Footer />

      {/* ====== HOW TO PLAY MODAL ====== */}
      {howToPlayGame && selectedGame && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setHowToPlayGame(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 rounded-t-2xl px-5 py-4 flex items-center justify-between z-10">
              <h2 className="font-bold text-base flex items-center gap-2 text-deep-blue">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${selectedGame.color} flex items-center justify-center`}>
                  <selectedGame.icon size={16} className="text-white" />
                </div>
                How to Play {selectedGame.name}
              </h2>
              <button onClick={() => setHowToPlayGame(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 text-sm">

              {/* ===== NIFTY UP/DOWN ===== */}
              {howToPlayGame === 'updown' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Predict whether <B color="text-green-600">NIFTY 50</B> will go <B color="text-green-600">UP</B> or <B color="text-red-500">DOWN</B> after the trading window closes.</Li>
                  <Li>Each trading window lasts <B color="text-blue-600">15 minutes</B>.</Li>
                  <Li>Result is declared <B color="text-blue-600">15 minutes after</B> the window closes.</Li>
                  <Li>Correct prediction wins <B color="text-yellow-600">1.95x</B> your bet amount.</Li>
                  <Li>Once placed, bets <B color="text-red-500">cannot be changed, modified or cancelled</B>.</Li>
                </Section>
                <Section title="Trading Window" icon={Timer} color="text-blue-500">
                  <Li>Market hours: <B color="text-blue-600">09:15 – 15:30 IST</B> (Mon–Fri).</Li>
                  <Li>Window 1: <B color="text-blue-600">9:15 - 9:30</B> → LTP at 9:30 → Result at 9:45</Li>
                  <Li>Window 2: <B color="text-blue-600">9:30 - 9:45</B> → LTP at 9:45 → Result at 10:00</Li>
                  <Li>No gap between windows — next window starts immediately.</Li>
                </Section>
                <Section title="Bet Limits" icon={Coins} color="text-purple-500">
                  <Li>Minimum: <B color="text-purple-600">1 Ticket</B> (₹300)</Li>
                  <Li>Maximum: <B color="text-purple-600">500 Tickets</B> (₹1,50,000)</Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>At window end, the <B color="text-blue-600">LTP (Last Traded Price)</B> is captured.</Li>
                  <Li>After 15 minutes, the <B color="text-purple-600">Result Price</B> is compared to the LTP.</Li>
                  <Li>Result Price {'>'} LTP → Price shown in <B color="text-green-600">GREEN</B> → UP wins!</Li>
                  <Li>Result Price {'<'} LTP → Price shown in <B color="text-red-500">RED</B> → DOWN wins!</Li>
                  <Li>Result Price = LTP → <B color="text-yellow-600">Tie (bet refunded)</B>.</Li>
                </HighlightBox>
                <Example
                  text="Window 9:15-9:30. LTP at 9:30 = 22,800. Result at 9:45 = 22,803."
                  result="22,803 > 22,800 → UP wins! You get 10 × 1.95 = 19.5 Tickets (minus 5% brokerage)"
                />
                <TipsBox>
                  <Li>Watch the live chart to spot momentum before betting.</Li>
                  <Li>Start with small bets to understand the timing.</Li>
                  <Li>Avoid betting during low-volatility sideways markets.</Li>
                </TipsBox>
              </>)}

              {/* ===== BTC UP/DOWN ===== */}
              {howToPlayGame === 'btcupdown' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Predict whether <B color="text-orange-500">Bitcoin (BTC)</B> will go <B color="text-green-600">UP</B> or <B color="text-red-500">DOWN</B>.</Li>
                  <Li>This game runs <B color="text-blue-600">24/7, 365 days</B> — trade anytime, even weekends!</Li>
                  <Li>Continuous <B color="text-blue-600">15-minute trading windows</B> with no gaps.</Li>
                  <Li>Win <B color="text-yellow-600">1.95x</B> your bet on a correct prediction.</Li>
                </Section>
                <Section title="Trading Windows" icon={Timer} color="text-blue-500">
                  <Li>Each window is <B color="text-blue-600">15 minutes</B> long (e.g. 1:00:00–1:14:59).</Li>
                  <Li>The official <B color="text-purple-600">result</B> is published <B color="text-purple-600">15 minutes after</B> the window ends (e.g. 1:30:00).</Li>
                  <Li>The app shows <B color="text-green-600">UP</B> or <B color="text-red-500">DOWN</B> from that result — pick the right side to win.</Li>
                </Section>
                <Section title="Bet Limits" icon={Coins} color="text-purple-500">
                  <Li>Minimum: <B color="text-purple-600">1 Ticket</B> (₹300)</Li>
                  <Li>Maximum: <B color="text-purple-600">500 Tickets</B> (₹1,50,000)</Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>Place your bet (UP or DOWN) during the <B color="text-green-600">15-minute window</B>.</Li>
                  <Li>When the <B color="text-purple-600">result time</B> arrives, the official outcome appears.</Li>
                  <Li>If your side matches the result, you win (e.g. <B color="text-green-600">UP</B> shown and you bet UP).</Li>
                </HighlightBox>
                <Example
                  text="Window: 14:00–14:15. You bet 5 Tkt DOWN. At 14:30 the result shows DOWN — you win."
                  result="5 × 1.95 = 9.75 Tkt (minus 5% brokerage on profit where applicable)"
                />
                <TipsBox>
                  <Li>BTC is highly volatile — great for profits but be cautious.</Li>
                  <Li>Once bet is placed, it <B color="text-red-500">cannot be cancelled or modified</B>.</Li>
                  <Li>Major news events can cause sudden big moves — trade wisely.</Li>
                </TipsBox>
              </>)}

              {/* ===== NIFTY NUMBER ===== */}
              {howToPlayGame === 'niftynumber' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Pick the <B color="text-purple-600">last 2 decimal digits</B> (.00 to .99) of the Nifty 50 closing price.</Li>
                  <Li>If Nifty closes at 24,850<B color="text-yellow-600">.75</B>, the winning number is <B color="text-yellow-600">75</B>.</Li>
                  <Li>Correct guess wins a <B color="text-green-600">fixed profit of ₹4,000</B>.</Li>
                  <Li>You can place up to <B color="text-blue-600">10 bets per day</B> on different numbers.</Li>
                </Section>
                <Section title="Timing" icon={Timer} color="text-blue-500">
                  <Li>Betting opens: <B color="text-blue-600">09:15 IST</B>.</Li>
                  <Li>Last bet time: <B color="text-blue-600">15:40 IST</B>.</Li>
                  <Li>Result declared at: <B color="text-green-600">15:30 IST</B> (based on Nifty closing price).</Li>
                </Section>
                <Section title="Bet Limits" icon={Coins} color="text-purple-500">
                  <Li>Min per bet: <B color="text-purple-600">1 Ticket</B></Li>
                  <Li>Max per bet: <B color="text-purple-600">100 Tickets</B></Li>
                  <Li>Max bets per day: <B color="text-purple-600">10</B></Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>Pick any number from <B color="text-yellow-600">00 to 99</B> from the grid.</Li>
                  <Li>At market close, the last 2 decimals of Nifty closing price are checked.</Li>
                  <Li>If your number matches → <B color="text-green-600">You WIN ₹4,000 fixed profit!</B></Li>
                  <Li>If not → <B color="text-red-500">You lose your bet amount.</B></Li>
                </HighlightBox>
                <Example
                  text="You bet 2 Tickets on number 75. Nifty closes at 24,850.75."
                  result="WIN! You get ₹4,000 profit (minus 10% brokerage)"
                />
                <TipsBox>
                  <Li>There are 100 possible numbers (00-99), each has ~1% chance.</Li>
                  <Li>Spread bets across multiple numbers to improve your odds.</Li>
                  <Li>Use smaller bet amounts per number to manage risk.</Li>
                </TipsBox>
              </>)}

              {/* ===== NIFTY BRACKET ===== */}
              {howToPlayGame === 'niftybracket' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Two bracket levels are set around the current Nifty price: <B color="text-green-600">+20 points (Upper)</B> and <B color="text-red-500">-20 points (Lower)</B>.</Li>
                  <Li>Choose <B color="text-green-600">BUY</B> (price will hit upper bracket) or <B color="text-red-500">SELL</B> (price will hit lower bracket).</Li>
                  <Li>If your target is hit before expiry → <B color="text-green-600">WIN 2x</B>!</Li>
                  <Li>If time expires without hitting target → <B color="text-red-500">You lose</B>.</Li>
                </Section>
                <Section title="Timing" icon={Timer} color="text-blue-500">
                  <Li>Market hours: <B color="text-blue-600">09:15 – 15:45 IST</B>.</Li>
                  <Li>Each trade has a <B color="text-blue-600">5 minute</B> expiry timer.</Li>
                  <Li>Trade resolves immediately if the bracket level is hit, or at expiry.</Li>
                </Section>
                <Section title="Bet Limits" icon={Coins} color="text-purple-500">
                  <Li>Minimum: <B color="text-purple-600">1 Ticket</B></Li>
                  <Li>Maximum: <B color="text-purple-600">250 Tickets</B></Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>Current Nifty = 24,000. Upper target = <B color="text-green-600">24,020</B>. Lower target = <B color="text-red-500">23,980</B>.</Li>
                  <Li>You click <B color="text-green-600">BUY</B> → betting price will reach the upper bracket.</Li>
                  <Li>If Nifty touches 24,020 within 5 min → <B color="text-green-600">WIN 2x!</B></Li>
                  <Li>If 5 minutes pass and neither level hit → <B color="text-red-500">Trade lost.</B></Li>
                </HighlightBox>
                <Example
                  text="Nifty is at 24,000. You BUY 10 Tickets. Upper target = 24,020. Nifty hits 24,020 after 2 min."
                  result="WIN! You get 10 × 2 = 20 Tickets (minus 5% brokerage)"
                />
                <TipsBox>
                  <Li>Trade during high-volatility periods (market open, news events).</Li>
                  <Li>The bracket gap is 20 points — trade when Nifty is moving fast!</Li>
                  <Li>Multiple active trades are allowed simultaneously.</Li>
                </TipsBox>
              </>)}

              {/* ===== NIFTY JACKPOT ===== */}
              {howToPlayGame === 'niftyjackpot' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Nifty Jackpot is a <B color="text-yellow-600">daily bidding game</B> where you compete against other users.</Li>
                  <Li>Place a bid using your tickets. All bids go into a common <B color="text-purple-600">Kitty Amount</B>.</Li>
                  <Li>Top <B color="text-yellow-600">10</B> ranked users win prizes from the Kitty.</Li>
                  <Li>Only <B color="text-red-500">1 bid per day</B> is allowed per user.</Li>
                </Section>
                <Section title="Bidding Window" icon={Timer} color="text-blue-500">
                  <Li>Bidding opens at <B color="text-blue-600">09:15 IST</B>.</Li>
                  <Li>Bidding closes at <B color="text-blue-600">14:59 IST</B>.</Li>
                  <Li>Results declared at <B color="text-green-600">15:30 IST</B>.</Li>
                </Section>
                <Section title="Bid Limits" icon={Coins} color="text-purple-500">
                  <Li>Minimum: <B color="text-purple-600">1 Ticket</B> (₹300)</Li>
                  <Li>Maximum: <B color="text-purple-600">500 Tickets</B> (₹1,50,000)</Li>
                </Section>
                <HighlightBox title="Ranking Logic (How You Get 1st or 2nd)" icon={Crown}>
                  <Li>Users are ranked by <B color="text-yellow-600">Bid Amount (highest first)</B>.</Li>
                  <Li>If two users bid the <B color="text-yellow-600">same amount</B>, the one who bid <B color="text-blue-600">earlier in time</B> gets the higher rank.</Li>
                </HighlightBox>
                <div className="space-y-2">
                  <Example
                    label="Example 1: Different Amounts"
                    text="User A bids 50 Tkt at 10:20:01. User B bids 40 Tkt at 10:19:15."
                    result="User A is #1 (higher bid amount wins)"
                  />
                  <Example
                    label="Example 2: Same Amount, Different Time"
                    text="User A bids 50 Tkt at 10:20:01. User B bids 50 Tkt at 10:19:15."
                    result="User B is #1 (same amount, but bid earlier)"
                  />
                </div>
                <Section title="Kitty Amount & Prize Pool" icon={Zap} color="text-green-500">
                  <Li>Every bid is added to the <B color="text-purple-600">Kitty Amount</B> (grows in real-time).</Li>
                  <Li>A <B color="text-red-500">5% brokerage</B> is deducted from the total Kitty.</Li>
                  <Li>Remaining amount is distributed as prizes to top 10 winners.</Li>
                </Section>
                <Section title="After Result" icon={Award} color="text-green-500">
                  <Li><B color="text-green-600">Winners (Top 10):</B> Bid refunded + prize money.</Li>
                  <Li><B color="text-red-500">Losers:</B> Bid amount is lost.</Li>
                </Section>
                <TipsBox>
                  <Li><B>Bid higher</B> to secure a better rank and bigger prize.</Li>
                  <Li><B>Bid early</B> — if someone bids the same amount, the earlier bid wins.</Li>
                  <Li>Watch the <B color="text-purple-600">Live Top 5</B> to see where you stand.</Li>
                  <Li>You only get <B color="text-red-500">1 chance per day</B> — choose wisely!</Li>
                </TipsBox>
              </>)}

              {/* ===== BTC JACKPOT ===== */}
              {howToPlayGame === 'btcjackpot' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Place tickets with your <B color="text-amber-600">predicted BTC (USD) price</B> — one ticket per bid.</Li>
                  <Li>All stakes go into the daily <B color="text-purple-600">prize pool (Bank)</B>.</Li>
                  <Li>Top <B color="text-yellow-600">20</B> tickets nearest to the official BTC close win prizes.</Li>
                  <Li>You can update your predicted price during the bidding window (stake stays the same).</Li>
                </Section>
                <Section title="Bidding Window" icon={Timer} color="text-blue-500">
                  <Li>Bidding runs through the day (typically until <B color="text-blue-600">23:29 IST</B>).</Li>
                  <Li>BTC is locked at result time; winners ranked by <B color="text-amber-600">nearest to official close</B>.</Li>
                  <Li>Tie on distance → <B color="text-blue-600">earlier bid</B> ranks higher on the live board.</Li>
                </Section>
                <Section title="Bid Limits" icon={Coins} color="text-purple-500">
                  <Li>Minimum: <B color="text-purple-600">1 Ticket</B> (₹300)</Li>
                  <Li>Maximum per ticket set by admin (often up to <B color="text-purple-600">5000 Tickets</B>)</Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>Live rank uses distance to <B color="text-amber-600">live BTC spot</B>.</Li>
                  <Li>Final prizes use the <B color="text-amber-600">locked close price</B> at settlement.</Li>
                  <Li>Winners: stake refunded + share of the prize pool by rank.</Li>
                </HighlightBox>
                <TipsBox>
                  <Li>Bid prices close to live BTC for a better live rank.</Li>
                  <Li>Earlier tickets win ties at the same distance.</Li>
                  <Li>Watch the live top ranks before bidding closes.</Li>
                </TipsBox>
              </>)}

              {/* ===== BTC NUMBER ===== */}
              {howToPlayGame === 'btcnumber' && (<>
                <Section title="Game Overview" icon={Star} color="text-yellow-500">
                  <Li>Pick the <B color="text-amber-600">last 2 decimal digits</B> (.00 to .99) of BTC spot at result time.</Li>
                  <Li>If BTC is <B color="text-yellow-600">76,123.65</B>, the winning number is <B color="text-yellow-600">65</B>.</Li>
                  <Li>Correct guess wins a <B color="text-green-600">fixed profit</B> (same style as Nifty Number).</Li>
                  <Li>Up to <B color="text-blue-600">10 bets per day</B> on different numbers.</Li>
                </Section>
                <Section title="Timing" icon={Timer} color="text-blue-500">
                  <Li>Result declared at <B color="text-green-600">23:30 IST</B> (BTC spot locked at that time).</Li>
                  <Li>Bidding window follows admin settings for start / end times.</Li>
                </Section>
                <Section title="Bet Limits" icon={Coins} color="text-purple-500">
                  <Li>Min per bet: <B color="text-purple-600">1 Ticket</B></Li>
                  <Li>Max per bet: <B color="text-purple-600">100 Tickets</B></Li>
                  <Li>Max bets per day: <B color="text-purple-600">10</B></Li>
                </Section>
                <HighlightBox title="How You Win" icon={Crown}>
                  <Li>Pick any number <B color="text-yellow-600">00–99</B> from the grid.</Li>
                  <Li>Winning decimal comes from official BTC spot at result time.</Li>
                  <Li>Match → fixed gross prize; no match → stake lost.</Li>
                </HighlightBox>
                <Example
                  text="You bet 2 Tickets on number 65. BTC locks at 76,123.65."
                  result="WIN! Fixed profit credited to your games wallet (minus brokerage per rules)"
                />
                <TipsBox>
                  <Li>100 possible outcomes — spread picks across numbers to manage risk.</Li>
                  <Li>Result time aligns with BTC Jackpot lock when both run same day.</Li>
                </TipsBox>
              </>)}

            </div>

            {/* Close Button */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 rounded-b-2xl px-5 py-4">
              <button
                onClick={() => setHowToPlayGame(null)}
                className={`w-full py-3 bg-gradient-to-r ${selectedGame.color} text-white font-bold rounded-xl text-sm hover:opacity-90 transition-all`}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

/* ── Reusable sub-components for clean modal content ── */

function Section({ title, icon: Icon, color, children }) {
  return (
    <div>
      <h3 className={`font-bold ${color} mb-2 flex items-center gap-1.5 text-sm`}>
        <Icon size={14} /> {title}
      </h3>
      <ul className="text-gray-600 space-y-1.5 pl-1">{children}</ul>
    </div>
  )
}

function HighlightBox({ title, icon: Icon, children }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
      <h3 className="font-bold text-yellow-600 mb-2 flex items-center gap-1.5 text-sm">
        <Icon size={14} /> {title}
      </h3>
      <ul className="text-gray-600 space-y-1.5 pl-1">{children}</ul>
    </div>
  )
}

function TipsBox({ children }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
      <h3 className="font-bold text-blue-600 mb-2 flex items-center gap-1.5 text-sm">
        <Info size={14} /> Pro Tips
      </h3>
      <ul className="text-gray-600 space-y-1.5 pl-1">{children}</ul>
    </div>
  )
}

function Example({ label, text, result }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      {label && <div className="text-xs text-yellow-600 font-bold mb-1">{label}</div>}
      <div className="text-gray-500 text-xs">{text}</div>
      <div className="text-green-600 font-bold text-xs mt-1">{result}</div>
    </div>
  )
}

function Li({ children }) {
  return <li className="text-sm leading-relaxed">{children}</li>
}

function B({ color = "text-gray-900", children }) {
  return <span className={`${color} font-semibold`}>{children}</span>
}
