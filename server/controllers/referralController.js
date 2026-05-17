/**
 * Referral Controller
 * 
 * Clean architecture implementation for referral operations following SOLID principles.
 * Handles business logic orchestration for referral earnings and tracking.
 * 
 * Controller Responsibilities:
 * 1. Request validation and response formatting
 * 2. Business logic orchestration
 * 3. Error handling and status codes
 * 4. Service layer coordination
 */

import Referral from '../models/Referral.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';

class ReferralController {
  
  /**
   * Get referral amounts and earnings breakdown
   * 
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async getReferralAmounts(req, res) {
    try {
      // Find all referrals where this user is the referrer
      const referrals = await Referral.find({ referrer: req.user._id })
        .populate('referredUser', 'username phone email')
        .populate('referrer', 'username')
        .sort({ createdAt: -1 });
      
      // Calculate total earnings and fetch detailed game earnings
      const totalEarnings = referrals.reduce((sum, ref) => sum + (ref.earnings || 0), 0);
      
      // Get detailed earnings breakdown from games wallet ledger
      const referralAmounts = await Promise.all(referrals.map(async (ref) => {
        // Fetch game-specific earnings from ledger
        const gameEarnings = await GamesWalletLedger.find({
          userId: req.user._id,
          'meta.referredUser': ref.referredUser._id,
          entryType: 'credit'
        }).sort({ createdAt: -1 });
        
        // Group earnings by game
        const earningsByGame = {};
        gameEarnings.forEach(entry => {
          const gameName = entry.meta.gameName || entry.gameId || 'Unknown';
          if (!earningsByGame[gameName]) {
            earningsByGame[gameName] = {
              totalAmount: 0,
              entries: []
            };
          }
          earningsByGame[gameName].totalAmount += entry.amount;
          earningsByGame[gameName].entries.push({
            amount: entry.amount,
            description: entry.description,
            createdAt: entry.createdAt
          });
        });
        
        return {
          id: ref._id,
          referrer: {
            id: ref.referrer._id,
            username: ref.referrer.username
          },
          referredUser: {
            id: ref.referredUser._id,
            username: ref.referredUser.username,
            phone: ref.referredUser.phone,
            email: ref.referredUser.email
          },
          referralCode: ref.referralCode,
          status: ref.status,
          earnings: ref.earnings || 0,
          earningsByGame, // Detailed earnings by game
          firstGameWin: ref.firstGameWin?.credited ? {
            amount: ref.firstGameWin.amount || 0,
            creditedAt: ref.firstGameWin.creditedAt,
            gameName: ref.firstGameWin.gameName || 'Unknown'
          } : null,
          firstTradingWin: ref.firstTradingWin?.credited ? {
            amount: ref.firstTradingWin.amount || 0,
            creditedAt: ref.firstTradingWin.creditedAt
          } : null,
          createdAt: ref.createdAt,
          activatedAt: ref.activatedAt
        };
      }));
      
      res.json({
        referralAmounts,
        totalEarnings,
        totalReferrals: referrals.length
      });
    } catch (error) {
      console.error('Error fetching referral amounts:', error);
      res.status(500).json({ message: error.message });
    }
  }
}

export default ReferralController;
