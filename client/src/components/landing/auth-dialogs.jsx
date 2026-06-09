
import { useState } from "react"
import { Button } from "@/components/landing/ui/button"
import { Input } from "@/components/landing/ui/input"
import { Label } from "@/components/landing/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/landing/ui/dialog"
import { Eye, EyeOff, Mail, Lock, User, Phone, Briefcase, Globe, MessageSquare, HeadphonesIcon, PlayCircle, Building2, Wallet, TrendingUp } from "lucide-react"


export function LoginDialog({ trigger }) {
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    // Handle login logic here
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">Welcome Back</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Sign in to access your trading account
            </DialogDescription>
          </DialogHeader>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="login-email" className="text-sm font-medium text-foreground">
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="login-email"
                type="email"
                placeholder="Enter your email"
                className="pl-10 h-11"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                className="pl-10 pr-10 h-11"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-semibold"
            disabled={isLoading}
          >
            {isLoading ? "Signing In..." : "Sign In"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <span className="text-primary hover:underline cursor-pointer font-medium">
              Open Account
            </span>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}


export function OpenAccountDialog({ trigger, title, description, submitLabel }) {
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (formData.password !== formData.confirmPassword) {
      alert("Passwords do not match")
      return
    }
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    // Handle registration logic here
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">{title || 'Create Account'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {description || 'Start your trading journey with Stockex'}
            </DialogDescription>
          </DialogHeader>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="register-name" className="text-sm font-medium text-foreground">
              Full Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="register-name"
                type="text"
                placeholder="Enter your full name"
                className="pl-10 h-11"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-email" className="text-sm font-medium text-foreground">
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="register-email"
                type="email"
                placeholder="Enter your email"
                className="pl-10 h-11"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-phone" className="text-sm font-medium text-foreground">
              Phone Number
            </Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="register-phone"
                type="tel"
                placeholder="Enter your phone number"
                className="pl-10 h-11"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-password" className="text-sm font-medium text-foreground">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="register-password"
                type={showPassword ? "text" : "password"}
                placeholder="Create a password"
                className="pl-10 pr-10 h-11"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-confirm-password" className="text-sm font-medium text-foreground">
              Confirm Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="register-confirm-password"
                type={showPassword ? "text" : "password"}
                placeholder="Confirm your password"
                className="pl-10 h-11"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-semibold"
            disabled={isLoading}
          >
            {isLoading ? "Creating Account..." : (submitLabel || "Create Account")}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <span className="text-primary hover:underline cursor-pointer font-medium">
              Sign In
            </span>
          </p>

          <p className="text-xs text-muted-foreground text-center">
            By creating an account, you agree to our{" "}
            <span className="text-primary hover:underline cursor-pointer">Terms of Service</span>
            {" "}and{" "}
            <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}


export function TalkToTeamDialog({ trigger }) {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    message: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    setSubmitted(true)
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) setSubmitted(false) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <HeadphonesIcon className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground">Talk to Our Team</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground">
              Our partnership team will get back to you within 24 hours.
            </DialogDescription>
          </DialogHeader>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-foreground">Message Sent!</h3>
            <p className="text-muted-foreground text-sm max-w-xs">
              Thank you for reaching out. A member of our partnership team will contact you within 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="talk-firstname" className="text-sm font-medium text-foreground">First Name</Label>
                <Input
                  id="talk-firstname"
                  type="text"
                  placeholder="First name"
                  className="h-11"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="talk-lastname" className="text-sm font-medium text-foreground">Last Name</Label>
                <Input
                  id="talk-lastname"
                  type="text"
                  placeholder="Last name"
                  className="h-11"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="talk-email" className="text-sm font-medium text-foreground">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="talk-email"
                  type="email"
                  placeholder="Enter your email"
                  className="pl-10 h-11"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="talk-phone" className="text-sm font-medium text-foreground">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="talk-phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  className="pl-10 h-11"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="talk-company" className="text-sm font-medium text-foreground">Company <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="talk-company"
                  type="text"
                  placeholder="Your company name"
                  className="pl-10 h-11"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="talk-message" className="text-sm font-medium text-foreground">Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <textarea
                  id="talk-message"
                  rows={3}
                  placeholder="How can we help you?"
                  className="w-full rounded-md border border-input bg-background pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-semibold"
              disabled={isLoading}
            >
              {isLoading ? "Sending..." : "Send Message"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}


const partnerTypes = [
  { value: "introducing-broker", label: "Introducing Broker (IB)" },
  { value: "trading-community", label: "Trading Community" },
  { value: "content-creator", label: "Content Creator / Influencer" },
  { value: "white-label", label: "White Label" },
  { value: "other", label: "Other" },
]

export function DemoTradingDialog({ trigger }) {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    setSubmitted(true)
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) setSubmitted(false) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
                <PlayCircle className="w-5 h-5 text-green-600" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground">Start Demo Trading</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground">
              Practice trading with ?1,00,000 virtual balance. Risk-free learning!
            </DialogDescription>
          </DialogHeader>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-foreground">Demo Account Created!</h3>
            <p className="text-muted-foreground text-sm max-w-xs">
              Your demo account is ready. Check your email for login credentials and start practicing!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="demo-name" className="text-sm font-medium text-foreground">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="demo-name"
                  type="text"
                  placeholder="Enter your full name"
                  className="pl-10 h-11"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="demo-email" className="text-sm font-medium text-foreground">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="demo-email"
                  type="email"
                  placeholder="Enter your email"
                  className="pl-10 h-11"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="demo-phone" className="text-sm font-medium text-foreground">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="demo-phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  className="pl-10 h-11"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold"
              disabled={isLoading}
            >
              {isLoading ? "Creating Demo Account..." : "Start Demo Trading"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}


export function BrokerProgramDialog({ trigger, title, description, submitLabel }) {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    experience: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    setSubmitted(true)
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) setSubmitted(false) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground">{title || 'Become a Broker'}</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground">
              {description || 'Start your own brokerage business with our white-label solution.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-foreground">Application Submitted!</h3>
            <p className="text-muted-foreground text-sm max-w-xs">
              Our broker partnership team will review your application and contact you within 2 business days.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="broker-name" className="text-sm font-medium text-foreground">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="broker-name"
                  type="text"
                  placeholder="Enter your full name"
                  className="pl-10 h-11"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="broker-email" className="text-sm font-medium text-foreground">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="broker-email"
                  type="email"
                  placeholder="Enter your email"
                  className="pl-10 h-11"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="broker-phone" className="text-sm font-medium text-foreground">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="broker-phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  className="pl-10 h-11"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="broker-company" className="text-sm font-medium text-foreground">Company Name</Label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="broker-company"
                  type="text"
                  placeholder="Your company name"
                  className="pl-10 h-11"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="broker-experience" className="text-sm font-medium text-foreground">Trading Experience</Label>
              <select
                id="broker-experience"
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                value={formData.experience}
                onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                required
              >
                <option value="" disabled>Select your experience</option>
                <option value="1-2">1-2 years</option>
                <option value="3-5">3-5 years</option>
                <option value="5-10">5-10 years</option>
                <option value="10+">10+ years</option>
              </select>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-semibold"
              disabled={isLoading}
            >
              {isLoading ? "Submitting..." : (submitLabel || "Apply for Broker Program")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}


export function DepositDialog({ trigger }) {
  const [submitted, setSubmitted] = useState(false)

  return (
    <Dialog onOpenChange={(open) => { if (!open) setSubmitted(false) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
                <Wallet className="w-5 h-5 text-green-600" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground">Deposit Funds</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground">
              Add funds to your trading account securely.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h4 className="font-semibold text-blue-800 mb-2">Deposit Methods:</h4>
            <ul className="text-sm text-blue-700 space-y-2">
              <li className="flex items-center gap-2">? UPI - Instant deposit</li>
              <li className="flex items-center gap-2">? Net Banking - All major banks</li>
              <li className="flex items-center gap-2">? IMPS/NEFT - Bank transfer</li>
            </ul>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Please login to your account to make a deposit.
          </p>

          <Button className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold">
            Login to Deposit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}


export function StartTradingDialog({ trigger }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-yellow-500/10 via-yellow-500/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-yellow-500/10 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-yellow-600" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground">Start Trading</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground">
              Access India's financial markets with STOCKEX.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">50K+</div>
              <div className="text-xs text-muted-foreground">Active Traders</div>
            </div>
            <div className="bg-muted/50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">?500Cr</div>
              <div className="text-xs text-muted-foreground">Monthly Volume</div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Open a free account to start trading stocks, indices, commodities, and currencies.
          </p>

          <Button className="w-full h-11 bg-yellow-500 hover:bg-yellow-600 text-deep-blue font-semibold">
            Open Free Account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}


export function BecomePartnerDialog({ trigger }) {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    website: "",
    partnerType: "",
    message: "",
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    setSubmitted(true)
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) setSubmitted(false) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">Become a Partner</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Join the VXNESS Partner Programme and grow your business with us.
            </DialogDescription>
          </DialogHeader>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-foreground">Application Received!</h3>
            <p className="text-muted-foreground text-sm max-w-xs">
              Thank you for your interest in partnering with VXNESS. Our partnership team will review your application and reach out within 1?2 business days.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="partner-name" className="text-sm font-medium text-foreground">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="partner-name"
                  type="text"
                  placeholder="Enter your full name"
                  className="pl-10 h-11"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="partner-email" className="text-sm font-medium text-foreground">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="partner-email"
                  type="email"
                  placeholder="Enter your email"
                  className="pl-10 h-11"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="partner-phone" className="text-sm font-medium text-foreground">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="partner-phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  className="pl-10 h-11"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-2">
              <Label htmlFor="partner-company" className="text-sm font-medium text-foreground">Company / Organisation <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="partner-company"
                  type="text"
                  placeholder="Your company name"
                  className="pl-10 h-11"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
            </div>

            {/* Website */}
            <div className="space-y-2">
              <Label htmlFor="partner-website" className="text-sm font-medium text-foreground">Website / Social Profile <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="partner-website"
                  type="url"
                  placeholder="https://yourwebsite.com"
                  className="pl-10 h-11"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />
              </div>
            </div>

            {/* Partner Type */}
            <div className="space-y-2">
              <Label htmlFor="partner-type" className="text-sm font-medium text-foreground">Partnership Type</Label>
              <select
                id="partner-type"
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                value={formData.partnerType}
                onChange={(e) => setFormData({ ...formData, partnerType: e.target.value })}
                required
              >
                <option value="" disabled>Select a partnership type</option>
                {partnerTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="partner-message" className="text-sm font-medium text-foreground">Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <textarea
                  id="partner-message"
                  rows={3}
                  placeholder="Tell us about your audience, experience or goals..."
                  className="w-full rounded-md border border-input bg-background pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-semibold"
              disabled={isLoading}
            >
              {isLoading ? "Submitting..." : "Submit Application"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              By submitting, you agree to our{" "}
              <span className="text-primary hover:underline cursor-pointer">Terms of Service</span>
              {" "}and{" "}
              <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
