/**
 * Referral Eligibility Routes
 * 
 * Clean architecture implementation for referral eligibility management.
 * Follows SOLID principles with clear separation of concerns.
 * 
 * Route Groups:
 * 1. Settings - Manage referral eligibility configuration
 * 2. Hierarchies - View and manage hierarchy earnings
 * 3. Commissions - Handle held and released commissions
 * 4. Statistics - View payout analytics
 * 5. Users - Check individual user eligibility
 */

import express from 'express';
import { protectAdmin, superAdminOnly } from '../middleware/auth.js';
import {
  getAllHierarchies,
  getHierarchyEarningsById,
  getReferralEligibilitySettings as getSettings,
  updateReferralEligibilitySettingsHandler as updateSettings,
  getHeldCommissions,
  releaseHeldCommissions,
  getPayoutStatistics,
  getUserReferralEligibility
} from '../controllers/referralEligibilityController.js';

const router = express.Router();

// ==================== MIDDLEWARE COMPOSITION ====================

/**
 * Super Admin authentication middleware
 * Combines authentication and authorization for Super Admin only routes
 */
const superAdminAuth = [protectAdmin, superAdminOnly];

// ==================== SETTINGS ROUTES ====================

/**
 * @route   GET /api/referral-eligibility/settings
 * @desc    Get current referral eligibility settings
 * @access  Super Admin only
 * @returns Object with enabled, thresholdAmount, thresholdUnit
 * 
 * Example Response:
 * {
 *   "success": true,
 *   "data": {
 *     "enabled": true,
 *     "thresholdAmount": 1000,
 *     "thresholdUnit": "PER_CRORE"
 *   }
 * }
 */
router.get('/settings', ...superAdminAuth, getSettings);

/**
 * @route   PUT /api/referral-eligibility/settings
 * @desc    Update referral eligibility settings
 * @access  Super Admin only
 * @body    { enabled?, thresholdAmount?, thresholdUnit? }
 * @returns Updated settings object
 * 
 * Example Request:
 * {
 *   "enabled": true,
 *   "thresholdAmount": 1000,
 *   "thresholdUnit": "PER_CRORE"
 * }
 */
router.put('/settings', ...superAdminAuth, updateSettings);

// ==================== HIERARCHY ROUTES ====================

/**
 * @route   GET /api/referral-eligibility/hierarchies
 * @desc    Get all Super Admin hierarchies with earnings data
 * @access  Super Admin only
 * @returns Array of hierarchy objects with earnings
 * 
 * Example Response:
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "_id": "...",
 *       "rootAdminId": "...",
 *       "totalEarnings": 50000,
 *       "earningsBySegment": {
 *         "games": 20000,
 *         "trading": 30000
 *       }
 *     }
 *   ]
 * }
 */
router.get('/hierarchies', ...superAdminAuth, getAllHierarchies);

/**
 * @route   GET /api/referral-eligibility/hierarchies/:rootAdminId/earnings
 * @desc    Get detailed earnings for a specific hierarchy
 * @access  Super Admin only
 * @param   rootAdminId - MongoDB ObjectId of root admin
 * @returns Detailed earnings breakdown
 * 
 * Example: GET /api/referral-eligibility/hierarchies/507f1f77bcf86cd799439011/earnings
 */
router.get('/hierarchies/:rootAdminId/earnings', ...superAdminAuth, getHierarchyEarningsById);

// ==================== COMMISSION ROUTES ====================

/**
 * @route   GET /api/referral-eligibility/hierarchies/:rootAdminId/held-commissions
 * @desc    Get all held referral commissions for a hierarchy
 * @access  Super Admin only
 * @param   rootAdminId - MongoDB ObjectId of root admin
 * @returns Array of held commission objects
 * 
 * Use Case: View commissions waiting for threshold to be reached
 */
router.get('/hierarchies/:rootAdminId/held-commissions', ...superAdminAuth, getHeldCommissions);

/**
 * @route   POST /api/referral-eligibility/hierarchies/:rootAdminId/release-commissions
 * @desc    Release all held commissions for a hierarchy (manual override)
 * @access  Super Admin only
 * @param   rootAdminId - MongoDB ObjectId of root admin
 * @returns Release operation result
 * 
 * Use Case: Manually release commissions before threshold is reached
 */
router.post('/hierarchies/:rootAdminId/release-commissions', ...superAdminAuth, releaseHeldCommissions);

// ==================== STATISTICS ROUTES ====================

/**
 * @route   GET /api/referral-eligibility/hierarchies/:rootAdminId/statistics
 * @desc    Get referral payout statistics for a hierarchy
 * @access  Super Admin only
 * @param   rootAdminId - MongoDB ObjectId of root admin
 * @returns Statistical data about payouts
 * 
 * Example Response:
 * {
 *   "success": true,
 *   "data": {
 *     "totalPaid": 15000,
 *     "totalHeld": 5000,
 *     "lastPayoutDate": "2024-01-15T10:30:00Z"
 *   }
 * }
 */
router.get('/hierarchies/:rootAdminId/statistics', ...superAdminAuth, getPayoutStatistics);

// ==================== USER ELIGIBILITY ROUTES ====================

/**
 * @route   GET /api/referral-eligibility/users/:userId/eligibility
 * @desc    Check referral eligibility status for a specific user
 * @access  Super Admin only
 * @param   userId - MongoDB ObjectId of user
 * @query   amount - Commission amount to check
 * @query   segment - Segment (games, trading, mcx, forex)
 * @returns Eligibility status with details
 * 
 * Example: GET /api/referral-eligibility/users/507f1f77bcf86cd799439011/eligibility?amount=100&segment=games
 * 
 * Example Response:
 * {
 *   "success": true,
 *   "data": {
 *     "eligible": false,
 *     "reason": "Super Admin has not reached threshold",
 *     "currentEarnings": 800000,
 *     "requiredThreshold": 1000000
 *   }
 * }
 */
router.get('/users/:userId/eligibility', ...superAdminAuth, getUserReferralEligibility);

// ==================== EXPORT ====================

export default router;
