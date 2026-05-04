/**
 * Environment Configuration Utility
 * 
 * Clean and scalable environment-based URL configuration
 * Follows SOLID principles with single responsibility
 */

class EnvironmentConfig {
  detectProduction() {
    return (
      process.env.NODE_ENV === 'production' ||
      process.env.FRONTEND_URL?.includes('stockex.in') ||
      process.env.FRONTEND_URL?.includes('stockex.com') ||
      process.env.CLIENT_URL?.includes('stockex.in') ||
      process.env.CLIENT_URL?.includes('stockex.com') ||
      process.env.SERVER_URL?.includes('stockex.in') ||
      process.env.SERVER_URL?.includes('stockex.com')
    );
  }

  /**
   * Get base URL based on environment
   */
  getBaseUrl() {
    const frontend = process.env.FRONTEND_URL || process.env.CLIENT_URL;
    if (frontend) {
      return String(frontend).replace(/\/$/, '');
    }

    if (this.detectProduction()) {
      // Avoid localhost fallback in production.
      return (process.env.SERVER_URL || 'https://stockex.in').replace(/\/$/, '');
    }

    return 'http://localhost:3000';
  }

  /**
   * Get callback URL for Zerodha OAuth
   */
  getCallbackUrl() {
    const serverBase = (process.env.SERVER_URL || '').replace(/\/$/, '');
    if (serverBase) {
      return `${serverBase}/api/zerodha/callback`;
    }

    if (this.detectProduction()) {
      return 'https://stockex.in/api/zerodha/callback';
    }
    return 'http://localhost:5001/api/zerodha/callback';
  }

  /**
   * Get dashboard redirect URLs
   */
  getDashboardUrls() {
    const baseUrl = this.getBaseUrl();
    return {
      success: `${baseUrl}/superadmin/dashboard?zerodha=connected`,
      error: `${baseUrl}/superadmin/dashboard?zerodha=error`
    };
  }

  /**
   * Get environment info for logging
   */
  getEnvironmentInfo() {
    return {
      isProduction: this.detectProduction(),
      baseUrl: this.getBaseUrl(),
      callbackUrl: this.getCallbackUrl(),
      dashboardUrls: this.getDashboardUrls()
    };
  }
}

// Export singleton instance
const environmentConfig = new EnvironmentConfig();
export default environmentConfig;
