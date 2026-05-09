/**
 * Token Renewal Configuration
 * Centralized configuration for token renewal system
 */

export const TokenRenewalConfig = {
  // Token expiration settings (12 hours as requested)
  tokenExpiration: {
    maxTokenAge: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
    expirationThreshold: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
    checkInterval: 10 * 60 * 1000, // 10 minutes in milliseconds
  },

  // WebSocket settings
  websocket: {
    maxReconnectAttempts: 5,
    reconnectDelay: 5000,
    heartbeatInterval: 30000,
    autoReconnect: false, // Disabled for production stability
  },

  // Session management
  session: {
    sessionFilePath: '.zerodha-session.json',
    backupInterval: 60 * 60 * 1000, // 1 hour
  },

  // OAuth settings
  oauth: {
    apiKey: process.env.ZERODHA_API_KEY,
    apiSecret: process.env.ZERODHA_API_SECRET,
    redirectUrl: process.env.ZERODHA_REDIRECT_URL || 'http://localhost:3000/zerodha/callback',
  },

  // Monitoring settings
  monitoring: {
    enableMetrics: true,
    enableLogging: true,
    logLevel: 'info',
  },

  // Production settings
  production: {
    enableAutoRenewal: true,
    enableHealthChecks: true,
    enableCircuitBreaker: true,
  }
};

export default TokenRenewalConfig;
