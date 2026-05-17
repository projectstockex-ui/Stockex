/**
 * Date utility functions for AdminDashboard
 */

/**
 * Get today's date key in IST timezone for admin operations
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getTodayISTDateKeyForAdmin() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Check if NSE cash market is currently open
 * @returns {boolean} True if market is open
 */
export const isNseCashMarketOpen = () => {
  const now = new Date();
  const day = now.getDay();
  
  if (day === 0 || day === 6) return false; // Weekend

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  // NSE market hours: 9:15 AM to 15:30 PM (3:30 PM)
  const marketOpen = 9 * 60 + 15; // 9:15 AM = 555 minutes
  const marketClose = 15 * 60 + 30; // 3:30 PM = 930 minutes

  return currentTime >= marketOpen && currentTime <= marketClose;
};
