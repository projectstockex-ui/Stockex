import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Gamepad2,
  TrendingUp,
  LayoutDashboard,
  Users,
  Activity,
  MessageCircle,
  Star,
  CheckCircle,
  XCircle,
  ChevronRight,
  Download,
  Mail,
  Timer,
  Send,
  Facebook,
  Twitter,
  Linkedin,
  Instagram,
  Menu,
  X,
  Play,
  Award,
  Shield,
  UserPlus,
  Brain,
  Trophy,
  Target
} from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [certifiedBrokers, setCertifiedBrokers] = useState([]);
  const [loadingBrokers, setLoadingBrokers] = useState(true);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    message: ''
  });

  // IQ Quiz State
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  const quizQuestions = [
    {
      question: "Who is the Prime Minister of India?",
      options: ["Rahul Gandhi", "Narendra Modi", "Amit Shah", "Yogi Adityanath"],
      correct: 1
    },
    {
      question: "What is the tallest statue in India?",
      options: ["Statue of Unity", "Statue of Liberty", "Thiruvalluvar Statue", "Shivaji Statue"],
      correct: 0
    },
    {
      question: "What is the longest river in India?",
      options: ["Yamuna", "Brahmaputra", "Ganga", "Godavari"],
      correct: 2
    },
    {
      question: "What is the capital of India?",
      options: ["Mumbai", "Kolkata", "New Delhi", "Chennai"],
      correct: 2
    },
    {
      question: "What is the Maruti 800?",
      options: ["A motorcycle", "India's first affordable car", "A train", "An airplane"],
      correct: 1
    }
  ];

  const getQuizResult = (score) => {
    if (score === 5) return { message: "Your IQ is great!", color: "text-green-400", emoji: "🏆" };
    if (score === 4) return { message: "Your IQ level is great!", color: "text-green-400", emoji: "🌟" };
    if (score === 3) return { message: "Yes, you can do it!", color: "text-yellow-400", emoji: "💪" };
    if (score === 2) return { message: "You can do much better!", color: "text-orange-400", emoji: "📈" };
    if (score === 1) return { message: "You can do better!", color: "text-orange-400", emoji: "🎯" };
    return { message: "Keep learning and try again!", color: "text-red-400", emoji: "📚" };
  };

  const handleAnswerSelect = (questionIndex, answerIndex) => {
    setSelectedAnswers({ ...selectedAnswers, [questionIndex]: answerIndex });
  };

  const handleNextQuestion = () => {
    if (currentQuestion < quizQuestions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Calculate score
      let score = 0;
      quizQuestions.forEach((q, index) => {
        if (selectedAnswers[index] === q.correct) score++;
      });
      setCorrectCount(score);
      setQuizCompleted(true);
    }
  };

  const resetQuiz = () => {
    setQuizStarted(false);
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setQuizCompleted(false);
    setCorrectCount(0);
  };

  // Fetch certified brokers on mount
  useEffect(() => {
    const fetchCertifiedBrokers = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
        const response = await fetch(`${API_URL}/user/certified-brokers`);
        const data = await response.json();
        if (data.brokers) {
          setCertifiedBrokers(data.brokers);
        }
      } catch (error) {
        console.error('Error fetching certified brokers:', error);
      } finally {
        setLoadingBrokers(false);
      }
    };
    fetchCertifiedBrokers();
  }, []);

  // Handle broker card click - redirect to registration with broker code
  const handleBrokerClick = (broker) => {
    navigate(`/login?register=true&ref=${broker.referralCode}`);
  };

  const navLinks = [
    { name: 'Home', href: '#home' },
    { name: 'About', href: '#about' },
    { name: 'Services', href: '#services' },
    { name: 'Brokers', href: '#brokers' },
    { name: 'Features', href: '#features' },
    { name: 'Testimonials', href: '#testimonials' },
    { name: 'Contact', href: '#contact' }
  ];

  const services = [
    {
      icon: Gamepad2,
      title: 'Smart Trading Games',
      description: 'Gamified market trading focused on skill, strategy, and live execution. Turn your market knowledge into competitive advantage through interactive trading challenges.',
      color: 'text-purple-500'
    },
    {
      icon: TrendingUp,
      title: 'Pledge & Delivery Ready',
      description: 'Trade smarter with delivery options and pledge margin facilities—offering flexibility for both long-term investors and short-term traders. Unlock capital without selling your holdings.',
      color: 'text-green-500'
    },
    {
      icon: LayoutDashboard,
      title: 'Customizable Dashboard',
      description: 'Tailor your trading interface with widgets, charts, and layouts that suit your unique trading style. Create a workspace that works the way you think.',
      color: 'text-blue-500'
    },
    {
      icon: Users,
      title: 'Broker Bridge',
      description: "Whether you're a broker scaling up or a client stepping in—StockEx connects both on one seamless platform. Grow your network. Grow your impact. Build lasting partnerships.",
      color: 'text-orange-500'
    },
    {
      icon: Activity,
      title: 'Live Market Core',
      description: 'Get lightning-fast prices, index movements, and derivatives data with zero delay—power your next move in real time. Stay ahead with institutional-grade market data.',
      color: 'text-red-500'
    },
    {
      icon: MessageCircle,
      title: 'Live Chat Support',
      description: 'Connect with our dedicated support team instantly through in-app live chat for quick assistance. Get answers when you need them, without waiting.',
      color: 'text-cyan-500'
    }
  ];

  const testimonials = [
    {
      name: 'Rajesh Kumar',
      role: 'Senior Broker, Mumbai',
      experience: '3+ years with StockEx',
      quote: 'StockEx has completely transformed how I manage my clients. The broker dashboard is intuitive, and the pledge margin feature has been a game-changer for my F&O traders. Highly recommend to any serious broker looking to scale.'
    },
    {
      name: 'Priya Sharma',
      role: 'Active Trader, Delhi',
      experience: 'Trading since 2023',
      quote: 'I was hesitant to try another trading platform, but StockEx proved me wrong. The smart trading games helped me sharpen my skills before going live. The real-time data and support team are top-notch. This is trading reimagined.'
    },
    {
      name: 'Amit Patel',
      role: 'First-Time Investor, Bangalore',
      experience: '6 months trading experience',
      quote: "As a beginner, I needed a platform that wouldn't overwhelm me. StockEx's demo environment and educational games gave me confidence. Now I'm trading with real money and actually making profits. The community support is incredible!"
    },
    {
      name: 'Neha Desai',
      role: 'Professional Trader, Pune',
      experience: 'Portfolio: 25L+',
      quote: "The delivery pledge feature is brilliant! I can hold my long-term stocks and still leverage them for F&O trading. It's like having my cake and eating it too. The platform is fast, reliable, and the customer service responds within minutes."
    },
    {
      name: 'Vikram Singh',
      role: 'Independent Broker, Ahmedabad',
      experience: '150+ active clients',
      quote: "StockEx helped me transition from working under another broker to building my own client base. The onboarding process is seamless, and my clients love the mobile app. I've grown my business 3x in just one year!"
    },
    {
      name: 'Sanjay Mehta',
      role: 'Day Trader, Hyderabad',
      experience: '10+ years trading experience',
      quote: "I've used at least 5 different trading platforms, and StockEx stands out for its simplicity and power. The customizable dashboard lets me set up my workspace exactly how I need it. Plus, the live market data is incredibly accurate and fast."
    }
  ];

  const blogPosts = [
    {
      title: "A First-Time Trader's Guide with StockEx",
      category: 'Investments, Stock Market',
      date: 'July 2, 2025',
      preview: 'Learn the fundamentals of stock trading and discover how StockEx makes your first steps into the market smooth and confident.'
    },
    {
      title: '5 Top Terms Every Stock Trader Should Know',
      category: 'Investments, Stock Market',
      date: 'July 2, 2025',
      preview: 'Master the essential vocabulary that will help you navigate the trading world like a professional.'
    },
    {
      title: 'Top 5 Myths About Stock Market Trading – Busted',
      category: 'Investments, Stock Market',
      date: 'July 2, 2025',
      preview: 'Separate fact from fiction and learn the truth about common misconceptions that hold traders back.'
    }
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
    alert('Thank you for your message! We will get back to you within 24 hours.');
    setFormData({ firstName: '', lastName: '', email: '', message: '' });
  };

  return (
    <div className="min-h-screen bg-dark-900 text-white">
      {/* Navigation */}
      <header className="fixed w-full z-50 bg-dark-900/95 backdrop-blur-md border-b border-dark-700">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <span className="text-2xl font-bold">
                <span className="text-blue-500">Stock</span><span className="text-green-400">Ex</span>
              </span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-gray-300 hover:text-green-400 transition-colors duration-200 text-sm font-medium"
                >
                  {link.name}
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-4">
              <Link to="/login" className="text-gray-300 hover:text-white transition px-4 py-2">
                Login
              </Link>
              <Link to="/login?register=true" className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 px-5 py-2 rounded-lg font-medium transition">
                Get Started
              </Link>
            </div>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-dark-700">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="block py-2 text-gray-300 hover:text-green-400"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.name}
                </a>
              ))}
              <div className="flex gap-4 mt-4">
                <Link to="/login" className="text-gray-300 hover:text-white">Login</Link>
                <Link to="/login?register=true" className="text-green-400">Get Started</Link>
              </div>
            </div>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <section id="home" className="relative pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20">
          <div className="text-center">
            <p className="text-green-400 font-semibold mb-4 tracking-wide">ENABLING BROKERS, EMPOWERING CLIENTS</p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6">
              <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
                Master the Markets
              </span>
              <br />
              <span>
                with <span className="text-blue-500">Stock</span><span className="text-green-400">Ex</span>
              </span>
            </h1>
            <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
              Trading made better with strategic skill-based games
            </p>

            {/* App Store Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <a href="#" className="flex items-center justify-center gap-3 bg-dark-800 hover:bg-dark-700 border border-dark-600 px-6 py-3 rounded-xl transition group">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z" />
                </svg>
                <div className="text-left">
                  <p className="text-xs text-gray-400">Download on the</p>
                  <p className="font-semibold">App Store</p>
                </div>
              </a>
              <a href="#" className="flex items-center justify-center gap-3 bg-dark-800 hover:bg-dark-700 border border-dark-600 px-6 py-3 rounded-xl transition group">
                <Play className="w-8 h-8 text-green-400" />
                <div className="text-left">
                  <p className="text-xs text-gray-400">Get it on</p>
                  <p className="font-semibold">Play Store</p>
                </div>
              </a>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 max-w-3xl mx-auto">
              <div className="text-center">
                <p className="text-3xl sm:text-4xl font-bold text-green-400">1M+</p>
                <p className="text-gray-400 text-sm mt-1">Downloads</p>
              </div>
              <div className="text-center">
                <p className="text-3xl sm:text-4xl font-bold text-green-400">50K+</p>
                <p className="text-gray-400 text-sm mt-1">Active Traders</p>
              </div>
              <div className="text-center">
                <p className="text-3xl sm:text-4xl font-bold text-green-400">1,000+</p>
                <p className="text-gray-400 text-sm mt-1">Registered Brokers</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-20 bg-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">About StockEx</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">A Next-Gen Online Trading Platform</h2>
            <p className="text-gray-400 max-w-3xl mx-auto text-lg">
              StockEx is designed to empower brokers to seamlessly onboard and manage their clients under one unified interface. With a platform that provides access to both demo and real-money trading environments, we offer a complete ecosystem for learning, growth, and performance excellence.
            </p>
          </div>

          {/* Three-Step Framework */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="relative bg-dark-800 border border-dark-600 rounded-2xl p-8 hover:border-green-500/50 transition group">
              <div className="absolute -top-4 left-8 bg-green-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
              <h3 className="text-xl font-bold mb-4 mt-2">Register with StockEx</h3>
              <p className="text-gray-400">Join the largest and fastest-growing broker community in India</p>
            </div>
            <div className="relative bg-dark-800 border border-dark-600 rounded-2xl p-8 hover:border-green-500/50 transition group">
              <div className="absolute -top-4 left-8 bg-green-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
              <h3 className="text-xl font-bold mb-4 mt-2">Trade For Your Clients</h3>
              <p className="text-gray-400">Leverage the most advanced and transparent trading platform in the market</p>
            </div>
            <div className="relative bg-dark-800 border border-dark-600 rounded-2xl p-8 hover:border-green-500/50 transition group">
              <div className="absolute -top-4 left-8 bg-green-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
              <h3 className="text-xl font-bold mb-4 mt-2">Grow Your Business</h3>
              <p className="text-gray-400">From live trading to strategic skill-based games—earn smarter and scale faster</p>
            </div>
          </div>

          {/* Quote */}
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-8 text-center">
            <p className="text-xl italic text-gray-300">
              "Explore StockEx in Action. Get a quick glimpse of how StockEx simplifies trading for beginners and pros alike."
            </p>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Awesome Features</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Things that Make StockEx Unique</h2>
            <p className="text-gray-400 text-lg">Amazing Features For Smart Traders</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {services.map((service, index) => (
              <div
                key={index}
                className="bg-dark-800 border border-dark-600 rounded-2xl p-8 hover:border-green-500/50 hover:transform hover:-translate-y-1 transition-all duration-300 group"
              >
                <service.icon className={`w-12 h-12 ${service.color} mb-6`} />
                <h3 className="text-xl font-bold mb-4">{service.title}</h3>
                <p className="text-gray-400">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Certified Brokers Section */}
      <section id="brokers" className="py-20 bg-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Certified Partners</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Our Trusted Brokers</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Join hands with our verified and certified brokers. Click on any broker to create your trading account under their expert guidance.
            </p>
          </div>

          {loadingBrokers ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
            </div>
          ) : certifiedBrokers.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {certifiedBrokers.map((broker) => (
                <div
                  key={broker.id}
                  onClick={() => handleBrokerClick(broker)}
                  className="bg-dark-800 border border-dark-600 rounded-2xl p-6 hover:border-green-500/50 hover:transform hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
                >
                  {/* Broker Header */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500/20 to-emerald-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      {broker.logoUrl ? (
                        <img src={broker.logoUrl} alt={broker.name} className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <Award className="w-8 h-8 text-green-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold truncate group-hover:text-green-400 transition">{broker.name}</h3>
                      {broker.brandName && <p className="text-gray-400 text-sm truncate">{broker.brandName}</p>}
                      <div className="flex items-center gap-1 mt-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${i < broker.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Certificate Badge */}
                  <div className="flex items-center gap-2 mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                    <Shield className="w-4 h-4 text-green-400" />
                    <span className="text-green-400 text-sm font-medium">Verified Broker</span>
                    <span className="text-yellow-400 text-xs ml-auto font-mono">{broker.referralCode}</span>
                  </div>

                  {/* Broker Details */}
                  {broker.description && (
                    <p className="text-gray-400 text-sm mb-4 line-clamp-2">{broker.description}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {broker.specialization && (
                      <div>
                        <p className="text-gray-500 text-xs">Specialization</p>
                        <p className="text-white text-sm font-medium">{broker.specialization}</p>
                      </div>
                    )}
                    {broker.yearsOfExperience > 0 && (
                      <div>
                        <p className="text-gray-500 text-xs">Experience</p>
                        <p className="text-white text-sm font-medium">{broker.yearsOfExperience}+ Years</p>
                      </div>
                    )}
                    {broker.totalClients > 0 && (
                      <div>
                        <p className="text-gray-500 text-xs">Active Clients</p>
                        <p className="text-white text-sm font-medium">{broker.totalClients.toLocaleString()}+</p>
                      </div>
                    )}
                  </div>

                  {/* CTA Button */}
                  <button className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition group-hover:shadow-lg group-hover:shadow-green-500/25">
                    <UserPlus className="w-5 h-5" />
                    Create Account
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Award className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No certified brokers available at the moment.</p>
              <p className="text-gray-500 text-sm mt-2">Check back soon or create a direct account.</p>
              <Link
                to="/login?register=true"
                className="inline-flex items-center gap-2 mt-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 px-6 py-3 rounded-lg font-semibold transition"
              >
                <UserPlus className="w-5 h-5" />
                Create Direct Account
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Features Section - Delivery Pledge */}
      <section id="features" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Exclusive Feature</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Delivery Pledge</h2>
            <p className="text-gray-400 text-lg">Experience A New Trading World—That Empowers New-Age Traders</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left - Description */}
            <div>
              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 mb-8">
                <p className="text-gray-300 leading-relaxed mb-6">
                  When you purchase equity delivery on NSE through your StockEx account, those shares are automatically pledged to us, and up to 50% of their value is released as margin. This margin is exclusively available for trading in Futures & Options (F&O) and cannot be utilized for additional equity purchases.
                </p>
                <div className="bg-dark-700 rounded-xl p-6">
                  <h4 className="font-semibold text-green-400 mb-4">Example:</h4>
                  <ul className="space-y-3 text-gray-300">
                    <li className="flex items-start gap-3">
                      <ChevronRight className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>Buy Reliance shares worth 1,00,000 → 50,000 margin becomes immediately available for F&O trades</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <ChevronRight className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>Your Reliance shares remain securely held in your StockEx account as collateral</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <ChevronRight className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>No paperwork, no delays—instant margin utilization</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Process Flow */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { step: '1', title: 'Buy & Hold', desc: 'Purchase delivery-based (cash equity) shares via StockEx' },
                  { step: '2', title: 'Pledge', desc: 'Shares are automatically marked as pledged, 50% value unlocked' },
                  { step: '3', title: 'Trade F&O', desc: 'Margin can be used solely for NSE Futures & Options trading' },
                  { step: '4', title: 'Unpledge', desc: 'Request to unpledge shares anytime with a simple click' }
                ].map((item, index) => (
                  <div key={index} className="bg-dark-800 border border-dark-600 rounded-xl p-4">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center font-bold mb-3">{item.step}</div>
                    <h4 className="font-semibold mb-2">{item.title}</h4>
                    <p className="text-gray-400 text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right - Usage Guidelines */}
            <div>
              <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8 mb-8">
                <h4 className="text-xl font-bold mb-6">Usage Guidelines</h4>

                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="font-semibold text-green-400">Permitted</span>
                  </div>
                  <ul className="space-y-3 text-gray-300 ml-8">
                    <li>Margin can be used for trading in Futures & Options</li>
                    <li>Seamless integration with your existing F&O strategies</li>
                    <li>Instant margin credit upon share purchase</li>
                  </ul>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <XCircle className="w-6 h-6 text-red-500" />
                    <span className="font-semibold text-red-400">Not Permitted</span>
                  </div>
                  <ul className="space-y-3 text-gray-300 ml-8">
                    <li>Margin cannot be used to purchase additional equity shares</li>
                    <li>Cannot be withdrawn as cash</li>
                    <li>Not applicable for intraday trading</li>
                  </ul>
                </div>
              </div>

              {/* Additional Benefits */}
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-green-500/10 to-transparent border border-green-500/20 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">Simplicity Matters</h4>
                  <p className="text-gray-400">Because clarity creates confidence</p>
                </div>
                <div className="bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">User-Friendly by Design</h4>
                  <p className="text-gray-400">Our app is intuitive and easy to navigate—no confusion, just clarity</p>
                </div>
                <div className="bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/20 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">Effortless Navigation</h4>
                  <p className="text-gray-400">We cut the clutter so you can focus on what truly matters—getting things done</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Our Impact</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">People Who Trusted Us</h2>
            <p className="text-gray-400 text-lg">See What Our Users Are Saying</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="bg-dark-800 border border-dark-600 rounded-2xl p-8 hover:border-green-500/50 transition"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-300 mb-6 italic">"{testimonial.quote}"</p>
                <div className="border-t border-dark-600 pt-4">
                  <p className="font-semibold">{testimonial.name}</p>
                  <p className="text-gray-400 text-sm">{testimonial.role}</p>
                  <p className="text-green-400 text-sm mt-1">{testimonial.experience}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* IQ Quiz Section */}
      <section className="py-20 bg-gradient-to-b from-purple-900/20 to-dark-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-purple-400 font-semibold mb-2">Test Yourself</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Let's Test Your IQ Level</h2>
            <p className="text-gray-400 text-lg">Take this quick 5-question quiz to test your general knowledge!</p>
          </div>

          <div className="max-w-2xl mx-auto">
            {!quizStarted ? (
              <div className="text-center bg-dark-800 border border-purple-500/30 rounded-2xl p-8">
                <Brain className="w-16 h-16 text-purple-400 mx-auto mb-6" />
                <p className="text-gray-300 mb-6">Challenge yourself with 5 simple questions about India. Are you ready?</p>
                <button
                  onClick={() => setQuizStarted(true)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-10 py-4 rounded-xl font-bold text-lg transition flex items-center gap-3 mx-auto"
                >
                  <Target className="w-6 h-6" />
                  Start Quiz
                </button>
              </div>
            ) : quizCompleted ? (
              <div className="text-center bg-dark-800 border border-purple-500/30 rounded-2xl p-8">
                <Trophy className="w-20 h-20 text-yellow-400 mx-auto mb-6" />
                <h3 className="text-3xl font-bold mb-4">Quiz Completed!</h3>
                <p className="text-gray-400 text-lg mb-4">You got {correctCount} out of {quizQuestions.length} correct</p>
                <p className={`text-3xl font-bold mb-8 ${getQuizResult(correctCount).color}`}>
                  {getQuizResult(correctCount).emoji} {getQuizResult(correctCount).message}
                </p>
                <button
                  onClick={resetQuiz}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-8 py-3 rounded-xl font-semibold transition"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="bg-dark-800 border border-purple-500/30 rounded-2xl p-8">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-purple-400 font-bold text-lg">Question {currentQuestion + 1} of {quizQuestions.length}</span>
                  <div className="flex gap-2">
                    {quizQuestions.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-3 h-3 rounded-full transition ${idx < currentQuestion ? 'bg-green-500' : idx === currentQuestion ? 'bg-purple-500 animate-pulse' : 'bg-dark-600'
                          }`}
                      />
                    ))}
                  </div>
                </div>
                <h4 className="text-xl font-bold mb-6">{quizQuestions[currentQuestion].question}</h4>
                <div className="space-y-3 mb-8">
                  {quizQuestions[currentQuestion].options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAnswerSelect(currentQuestion, idx)}
                      className={`w-full text-left px-5 py-4 rounded-xl border-2 transition ${selectedAnswers[currentQuestion] === idx
                          ? 'border-purple-500 bg-purple-500/20 text-white'
                          : 'border-dark-600 bg-dark-700 hover:border-purple-500/50 text-gray-300'
                        }`}
                    >
                      <span className="font-bold mr-3 text-purple-400">{String.fromCharCode(65 + idx)}.</span>
                      {option}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between items-center">
                  <button
                    onClick={resetQuiz}
                    className="text-gray-400 hover:text-white transition px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleNextQuestion}
                    disabled={selectedAnswers[currentQuestion] === undefined}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3 rounded-xl font-semibold transition"
                  >
                    {currentQuestion < quizQuestions.length - 1 ? 'Next Question →' : 'Submit Quiz'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Blog Section */}
      <section className="py-20 bg-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Stay Up To Date</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Why Us?</h2>
            <p className="text-gray-400 text-lg">Empowering Your Trading Journey with Innovation, Speed, and Simplicity</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {blogPosts.map((post, index) => (
              <div
                key={index}
                className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden hover:border-green-500/50 transition group"
              >
                <div className="h-48 bg-gradient-to-br from-green-500/20 to-emerald-500/10 flex items-center justify-center">
                  <TrendingUp className="w-16 h-16 text-green-500/50" />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                    <span>{post.category}</span>
                    <span>•</span>
                    <span>{post.date}</span>
                  </div>
                  <h3 className="text-lg font-bold mb-3 group-hover:text-green-400 transition">{post.title}</h3>
                  <p className="text-gray-400 text-sm">{post.preview}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-3xl p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyIi8+PC9nPjwvZz48L3N2Zz4=')] opacity-30"></div>
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">Join The Community</h2>
              <p className="text-xl mb-2">Download the App Now</p>
              <p className="text-white/80 mb-8">Trade Like a Pro—Without the Complexity</p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                <a href="#" className="flex items-center justify-center gap-3 bg-white text-dark-900 px-6 py-3 rounded-xl font-medium hover:bg-gray-100 transition">
                  <Download className="w-5 h-5" />
                  <span>Download on App Store</span>
                </a>
                <a href="#" className="flex items-center justify-center gap-3 bg-white text-dark-900 px-6 py-3 rounded-xl font-medium hover:bg-gray-100 transition">
                  <Play className="w-5 h-5" />
                  <span>Get it on Play Store</span>
                </a>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-8 text-white/90">
                <div>
                  <span className="text-2xl font-bold">1Mn+</span>
                  <span className="ml-2">Downloads</span>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/30"></div>
                <div>Trusted by thousands of brokers and traders nationwide</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-green-400 font-semibold mb-2">Contact Us</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Get in Touch</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              If you have a question, feedback, or need support, feel free to reach out. Our team is here to help you succeed.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div>
              <div className="space-y-6">
                <div className="flex items-start gap-4 bg-dark-800 border border-dark-600 rounded-xl p-6">
                  <Mail className="w-6 h-6 text-green-400 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold mb-1">Email Us</h4>
                    <a href="mailto:info@stockex.co.in" className="text-gray-400 hover:text-green-400 transition">
                      info@stockex.co.in
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4 bg-dark-800 border border-dark-600 rounded-xl p-6">
                  <Timer className="w-6 h-6 text-green-400 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold mb-1">Business Hours</h4>
                    <p className="text-gray-400">Monday - Friday: 9:00 AM - 6:00 PM IST</p>
                    <p className="text-gray-400">Saturday: 10:00 AM - 4:00 PM IST</p>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-green-500/10 to-transparent border border-green-500/20 rounded-xl p-6">
                  <p className="text-gray-300">
                    <span className="text-green-400 font-semibold">Response Time:</span> We typically respond within 24 hours on business days.
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="bg-dark-800 border border-dark-600 rounded-2xl p-8">
              <h3 className="text-xl font-bold mb-6">Leave Us a Message</h3>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">First Name</label>
                    <input
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Last Name</label>
                    <input
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email Address</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Your Message</label>
                  <textarea
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition resize-none"
                    required
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
                >
                  <Send className="w-5 h-5" />
                  Submit
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-dark-900 border-t border-dark-700 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
            {/* Company Info */}
            <div>
              <span className="text-2xl font-bold">
                <span className="text-blue-500">Stock</span><span className="text-green-400">Ex</span>
              </span>
              <p className="text-gray-400 mt-4">
                The next-gen trading app that gives you seamless access to the stock market—all from your mobile device.
              </p>
              <div className="flex gap-4 mt-6">
                <a href="#" className="w-10 h-10 bg-dark-700 rounded-full flex items-center justify-center hover:bg-green-500 transition">
                  <Facebook className="w-5 h-5" />
                </a>
                <a href="#" className="w-10 h-10 bg-dark-700 rounded-full flex items-center justify-center hover:bg-green-500 transition">
                  <Twitter className="w-5 h-5" />
                </a>
                <a href="#" className="w-10 h-10 bg-dark-700 rounded-full flex items-center justify-center hover:bg-green-500 transition">
                  <Linkedin className="w-5 h-5" />
                </a>
                <a href="#" className="w-10 h-10 bg-dark-700 rounded-full flex items-center justify-center hover:bg-green-500 transition">
                  <Instagram className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#home" className="hover:text-green-400 transition">Home</a></li>
                <li><a href="#features" className="hover:text-green-400 transition">Features</a></li>
                <li><a href="#" className="hover:text-green-400 transition">Tutorials</a></li>
                <li><a href="#" className="hover:text-green-400 transition">Growth</a></li>
              </ul>
            </div>

            {/* Useful Links */}
            <div>
              <h4 className="font-semibold mb-4">Useful Links</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#" className="hover:text-green-400 transition">Terms & Conditions</a></li>
                <li><a href="#" className="hover:text-green-400 transition">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-green-400 transition">Refund Policy</a></li>
                <li><a href="#" className="hover:text-green-400 transition">Risk Disclosure</a></li>
              </ul>
            </div>

            {/* Newsletter */}
            <div>
              <h4 className="font-semibold mb-4">Subscribe for Newsletter</h4>
              <p className="text-gray-400 text-sm mb-4">
                Get the latest news, features, and market insights—straight to your inbox.
              </p>
              <form className="flex gap-2">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-green-500 transition"
                />
                <button
                  type="submit"
                  className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-lg transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Login Links */}
          <div className="border-t border-dark-700 pt-8 mb-8">
            <div className="flex flex-wrap justify-center gap-6 text-sm">
              <Link to="/login" className="text-gray-400 hover:text-green-400 transition">User Login</Link>
              <Link to="/superadmin/login" className="text-gray-400 hover:text-yellow-400 transition">Super Admin</Link>
              <Link to="/admin/login" className="text-gray-400 hover:text-blue-400 transition">Admin</Link>
              <Link to="/broker/login" className="text-gray-400 hover:text-orange-400 transition">Broker</Link>
              <Link to="/subbroker/login" className="text-gray-400 hover:text-pink-400 transition">Sub Broker</Link>
            </div>
          </div>

          {/* Copyright */}
          <div className="border-t border-dark-700 pt-8 text-center">
            <p className="text-gray-400 text-sm mb-4">
              Copyright © StockEx 2025. All rights reserved.
            </p>
            <p className="text-gray-500 text-xs max-w-3xl mx-auto">
              Trading in securities market involves substantial risk. Please read all related documents carefully before investing. StockEx is a technology platform and does not provide investment advice.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
