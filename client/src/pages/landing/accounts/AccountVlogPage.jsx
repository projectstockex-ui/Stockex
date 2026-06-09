import { Link, useParams, Navigate } from 'react-router-dom';
import { Navbar } from '@/components/landing/navbar';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/landing/ui/button';
import { getJoinAccountBySlug } from '@/data/joinStockexAccounts';
import { JoinStockexSignupButton } from '@/components/landing/JoinStockexSignupButton';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Play,
  Sparkles,
  Flame,
  Radio,
} from 'lucide-react';

export default function AccountVlogPage() {
  const { slug } = useParams();
  const account = getJoinAccountBySlug(slug);

  if (!account) {
    return <Navigate to="/" replace />;
  }

  const { vlog, casino } = account;
  const Icon = account.icon;

  return (
    <main className={`min-h-screen ${casino ? 'bg-[#0f0518]' : 'bg-[#060d18]'}`}>
      <Navbar />

      {/* Vlog hero — story opener */}
      <section
        className={`pt-28 pb-16 relative overflow-hidden bg-gradient-to-br ${vlog.heroGradient}`}
      >
        {casino && (
          <>
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_20%_50%,#f0abfc,transparent_50%),radial-gradient(circle_at_80%_20%,#c084fc,transparent_40%),radial-gradient(circle_at_50%_80%,#f472b6,transparent_45%)]" />
            <div className="absolute top-24 left-10 w-32 h-32 bg-fuchsia-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-10 right-10 w-40 h-40 bg-pink-500/20 rounded-full blur-3xl animate-pulse" />
          </>
        )}

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm mb-8 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Join Stockex
          </Link>

          {casino && (
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="inline-flex items-center gap-1.5 bg-red-500/90 text-white text-xs font-bold px-3 py-1 rounded-full animate-pulse">
                <Radio className="w-3 h-3" /> LIVE GAMES
              </span>
              <span className="inline-flex items-center gap-1.5 bg-fuchsia-500/80 text-white text-xs font-bold px-3 py-1 rounded-full">
                <Flame className="w-3 h-3" /> EVERY 15 MIN
              </span>
              <span className="inline-flex items-center gap-1.5 bg-yellow-500/90 text-deep-blue text-xs font-bold px-3 py-1 rounded-full">
                <Sparkles className="w-3 h-3" /> SKILL BASED
              </span>
            </div>
          )}

          <div className="flex items-start gap-4 mb-6">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${
                casino
                  ? 'bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-lg shadow-fuchsia-500/50'
                  : 'bg-white/15'
              }`}
            >
              <Icon className={`w-8 h-8 ${casino ? 'text-white' : vlog.accent}`} />
            </div>
            <div>
              <p className="text-white/60 text-sm uppercase tracking-widest mb-1">Stockex Vlog</p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
                {account.title}
              </h1>
            </div>
          </div>

          <p className="text-xl text-white/80 mb-8 max-w-2xl">{vlog.tagline}</p>

          <div className="flex flex-wrap gap-3">
            <JoinStockexSignupButton
              account={account}
              size="lg"
              className={
                casino
                  ? 'bg-gradient-to-r from-fuchsia-500 via-purple-500 to-pink-500 hover:opacity-90 text-white font-bold px-8 py-6 text-lg shadow-xl shadow-fuchsia-500/30'
                  : `${vlog.accentBg} hover:opacity-90 text-deep-blue font-semibold px-8 py-6 text-lg`
              }
            >
              <Play className="w-5 h-5 mr-2" />
              {account.ctaLabel}
            </JoinStockexSignupButton>
            <JoinStockexSignupButton
              account={{
                signupHref:
                  account.id === 'brokerage'
                    ? '/broker/login?register=true'
                    : '/login?register=true',
              }}
              size="lg"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 px-8 py-6 text-lg bg-transparent"
            >
              Create Demo Account
            </JoinStockexSignupButton>
          </div>
        </div>
      </section>

      {/* Vlog chapters */}
      <section className={`py-16 ${casino ? 'bg-[#0f0518]' : 'bg-[#060d18]'}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-10">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                casino ? 'bg-fuchsia-500/20' : 'bg-cyan-500/20'
              }`}
            >
              <Play className={`w-5 h-5 ${casino ? 'text-fuchsia-400' : 'text-cyan-400'}`} />
            </div>
            <h2 className="text-2xl font-bold text-white">
              Watch the full story
            </h2>
          </div>

          <div className="space-y-8">
            {vlog.chapters.map((chapter, i) => (
              <article
                key={i}
                className={`rounded-2xl p-6 sm:p-8 border transition hover:shadow-lg ${
                  casino
                    ? 'bg-white/5 border-fuchsia-500/20 hover:border-fuchsia-400/40'
                    : 'bg-slate-900/70 border-cyan-500/20 hover:border-cyan-400/40 backdrop-blur-sm'
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      casino
                        ? 'bg-fuchsia-500/30 text-fuchsia-100'
                        : 'bg-cyan-500/25 text-cyan-100'
                    }`}
                  >
                    EP {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    {chapter.title}
                  </h3>
                </div>
                <p className="leading-relaxed text-[15px] sm:text-base text-gray-100 font-normal tracking-wide">
                  {chapter.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Summary + CTA */}
      <section className={`py-16 ${casino ? 'bg-gradient-to-b from-[#0f0518] to-[#1a0a2e]' : 'bg-[#0a1628]'}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            className={`rounded-2xl p-8 border-2 ${
              casino
                ? 'border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-950/50 to-purple-950/50 shadow-2xl shadow-fuchsia-500/10'
                : 'border-cyan-500/30 bg-gradient-to-br from-slate-900/80 to-blue-950/40 shadow-xl shadow-cyan-500/5'
            }`}
          >
            <h2 className="text-2xl font-bold mb-6 text-white">
              Quick summary
            </h2>
            <ul className="space-y-3 mb-8">
              {vlog.summary.map((point, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Check
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      casino ? 'text-fuchsia-400' : 'text-emerald-400'
                    }`}
                  />
                  <span className="text-gray-100 text-[15px] leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-3">
              <JoinStockexSignupButton
                account={account}
                className={
                  casino
                    ? 'bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:opacity-90 text-white font-bold'
                    : 'bg-primary hover:bg-primary/90 text-white'
                }
              >
                {account.ctaLabel}
                <ArrowRight className="w-4 h-4 ml-2" />
              </JoinStockexSignupButton>
              <Link to="/">
                <Button variant="outline" className="border-white/25 text-white hover:bg-white/10 bg-transparent">
                  Compare all paths
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
