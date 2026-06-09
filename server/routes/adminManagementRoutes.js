/**

 * Admin Management Routes

 * 

 * Clean architecture implementation for comprehensive admin and user management.

 * Handles admin hierarchy, user management, fund operations, and system settings.

 * 

 * Route Groups:

 * 1. Admin Hierarchy - Admin, broker, and sub-broker management

 * 2. User Management - User creation, updates, and hierarchy management

 * 3. Fund Operations - Fund requests, transfers, and wallet management

 * 4. System Settings - Configuration and platform settings

 * 5. Game Management - Gaming operations and jackpot management

 * 6. Analytics & Reporting - Statistics and reporting functions

 */



import express from 'express';

import bcrypt from 'bcryptjs';

import Admin from '../models/Admin.js';

import User from '../models/User.js';

import RefundableSecurityDeposit from '../models/RefundableSecurityDeposit.js';

import { resolveLocationSelection } from '../utils/brokerLocation.js';

import adminSegmentSettingsController from '../controllers/adminSegmentSettingsController.js';

import userSegmentSettingsController from '../controllers/userSegmentSettingsController.js';

import BankAccount from '../models/BankAccount.js';

import FundRequest from '../models/FundRequest.js';

import WalletLedger from '../models/WalletLedger.js';

import GamesWalletLedger from '../models/GamesWalletLedger.js';

import mongoose from 'mongoose';

import AdminFundRequest from '../models/AdminFundRequest.js';

import BrokerChangeRequest from '../models/BrokerChangeRequest.js';

import Trade from '../models/Trade.js';

import Position from '../models/Position.js';

import SystemSettings from '../models/SystemSettings.js';

import PattiSharing from '../models/PattiSharing.js';

import GameSettings from '../models/GameSettings.js';

import NiftyNumberBet from '../models/NiftyNumberBet.js';

import BtcNumberBet from '../models/BtcNumberBet.js';

import NiftyJackpotBid from '../models/NiftyJackpotBid.js';

import NiftyJackpotResult from '../models/NiftyJackpotResult.js';

import BtcJackpotBid from '../models/BtcJackpotBid.js';

import brokerageRestrictionRoutes from './brokerageRestrictionRoutes.js';

import referralEligibilityRoutes from './referralEligibilityRoutes.js';

import segmentGroupingRoutes from './segmentGroupingRoutes.js';

import {
  normalizeIndividualPattiSegments,
  normalizeBrokerPattiSegments,
} from '../constants/pattiSharingSegments.js';
import {
  isIndividualPattiSharingEnabled,
  disableFranchiseForPattiAdmin,
  PATTI_FRANCHISE_CONFLICT_MSG,
} from '../utils/pattiFranchiseExclusion.js';
import { isAdminInActivePattiSubtree, findPattiSubtreeRootAdmin } from '../utils/pattiSubtree.js';
import {
  applyPattiSubtreeFromAdminRoot,
  applyPattiOnDirectChild,
} from '../utils/pattiSubtree.js';
import {
  assertCanManagePattiSharing,
  buildMaxPctHints,
  validateChildSegmentsAgainstParentCap,
} from '../utils/pattiHierarchy.js';
import {
  getTradeCloseBreakdown,
  assertAdminCanViewTradeBreakdown,
} from '../utils/tradeCloseBreakdown.js';

import NiftyBracketTrade from '../models/NiftyBracketTrade.js';

import GameTransactionSlip from '../models/GameTransactionSlip.js';

import { resolveNiftyBracketTrade } from '../services/niftyBracketResolve.js';

import { getMarketData } from '../services/zerodhaWebSocket.js';

import WalletTransferService from '../services/walletTransferService.js';

import {

  distributeWinBrokerage,

  computeNiftyJackpotGrossHierarchyBreakdown,

  creditNiftyJackpotGrossHierarchyFromPool,

} from '../services/gameProfitDistribution.js';

import { transferExternalAdminSubtreeToInternalAdmin } from '../services/adminSubtreeTransferService.js';

import leverageValidationService from '../services/leverageValidationService.js';

import leverageController from '../controllers/leverageController.js';

import { debitBtcUpDownSuperAdminPool } from '../utils/btcUpDownSuperAdminPool.js';

import { closingPriceToDecimalPart } from '../utils/niftyNumberResult.js';

import { ensureGamesWallet, touchGamesWallet, atomicGamesWalletUpdate } from '../utils/gamesWallet.js';

import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';

import { matchAdminLedgerGameKey, WALLET_LEDGER_GAME_OPTIONS } from '../utils/walletLedgerGameFilter.js';

import {

  resolveGameProfitSharePercent,
  resolveLedgerSharePercent,

  displaySharePercentString,
  enrichWalletLedgerEntryForDisplay,

} from '../utils/resolveGameProfitSharePercent.js';

import { declareBtcNumberResultForDate } from '../services/btcNumberDeclareService.js';

import { declareNiftyNumberResultForDate } from '../services/niftyNumberDeclareService.js';

import {

  sortJackpotBidsByDistanceToReference,

  resolveNiftyJackpotSpotPrice,

} from '../utils/niftyJackpotRank.js';

import { getNiftyUpDownWindowState } from '../../lib/niftyUpDownWindows.js';

import { getBtcUpDownWindowState, currentTotalSecondsIST } from '../../lib/btcUpDownWindows.js';

import { ZerodhaPriceResolver } from '../services/zerodha/ZerodhaPriceResolver.js';

import { getLiveBtcSpotForJackpot } from '../utils/btcJackpotSpot.js';

import { getTodayISTString } from '../utils/istDate.js';

import {

  withAlignedSegmentCommissionUnit,

  alignSegmentDefaultsMap,

  mergeSegmentDefaultsMaps,

  normalizeLegacySystemSegmentDefaultsSlice,

  preserveAllowLimitPendingOrdersFromExisting,

  plainSegmentDefaultsMap,

  sanitizeSegmentExplicitKeysForSave,

  overlayCryptoSpreadFromRaw,

} from '../utils/commissionTypeUnit.js';

import { resolveJackpotPrizePercentForRank } from '../utils/niftyJackpotPrize.js';

import { buildNiftyJackpotIstDayQuery } from '../utils/niftyJackpotDayScope.js';

import {

  declareNiftyJackpotResult,

  NiftyJackpotDeclareError,

} from '../services/niftyJackpotDeclare.js';

import jwt from 'jsonwebtoken';

import {

  getEffectivePlatformChargeConfig,

  getPlatformChargeReport,

  runDailyPlatformCharges,

} from '../services/platformChargeService.js';

import { sanitizeInstrumentDenylist } from '../services/instrumentRestrictionService.js';

import hierarchyValidationService from '../services/hierarchyValidationService.js';

import { protectAdmin, superAdminOnly } from '../middleware/auth.js';



const router = express.Router();



// ==================== HELPER FUNCTIONS ====================


/**
 * Counts unsettled (pending/active) bets for a given game.
 * Used to prevent SuperAdmin from disabling a game while users have open positions.
 */
async function countPendingBetsForGame(gameId) {
  const GAME_FRIENDLY = {
    niftyUpDown: 'Nifty Up/Down',
    btcUpDown: 'BTC Up/Down',
    niftyNumber: 'Nifty Number',
    niftyBracket: 'Nifty Bracket',
    niftyJackpot: 'Nifty Jackpot',
    btcJackpot: 'BTC Jackpot',
    btcNumber: 'BTC Number',
  };

  switch (gameId) {
    case 'niftyUpDown':
      return GameTransactionSlip.countDocuments({ gameIds: 'updown', status: 'PENDING' });
    case 'btcUpDown':
      return GameTransactionSlip.countDocuments({ gameIds: 'btcupdown', status: 'PENDING' });
    case 'niftyNumber':
      return NiftyNumberBet.countDocuments({ status: 'pending' });
    case 'niftyBracket':
      return NiftyBracketTrade.countDocuments({ status: 'active' });
    case 'niftyJackpot':
      return NiftyJackpotBid.countDocuments({ status: 'pending' });
    case 'btcJackpot':
      return BtcJackpotBid.countDocuments({ status: 'pending' });
    case 'btcNumber':
      return BtcNumberBet.countDocuments({ status: 'pending' });
    default:
      return 0;
  }
}


// Hierarchy levels for permission checks

const HIERARCHY_LEVELS = {

  'SUPER_ADMIN': 0,

  'ADMIN': 1,

  'BROKER': 2,

  'SUB_BROKER': 3

};



// Get allowed child roles for a given role

// SUPER_ADMIN can create ADMIN, BROKER, SUB_BROKER (must specify parent for BROKER/SUB_BROKER)

// ADMIN can create BROKER, SUB_BROKER (must specify parent broker for SUB_BROKER)

// BROKER can create SUB_BROKER

// All roles (except SUPER_ADMIN) can create Users

const getAllowedChildRoles = (role) => {

  const childRoles = {

    'SUPER_ADMIN': ['ADMIN', 'BROKER', 'SUB_BROKER'], // Can create all, but must specify parent for SUB_BROKER

    'ADMIN': ['BROKER', 'SUB_BROKER'], // Can create SUB_BROKER under their brokers

    'BROKER': ['SUB_BROKER'], // Only BROKER can create SUB_BROKER directly

    'SUB_BROKER': []

  };

  return childRoles[role] || [];

};



// Check if requester can manage target role

const canManageRole = (requesterRole, targetRole) => {

  return HIERARCHY_LEVELS[requesterRole] < HIERARCHY_LEVELS[targetRole];

};



// Apply filter based on hierarchy - users see only their own and descendants

const applyHierarchyFilter = (req, query = {}) => {

  if (req.admin.role === 'SUPER_ADMIN') {

    return query; // Super Admin sees all

  }

  // For other roles, filter by hierarchyPath containing their ID or direct admin reference

  query.$or = [

    { admin: req.admin._id },

    { hierarchyPath: req.admin._id }

  ];

  return query;

};



// Apply adminCode filter for non-super admins (legacy support)

const applyAdminFilter = (req, query = {}) => {

  if (req.admin.role === 'SUPER_ADMIN') {

    return query;

  }

  // Include users under this admin and all descendants

  query.$or = [

    { adminCode: req.admin.adminCode },

    { hierarchyPath: req.admin._id }

  ];

  return query;

};



/** Extra Charges + hierarchy transfer: INTERNAL = office, EXTERNAL = outside (legacy default). */

function resolveOfficePartnerType(adminDoc) {

  return adminDoc?.officePartnerType === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL';

}

/** Debit franchise / extra-charge brokerage from admin main wallet only (never temporaryWallet). */
async function takeBrokerageFromAdminMainWallet(targetAdmin, superAdmin, amount, description, options = {}) {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) {
    const err = new Error('Please enter a valid amount');
    err.statusCode = 400;
    throw err;
  }

  const mainBal = Number(targetAdmin.wallet?.balance) || 0;
  if (mainBal < amt) {
    const err = new Error(
      `Insufficient main wallet balance. Available: ${mainBal.toLocaleString('en-IN')} (temporary wallet is not used for this charge)`
    );
    err.statusCode = 400;
    throw err;
  }

  targetAdmin.wallet.balance = Math.round((mainBal - amt) * 100) / 100;
  await targetAdmin.save();

  const debitDesc =
    description ||
    (options.franchiseCharge
      ? 'Franchise brokerage charge — debited from admin main wallet'
      : 'Brokerage taken by Super Admin — admin main wallet');

  await new WalletLedger({
    ownerId: targetAdmin._id,
    ownerType: 'ADMIN',
    adminCode: targetAdmin.adminCode,
    type: 'DEBIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: targetAdmin.wallet.balance,
    description: debitDesc,
    category: 'EXTRA_CHARGE',
    relatedTo: superAdmin._id,
    relatedToType: 'ADMIN',
    performedBy: superAdmin._id,
    meta: { walletSource: 'main', franchiseCharge: !!options.franchiseCharge },
  }).save();

  superAdmin.wallet.balance = Math.round(((Number(superAdmin.wallet?.balance) || 0) + amt) * 100) / 100;
  await superAdmin.save();

  await new WalletLedger({
    ownerId: superAdmin._id,
    ownerType: 'ADMIN',
    adminCode: superAdmin.adminCode,
    type: 'CREDIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: superAdmin.wallet.balance,
    description: `Brokerage received from ${targetAdmin.name || targetAdmin.username} (main wallet)`,
    category: 'EXTRA_CHARGE',
    relatedTo: targetAdmin._id,
    relatedToType: 'ADMIN',
    performedBy: superAdmin._id,
    meta: { walletSource: 'main', franchiseCharge: !!options.franchiseCharge },
  }).save();

  return { amount: amt, adminMainBalance: targetAdmin.wallet.balance };
}

/** True if target or any ancestor is a franchise root admin. */
async function isInFranchiseSubtree(targetAdmin) {
  const { isAdminInActiveFranchiseSubtree } = await import('../utils/franchiseBrokerage.js');
  return isAdminInActiveFranchiseSubtree(targetAdmin);
}

function isUnderCallerHierarchy(caller, target) {
  if (!caller || !target) return false;
  if (caller.role === 'SUPER_ADMIN') return true;
  if (target.parentId?.toString() === caller._id.toString()) return true;
  return (target.hierarchyPath || []).some((id) => id.toString() === caller._id.toString());
}

/** Who may set brokerageChargePerCrore on whom (franchise downstream). */
function canCallerSetFranchiseChargeOn(callerRole, targetRole) {
  if (callerRole === 'SUPER_ADMIN') return ['ADMIN', 'BROKER', 'SUB_BROKER'].includes(targetRole);
  if (callerRole === 'ADMIN') return ['BROKER', 'SUB_BROKER'].includes(targetRole);
  if (callerRole === 'BROKER') return targetRole === 'SUB_BROKER';
  return false;
}

function isUserUnderCaller(caller, user) {
  if (!caller || !user) return false;
  if (caller.role === 'SUPER_ADMIN') return true;
  const direct = user.admin?.toString?.() === caller._id.toString() || user.admin?.toString() === caller._id.toString();
  if (direct) return true;
  return (user.hierarchyPath || []).some((id) => id.toString() === caller._id.toString());
}

/** User's admin chain includes a franchise root. */
async function isUserInFranchiseSubtree(user) {
  const { isUserInActiveFranchiseSubtree } = await import('../utils/franchiseBrokerage.js');
  return isUserInActiveFranchiseSubtree(user);
}



// Generate JWT token (for internal use)

const generateToken = (id) => {

  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

};



// ==================== MIDDLEWARE COMPOSITION ====================



/**

 * Authentication middleware combinations

 */

const adminAuth = [protectAdmin];

const superAdminAuth = [protectAdmin, superAdminOnly];



function normalizeRestrictionsPayload(body, callerRole) {

  if (!body || typeof body !== 'object') return {};

  const restrictions = { ...body };

  restrictions.instrumentDenylist = sanitizeInstrumentDenylist(body.instrumentDenylist);

  if (body.allowWithinLowHigh !== undefined) {
    restrictions.allowWithinLowHigh = Boolean(body.allowWithinLowHigh);
  }

  // Game denylist functionality removed - only superadmin can enable/disable games via GameSettings
  delete restrictions.gameDenylist;

  return restrictions;

}



/** Plain JSON for API clients (avoids Mongoose subdoc serialization quirks on deny arrays). */

async function getRestrictionsResponsePayload(adminId) {

  const row = await Admin.findById(adminId).select('restrictions updatedAt').lean();

  if (!row) return { restrictions: {}, updatedAt: null };

  return {

    restrictions: row.restrictions ? JSON.parse(JSON.stringify(row.restrictions)) : {},

    updatedAt: row.updatedAt ?? null,

  };

}



// ==================== SUPER ADMIN ROUTES ====================



// Get all subordinates (admins/brokers/sub-brokers) based on hierarchy

// SUPER_ADMIN sees all ADMINs, BROKERs, SUB_BROKERs (created by them or their descendants)

// ADMIN sees BROKERs and SUB_BROKERs created by them or their descendants

// BROKER sees SUB_BROKERs created by them

router.get('/admins', ...adminAuth, async (req, res) => {

  try {

    let query = {};

    const allowedChildRoles = getAllowedChildRoles(req.admin.role);

    

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin sees all non-super-admin roles

      query = { role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] } };

    } else if (allowedChildRoles.length > 0) {

      // Other roles see their direct children AND descendants in hierarchy

      query = { 

        role: { $in: allowedChildRoles },

        $or: [

          { parentId: req.admin._id },

          { hierarchyPath: req.admin._id }

        ]

      };

    } else {

      // SUB_BROKER has no subordinates

      return res.json([]);

    }

    

    console.log(`[AdminManagement] Query for admins:`, JSON.stringify(query, null, 2));

    

    const admins = await Admin.find(query)

      .select('-password -pin')

      .populate('parentId', 'name adminCode role')

      .sort({ createdAt: -1 });

    

    console.log(`[AdminManagement] Found ${admins.length} admins`);

    

    // Get user counts for each admin

    const adminData = await Promise.all(admins.map(async (admin) => {

      try {

        const userCount = await User.countDocuments({ admin: admin._id });

        const activeUsers = await User.countDocuments({ admin: admin._id, isActive: true });

        const { isAdminInActiveFranchiseSubtree } = await import('../utils/franchiseBrokerage.js');
        const { isAdminInActivePattiSubtree } = await import('../utils/pattiSubtree.js');
        const franchiseSubtreeActive = await isAdminInActiveFranchiseSubtree(admin);
        const pattiSubtreeActive = await isAdminInActivePattiSubtree(admin);

        return {

          ...admin.toObject(),

          franchiseSubtreeActive,
          pattiSubtreeActive,

          stats: {

            ...admin.stats,

            totalUsers: userCount,

            activeUsers

          }

        };

      } catch (userError) {

        console.error(`[AdminManagement] Error getting user counts for admin ${admin._id}:`, userError);

        return {

          ...admin.toObject(),

          franchiseSubtreeActive: false,
          pattiSubtreeActive: false,

          stats: {

            ...admin.stats,

            totalUsers: 0,

            activeUsers: 0

          }

        };

      }

    }));

    

    res.json(adminData);

  } catch (error) {

    console.error('[AdminManagement] Error in /admins endpoint:', error);

    res.status(500).json({ 

      message: 'Failed to retrieve admins',

      error: process.env.NODE_ENV === 'development' ? error.message : undefined

    });

  }

});



// Create new subordinate (ADMIN creates BROKER, BROKER creates SUB_BROKER, etc.)

// SUPER_ADMIN can optionally specify parentAdminId to create broker under a specific admin

router.post('/admins', protectAdmin, async (req, res) => {

  try {

    const { username, name, email, phone, password, pin, charges, role: requestedRole, parentAdminId, stateName, stateCode, cityName, cityCode, areaName, areaPincode, refundableSecurityAmount, autosquare, breakupQuantity, maxLotQuantity } = req.body;

    

    // Determine the role to create

    const allowedChildRoles = getAllowedChildRoles(req.admin.role);

    let roleToCreate = requestedRole || allowedChildRoles[0];

    

    if (!roleToCreate || !allowedChildRoles.includes(roleToCreate)) {

      return res.status(403).json({ 

        message: `You can only create: ${allowedChildRoles.join(', ') || 'No subordinates allowed'}` 

      });

    }

    

    if (!pin) {

      return res.status(400).json({ message: 'PIN is required' });

    }



    const normalizedPin = pin.toString().trim();

    if (!/^\d{4,6}$/.test(normalizedPin)) {

      return res.status(400).json({ message: 'PIN must be a 4-6 digit number' });

    }

    const normalizedSecurityAmount = Number(refundableSecurityAmount);

    let brokerLocation = null;

    if (['BROKER', 'SUB_BROKER'].includes(roleToCreate)) {

      brokerLocation = resolveLocationSelection({
        stateName: String(stateName || '').trim(),
        cityName: String(cityName || '').trim(),
        areaName: String(areaName || '').trim(),
        areaPincode: String(areaPincode || '').trim(),
      });

      if (!brokerLocation) {

        return res.status(400).json({ message: 'Valid state, city, and area are required for broker/sub-broker' });

      }

      if (!Number.isFinite(normalizedSecurityAmount) || normalizedSecurityAmount <= 0) {

        return res.status(400).json({ message: 'Refundable security amount is required for broker/sub-broker' });

      }

    }

    

    // Check if admin exists

    const exists = await Admin.findOne({ $or: [{ email }, { username }] });

    if (exists) {

      return res.status(400).json({ message: 'User with this email or username already exists' });

    }

    

    // Determine the actual parent for hierarchy

    let actualParent = req.admin;

    

    // SUPER_ADMIN or ADMIN can specify a different parent for the new broker/sub-broker

    if (['SUPER_ADMIN', 'ADMIN'].includes(req.admin.role) && parentAdminId) {

      const specifiedParent = await Admin.findById(parentAdminId);

      if (!specifiedParent) {

        return res.status(400).json({ message: 'Specified parent not found' });

      }

      

      // For ADMIN, verify they can only assign under their own hierarchy

      if (req.admin.role === 'ADMIN') {

        const isInHierarchy = specifiedParent.hierarchyPath?.some(id => id.toString() === req.admin._id.toString()) 

                            || specifiedParent.parentId?.toString() === req.admin._id.toString();

        if (!isInHierarchy && specifiedParent._id.toString() !== req.admin._id.toString()) {

          return res.status(403).json({ message: 'You can only assign under your own hierarchy' });

        }

      }

      

      // Validate parent role based on what we're creating

      // BROKER should be under ADMIN or SUPER_ADMIN

      // SUB_BROKER should be under BROKER

      if (roleToCreate === 'BROKER' && !['SUPER_ADMIN', 'ADMIN'].includes(specifiedParent.role)) {

        return res.status(400).json({ message: 'Broker can only be created under Super Admin or Admin' });

      }

      if (roleToCreate === 'SUB_BROKER' && specifiedParent.role !== 'BROKER') {

        return res.status(400).json({ message: 'Sub-broker can only be created under a Broker' });

      }

      

      actualParent = specifiedParent;

    }

    

    // SUB_BROKER requires a parent broker - enforce this

    if (roleToCreate === 'SUB_BROKER' && actualParent.role !== 'BROKER') {

      return res.status(400).json({ message: 'Sub-broker must be created under a Broker. Please select a parent broker.' });

    }

    

    // Check restrict mode for broker/sub-broker limits

    if (actualParent.restrictMode?.enabled && actualParent.role !== 'SUPER_ADMIN') {

      if (roleToCreate === 'BROKER') {

        const currentBrokerCount = await Admin.countDocuments({ parentId: actualParent._id, role: 'BROKER' });

        const maxBrokers = actualParent.restrictMode.maxBrokers || 10;

        

        if (currentBrokerCount >= maxBrokers) {

          return res.status(403).json({ 

            message: `Broker limit reached for ${actualParent.username}. Maximum ${maxBrokers} brokers allowed. Current: ${currentBrokerCount}`,

            restrictMode: true,

            currentBrokers: currentBrokerCount,

            maxBrokers: maxBrokers

          });

        }

      } else if (roleToCreate === 'SUB_BROKER') {

        const currentSubBrokerCount = await Admin.countDocuments({ parentId: actualParent._id, role: 'SUB_BROKER' });

        const maxSubBrokers = actualParent.restrictMode.maxSubBrokers || 20;

        

        if (currentSubBrokerCount >= maxSubBrokers) {

          return res.status(403).json({ 

            message: `Sub-broker limit reached for ${actualParent.username}. Maximum ${maxSubBrokers} sub-brokers allowed. Current: ${currentSubBrokerCount}`,

            restrictMode: true,

            currentSubBrokers: currentSubBrokerCount,

            maxSubBrokers: maxSubBrokers

          });

        }

      }

    }

    

    // Build hierarchy path based on actual parent

    const hierarchyPath = [...(actualParent.hierarchyPath || []), actualParent._id];

    

    // Get system default settings for this role

    const systemSettings = await SystemSettings.getSettings();

    let roleDefaults = {};

    

    switch (roleToCreate) {

      case 'ADMIN':

        roleDefaults = systemSettings.adminDefaults || {};

        break;

      case 'BROKER':

        roleDefaults = systemSettings.brokerDefaults || {};

        break;

      case 'SUB_BROKER':

        roleDefaults = systemSettings.subBrokerDefaults || {};

        break;

    }

    

    // Merge provided charges with system defaults (provided values take precedence)

    const mergedCharges = {

      brokerage: charges?.brokerage ?? roleDefaults.brokerage?.perLot ?? 0,

      intradayLeverage: charges?.intradayLeverage ?? roleDefaults.leverage?.intraday ?? 1,

      deliveryLeverage: charges?.deliveryLeverage ?? roleDefaults.leverage?.carryForward ?? 1,

      withdrawalFee: charges?.withdrawalFee ?? roleDefaults.charges?.withdrawalFee ?? 0,

      ...charges

    };

    

    // Apply default settings from system

    const defaultSettings = {

      brokerage: {

        perLot: roleDefaults.brokerage?.perLot ?? 0,

        perCrore: roleDefaults.brokerage?.perCrore ?? 0,

        perTrade: roleDefaults.brokerage?.perTrade ?? 0

      },

      leverage: {

        intraday: roleDefaults.leverage?.intraday ?? 1,

        carryForward: roleDefaults.leverage?.carryForward ?? 1

      },

      quantitySettings: {

        maxQuantity: roleDefaults.quantitySettings?.maxQuantity ?? 50000,

        breakupQuantity: breakupQuantity ?? roleDefaults.quantitySettings?.breakupQuantity ?? 5000,

        maxLotQuantity: maxLotQuantity ?? roleDefaults.quantitySettings?.maxLotQuantity ?? 0

      },

      autosquare: autosquare ?? roleDefaults.autosquare ?? 0

    };

    

    // Apply default permissions from system

    const defaultPermissions = roleDefaults.permissions || {

      canChangeBrokerage: false,

      canChangeCharges: false,

      canChangeLeverage: false,

      canChangeLotSettings: false,

      canChangeTradingSettings: false,

      canCreateUsers: true,

      canManageFunds: true

    };

    

    // Apply default leverage settings

    const leverageSettings = {

      maxLeverageFromParent: roleDefaults.leverage?.intraday ?? 1,

      intradayLeverage: roleDefaults.leverage?.intraday ?? 1,

      carryForwardLeverage: roleDefaults.leverage?.carryForward ?? 1

    };

    // Validate leverage settings against parent's maxLeverageFromParent
    if (actualParent.role !== 'SUPER_ADMIN') {
      const tempAdmin = { leverageSettings };
      const validation = leverageValidationService.validateLeverageHierarchy(tempAdmin, actualParent);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }
    }

    

    const admin = await Admin.create({

      role: roleToCreate,

      username,

      name,

      email,

      phone,

      password,

      pin: normalizedPin,

      charges: mergedCharges,

      defaultSettings,

      permissions: defaultPermissions,

      leverageSettings,

      ...(brokerLocation || {}),

      createdBy: req.admin._id,

      parentId: actualParent._id,

      hierarchyPath,

      hierarchyLevel: HIERARCHY_LEVELS[roleToCreate]

    });

    if (['BROKER', 'SUB_BROKER'].includes(roleToCreate)) {

      await RefundableSecurityDeposit.create({

        adminId: admin._id,

        adminCode: admin.adminCode,

        brokerName: name || username || '',

        role: roleToCreate,

        ...brokerLocation,

        amount: normalizedSecurityAmount,

        createdBy: req.admin._id,

      });

    }

    

    res.status(201).json({

      _id: admin._id,

      adminCode: admin.adminCode,

      username: admin.username,

      name: admin.name,

      email: admin.email,

      role: admin.role,

      status: admin.status,

      charges: admin.charges,

      wallet: admin.wallet,

      parentId: admin.parentId,

      hierarchyLevel: admin.hierarchyLevel

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/** Super Admin — refundable security deposits from new brokers/sub-brokers */

router.get('/refundable-security-feed', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 2000);

    const filter = {};

    if (req.query.dateFrom) {

      const from = new Date(req.query.dateFrom);

      if (!Number.isNaN(from.getTime())) filter.createdAt = { ...(filter.createdAt || {}), $gte: from };

    }

    if (req.query.dateTo) {

      const to = new Date(req.query.dateTo);

      if (!Number.isNaN(to.getTime())) {

        to.setHours(23, 59, 59, 999);

        filter.createdAt = { ...(filter.createdAt || {}), $lte: to };

      }

    }

    const search = String(req.query.search || '').trim();

    if (search) {

      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      filter.$or = [

        { brokerName: re },

        { adminCode: re },

        { stateName: re },

        { cityName: re },

        { cityCode: re },

        { areaName: re },

        { areaPincode: re },

      ];

    }

    const deposits = await RefundableSecurityDeposit.find(filter)

      .sort({ createdAt: -1 })

      .limit(lim)

      .lean();

    const totalAmount = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);

    res.json({

      deposits,

      summary: { count: deposits.length, totalAmount },

    });

  } catch (error) {

    console.error('refundable-security-feed:', error);

    res.status(500).json({ message: error.message });

  }

});



/** Super Admin — cash distributed to admins and amounts returned */

router.get('/distributed-cash-feed', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const superAdmins = await Admin.find({ role: 'SUPER_ADMIN' }).select('_id').lean();

    const superAdminIds = superAdmins.map((a) => a._id);

    if (!superAdminIds.length) {

      return res.json({ rows: [], summary: { adminCount: 0, totalGiven: 0, totalReturned: 0, netOutstanding: 0 } });

    }



    const dateFilter = {};

    if (req.query.dateFrom) {

      const from = new Date(req.query.dateFrom);

      if (!Number.isNaN(from.getTime())) dateFilter.$gte = from;

    }

    if (req.query.dateTo) {

      const to = new Date(req.query.dateTo);

      if (!Number.isNaN(to.getTime())) {

        to.setHours(23, 59, 59, 999);

        dateFilter.$lte = to;

      }

    }



    const ledgerFilter = {

      ownerType: 'ADMIN',

      performedBy: { $in: superAdminIds },

      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),

    };



    const [deposits, withdrawals] = await Promise.all([

      WalletLedger.find({ ...ledgerFilter, reason: 'ADMIN_DEPOSIT', type: 'CREDIT' }).lean(),

      WalletLedger.find({ ...ledgerFilter, reason: 'ADMIN_WITHDRAW', type: 'DEBIT' }).lean(),

    ]);



    const byAdmin = new Map();



    const ensureRow = (ownerId) => {

      const key = String(ownerId);

      if (!byAdmin.has(key)) {

        byAdmin.set(key, {

          adminId: key,

          totalGiven: 0,

          totalReturned: 0,

          lastGivenAt: null,

          lastReturnedAt: null,

          givenCount: 0,

          returnCount: 0,

        });

      }

      return byAdmin.get(key);

    };



    for (const entry of deposits) {

      const row = ensureRow(entry.ownerId);

      row.totalGiven += Number(entry.amount) || 0;

      row.givenCount += 1;

      const at = entry.createdAt ? new Date(entry.createdAt) : null;

      if (at && (!row.lastGivenAt || at > row.lastGivenAt)) row.lastGivenAt = at;

    }



    for (const entry of withdrawals) {

      const row = ensureRow(entry.ownerId);

      row.totalReturned += Number(entry.amount) || 0;

      row.returnCount += 1;

      const at = entry.createdAt ? new Date(entry.createdAt) : null;

      if (at && (!row.lastReturnedAt || at > row.lastReturnedAt)) row.lastReturnedAt = at;

    }



    const adminIds = [...byAdmin.keys()];

    const admins = adminIds.length

      ? await Admin.find({ _id: { $in: adminIds }, role: { $ne: 'SUPER_ADMIN' } })

        .select('name username adminCode role')

        .lean()

      : [];



    const adminMap = new Map(admins.map((a) => [String(a._id), a]));



    const search = String(req.query.search || '').trim().toLowerCase();



    let rows = adminIds

      .map((id) => {

        const agg = byAdmin.get(id);

        const adm = adminMap.get(id);

        if (!adm) return null;

        return {

          adminId: id,

          adminName: adm.name || adm.username || '—',

          adminCode: adm.adminCode || '',

          role: adm.role || '',

          totalGiven: parseFloat((agg.totalGiven || 0).toFixed(2)),

          totalReturned: parseFloat((agg.totalReturned || 0).toFixed(2)),

          netOutstanding: parseFloat(((agg.totalGiven || 0) - (agg.totalReturned || 0)).toFixed(2)),

          lastGivenAt: agg.lastGivenAt,

          lastReturnedAt: agg.lastReturnedAt,

          givenCount: agg.givenCount,

          returnCount: agg.returnCount,

        };

      })

      .filter(Boolean);



    if (search) {

      rows = rows.filter((row) => {

        const blob = [row.adminName, row.adminCode, row.role].filter(Boolean).join(' ').toLowerCase();

        return blob.includes(search);

      });

    }



    rows.sort((a, b) => {

      const aT = a.lastGivenAt ? new Date(a.lastGivenAt).getTime() : 0;

      const bT = b.lastGivenAt ? new Date(b.lastGivenAt).getTime() : 0;

      return bT - aT;

    });



    const totalGiven = rows.reduce((s, r) => s + (r.totalGiven || 0), 0);

    const totalReturned = rows.reduce((s, r) => s + (r.totalReturned || 0), 0);



    res.json({

      rows,

      summary: {

        adminCount: rows.length,

        totalGiven: parseFloat(totalGiven.toFixed(2)),

        totalReturned: parseFloat(totalReturned.toFixed(2)),

        netOutstanding: parseFloat((totalGiven - totalReturned).toFixed(2)),

      },

    });

  } catch (error) {

    console.error('distributed-cash-feed:', error);

    res.status(500).json({ message: error.message });

  }

});



/**

 * Must be registered before GET /admins/:id or "internal-office-partners" is captured as :id.

 */

router.get('/admins/internal-office-partners', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const excludeId = req.query.excludeId ? String(req.query.excludeId) : '';

    const rows = await Admin.find({

      role: 'ADMIN',

      status: 'ACTIVE',

      officePartnerType: 'INTERNAL',

    })

      .select('_id name username adminCode role officePartnerType')

      .sort({ username: 1 })

      .lean();



    const list = excludeId ? rows.filter((a) => String(a._id) !== excludeId) : rows;

    res.json(list);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get single admin details (Super Admin only)

router.get('/admins/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id).select('-password');

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    // Get user stats

    const userCount = await User.countDocuments({ adminCode: admin.adminCode });

    const activeUsers = await User.countDocuments({ adminCode: admin.adminCode, isActive: true });

    

    res.json({

      ...admin.toObject(),

      stats: { ...admin.stats, totalUsers: userCount, activeUsers }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update admin (Super Admin only)

router.put('/admins/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { name, phone, status, charges, receivesHierarchyBrokerage, officePartnerType } = req.body;

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin' });

    

    if (name) admin.name = name;

    if (phone) admin.phone = phone;

    if (status) {

      admin.status = status;

      admin.isActive = status === 'ACTIVE';

    }

    if (charges) admin.charges = { ...admin.charges, ...charges };

    if (typeof receivesHierarchyBrokerage === 'boolean') {

      admin.receivesHierarchyBrokerage = receivesHierarchyBrokerage;

    }

    if (admin.role === 'ADMIN' && (officePartnerType === 'INTERNAL' || officePartnerType === 'EXTERNAL')) {

      admin.officePartnerType = officePartnerType;

    }

    

    await admin.save();

    res.json(admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update admin lot settings (Super Admin only)

router.put('/admins/:id/lot-settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { lotSettings, enabledLeverages, allowTradingOutsideMarketHours, marginCallPercentage } = req.body;

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin settings' });

    

    // Update lot settings

    if (lotSettings) {

      admin.lotSettings = { ...admin.lotSettings, ...lotSettings };

    }

    

    // Update leverage settings

    if (enabledLeverages) {

      if (!admin.leverageSettings) admin.leverageSettings = {};

      const maxRequestedLeverage = Math.max(...enabledLeverages);

      // Validate against parent's maxLeverageFromParent
      if (admin.parentId) {
        const parent = await Admin.findById(admin.parentId);
        if (parent && parent.leverageSettings) {
          const parentMax = parent.leverageSettings.maxLeverageFromParent || 1;
          if (maxRequestedLeverage > parentMax) {
            return res.status(400).json({ message: `limit exceeded: Requested leverage (${maxRequestedLeverage}x) exceeds parent's maximum (${parentMax}x)` });
          }
        }
      }

      admin.leverageSettings.enabledLeverages = enabledLeverages;

      admin.leverageSettings.maxLeverage = maxRequestedLeverage;

    }

    

    // Update trading settings

    if (!admin.tradingSettings) admin.tradingSettings = {};

    if (typeof allowTradingOutsideMarketHours === 'boolean') {

      admin.tradingSettings.allowTradingOutsideMarketHours = allowTradingOutsideMarketHours;

    }

    if (marginCallPercentage) {

      admin.tradingSettings.autoClosePercentage = marginCallPercentage;

    }

    

    await admin.save();

    

    res.json({ 

      message: 'Settings updated successfully', 

      lotSettings: admin.lotSettings,

      leverageSettings: admin.leverageSettings,

      tradingSettings: admin.tradingSettings

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update admin restrictions (Super Admin only)

router.put('/admins/:id/restrictions', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    console.log('[AdminRestrictions] UPDATE CALLED by SuperAdmin');
    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin restrictions' });



    admin.restrictions = normalizeRestrictionsPayload(req.body, req.admin?.role);

    admin.markModified('restrictions');

    await admin.save();



    const payload = await getRestrictionsResponsePayload(admin._id);

    res.json({

      message: 'Restrictions updated successfully',

      restrictions: payload.restrictions,

      updatedAt: payload.updatedAt,

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update broker restrictions (Admin only)

router.put('/brokers/:id/restrictions', protectAdmin, async (req, res) => {

  try {

    const currentAdmin = req.admin;

    console.log('[BrokerRestrictions] UPDATE CALLED');
    console.log('[BrokerRestrictions] Parent:', currentAdmin.name, 'Role:', currentAdmin.role, 'ParentId:', currentAdmin.parentId);

    const broker = await Admin.findById(req.params.id);

    if (!broker) return res.status(404).json({ message: 'Broker not found' });

    if (broker.role !== 'BROKER') return res.status(400).json({ message: 'Target is not a broker' });


    // Verify that the current admin is the parent of this broker

    if (broker.createdBy.toString() !== currentAdmin._id.toString()) {

      return res.status(403).json({ message: 'You can only set restrictions for your own brokers' });

    }

    // Validate category permissions against grandparent segment permissions using service
    const categoryValidation = await hierarchyValidationService.validateCategoryPermissions(currentAdmin, req.body);
    if (!categoryValidation.allowed) {
      console.log('[BrokerRestrictions] BLOCKING:', categoryValidation.message);
      return res.status(400).json({ message: categoryValidation.message });
    }

    // Validate against parent restrictions

    if (currentAdmin.restrictions) {

      const parentRestrictions = currentAdmin.restrictions;

      const newRestrictions = req.body;

      

      if (parentRestrictions.intradayLimit && newRestrictions.intradayLimit > parentRestrictions.intradayLimit) {

        return res.status(400).json({ message: `Intraday limit cannot exceed parent's limit of ${parentRestrictions.intradayLimit}` });

      }

      if (parentRestrictions.carryforwardLimit && newRestrictions.carryforwardLimit > parentRestrictions.carryforwardLimit) {

        return res.status(400).json({ message: `Carryforward limit cannot exceed parent's limit of ${parentRestrictions.carryforwardLimit}` });

      }

      if (parentRestrictions.maxLot && newRestrictions.maxLot > parentRestrictions.maxLot) {

        return res.status(400).json({ message: `Max lot cannot exceed parent's limit of ${parentRestrictions.maxLot}` });

      }

      if (parentRestrictions.minLot && newRestrictions.minLot < parentRestrictions.minLot) {

        return res.status(400).json({ message: `Min lot cannot be less than parent's minimum of ${parentRestrictions.minLot}` });

      }

      if (parentRestrictions.breakupQuantity && newRestrictions.breakupQuantity > parentRestrictions.breakupQuantity) {

        return res.status(400).json({ message: `Breakup quantity cannot exceed parent's limit of ${parentRestrictions.breakupQuantity}` });

      }

      if (parentRestrictions.maxPositionValue && newRestrictions.maxPositionValue > parentRestrictions.maxPositionValue) {

        return res.status(400).json({ message: `Max position value cannot exceed parent's limit of ${parentRestrictions.maxPositionValue}` });

      }

      if (parentRestrictions.maxExposure && newRestrictions.maxExposure > parentRestrictions.maxExposure) {

        return res.status(400).json({ message: `Max exposure cannot exceed parent's limit of ${parentRestrictions.maxExposure}` });

      }

    }



    broker.restrictions = normalizeRestrictionsPayload(req.body, req.admin?.role);

    broker.markModified('restrictions');

    await broker.save();



    const payload = await getRestrictionsResponsePayload(broker._id);

    res.json({

      message: 'Restrictions updated successfully',

      restrictions: payload.restrictions,

      updatedAt: payload.updatedAt,

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update sub-broker restrictions (Broker only)

router.put('/subbrokers/:id/restrictions', protectAdmin, async (req, res) => {

  try {

    const currentAdmin = req.admin;

    console.log('[SubBrokerRestrictions] UPDATE CALLED');
    console.log('[SubBrokerRestrictions] Parent:', currentAdmin.name, 'Role:', currentAdmin.role, 'ParentId:', currentAdmin.parentId);

    const subBroker = await Admin.findById(req.params.id);

    if (!subBroker) return res.status(404).json({ message: 'Sub Broker not found' });

    if (subBroker.role !== 'SUB_BROKER') return res.status(400).json({ message: 'Target is not a sub-broker' });



    // Verify that the current admin is the parent of this sub-broker

    if (subBroker.createdBy.toString() !== currentAdmin._id.toString()) {

      return res.status(403).json({ message: 'You can only set restrictions for your own sub-brokers' });

    }

    // Validate category permissions against grandparent segment permissions using service
    const categoryValidation = await hierarchyValidationService.validateCategoryPermissions(currentAdmin, req.body);
    if (!categoryValidation.allowed) {
      console.log('[SubBrokerRestrictions] BLOCKING:', categoryValidation.message);
      return res.status(400).json({ message: categoryValidation.message });
    }

    

    // Validate against parent restrictions

    if (currentAdmin.restrictions) {

      const parentRestrictions = currentAdmin.restrictions;

      const newRestrictions = req.body;

      

      if (parentRestrictions.intradayLimit && newRestrictions.intradayLimit > parentRestrictions.intradayLimit) {

        return res.status(400).json({ message: `Intraday limit cannot exceed parent's limit of ${parentRestrictions.intradayLimit}` });

      }

      if (parentRestrictions.carryforwardLimit && newRestrictions.carryforwardLimit > parentRestrictions.carryforwardLimit) {

        return res.status(400).json({ message: `Carryforward limit cannot exceed parent's limit of ${parentRestrictions.carryforwardLimit}` });

      }

      if (parentRestrictions.maxLot && newRestrictions.maxLot > parentRestrictions.maxLot) {

        return res.status(400).json({ message: `Max lot cannot exceed parent's limit of ${parentRestrictions.maxLot}` });

      }

      if (parentRestrictions.minLot && newRestrictions.minLot < parentRestrictions.minLot) {

        return res.status(400).json({ message: `Min lot cannot be less than parent's minimum of ${parentRestrictions.minLot}` });

      }

      if (parentRestrictions.breakupQuantity && newRestrictions.breakupQuantity > parentRestrictions.breakupQuantity) {

        return res.status(400).json({ message: `Breakup quantity cannot exceed parent's limit of ${parentRestrictions.breakupQuantity}` });

      }

      if (parentRestrictions.maxPositionValue && newRestrictions.maxPositionValue > parentRestrictions.maxPositionValue) {

        return res.status(400).json({ message: `Max position value cannot exceed parent's limit of ${parentRestrictions.maxPositionValue}` });

      }

      if (parentRestrictions.maxExposure && newRestrictions.maxExposure > parentRestrictions.maxExposure) {

        return res.status(400).json({ message: `Max exposure cannot exceed parent's limit of ${parentRestrictions.maxExposure}` });

      }

    }



    subBroker.restrictions = normalizeRestrictionsPayload(req.body, req.admin?.role);

    subBroker.markModified('restrictions');

    await subBroker.save();



    const payload = await getRestrictionsResponsePayload(subBroker._id);

    res.json({

      message: 'Restrictions updated successfully',

      restrictions: payload.restrictions,

      updatedAt: payload.updatedAt,

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});


// ==================== LEVERAGE CAP ENDPOINTS ====================

// Set leverage cap for Admin (SuperAdmin only)
router.put('/admins/:id/leverage-cap', protectAdmin, superAdminOnly, (req, res) =>
  leverageController.setAdminLeverageCap(req, res)
);

// Set leverage cap for Broker (Admin only)
router.put('/brokers/:id/leverage-cap', protectAdmin, (req, res) =>
  leverageController.setBrokerLeverageCap(req, res)
);

// Set leverage cap for SubBroker (Broker only)
router.put('/subbrokers/:id/leverage-cap', protectAdmin, (req, res) =>
  leverageController.setSubBrokerLeverageCap(req, res)
);


// Get all brokers (Admin only)

router.get('/brokers', protectAdmin, async (req, res) => {
  try {
    const currentAdmin = req.admin;

    // Admin can only see their own brokers
    const brokers = await Admin.find({
      role: 'BROKER',
      createdBy: currentAdmin._id
    }).select('-password -pin');

    res.json(brokers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// Get all sub-brokers (Broker only)

router.get('/subbrokers', protectAdmin, async (req, res) => {

  try {

    const currentAdmin = req.admin;

    

    // Broker can only see their own sub-brokers

    const subBrokers = await Admin.find({

      role: 'SUB_BROKER',

      createdBy: currentAdmin._id

    }).select('-password -pin');

    

    res.json(subBrokers);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============ HIERARCHICAL LEVERAGE MANAGEMENT ============



// Set max leverage for child admin (hierarchical)

// SuperAdmin can set for Admin, Admin can set for Broker, Broker can set for SubBroker

router.put('/admins/:id/leverage', protectAdmin, async (req, res) => {

  try {

    const { maxLeverageFromParent, intradayLeverage, carryForwardLeverage } = req.body;

    const parentAdmin = req.admin;

    

    const childAdmin = await Admin.findById(req.params.id);

    if (!childAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Verify hierarchy - parent must be able to manage child

    if (!parentAdmin.canManage(childAdmin.role)) {

      return res.status(403).json({ message: 'You cannot manage this admin level' });

    }

    

    // Verify child belongs to parent (check hierarchyPath or parentId)

    if (childAdmin.parentId && childAdmin.parentId.toString() !== parentAdmin._id.toString()) {

      // Check if parent is in hierarchy path

      const isInHierarchy = childAdmin.hierarchyPath?.some(id => id.toString() === parentAdmin._id.toString());

      if (!isInHierarchy && parentAdmin.role !== 'SUPER_ADMIN') {

        return res.status(403).json({ message: 'This admin is not under your management' });

      }

    }

    // Validate leverage settings using service layer
    const validation = leverageValidationService.validateChildLeverageSettings(parentAdmin, {
      maxLeverageFromParent,
      intradayLeverage,
      carryForwardLeverage
    });

    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    // Initialize leverageSettings if not exists

    if (!childAdmin.leverageSettings) {

      childAdmin.leverageSettings = {};

    }

    

    // Update maxLeverageFromParent
    if (maxLeverageFromParent) {
      childAdmin.leverageSettings.maxLeverageFromParent = maxLeverageFromParent;
    }

    // Update intradayLeverage
    if (intradayLeverage !== undefined) {
      childAdmin.leverageSettings.intradayLeverage = intradayLeverage;
    }

    // Update carryForwardLeverage
    if (carryForwardLeverage !== undefined) {
      childAdmin.leverageSettings.carryForwardLeverage = carryForwardLeverage;
    }

    

    // Update legacy fields for backward compatibility

    childAdmin.leverageSettings.maxLeverage = Math.max(

      childAdmin.leverageSettings.intradayLeverage || 10,

      childAdmin.leverageSettings.carryForwardLeverage || 5

    );

    

    await childAdmin.save();

    // Get parent's max leverage for response
    const parentMaxLeverage = leverageValidationService.getParentMaxLeverageLimit(parentAdmin);

    res.json({
      message: 'Leverage settings updated successfully',
      leverageSettings: childAdmin.leverageSettings,
      parentMaxLeverage
    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get leverage settings for admin (including parent's limit)

router.get('/admins/:id/leverage', protectAdmin, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    // Get parent's max leverage for context

    let parentMaxLeverage = 2000; // Default for SuperAdmin

    if (admin.parentId) {

      const parentAdmin = await Admin.findById(admin.parentId);

      if (parentAdmin) {

        parentMaxLeverage = parentAdmin.role === 'SUPER_ADMIN' 

          ? 2000 

          : (parentAdmin.leverageSettings?.maxLeverageFromParent || 10);

      }

    }

    

    res.json({

      leverageSettings: admin.leverageSettings || { enabledLeverages: [1, 2, 5, 10], maxLeverage: 10, maxLeverageFromParent: 10 },

      parentMaxLeverage,

      role: admin.role

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Set leverage for user (by parent admin/broker)

router.put('/users/:id/leverage', protectAdmin, async (req, res) => {

  try {

    const { enabledLeverages, maxLeverage } = req.body;

    const parentAdmin = req.admin;

    

    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    // Verify user belongs to this admin (by adminCode or hierarchyPath)

    const isDirectParent = user.adminCode === parentAdmin.adminCode;

    const isInHierarchy = user.hierarchyPath?.some(id => id.toString() === parentAdmin._id.toString());

    

    if (!isDirectParent && !isInHierarchy && parentAdmin.role !== 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'This user is not under your management' });

    }

    

    // Get parent's max leverage limit

    const parentMaxLeverage = parentAdmin.role === 'SUPER_ADMIN' 

      ? 2000 

      : (parentAdmin.leverageSettings?.maxLeverageFromParent || 10);

    

    // Validate leverages don't exceed parent's limit

    if (enabledLeverages && Array.isArray(enabledLeverages)) {

      const invalidLeverages = enabledLeverages.filter(lev => lev > parentMaxLeverage);

      if (invalidLeverages.length > 0) {

        return res.status(400).json({ 

          message: `Cannot set leverage higher than your limit (${parentMaxLeverage}x). Invalid: ${invalidLeverages.join(', ')}x` 

        });

      }

    }

    

    // Initialize leverageSettings if not exists

    if (!user.leverageSettings) {

      user.leverageSettings = {};

    }

    

    // Update user's leverage settings

    if (enabledLeverages && Array.isArray(enabledLeverages)) {

      user.leverageSettings.enabledLeverages = enabledLeverages.sort((a, b) => a - b);

      user.leverageSettings.maxLeverage = maxLeverage || Math.max(...enabledLeverages);

    }

    

    await user.save();

    

    res.json({ 

      message: 'User leverage settings updated successfully',

      leverageSettings: user.leverageSettings,

      parentMaxLeverage

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get user's leverage settings

router.get('/users/:id/leverage', protectAdmin, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    // Get parent admin's leverage limit

    let parentMaxLeverage = 10;

    if (user.admin) {

      const parentAdmin = await Admin.findById(user.admin);

      if (parentAdmin) {

        parentMaxLeverage = parentAdmin.role === 'SUPER_ADMIN' 

          ? 2000 

          : (parentAdmin.leverageSettings?.maxLeverageFromParent || 10);

      }

    }

    

    res.json({

      leverageSettings: user.leverageSettings || { enabledLeverages: [1, 2, 5, 10], maxLeverage: 10 },

      parentMaxLeverage

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});

// Get parent admin's segment permissions as baseline for hierarchy checks
router.get('/users/:id/parent-segment-baseline', protectAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Get parent admin's segment permissions
    let parentSegmentPermissions = {};
    if (user.admin) {
      const parentAdmin = await Admin.findById(user.admin);
      if (parentAdmin && parentAdmin.segmentPermissions) {
        // Convert Map to plain object if needed
        parentSegmentPermissions = parentAdmin.segmentPermissions instanceof Map
          ? Object.fromEntries(parentAdmin.segmentPermissions)
          : parentAdmin.segmentPermissions;
      }
    }

    // If no parent admin or no parent segment permissions, use system defaults
    if (!parentSegmentPermissions || Object.keys(parentSegmentPermissions).length === 0) {
      try {
        const sysLean = await SystemSettings.findOne({ settingsType: 'global' })
          .select('adminSegmentDefaults')
          .lean();
        const adminSegmentDefaults = plainSegmentDefaultsMap(sysLean?.adminSegmentDefaults || {});
        parentSegmentPermissions = adminSegmentDefaults;
      } catch {
        parentSegmentPermissions = {};
      }
    }

    console.log('[Parent Segment Baseline] User:', user.username, 'Parent segmentPermissions:', JSON.stringify(parentSegmentPermissions, null, 2));
    res.json({ baseline: parentSegmentPermissions });
  } catch (error) {
    console.error('[Parent Segment Baseline] Error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get user's segment settings
router.get('/users/:id/segment-settings', protectAdmin, userSegmentSettingsController.getSegmentSettings.bind(userSegmentSettingsController));

// Update user's segment settings
router.put('/users/:id/segment-settings', protectAdmin, userSegmentSettingsController.updateSegmentSettings.bind(userSegmentSettingsController));

// ============ END HIERARCHICAL LEVERAGE MANAGEMENT ============

// ============ PERMISSION & DEFAULT SETTINGS MANAGEMENT ============

// Update admin permissions (parent admin can set permissions for child admin)

router.put('/admins/:id/permissions', protectAdmin, async (req, res) => {

  try {

    const { permissions } = req.body;

    const parentAdmin = req.admin;

    

    const childAdmin = await Admin.findById(req.params.id);

    if (!childAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Verify hierarchy - parent must be able to manage child

    if (!parentAdmin.canManage(childAdmin.role)) {

      return res.status(403).json({ message: 'You cannot manage this admin level' });

    }

    

    // Verify child belongs to parent

    if (childAdmin.parentId && childAdmin.parentId.toString() !== parentAdmin._id.toString()) {

      const isInHierarchy = childAdmin.hierarchyPath?.some(id => id.toString() === parentAdmin._id.toString());

      if (!isInHierarchy && parentAdmin.role !== 'SUPER_ADMIN') {

        return res.status(403).json({ message: 'This admin is not under your management' });

      }

    }

    

    // Update permissions

    if (!childAdmin.permissions) {

      childAdmin.permissions = {};

    }

    

    Object.keys(permissions).forEach(key => {

      if (typeof permissions[key] === 'boolean') {

        childAdmin.permissions[key] = permissions[key];

      }

    });

    

    await childAdmin.save();

    

    res.json({ 

      message: 'Permissions updated successfully',

      permissions: childAdmin.permissions

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update default settings for admin (parent sets defaults for child)

router.put('/admins/:id/default-settings', protectAdmin, async (req, res) => {

  try {

    const { defaultSettings } = req.body;

    const parentAdmin = req.admin;

    

    const childAdmin = await Admin.findById(req.params.id);

    if (!childAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Verify hierarchy

    if (!parentAdmin.canManage(childAdmin.role)) {

      return res.status(403).json({ message: 'You cannot manage this admin level' });

    }

    

    if (childAdmin.parentId && childAdmin.parentId.toString() !== parentAdmin._id.toString()) {

      const isInHierarchy = childAdmin.hierarchyPath?.some(id => id.toString() === parentAdmin._id.toString());

      if (!isInHierarchy && parentAdmin.role !== 'SUPER_ADMIN') {

        return res.status(403).json({ message: 'This admin is not under your management' });

      }

    }

    

    // Update default settings

    if (!childAdmin.defaultSettings) {

      childAdmin.defaultSettings = {};

    }

    

    if (defaultSettings.brokerage) {

      childAdmin.defaultSettings.brokerage = {

        ...childAdmin.defaultSettings.brokerage,

        ...defaultSettings.brokerage

      };

    }

    

    if (defaultSettings.leverage) {

      childAdmin.defaultSettings.leverage = {

        ...childAdmin.defaultSettings.leverage,

        ...defaultSettings.leverage

      };

    }

    

    if (defaultSettings.charges) {

      childAdmin.defaultSettings.charges = {

        ...childAdmin.defaultSettings.charges,

        ...defaultSettings.charges

      };

    }

    

    if (defaultSettings.lotSettings) {

      childAdmin.defaultSettings.lotSettings = {

        ...childAdmin.defaultSettings.lotSettings,

        ...defaultSettings.lotSettings

      };

    }

    

    if (defaultSettings.quantitySettings) {

      childAdmin.defaultSettings.quantitySettings = {

        ...childAdmin.defaultSettings.quantitySettings,

        ...defaultSettings.quantitySettings

      };

    }

    

    if (typeof defaultSettings.autosquare === 'number') {

      childAdmin.defaultSettings.autosquare = defaultSettings.autosquare;

    }

    

    await childAdmin.save();

    

    res.json({ 

      message: 'Default settings updated successfully',

      defaultSettings: childAdmin.defaultSettings

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});


// Update admin's segment permissions and script settings (parent admin or SuperAdmin)
router.put('/admins/:id/segment-settings', protectAdmin, adminSegmentSettingsController.updateSegmentSettings.bind(adminSegmentSettingsController));

// Get admin's segment permissions and script settings
router.get('/admins/:id/segment-settings', protectAdmin, (req, res, next) => {
  console.log('[ROUTE] GET /admins/:id/segment-settings called');
  console.log('[ROUTE] Params:', req.params);
  next();
}, adminSegmentSettingsController.getSegmentSettings.bind(adminSegmentSettingsController));


function clampSharePct(n, fallback = 50) {

  const x = Number(n);

  if (!Number.isFinite(x)) return fallback;

  return Math.min(100, Math.max(0, Math.round(x)));

}



function deriveBrokerPctFromPattiSegments(segments) {

  if (!segments || typeof segments !== 'object') return null;

  const vals = Object.values(segments)

    .filter((s) => s?.enabled !== false)

    .map((s) => Number(s.brokerPercentage))

    .filter((n) => Number.isFinite(n));

  if (!vals.length) return null;

  return clampSharePct(vals.reduce((a, b) => a + b, 0) / vals.length);

}



function verifyAdminHierarchyForChild(parentAdmin, childAdmin) {

  if (parentAdmin.role === 'SUPER_ADMIN') return true;

  if (!parentAdmin.canManage(childAdmin.role)) return false;

  if (childAdmin.parentId && childAdmin.parentId.toString() !== parentAdmin._id.toString()) {

    const isInHierarchy = childAdmin.hierarchyPath?.some(

      (id) => id.toString() === parentAdmin._id.toString()

    );

    if (!isInHierarchy) return false;

  }

  return true;

}



router.get('/admins/:id/patti-sharing', protectAdmin, async (req, res) => {
  try {
    const targetAdmin = await Admin.findById(req.params.id).select(
      'pattiSharing name adminCode role hierarchyPath parentId referralDistributionEnabled'
    );
    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    await assertCanManagePattiSharing(req.admin, targetAdmin);

    const parentAdmin =
      targetAdmin.parentId && targetAdmin.role !== 'SUPER_ADMIN'
        ? await Admin.findById(targetAdmin.parentId).select('pattiSharing role name username')
        : null;

    const raw = targetAdmin.pattiSharing || {};
    const segments = normalizeIndividualPattiSegments(raw.segments || {});
    const maxPctBySegment = parentAdmin ? buildMaxPctHints(parentAdmin, null) : {};
    const capValues = Object.values(maxPctBySegment).filter((n) => Number.isFinite(n));
    const defaultMaxPct = capValues.length ? Math.min(...capValues) : 100;

    res.json({
      enabled: !!raw.enabled,
      appliedTo: raw.appliedTo || 'ALL_TRADES',
      segments,
      notes: raw.notes || '',
      referralDistributionEnabled: (await import('../utils/referralDistributionHelper.js')).referralDistributionForResponse(
        targetAdmin
      ),
      parentAdmin: parentAdmin
        ? {
            _id: parentAdmin._id,
            name: parentAdmin.name || parentAdmin.username,
            role: parentAdmin.role,
          }
        : null,
      maxPctBySegment,
      defaultMaxPct,
      targetRole: targetAdmin.role,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  }
});

router.put('/admins/:id/patti-sharing', protectAdmin, async (req, res) => {
  try {
    const childAdmin = await Admin.findById(req.params.id);
    if (!childAdmin) return res.status(404).json({ message: 'Admin not found' });

    const manage = await assertCanManagePattiSharing(req.admin, childAdmin);
    const { enabled, appliedTo, segments, notes, referralDistributionEnabled } = req.body || {};

    const parentAdmin =
      childAdmin.parentId && childAdmin.role !== 'SUPER_ADMIN'
        ? await Admin.findById(childAdmin.parentId).select('pattiSharing role')
        : null;

    if (segments && parentAdmin && manage.mode === 'parent_child') {
      const { normalized, errors } = validateChildSegmentsAgainstParentCap(
        parentAdmin,
        segments,
        null
      );
      if (errors.length > 0) {
        const first = errors[0];
        return res.status(400).json({
          message: `Patti % cannot exceed your share (${first.max}%) for segment ${first.segKey}.`,
          errors,
        });
      }
      if (normalized) {
        req.body.segments = normalized;
      }
    }

    let franchiseCleared = null;
    let message = 'Patti sharing updated';

    if (manage.mode === 'sa_admin_root' && childAdmin.role === 'ADMIN') {
      const result = await applyPattiSubtreeFromAdminRoot(childAdmin, {
        enabled,
        appliedTo,
        segments: req.body.segments || segments,
        notes,
      });
      franchiseCleared = result.franchiseCleared;
      if (franchiseCleared) {
        message =
          'Patti sharing updated. Franchise root was turned off (mutually exclusive). Downline can set broker/sub-broker patti within caps.';
      } else if (childAdmin.pattiSharing.enabled) {
        message = `Patti sharing enabled for ${childAdmin.name || childAdmin.username}. Set broker/sub-broker patti from their parent accounts.`;
      } else {
        message = 'Patti sharing disabled for this admin.';
      }
    } else {
      await applyPattiOnDirectChild(childAdmin, {
        enabled,
        appliedTo,
        segments: req.body.segments || segments,
        notes,
      });
      message = `Patti sharing saved for ${childAdmin.name || childAdmin.username}.`;
    }

    if (
      childAdmin.role === 'ADMIN' &&
      manage.mode === 'sa_admin_root' &&
      referralDistributionEnabled &&
      typeof referralDistributionEnabled === 'object'
    ) {
      const { applyReferralDistributionPatch } = await import('../utils/referralDistributionHelper.js');
      applyReferralDistributionPatch(childAdmin, referralDistributionEnabled);
      await childAdmin.save();
    }

    const segmentsOut = normalizeIndividualPattiSegments(childAdmin.pattiSharing.segments || {});
    const { referralDistributionForResponse } = await import('../utils/referralDistributionHelper.js');

    res.json({
      message,
      enabled: !!childAdmin.pattiSharing.enabled,
      appliedTo: childAdmin.pattiSharing.appliedTo || 'ALL_TRADES',
      segments: segmentsOut,
      notes: childAdmin.pattiSharing.notes || '',
      referralDistributionEnabled: referralDistributionForResponse(childAdmin),
      franchiseDisabled: !!franchiseCleared,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  }
});



// Admin wallet transfer - Transfer funds between different wallets of an admin

router.post('/admins/:id/wallet-transfer', protectAdmin, async (req, res) => {

  try {

    const { sourceWallet, targetWallet, amount, remarks } = req.body;

    const parentAdmin = req.admin;

    const targetAdminId = req.params.id;



    if (!sourceWallet || !targetWallet) {

      return res.status(400).json({ message: 'Source and target wallets are required' });

    }



    if (!amount || amount <= 0) {

      return res.status(400).json({ message: 'Transfer amount must be greater than 0' });

    }



    const targetAdmin = await Admin.findById(targetAdminId);

    if (!targetAdmin) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    // Verify hierarchy - parent must be able to manage child

    if (parentAdmin.role !== 'SUPER_ADMIN') {

      if (!parentAdmin.canManage(targetAdmin.role)) {

        return res.status(403).json({ message: 'You cannot manage this admin level' });

      }

      if (targetAdmin.parentId && targetAdmin.parentId.toString() !== parentAdmin._id.toString()) {

        const isInHierarchy = targetAdmin.hierarchyPath?.some(id => id.toString() === parentAdmin._id.toString());

        if (!isInHierarchy) {

          return res.status(403).json({ message: 'This admin is not under your management' });

        }

      }

    }



    // Execute transfer

    const result = await WalletTransferService.executeTransfer(

      targetAdminId,

      sourceWallet,

      targetWallet,

      amount,

      remarks || '',

      parentAdmin._id

    );



    res.json(result);

  } catch (error) {

    res.status(400).json({ message: error.message });

  }

});



// Get admin permissions and default settings

router.get('/admins/:id/permissions', protectAdmin, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    res.json({

      permissions: admin.permissions || {

        canChangeBrokerage: false,

        canChangeCharges: false,

        canChangeLeverage: false,

        canChangeLotSettings: false,

        canChangeTradingSettings: false,

        canCreateUsers: true,

        canManageFunds: true

      },

      defaultSettings: admin.defaultSettings || {

        brokerage: { perLot: 20, perCrore: 100, perTrade: 10 },

        leverage: { intraday: 10, carryForward: 5 }

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============ END PERMISSION & DEFAULT SETTINGS MANAGEMENT ============



// Create user (Super Admin only) - can assign to any admin

router.post('/create-user', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { 

      username, email, password, fullName, phone, adminCode, initialBalance,

      // New settings

      marginType, ledgerBalanceClosePercent, profitTradeHoldSeconds, lossTradeHoldSeconds,

      // Toggle settings

      isActivated, isReadOnly, isDemo, intradaySquare, blockLimitAboveBelowHighLow, blockLimitBetweenHighLow

    } = req.body;

    

    if (!username || !email || !password) {

      return res.status(400).json({ message: 'Username, email and password are required' });

    }

    

    // Check if user already exists

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });

    if (existingUser) {

      return res.status(400).json({ message: 'User with this email or username already exists' });

    }

    

    // Find the target admin if adminCode is provided and not SUPER

    let targetAdmin = null;

    let targetAdminCode = adminCode || 'SUPER';

    

    if (adminCode && adminCode !== 'SUPER') {

      targetAdmin = await Admin.findOne({ adminCode });

      if (!targetAdmin) {

        return res.status(400).json({ message: 'Invalid admin code' });

      }

      

      // Check restrict mode for target admin

      if (targetAdmin.restrictMode?.enabled) {

        const currentUserCount = await User.countDocuments({ admin: targetAdmin._id });

        const maxUsers = targetAdmin.restrictMode.maxUsers || 100;

        

        if (currentUserCount >= maxUsers) {

          return res.status(403).json({ 

            message: `User limit reached for ${targetAdmin.username}. Maximum ${maxUsers} users allowed. Current: ${currentUserCount}`,

            restrictMode: true,

            currentUsers: currentUserCount,

            maxUsers: maxUsers

          });

        }

      }

    }

    

    // Inherit segmentPermissions and scriptSettings from the target admin

    // Settings cascade: SuperAdmin defaults → Admin → Broker → SubBroker → User

    // If admin has no settings, fallback to SystemSettings segmentDefaults

    let inheritedSegmentPermissions = {};

    let inheritedScriptSettings = {};

    

    if (targetAdmin) {

      // Get admin's segment permissions (convert Map to plain object)

      const adminSegPerms = targetAdmin.segmentPermissions;

      if (adminSegPerms && ((adminSegPerms instanceof Map && adminSegPerms.size > 0) || Object.keys(adminSegPerms).length > 0)) {

        inheritedSegmentPermissions = adminSegPerms instanceof Map 

          ? Object.fromEntries(adminSegPerms) 

          : adminSegPerms;

      }

      

      // Get admin's script settings

      const adminScriptSettings = targetAdmin.scriptSettings;

      if (adminScriptSettings && ((adminScriptSettings instanceof Map && adminScriptSettings.size > 0) || Object.keys(adminScriptSettings).length > 0)) {

        inheritedScriptSettings = adminScriptSettings instanceof Map 

          ? Object.fromEntries(adminScriptSettings) 

          : adminScriptSettings;

      }

    }

    

    // Fallback to SystemSettings adminSegmentDefaults if no segment permissions inherited

    if (Object.keys(inheritedSegmentPermissions).length === 0) {

      try {

        const sysSettings = await SystemSettings.getSettings();

        const asd = sysSettings?.adminSegmentDefaults;

        if (asd && ((asd instanceof Map && asd.size > 0) || Object.keys(asd).length > 0)) {

          inheritedSegmentPermissions = asd instanceof Map ? Object.fromEntries(asd) : { ...asd };

        }

        const assd = sysSettings?.adminScriptDefaults;

        if (assd && ((assd instanceof Map && assd.size > 0) || Object.keys(assd).length > 0)) {

          inheritedScriptSettings = assd instanceof Map ? Object.fromEntries(assd) : { ...assd };

        }

      } catch (e) {

        console.error('Failed to load SystemSettings fallback:', e.message);

      }

    }

    

    // Create user - segment/script settings inherited from admin (not set in create form)

    const user = await User.create({

      username,

      email,

      password,

      fullName: fullName || '',

      phone: phone || '',

      adminCode: targetAdminCode,

      admin: targetAdmin?._id || null,

      createdBy: targetAdmin?._id || req.admin._id,

      creatorRole: targetAdmin?.role || req.admin.role,

      hierarchyPath: targetAdmin?.hierarchyPath
        ? [...targetAdmin.hierarchyPath, targetAdmin._id]
        : targetAdmin
          ? [targetAdmin._id]
          : [],

      wallet: {

        balance: initialBalance || 0,

        cashBalance: initialBalance || 0,

        blocked: 0

      },

      isActive: isActivated !== false,

      settings: {

        marginType: marginType || 'exposure',

        ledgerBalanceClosePercent: ledgerBalanceClosePercent || 90,

        profitTradeHoldSeconds: profitTradeHoldSeconds || 0,

        lossTradeHoldSeconds: lossTradeHoldSeconds || 0,

        isActivated: isActivated !== false,

        isReadOnly: isReadOnly || false,

        isDemo: isDemo || false,

        intradaySquare: intradaySquare || false,

        blockLimitAboveBelowHighLow: blockLimitAboveBelowHighLow || false,

        blockLimitBetweenHighLow: blockLimitBetweenHighLow || false

      },

      // Inherited from admin - no hardcoded defaults

      segmentPermissions: inheritedSegmentPermissions,

      scriptSettings: inheritedScriptSettings

    });

    

    // Update admin stats if assigned to an admin

    if (targetAdmin) {

      targetAdmin.stats.totalUsers = (targetAdmin.stats.totalUsers || 0) + 1;

      targetAdmin.stats.activeUsers = (targetAdmin.stats.activeUsers || 0) + 1;

      await targetAdmin.save();

    }

    

    res.status(201).json({

      message: 'User created successfully',

      user: {

        _id: user._id,

        userId: user.userId,

        username: user.username,

        email: user.email,

        adminCode: user.adminCode,

        settings: user.settings,

        segmentPermissions: user.segmentPermissions

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Manage user delivery pledge (Super Admin only)

router.post('/users/:userId/delivery-pledge', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { userId } = req.params;

    const { action, amount } = req.body; // action: 'add', 'deduct', 'set'

    

    if (!action || amount === undefined) {

      return res.status(400).json({ message: 'Action and amount are required' });

    }

    

    const user = await User.findById(userId);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    const currentBalance = user.deliveryPledge?.balance || 0;

    let newBalance;

    

    switch (action) {

      case 'add':

        newBalance = currentBalance + parseFloat(amount);

        break;

      case 'deduct':

        newBalance = Math.max(0, currentBalance - parseFloat(amount));

        break;

      case 'set':

        newBalance = parseFloat(amount);

        break;

      default:

        return res.status(400).json({ message: 'Invalid action. Use add, deduct, or set' });

    }

    

    await User.updateOne(

      { _id: userId },

      { 

        $set: { 

          'deliveryPledge.balance': newBalance,

          'deliveryPledge.lastUpdated': new Date()

        }

      }

    );

    

    // Create ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: userId,

      adminCode: user.adminCode,

      type: action === 'deduct' ? 'DEBIT' : 'CREDIT',

      reason: 'DELIVERY_PLEDGE_ADJUSTMENT',

      amount: parseFloat(amount),

      balanceAfter: newBalance,

      description: `Delivery Pledge ${action}: ${parseFloat(amount).toLocaleString()} by Admin`,

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: `Pledge ${action === 'add' ? 'added' : action === 'deduct' ? 'deducted' : 'set'} successfully`,

      previousBalance: currentBalance,

      newBalance

    });

  } catch (error) {

    console.error('Delivery pledge update error:', error);

    res.status(500).json({ message: error.message });

  }

});



// Transfer user to another admin (Super Admin only)

router.post('/users/:userId/transfer', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { targetAdminId } = req.body;

    const { userId } = req.params;

    

    if (!targetAdminId) {

      return res.status(400).json({ message: 'Target admin ID is required' });

    }

    

    // Find the user

    const user = await User.findById(userId);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    // Find the target admin

    const targetAdmin = await Admin.findById(targetAdminId);

    if (!targetAdmin) {

      return res.status(404).json({ message: 'Target admin not found' });

    }

    

    if (targetAdmin.status !== 'ACTIVE') {

      return res.status(400).json({ message: 'Target admin is not active' });

    }

    

    // Get the old admin to update stats

    const oldAdmin = await Admin.findById(user.admin);

    const oldAdminCode = user.adminCode;

    

    // Update user's admin reference using updateOne to avoid segmentPermissions validation

    await User.updateOne(

      { _id: userId },

      { $set: { admin: targetAdmin._id, adminCode: targetAdmin.adminCode } }

    );

    

    // Update old admin stats

    if (oldAdmin) {

      await Admin.updateOne(

        { _id: oldAdmin._id },

        { 

          $set: { 

            'stats.totalUsers': Math.max(0, (oldAdmin.stats.totalUsers || 1) - 1),

            'stats.activeUsers': user.isActive ? Math.max(0, (oldAdmin.stats.activeUsers || 1) - 1) : oldAdmin.stats.activeUsers

          }

        }

      );

    }

    

    // Update new admin stats

    await Admin.updateOne(

      { _id: targetAdmin._id },

      { 

        $set: { 

          'stats.totalUsers': (targetAdmin.stats.totalUsers || 0) + 1,

          'stats.activeUsers': user.isActive ? (targetAdmin.stats.activeUsers || 0) + 1 : targetAdmin.stats.activeUsers

        }

      }

    );

    

    res.json({ 

      message: 'User transferred successfully',

      user: {

        _id: user._id,

        username: user.username,

        email: user.email,

        oldAdminCode,

        newAdminCode: targetAdmin.adminCode,

        newAdminName: targetAdmin.name

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get all users for Super Admin (can see all users across all admins)

router.get('/all-users', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const users = await User.find()

      .select('-password -__v')

      .populate('admin', 'name adminCode')

      .sort({ createdAt: -1 });

    

    // Get net positions (M2M) for all users with open trades

    const userPositions = await Trade.aggregate([

      { $match: { status: 'OPEN' } },

      { $group: { 

        _id: '$user',

        netPosition: { $sum: '$unrealizedPnL' },

        openTrades: { $sum: 1 },

        totalValue: { $sum: { $multiply: ['$quantity', '$entryPrice'] } }

      }}

    ]);

    

    // Create a map for quick lookup

    const positionMap = {};

    userPositions.forEach(p => {

      positionMap[p._id.toString()] = {

        netPosition: p.netPosition || 0,

        openTrades: p.openTrades || 0,

        totalValue: p.totalValue || 0

      };

    });

    

    // Merge position data with users

    const usersWithPositions = users.map(user => {

      const userObj = user.toObject();

      const position = positionMap[user._id.toString()] || { netPosition: 0, openTrades: 0, totalValue: 0 };

      return {

        ...userObj,

        netPosition: position.netPosition,

        openTrades: position.openTrades,

        totalValue: position.totalValue

      };

    });

    

    res.json(usersWithPositions);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Add funds to admin wallet (Parent can add to subordinate)

router.post('/admins/:id/add-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can add to anyone, others can only add to their subordinates

    if (req.admin.role !== 'SUPER_ADMIN') {

      const isSubordinate = targetAdmin.parentId?.toString() === req.admin._id.toString() ||

                           targetAdmin.hierarchyPath?.includes(req.admin._id.toString());

      if (!isSubordinate) {

        return res.status(403).json({ message: 'You can only add funds to your subordinates' });

      }

      

      // Check if parent has sufficient balance

      if (req.admin.wallet.balance < amount) {

        return res.status(400).json({ message: `Insufficient balance. You have ${req.admin.wallet.balance.toLocaleString()}` });

      }

      

      // Deduct from parent's wallet

      req.admin.wallet.balance -= amount;

      req.admin.wallet.totalWithdrawn += amount;

      await req.admin.save();

      

      // Create ledger entry for parent (debit)

      await WalletLedger.create({

        ownerType: 'ADMIN',

        ownerId: req.admin._id,

        adminCode: req.admin.adminCode,

        type: 'DEBIT',

        reason: 'ADMIN_TRANSFER',

        amount,

        balanceAfter: req.admin.wallet.balance,

        description: `Transferred to ${targetAdmin.name || targetAdmin.username}`,

        performedBy: req.admin._id

      });

    }

    

    // Update target admin wallet

    targetAdmin.wallet.balance += amount;

    targetAdmin.wallet.totalDeposited += amount;

    await targetAdmin.save();

    

    // Create ledger entry for target (credit)

    const ledgerEntry = await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: targetAdmin._id,

      adminCode: targetAdmin.adminCode,

      type: 'CREDIT',

      reason: 'ADMIN_DEPOSIT',

      amount,

      balanceAfter: targetAdmin.wallet.balance,

      description: description || `Fund added by ${req.admin.name || req.admin.username}`,

      performedBy: req.admin._id

    });

    

    console.log(`[Add Funds] Created ledger entry for ${targetAdmin.adminCode}: ${amount}, ID: ${ledgerEntry._id}`);

    

    res.json({ message: 'Funds added successfully', wallet: targetAdmin.wallet });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get fund history for an admin

router.get('/admins/:id/fund-history', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can view anyone, others can only view their subordinates

    if (req.admin.role !== 'SUPER_ADMIN') {

      const isSubordinate = targetAdmin.parentId?.toString() === req.admin._id.toString() ||

                           targetAdmin.hierarchyPath?.includes(req.admin._id.toString());

      const isSelf = req.admin._id.toString() === targetAdmin._id.toString();

      if (!isSubordinate && !isSelf) {

        return res.status(403).json({ message: 'You can only view fund history of your subordinates' });

      }

    }

    

    console.log(`[Fund History] Querying for Admin ID: ${targetAdmin._id}, Code: ${targetAdmin.adminCode}`);

    

    // Fetch wallet ledger entries for this admin (all transactions)

    // Try both by ownerId and by adminCode to ensure we get all records

    const historyByOwnerId = await WalletLedger.find({

      ownerType: 'ADMIN',

      ownerId: targetAdmin._id

    })

    .populate('performedBy', 'name username adminCode')

    .sort({ createdAt: -1 })

    .limit(100);

    

    // Also check by adminCode in case ownerId wasn't set correctly

    const historyByAdminCode = await WalletLedger.find({

      ownerType: 'ADMIN',

      adminCode: targetAdmin.adminCode

    })

    .populate('performedBy', 'name username adminCode')

    .sort({ createdAt: -1 })

    .limit(100);

    

    // Merge and deduplicate

    const allHistory = [...historyByOwnerId];

    const existingIds = new Set(historyByOwnerId.map(h => h._id.toString()));

    

    for (const h of historyByAdminCode) {

      if (!existingIds.has(h._id.toString())) {

        allHistory.push(h);

      }

    }

    

    // Sort by date

    allHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    

    console.log(`[Fund History] Admin: ${targetAdmin.adminCode}, Found ${historyByOwnerId.length} by ownerId, ${historyByAdminCode.length} by adminCode, Total unique: ${allHistory.length}`);

    

    res.json({ 

      history: allHistory.slice(0, 100),

      wallet: targetAdmin.wallet,

      admin: {

        _id: targetAdmin._id,

        name: targetAdmin.name,

        username: targetAdmin.username,

        adminCode: targetAdmin.adminCode

      }

    });

  } catch (error) {

    console.error('[Fund History Error]', error);

    res.status(500).json({ message: error.message });

  }

});



// Get complete hierarchy under an admin (Brokers -> Sub-Brokers -> Clients with balances)

router.get('/admins/:id/hierarchy', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id).select('-password -pin');

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission

    if (req.admin.role !== 'SUPER_ADMIN') {

      const isSubordinate = targetAdmin.parentId?.toString() === req.admin._id.toString() ||

                           targetAdmin.hierarchyPath?.includes(req.admin._id.toString());

      const isSelf = req.admin._id.toString() === targetAdmin._id.toString();

      if (!isSubordinate && !isSelf) {

        return res.status(403).json({ message: 'Access denied' });

      }

    }

    

    // Get all brokers under this admin

    const brokers = await Admin.find({ 

      parentId: targetAdmin._id, 

      role: 'BROKER' 

    }).select('-password -pin').lean();

    

    // Get all sub-brokers under this admin (direct) and under brokers

    const directSubBrokers = await Admin.find({ 

      parentId: targetAdmin._id, 

      role: 'SUB_BROKER' 

    }).select('-password -pin').lean();

    

    // Get sub-brokers under each broker

    const brokerIds = brokers.map(b => b._id);

    const brokerSubBrokers = await Admin.find({ 

      parentId: { $in: brokerIds }, 

      role: 'SUB_BROKER' 

    }).select('-password -pin').lean();

    

    // Get all users under this admin hierarchy

    const allAdminIds = [

      targetAdmin._id,

      ...brokers.map(b => b._id),

      ...directSubBrokers.map(s => s._id),

      ...brokerSubBrokers.map(s => s._id)

    ];

    

    const users = await User.find({ 

      admin: { $in: allAdminIds } 

    }).select('fullName username email phone wallet isActive admin adminCode createdAt').lean();

    

    // Build hierarchy structure

    const hierarchy = {

      admin: {

        _id: targetAdmin._id,

        name: targetAdmin.name,

        username: targetAdmin.username,

        adminCode: targetAdmin.adminCode,

        role: targetAdmin.role,

        wallet: targetAdmin.wallet,

        status: targetAdmin.status

      },

      brokers: brokers.map(broker => {

        const brokerSubBrokersFiltered = brokerSubBrokers.filter(

          sb => sb.parentId?.toString() === broker._id.toString()

        );

        const brokerUsers = users.filter(u => u.admin?.toString() === broker._id.toString());

        

        return {

          _id: broker._id,

          name: broker.name,

          username: broker.username,

          adminCode: broker.adminCode,

          wallet: broker.wallet,

          status: broker.status,

          subBrokers: brokerSubBrokersFiltered.map(sb => {

            const sbUsers = users.filter(u => u.admin?.toString() === sb._id.toString());

            return {

              _id: sb._id,

              name: sb.name,

              username: sb.username,

              adminCode: sb.adminCode,

              wallet: sb.wallet,

              status: sb.status,

              users: sbUsers,

              userCount: sbUsers.length,

              totalUserBalance: sbUsers.reduce((sum, u) => sum + (u.wallet?.balance || u.wallet?.cashBalance || 0), 0)

            };

          }),

          users: brokerUsers,

          userCount: brokerUsers.length,

          totalUserBalance: brokerUsers.reduce((sum, u) => sum + (u.wallet?.balance || u.wallet?.cashBalance || 0), 0),

          subBrokerCount: brokerSubBrokersFiltered.length

        };

      }),

      directSubBrokers: directSubBrokers.map(sb => {

        const sbUsers = users.filter(u => u.admin?.toString() === sb._id.toString());

        return {

          _id: sb._id,

          name: sb.name,

          username: sb.username,

          adminCode: sb.adminCode,

          wallet: sb.wallet,

          status: sb.status,

          users: sbUsers,

          userCount: sbUsers.length,

          totalUserBalance: sbUsers.reduce((sum, u) => sum + (u.wallet?.balance || u.wallet?.cashBalance || 0), 0)

        };

      }),

      directUsers: users.filter(u => u.admin?.toString() === targetAdmin._id.toString()),

      stats: {

        totalBrokers: brokers.length,

        totalSubBrokers: directSubBrokers.length + brokerSubBrokers.length,

        totalUsers: users.length,

        totalBrokerBalance: brokers.reduce((sum, b) => sum + (b.wallet?.balance || 0), 0),

        totalSubBrokerBalance: [...directSubBrokers, ...brokerSubBrokers].reduce((sum, s) => sum + (s.wallet?.balance || 0), 0),

        totalUserBalance: users.reduce((sum, u) => sum + (u.wallet?.balance || u.wallet?.cashBalance || 0), 0)

      }

    };

    

    res.json(hierarchy);

  } catch (error) {

    console.error('Error fetching hierarchy:', error);

    res.status(500).json({ message: error.message });

  }

});



// Deduct funds from admin wallet (Parent can deduct from subordinate)

router.post('/admins/:id/deduct-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can deduct from anyone, others can only deduct from their subordinates

    if (req.admin.role !== 'SUPER_ADMIN') {

      const isSubordinate = targetAdmin.parentId?.toString() === req.admin._id.toString() ||

                           targetAdmin.hierarchyPath?.includes(req.admin._id.toString());

      if (!isSubordinate) {

        return res.status(403).json({ message: 'You can only deduct funds from your subordinates' });

      }

    }

    

    if (targetAdmin.wallet.balance < amount) {

      return res.status(400).json({ message: 'Insufficient balance in target wallet' });

    }

    

    // Update target admin wallet

    targetAdmin.wallet.balance -= amount;

    targetAdmin.wallet.totalWithdrawn += amount;

    await targetAdmin.save();

    

    // Create ledger entry for target (debit)

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: targetAdmin._id,

      adminCode: targetAdmin.adminCode,

      type: 'DEBIT',

      reason: 'ADMIN_WITHDRAW',

      amount,

      balanceAfter: targetAdmin.wallet.balance,

      description: description || `Fund deducted by ${req.admin.name || req.admin.username}`,

      performedBy: req.admin._id

    });

    

    // Credit back to parent (except Super Admin)

    if (req.admin.role !== 'SUPER_ADMIN') {

      req.admin.wallet.balance += amount;

      req.admin.wallet.totalDeposited += amount;

      await req.admin.save();

      

      // Create ledger entry for parent (credit)

      await WalletLedger.create({

        ownerType: 'ADMIN',

        ownerId: req.admin._id,

        adminCode: req.admin.adminCode,

        type: 'CREDIT',

        reason: 'ADMIN_TRANSFER',

        amount,

        balanceAfter: req.admin.wallet.balance,

        description: `Received from ${targetAdmin.name || targetAdmin.username}`,

        performedBy: req.admin._id

      });

    }

    

    res.json({ message: 'Funds deducted successfully', wallet: targetAdmin.wallet });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get dashboard stats - works for all roles based on hierarchy

router.get('/dashboard-stats', protectAdmin, async (req, res) => {

  try {

    let adminQuery = {};

    let userQuery = {};

    

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin sees all

      adminQuery = { role: { $ne: 'SUPER_ADMIN' } };

      userQuery = {};

    } else {

      // Other roles see only their descendants

      adminQuery = { hierarchyPath: req.admin._id };

      userQuery = { hierarchyPath: req.admin._id };

    }

    

    // Count by role

    const totalAdmins = await Admin.countDocuments({ ...adminQuery, role: 'ADMIN' });

    const activeAdmins = await Admin.countDocuments({ ...adminQuery, role: 'ADMIN', status: 'ACTIVE' });

    const totalBrokers = await Admin.countDocuments({ ...adminQuery, role: 'BROKER' });

    const activeBrokers = await Admin.countDocuments({ ...adminQuery, role: 'BROKER', status: 'ACTIVE' });

    const totalSubBrokers = await Admin.countDocuments({ ...adminQuery, role: 'SUB_BROKER' });

    const activeSubBrokers = await Admin.countDocuments({ ...adminQuery, role: 'SUB_BROKER', status: 'ACTIVE' });

    

    // User counts

    const totalUsers = await User.countDocuments(userQuery);

    const activeUsers = await User.countDocuments({ ...userQuery, isActive: true });

    

    // Direct users (users created directly by this admin)

    const directUsers = req.admin.role !== 'SUPER_ADMIN' 

      ? await User.countDocuments({ admin: req.admin._id })

      : totalUsers;

    

    // Aggregate wallet balances by role

    const adminWalletBalance = await Admin.aggregate([

      { $match: { ...adminQuery, role: 'ADMIN' } },

      { $group: { _id: null, totalBalance: { $sum: '$wallet.balance' } } }

    ]);

    

    const brokerWalletBalance = await Admin.aggregate([

      { $match: { ...adminQuery, role: 'BROKER' } },

      { $group: { _id: null, totalBalance: { $sum: '$wallet.balance' } } }

    ]);

    

    const subBrokerWalletBalance = await Admin.aggregate([

      { $match: { ...adminQuery, role: 'SUB_BROKER' } },

      { $group: { _id: null, totalBalance: { $sum: '$wallet.balance' } } }

    ]);

    

    const userWallets = await User.aggregate([

      { $match: userQuery },

      { $group: { _id: null, totalBalance: { $sum: '$wallet.cashBalance' } } }

    ]);

    

    const totalAdminBalance = (adminWalletBalance[0]?.totalBalance || 0) + 

                              (brokerWalletBalance[0]?.totalBalance || 0) + 

                              (subBrokerWalletBalance[0]?.totalBalance || 0);

    

    // Aggregate M2M (Mark-to-Market) from open trades

    const openTradesM2M = await Trade.aggregate([

      { $match: { status: 'OPEN' } },

      { $group: { 

        _id: null, 

        totalM2M: { $sum: '$unrealizedPnL' },

        totalOpenTrades: { $sum: 1 },

        totalOpenValue: { $sum: { $multiply: ['$quantity', '$entryPrice'] } }

      }}

    ]);

    

    // Get M2M by segment

    const m2mBySegment = await Trade.aggregate([

      { $match: { status: 'OPEN' } },

      { $group: { 

        _id: '$segment', 

        m2m: { $sum: '$unrealizedPnL' },

        openTrades: { $sum: 1 }

      }}

    ]);

    

    // Get today's realized P&L

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const todayRealizedPnL = await Trade.aggregate([

      { $match: { status: 'CLOSED', closedAt: { $gte: today } } },

      { $group: { _id: null, totalPnL: { $sum: '$realizedPnL' }, trades: { $sum: 1 } } }

    ]);

    

    res.json({

      // Admins

      totalAdmins,

      activeAdmins,

      // Brokers

      totalBrokers,

      activeBrokers,

      // Sub Brokers

      totalSubBrokers,

      activeSubBrokers,

      // Users

      totalUsers,

      activeUsers,

      directUsers,

      // Balances by role

      adminWalletBalance: adminWalletBalance[0]?.totalBalance || 0,

      brokerWalletBalance: brokerWalletBalance[0]?.totalBalance || 0,

      subBrokerWalletBalance: subBrokerWalletBalance[0]?.totalBalance || 0,

      totalAdminBalance,

      totalUserBalance: userWallets[0]?.totalBalance || 0,

      // M2M (Mark-to-Market) Data

      totalM2M: openTradesM2M[0]?.totalM2M || 0,

      totalOpenTrades: openTradesM2M[0]?.totalOpenTrades || 0,

      totalOpenValue: openTradesM2M[0]?.totalOpenValue || 0,

      m2mBySegment: m2mBySegment.reduce((acc, item) => {

        acc[item._id] = { m2m: item.m2m, openTrades: item.openTrades };

        return acc;

      }, {}),

      todayRealizedPnL: todayRealizedPnL[0]?.totalPnL || 0,

      todayClosedTrades: todayRealizedPnL[0]?.trades || 0,

      // Current admin info

      myRole: req.admin.role,

      myBalance: req.admin.wallet?.balance || 0

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== ADMIN ROUTES (Both Super Admin & Admin) ====================



// Get my profile

router.get('/profile', protectAdmin, async (req, res) => {

  try {

    res.json(req.admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update my profile

router.put('/profile', protectAdmin, async (req, res) => {

  try {

    const { name, phone } = req.body;

    

    if (name) req.admin.name = name;

    if (phone) req.admin.phone = phone;

    

    await req.admin.save();

    res.json(req.admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get my users (Admin sees only their users, Super Admin sees all)

router.get('/users', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req);

    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    const { isUserInActiveFranchiseSubtree } = await import('../utils/franchiseBrokerage.js');

    const payload = await Promise.all(
      users.map(async (u) => ({
        ...u.toObject(),
        franchiseActive: await isUserInActiveFranchiseSubtree(u),
      }))
    );

    res.json(payload);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Create user (All roles can create users under them)

router.post('/users', protectAdmin, async (req, res) => {

  try {

    const { 

      username, email, password, fullName, phone, initialBalance,

      marginType, ledgerBalanceClosePercent, profitTradeHoldSeconds, lossTradeHoldSeconds,

      isActivated, isReadOnly, isDemo, intradaySquare, blockLimitAboveBelowHighLow, blockLimitBetweenHighLow

    } = req.body;

    

    // Check restrict mode - if enabled, verify user limit not exceeded

    if (req.admin.restrictMode?.enabled && req.admin.role !== 'SUPER_ADMIN') {

      const currentUserCount = await User.countDocuments({ admin: req.admin._id });

      const maxUsers = req.admin.restrictMode.maxUsers || 100;

      

      if (currentUserCount >= maxUsers) {

        return res.status(403).json({ 

          message: `User limit reached. Maximum ${maxUsers} users allowed. Current: ${currentUserCount}`,

          restrictMode: true,

          currentUsers: currentUserCount,

          maxUsers: maxUsers

        });

      }

    }

    

    // Check if user exists

    const exists = await User.findOne({ $or: [{ email }, { username }] });

    if (exists) {

      return res.status(400).json({ message: 'User with this email or username already exists' });

    }

    

    // Build hierarchy path for the user (includes all ancestors + creator)

    const userHierarchyPath = [...(req.admin.hierarchyPath || []), req.admin._id];

    

    // Inherit segmentPermissions and scriptSettings from the creating admin

    // Settings cascade: SuperAdmin → Admin → Broker → SubBroker → User

    // If admin has no settings, fallback to SystemSettings segmentDefaults

    let inheritedSegmentPermissions = {};

    let inheritedScriptSettings = {};

    

    const adminSegPerms = req.admin.segmentPermissions;

    if (adminSegPerms && ((adminSegPerms instanceof Map && adminSegPerms.size > 0) || Object.keys(adminSegPerms).length > 0)) {

      inheritedSegmentPermissions = adminSegPerms instanceof Map 

        ? Object.fromEntries(adminSegPerms) 

        : adminSegPerms;

    }

    

    const adminScriptSettings = req.admin.scriptSettings;

    if (adminScriptSettings && ((adminScriptSettings instanceof Map && adminScriptSettings.size > 0) || Object.keys(adminScriptSettings).length > 0)) {

      inheritedScriptSettings = adminScriptSettings instanceof Map 

        ? Object.fromEntries(adminScriptSettings) 

        : adminScriptSettings;

    }

    

    // Fallback to SystemSettings adminSegmentDefaults if no segment permissions inherited

    if (Object.keys(inheritedSegmentPermissions).length === 0) {

      try {

        const sysSettings = await SystemSettings.getSettings();

        const asd = sysSettings?.adminSegmentDefaults;

        if (asd && ((asd instanceof Map && asd.size > 0) || Object.keys(asd).length > 0)) {

          inheritedSegmentPermissions = asd instanceof Map ? Object.fromEntries(asd) : { ...asd };

        }

        const assd = sysSettings?.adminScriptDefaults;

        if (assd && ((assd instanceof Map && assd.size > 0) || Object.keys(assd).length > 0)) {

          inheritedScriptSettings = assd instanceof Map ? Object.fromEntries(assd) : { ...assd };

        }

      } catch (e) {

        console.error('Failed to load SystemSettings fallback:', e.message);

      }

    }

    

    // If creator is a demo broker, user should also be demo user

    const isDemoUser = req.admin.isDemo === true || isDemo || false;

    let demoExpiresAt = null;
    if (isDemoUser) {
      const { buildDemoExpiresAt } = await import('../utils/demoAccountUtils.js');
      demoExpiresAt = await buildDemoExpiresAt(new Date());
    }

    

    const user = await User.create({

      adminCode: req.admin.adminCode,

      admin: req.admin._id,

      creatorRole: req.admin.role,

      hierarchyPath: userHierarchyPath,

      username,

      email,

      password,

      fullName,

      phone,

      createdBy: req.admin._id,

      wallet: {

        balance: initialBalance || 0,

        cashBalance: initialBalance || 0,

        blocked: 0

      },

      isActive: isActivated !== false,

      isDemo: isDemoUser,

      demoExpiresAt: demoExpiresAt,

      demoCreatedAt: isDemoUser ? new Date() : null,

      settings: {

        marginType: marginType || 'exposure',

        ledgerBalanceClosePercent: ledgerBalanceClosePercent || 90,

        profitTradeHoldSeconds: profitTradeHoldSeconds || 0,

        lossTradeHoldSeconds: lossTradeHoldSeconds || 0,

        isActivated: isActivated !== false,

        isReadOnly: isReadOnly || false,

        isDemo: isDemoUser,

        intradaySquare: intradaySquare || false,

        blockLimitAboveBelowHighLow: blockLimitAboveBelowHighLow || false,

        blockLimitBetweenHighLow: blockLimitBetweenHighLow || false

      },

      // Inherited from admin - no hardcoded defaults

      segmentPermissions: inheritedSegmentPermissions,

      scriptSettings: inheritedScriptSettings

    });

    

    // Update admin stats

    req.admin.stats.totalUsers += 1;

    req.admin.stats.activeUsers += 1;

    await req.admin.save();

    

    res.status(201).json({

      _id: user._id,

      userId: user.userId,

      adminCode: user.adminCode,

      username: user.username,

      email: user.email,

      fullName: user.fullName,

      wallet: user.wallet,

      creatorRole: user.creatorRole

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get single user

router.get('/users/:id', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query).select('-password');

    

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json(user);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update user

router.put('/users/:id', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const { fullName, phone, tradingStatus, isActive } = req.body;

    

    if (fullName) user.fullName = fullName;

    if (phone) user.phone = phone;

    if (tradingStatus) user.tradingStatus = tradingStatus;

    if (typeof isActive === 'boolean') user.isActive = isActive;

    

    await user.save();

    res.json(user);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update user segment and script settings (Admin can update their own users)

router.put('/users/:id/settings', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);



    if (!user) return res.status(404).json({ message: 'User not found' });



    const { segmentPermissions, scriptSettings, mergeScriptSettings, segmentExplicitKeys } = req.body;

    console.log('[Save User Settings] User:', user.username);
    console.log('[Save User Settings] Received segmentPermissions:', JSON.stringify(segmentPermissions, null, 2));
    console.log('[Save User Settings] Received segmentExplicitKeys:', JSON.stringify(segmentExplicitKeys, null, 2));

    const updateFields = {};

    if (segmentPermissions) {

      let plain =

        segmentPermissions instanceof Map ? Object.fromEntries(segmentPermissions) : segmentPermissions;

      {
        const { stripMcxSessionTimingFromSegmentMap } = await import('../utils/mcxSessionTiming.js');
        plain = stripMcxSessionTimingFromSegmentMap(plain);
      }

      if (req.admin.role === 'BROKER' || req.admin.role === 'SUB_BROKER') {

        const existingSeg =

          user.segmentPermissions instanceof Map

            ? Object.fromEntries(user.segmentPermissions)

            : (user.segmentPermissions || {});

        plain = preserveAllowLimitPendingOrdersFromExisting(plain, existingSeg);

      }

      const { syncSegmentCommissionMap } = await import('../utils/commissionTypeUnit.js');
      syncSegmentCommissionMap(plain);

      // Convert to Map for database storage
      updateFields.segmentPermissions = new Map(Object.entries(plain));

    }

    if (scriptSettings) {

      // If mergeScriptSettings is true, merge with existing instead of replacing

      if (mergeScriptSettings) {

        // Get existing script settings as plain object

        const existingSettings = user.scriptSettings instanceof Map 

          ? Object.fromEntries(user.scriptSettings) 

          : (user.scriptSettings || {});

        

        // Deep merge each script's settings

        const mergedSettings = { ...existingSettings };

        for (const [symbol, newSettings] of Object.entries(scriptSettings)) {

          if (mergedSettings[symbol]) {

            // Merge with existing script settings

            mergedSettings[symbol] = {

              ...mergedSettings[symbol],

              ...newSettings,

              // Deep merge nested objects

              lotSettings: { ...mergedSettings[symbol]?.lotSettings, ...newSettings?.lotSettings },

              quantitySettings: { ...mergedSettings[symbol]?.quantitySettings, ...newSettings?.quantitySettings },

              fixedMargin: { ...mergedSettings[symbol]?.fixedMargin, ...newSettings?.fixedMargin },

              brokerage: { ...mergedSettings[symbol]?.brokerage, ...newSettings?.brokerage },

              block: { ...mergedSettings[symbol]?.block, ...newSettings?.block },

              spread: newSettings?.spread !== undefined ? newSettings.spread : mergedSettings[symbol]?.spread

            };

          } else {

            // New script, add as-is

            mergedSettings[symbol] = newSettings;

          }

        }

        updateFields.scriptSettings = mergedSettings;

      } else {

        updateFields.scriptSettings = scriptSettings;

      }

    }



    if (segmentExplicitKeys !== undefined) {

      const sanitized = sanitizeSegmentExplicitKeysForSave(segmentExplicitKeys);

      if (sanitized !== undefined) updateFields.segmentExplicitKeys = sanitized;

    }



    if (Object.keys(updateFields).length === 0) {

      return res.status(400).json({ message: 'No settings provided to update' });

    }

    // Update segmentPermissions by updating individual entries in the Map
    if (updateFields.segmentPermissions) {
      const newPermissions = updateFields.segmentPermissions instanceof Map
        ? updateFields.segmentPermissions
        : new Map(Object.entries(updateFields.segmentPermissions));

      // Clear existing Map and set new entries
      user.segmentPermissions.clear();
      for (const [key, value] of newPermissions.entries()) {
        user.segmentPermissions.set(key, value);
      }
      user.markModified('segmentPermissions');
    }

    if (updateFields.scriptSettings) {
      user.scriptSettings = updateFields.scriptSettings;
    }
    if (updateFields.segmentExplicitKeys) {
      user.segmentExplicitKeys = updateFields.segmentExplicitKeys;
    }

    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');

    res.json({ message: 'User settings updated successfully', user: updatedUser });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update single script setting for a user (merge only that script)

router.put('/users/:id/script-settings/:symbol', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const symbol = req.params.symbol;

    const scriptSetting = req.body;

    

    // Get existing script settings as plain object

    const existingSettings = user.scriptSettings instanceof Map 

      ? Object.fromEntries(user.scriptSettings) 

      : (user.scriptSettings || {});

    

    // Merge with existing settings for this symbol

    const existingScriptSetting = existingSettings[symbol] || {};

    const mergedScriptSetting = {

      ...existingScriptSetting,

      ...scriptSetting,

      // Deep merge nested objects only if they exist in new settings

      ...(scriptSetting.lotSettings && { lotSettings: { ...existingScriptSetting?.lotSettings, ...scriptSetting.lotSettings } }),

      ...(scriptSetting.quantitySettings && { quantitySettings: { ...existingScriptSetting?.quantitySettings, ...scriptSetting.quantitySettings } }),

      ...(scriptSetting.fixedMargin && { fixedMargin: { ...existingScriptSetting?.fixedMargin, ...scriptSetting.fixedMargin } }),

      ...(scriptSetting.brokerage && { brokerage: { ...existingScriptSetting?.brokerage, ...scriptSetting.brokerage } }),

      ...(scriptSetting.block && { block: { ...existingScriptSetting?.block, ...scriptSetting.block } })

    };

    

    existingSettings[symbol] = mergedScriptSetting;

    

    await User.updateOne({ _id: user._id }, { $set: { scriptSettings: existingSettings } });

    

    const updatedUser = await User.findById(user._id).select('-password');

    res.json({ message: `Script settings for ${symbol} updated successfully`, user: updatedUser });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Copy user segment and script settings to another user (Admin can copy between their own users)

router.post('/users/:id/copy-settings', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const targetUser = await User.findOne(query);

    

    if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

    

    const { sourceUserId, segmentPermissions, scriptSettings, segmentExplicitKeys } = req.body;

    

    if (!sourceUserId) {

      return res.status(400).json({ message: 'Source user ID is required' });

    }

    

    const sourceQuery = applyAdminFilter(req, { _id: sourceUserId });

    const sourceUser = await User.findOne(sourceQuery);

    if (!sourceUser) return res.status(404).json({ message: 'Source user not found' });

    

    const updateFields = {};

    

    // Copy segment permissions - convert to plain object if it's a Map

    if (segmentPermissions) {

      if (segmentPermissions instanceof Map) {

        updateFields.segmentPermissions = Object.fromEntries(segmentPermissions);

      } else if (typeof segmentPermissions === 'object') {

        updateFields.segmentPermissions = segmentPermissions;

      }

    }

    

    // Copy script settings - convert to plain object if it's a Map

    if (scriptSettings) {

      if (scriptSettings instanceof Map) {

        updateFields.scriptSettings = Object.fromEntries(scriptSettings);

      } else if (typeof scriptSettings === 'object') {

        updateFields.scriptSettings = scriptSettings;

      }

    }



    if (segmentExplicitKeys !== undefined && segmentExplicitKeys !== null && typeof segmentExplicitKeys === 'object') {

      const sanitized = sanitizeSegmentExplicitKeysForSave(segmentExplicitKeys);

      if (sanitized !== undefined) updateFields.segmentExplicitKeys = sanitized;

    }



    if (Object.keys(updateFields).length === 0) {

      return res.status(400).json({ message: 'No settings to copy' });

    }



    // Use updateOne to avoid segmentPermissions validation error

    await User.updateOne({ _id: targetUser._id }, { $set: updateFields });

    

    const updatedUser = await User.findById(targetUser._id).select('-password');

    res.json({ message: 'Settings copied successfully', user: updatedUser });

  } catch (error) {

    console.error('Copy settings error:', error);

    res.status(500).json({ message: error.message });

  }

});



// Update user password (Admin/Super Admin)

router.put('/users/:id/password', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const { password } = req.body;

    if (!password || password.length < 6) {

      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    }

    

    user.password = password;

    await user.save();

    

    res.json({ message: 'Password updated successfully' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Add funds to user (Admin → User)

router.post('/users/:id/add-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    let userAdmin = null;

    let newAdminBalance = 0;

    

    // Determine which admin's wallet to deduct from

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin: deduct from user's admin wallet

      userAdmin = await Admin.findOne({ adminCode: user.adminCode });

      if (!userAdmin) {

        return res.status(404).json({ message: 'User admin not found' });

      }

      if (userAdmin.wallet.balance < amount) {

        return res.status(400).json({ 

          message: `Insufficient balance in admin ${userAdmin.name || userAdmin.username}'s wallet. Available: ${userAdmin.wallet.balance}` 

        });

      }

      newAdminBalance = userAdmin.wallet.balance - amount;

    } else {

      // Regular Admin: deduct from their own wallet

      if (req.admin.wallet.balance < amount) {

        return res.status(400).json({ message: 'Insufficient admin wallet balance' });

      }

      userAdmin = req.admin;

      newAdminBalance = req.admin.wallet.balance - amount;

    }

    

    // Deduct from admin wallet using updateOne

    await Admin.updateOne(

      { _id: userAdmin._id },

      { $set: { 'wallet.balance': newAdminBalance } }

    );

    

    // Create admin ledger entry

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: userAdmin._id,

      adminCode: userAdmin.adminCode,

      type: 'DEBIT',

      reason: 'FUND_ADD',

      amount,

      balanceAfter: newAdminBalance,

      description: `Fund added to user ${user.userId}${req.admin.role === 'SUPER_ADMIN' ? ' by Super Admin' : ''}`,

      performedBy: req.admin._id

    });

    

    // Add to user wallet using updateOne to avoid segmentPermissions validation

    const newUserCashBalance = user.wallet.cashBalance + amount;

    await User.updateOne(

      { _id: user._id },

      { $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance } }

    );

    

    // Create user ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'CREDIT',

      reason: 'FUND_ADD',

      amount,

      balanceAfter: newUserCashBalance,

      description: description || 'Fund added by admin',

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Funds added successfully', 

      userWallet: { ...user.wallet, cashBalance: newUserCashBalance, balance: newUserCashBalance },

      adminWallet: { balance: newAdminBalance },

      deductedFromAdmin: userAdmin.adminCode

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Deduct funds from user

router.post('/users/:id/deduct-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    if (user.wallet.cashBalance < amount) {

      return res.status(400).json({ message: 'Insufficient user balance' });

    }

    

    // Deduct from user wallet using updateOne to avoid segmentPermissions validation

    const newUserCashBalance = user.wallet.cashBalance - amount;

    await User.updateOne(

      { _id: user._id },

      { $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance } }

    );

    

    let userAdmin = null;

    let newAdminBalance = 0;

    

    // Determine which admin's wallet to credit

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin: credit to user's admin wallet

      userAdmin = await Admin.findOne({ adminCode: user.adminCode });

      if (!userAdmin) {

        return res.status(404).json({ message: 'User admin not found' });

      }

      newAdminBalance = userAdmin.wallet.balance + amount;

    } else {

      // Regular Admin: credit to their own wallet

      userAdmin = req.admin;

      newAdminBalance = req.admin.wallet.balance + amount;

    }

    

    // Credit to admin wallet

    await Admin.updateOne(

      { _id: userAdmin._id },

      { $set: { 'wallet.balance': newAdminBalance } }

    );

    

    // Create admin ledger entry

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: userAdmin._id,

      adminCode: userAdmin.adminCode,

      type: 'CREDIT',

      reason: 'FUND_WITHDRAW',

      amount,

      balanceAfter: newAdminBalance,

      description: `Fund deducted from user ${user.userId}${req.admin.role === 'SUPER_ADMIN' ? ' by Super Admin' : ''}`,

      performedBy: req.admin._id

    });

    

    // Create user ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'DEBIT',

      reason: 'FUND_WITHDRAW',

      amount,

      balanceAfter: newUserCashBalance,

      description: description || 'Fund deducted by admin',

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Funds deducted successfully', 

      userWallet: { ...user.wallet, cashBalance: newUserCashBalance, balance: newUserCashBalance },

      adminWallet: { balance: newAdminBalance },

      creditedToAdmin: userAdmin.adminCode

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== TRADING WALLET ROUTES ====================



// Add funds directly to user's trading wallet

router.post('/users/:id/add-trading-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    let userAdmin = null;

    let newAdminBalance = 0;

    

    // Determine which admin's wallet to deduct from

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin: deduct from user's admin wallet

      userAdmin = await Admin.findOne({ adminCode: user.adminCode });

      if (!userAdmin) {

        return res.status(404).json({ message: 'User admin not found' });

      }

      if (userAdmin.wallet.balance < amount) {

        return res.status(400).json({ 

          message: `Insufficient balance in admin ${userAdmin.name || userAdmin.username}'s wallet. Available: ${userAdmin.wallet.balance}` 

        });

      }

      newAdminBalance = userAdmin.wallet.balance - amount;

    } else {

      // Regular Admin: deduct from their own wallet

      if (req.admin.wallet.balance < amount) {

        return res.status(400).json({ message: 'Insufficient admin wallet balance' });

      }

      userAdmin = req.admin;

      newAdminBalance = req.admin.wallet.balance - amount;

    }

    

    // Deduct from admin wallet

    await Admin.updateOne(

      { _id: userAdmin._id },

      { $set: { 'wallet.balance': newAdminBalance } }

    );

    

    // Create admin ledger entry

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: userAdmin._id,

      adminCode: userAdmin.adminCode,

      type: 'DEBIT',

      reason: 'TRADING_FUND_ADD',

      amount,

      balanceAfter: newAdminBalance,

      description: `Trading fund added to user ${user.userId}${req.admin.role === 'SUPER_ADMIN' ? ' by Super Admin' : ''}`,

      performedBy: req.admin._id

    });

    

    // Add directly to trading balance

    const newTradingBalance = (user.wallet.tradingBalance || 0) + amount;

    

    await User.updateOne(

      { _id: user._id },

      { $set: { 'wallet.tradingBalance': newTradingBalance } }

    );

    

    // Create user ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'CREDIT',

      reason: 'TRADING_FUND_ADD',

      amount,

      balanceAfter: newTradingBalance,

      description: description || 'Trading funds added by admin',

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Trading funds added successfully', 

      userWallet: { ...user.wallet, tradingBalance: newTradingBalance },

      adminWallet: { balance: newAdminBalance },

      deductedFromAdmin: userAdmin.adminCode

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Deduct/Withdraw funds from user's trading wallet

router.post('/users/:id/deduct-trading-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const currentTradingBalance = user.wallet.tradingBalance || 0;

    const usedMargin = user.wallet.usedMargin || 0;

    const availableBalance = currentTradingBalance - usedMargin;

    

    if (availableBalance < amount) {

      return res.status(400).json({ 

        message: `Insufficient trading balance. Available: ${availableBalance.toLocaleString()} (Total: ${currentTradingBalance.toLocaleString()}, Margin Used: ${usedMargin.toLocaleString()})` 

      });

    }

    

    // Deduct from trading balance

    const newTradingBalance = currentTradingBalance - amount;

    

    await User.updateOne(

      { _id: user._id },

      { $set: { 'wallet.tradingBalance': newTradingBalance } }

    );

    

    // Create user ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'DEBIT',

      reason: 'TRADING_FUND_WITHDRAW',

      amount,

      balanceAfter: newTradingBalance,

      description: description || 'Trading funds withdrawn by admin',

      performedBy: req.admin._id

    });

    

    let userAdmin = null;

    let newAdminBalance = 0;

    

    // Determine which admin's wallet to credit

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin: credit to user's admin wallet

      userAdmin = await Admin.findOne({ adminCode: user.adminCode });

      if (!userAdmin) {

        return res.status(404).json({ message: 'User admin not found' });

      }

      newAdminBalance = userAdmin.wallet.balance + amount;

    } else {

      // Regular Admin: credit to their own wallet

      userAdmin = req.admin;

      newAdminBalance = req.admin.wallet.balance + amount;

    }

    

    // Credit to admin wallet

    await Admin.updateOne(

      { _id: userAdmin._id },

      { $set: { 'wallet.balance': newAdminBalance } }

    );

    

    // Create admin ledger entry

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: userAdmin._id,

      adminCode: userAdmin.adminCode,

      type: 'CREDIT',

      reason: 'TRADING_FUND_WITHDRAW',

      amount,

      balanceAfter: newAdminBalance,

      description: `Trading fund withdrawn from user ${user.userId}${req.admin.role === 'SUPER_ADMIN' ? ' by Super Admin' : ''}`,

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Trading funds withdrawn successfully', 

      userWallet: { ...user.wallet, tradingBalance: newTradingBalance },

      adminWallet: { balance: newAdminBalance },

      creditedToAdmin: userAdmin.adminCode

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== CRYPTO WALLET ROUTES ====================



// Add funds to user's crypto wallet (Admin → User)

router.post('/users/:id/add-crypto-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    // Add to user's crypto wallet

    const currentCryptoBalance = user.cryptoWallet?.balance || 0;

    const newCryptoBalance = currentCryptoBalance + amount;

    

    await User.updateOne(

      { _id: user._id },

      { $set: { 'cryptoWallet.balance': newCryptoBalance } }

    );

    

    // Create ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'CREDIT',

      reason: 'CRYPTO_DEPOSIT',

      amount,

      balanceAfter: newCryptoBalance,

      description: description || 'Crypto funds added by admin',

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Crypto funds added successfully', 

      cryptoWallet: { balance: newCryptoBalance }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Deduct funds from user's crypto wallet

router.post('/users/:id/deduct-crypto-funds', protectAdmin, async (req, res) => {

  try {

    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    

    const query = applyAdminFilter(req, { _id: req.params.id });

    const user = await User.findOne(query);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const currentCryptoBalance = user.cryptoWallet?.balance || 0;

    if (currentCryptoBalance < amount) {

      return res.status(400).json({ message: 'Insufficient crypto wallet balance' });

    }

    

    const newCryptoBalance = currentCryptoBalance - amount;

    

    await User.updateOne(

      { _id: user._id },

      { $set: { 'cryptoWallet.balance': newCryptoBalance } }

    );

    

    // Create ledger entry

    await WalletLedger.create({

      ownerType: 'USER',

      ownerId: user._id,

      adminCode: user.adminCode,

      type: 'DEBIT',

      reason: 'CRYPTO_WITHDRAW',

      amount,

      balanceAfter: newCryptoBalance,

      description: description || 'Crypto funds deducted by admin',

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Crypto funds deducted successfully', 

      cryptoWallet: { balance: newCryptoBalance }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== BANK ACCOUNT ROUTES ====================



// Get bank accounts

router.get('/bank-accounts', protectAdmin, async (req, res) => {

  try {

    const query = req.admin.role === 'SUPER_ADMIN' ? {} : { adminCode: req.admin.adminCode };

    const accounts = await BankAccount.find(query).sort({ createdAt: -1 });

    res.json(accounts);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Add bank account

router.post('/bank-accounts', protectAdmin, async (req, res) => {

  try {

    if (req.admin.role === 'SUPER_ADMIN') {

      return res.status(400).json({ message: 'Super Admin cannot add bank accounts' });

    }

    

    const { type, holderName, bankName, accountNumber, ifsc, accountType, upiId, qrCodeUrl } = req.body;

    

    const account = await BankAccount.create({

      adminCode: req.admin.adminCode,

      admin: req.admin._id,

      type,

      holderName,

      bankName,

      accountNumber,

      ifsc,

      accountType,

      upiId,

      qrCodeUrl

    });

    

    res.status(201).json(account);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update bank account

router.put('/bank-accounts/:id', protectAdmin, async (req, res) => {

  try {

    const query = req.admin.role === 'SUPER_ADMIN' 

      ? { _id: req.params.id }

      : { _id: req.params.id, adminCode: req.admin.adminCode };

    

    const account = await BankAccount.findOne(query);

    if (!account) return res.status(404).json({ message: 'Bank account not found' });

    

    const updates = req.body;

    Object.keys(updates).forEach(key => {

      if (key !== 'adminCode' && key !== 'admin') {

        account[key] = updates[key];

      }

    });

    

    await account.save();

    res.json(account);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Delete bank account

router.delete('/bank-accounts/:id', protectAdmin, async (req, res) => {

  try {

    const query = req.admin.role === 'SUPER_ADMIN' 

      ? { _id: req.params.id }

      : { _id: req.params.id, adminCode: req.admin.adminCode };

    

    const account = await BankAccount.findOneAndDelete(query);

    if (!account) return res.status(404).json({ message: 'Bank account not found' });

    

    res.json({ message: 'Bank account deleted' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== FUND REQUEST ROUTES ====================



// Get ALL fund requests (Super Admin only)

router.get('/all-fund-requests', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { status, type } = req.query;

    let query = {};

    if (status && status !== 'ALL') query.status = status;

    if (type) query.type = type;

    

    const requests = await FundRequest.find(query)

      .populate('user', 'username fullName email userId adminCode')

      .populate('processedBy', 'username adminCode')

      .populate('bankAccount', 'bankName accountNumber')

      .sort({ createdAt: -1 })

      .limit(500);

    

    // Add admin info from adminCode

    const requestsWithAdmin = await Promise.all(requests.map(async (req) => {

      const reqObj = req.toObject();

      if (req.adminCode) {

        const admin = await Admin.findOne({ adminCode: req.adminCode });

        reqObj.admin = admin ? { 

          name: admin.name, 

          username: admin.username, 

          adminCode: admin.adminCode,

          role: admin.role 

        } : null;

      }

      return reqObj;

    }));

    

    // Calculate stats

    const allRequests = await FundRequest.find({});

    const stats = {

      pending: allRequests.filter(r => r.status === 'PENDING').length,

      approved: allRequests.filter(r => r.status === 'APPROVED').length,

      rejected: allRequests.filter(r => r.status === 'REJECTED').length,

      totalDeposits: allRequests.filter(r => r.type === 'DEPOSIT' && r.status === 'APPROVED').reduce((sum, r) => sum + r.amount, 0),

      totalWithdrawals: allRequests.filter(r => r.type === 'WITHDRAWAL' && r.status === 'APPROVED').reduce((sum, r) => sum + r.amount, 0)

    };

    

    res.json({ requests: requestsWithAdmin, stats });

  } catch (error) {

    console.error('Error fetching all fund requests:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get fund requests (for specific admin)

router.get('/fund-requests', protectAdmin, async (req, res) => {

  try {

    const { status } = req.query;

    const query = applyAdminFilter(req);

    if (status) query.status = status;

    

    const requests = await FundRequest.find(query)

      .populate('user', 'username fullName email userId')

      .sort({ createdAt: -1 });

    

    res.json(requests);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Approve fund request

router.post('/fund-requests/:id/approve', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id, status: 'PENDING' });

    const request = await FundRequest.findOne(query);

    

    if (!request) return res.status(404).json({ message: 'Fund request not found or already processed' });

    

    const user = await User.findById(request.user);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    let newUserCashBalance = user.wallet.cashBalance;

    let newAdminBalance = req.admin.wallet.balance;

    

    if (request.type === 'DEPOSIT') {

      // For deposits, admin wallet is debited, user wallet is credited

      if (req.admin.role === 'ADMIN') {

        if (req.admin.wallet.balance < request.amount) {

          return res.status(400).json({ message: 'Insufficient admin wallet balance' });

        }

        

        newAdminBalance = req.admin.wallet.balance - request.amount;

        await Admin.updateOne(

          { _id: req.admin._id },

          { $set: { 'wallet.balance': newAdminBalance } }

        );

        

        await WalletLedger.create({

          ownerType: 'ADMIN',

          ownerId: req.admin._id,

          adminCode: req.admin.adminCode,

          type: 'DEBIT',

          reason: 'FUND_ADD',

          amount: request.amount,

          balanceAfter: newAdminBalance,

          reference: { type: 'FundRequest', id: request._id },

          performedBy: req.admin._id

        });

      }

      

      // Use updateOne to avoid segmentPermissions validation error

      newUserCashBalance = user.wallet.cashBalance + request.amount;

      await User.updateOne(

        { _id: user._id },

        { $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance } }

      );

      

      await WalletLedger.create({

        ownerType: 'USER',

        ownerId: user._id,

        adminCode: user.adminCode,

        type: 'CREDIT',

        reason: 'FUND_ADD',

        amount: request.amount,

        balanceAfter: newUserCashBalance,

        reference: { type: 'FundRequest', id: request._id },

        performedBy: req.admin._id

      });

    } else {

      // For withdrawals, user wallet is debited

      if (user.wallet.cashBalance < request.amount) {

        return res.status(400).json({ message: 'Insufficient user balance' });

      }

      

      // Use updateOne to avoid segmentPermissions validation error

      newUserCashBalance = user.wallet.cashBalance - request.amount;

      await User.updateOne(

        { _id: user._id },

        { $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance } }

      );

      

      await WalletLedger.create({

        ownerType: 'USER',

        ownerId: user._id,

        adminCode: user.adminCode,

        type: 'DEBIT',

        reason: 'FUND_WITHDRAW',

        amount: request.amount,

        balanceAfter: newUserCashBalance,

        reference: { type: 'FundRequest', id: request._id },

        performedBy: req.admin._id

      });

    }

    

    request.status = 'APPROVED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || '';

    await request.save();

    

    res.json({ message: 'Fund request approved', request });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Reject fund request

router.post('/fund-requests/:id/reject', protectAdmin, async (req, res) => {

  try {

    const query = applyAdminFilter(req, { _id: req.params.id, status: 'PENDING' });

    const request = await FundRequest.findOne(query);

    

    if (!request) return res.status(404).json({ message: 'Fund request not found or already processed' });

    

    request.status = 'REJECTED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || '';

    await request.save();

    

    res.json({ message: 'Fund request rejected', request });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== LEDGER ROUTES ====================



// Get wallet ledger

router.get('/ledger', protectAdmin, async (req, res) => {

  try {

    const { ownerType, ownerId, limit = 50 } = req.query;

    const query = applyAdminFilter(req);

    

    if (ownerType && ownerId) {

      query.ownerType = ownerType;

      query.ownerId = ownerId;

    }

    

    const ledger = await WalletLedger.find(query).sort({ createdAt: -1 }).limit(parseInt(limit));

    res.json(ledger);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== TRANSACTION SLIP ROUTES ====================



// Get transaction slips for admin's users

router.get('/transaction-slips', protectAdmin, async (req, res) => {

  try {

    const { findTransactionSlipsForAdmin, getTransactionSlipStats } = await import('../services/gameTransactionSlipService.js');

    

    const page = parseInt(req.query.page) || 1;

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const skip = (page - 1) * limit;

    

    const filters = {

      status: req.query.status,

      gameId: req.query.gameId,

      dateFrom: req.query.dateFrom,

      dateTo: req.query.dateTo,

      search: req.query.search

    };

    

    const result = await findTransactionSlipsForAdmin(req.admin._id, req.admin.role, {

      ...filters,

      skip,

      limit

    });

    

    res.json({

      slips: result.slips,

      pagination: {

        page,

        pages: Math.ceil(result.total / limit),

        total: result.total,

        limit

      }

    });

  } catch (error) {

    console.error('Error fetching admin transaction slips:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get transaction slip details

router.get('/transaction-slip/:id', protectAdmin, async (req, res) => {

  try {

    const { findTransactionSlipByIdForAdmin } = await import('../services/gameTransactionSlipService.js');

    

    const slip = await findTransactionSlipByIdForAdmin(req.params.id, req.admin._id, req.admin.role);

    if (!slip) {

      return res.status(404).json({ message: 'Transaction slip not found' });

    }

    

    res.json(slip);

  } catch (error) {

    console.error('Error fetching transaction slip details:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get transaction slip statistics

router.get('/transaction-slip-stats', protectAdmin, async (req, res) => {

  try {

    const { getTransactionSlipStatsForAdmin } = await import('../services/gameTransactionSlipService.js');

    

    const stats = await getTransactionSlipStatsForAdmin(req.admin._id, req.admin.role);

    res.json(stats);

  } catch (error) {

    console.error('Error fetching transaction slip stats:', error);

    res.status(500).json({ message: error.message });

  }

});



// Export transaction slips to CSV

router.get('/transaction-slips/export', protectAdmin, async (req, res) => {

  try {

    const { exportTransactionSlipsForAdmin } = await import('../services/gameTransactionSlipService.js');

    

    const filters = {

      status: req.query.status,

      gameId: req.query.gameId,

      dateFrom: req.query.dateFrom,

      dateTo: req.query.dateTo,

      search: req.query.search

    };

    

    const csvData = await exportTransactionSlipsForAdmin(req.admin._id, req.admin.role, filters);

    

    res.setHeader('Content-Type', 'text/csv');

    res.setHeader('Content-Disposition', 'attachment; filename=transaction-slips.csv');

    res.send(csvData);

  } catch (error) {

    console.error('Error exporting transaction slips:', error);

    res.status(500).json({ message: error.message });

  }

});



// Dropdown options for wallet ledger game filter (admin / broker / sub-broker)

router.get('/ledger-games', protectAdmin, async (req, res) => {

  try {

    res.json({ games: WALLET_LEDGER_GAME_OPTIONS });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get admin's own ledger

router.get('/my-ledger', protectAdmin, async (req, res) => {

  try {

    const gameMatch = matchAdminLedgerGameKey(req.query.gameKey);

    const ledger = await WalletLedger.find({

      ownerType: 'ADMIN',

      ownerId: req.admin._id,

      ...gameMatch,

    })

      .sort({ createdAt: -1 })

      .limit(100)

      .lean();



    // Enrich with transaction slip information for game profit entries and user names

    const enrichedLedger = await Promise.all(ledger.map(async (entry) => {

      let transactionSlipInfo = null;

      let userName = null;

      

      // Check if this is a game profit entry with transaction metadata

      if (entry.reason === 'GAME_PROFIT' && entry.meta?.transactionId) {

        try {

          const { findTransactionSlipByTransactionId } = await import('../services/gameTransactionSlipService.js');

          const slip = await findTransactionSlipByTransactionId(entry.meta.transactionId);

          if (slip) {

            // Fetch user details to get the name

            let slipUserName = null;

            if (slip.userId) {

              const User = (await import('../models/User.js')).default;

              const user = await User.findById(slip.userId).select('fullName username');

              if (user) {

                slipUserName = user.fullName || user.username;

              }

            }



            transactionSlipInfo = {

              transactionId: slip.transactionId,

              totalDebitAmount: slip.totalDebitAmount,

              totalCreditAmount: slip.totalCreditAmount,

              netPnL: slip.netPnL,

              status: slip.status,

              gameIds: slip.gameIds,

              userCode: slip.userCode,

              userName: slipUserName,

              createdAt: slip.createdAt

            };

            userName = slipUserName;

          }

        } catch (error) {

          console.warn('Failed to fetch transaction slip for admin ledger entry:', error);

        }

      }



      // For game profit entries without transaction slip, use meta.relatedUserId

      if (entry.reason === 'GAME_PROFIT' && entry.meta?.relatedUserId && !userName) {

        try {

          const User = (await import('../models/User.js')).default;

          const user = await User.findById(entry.meta.relatedUserId).select('fullName username');

          if (user) {

            userName = user.fullName || user.username;

          }

        } catch (error) {

          console.warn('Failed to fetch user name from meta.relatedUserId:', error);

        }

      }

      // For brokerage / trading P&L entries, fetch user details from meta.relatedUserId
      if (
        (entry.reason === 'BROKERAGE' || entry.reason === 'TRADE_PNL') &&
        entry.meta?.relatedUserId &&
        !userName
      ) {

        try {

          const User = (await import('../models/User.js')).default;

          const user = await User.findById(entry.meta.relatedUserId).select('fullName username');

          if (user) {

            userName = user.fullName || user.username;

          }

        } catch (error) {

          console.warn('Failed to fetch user name for ledger entry:', error);

        }

      }

      if (!userName && entry.meta?.userName) {
        userName = entry.meta.userName;
      }



      // For old GAME_PROFIT entries without user data, show N/A

      // (New transactions will have meta.relatedUserId populated)



      const obj = { ...entry };

      const meta = obj.meta || {};

      const sharePct = resolveLedgerSharePercent(obj);

      const displaySharePercent = displaySharePercentString(sharePct);



      const roleToLabel = (r) => {

        if (!r) return null;

        const u = String(r).toUpperCase();

        if (u === 'SUB_BROKER') return 'Sub-broker wallet';

        if (u === 'BROKER') return 'Broker wallet';

        if (u === 'ADMIN') return 'Admin wallet';

        if (u === 'SUPER_ADMIN') return 'Super Admin wallet';

        return r;

      };



      const brokerageRecipientLabel =

        entry.reason === 'GAME_PROFIT' ? roleToLabel(meta.hierarchyRole) : null;

      const isSaViewer = String(req.admin?.role || '') === 'SUPER_ADMIN';

      const hierarchyPayeeLine =

        entry.reason === 'ADJUSTMENT' && isSaViewer && meta.hierarchyPayoutToRole

          ? `Payout toward: ${roleToLabel(meta.hierarchyPayoutToRole) || meta.hierarchyPayoutToRole}`

          : null;

      const superAdminPoolLine =

        entry.reason === 'ADJUSTMENT' &&

        isSaViewer &&

        meta.poolDebitKind === 'BTC_JACKPOT_PAYOUT' &&

        !meta.hierarchyPayoutToRole

          ? 'Super Admin main wallet (pool outflow — e.g. winner prize)'

          : null;



      return {

        ...obj,

        transactionSlip: transactionSlipInfo,

        userName: userName,

        sharePercentResolved: sharePct != null && Number.isFinite(Number(sharePct)) ? Number(sharePct) : undefined,

        displaySharePercent,

        brokerageRecipientLabel,

        superAdminPoolLine,

        hierarchyPayeeLine,

      };

    }));



    res.json(enrichedLedger);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Trade close — user gross/net, admin pool, patti split (ledger Info modal)
router.get('/trades/:tradeId/close-breakdown', protectAdmin, async (req, res) => {
  try {
    const tradeId = req.params.tradeId;
    if (!mongoose.Types.ObjectId.isValid(String(tradeId))) {
      return res.status(400).json({ message: 'Invalid trade id' });
    }
    await assertAdminCanViewTradeBreakdown(req.admin, tradeId);
    const breakdown = await getTradeCloseBreakdown(tradeId);
    res.json(breakdown);
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({ message: error.message });
  }
});



// ==================== PASSWORD & PROFILE ROUTES ====================



// Change own password

router.put('/change-password', protectAdmin, async (req, res) => {

  try {

    const { currentPassword, newPassword } = req.body;

    

    if (!currentPassword || !newPassword) {

      return res.status(400).json({ message: 'Current and new password required' });

    }

    

    if (newPassword.length < 6) {

      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    }

    

    const admin = await Admin.findById(req.admin._id);

    const isMatch = await admin.comparePassword(currentPassword);

    

    if (!isMatch) {

      return res.status(400).json({ message: 'Current password is incorrect' });

    }

    

    admin.password = newPassword;

    await admin.save();

    

    res.json({ message: 'Password changed successfully' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update own profile

router.put('/update-profile', protectAdmin, async (req, res) => {

  try {

    const { name, phone, email } = req.body;

    

    if (email && email !== req.admin.email) {

      const exists = await Admin.findOne({ email, _id: { $ne: req.admin._id } });

      if (exists) {

        return res.status(400).json({ message: 'Email already in use' });

      }

      req.admin.email = email;

    }

    

    if (name) req.admin.name = name;

    if (phone) req.admin.phone = phone;

    

    await req.admin.save();

    res.json(req.admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update branding settings (Admin only)

router.put('/branding', protectAdmin, async (req, res) => {

  try {

    const { brandName, logoUrl, welcomeTitle } = req.body;

    

    const admin = await Admin.findById(req.admin._id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    if (!admin.branding) {

      admin.branding = {};

    }

    

    if (brandName !== undefined) admin.branding.brandName = brandName;

    if (logoUrl !== undefined) admin.branding.logoUrl = logoUrl;

    if (welcomeTitle !== undefined) admin.branding.welcomeTitle = welcomeTitle;

    

    await admin.save();

    res.json({ 

      message: 'Branding updated successfully',

      branding: admin.branding 

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== SUPER ADMIN - ADMIN PASSWORD RESET ====================



// Reset admin password (Super Admin only)

router.put('/admins/:id/reset-password', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { newPassword } = req.body;

    

    if (!newPassword || newPassword.length < 6) {

      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    }

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot reset Super Admin password here' });

    

    // Hash the password manually to ensure it's properly hashed

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    

    // Use updateOne to bypass pre-save hook since we're manually hashing

    await Admin.updateOne(

      { _id: req.params.id },

      { $set: { password: hashedPassword } }

    );

    

    res.json({ message: 'Admin password reset successfully' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== SUPER ADMIN - DETAILED VIEWS ====================



// Get admin with all their users (hierarchical - parent can view child's users)

router.get('/admins/:id/users', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id).select('-password');

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can view anyone, others can only view their children or themselves

    const isSuperAdmin = req.admin.role === 'SUPER_ADMIN';

    const isParent = targetAdmin.parentId?.toString() === req.admin._id.toString();

    const isSelf = targetAdmin._id.toString() === req.admin._id.toString();

    const canManage = req.admin.canManage && req.admin.canManage(targetAdmin.role);

    

    if (!isSuperAdmin && !isParent && !isSelf && !canManage) {

      return res.status(403).json({ message: 'You can only view users for your subordinates' });

    }

    

    const users = await User.find({ adminCode: targetAdmin.adminCode }).select('-password');

    

    res.json({ admin: targetAdmin, users });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get admin's ledger (Super Admin only)

router.get('/admins/:id/ledger', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    const ledger = await WalletLedger.find({

      ownerType: 'ADMIN',

      ownerId: admin._id

    }).sort({ createdAt: -1 }).limit(200);

    

    res.json(ledger);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



function escapeRegExpForQuery(s) {

  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

}



// Get all transactions across all admins (Super Admin only)

// Query: ownerType, type (CREDIT|DEBIT), reason, reasons (comma), reasonGroup (trading|games|funds|adjustments|transfers),

// adminCode (partial), ownerId (Mongo id), userSearch (username/name → USER ownerIds),

// referenceType (Trade|Order|…), gameKey (niftyUpDown|… for game-related rows), dateFrom, dateTo (ISO),

// includeSummary=1 → { transactions, summary }, else legacy array (no includeSummary).

router.get('/all-transactions', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const {

      limit = 100,

      ownerType,

      type,

      reason,

      reasons,

      reasonGroup,

      adminCode,

      ownerId,

      userSearch,

      referenceType,

      gameKey,

      dateFrom,

      dateTo,

      includeSummary,

    } = req.query;



    const query = {};

    if (ownerType) query.ownerType = ownerType;



    const tUpper = type != null ? String(type).toUpperCase() : '';

    if (tUpper === 'CREDIT' || tUpper === 'DEBIT') query.type = tUpper;



    if (reason && String(reason).trim()) {

      query.reason = String(reason).trim();

    } else if (reasons && String(reasons).trim()) {

      const rlist = String(reasons)

        .split(',')

        .map((s) => s.trim())

        .filter(Boolean);

      if (rlist.length) query.reason = { $in: rlist };

    } else if (reasonGroup && String(reasonGroup).trim()) {

      const g = String(reasonGroup).toLowerCase().trim();

      const TRADING = ['TRADE_PNL', 'BROKERAGE'];

      const GAMES = ['GAME_PROFIT', 'GAMES_TRANSFER'];

      const FUNDS = [

        'FUND_ADD',

        'FUND_WITHDRAW',

        'TRADING_FUND_ADD',

        'TRADING_FUND_WITHDRAW',

        'ADMIN_DEPOSIT',

        'ADMIN_WITHDRAW',

        'ADMIN_TRANSFER',

        'REFUND',

      ];

      const ADJ = ['ADJUSTMENT', 'BONUS', 'PENALTY'];

      const XFER = ['CRYPTO_TRANSFER', 'FOREX_TRANSFER', 'MCX_TRANSFER', 'INTERNAL_TRANSFER'];

      if (g === 'trading') query.reason = { $in: TRADING };

      else if (g === 'games') query.reason = { $in: GAMES };

      else if (g === 'funds') query.reason = { $in: FUNDS };

      else if (g === 'adjustments') query.reason = { $in: ADJ };

      else if (g === 'transfers') query.reason = { $in: XFER };

    }



    if (adminCode && String(adminCode).trim()) {

      query.adminCode = new RegExp(escapeRegExpForQuery(String(adminCode).trim()), 'i');

    }



    if (ownerId && mongoose.Types.ObjectId.isValid(String(ownerId))) {

      query.ownerId = new mongoose.Types.ObjectId(String(ownerId));

    }



    if (userSearch && String(userSearch).trim()) {

      const uq = new RegExp(escapeRegExpForQuery(String(userSearch).trim()), 'i');

      const users = await User.find({

        $or: [{ username: uq }, { fullName: uq }, { email: uq }],

      })

        .select('_id')

        .limit(200)

        .lean();

      const ids = users.map((u) => u._id);

      query.ownerType = 'USER';

      query.ownerId = ids.length ? { $in: ids } : { $in: [] };

    }



    if (referenceType && String(referenceType).trim()) {

      query['reference.type'] = String(referenceType).trim();

    }



    if (dateFrom || dateTo) {

      query.createdAt = {};

      if (dateFrom) query.createdAt.$gte = new Date(String(dateFrom));

      if (dateTo) query.createdAt.$lte = new Date(String(dateTo));

    }



    let finalQuery = query;

    const gk = gameKey != null ? String(gameKey).trim() : '';

    if (gk && gk !== 'all') {

      const frag = matchAdminLedgerGameKey(gk);

      if (frag && Object.keys(frag).length) {

        finalQuery = Object.keys(query).length ? { $and: [query, frag] } : frag;

      }

    }



    const lim = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 2000);



    const wantSummary = includeSummary === '1' || includeSummary === 'true';

    let summary = null;

    if (wantSummary) {

      const agg = await WalletLedger.aggregate([

        { $match: finalQuery },

        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },

      ]);

      summary = {

        credits: 0,

        debits: 0,

        creditCount: 0,

        debitCount: 0,

        net: 0,

      };

      for (const row of agg) {

        if (row._id === 'CREDIT') {

          summary.credits = row.total || 0;

          summary.creditCount = row.count || 0;

        } else if (row._id === 'DEBIT') {

          summary.debits = row.total || 0;

          summary.debitCount = row.count || 0;

        }

      }

      summary.net = (summary.credits || 0) - (summary.debits || 0);

    }



    // Note: do not populate `ownerId` — refPath uses ownerType values ADMIN/USER, not model names

    // `Admin`/`User`, which throws in Mongoose and caused 500 on this route.

    const transactions = await WalletLedger.find(finalQuery)

      .sort({ createdAt: -1 })

      .limit(lim)

      .populate('performedBy', 'username name')

      .lean();



    // Build admin hierarchy for each transaction

    for (const tx of transactions) {

      if (tx.ownerType === 'USER' && tx.ownerId) {

        const user = await User.findById(tx.ownerId).populate('admin').lean();

        if (user && user.admin) {

          const hierarchy = [];

          let currentAdmin = user.admin;

          

          while (currentAdmin) {

            hierarchy.push({

              role: currentAdmin.role,

              name: currentAdmin.name,

              username: currentAdmin.username,

              code: currentAdmin.adminCode,

            });

            

            if (currentAdmin.parentAdmin) {

              currentAdmin = await Admin.findById(currentAdmin.parentAdmin).lean();

            } else {

              break;

            }

          }

          

          tx.adminHierarchy = hierarchy;

        }

      }

    }



    const enrichedTransactions = transactions.map(enrichWalletLedgerEntryForDisplay);

    if (wantSummary) {

      return res.json({ transactions: enrichedTransactions, summary });

    }

    res.json(enrichedTransactions);

  } catch (error) {

    console.error('all-transactions:', error);

    res.status(500).json({ message: error.message });

  }

});



/** Ledger `gameId` values for each game (see `GamesWalletLedger` / user games-wallet API). */

const SUPER_ADMIN_GAMES_LEDGER_GAME_IDS = [

  'updown',

  'btcupdown',

  'niftyNumber',

  'niftyBracket',

  'niftyJackpot',

  'btcJackpot',

  'btcNumber',

];



/** Description prefix before " — …" for pool debits when `meta.gameKey` is missing (legacy rows). */

const GAMES_LEDGER_GAME_ID_TO_DESC_PREFIX = {

  updown: 'Nifty Up/Down',

  btcupdown: 'BTC Up/Down',

  niftyNumber: 'Nifty Number',

  niftyBracket: 'Nifty Bracket',

  niftyJackpot: 'Nifty Jackpot',

  btcJackpot: 'BTC Jackpot',

  btcNumber: 'BTC Number',

};



const GAMES_POOL_DEBIT_KINDS = ['JACKPOT_GROSS_HIERARCHY_POOL_DEBIT', 'GAME_WIN_BROKERAGE_POOL_DEBIT'];



// Super Admin: read a user's in-app games wallet ledger (bets, wins, refunds — same store as user order history)

router.get('/user-games-wallet-ledger', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const userId = req.query.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {

      return res.status(400).json({ message: 'Valid userId is required' });

    }

    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '2000'), 10) || 2000, 1), 5000);

    const gameIdRaw = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : '';

    const tUpper = req.query.type != null ? String(req.query.type).toUpperCase() : '';

    const wantSummary = req.query.includeSummary === '1' || req.query.includeSummary === 'true';



    const filter = { user: new mongoose.Types.ObjectId(String(userId)) };

    if (gameIdRaw && SUPER_ADMIN_GAMES_LEDGER_GAME_IDS.includes(gameIdRaw)) {

      filter.gameId = gameIdRaw;

    }

    if (tUpper === 'CREDIT') filter.entryType = 'credit';

    else if (tUpper === 'DEBIT') filter.entryType = 'debit';



    const rows = await GamesWalletLedger.find(filter).sort({ createdAt: -1 }).limit(lim).lean();



    const transactions = rows.map((row) => ({

      _id: row._id,

      createdAt: row.createdAt,

      type: row.entryType === 'credit' ? 'CREDIT' : 'DEBIT',

      reason: 'GAMES_WALLET',

      description: row.description || row.gameLabel || '',

      amount: row.amount,

      balanceAfter: row.balanceAfter,

      adminCode: '',

      meta: { ...(row.meta && typeof row.meta === 'object' ? row.meta : {}), gameKey: row.gameId, gameLabel: row.gameLabel },

      reference: { type: 'Manual', id: null },

      performedBy: null,

      gamesWallet: true,

    }));



    let summary = null;

    if (wantSummary) {

      const agg = await GamesWalletLedger.aggregate([

        { $match: filter },

        { $group: { _id: '$entryType', total: { $sum: '$amount' }, count: { $sum: 1 } } },

      ]);

      summary = {

        credits: 0,

        debits: 0,

        creditCount: 0,

        debitCount: 0,

        net: 0,

      };

      for (const row of agg) {

        if (row._id === 'credit') {

          summary.credits = row.total || 0;

          summary.creditCount = row.count || 0;

        } else if (row._id === 'debit') {

          summary.debits = row.total || 0;

          summary.debitCount = row.count || 0;

        }

      }

      summary.net = (summary.credits || 0) - (summary.debits || 0);

    }



    return res.json({ transactions, summary });

  } catch (error) {

    console.error('user-games-wallet-ledger:', error);

    res.status(500).json({ message: error.message });

  }

});



/**

 * Super Admin: platform-wide client (USER) wallet activity — easy audit of credits/debits.

 * scope=main → WalletLedger ownerType USER only (same filters spirit as /all-transactions).

 * scope=games → GamesWalletLedger across all users (bets, wins, transfers between main↔games).

 * Super Admin perspective also merges Super Admin main-wallet pool debits that fund gross-prize hierarchy /

 * win-brokerage splits (same settlement as games, previously invisible in this feed).

 * perspective: defaults to superadmin for this route — `type` means effect on you (DEBIT = debited to you /

 *   client CREDIT + games credit); CREDIT = credited to you / client DEBIT + games debit. Pass perspective=client

 *   only if you need raw client ledger type filtering.

 */

router.get('/client-wallet-feed', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const scope = String(req.query.scope || 'main').toLowerCase() === 'games' ? 'games' : 'main';

    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 2000);

    const wantSummary = req.query.includeSummary === '1' || req.query.includeSummary === 'true';

    const pRaw = String(req.query.perspective || 'superadmin')

      .toLowerCase()

      .replace(/-/g, '');

    const perspectiveSuper = pRaw !== 'client';



    if (scope === 'games') {

      const {

        type,

        userSearch,

        dateFrom,

        dateTo,

        gameId: gameIdParam,

      } = req.query;

      const filter = {};

      const gameIdRaw = typeof gameIdParam === 'string' ? gameIdParam.trim() : '';

      if (gameIdRaw && SUPER_ADMIN_GAMES_LEDGER_GAME_IDS.includes(gameIdRaw)) {

        filter.gameId = gameIdRaw;

      }

      const tUpper = type != null ? String(type).toUpperCase() : '';

      if (perspectiveSuper && (tUpper === 'CREDIT' || tUpper === 'DEBIT')) {

        if (tUpper === 'DEBIT') filter.entryType = 'credit';

        else filter.entryType = 'debit';

      } else {

        if (tUpper === 'CREDIT') filter.entryType = 'credit';

        else if (tUpper === 'DEBIT') filter.entryType = 'debit';

      }



      /** When set, restrict games + pool rows to these user ids (from client search). */

      let restrictUserIds = null;

      if (userSearch && String(userSearch).trim()) {

        const uq = new RegExp(escapeRegExpForQuery(String(userSearch).trim()), 'i');

        const users = await User.find({

          $or: [{ username: uq }, { fullName: uq }, { email: uq }],

        })

          .select('_id')

          .limit(200)

          .lean();

        const ids = users.map((u) => u._id);

        filter.user = ids.length ? { $in: ids } : { $in: [] };

        restrictUserIds = ids;

      }



      if (dateFrom || dateTo) {

        filter.createdAt = {};

        if (dateFrom) filter.createdAt.$gte = new Date(String(dateFrom));

        if (dateTo) filter.createdAt.$lte = new Date(String(dateTo));

      }



      let summary = null;

      if (wantSummary) {

        const agg = await GamesWalletLedger.aggregate([

          { $match: filter },

          { $group: { _id: '$entryType', total: { $sum: '$amount' }, count: { $sum: 1 } } },

        ]);

        summary = {

          credits: 0,

          debits: 0,

          creditCount: 0,

          debitCount: 0,

          net: 0,

        };

        for (const row of agg) {

          if (row._id === 'credit') {

            summary.credits = row.total || 0;

            summary.creditCount = row.count || 0;

          } else if (row._id === 'debit') {

            summary.debits = row.total || 0;

            summary.debitCount = row.count || 0;

          }

        }

        summary.net = (summary.credits || 0) - (summary.debits || 0);

      }



      const rows = await GamesWalletLedger.find(filter).sort({ createdAt: -1 }).limit(lim).lean();

      const userIds = [...new Set(rows.map((r) => String(r.user)))].filter((id) =>

        mongoose.Types.ObjectId.isValid(id)

      );



      let poolRows = [];

      if (perspectiveSuper) {

        const sa = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select('_id').lean();

        if (sa) {

          if (restrictUserIds !== null && !restrictUserIds.length) {

            poolRows = [];

          } else {

            // Determine which pool row types to fetch based on tab
            // "Debited to you" (tUpper=DEBIT) → SA DEBIT rows (payouts to users)
            // "Credited to you" (tUpper=CREDIT) → SA CREDIT rows (stakes from users)
            // "All lines" (no type) → both SA DEBIT and CREDIT rows
            let poolType;
            if (tUpper === 'DEBIT') poolType = 'DEBIT';
            else if (tUpper === 'CREDIT') poolType = 'CREDIT';
            else poolType = null; // both

            const poolBaseOr = [

              { 'meta.poolDebitKind': { $in: [...GAMES_POOL_DEBIT_KINDS, 'BTC_JACKPOT_STAKE', 'BTC_NUMBER_STAKE', 'UPDOWN_STAKE'] } },

              {

                description: {

                  $regex: /(gross prize hierarchy share|release win brokerage for hierarchy|stake to Bank)/i,

                },

              },

            ];

            const poolFilter = {

              ownerType: 'ADMIN',

              ownerId: sa._id,

              reason: 'ADJUSTMENT',

              $and: [{ $or: poolBaseOr }],

            };

            if (poolType) {
              poolFilter.type = poolType;
            }

            if (gameIdRaw && SUPER_ADMIN_GAMES_LEDGER_GAME_IDS.includes(gameIdRaw)) {

              const prefix = GAMES_LEDGER_GAME_ID_TO_DESC_PREFIX[gameIdRaw];

              const gameOr = [{ 'meta.gameKey': gameIdRaw }];

              if (prefix) {

                gameOr.push({

                  description: new RegExp(`^${escapeRegExpForQuery(prefix)}\\s*—`, 'i'),

                });

              }

              poolFilter.$and.push({ $or: gameOr });

            }

            if (restrictUserIds !== null) {

              poolFilter.$and.push({ 'meta.relatedUserId': { $in: restrictUserIds } });

            }

            if (dateFrom || dateTo) {

              poolFilter.createdAt = { ...filter.createdAt };

            }

            poolRows = await WalletLedger.find(poolFilter).sort({ createdAt: -1 }).limit(lim).lean();

          }

        }

      }



      let poolMapped = [];

      if (perspectiveSuper && poolRows.length) {

        const relIds = [

          ...new Set(

            poolRows

              .map((r) => r.meta?.relatedUserId)

              .filter(Boolean)

              .map((id) => String(id))

          ),

        ].filter((id) => mongoose.Types.ObjectId.isValid(id));

        const relOid = relIds.map((id) => new mongoose.Types.ObjectId(id));

        const relUsers =

          relOid.length > 0

            ? await User.find({ _id: { $in: relOid } }).select('username fullName adminCode').lean()

            : [];

        const relMap = new Map(relUsers.map((u) => [String(u._id), u]));



        poolMapped = poolRows.map((row) => {

          const relKey = row.meta?.relatedUserId ? String(row.meta.relatedUserId) : '';

          const u = relKey ? relMap.get(relKey) : null;

          const gk = row.meta?.gameKey && typeof row.meta.gameKey === 'string' ? row.meta.gameKey : '';

          const gameLabelFromKey = gk ? GAMES_LEDGER_GAME_ID_TO_DESC_PREFIX[gk] || gk : '';

          return {

            _id: row._id,

            feedMergeKey: `sa-pool-${String(row._id)}`,

            createdAt: row.createdAt,

            type: row.type || 'DEBIT',

            reason: 'HOUSE_POOL',

            description: row.description || '',

            amount: row.amount,

            balanceAfter: row.balanceAfter,

            adminCode: u?.adminCode || '',

            ownerId: row.meta?.relatedUserId || null,

            ownerUsername: u?.username || '',

            ownerFullName: u?.fullName || '',

            meta: {

              ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),

              ...(gameLabelFromKey ? { gameLabel: gameLabelFromKey } : {}),

            },

            reference: { type: 'Manual', id: null },

            performedBy: null,

            gamesWallet: false,

            saPoolDebit: true,

          };

        });

      }



      const oidList = userIds.map((id) => new mongoose.Types.ObjectId(id));

      const users =

        oidList.length > 0

          ? await User.find({ _id: { $in: oidList } })

              .select('username fullName adminCode')

              .lean()

          : [];

      const uMap = new Map(users.map((u) => [String(u._id), u]));



      const transactionsGames = rows.map((row) => {

        const u = uMap.get(String(row.user));

        const m = row.meta && typeof row.meta === 'object' ? row.meta : {};

        const brokerFromMeta =

          m.brokeragePaidFromPool != null && Number.isFinite(Number(m.brokeragePaidFromPool))

            ? Number(m.brokeragePaidFromPool)

            : null;

        return {

          _id: row._id,

          createdAt: row.createdAt,

          type: row.entryType === 'credit' ? 'CREDIT' : 'DEBIT',

          reason: 'GAMES_WALLET',

          description: row.description || row.gameLabel || '',

          amount: row.amount,

          balanceAfter: row.balanceAfter,

          adminCode: u?.adminCode || '',

          ownerId: row.user,

          ownerUsername: u?.username || '',

          ownerFullName: u?.fullName || '',

          meta: {

            ...m,

            gameKey: row.gameId,

            gameLabel: row.gameLabel,

          },

          reference: { type: 'Manual', id: null },

          performedBy: null,

          gamesWallet: true,

          brokerageAmount:

            brokerFromMeta !== null ? brokerFromMeta : undefined,

        };

      });



      const transactions = perspectiveSuper

        ? [...transactionsGames, ...poolMapped]

            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

            .slice(0, lim)

        : transactionsGames;

      // Augment summary with pool row totals (SA credits from stakes, SA debits from payouts)
      if (perspectiveSuper && summary && poolRows.length) {
        for (const pr of poolRows) {
          const amt = Number(pr.amount) || 0;
          if (pr.type === 'CREDIT') {
            summary.credits = (summary.credits || 0) + amt;
            summary.creditCount = (summary.creditCount || 0) + 1;
          } else if (pr.type === 'DEBIT') {
            summary.debits = (summary.debits || 0) + amt;
            summary.debitCount = (summary.debitCount || 0) + 1;
          }
        }
        summary.net = (summary.credits || 0) - (summary.debits || 0);
      }

      return res.json({ transactions, summary, scope: 'games' });

    }



    const {

      limit,

      type,

      reason,

      reasons,

      reasonGroup,

      adminCode,

      ownerId,

      userSearch,

      referenceType,

      gameKey,

      dateFrom,

      dateTo,

    } = req.query;



    const query = { ownerType: 'USER' };



    const tUpper = type != null ? String(type).toUpperCase() : '';

    const effType =

      perspectiveSuper && (tUpper === 'CREDIT' || tUpper === 'DEBIT')

        ? tUpper === 'DEBIT'

          ? 'CREDIT'

          : 'DEBIT'

        : tUpper;

    if (effType === 'CREDIT' || effType === 'DEBIT') query.type = effType;



    if (reason && String(reason).trim()) {

      query.reason = String(reason).trim();

    } else if (reasons && String(reasons).trim()) {

      const rlist = String(reasons)

        .split(',')

        .map((s) => s.trim())

        .filter(Boolean);

      if (rlist.length) query.reason = { $in: rlist };

    } else if (reasonGroup && String(reasonGroup).trim()) {

      const g = String(reasonGroup).toLowerCase().trim();

      const TRADING = ['TRADE_PNL', 'BROKERAGE'];

      const GAMES = ['GAME_PROFIT', 'GAMES_TRANSFER'];

      const FUNDS = [

        'FUND_ADD',

        'FUND_WITHDRAW',

        'TRADING_FUND_ADD',

        'TRADING_FUND_WITHDRAW',

        'ADMIN_DEPOSIT',

        'ADMIN_WITHDRAW',

        'ADMIN_TRANSFER',

        'REFUND',

      ];

      const ADJ = ['ADJUSTMENT', 'BONUS', 'PENALTY'];

      const XFER = ['CRYPTO_TRANSFER', 'FOREX_TRANSFER', 'MCX_TRANSFER', 'INTERNAL_TRANSFER'];

      if (g === 'trading') query.reason = { $in: TRADING };

      else if (g === 'games') query.reason = { $in: GAMES };

      else if (g === 'funds') query.reason = { $in: FUNDS };

      else if (g === 'adjustments') query.reason = { $in: ADJ };

      else if (g === 'transfers') query.reason = { $in: XFER };

    }



    if (adminCode && String(adminCode).trim()) {

      query.adminCode = new RegExp(escapeRegExpForQuery(String(adminCode).trim()), 'i');

    }



    if (ownerId && mongoose.Types.ObjectId.isValid(String(ownerId))) {

      query.ownerId = new mongoose.Types.ObjectId(String(ownerId));

    }



    if (userSearch && String(userSearch).trim()) {

      const uq = new RegExp(escapeRegExpForQuery(String(userSearch).trim()), 'i');

      const users = await User.find({

        $or: [{ username: uq }, { fullName: uq }, { email: uq }],

      })

        .select('_id')

        .limit(200)

        .lean();

      const ids = users.map((u) => u._id);

      query.ownerId = ids.length ? { $in: ids } : { $in: [] };

    }



    if (referenceType && String(referenceType).trim()) {

      query['reference.type'] = String(referenceType).trim();

    }



    if (dateFrom || dateTo) {

      query.createdAt = {};

      if (dateFrom) query.createdAt.$gte = new Date(String(dateFrom));

      if (dateTo) query.createdAt.$lte = new Date(String(dateTo));

    }



    let finalQuery = query;

    const gk = gameKey != null ? String(gameKey).trim() : '';

    if (gk && gk !== 'all') {

      const frag = matchAdminLedgerGameKey(gk);

      if (frag && Object.keys(frag).length) {

        finalQuery = Object.keys(query).length ? { $and: [query, frag] } : frag;

      }

    }



    // Hide franchise clients' trading lines from SA global feed (see franchise-client-wallet-feed / franchise-earnings-wallet).
    try {
      const { getAllFranchiseSubtreeUserIds } = await import('../utils/franchiseBrokerage.js');
      const franchiseUserIds = await getAllFranchiseSubtreeUserIds();
      if (franchiseUserIds.length > 0) {
        const franchiseTradingExclude = {
          $or: [
            { reason: { $nin: ['TRADE_PNL', 'BROKERAGE'] } },
            { ownerId: { $nin: franchiseUserIds } },
          ],
        };
        if (finalQuery.$and) {
          finalQuery = { $and: [...finalQuery.$and, franchiseTradingExclude] };
        } else if (Object.keys(finalQuery).length > 0) {
          finalQuery = { $and: [finalQuery, franchiseTradingExclude] };
        } else {
          finalQuery = franchiseTradingExclude;
        }
      }
    } catch (franchiseExcludeErr) {
      console.warn('[client-wallet-feed] franchise exclude:', franchiseExcludeErr?.message || franchiseExcludeErr);
    }



    const effectiveLimit = Math.min(

      Math.max(parseInt(String(limit ?? lim), 10) || lim, 1),

      2000

    );



    let summary = null;

    if (wantSummary) {

      const agg = await WalletLedger.aggregate([

        { $match: finalQuery },

        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },

      ]);

      summary = {

        credits: 0,

        debits: 0,

        creditCount: 0,

        debitCount: 0,

        net: 0,

      };

      for (const row of agg) {

        if (row._id === 'CREDIT') {

          summary.credits = row.total || 0;

          summary.creditCount = row.count || 0;

        } else if (row._id === 'DEBIT') {

          summary.debits = row.total || 0;

          summary.debitCount = row.count || 0;

        }

      }

      summary.net = (summary.credits || 0) - (summary.debits || 0);

    }



    const rawTx = await WalletLedger.find(finalQuery)

      .sort({ createdAt: -1 })

      .limit(effectiveLimit)

      .populate('performedBy', 'username name')

      .lean();



    const ownerIds = [...new Set(rawTx.map((t) => String(t.ownerId)))].filter((id) =>

      mongoose.Types.ObjectId.isValid(id)

    );

    const oidList = ownerIds.map((id) => new mongoose.Types.ObjectId(id));

    const users =

      oidList.length > 0

        ? await User.find({ _id: { $in: oidList } }).select('username fullName').lean()

        : [];

    const uMap = new Map(users.map((u) => [String(u._id), u]));



    const transactions = rawTx.map((t) => {

      const u = uMap.get(String(t.ownerId));

      return {

        ...t,

        ownerUsername: u?.username || '',

        ownerFullName: u?.fullName || '',

      };

    });



    return res.json({ transactions, summary, scope: 'main' });

  } catch (error) {

    console.error('client-wallet-feed:', error);

    res.status(500).json({ message: error.message });

  }

});



/**
 * Franchise root — trading wallet lines for all clients in subtree (book perspective).
 * Games are excluded (Super Admin pool / games ledger unchanged).
 */
router.get('/franchise-client-wallet-feed', protectAdmin, async (req, res) => {
  try {
    const caller = req.admin;
    let franchiseRoot = caller;

    if (caller.role === 'SUPER_ADMIN') {
      const fid = req.query.franchiseAdminId;
      if (!fid || !mongoose.Types.ObjectId.isValid(String(fid))) {
        return res.status(400).json({ message: 'franchiseAdminId query is required for Super Admin' });
      }
      franchiseRoot = await Admin.findById(fid);
    } else if (caller.isFranchiseRoot !== true) {
      return res.status(403).json({ message: 'Franchise root access required' });
    }

    if (!franchiseRoot || franchiseRoot.isFranchiseRoot !== true) {
      return res.status(403).json({ message: 'Target is not a franchise root admin' });
    }

    const { getFranchiseSubtreeUserIds } = await import('../utils/franchiseBrokerage.js');
    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 2000);
    const wantSummary = req.query.includeSummary === '1' || req.query.includeSummary === 'true';
    const pRaw = String(req.query.perspective || 'franchise').toLowerCase().replace(/-/g, '');
    const perspectiveFranchise = pRaw !== 'client';

    const userIds = await getFranchiseSubtreeUserIds(franchiseRoot._id);
    const emptySummary = { credits: 0, debits: 0, creditCount: 0, debitCount: 0, net: 0 };

    if (!userIds.length) {
      return res.json({
        transactions: [],
        summary: wantSummary ? emptySummary : null,
        scope: 'main',
        franchiseRootId: franchiseRoot._id,
      });
    }

    const { type, userSearch, dateFrom, dateTo } = req.query;
    const query = {
      ownerType: 'USER',
      ownerId: { $in: userIds },
      reason: { $in: ['TRADE_PNL', 'BROKERAGE'] },
    };

    const tUpper = type != null ? String(type).toUpperCase() : '';
    const effType =
      perspectiveFranchise && (tUpper === 'CREDIT' || tUpper === 'DEBIT')
        ? tUpper === 'DEBIT'
          ? 'CREDIT'
          : 'DEBIT'
        : tUpper;
    if (effType === 'CREDIT' || effType === 'DEBIT') query.type = effType;

    if (userSearch && String(userSearch).trim()) {
      const uq = new RegExp(escapeRegExpForQuery(String(userSearch).trim()), 'i');
      const users = await User.find({
        _id: { $in: userIds },
        $or: [{ username: uq }, { fullName: uq }, { email: uq }],
      })
        .select('_id')
        .limit(200)
        .lean();
      const ids = users.map((u) => u._id);
      query.ownerId = ids.length ? { $in: ids } : { $in: [] };
    }

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(String(dateFrom));
      if (dateTo) query.createdAt.$lte = new Date(String(dateTo));
    }

    const dateFilter =
      dateFrom || dateTo
        ? {
            ...(dateFrom ? { $gte: new Date(String(dateFrom)) } : {}),
            ...(dateTo ? { $lte: new Date(String(dateTo)) } : {}),
          }
        : null;

    let summary = null;
    if (wantSummary) {
      const agg = await WalletLedger.aggregate([
        { $match: query },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      summary = { ...emptySummary };
      for (const row of agg) {
        if (row._id === 'CREDIT') {
          summary.credits = row.total || 0;
          summary.creditCount = row.count || 0;
        } else if (row._id === 'DEBIT') {
          summary.debits = row.total || 0;
          summary.debitCount = row.count || 0;
        }
      }
      summary.net = (summary.credits || 0) - (summary.debits || 0);
    }

    const rawTx = await WalletLedger.find(query).sort({ createdAt: -1 }).limit(lim).lean();

    const ownerIds = [...new Set(rawTx.map((t) => String(t.ownerId)))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    const oidList = ownerIds.map((id) => new mongoose.Types.ObjectId(id));
    const users =
      oidList.length > 0
        ? await User.find({ _id: { $in: oidList } }).select('username fullName adminCode').lean()
        : [];
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    const clientRows = rawTx.map((t) => {
      const u = uMap.get(String(t.ownerId));
      return {
        ...t,
        ownerUsername: u?.username || '',
        ownerFullName: u?.fullName || '',
        adminCode: u?.adminCode || t.adminCode || '',
        franchiseClientLine: true,
      };
    });

    const adminBookQuery = {
      ownerType: 'ADMIN',
      ownerId: franchiseRoot._id,
      $or: [
        { 'meta.profitKind': 'FRANCHISE_BOOK' },
        { reason: 'TRADE_PNL', description: /^Franchise book/i },
      ],
    };
    if (dateFilter) adminBookQuery.createdAt = dateFilter;

    const bookRows = await WalletLedger.find(adminBookQuery).sort({ createdAt: -1 }).limit(lim).lean();
    const bookMapped = bookRows.map((row) => ({
      ...row,
      ownerUsername: '',
      ownerFullName: '',
      adminCode: franchiseRoot.adminCode || '',
      franchiseBookDirect: true,
    }));

    const transactions = [...clientRows, ...bookMapped]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, lim);

    return res.json({
      transactions,
      summary,
      scope: 'main',
      franchiseRootId: franchiseRoot._id,
    });
  } catch (error) {
    console.error('franchise-client-wallet-feed:', error);
    res.status(500).json({ message: error.message });
  }
});



/**
 * Super Admin — credits received from franchise roots (platform % on trading P&L + brokerage).
 */
router.get('/franchise-earnings-wallet', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const sa = req.admin;
    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 2000);
    const wantSummary = req.query.includeSummary === '1' || req.query.includeSummary === 'true';
    const { dateFrom, dateTo, franchiseAdminId } = req.query;

    const filter = {
      ownerType: 'ADMIN',
      ownerId: sa._id,
      type: 'CREDIT',
      $or: [
        { 'meta.profitKind': 'FRANCHISE_PLATFORM_CHARGE' },
        { description: { $regex: /^Franchise platform charge/i } },
        { description: { $regex: /^Platform charges \(\d+% from franchise root\)/i } },
      ],
    };

    if (franchiseAdminId && mongoose.Types.ObjectId.isValid(String(franchiseAdminId))) {
      filter['meta.franchiseRootId'] = new mongoose.Types.ObjectId(String(franchiseAdminId));
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(String(dateFrom));
      if (dateTo) filter.createdAt.$lte = new Date(String(dateTo));
    }

    let summary = null;
    if (wantSummary) {
      const agg = await WalletLedger.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      const byRoot = await WalletLedger.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$meta.franchiseRootId',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            name: { $first: '$meta.franchiseRootName' },
            adminCode: { $first: '$meta.franchiseRootAdminCode' },
          },
        },
        { $sort: { total: -1 } },
      ]);
      summary = {
        totalCredits: agg[0]?.total || 0,
        creditCount: agg[0]?.count || 0,
        walletBalance: sa.wallet?.balance ?? 0,
        byFranchiseRoot: byRoot.map((r) => ({
          franchiseRootId: r._id,
          name: r.name || 'Unknown franchise',
          adminCode: r.adminCode || '',
          total: r.total || 0,
          count: r.count || 0,
        })),
      };
    }

    const rows = await WalletLedger.find(filter).sort({ createdAt: -1 }).limit(lim).lean();

    const relUserIds = [
      ...new Set(rows.map((r) => r.meta?.relatedUserId).filter(Boolean).map(String)),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users =
      relUserIds.length > 0
        ? await User.find({ _id: { $in: relUserIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('username fullName')
            .lean()
        : [];
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    const missingRootIds = [
      ...new Set(
        rows
          .filter((r) => r.meta?.franchiseRootId && !r.meta?.franchiseRootName)
          .map((r) => String(r.meta.franchiseRootId))
      ),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const rootAdmins =
      missingRootIds.length > 0
        ? await Admin.find({ _id: { $in: missingRootIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('name username adminCode platformChargesPercentage')
            .lean()
        : [];
    const rootMap = new Map(rootAdmins.map((a) => [String(a._id), a]));

    const transactions = rows.map((row) => {
      const u = row.meta?.relatedUserId ? uMap.get(String(row.meta.relatedUserId)) : null;
      const rootId = row.meta?.franchiseRootId ? String(row.meta.franchiseRootId) : '';
      const rootDoc = rootId ? rootMap.get(rootId) : null;
      const pct = row.meta?.platformPct != null ? Number(row.meta.platformPct) : null;
      const base = row.meta?.baseAmount != null ? Number(row.meta.baseAmount) : null;
      const chargeKind = row.meta?.chargeKind || (row.description?.includes('Platform charges') ? 'BROKERAGE' : 'TRADING_PNL');
      const franchiseName =
        row.meta?.franchiseRootName || rootDoc?.name || rootDoc?.username || 'Franchise admin';
      const franchiseCode = row.meta?.franchiseRootAdminCode || rootDoc?.adminCode || '';
      let why = row.description || '';
      if (pct != null && base != null) {
        if (chargeKind === 'BROKERAGE') {
          why = `${pct}% platform charge on ${base.toLocaleString('en-IN')} diverted brokerage from ${franchiseName}`;
        } else {
          why = `${pct}% platform charge on ${base.toLocaleString('en-IN')} franchise book P&L`;
        }
      }
      return {
        _id: row._id,
        createdAt: row.createdAt,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        reason: row.reason,
        description: row.description,
        chargeKind,
        platformPct: pct,
        baseAmount: base,
        why,
        franchiseRoot: {
          _id: row.meta?.franchiseRootId || null,
          name: franchiseName,
          adminCode: franchiseCode,
        },
        client: {
          username: u?.username || '',
          fullName: u?.fullName || '',
        },
        meta: row.meta,
        reference: row.reference,
      };
    });

    return res.json({ transactions, summary });
  } catch (error) {
    console.error('franchise-earnings-wallet:', error);
    res.status(500).json({ message: error.message });
  }
});



// Get comprehensive stats (Super Admin only)

router.get('/comprehensive-stats', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    // Admin stats

    const admins = await Admin.find({ role: 'ADMIN' }).select('-password');

    

    // Get user counts per admin

    const userCounts = await User.aggregate([

      { $group: { _id: '$adminCode', count: { $sum: 1 }, activeCount: { $sum: { $cond: ['$isActive', 1, 0] } } } }

    ]);

    

    const userCountMap = {};

    userCounts.forEach(uc => { userCountMap[uc._id] = uc; });

    

    // Enhance admin data with user counts

    const adminData = admins.map(admin => ({

      ...admin.toObject(),

      userCount: userCountMap[admin.adminCode]?.count || 0,

      activeUserCount: userCountMap[admin.adminCode]?.activeCount || 0

    }));

    

    // Total stats

    const totalAdmins = admins.length;

    const activeAdmins = admins.filter(a => a.status === 'ACTIVE').length;

    const totalUsers = await User.countDocuments();

    const activeUsers = await User.countDocuments({ isActive: true });

    

    // Wallet totals

    const adminWalletTotal = admins.reduce((sum, a) => sum + (a.wallet?.balance || 0), 0);

    const userWalletTotal = await User.aggregate([

      { $group: { _id: null, total: { $sum: '$wallet.cashBalance' } } }

    ]);

    

    // Recent transactions

    const recentTransactions = await WalletLedger.find()

      .sort({ createdAt: -1 })

      .limit(20)

      .populate('performedBy', 'username name');

    

    res.json({

      admins: adminData,

      stats: {

        totalAdmins,

        activeAdmins,

        totalUsers,

        activeUsers,

        adminWalletTotal,

        userWalletTotal: userWalletTotal[0]?.total || 0

      },

      recentTransactions

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Suspend/Activate admin (Super Admin only)

router.put('/admins/:id/status', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { status } = req.body;

    

    if (!['ACTIVE', 'SUSPENDED', 'INACTIVE'].includes(status)) {

      return res.status(400).json({ message: 'Invalid status' });

    }

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin' });

    

    admin.status = status;

    admin.isActive = status === 'ACTIVE';

    await admin.save();

    

    res.json({ message: `Admin ${status.toLowerCase()}`, admin });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update admin charges (hierarchical - parent can update child's charges)

router.put('/admins/:id/charges', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can edit anyone, others can only edit their children

    const isSuperAdmin = req.admin.role === 'SUPER_ADMIN';

    const isParent = targetAdmin.parentId?.toString() === req.admin._id.toString();

    const canManage = req.admin.canManage && req.admin.canManage(targetAdmin.role);

    

    if (!isSuperAdmin && !isParent && !canManage) {

      return res.status(403).json({ message: 'You can only update charges for your subordinates' });

    }

    

    const { charges } = req.body;

    targetAdmin.charges = { ...targetAdmin.charges, ...charges };

    await targetAdmin.save();

    

    res.json({ message: 'Charges updated', admin: targetAdmin });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update brokerage caps for child admin (Parent admin sets min/max limits)

// Super Admin can set caps for any admin, Admin can set caps for their brokers

router.put('/admins/:id/brokerage-caps', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission: Super Admin can edit anyone, others can only edit their children

    const isSuperAdmin = req.admin.role === 'SUPER_ADMIN';

    const isParent = targetAdmin.parentId?.toString() === req.admin._id.toString();

    

    if (!isSuperAdmin && !isParent) {

      return res.status(403).json({ message: 'You can only set brokerage caps for your subordinates' });

    }

    

    const { brokerageCaps } = req.body;

    

    // Validate brokerageCaps structure

    if (!brokerageCaps) {

      return res.status(400).json({ message: 'brokerageCaps is required' });

    }

    

    // Update brokerage caps

    targetAdmin.brokerageCaps = {

      perLot: {

        min: brokerageCaps.perLot?.min ?? targetAdmin.brokerageCaps?.perLot?.min ?? 0,

        max: brokerageCaps.perLot?.max ?? targetAdmin.brokerageCaps?.perLot?.max ?? 1000

      },

      perCrore: {

        min: brokerageCaps.perCrore?.min ?? targetAdmin.brokerageCaps?.perCrore?.min ?? 0,

        max: brokerageCaps.perCrore?.max ?? targetAdmin.brokerageCaps?.perCrore?.max ?? 10000

      },

      perTrade: {

        min: brokerageCaps.perTrade?.min ?? targetAdmin.brokerageCaps?.perTrade?.min ?? 0,

        max: brokerageCaps.perTrade?.max ?? targetAdmin.brokerageCaps?.perTrade?.max ?? 500

      }

    };

    

    await targetAdmin.save();

    

    res.json({ 

      message: 'Brokerage caps updated successfully', 

      brokerageCaps: targetAdmin.brokerageCaps 

    });

  } catch (error) {

    console.error('Error updating brokerage caps:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get brokerage caps for an admin

router.get('/admins/:id/brokerage-caps', protectAdmin, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id).select('brokerageCaps username name role');

    if (!targetAdmin) return res.status(404).json({ message: 'Admin not found' });

    

    // Check permission

    const isSuperAdmin = req.admin.role === 'SUPER_ADMIN';

    const isParent = targetAdmin.parentId?.toString() === req.admin._id.toString();

    const isSelf = targetAdmin._id.toString() === req.admin._id.toString();

    

    if (!isSuperAdmin && !isParent && !isSelf) {

      return res.status(403).json({ message: 'Access denied' });

    }

    

    res.json({

      admin: {

        _id: targetAdmin._id,

        username: targetAdmin.username,

        name: targetAdmin.name,

        role: targetAdmin.role

      },

      brokerageCaps: targetAdmin.brokerageCaps || {

        perLot: { min: 0, max: 1000 },

        perCrore: { min: 0, max: 10000 },

        perTrade: { min: 0, max: 500 }

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update admin role (Super Admin only)

router.put('/admins/:id/role', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { role } = req.body;

    

    // Validate role

    const validRoles = ['ADMIN', 'BROKER', 'SUB_BROKER'];

    if (!validRoles.includes(role)) {

      return res.status(400).json({ message: 'Invalid role. Must be ADMIN, BROKER, or SUB_BROKER' });

    }

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot modify Super Admin role' });

    

    const oldRole = admin.role;

    admin.role = role;

    

    // Update hierarchy level based on role

    const hierarchyLevels = { 'ADMIN': 1, 'BROKER': 2, 'SUB_BROKER': 3 };

    admin.hierarchyLevel = hierarchyLevels[role];

    

    await admin.save();

    

    res.json({ 

      message: `Role changed from ${oldRole} to ${role}`, 

      admin: {

        _id: admin._id,

        username: admin.username,

        name: admin.name,

        role: admin.role,

        hierarchyLevel: admin.hierarchyLevel

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== RESTRICT MODE MANAGEMENT ====================



// Update restrict mode settings for admin (Super Admin only)

// Allows Super Admin to limit max users under Admin/Broker/SubBroker

router.put('/admins/:id/restrict-mode', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { enabled, maxUsers, maxBrokers, maxSubBrokers, monthlyIncentiveAmount, monthlyBrokerageCharge, monthlyIncentiveScope, brokerageChargePerCrore } = req.body;

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot set restrict mode for Super Admin' });

    

    // Update restrict mode settings

    if (typeof enabled === 'boolean') {

      admin.restrictMode.enabled = enabled;

    }

    if (typeof maxUsers === 'number' && maxUsers >= 0) {

      admin.restrictMode.maxUsers = maxUsers;

    }

    if (typeof maxBrokers === 'number' && maxBrokers >= 0 && admin.role === 'ADMIN') {

      admin.restrictMode.maxBrokers = maxBrokers;

    }

    if (typeof maxSubBrokers === 'number' && maxSubBrokers >= 0 && (admin.role === 'ADMIN' || admin.role === 'BROKER')) {

      admin.restrictMode.maxSubBrokers = maxSubBrokers;

    }

    if (admin.role === 'ADMIN' && typeof monthlyIncentiveAmount === 'number' && monthlyIncentiveAmount >= 0) {

      admin.restrictMode.monthlyIncentiveAmount = monthlyIncentiveAmount;

    }

    if (admin.role === 'ADMIN' && typeof monthlyBrokerageCharge === 'number' && monthlyBrokerageCharge >= 0) {

      admin.restrictMode.monthlyBrokerageCharge = monthlyBrokerageCharge;

    }

    if (admin.role === 'ADMIN' && ['games_and_trading', 'trading', 'games'].includes(monthlyIncentiveScope)) {

      admin.restrictMode.monthlyIncentiveScope = monthlyIncentiveScope;

    }

    if ((admin.role === 'BROKER' || admin.role === 'SUB_BROKER') && typeof brokerageChargePerCrore === 'number' && brokerageChargePerCrore >= 0) {

      admin.restrictMode.brokerageChargePerCrore = brokerageChargePerCrore;

    }



    admin.markModified('restrictMode');

    await admin.save();

    

    res.json({ 

      message: `Restrict mode ${admin.restrictMode.enabled ? 'enabled' : 'disabled'} for ${admin.username}`,

      restrictMode: admin.restrictMode,

      admin: {

        _id: admin._id,

        username: admin.username,

        name: admin.name,

        role: admin.role

      }

    });

  } catch (error) {

    console.error('Restrict mode update error:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get restrict mode status for an admin

router.get('/admins/:id/restrict-mode', protectAdmin, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id).select('restrictMode username name role stats');

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    // Get actual user count under this admin

    const actualUserCount = await User.countDocuments({ admin: admin._id });

    

    // Get actual broker/sub-broker count if applicable

    let actualBrokerCount = 0;

    let actualSubBrokerCount = 0;

    

    if (admin.role === 'ADMIN') {

      actualBrokerCount = await Admin.countDocuments({ parentId: admin._id, role: 'BROKER' });

      actualSubBrokerCount = await Admin.countDocuments({ parentId: admin._id, role: 'SUB_BROKER' });

    } else if (admin.role === 'BROKER') {

      actualSubBrokerCount = await Admin.countDocuments({ parentId: admin._id, role: 'SUB_BROKER' });

    }

    

    // Handle case when restrictMode is undefined (for older admins)

    const restrictModeData = admin.restrictMode || {

      enabled: false,

      maxUsers: 100,

      maxBrokers: 10,

      maxSubBrokers: 20

    };

    

    res.json({

      restrictMode: {

        enabled: restrictModeData.enabled || false,

        maxUsers: restrictModeData.maxUsers || 100,

        maxBrokers: restrictModeData.maxBrokers || 10,

        maxSubBrokers: restrictModeData.maxSubBrokers || 20,

        currentUsers: actualUserCount,

        currentBrokers: actualBrokerCount,

        currentSubBrokers: actualSubBrokerCount

      },

      admin: {

        _id: admin._id,

        username: admin.username,

        name: admin.name,

        role: admin.role

      }

    });

  } catch (error) {

    console.error('Get restrict mode error:', error);

    res.status(500).json({ message: error.message });

  }

});



// Bulk update restrict mode for multiple admins (Super Admin only)

router.put('/admins/bulk/restrict-mode', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { adminIds, enabled, maxUsers, maxBrokers, maxSubBrokers } = req.body;

    

    if (!Array.isArray(adminIds) || adminIds.length === 0) {

      return res.status(400).json({ message: 'Please provide admin IDs' });

    }

    

    const updateData = {};

    if (typeof enabled === 'boolean') updateData['restrictMode.enabled'] = enabled;

    if (typeof maxUsers === 'number' && maxUsers >= 0) updateData['restrictMode.maxUsers'] = maxUsers;

    if (typeof maxBrokers === 'number' && maxBrokers >= 0) updateData['restrictMode.maxBrokers'] = maxBrokers;

    if (typeof maxSubBrokers === 'number' && maxSubBrokers >= 0) updateData['restrictMode.maxSubBrokers'] = maxSubBrokers;

    

    const result = await Admin.updateMany(

      { _id: { $in: adminIds }, role: { $ne: 'SUPER_ADMIN' } },

      { $set: updateData }

    );

    

    res.json({ 

      message: `Restrict mode updated for ${result.modifiedCount} admin(s)`,

      modifiedCount: result.modifiedCount

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * PUT /admins/:id/franchise-root

 * Toggle franchise isolation for an admin (Super Admin only).
 * When true: subtree profit/loss settles internally and brokerage-per-crore is used for franchise flow.

 */

router.put('/admins/:id/franchise-root', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { isFranchiseRoot, brokerageChargePerCrore, referralDistributionEnabled } = req.body;

    if (typeof isFranchiseRoot !== 'boolean') {

      return res.status(400).json({ message: 'isFranchiseRoot boolean is required' });

    }

    

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot set franchise root on Super Admin' });

    if (isFranchiseRoot && isIndividualPattiSharingEnabled(admin)) {
      return res.status(400).json({ message: PATTI_FRANCHISE_CONFLICT_MSG });
    }

    

    admin.isFranchiseRoot = isFranchiseRoot;
    // Franchise root no longer uses configurable platform percentage.
    // Keep it fixed at 0 so only brokerage-per-crore logic applies.
    if (isFranchiseRoot) admin.platformChargesPercentage = 0;

    if (
      isFranchiseRoot &&
      typeof brokerageChargePerCrore === 'number' &&
      Number.isFinite(brokerageChargePerCrore) &&
      brokerageChargePerCrore >= 0
    ) {
      if (!admin.restrictMode) admin.restrictMode = {};
      admin.restrictMode.brokerageChargePerCrore = brokerageChargePerCrore;
      admin.markModified('restrictMode');
    }

    let cleared = null;
    if (!isFranchiseRoot) {
      const { clearFranchiseSubtreeRates } = await import('../utils/franchiseBrokerage.js');
      cleared = await clearFranchiseSubtreeRates(admin._id);
      if (admin.restrictMode) {
        admin.restrictMode.brokerageChargePerCrore = 0;
        admin.markModified('restrictMode');
      }
      admin.platformChargesPercentage = 0;
    }

    if (referralDistributionEnabled && typeof referralDistributionEnabled === 'object') {
      const { applyReferralDistributionPatch } = await import('../utils/referralDistributionHelper.js');
      applyReferralDistributionPatch(admin, referralDistributionEnabled);
    }

    await admin.save();

    const { referralDistributionForResponse } = await import('../utils/referralDistributionHelper.js');

    res.json({

      message: isFranchiseRoot
        ? `Franchise root enabled for ${admin.name || admin.username}`
        : `Franchise root disabled for ${admin.name || admin.username}. Downline franchise rates cleared.`,
      clearedDownline: cleared,

      admin: {

        _id: admin._id,

        username: admin.username,

        isFranchiseRoot: admin.isFranchiseRoot,

        platformChargesPercentage: admin.platformChargesPercentage,

        brokerageChargePerCrore: admin.restrictMode?.brokerageChargePerCrore ?? 0,

        referralDistributionEnabled: referralDistributionForResponse(admin),

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});


/**
 * PUT /admins/:id/franchise-charge
 * Set brokerage per crore for admin / broker / sub-broker in franchise hierarchy.
 * Super Admin: any downline role. Franchise admin: brokers & sub-brokers. Broker: sub-brokers only.
 */
router.put('/admins/:id/franchise-charge', protectAdmin, async (req, res) => {
  try {
    const { brokerageChargePerCrore } = req.body;
    if (
      typeof brokerageChargePerCrore !== 'number' ||
      !Number.isFinite(brokerageChargePerCrore) ||
      brokerageChargePerCrore < 0
    ) {
      return res.status(400).json({ message: 'Valid brokerageChargePerCrore (>= 0) is required' });
    }

    const target = await Admin.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (target.role === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Cannot set franchise charge on Super Admin' });
    }

    if (isIndividualPattiSharingEnabled(target)) {
      return res.status(400).json({
        message:
          'Franchise charge cannot be set: this admin is under an active Patti Sharing subtree.',
      });
    }

    const underPatti = await isAdminInActivePattiSubtree(target);
    if (underPatti) {
      return res.status(400).json({
        message:
          'Franchise charge cannot be set: Patti Sharing is active on the parent ADMIN subtree.',
      });
    }

    const caller = req.admin;
    if (!canCallerSetFranchiseChargeOn(caller.role, target.role)) {
      return res.status(403).json({
        message: 'You cannot set franchise charge for this role',
      });
    }

    if (!isUnderCallerHierarchy(caller, target)) {
      return res.status(403).json({ message: 'This account is not under your management' });
    }

    const underFranchise = await isInFranchiseSubtree(target);
    if (!underFranchise) {
      return res.status(403).json({
        message:
          'Franchise is disabled for this hierarchy. Super Admin must enable Franchise root on the parent ADMIN first.',
      });
    }

    if (caller.role !== 'SUPER_ADMIN') {
      const callerIsFranchiseRoot = caller.isFranchiseRoot === true;
      if (!callerIsFranchiseRoot && !underFranchise) {
        return res.status(403).json({
          message:
            'Franchise brokerage can only be set under an active franchise root hierarchy.',
        });
      }
    }

    if (!target.restrictMode) target.restrictMode = {};
    const { validateAdminFranchiseRate } = await import('../utils/franchiseBrokerage.js');
    const rateCheck = await validateAdminFranchiseRate(target, brokerageChargePerCrore);
    if (!rateCheck.ok) {
      return res.status(400).json({ message: rateCheck.message });
    }

    target.restrictMode.brokerageChargePerCrore = brokerageChargePerCrore;
    target.markModified('restrictMode');
    await target.save();

    res.json({
      message: `Franchise charge ${brokerageChargePerCrore.toLocaleString('en-IN')}/crore set for ${target.name || target.username}`,
      admin: {
        _id: target._id,
        username: target.username,
        name: target.name,
        role: target.role,
        brokerageChargePerCrore: target.restrictMode.brokerageChargePerCrore,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


/**
 * PUT /users/:id/franchise-charge
 * Set franchise brokerage per crore on a client (user).
 */
router.put('/users/:id/franchise-charge', protectAdmin, async (req, res) => {
  try {
    const { franchiseChargePerCrore } = req.body;
    if (
      typeof franchiseChargePerCrore !== 'number' ||
      !Number.isFinite(franchiseChargePerCrore) ||
      franchiseChargePerCrore < 0
    ) {
      return res.status(400).json({ message: 'Valid franchiseChargePerCrore (>= 0) is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const caller = req.admin;
    const managerRoles = ['SUPER_ADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER'];
    if (!managerRoles.includes(caller.role)) {
      return res.status(403).json({ message: 'Not allowed to set franchise charge' });
    }

    if (!isUserUnderCaller(caller, user)) {
      return res.status(403).json({ message: 'This user is not under your management' });
    }

    const underFranchise = await isUserInFranchiseSubtree(user);
    if (!underFranchise) {
      return res.status(403).json({
        message:
          'Franchise is disabled for this client\'s hierarchy. Enable Franchise root on the parent ADMIN first.',
      });
    }

    if (caller.role !== 'SUPER_ADMIN' && caller.isFranchiseRoot !== true && !underFranchise) {
      return res.status(403).json({
        message: 'Franchise client charge can only be set under an active franchise root hierarchy.',
      });
    }

    const { validateUserFranchiseRate } = await import('../utils/franchiseBrokerage.js');
    const rateCheck = await validateUserFranchiseRate(user, franchiseChargePerCrore);
    if (!rateCheck.ok) {
      return res.status(400).json({ message: rateCheck.message });
    }

    user.franchiseChargePerCrore = franchiseChargePerCrore;
    await user.save();

    res.json({
      message: `Franchise charge ${franchiseChargePerCrore.toLocaleString('en-IN')}/crore set for ${user.fullName || user.username}`,
      user: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        franchiseChargePerCrore: user.franchiseChargePerCrore,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


/**
 * POST /trades/:tradeId/retry-franchise-brokerage
 * Resume / complete franchise brokerage cascade for a trade (fixes partial distributions).
 */
router.post('/trades/:tradeId/retry-franchise-brokerage', protectAdmin, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId);
    if (!trade) return res.status(404).json({ message: 'Trade not found' });

    const user = await User.findById(trade.user).select(
      'franchiseChargePerCrore admin createdBy adminCode isDemo userId username fullName hierarchyPath'
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { resolveUserDirectAdmin } = await import('../utils/franchiseBrokerage.js');
    const { default: TradeService } = await import('../services/tradeService.js');
    const directAdmin = await resolveUserDirectAdmin(user);
    if (!directAdmin) {
      return res.status(400).json({ message: 'User has no direct admin for brokerage cascade' });
    }

    const brk = Number(trade.commission) || 0;
    if (brk <= 0) {
      return res.status(400).json({ message: 'Trade has no brokerage to distribute' });
    }

    const leg = trade.brokeragePrepaidRoundTrip ? 'OPEN+CLOSE' : 'OPEN';
    await TradeService.distributeBrokerage(trade, brk, directAdmin, user, leg);

    const progress = await TradeService.getFranchiseBrokerageProgress(trade._id, leg.toUpperCase());

    res.json({
      message: 'Franchise brokerage distribution retried',
      tradeId: trade._id,
      totalBrokerage: brk,
      totalDistributed: progress.totalDistributed,
      shortfall: Math.round((brk - progress.totalDistributed) * 100) / 100,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


/**
 * PUT /admins/:id/crypto-timing
 * Update admin-specific crypto trading timing (Super Admin only).
 * When set, applies to this admin's entire hierarchy.
 */
router.put('/admins/:id/crypto-timing', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { cryptoStartTime, cryptoEndTime } = req.body;

    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    if (admin.role === 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot set crypto timing on Super Admin' });

    if (cryptoStartTime !== undefined) admin.cryptoStartTime = cryptoStartTime;
    if (cryptoEndTime !== undefined) admin.cryptoEndTime = cryptoEndTime;

    await admin.save();

    res.json({
      message: `Crypto timing updated for ${admin.name || admin.username}`,
      admin: {
        _id: admin._id,
        username: admin.username,
        cryptoStartTime: admin.cryptoStartTime,
        cryptoEndTime: admin.cryptoEndTime,
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


/**

 * GET /admins/:id/franchise-root

 * Get franchise root status for an admin.

 */

router.get('/admins/:id/franchise-root', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id).select('isFranchiseRoot username name role');

    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    

    res.json({

      _id: admin._id,

      username: admin.username,

      name: admin.name,

      role: admin.role,

      isFranchiseRoot: admin.isFranchiseRoot || false,

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== ADMIN TO ADMIN FUND TRANSFER ====================



// Transfer funds to another admin

router.post('/admin-transfer', protectAdmin, async (req, res) => {

  try {

    const { targetAdminId, amount, remarks } = req.body;

    

    if (!targetAdminId || !amount || amount <= 0) {

      return res.status(400).json({ message: 'Target admin and valid amount required' });

    }

    

    // Cannot transfer to self

    if (targetAdminId === req.admin._id.toString()) {

      return res.status(400).json({ message: 'Cannot transfer to yourself' });

    }

    

    // Check sender has sufficient balance

    if (req.admin.wallet.balance < amount) {

      return res.status(400).json({ message: 'Insufficient wallet balance' });

    }

    

    // Find target admin

    const targetAdmin = await Admin.findById(targetAdminId);

    if (!targetAdmin) {

      return res.status(404).json({ message: 'Target admin not found' });

    }

    

    // Deduct from sender

    req.admin.wallet.balance -= amount;

    await req.admin.save();

    

    // Add to receiver

    targetAdmin.wallet.balance += amount;

    await targetAdmin.save();

    

    // Create ledger entries for both

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: req.admin._id,

      ownerCode: req.admin.adminCode,

      type: 'DEBIT',

      reason: 'ADMIN_TRANSFER',

      amount: amount,

      balanceAfter: req.admin.wallet.balance,

      description: `Transferred to ${targetAdmin.role} - ${targetAdmin.name || targetAdmin.username}${remarks ? ': ' + remarks : ''}`,

      performedBy: req.admin._id

    });

    

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: targetAdmin._id,

      ownerCode: targetAdmin.adminCode,

      type: 'CREDIT',

      reason: 'ADMIN_TRANSFER',

      amount: amount,

      balanceAfter: targetAdmin.wallet.balance,

      description: `Received from ${req.admin.role} - ${req.admin.name || req.admin.username}${remarks ? ': ' + remarks : ''}`,

      performedBy: req.admin._id

    });

    

    res.json({

      message: `Successfully transferred ${amount} to ${targetAdmin.name || targetAdmin.username}`,

      senderBalance: req.admin.wallet.balance,

      transfer: {

        from: req.admin.name || req.admin.username,

        to: targetAdmin.name || targetAdmin.username,

        amount,

        remarks

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get list of admins for transfer (only ADMIN role, excludes self)

router.get('/transfer-targets', protectAdmin, async (req, res) => {

  try {

    const admins = await Admin.find({

      _id: { $ne: req.admin._id },

      role: 'ADMIN',

      status: 'ACTIVE'

    }).select('_id name username adminCode role wallet.balance');

    

    res.json(admins);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== ADMIN FUND REQUEST SYSTEM ====================



// Admin creates fund request to Super Admin

router.post('/fund-request', protectAdmin, async (req, res) => {

  try {

    const { amount, reason } = req.body;

    

    if (!amount || amount <= 0) {

      return res.status(400).json({ message: 'Invalid amount' });

    }

    

    // SUPER_ADMIN cannot request funds (they are the top)

    if (req.admin.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Super Admin cannot request funds' });

    }

    

    // Find the parent admin to request funds from

    let targetAdmin = null;

    if (req.admin.parentId) {

      targetAdmin = await Admin.findById(req.admin.parentId);

    }

    

    // If no parent found, request goes to Super Admin

    if (!targetAdmin) {

      targetAdmin = await Admin.findOne({ role: 'SUPER_ADMIN' });

    }

    

    if (!targetAdmin) {

      return res.status(400).json({ message: 'No parent admin found to request funds from' });

    }

    

    const fundRequest = await AdminFundRequest.create({

      admin: req.admin._id,

      adminCode: req.admin.adminCode,

      requestorRole: req.admin.role,

      targetAdmin: targetAdmin._id,

      targetAdminCode: targetAdmin.adminCode,

      targetRole: targetAdmin.role,

      amount,

      reason: reason || ''

    });

    

    res.status(201).json({ 

      message: `Fund request submitted to ${targetAdmin.role === 'SUPER_ADMIN' ? 'Super Admin' : targetAdmin.name || targetAdmin.username}`, 

      fundRequest 

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Admin gets their fund requests

router.get('/my-fund-requests', protectAdmin, async (req, res) => {

  try {

    const requests = await AdminFundRequest.find({ admin: req.admin._id })

      .sort({ createdAt: -1 })

      .limit(50);

    res.json(requests);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get fund requests targeted to the current admin (hierarchical)

// Super Admin sees all, Admin sees Broker/SubBroker requests, Broker sees SubBroker requests

router.get('/admin-fund-requests', protectAdmin, async (req, res) => {

  try {

    const { status } = req.query;

    let query = {};

    

    if (req.admin.role === 'SUPER_ADMIN') {

      // Super Admin sees all requests

      query = status ? { status } : {};

    } else if (req.admin.role === 'SUB_BROKER') {

      // Sub Broker cannot approve any fund requests

      return res.json([]);

    } else {

      // Admin and Broker see requests targeted to them OR from their subordinates

      // First get all subordinate admin IDs

      const subordinates = await Admin.find({

        $or: [

          { createdBy: req.admin._id },

          { hierarchyPath: req.admin._id }

        ]

      }).select('_id');

      

      const subordinateIds = subordinates.map(s => s._id);

      

      // Show requests targeted to this admin OR requests from subordinates

      const orCondition = {

        $or: [

          { targetAdmin: req.admin._id },

          { admin: { $in: subordinateIds } }

        ]

      };

      

      // Combine with status filter if provided

      if (status) {

        query = { $and: [orCondition, { status }] };

      } else {

        query = orCondition;

      }

    }

    

    const requests = await AdminFundRequest.find(query)

      .populate('admin', 'name username email adminCode wallet role')

      .populate('targetAdmin', 'name username adminCode role')

      .sort({ createdAt: -1 });

    res.json(requests);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Approve/Reject fund request (hierarchical - each level approves from their own wallet)

// Super Admin can approve all, Admin approves Broker/SubBroker, Broker approves SubBroker

router.put('/admin-fund-requests/:id', protectAdmin, async (req, res) => {

  try {

    const { status, remarks } = req.body;

    

    if (!['APPROVED', 'REJECTED'].includes(status)) {

      return res.status(400).json({ message: 'Invalid status' });

    }

    

    // Sub Broker cannot approve any fund requests

    if (req.admin.role === 'SUB_BROKER') {

      return res.status(403).json({ message: 'Sub Broker cannot approve fund requests' });

    }

    

    const fundRequest = await AdminFundRequest.findById(req.params.id);

    if (!fundRequest) return res.status(404).json({ message: 'Request not found' });

    if (fundRequest.status !== 'PENDING') {

      return res.status(400).json({ message: 'Request already processed' });

    }

    

    // Check if the current admin can approve this request

    // Super Admin can approve all, others can only approve requests targeted to them

    if (req.admin.role !== 'SUPER_ADMIN' && fundRequest.targetAdmin.toString() !== req.admin._id.toString()) {

      return res.status(403).json({ message: 'You can only approve requests directed to you' });

    }

    

    // For approval, check if approver has sufficient balance (except Super Admin)

    if (status === 'APPROVED' && req.admin.role !== 'SUPER_ADMIN') {

      if (req.admin.wallet.balance < fundRequest.amount) {

        return res.status(400).json({ 

          message: `Insufficient balance. You have ${req.admin.wallet.balance.toLocaleString()}, but request is for ${fundRequest.amount.toLocaleString()}` 

        });

      }

    }

    

    fundRequest.status = status;

    fundRequest.processedBy = req.admin._id;

    fundRequest.processedAt = new Date();

    fundRequest.adminRemarks = remarks || '';

    await fundRequest.save();

    

    // If approved, transfer funds

    if (status === 'APPROVED') {

      const requestor = await Admin.findById(fundRequest.admin);

      

      if (requestor) {

        // Add funds to requestor's wallet

        requestor.wallet.balance += fundRequest.amount;

        requestor.wallet.totalDeposited += fundRequest.amount;

        await requestor.save();

        

        // Create credit ledger entry for requestor

        await WalletLedger.create({

          ownerType: 'ADMIN',

          ownerId: requestor._id,

          adminCode: requestor.adminCode,

          type: 'CREDIT',

          reason: 'ADMIN_DEPOSIT',

          amount: fundRequest.amount,

          balanceAfter: requestor.wallet.balance,

          description: `Fund request ${fundRequest.requestId} approved by ${req.admin.role === 'SUPER_ADMIN' ? 'Super Admin' : req.admin.name || req.admin.username}`,

          performedBy: req.admin._id

        });

        

        // Deduct from approver's wallet (except Super Admin who has unlimited funds)

        if (req.admin.role !== 'SUPER_ADMIN') {

          req.admin.wallet.balance -= fundRequest.amount;

          req.admin.wallet.totalWithdrawn = (req.admin.wallet.totalWithdrawn || 0) + fundRequest.amount;

          await req.admin.save();

          

          // Create debit ledger entry for approver

          await WalletLedger.create({

            ownerType: 'ADMIN',

            ownerId: req.admin._id,

            adminCode: req.admin.adminCode,

            type: 'DEBIT',

            reason: 'ADMIN_TRANSFER',

            amount: fundRequest.amount,

            balanceAfter: req.admin.wallet.balance,

            description: `Transferred to ${requestor.role} - ${requestor.name || requestor.username} (${fundRequest.requestId})`,

            performedBy: req.admin._id

          });

        }

      }

    }

    

    res.json({ message: `Request ${status.toLowerCase()}`, fundRequest });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== ADMIN WALLET & LEDGER ====================



// Admin gets their own wallet details and summary

router.get('/my-wallet', protectAdmin, async (req, res) => {

  try {

    const admin = await Admin.findById(req.admin._id);

    

    // Get user transaction summary

    const users = await User.find({ adminCode: admin.adminCode });

    

    let totalUserDeposits = 0;

    let totalUserWithdrawals = 0;

    let totalUserProfits = 0;

    let totalUserLosses = 0;

    let totalUserBalance = 0;

    

    users.forEach(user => {

      totalUserBalance += user.wallet?.cashBalance || 0;

      // Sum from wallet transactions if available

      if (user.wallet?.transactions) {

        user.wallet.transactions.forEach(tx => {

          if (tx.type === 'deposit') totalUserDeposits += tx.amount;

          if (tx.type === 'withdraw') totalUserWithdrawals += tx.amount;

        });

      }

      // Sum P&L

      const pnl = user.wallet?.totalPnL || 0;

      if (pnl > 0) totalUserProfits += pnl;

      else totalUserLosses += Math.abs(pnl);

    });

    

    // Get ledger entries for this admin

    const ledgerEntries = await WalletLedger.find({ 

      ownerType: 'ADMIN', 

      ownerId: admin._id 

    }).sort({ createdAt: -1 }).limit(100);

    

    // Calculate distributed amount (funds given to users)

    const distributedToUsers = await WalletLedger.aggregate([

      { 

        $match: { 

          adminCode: admin.adminCode,

          ownerType: 'USER',

          reason: 'FUND_ADD'

        } 

      },

      { $group: { _id: null, total: { $sum: '$amount' } } }

    ]);

    

    res.json({

      wallet: admin.wallet,

      temporaryWallet: admin.temporaryWallet,

      summary: {

        totalUsers: users.length,

        totalUserBalance,

        totalUserDeposits,

        totalUserWithdrawals,

        totalUserProfits,

        totalUserLosses,

        distributedToUsers: distributedToUsers[0]?.total || 0

      },

      ledger: ledgerEntries

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Admin gets their ledger for download (CSV format)

router.get('/my-ledger/download', protectAdmin, async (req, res) => {

  try {

    const { from, to, gameKey } = req.query;



    const gameMatch = matchAdminLedgerGameKey(gameKey);

    const query = {

      ownerType: 'ADMIN',

      ownerId: req.admin._id,

      ...gameMatch,

    };



    if (from || to) {

      query.createdAt = {};

      if (from) query.createdAt.$gte = new Date(from);

      if (to) query.createdAt.$lte = new Date(to);

    }



    const ledger = await WalletLedger.find(query).sort({ createdAt: -1 }).lean();



    const csvSharePercent = (entry) => {

      if (entry?.reason !== 'GAME_PROFIT') return '';

      return displaySharePercentString(resolveGameProfitSharePercent(entry)) || '';

    };

    

    // Generate CSV

    const headers = ['Date', 'Type', 'Reason', 'Share %', 'Amount', 'Balance After', 'Description'];

    const rows = ledger.map(entry => [

      new Date(entry.createdAt).toLocaleString(),

      entry.type,

      entry.reason,

      csvSharePercent(entry),

      entry.amount,

      entry.balanceAfter,

      entry.description || ''

    ]);

    

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');

    

    res.setHeader('Content-Type', 'text/csv');

    res.setHeader('Content-Disposition', `attachment; filename=admin-ledger-${Date.now()}.csv`);

    res.send(csv);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Admin gets user transactions summary for their users

router.get('/user-transactions-summary', protectAdmin, async (req, res) => {

  try {

    const adminCode = req.admin.role === 'SUPER_ADMIN' ? req.query.adminCode : req.admin.adminCode;

    

    if (!adminCode && req.admin.role !== 'SUPER_ADMIN') {

      return res.status(400).json({ message: 'Admin code required' });

    }

    

    const query = adminCode ? { adminCode } : {};

    

    // Get all user ledger entries

    const userLedger = await WalletLedger.find({ 

      ...query,

      ownerType: 'USER' 

    }).sort({ createdAt: -1 }).limit(500);

    

    // Aggregate by reason

    const summary = await WalletLedger.aggregate([

      { $match: { ...query, ownerType: 'USER' } },

      { 

        $group: { 

          _id: '$reason', 

          totalAmount: { $sum: '$amount' },

          count: { $sum: 1 }

        } 

      }

    ]);

    

    res.json({ ledger: userLedger, summary });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update user segment and script settings (Super Admin only)

router.put('/users/:id/settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    

    const { segmentPermissions, scriptSettings } = req.body;

    

    if (segmentPermissions) {

      user.segmentPermissions = segmentPermissions;

    }

    

    if (scriptSettings) {

      user.scriptSettings = scriptSettings;

    }

    

    await user.save();

    res.json({ message: 'User settings updated successfully', user });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Note: copy-settings route is defined earlier in the file (line ~651) for all admins



// Download user transactions as CSV

router.get('/user-transactions/download', protectAdmin, async (req, res) => {

  try {

    const adminCode = req.admin.role === 'SUPER_ADMIN' ? req.query.adminCode : req.admin.adminCode;

    const { from, to } = req.query;

    

    const query = { ownerType: 'USER' };

    if (adminCode) query.adminCode = adminCode;

    

    if (from || to) {

      query.createdAt = {};

      if (from) query.createdAt.$gte = new Date(from);

      if (to) query.createdAt.$lte = new Date(to);

    }

    

    const ledger = await WalletLedger.find(query)

      .populate('ownerId', 'username fullName userId')

      .sort({ createdAt: -1 });

    

    // Generate CSV

    const headers = ['Date', 'User', 'User ID', 'Type', 'Reason', 'Amount', 'Balance After', 'Description'];

    const rows = ledger.map(entry => [

      new Date(entry.createdAt).toLocaleString(),

      entry.ownerId?.fullName || entry.ownerId?.username || 'N/A',

      entry.ownerId?.userId || 'N/A',

      entry.type,

      entry.reason,

      entry.amount,

      entry.balanceAfter,

      entry.description || ''

    ]);

    

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');

    

    res.setHeader('Content-Type', 'text/csv');

    res.setHeader('Content-Disposition', `attachment; filename=user-transactions-${Date.now()}.csv`);

    res.send(csv);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== SUPER ADMIN: FUND REQUEST APPROVE/REJECT ====================



// Super Admin approve fund request (deducts from user's admin wallet, unless user is directly under Super Admin)

router.post('/all-fund-requests/:id/approve', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const request = await FundRequest.findOne({ _id: req.params.id, status: 'PENDING' });

    

    if (!request) {

      return res.status(404).json({ message: 'Fund request not found or already processed' });

    }

    

    const user = await User.findById(request.user);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    // Find the admin who owns this user

    const userAdmin = await Admin.findOne({ adminCode: request.adminCode });

    

    let newUserCashBalance = user.wallet.cashBalance;

    let debitAdmin = null;

    let newAdminBalance = null;

    

    // Determine if we need to deduct from an admin

    // If user is directly under Super Admin (no userAdmin or userAdmin is Super Admin), no deduction

    if (userAdmin && userAdmin.role !== 'SUPER_ADMIN') {

      debitAdmin = userAdmin;

    }

    

    if (request.type === 'DEPOSIT') {

      // Check if admin has sufficient balance (only if deduction needed)

      if (debitAdmin) {

        if (debitAdmin.wallet.balance < request.amount) {

          return res.status(400).json({ 

            message: `Insufficient balance in ${debitAdmin.name || debitAdmin.username}'s wallet. Available: ${debitAdmin.wallet.balance.toLocaleString()}, Required: ${request.amount.toLocaleString()}` 

          });

        }

        

        // Debit from admin wallet

        newAdminBalance = debitAdmin.wallet.balance - request.amount;

        await Admin.updateOne(

          { _id: debitAdmin._id },

          { 

            $set: { 'wallet.balance': newAdminBalance },

            $inc: { 'wallet.totalWithdrawn': request.amount }

          }

        );

        

        await WalletLedger.create({

          ownerType: 'ADMIN',

          ownerId: debitAdmin._id,

          adminCode: debitAdmin.adminCode,

          type: 'DEBIT',

          reason: 'FUND_ADD',

          amount: request.amount,

          balanceAfter: newAdminBalance,

          reference: { type: 'FundRequest', id: request._id },

          performedBy: req.admin._id,

          description: `Fund approved by Super Admin for user ${user.username}`

        });

      }

      

      // Credit to user wallet - use updateOne to avoid segmentPermissions validation

      newUserCashBalance = user.wallet.cashBalance + request.amount;

      await User.updateOne(

        { _id: user._id },

        { 

          $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance },

          $inc: { 'wallet.totalDeposited': request.amount }

        }

      );

      

      await WalletLedger.create({

        ownerType: 'USER',

        ownerId: user._id,

        adminCode: user.adminCode,

        type: 'CREDIT',

        reason: 'FUND_ADD',

        amount: request.amount,

        balanceAfter: newUserCashBalance,

        reference: { type: 'FundRequest', id: request._id },

        performedBy: req.admin._id,

        description: debitAdmin ? `Approved (from ${debitAdmin.name || debitAdmin.username})` : 'Approved by Super Admin (unlimited)'

      });

    } else {

      // For withdrawals, user wallet is debited

      if (user.wallet.cashBalance < request.amount) {

        return res.status(400).json({ message: 'Insufficient user balance' });

      }

      

      // Use updateOne to avoid segmentPermissions validation

      newUserCashBalance = user.wallet.cashBalance - request.amount;

      await User.updateOne(

        { _id: user._id },

        { 

          $set: { 'wallet.cashBalance': newUserCashBalance, 'wallet.balance': newUserCashBalance },

          $inc: { 'wallet.totalWithdrawn': request.amount }

        }

      );

      

      await WalletLedger.create({

        ownerType: 'USER',

        ownerId: user._id,

        adminCode: user.adminCode,

        type: 'DEBIT',

        reason: 'FUND_WITHDRAW',

        amount: request.amount,

        balanceAfter: newUserCashBalance,

        reference: { type: 'FundRequest', id: request._id },

        performedBy: req.admin._id

      });

      

      // Credit back to admin (if exists and not Super Admin)

      if (debitAdmin) {

        newAdminBalance = debitAdmin.wallet.balance + request.amount;

        await Admin.updateOne(

          { _id: debitAdmin._id },

          { 

            $set: { 'wallet.balance': newAdminBalance },

            $inc: { 'wallet.totalDeposited': request.amount }

          }

        );

        

        await WalletLedger.create({

          ownerType: 'ADMIN',

          ownerId: debitAdmin._id,

          adminCode: debitAdmin.adminCode,

          type: 'CREDIT',

          reason: 'FUND_WITHDRAW',

          amount: request.amount,

          balanceAfter: newAdminBalance,

          reference: { type: 'FundRequest', id: request._id },

          performedBy: req.admin._id,

          description: `Withdrawal approved for user ${user.username}`

        });

      }

    }

    

    request.status = 'APPROVED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || 'Approved by Super Admin';

    await request.save();

    

    res.json({ 

      message: 'Fund request approved successfully', 

      request,

      adminWalletBalance: newAdminBalance,

      deductedFrom: debitAdmin ? (debitAdmin.name || debitAdmin.username) : 'Super Admin (unlimited)'

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Super Admin reject fund request

router.post('/all-fund-requests/:id/reject', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const request = await FundRequest.findOne({ _id: req.params.id, status: 'PENDING' });

    

    if (!request) {

      return res.status(404).json({ message: 'Fund request not found or already processed' });

    }

    

    request.status = 'REJECTED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || 'Rejected by Super Admin';

    await request.save();

    

    res.json({ message: 'Fund request rejected', request });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Block/unblock wallet profit credit (superadmin only)
router.put('/users/:id/wallet-block', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { walletType, blocked } = req.body;
    const { WALLET_BLOCK_TYPES, buildWalletBlocksResponse } = await import('../utils/walletBlock.js');
    if (!WALLET_BLOCK_TYPES[walletType]) {
      return res.status(400).json({
        message: 'walletType must be one of: nseBse, mcx, games, crypto, forex',
      });
    }
    if (typeof blocked !== 'boolean') {
      return res.status(400).json({ message: 'blocked must be a boolean' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const field = `${WALLET_BLOCK_TYPES[walletType].field}.profitBlocked`;
    await User.updateOne({ _id: user._id }, { $set: { [field]: blocked } });

    const fresh = await User.findById(user._id)
      .select('wallet nseBseWallet mcxWallet gamesWallet cryptoWallet forexWallet')
      .lean();

    res.json({
      message: blocked
        ? `${WALLET_BLOCK_TYPES[walletType].label} profit blocked`
        : `${WALLET_BLOCK_TYPES[walletType].label} profit unblocked`,
      walletBlocks: buildWalletBlocksResponse(fresh),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reset user margin (fix orphaned margin when no open positions exist)

router.post('/users/:id/reset-margin', protectAdmin, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    // Check admin access

    if (req.admin.role !== 'SUPER_ADMIN' && user.adminCode !== req.admin.adminCode) {

      return res.status(403).json({ message: 'Access denied' });

    }

    

    const oldUsedMargin = user.wallet.usedMargin || 0;

    const oldBlocked = user.wallet.blocked || 0;

    

    // Reset margin fields

    await User.updateOne(

      { _id: user._id },

      { 

        $set: { 

          'wallet.usedMargin': 0,

          'wallet.blocked': 0

        }

      }

    );

    

    res.json({ 

      message: 'Margin reset successfully',

      oldUsedMargin,

      oldBlocked,

      newUsedMargin: 0,

      newBlocked: 0

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Reconcile user margin based on actual open positions

router.post('/users/:id/reconcile-margin', protectAdmin, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    // Check admin access

    if (req.admin.role !== 'SUPER_ADMIN' && user.adminCode !== req.admin.adminCode) {

      return res.status(403).json({ message: 'Access denied' });

    }

    

    // Import Trade model dynamically to avoid circular dependency

    const Trade = (await import('../models/Trade.js')).default;

    

    // Get all open positions for this user

    const openPositions = await Trade.find({ 

      user: user._id, 

      status: 'OPEN',

      isCrypto: { $ne: true } // Only non-crypto trades use margin

    });

    

    // Calculate actual margin used

    const actualMarginUsed = openPositions.reduce((sum, pos) => sum + (pos.marginUsed || 0), 0);

    

    const oldUsedMargin = user.wallet.usedMargin || 0;

    const oldBlocked = user.wallet.blocked || 0;

    

    // Update margin to match actual open positions

    await User.updateOne(

      { _id: user._id },

      { 

        $set: { 

          'wallet.usedMargin': actualMarginUsed,

          'wallet.blocked': actualMarginUsed

        }

      }

    );

    

    res.json({ 

      message: 'Margin reconciled successfully',

      openPositionsCount: openPositions.length,

      oldUsedMargin,

      oldBlocked,

      newUsedMargin: actualMarginUsed,

      newBlocked: actualMarginUsed

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Reset segmentPermissions for all users to use new Market Watch segments

router.post('/users/reset-segment-permissions', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    // Default segment permissions for all 7 Market Watch segments

    const defaultSegmentPermissions = {

      'NSEFUT': { enabled: true, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'NSEOPT': { enabled: true, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'MCXFUT': { enabled: true, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'MCXOPT': { enabled: true, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'NSE-EQ': { enabled: true, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'BSE-FUT': { enabled: false, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } },

      'BSE-OPT': { enabled: false, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0, maxLots: 50, minLots: 1, orderLots: 10, exposureIntraday: 1, exposureCarryForward: 1, optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }, optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 } }

    };

    

    // Update all users with new segment permissions

    const result = await User.updateMany(

      {},

      { 

        $set: { 

          segmentPermissions: defaultSegmentPermissions,

          scriptSettings: {} // Also clear script settings

        }

      }

    );

    

    res.json({ 

      message: 'Segment permissions reset for all users',

      modifiedCount: result.modifiedCount,

      segments: Object.keys(defaultSegmentPermissions)

    });

  } catch (error) {

    console.error('Error resetting segment permissions:', error);

    res.status(500).json({ message: error.message });

  }

});



// ==================== BROKER CHANGE REQUEST ROUTES (Admin and Super Admin Only) ====================



// Get all broker change requests - SUPER_ADMIN sees all, ADMIN sees requests under their hierarchy

router.get('/broker-change-requests', protectAdmin, async (req, res) => {

  try {

    // Only ADMIN and SUPER_ADMIN can view broker change requests

    if (req.admin.role !== 'SUPER_ADMIN' && req.admin.role !== 'ADMIN') {

      return res.status(403).json({ message: 'Only Admin and Super Admin can view broker change requests' });

    }

    

    const { status } = req.query;

    let query = {};

    

    // SUPER_ADMIN sees all requests

    // ADMIN sees only requests where they are the parentAdmin

    if (req.admin.role === 'ADMIN') {

      query.parentAdmin = req.admin._id;

    }

    

    if (status && status !== 'ALL') query.status = status;

    

    const requests = await BrokerChangeRequest.find(query)

      .populate('user', 'username fullName email userId')

      .populate('currentAdmin', 'name username adminCode role')

      .populate('requestedAdmin', 'name username adminCode role')

      .populate('processedBy', 'name username')

      .populate('parentAdmin', 'name username adminCode')

      .sort({ createdAt: -1 });

    

    // Calculate stats based on same filter

    const statsQuery = req.admin.role === 'ADMIN' ? { parentAdmin: req.admin._id } : {};

    const allRequests = await BrokerChangeRequest.find(statsQuery);

    const stats = {

      total: allRequests.length,

      pending: allRequests.filter(r => r.status === 'PENDING').length,

      approved: allRequests.filter(r => r.status === 'APPROVED').length,

      rejected: allRequests.filter(r => r.status === 'REJECTED').length

    };

    

    res.json({ requests, stats });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Approve broker change request - ADMIN and SUPER_ADMIN only

router.post('/broker-change-requests/:id/approve', protectAdmin, async (req, res) => {

  try {

    // Only ADMIN and SUPER_ADMIN can approve

    if (req.admin.role !== 'SUPER_ADMIN' && req.admin.role !== 'ADMIN') {

      return res.status(403).json({ message: 'Only Admin and Super Admin can approve broker change requests' });

    }

    

    let findQuery = { _id: req.params.id, status: 'PENDING' };

    

    // ADMIN can only approve requests where they are the parentAdmin

    if (req.admin.role === 'ADMIN') {

      findQuery.parentAdmin = req.admin._id;

    }

    

    const request = await BrokerChangeRequest.findOne(findQuery)

      .populate('requestedAdmin').populate('currentAdmin');

    

    if (!request) {

      return res.status(404).json({ message: 'Request not found or already processed' });

    }

    

    // Get the user with wallet

    const user = await User.findById(request.user);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    const newAdmin = request.requestedAdmin;

    if (!newAdmin) {

      return res.status(400).json({ message: 'Requested admin not found' });

    }

    

    // Get user's wallet balance

    const userWalletBalance = user.wallet?.balance || 0;

    

    // If user has balance, transfer funds from current admin to new admin

    if (userWalletBalance > 0) {

      // Get current admin (the one who will lose the funds)

      const currentAdmin = await Admin.findOne({ adminCode: request.currentAdminCode });

      

      if (!currentAdmin) {

        return res.status(400).json({ message: 'Current admin not found' });

      }

      

      // Check if current admin is Super Admin - if so, no fund transfer needed from admin wallet

      if (currentAdmin.role !== 'SUPER_ADMIN') {

        // Check if current admin has enough balance

        const currentAdminBalance = currentAdmin.wallet?.balance || 0;

        

        if (currentAdminBalance < userWalletBalance) {

          return res.status(400).json({ 

            message: `Current ${currentAdmin.role === 'BROKER' ? 'Broker' : currentAdmin.role === 'SUB_BROKER' ? 'Sub Broker' : 'Admin'} (${currentAdmin.adminCode}) does not have sufficient funds (${currentAdminBalance.toLocaleString()}) to transfer user's balance (${userWalletBalance.toLocaleString()}). Please ask them to add funds first.`

          });

        }

        

        // Deduct from current admin's wallet

        currentAdmin.wallet.balance -= userWalletBalance;

        await currentAdmin.save();

        

        // Create ledger entry for current admin (debit)

        await WalletLedger.create({

          admin: currentAdmin._id,

          adminCode: currentAdmin.adminCode,

          type: 'DEBIT',

          amount: userWalletBalance,

          balanceAfter: currentAdmin.wallet.balance,

          reason: `User ${user.username} transferred to ${newAdmin.adminCode}`,

          reference: request.requestId,

          category: 'USER_TRANSFER'

        });

      }

      

      // Add to new admin's wallet (if not Super Admin)

      if (newAdmin.role !== 'SUPER_ADMIN') {

        // Refresh newAdmin to get latest wallet

        const newAdminFresh = await Admin.findById(newAdmin._id);

        newAdminFresh.wallet = newAdminFresh.wallet || { balance: 0 };

        newAdminFresh.wallet.balance = (newAdminFresh.wallet.balance || 0) + userWalletBalance;

        await newAdminFresh.save();

        

        // Create ledger entry for new admin (credit)

        await WalletLedger.create({

          admin: newAdminFresh._id,

          adminCode: newAdminFresh.adminCode,

          type: 'CREDIT',

          amount: userWalletBalance,

          balanceAfter: newAdminFresh.wallet.balance,

          reason: `User ${user.username} transferred from ${request.currentAdminCode}`,

          reference: request.requestId,

          category: 'USER_TRANSFER'

        });

      }

    }

    

    // Build new hierarchy path

    let newHierarchyPath = [];

    if (newAdmin.hierarchyPath && newAdmin.hierarchyPath.length > 0) {

      newHierarchyPath = [...newAdmin.hierarchyPath, newAdmin._id];

    } else {

      newHierarchyPath = [newAdmin._id];

    }

    

    // Update user's admin assignment

    const oldAdminCode = user.adminCode;

    user.adminCode = newAdmin.adminCode;

    user.hierarchyPath = newHierarchyPath;

    user.creatorId = newAdmin._id;

    user.creatorRole = newAdmin.role;

    await user.save();

    

    // Update the request

    request.status = 'APPROVED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || '';

    await request.save();

    

    res.json({ 

      message: `User ${user.username} transferred from ${oldAdminCode} to ${newAdmin.adminCode}${userWalletBalance > 0 ? `. Wallet balance ${userWalletBalance.toLocaleString()} transferred.` : ''}`,

      request,

      fundsTransferred: userWalletBalance

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Reject broker change request - ADMIN and SUPER_ADMIN only

router.post('/broker-change-requests/:id/reject', protectAdmin, async (req, res) => {

  try {

    // Only ADMIN and SUPER_ADMIN can reject

    if (req.admin.role !== 'SUPER_ADMIN' && req.admin.role !== 'ADMIN') {

      return res.status(403).json({ message: 'Only Admin and Super Admin can reject broker change requests' });

    }

    

    let findQuery = { _id: req.params.id, status: 'PENDING' };

    

    // ADMIN can only reject requests where they are the parentAdmin

    if (req.admin.role === 'ADMIN') {

      findQuery.parentAdmin = req.admin._id;

    }

    

    const request = await BrokerChangeRequest.findOne(findQuery);

    

    if (!request) {

      return res.status(404).json({ message: 'Request not found or already processed' });

    }

    

    request.status = 'REJECTED';

    request.processedBy = req.admin._id;

    request.processedAt = new Date();

    request.adminRemarks = req.body.remarks || '';

    await request.save();

    

    res.json({ message: 'Request rejected', request });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== NET POSITIONS ====================



// Get net positions aggregated by symbol

// SuperAdmin sees all, Admin/Broker/SubBroker sees their hierarchy

router.get('/net-positions', protectAdmin, async (req, res) => {

  try {

    let userFilter = {};

    

    // Build user filter based on admin role

    if (req.admin.role === 'SUPER_ADMIN') {

      // SuperAdmin sees all positions

      userFilter = {};

    } else {

      // Get all users under this admin's hierarchy

      const users = await User.find({

        $or: [

          { createdBy: req.admin._id },

          { hierarchyPath: req.admin._id }

        ]

      }).select('_id');

      

      const userIds = users.map(u => u._id);

      userFilter = { user: { $in: userIds } };

    }

    

    // Aggregate open positions by symbol

    const netPositions = await Position.aggregate([

      { 

        $match: { 

          status: 'OPEN',

          ...userFilter 

        } 

      },

      {

        $group: {

          _id: {

            symbol: '$symbol',

            exchange: '$exchange',

            segment: '$segment',

            optionType: '$optionType',

            strikePrice: '$strikePrice',

            expiry: '$expiry',

            productType: '$productType'

          },

          buyQty: {

            $sum: {

              $cond: [{ $eq: ['$side', 'BUY'] }, { $multiply: ['$quantity', '$lotSize'] }, 0]

            }

          },

          sellQty: {

            $sum: {

              $cond: [{ $eq: ['$side', 'SELL'] }, { $multiply: ['$quantity', '$lotSize'] }, 0]

            }

          },

          avgBuyPrice: {

            $avg: {

              $cond: [{ $eq: ['$side', 'BUY'] }, '$entryPrice', null]

            }

          },

          avgSellPrice: {

            $avg: {

              $cond: [{ $eq: ['$side', 'SELL'] }, '$entryPrice', null]

            }

          },

          totalUnrealizedPnL: { $sum: '$unrealizedPnL' },

          userCount: { $addToSet: '$user' },

          positionCount: { $sum: 1 }

        }

      },

      {

        $project: {

          _id: 0,

          symbol: '$_id.symbol',

          exchange: '$_id.exchange',

          segment: '$_id.segment',

          optionType: '$_id.optionType',

          strikePrice: '$_id.strikePrice',

          expiry: '$_id.expiry',

          productType: '$_id.productType',

          buyQty: 1,

          sellQty: 1,

          netQty: { $subtract: ['$buyQty', '$sellQty'] },

          avgBuyPrice: { $round: ['$avgBuyPrice', 2] },

          avgSellPrice: { $round: ['$avgSellPrice', 2] },

          totalUnrealizedPnL: { $round: ['$totalUnrealizedPnL', 2] },

          userCount: { $size: '$userCount' },

          positionCount: 1

        }

      },

      { $sort: { symbol: 1 } }

    ]);

    

    // Calculate summary stats

    const summary = {

      totalSymbols: netPositions.length,

      totalBuyQty: netPositions.reduce((sum, p) => sum + p.buyQty, 0),

      totalSellQty: netPositions.reduce((sum, p) => sum + p.sellQty, 0),

      totalNetQty: netPositions.reduce((sum, p) => sum + p.netQty, 0),

      totalUnrealizedPnL: netPositions.reduce((sum, p) => sum + p.totalUnrealizedPnL, 0),

      totalPositions: netPositions.reduce((sum, p) => sum + p.positionCount, 0)

    };

    

    res.json({ positions: netPositions, summary });

  } catch (error) {

    console.error('Error fetching net positions:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get net positions breakdown by user for a specific symbol

router.get('/net-positions/:symbol/users', protectAdmin, async (req, res) => {

  try {

    const { symbol } = req.params;

    let userFilter = {};

    

    if (req.admin.role !== 'SUPER_ADMIN') {

      const users = await User.find({

        $or: [

          { createdBy: req.admin._id },

          { hierarchyPath: req.admin._id }

        ]

      }).select('_id');

      

      const userIds = users.map(u => u._id);

      userFilter = { user: { $in: userIds } };

    }

    

    const positions = await Position.find({

      symbol: symbol,

      status: 'OPEN',

      ...userFilter

    }).populate('user', 'username name clientCode');

    

    // Group by user

    const userPositions = {};

    positions.forEach(pos => {

      const userId = pos.user._id.toString();

      if (!userPositions[userId]) {

        userPositions[userId] = {

          user: pos.user,

          buyQty: 0,

          sellQty: 0,

          netQty: 0,

          unrealizedPnL: 0,

          positions: []

        };

      }

      const qty = pos.quantity * pos.lotSize;

      if (pos.side === 'BUY') {

        userPositions[userId].buyQty += qty;

      } else {

        userPositions[userId].sellQty += qty;

      }

      userPositions[userId].netQty = userPositions[userId].buyQty - userPositions[userId].sellQty;

      userPositions[userId].unrealizedPnL += pos.unrealizedPnL;

      userPositions[userId].positions.push(pos);

    });

    

    res.json(Object.values(userPositions));

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== SYSTEM SETTINGS (Super Admin Only) ====================



// Get system-wide default settings

router.get('/system-settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    let doc = await SystemSettings.findOne({ settingsType: 'global' }).lean();

    if (!doc) {

      await SystemSettings.create({ settingsType: 'global' });

      doc = await SystemSettings.findOne({ settingsType: 'global' }).lean();

    }

    res.json(doc);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update system-wide default settings

router.put('/system-settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { adminDefaults, brokerDefaults, subBrokerDefaults, userDefaults, segmentDefaults, instrumentDefaults } = req.body;

    

    let settings = await SystemSettings.getSettings();

    

    // Update Admin defaults

    if (adminDefaults) {

      if (adminDefaults.brokerage) {

        settings.adminDefaults.brokerage = { ...settings.adminDefaults.brokerage, ...adminDefaults.brokerage };

      }

      if (adminDefaults.leverage) {

        settings.adminDefaults.leverage = { ...settings.adminDefaults.leverage, ...adminDefaults.leverage };

      }

      if (adminDefaults.charges) {

        settings.adminDefaults.charges = { ...settings.adminDefaults.charges, ...adminDefaults.charges };

      }

      if (adminDefaults.lotSettings) {

        settings.adminDefaults.lotSettings = { ...settings.adminDefaults.lotSettings, ...adminDefaults.lotSettings };

      }

      if (adminDefaults.quantitySettings) {

        settings.adminDefaults.quantitySettings = { ...settings.adminDefaults.quantitySettings, ...adminDefaults.quantitySettings };

      }

      if (typeof adminDefaults.autosquare === 'number') {

        settings.adminDefaults.autosquare = adminDefaults.autosquare;

      }

      if (adminDefaults.permissions) {

        settings.adminDefaults.permissions = { ...settings.adminDefaults.permissions, ...adminDefaults.permissions };

      }

    }

    

    // Update Broker defaults

    if (brokerDefaults) {

      if (brokerDefaults.brokerage) {

        settings.brokerDefaults.brokerage = { ...settings.brokerDefaults.brokerage, ...brokerDefaults.brokerage };

      }

      if (brokerDefaults.leverage) {

        settings.brokerDefaults.leverage = { ...settings.brokerDefaults.leverage, ...brokerDefaults.leverage };

      }

      if (brokerDefaults.charges) {

        settings.brokerDefaults.charges = { ...settings.brokerDefaults.charges, ...brokerDefaults.charges };

      }

      if (brokerDefaults.lotSettings) {

        settings.brokerDefaults.lotSettings = { ...settings.brokerDefaults.lotSettings, ...brokerDefaults.lotSettings };

      }

      if (brokerDefaults.quantitySettings) {

        settings.brokerDefaults.quantitySettings = { ...settings.brokerDefaults.quantitySettings, ...brokerDefaults.quantitySettings };

      }

      if (typeof brokerDefaults.autosquare === 'number') {

        settings.brokerDefaults.autosquare = brokerDefaults.autosquare;

      }

      if (brokerDefaults.permissions) {

        settings.brokerDefaults.permissions = { ...settings.brokerDefaults.permissions, ...brokerDefaults.permissions };

      }

    }

    

    // Update SubBroker defaults

    if (subBrokerDefaults) {

      if (subBrokerDefaults.brokerage) {

        settings.subBrokerDefaults.brokerage = { ...settings.subBrokerDefaults.brokerage, ...subBrokerDefaults.brokerage };

      }

      if (subBrokerDefaults.leverage) {

        settings.subBrokerDefaults.leverage = { ...settings.subBrokerDefaults.leverage, ...subBrokerDefaults.leverage };

      }

      if (subBrokerDefaults.charges) {

        settings.subBrokerDefaults.charges = { ...settings.subBrokerDefaults.charges, ...subBrokerDefaults.charges };

      }

      if (subBrokerDefaults.lotSettings) {

        settings.subBrokerDefaults.lotSettings = { ...settings.subBrokerDefaults.lotSettings, ...subBrokerDefaults.lotSettings };

      }

      if (subBrokerDefaults.quantitySettings) {

        settings.subBrokerDefaults.quantitySettings = { ...settings.subBrokerDefaults.quantitySettings, ...subBrokerDefaults.quantitySettings };

      }

      if (typeof subBrokerDefaults.autosquare === 'number') {

        settings.subBrokerDefaults.autosquare = subBrokerDefaults.autosquare;

      }

      if (subBrokerDefaults.permissions) {

        settings.subBrokerDefaults.permissions = { ...settings.subBrokerDefaults.permissions, ...subBrokerDefaults.permissions };

      }

    }

    

    // Update User defaults

    if (userDefaults) {

      if (userDefaults.brokerage) {

        settings.userDefaults.brokerage = { ...settings.userDefaults.brokerage, ...userDefaults.brokerage };

      }

      if (userDefaults.leverage) {

        settings.userDefaults.leverage = { ...settings.userDefaults.leverage, ...userDefaults.leverage };

      }

      if (userDefaults.charges) {

        settings.userDefaults.charges = { ...settings.userDefaults.charges, ...userDefaults.charges };

      }

      if (userDefaults.lotSettings) {

        settings.userDefaults.lotSettings = { ...settings.userDefaults.lotSettings, ...userDefaults.lotSettings };

      }

    }

    

    // Update Segment defaults

    if (segmentDefaults) {

      const segments = ['EQUITY', 'FNO', 'MCX', 'CURRENCY'];

      segments.forEach(seg => {

        if (segmentDefaults[seg]) {

          if (!settings.segmentDefaults) settings.segmentDefaults = {};

          if (!settings.segmentDefaults[seg]) settings.segmentDefaults[seg] = {};

          const merged = normalizeLegacySystemSegmentDefaultsSlice(seg, {

            ...settings.segmentDefaults[seg],

            ...segmentDefaults[seg],

          });

          settings.segmentDefaults[seg] = withAlignedSegmentCommissionUnit(merged);

        }

      });

    }

    

    // Update Instrument defaults

    if (instrumentDefaults) {

      const instruments = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'CRUDEOIL', 'GOLD', 'SILVER', 'NATURALGAS'];

      instruments.forEach(inst => {

        if (instrumentDefaults[inst]) {

          if (!settings.instrumentDefaults) settings.instrumentDefaults = {};

          if (!settings.instrumentDefaults[inst]) settings.instrumentDefaults[inst] = {};

          settings.instrumentDefaults[inst] = { ...settings.instrumentDefaults[inst], ...instrumentDefaults[inst] };

        }

      });

    }

    

    // Update Notification settings

    if (req.body.notificationSettings) {

      if (!settings.notificationSettings) settings.notificationSettings = {};

      settings.notificationSettings = { ...settings.notificationSettings, ...req.body.notificationSettings };

    }

    

    // Update Brokerage Sharing (MLM-style)

    if (req.body.brokerageSharing) {

      if (!settings.brokerageSharing) settings.brokerageSharing = {};

      settings.brokerageSharing = { ...settings.brokerageSharing, ...req.body.brokerageSharing };

    }

    

    // Note: Profit/Loss sharing goes only to direct parent admin

    // For P&L sharing between admin levels, use Patti Sharing feature

    

    // Update Admin Segment Defaults (same structure as Admin.segmentPermissions)

    if (req.body.adminSegmentDefaults && typeof req.body.adminSegmentDefaults === 'object') {

      const raw =

        req.body.adminSegmentDefaults instanceof Map

          ? Object.fromEntries(req.body.adminSegmentDefaults)

          : req.body.adminSegmentDefaults;

      const rawPlain = plainSegmentDefaultsMap(raw);

      const incomingAligned = alignSegmentDefaultsMap(rawPlain);

      const existingPlain = plainSegmentDefaultsMap(settings.adminSegmentDefaults);

      let merged = mergeSegmentDefaultsMaps(existingPlain, incomingAligned);

      merged = overlayCryptoSpreadFromRaw(rawPlain, merged);

      settings.adminSegmentDefaults = merged;

    }

    

    // Update Admin Script Defaults (same structure as Admin.scriptSettings)

    if (req.body.adminScriptDefaults && typeof req.body.adminScriptDefaults === 'object') {

      settings.adminScriptDefaults = req.body.adminScriptDefaults;

    }

    

    // Update Delivery Pledge Settings

    if (req.body.deliveryPledgeSettings) {

      if (!settings.deliveryPledgeSettings) settings.deliveryPledgeSettings = {};

      settings.deliveryPledgeSettings = { ...settings.deliveryPledgeSettings, ...req.body.deliveryPledgeSettings };

    }

    

    settings.updatedBy = req.admin._id;

    settings.markModified('segmentDefaults');

    settings.markModified('instrumentDefaults');

    settings.markModified('notificationSettings');

    settings.markModified('brokerageSharing');

    settings.markModified('adminSegmentDefaults');

    settings.markModified('adminScriptDefaults');

    settings.markModified('deliveryPledgeSettings');

    await settings.save();



    const fresh = await SystemSettings.findOne({ settingsType: 'global' }).lean();

    res.json({ message: 'System settings updated successfully', settings: fresh });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== PLATFORM CHARGES (Super Admin) ====================



router.get('/platform-charges/settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const effective = await getEffectivePlatformChargeConfig();

    const doc = await SystemSettings.findOne({ settingsType: 'global' }).select('platformCharges').lean();

    res.json({

      effective,

      stored: doc?.platformCharges || {},

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== DEMO USER TRIAL (Super Admin) ====================

router.get('/demo-account/settings', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { getDemoAccountSettings } = await import('../utils/demoAccountUtils.js');
    const effective = await getDemoAccountSettings();
    const doc = await SystemSettings.findOne({ settingsType: 'global' }).select('demoAccountSettings').lean();
    res.json({
      effective,
      stored: doc?.demoAccountSettings || {},
      notes: {
        noBrokerageOnDemo: true,
        deleteOnExpiry: 'Expired demo users who did not convert to real are fully deleted (trades, wallet, user record).',
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/demo-account/settings', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { trialDays, demoBalance } = req.body || {};
    const settings = await SystemSettings.getSettings();
    if (!settings.demoAccountSettings) settings.demoAccountSettings = {};
    if (trialDays !== undefined) {
      const d = parseInt(String(trialDays), 10);
      if (!Number.isFinite(d) || d < 1 || d > 30) {
        return res.status(400).json({ message: 'trialDays must be between 1 and 30' });
      }
      settings.demoAccountSettings.trialDays = d;
    }
    if (demoBalance !== undefined) {
      const b = Number(demoBalance);
      if (!Number.isFinite(b) || b < 0) {
        return res.status(400).json({ message: 'demoBalance must be a non-negative number' });
      }
      settings.demoAccountSettings.demoBalance = b;
    }
    settings.updatedBy = req.admin._id;
    settings.markModified('demoAccountSettings');
    await settings.save();
    const { getDemoAccountSettings } = await import('../utils/demoAccountUtils.js');
    const effective = await getDemoAccountSettings();
    res.json({ message: 'Demo account settings saved', effective, stored: settings.demoAccountSettings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/platform-charges/settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { enabled, dailyAmountInr, graceDays } = req.body || {};

    const settings = await SystemSettings.getSettings();

    if (!settings.platformCharges) settings.platformCharges = {};

    if (typeof enabled === 'boolean') settings.platformCharges.enabled = enabled;

    if (dailyAmountInr !== undefined) {

      const n = Number(dailyAmountInr);

      if (!Number.isFinite(n) || n < 0) {

        return res.status(400).json({ message: 'dailyAmountInr must be a non-negative number' });

      }

      settings.platformCharges.dailyAmountInr = n;

    }

    if (graceDays !== undefined) {

      const g = parseInt(String(graceDays), 10);

      if (!Number.isFinite(g) || g < 0 || g > 3650) {

        return res.status(400).json({ message: 'graceDays must be between 0 and 3650' });

      }

      settings.platformCharges.graceDays = g;

    }

    settings.updatedBy = req.admin._id;

    settings.markModified('platformCharges');

    await settings.save();

    const effective = await getEffectivePlatformChargeConfig();

    res.json({ message: 'Platform charge settings saved', effective, stored: settings.platformCharges });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



router.get('/platform-charges/report', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const report = await getPlatformChargeReport(req.query);

    res.json(report);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/** Manual run (IST charge day defaults to today). Super Admin only. */

router.post('/platform-charges/run', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const raw = req.body?.chargeDayKey;

    const chargeDayKey =

      raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? String(raw) : undefined;

    const summary = await runDailyPlatformCharges({ chargeDayKey });

    res.json({ message: 'Platform charge run finished', summary });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Apply system defaults to all existing admins of a role

router.post('/system-settings/apply/:role', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { role } = req.params;

    const validRoles = ['ADMIN', 'BROKER', 'SUB_BROKER'];

    

    if (!validRoles.includes(role)) {

      return res.status(400).json({ message: 'Invalid role. Must be ADMIN, BROKER, or SUB_BROKER' });

    }

    

    const settings = await SystemSettings.getSettings();

    let roleDefaults;

    

    switch (role) {

      case 'ADMIN':

        roleDefaults = settings.adminDefaults;

        break;

      case 'BROKER':

        roleDefaults = settings.brokerDefaults;

        break;

      case 'SUB_BROKER':

        roleDefaults = settings.subBrokerDefaults;

        break;

    }

    

    // Update all admins of this role with the system defaults

    const result = await Admin.updateMany(

      { role },

      {

        $set: {

          'defaultSettings.brokerage': roleDefaults.brokerage,

          'defaultSettings.leverage': roleDefaults.leverage,

          'permissions.canChangeBrokerage': roleDefaults.permissions.canChangeBrokerage,

          'permissions.canChangeCharges': roleDefaults.permissions.canChangeCharges,

          'permissions.canChangeLeverage': roleDefaults.permissions.canChangeLeverage,

          'permissions.canChangeLotSettings': roleDefaults.permissions.canChangeLotSettings,

          'permissions.canChangeTradingSettings': roleDefaults.permissions.canChangeTradingSettings

        }

      }

    );

    

    res.json({ 

      message: `Applied system defaults to ${result.modifiedCount} ${role} accounts`,

      modifiedCount: result.modifiedCount

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== BROKER CERTIFICATE MANAGEMENT (SuperAdmin Only) ====================



// Get all brokers with certificate info

router.get('/broker-certificates', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const brokers = await Admin.find({ role: 'BROKER' })

      .select('name username email phone status branding certificate adminCode referralCode stats.totalUsers createdAt')

      .sort({ 'certificate.displayOrder': 1, createdAt: -1 })

      .lean();



    res.json({ brokers });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update broker certificate (verify, show on landing page, etc.)

router.put('/broker-certificates/:brokerId', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { brokerId } = req.params;

    const { 

      isVerified, 

      showOnLandingPage, 

      certificateNumber, 

      description, 

      specialization, 

      yearsOfExperience,

      totalClients,

      rating,

      displayOrder 

    } = req.body;



    const broker = await Admin.findOne({ _id: brokerId, role: 'BROKER' });

    

    if (!broker) {

      return res.status(404).json({ message: 'Broker not found' });

    }



    // Initialize certificate object if not exists

    if (!broker.certificate) {

      broker.certificate = {};

    }



    // Update certificate fields

    if (typeof isVerified === 'boolean') {

      broker.certificate.isVerified = isVerified;

      if (isVerified && !broker.certificate.verifiedAt) {

        broker.certificate.verifiedAt = new Date();

      }

    }

    if (typeof showOnLandingPage === 'boolean') {

      broker.certificate.showOnLandingPage = showOnLandingPage;

    }

    if (certificateNumber !== undefined) {

      broker.certificate.certificateNumber = certificateNumber;

    }

    if (description !== undefined) {

      broker.certificate.description = description;

    }

    if (specialization !== undefined) {

      broker.certificate.specialization = specialization;

    }

    if (yearsOfExperience !== undefined) {

      broker.certificate.yearsOfExperience = yearsOfExperience;

    }

    if (totalClients !== undefined) {

      broker.certificate.totalClients = totalClients;

    }

    if (rating !== undefined) {

      broker.certificate.rating = Math.min(5, Math.max(1, rating));

    }

    if (displayOrder !== undefined) {

      broker.certificate.displayOrder = displayOrder;

    }



    await broker.save();



    res.json({ 

      message: 'Broker certificate updated successfully',

      broker: {

        id: broker._id,

        name: broker.name,

        username: broker.username,

        certificate: broker.certificate

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Bulk update display order for brokers on landing page

router.put('/broker-certificates/reorder', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { brokerOrders } = req.body; // Array of { brokerId, displayOrder }

    

    if (!Array.isArray(brokerOrders)) {

      return res.status(400).json({ message: 'brokerOrders must be an array' });

    }



    const bulkOps = brokerOrders.map(item => ({

      updateOne: {

        filter: { _id: item.brokerId, role: 'BROKER' },

        update: { $set: { 'certificate.displayOrder': item.displayOrder } }

      }

    }));



    await Admin.bulkWrite(bulkOps);



    res.json({ message: 'Broker display order updated successfully' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Remove broker from landing page (hide certificate)

router.delete('/broker-certificates/:brokerId/landing-page', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { brokerId } = req.params;



    const broker = await Admin.findOneAndUpdate(

      { _id: brokerId, role: 'BROKER' },

      { 

        $set: { 

          'certificate.showOnLandingPage': false 

        } 

      },

      { new: true }

    );



    if (!broker) {

      return res.status(404).json({ message: 'Broker not found' });

    }



    res.json({ message: 'Broker removed from landing page' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== PATTI SHARING ROUTES ====================



/**
 * Super Admin — patti parent-share credits (brokerage pool + trading P&L split with subtree ADMIN).
 */
router.get('/patti-sharing/earnings', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const sa = req.admin;
    const lim = Math.min(Math.max(parseInt(String(req.query.limit || '500'), 10) || 500, 1), 2000);
    const wantSummary = req.query.includeSummary === '1' || req.query.includeSummary === 'true';
    const { dateFrom, dateTo, pattiAdminId } = req.query;

    const filter = {
      ownerType: 'ADMIN',
      ownerId: sa._id,
      $or: [
        { 'meta.pattiSharing': true, 'meta.pattiSource': 'individual_patti_parent' },
        { description: { $regex: /Patti\s+\d+(\.\d+)?%\s+parent/i } },
      ],
    };

    if (pattiAdminId && mongoose.Types.ObjectId.isValid(String(pattiAdminId))) {
      filter['meta.pattiRootAdminId'] = new mongoose.Types.ObjectId(String(pattiAdminId));
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(String(dateFrom));
      if (dateTo) filter.createdAt.$lte = new Date(String(dateTo));
    }

    let summary = null;
    if (wantSummary) {
      const agg = await WalletLedger.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$type', 'CREDIT'] }, '$amount', 0] },
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$type', 'DEBIT'] }, '$amount', 0] },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      const byRoot = await WalletLedger.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$meta.pattiRootAdminId',
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$type', 'CREDIT'] }, '$amount', 0] },
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$type', 'DEBIT'] }, '$amount', 0] },
            },
            count: { $sum: 1 },
            name: { $first: '$meta.pattiRootAdminName' },
            adminCode: { $first: '$meta.pattiRootAdminCode' },
          },
        },
        { $sort: { totalCredits: -1 } },
      ]);

      const configuredAdmins = await Admin.find({
        role: 'ADMIN',
        'pattiSharing.enabled': true,
      })
        .select('name username adminCode pattiSharing.enabled pattiSharing.segments')
        .lean();

      const totalCredits = agg[0]?.totalCredits || 0;
      const totalDebits = agg[0]?.totalDebits || 0;

      summary = {
        totalCredits,
        totalDebits,
        netEarnings: Math.round((totalCredits - totalDebits) * 100) / 100,
        transactionCount: agg[0]?.count || 0,
        walletBalance: sa.wallet?.balance ?? 0,
        byPattiAdmin: byRoot.map((r) => ({
          pattiAdminId: r._id,
          name: r.name || 'Unknown admin',
          adminCode: r.adminCode || '',
          totalCredits: r.totalCredits || 0,
          totalDebits: r.totalDebits || 0,
          net: Math.round(((r.totalCredits || 0) - (r.totalDebits || 0)) * 100) / 100,
          count: r.count || 0,
        })),
        configuredAdmins: configuredAdmins.map((a) => ({
          _id: a._id,
          name: a.name || a.username,
          adminCode: a.adminCode,
          enabled: a.pattiSharing?.enabled === true,
        })),
      };
    }

    const rows = await WalletLedger.find(filter).sort({ createdAt: -1 }).limit(lim).lean();

    const relUserIds = [
      ...new Set(rows.map((r) => r.meta?.relatedUserId).filter(Boolean).map(String)),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users =
      relUserIds.length > 0
        ? await User.find({ _id: { $in: relUserIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('username fullName')
            .lean()
        : [];
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    const missingRootIds = [
      ...new Set(
        rows
          .filter((r) => r.meta?.pattiRootAdminId && !r.meta?.pattiRootAdminName)
          .map((r) => String(r.meta.pattiRootAdminId))
      ),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const rootAdmins =
      missingRootIds.length > 0
        ? await Admin.find({ _id: { $in: missingRootIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('name username adminCode')
            .lean()
        : [];
    const rootMap = new Map(rootAdmins.map((a) => [String(a._id), a]));

    const rowsMissingRoot = rows.filter(
      (r) => !r.meta?.pattiRootAdminId && r.meta?.relatedUserId
    );
    const missingPattiUserIds = [
      ...new Set(rowsMissingRoot.map((r) => String(r.meta.relatedUserId))),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const pattiRootByUserId = new Map();
    if (missingPattiUserIds.length > 0) {
      const usersForPatti = await User.find({
        _id: { $in: missingPattiUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select('admin')
        .populate('admin', 'name username adminCode role parentId status')
        .lean();
      for (const u of usersForPatti) {
        if (!u?.admin) continue;
        const root = await findPattiSubtreeRootAdmin(u.admin);
        if (root) {
          pattiRootByUserId.set(String(u._id), {
            _id: root._id,
            name: root.name || root.username || 'Patti admin',
            adminCode: root.adminCode || '',
          });
        }
      }
    }

    const transactions = rows.map((row) => {
      const u = row.meta?.relatedUserId ? uMap.get(String(row.meta.relatedUserId)) : null;
      const clientLabel = u?.username || u?.fullName || row.meta?.userName || '';
      let rootId = row.meta?.pattiRootAdminId ? String(row.meta.pattiRootAdminId) : '';
      let rootDoc = rootId ? rootMap.get(rootId) : null;
      if (!rootId && row.meta?.relatedUserId) {
        const inferred = pattiRootByUserId.get(String(row.meta.relatedUserId));
        if (inferred) {
          rootId = String(inferred._id);
          rootDoc = inferred;
        }
      }
      const pct = row.meta?.pattiChildPct != null ? Number(row.meta.pattiChildPct) : null;
      const segKey = row.meta?.pattiSegmentKey || row.meta?.segment || '';
      const chargeKind = row.meta?.chargeKind || (row.reason === 'BROKERAGE' ? 'BROKERAGE' : 'TRADING_PNL');
      const pattiAdminName =
        row.meta?.pattiRootAdminName || rootDoc?.name || rootDoc?.username || 'Unknown admin';
      const pattiAdminCode = row.meta?.pattiRootAdminCode || rootDoc?.adminCode || '';
      const signedAmount = row.type === 'DEBIT' ? -row.amount : row.amount;
      let why = row.description || '';
      if (pct != null && segKey) {
        why = `${pct}% patti parent share on ${chargeKind === 'BROKERAGE' ? 'brokerage' : 'trading P&L'} [${segKey}] — from ADMIN ${pattiAdminName}${pattiAdminCode ? ` (${pattiAdminCode})` : ''}`;
      }
      if (clientLabel) {
        why = `${why}${why ? ' · ' : ''}Client: ${clientLabel}`;
      }
      return {
        _id: row._id,
        createdAt: row.createdAt,
        type: row.type,
        amount: row.amount,
        signedAmount,
        balanceAfter: row.balanceAfter,
        reason: row.reason,
        description: row.description,
        chargeKind,
        pattiChildPct: pct,
        pattiSegmentKey: segKey,
        why,
        pattiAdmin: {
          _id: rootId || row.meta?.pattiRootAdminId || null,
          name: pattiAdminName,
          adminCode: pattiAdminCode,
        },
        client: {
          username: u?.username || row.meta?.userName || '',
          fullName: u?.fullName || '',
        },
        tradeSymbol: row.meta?.tradeSymbol || '',
        meta: row.meta,
        reference: row.reference,
      };
    });

    if (wantSummary && summary && transactions.length > 0) {
      const byAdminMap = new Map();
      for (const tx of transactions) {
        const id = tx.pattiAdmin?._id ? String(tx.pattiAdmin._id) : `name:${tx.pattiAdmin?.name || 'unknown'}`;
        const cur = byAdminMap.get(id) || {
          pattiAdminId: tx.pattiAdmin?._id || null,
          name: tx.pattiAdmin?.name || 'Unknown admin',
          adminCode: tx.pattiAdmin?.adminCode || '',
          totalCredits: 0,
          totalDebits: 0,
          count: 0,
        };
        if (tx.type === 'CREDIT') cur.totalCredits += Number(tx.amount) || 0;
        else cur.totalDebits += Number(tx.amount) || 0;
        cur.count += 1;
        byAdminMap.set(id, cur);
      }
      summary.byPattiAdmin = [...byAdminMap.values()]
        .map((r) => ({
          ...r,
          net: Math.round((r.totalCredits - r.totalDebits) * 100) / 100,
        }))
        .sort((a, b) => b.net - a.net);
    }

    return res.json({ transactions, summary });
  } catch (error) {
    console.error('patti-sharing/earnings:', error);
    res.status(500).json({ message: error.message });
  }
});



// Get all patti sharing configurations

router.get('/patti-sharing', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const pattiSharings = await PattiSharing.find()

      .populate('broker', 'name email clientId')

      .populate('specificClients', 'name email clientId')

      .populate('createdBy', 'name email')

      .sort({ createdAt: -1 });



    res.json(pattiSharings);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get patti sharing for a specific broker

router.get('/patti-sharing/broker/:brokerId', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { brokerId } = req.params;

    

    const pattiSharing = await PattiSharing.findOne({ broker: brokerId })

      .populate('broker', 'name email clientId')

      .populate('specificClients', 'name email clientId');



    if (!pattiSharing) {

      return res.status(404).json({ message: 'Patti sharing not found for this broker' });

    }



    res.json(pattiSharing);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get all brokers for patti sharing dropdown

router.get('/patti-sharing/brokers', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const brokers = await Admin.find({ role: 'BROKER', status: 'ACTIVE' })

      .select('name email clientId')

      .sort({ name: 1 });



    // Get existing patti sharing broker IDs

    const existingPattiSharings = await PattiSharing.find().select('broker');

    const existingBrokerIds = existingPattiSharings.map(ps => ps.broker.toString());



    // Mark which brokers already have patti sharing

    const brokersWithStatus = brokers.map(broker => ({

      ...broker.toObject(),

      hasPattiSharing: existingBrokerIds.includes(broker._id.toString())

    }));



    res.json(brokersWithStatus);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Create new patti sharing configuration

router.post('/patti-sharing', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { broker, brokerPercentage, appliedTo, specificClients, segments, notes } = req.body;



    // Check if broker already has patti sharing

    const existing = await PattiSharing.findOne({ broker });

    if (existing) {

      return res.status(400).json({ message: 'Patti sharing already exists for this broker. Please update instead.' });

    }



    // Validate broker exists

    const brokerExists = await Admin.findOne({ _id: broker, role: 'BROKER' });

    if (!brokerExists) {

      return res.status(404).json({ message: 'Broker not found' });

    }



    const derivedPct = deriveBrokerPctFromPattiSegments(segments);

    const bp =

      brokerPercentage !== undefined && brokerPercentage !== null

        ? clampSharePct(brokerPercentage)

        : derivedPct !== null

          ? derivedPct

          : 50;



    const pattiSharing = new PattiSharing({

      broker,

      brokerPercentage: bp,

      superAdminPercentage: 100 - bp,

      appliedTo: appliedTo || 'ALL_CLIENTS',

      specificClients: specificClients || [],

      segments: normalizeBrokerPattiSegments(segments || {}),

      notes: notes || '',

      createdBy: req.admin._id

    });



    await pattiSharing.save();



    const populated = await PattiSharing.findById(pattiSharing._id)

      .populate('broker', 'name email clientId')

      .populate('specificClients', 'name email clientId')

      .populate('createdBy', 'name email');



    res.status(201).json(populated);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update patti sharing configuration

router.put('/patti-sharing/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { id } = req.params;

    const { brokerPercentage, isActive, appliedTo, specificClients, segments, notes } = req.body;



    const pattiSharing = await PattiSharing.findById(id);

    if (!pattiSharing) {

      return res.status(404).json({ message: 'Patti sharing not found' });

    }



    if (segments !== undefined) {

      pattiSharing.segments = normalizeBrokerPattiSegments(segments);

    }

    const derivedAfter = deriveBrokerPctFromPattiSegments(pattiSharing.segments);

    if (brokerPercentage !== undefined && brokerPercentage !== null) {

      pattiSharing.brokerPercentage = clampSharePct(brokerPercentage);

      pattiSharing.superAdminPercentage = 100 - pattiSharing.brokerPercentage;

    } else if (segments !== undefined && derivedAfter !== null) {

      pattiSharing.brokerPercentage = derivedAfter;

      pattiSharing.superAdminPercentage = 100 - derivedAfter;

    }

    if (isActive !== undefined) pattiSharing.isActive = isActive;

    if (appliedTo !== undefined) pattiSharing.appliedTo = appliedTo;

    if (specificClients !== undefined) pattiSharing.specificClients = specificClients;

    if (notes !== undefined) pattiSharing.notes = notes;



    await pattiSharing.save();



    const populated = await PattiSharing.findById(id)

      .populate('broker', 'name email clientId')

      .populate('specificClients', 'name email clientId')

      .populate('createdBy', 'name email');



    res.json(populated);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Delete patti sharing configuration

router.delete('/patti-sharing/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { id } = req.params;



    const pattiSharing = await PattiSharing.findByIdAndDelete(id);

    if (!pattiSharing) {

      return res.status(404).json({ message: 'Patti sharing not found' });

    }



    res.json({ message: 'Patti sharing deleted successfully' });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Toggle patti sharing active status

router.patch('/patti-sharing/:id/toggle', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { id } = req.params;



    const pattiSharing = await PattiSharing.findById(id);

    if (!pattiSharing) {

      return res.status(404).json({ message: 'Patti sharing not found' });

    }



    pattiSharing.isActive = !pattiSharing.isActive;

    await pattiSharing.save();



    res.json({ 

      message: `Patti sharing ${pattiSharing.isActive ? 'activated' : 'deactivated'} successfully`,

      isActive: pattiSharing.isActive

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get clients for a broker (for specific client selection)

router.get('/patti-sharing/broker/:brokerId/clients', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { brokerId } = req.params;



    const clients = await User.find({ broker: brokerId, status: 'ACTIVE' })

      .select('name email clientId walletBalance')

      .sort({ name: 1 });



    res.json(clients);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== GAME SETTINGS ROUTES ====================



/** Deep-merge referralDistribution so partial saves never wipe topRanksOnly / topRanksCount. */

function mergeGameConfigForAdmin(prev, patch) {

  if (!patch || typeof patch !== 'object') {

    return prev && typeof prev === 'object' ? { ...prev } : {};

  }

  const base = prev && typeof prev === 'object' ? { ...prev } : {};

  const out = { ...base, ...patch };

  const patchRef = patch.referralDistribution;

  if (patchRef != null && typeof patchRef === 'object') {

    const prevRef = base.referralDistribution;

    out.referralDistribution = {

      ...(prevRef && typeof prevRef === 'object' ? { ...prevRef } : {}),

      ...patchRef,

    };

  }

  return out;

}



// Get game settings

router.get('/game-settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const settings = await GameSettings.getSettings();

    const plain = typeof settings.toObject === 'function' ? settings.toObject() : settings;

    res.json(plain);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});

function formatIstClockFromSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '—';
  const h = Math.floor(n / 3600) % 24;
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} IST`;
}

function formatDecimalPickFromPrice(price) {
  const part = closingPriceToDecimalPart(price);
  if (part == null) return null;
  return `.${String(part).padStart(2, '0')}`;
}

/** Super Admin — live window / LTP snapshot for each fantasy game (Game Settings screen). */
router.get('/game-settings/live-details', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const settings = await GameSettings.getSettings();
    const games = settings?.games || {};
    const nowSec = currentTotalSecondsIST();
    const istDate = getTodayISTString();

    const priceResolver = new ZerodhaPriceResolver();
    const niftyResolved = await priceResolver.resolveNiftyGamePrice('ltp');
    const niftyLtp = Number(
      niftyResolved?.ltpPrice ?? niftyResolved?.actualLtp ?? niftyResolved?.price
    );
    const niftySessionClearing = Number(
      niftyResolved?.safeSessionClearing ?? niftyResolved?.sessionClearing
    );
    const niftyLtpOk = Number.isFinite(niftyLtp) && niftyLtp > 0;
    const niftyClearingOk = Number.isFinite(niftySessionClearing) && niftySessionClearing > 0;

    const btcSpot = await getLiveBtcSpotForJackpot();
    const btcLtp = Number(btcSpot?.price);
    const btcLtpOk = Number.isFinite(btcLtp) && btcLtp > 0;

    const niftyUpDownCfg = games.niftyUpDown || {};
    const niftyUpDownState = getNiftyUpDownWindowState(nowSec, niftyUpDownCfg);
    const btcUpDownCfg = games.btcUpDown || {};
    const btcUpDownState = getBtcUpDownWindowState(nowSec, btcUpDownCfg);

    const md = getMarketData();
    const niftyWs = md['256265'] || md[256265];
    const zerodhaWsConnected = !!(niftyWs?.ltp && Number(niftyWs.ltp) > 0);

    res.json({
      updatedAt: new Date().toISOString(),
      istDate,
      zerodhaWsConnected,
      niftyUpDown: {
        enabled: niftyUpDownCfg.enabled !== false,
        status: niftyUpDownState.status,
        windowNumber: Number(niftyUpDownState.windowNumber) || 0,
        windowStart: formatIstClockFromSec(niftyUpDownState.windowStartSec),
        windowEnd: formatIstClockFromSec(niftyUpDownState.windowEndSec),
        ltp: niftyLtpOk ? niftyLtp : null,
        ltpSource: niftyResolved?.source || null,
        message: niftyUpDownState.message || null,
      },
      btcUpDown: {
        enabled: btcUpDownCfg.enabled !== false,
        status: btcUpDownState.status,
        windowNumber: Number(btcUpDownState.windowNumber) || 0,
        windowStart: formatIstClockFromSec(btcUpDownState.windowStartSec),
        windowEnd: formatIstClockFromSec(btcUpDownState.windowEndSec),
        ltp: btcLtpOk ? btcLtp : null,
        ltpSource: btcSpot?.source || null,
        message: btcUpDownState.message || null,
      },
      niftyNumber: {
        enabled: games.niftyNumber?.enabled !== false,
        ltp: niftyLtpOk ? niftyLtp : null,
        runningDecimal: niftyLtpOk ? formatDecimalPickFromPrice(niftyLtp) : null,
        ltpSource: niftyResolved?.source || null,
      },
      niftyBracket: {
        enabled: games.niftyBracket?.enabled !== false,
        ltp: niftyLtpOk ? niftyLtp : null,
        sessionClearing: niftyClearingOk ? niftySessionClearing : null,
        displayPrice: niftyClearingOk ? niftySessionClearing : niftyLtpOk ? niftyLtp : null,
        ltpSource: niftyResolved?.source || null,
        marketOpen: !!niftyResolved?.marketOpen,
      },
      niftyJackpot: {
        enabled: games.niftyJackpot?.enabled !== false,
        livePrice: niftyLtpOk ? niftyLtp : null,
        ltpSource: niftyResolved?.source || null,
        streaming: zerodhaWsConnected || niftyLtpOk,
      },
      btcJackpot: {
        enabled: games.btcJackpot?.enabled !== false,
        livePrice: btcLtpOk ? btcLtp : null,
        ltpSource: btcSpot?.source || null,
        streaming: btcLtpOk,
      },
      btcNumber: {
        enabled: games.btcNumber?.enabled !== false,
        livePrice: btcLtpOk ? btcLtp : null,
        runningDecimal: btcLtpOk ? formatDecimalPickFromPrice(btcLtp) : null,
        ltpSource: btcSpot?.source || null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load game live details' });
  }
});



// Update game settings

router.put('/game-settings', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const body = { ...req.body };

    const gamesPayload = body.games;

    delete body.games;

    // Avoid overwriting Mongo metadata or re-assigning immutable fields

    delete body._id;

    delete body.__v;

    delete body.createdAt;

    delete body.updatedAt;



    let settings = await GameSettings.findOne();

    if (!settings) {

      settings = new GameSettings({ ...body, ...(gamesPayload ? { games: gamesPayload } : {}) });

    } else {

      if (gamesPayload && typeof gamesPayload === 'object') {

        // Plain-object merge: Object.assign on Mongoose subdocs often fails to persist

        // nested fields (e.g. ticketPrice). Replace games from merged POJOs instead.

        const currentGames = settings.toObject().games || {};

        const nextGames = { ...currentGames };

        for (const [gameId, gameData] of Object.entries(gamesPayload)) {

          if (nextGames[gameId] && gameData && typeof gameData === 'object') {

            let merged = mergeGameConfigForAdmin(nextGames[gameId], gameData);

            if (gameId === 'niftyUpDown' && merged.roundDuration != null) {

              const rd = Math.floor(Number(merged.roundDuration));

              if (!Number.isFinite(rd) || rd < 900) merged.roundDuration = 900;

            }

            nextGames[gameId] = merged;

          }

        }

        settings.games = nextGames;

        settings.markModified('games');

      }

      Object.assign(settings, body);

    }

    await settings.save();

    res.json(typeof settings.toObject === 'function' ? settings.toObject() : settings);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Update individual game settings

router.put('/game-settings/game/:gameId', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { gameId } = req.params;

    const gameData = req.body;



    let settings = await GameSettings.getSettings();



    if (settings.games && settings.games[gameId]) {

      const currentGames = settings.toObject().games || {};

      const patch = gameData && typeof gameData === 'object' ? { ...gameData } : {};

      if (gameId === 'niftyUpDown' && patch.roundDuration != null) {

        const rd = Math.floor(Number(patch.roundDuration));

        if (!Number.isFinite(rd) || rd < 900) patch.roundDuration = 900;

      }

      const mergedGame = mergeGameConfigForAdmin(currentGames[gameId] || {}, patch);

      const merged = {

        ...currentGames,

        [gameId]: mergedGame,

      };

      settings.games = merged;

      settings.markModified('games');

      await settings.save();

      res.json(typeof settings.toObject === 'function' ? settings.toObject() : settings);

    } else {

      res.status(404).json({ message: 'Game not found' });

    }

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Toggle game enabled/disabled

router.patch('/game-settings/game/:gameId/toggle', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { gameId } = req.params;

    

    let settings = await GameSettings.getSettings();

    

    if (settings.games && settings.games[gameId]) {

      const currentlyEnabled = settings.games[gameId].enabled !== false;

      // Block disable if users have unsettled bets
      if (currentlyEnabled) {
        const pendingCount = await countPendingBetsForGame(gameId);
        if (pendingCount > 0) {
          return res.status(400).json({
            message: `Cannot disable ${settings.games[gameId].name || gameId} — ${pendingCount} user(s) have placed tickets on this game whose win/loss is not yet decided. Please wait until all results are settled.`
          });
        }
      }

      settings.games[gameId].enabled = !settings.games[gameId].enabled;

      settings.markModified('games');

      await settings.save();

      res.json({ 

        message: `${gameId} ${settings.games[gameId].enabled ? 'enabled' : 'disabled'}`,

        enabled: settings.games[gameId].enabled

      });

    } else {

      res.status(404).json({ message: 'Game not found' });

    }

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Toggle global games enabled/disabled

router.patch('/game-settings/toggle-all', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    let settings = await GameSettings.getSettings();

    // Block "Disable All" if any game has unsettled bets
    if (settings.gamesEnabled) {
      const allGameIds = ['niftyUpDown', 'btcUpDown', 'niftyNumber', 'niftyBracket', 'niftyJackpot', 'btcJackpot', 'btcNumber'];
      const counts = await Promise.all(allGameIds.map(id => countPendingBetsForGame(id)));
      const gamesWithPending = allGameIds.filter((_, i) => counts[i] > 0);
      const totalPending = counts.reduce((s, c) => s + c, 0);
      if (totalPending > 0) {
        return res.status(400).json({
          message: `Cannot disable all games — ${totalPending} unsettled ticket(s) across ${gamesWithPending.length} game(s) (${gamesWithPending.join(', ')}). Please wait until all results are settled.`
        });
      }
    }

    settings.gamesEnabled = !settings.gamesEnabled;

    await settings.save();

    res.json({ 

      message: `All games ${settings.gamesEnabled ? 'enabled' : 'disabled'}`,

      gamesEnabled: settings.gamesEnabled

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Toggle maintenance mode

router.patch('/game-settings/maintenance', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { enabled, message } = req.body;

    

    let settings = await GameSettings.getSettings();

    settings.maintenanceMode = enabled;

    if (message) settings.maintenanceMessage = message;

    await settings.save();

    

    res.json({ 

      message: `Maintenance mode ${settings.maintenanceMode ? 'enabled' : 'disabled'}`,

      maintenanceMode: settings.maintenanceMode

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============================================================================

// PERMANENT DELETE ADMIN (Super Admin Only)

// ============================================================================



/**

 * DELETE /admins/:id/permanent

 * Permanently delete an admin/broker/sub-broker and all subordinates (Super Admin only)

 */

router.delete('/admins/:id/permanent', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const adminToDelete = await Admin.findById(req.params.id);

    if (!adminToDelete) {

      return res.status(404).json({ message: 'Admin not found' });

    }

    

    // Cannot delete Super Admin

    if (adminToDelete.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Cannot delete Super Admin' });

    }

    

    // Get all subordinate admins (brokers, sub-brokers under this admin)

    const subordinateAdmins = await Admin.find({

      hierarchyPath: adminToDelete._id

    });

    

    // Get all admin IDs to delete

    const adminIds = [adminToDelete._id, ...subordinateAdmins.map(a => a._id)];

    

    // Delete all users under these admins

    const deletedUsersResult = await User.deleteMany({

      $or: [

        { admin: { $in: adminIds } },

        { hierarchyPath: { $in: adminIds } }

      ]

    });

    

    // Delete all trades and positions for these users

    try {

      await Trade.deleteMany({ admin: { $in: adminIds } });

      await Position.deleteMany({ admin: { $in: adminIds } });

    } catch (err) {

      console.log('Error deleting trades/positions:', err.message);

    }

    

    // Delete all subordinate admins

    const deletedAdminsResult = await Admin.deleteMany({

      hierarchyPath: adminToDelete._id

    });

    

    // Delete the admin itself

    await Admin.findByIdAndDelete(adminToDelete._id);

    

    res.json({ 

      message: `${adminToDelete.role} and all subordinates permanently deleted`,

      deletedAdmin: adminToDelete.name || adminToDelete.username,

      deletedSubordinates: deletedAdminsResult.deletedCount,

      deletedUsers: deletedUsersResult.deletedCount

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============================================================================

// PERMANENT DELETE USER (Super Admin Only)

// ============================================================================



/**

 * DELETE /users/:id/permanent

 * Permanently delete a user and all their data (Super Admin only)

 */

router.delete('/users/:id/permanent', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }

    

    // Delete user's trading data

    try {

      await Trade.deleteMany({ user: user._id });

      await Position.deleteMany({ user: user._id });

    } catch (err) {

      console.log('Error deleting user trades/positions:', err.message);

    }

    

    // Delete wallet ledger entries

    try {

      await WalletLedger.deleteMany({ ownerId: user._id, ownerType: 'USER' });

    } catch (err) {

      console.log('Error deleting wallet ledger:', err.message);

    }

    

    // Delete fund requests

    try {

      await FundRequest.deleteMany({ user: user._id });

    } catch (err) {

      console.log('Error deleting fund requests:', err.message);

    }

    

    // Delete the user

    await User.findByIdAndDelete(user._id);

    

    res.json({ 

      message: 'User permanently deleted',

      deletedUser: user.username || user.email

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============================================================================

// SOFT DELETE ADMIN (Move to Archive)

// ============================================================================



/**

 * DELETE /admins/:id

 * Soft delete an admin/broker/sub-broker (move to archive)

 * Validation: Only allow archiving if no users have active trades or pending games

 */

router.delete('/admins/:id', protectAdmin, async (req, res) => {

  try {

    const adminToArchive = await Admin.findById(req.params.id);

    if (!adminToArchive) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    // Cannot delete Super Admin

    if (adminToArchive.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Cannot delete Super Admin' });

    }



    // Check permissions

    const parentAdmin = req.admin;

    if (!parentAdmin.canManage(adminToArchive.role)) {

      return res.status(403).json({ message: 'You do not have permission to delete this admin' });

    }



    // Get all users under this admin (including sub-admins' users)

    const allAdminIds = await Admin.find({

      $or: [

        { _id: adminToArchive._id },

        { hierarchyPath: adminToArchive._id }

      ]

    }).select('_id');



    const adminIdList = allAdminIds.map(a => a._id);



    // Check for active trades for any users under this admin

    const activeTrades = await Trade.countDocuments({

      admin: { $in: adminIdList },

      status: { $in: ['OPEN', 'PENDING'] }

    });



    // Check for pending games for any users under this admin

    const GameTransactionSlip = require('../models/GameTransactionSlip');

    const pendingGames = await GameTransactionSlip.countDocuments({

      adminCode: adminToArchive.adminCode,

      status: { $in: ['PENDING', 'PARTIALLY_SETTLED'] }

    });



    // Check for open positions in all wallets for users under this admin

    const usersWithOpenPositions = await User.find({

      admin: { $in: adminIdList }

    }).select('_id username wallet gamesWallet mcxWallet cryptoWallet forexWallet');



    const usersWithIssues = [];

    for (const u of usersWithOpenPositions) {

      const positions = [];

      if (u.wallet?.usedMargin > 0) {

        positions.push(`Main Wallet: ${u.wallet.usedMargin.toLocaleString()} used margin`);

      }

      if (u.gamesWallet?.usedMargin > 0) {

        positions.push(`Games Wallet: ${u.gamesWallet.usedMargin.toLocaleString()} used margin`);

      }

      if (u.mcxWallet?.usedMargin > 0) {

        positions.push(`MCX Wallet: ${u.mcxWallet.usedMargin.toLocaleString()} used margin`);

      }

      if (u.cryptoWallet?.usedMargin > 0) {

        positions.push(`Crypto Wallet: ${u.cryptoWallet.usedMargin.toLocaleString()} used margin`);

      }

      if (u.forexWallet?.usedMargin > 0) {

        positions.push(`Forex Wallet: ${u.forexWallet.usedMargin.toLocaleString()} used margin`);

      }



      if (positions.length > 0) {

        usersWithIssues.push({

          username: u.username || u.email,

          positions: positions.join(', ')

        });

      }

    }



    // Build detailed error message

    const blockReasons = [];

    if (activeTrades > 0) {

      blockReasons.push(`${activeTrades} active trade(s) open under this admin`);

    }

    if (pendingGames > 0) {

      blockReasons.push(`${pendingGames} pending game(s) with results yet to come under this admin`);

    }

    if (usersWithIssues.length > 0) {

      const userList = usersWithIssues.map(u => `${u.username} has ${u.positions}`).join('; ');

      blockReasons.push(`users with open positions: ${userList}`);

    }



    if (blockReasons.length > 0) {

      return res.status(400).json({

        message: `Cannot archive ${adminToArchive.role}. ${blockReasons.join(' and ')}. Please close all positions before archiving.`

      });

    }



    // Soft delete - set deletedAt and deletedBy

    adminToArchive.deletedAt = new Date();

    adminToArchive.deletedBy = parentAdmin._id;

    adminToArchive.status = 'INACTIVE';

    adminToArchive.isActive = false;

    await adminToArchive.save();



    res.json({

      message: `${adminToArchive.role} moved to archive`,

      archivedAdmin: adminToArchive.name || adminToArchive.username

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * DELETE /users/:id

 * Soft delete a user (move to archive)

 * Validation: Only allow archiving if no active trades and no pending games

 */

router.delete('/users/:id', protectAdmin, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }



    // Check for active trades (OPEN or PENDING status)

    const activeTrades = await Trade.countDocuments({

      user: user._id,

      status: { $in: ['OPEN', 'PENDING'] }

    });



    // Check for pending games (PENDING or PARTIALLY_SETTLED status)

    const pendingGames = await GameTransactionSlip.countDocuments({

      userId: user._id,

      status: { $in: ['PENDING', 'PARTIALLY_SETTLED'] }

    });



    // Check for open positions in all wallets

    const openPositions = [];

    const userName = user.username || user.email;



    if (user.wallet?.usedMargin > 0) {

      openPositions.push(`Main Wallet: ${user.wallet.usedMargin.toLocaleString()} used margin`);

    }

    if (user.gamesWallet?.usedMargin > 0) {

      openPositions.push(`Games Wallet: ${user.gamesWallet.usedMargin.toLocaleString()} used margin`);

    }

    if (user.mcxWallet?.usedMargin > 0) {

      openPositions.push(`MCX Wallet: ${user.mcxWallet.usedMargin.toLocaleString()} used margin`);

    }

    if (user.cryptoWallet?.usedMargin > 0) {

      openPositions.push(`Crypto Wallet: ${user.cryptoWallet.usedMargin.toLocaleString()} used margin`);

    }

    if (user.forexWallet?.usedMargin > 0) {

      openPositions.push(`Forex Wallet: ${user.forexWallet.usedMargin.toLocaleString()} used margin`);

    }



    // Build detailed error message

    const blockReasons = [];

    if (activeTrades > 0) {

      blockReasons.push(`${activeTrades} active trade(s) open`);

    }

    if (pendingGames > 0) {

      blockReasons.push(`${pendingGames} pending game(s) with results yet to come`);

    }

    if (openPositions.length > 0) {

      blockReasons.push(`open positions:\n${openPositions.join('\n')}`);

    }



    if (blockReasons.length > 0) {

      return res.status(400).json({

        message: `Cannot archive user ${userName}. ${blockReasons.join(' and ')}. Please close all positions before archiving.`

      });

    }



    // Soft delete - set deletedAt and deletedBy

    user.deletedAt = new Date();

    user.deletedBy = req.admin._id;

    user.tradingStatus = 'BLOCKED';

    user.isActive = false;

    await user.save();



    res.json({

      message: 'User moved to archive',

      archivedUser: user.username || user.email

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============================================================================

// ARCHIVE MANAGEMENT

// ============================================================================



/**

 * GET /archive

 * Get all archived admins and users (Super Admin only)

 */

router.get('/archive', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { type } = req.query;



    let archivedAdmins = [];

    let archivedUsers = [];



    if (!type || type === 'admins') {

      archivedAdmins = await Admin.find({ deletedAt: { $ne: null } })

        .populate('deletedBy', 'name adminCode')

        .populate('parentId', 'name adminCode')

        .sort({ deletedAt: -1 });

    }



    if (!type || type === 'users') {

      archivedUsers = await User.find({ deletedAt: { $ne: null } })

        .populate('deletedBy', 'name adminCode')

        .populate('admin', 'name adminCode')

        .sort({ deletedAt: -1 });

    }



    res.json({

      admins: archivedAdmins,

      users: archivedUsers

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * POST /archive/restore/admins/:id

 * Restore an archived admin (Super Admin only)

 */

router.post('/archive/restore/admins/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    if (!admin.deletedAt) {

      return res.status(400).json({ message: 'This admin is not archived' });

    }



    // Restore - clear deletedAt and deletedBy

    admin.deletedAt = null;

    admin.deletedBy = null;

    admin.status = 'ACTIVE';

    admin.isActive = true;

    await admin.save();



    res.json({

      message: `${admin.role} restored successfully`,

      restoredAdmin: admin.name || admin.username

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * POST /archive/restore/users/:id

 * Restore an archived user (Super Admin only)

 */

router.post('/archive/restore/users/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }



    if (!user.deletedAt) {

      return res.status(400).json({ message: 'This user is not archived' });

    }



    // Restore - clear deletedAt and deletedBy

    user.deletedAt = null;

    user.deletedBy = null;

    user.tradingStatus = 'ACTIVE';

    user.isActive = true;

    await user.save();



    res.json({

      message: 'User restored successfully',

      restoredUser: user.username || user.email

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * DELETE /archive/permanent/admins/:id

 * Permanently delete an archived admin (Super Admin only)

 */

router.delete('/archive/permanent/admins/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    if (!admin.deletedAt) {

      return res.status(400).json({ message: 'This admin is not archived. Use regular delete first.' });

    }



    if (admin.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Cannot delete Super Admin' });

    }



    // Delete all subordinate admins (if any)

    const subordinateAdmins = await Admin.find({

      hierarchyPath: admin._id,

      deletedAt: { $ne: null }

    });



    const adminIds = [admin._id, ...subordinateAdmins.map(a => a._id)];



    // Delete all users under these admins

    const deletedUsersResult = await User.deleteMany({

      admin: { $in: adminIds },

      deletedAt: { $ne: null }

    });



    // Delete trading data

    try {

      await Trade.deleteMany({ admin: { $in: adminIds } });

      await Position.deleteMany({ admin: { $in: adminIds } });

    } catch (err) {

      console.log('Error deleting trades/positions:', err.message);

    }



    // Delete all subordinate admins

    await Admin.deleteMany({

      hierarchyPath: admin._id,

      deletedAt: { $ne: null }

    });



    // Delete the admin itself

    await Admin.findByIdAndDelete(admin._id);



    res.json({

      message: `${admin.role} permanently deleted from archive`,

      deletedAdmin: admin.name || admin.username,

      deletedSubordinates: subordinateAdmins.length,

      deletedUsers: deletedUsersResult.deletedCount

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ============================================================================

// EXTRA CHARGES MANAGEMENT

// ============================================================================



/**

 * POST /admins/:fromId/transfer-all-hierarchy

 * Move EXTERNAL admin’s subtree (brokers, sub-brokers, users) under INTERNAL ADMIN.

 */

router.post('/admins/:id/transfer-all-hierarchy', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { toAdminId } = req.body;

    if (!toAdminId) {

      return res.status(400).json({ message: 'toAdminId (INTERNAL office ADMIN) is required' });

    }

    const summary = await transferExternalAdminSubtreeToInternalAdmin({

      fromAdminId: req.params.id,

      toAdminId,

    });

    res.json({

      message: `Transferred ${summary.movedBrokers} broker(s), ${summary.movedSubBrokers} sub-broker(s), ${summary.movedUsers} user(s) to ${summary.toAdmin.username || summary.toAdmin.adminCode}`,

      ...summary,

    });

  } catch (error) {

    const msg = error?.message || 'Transfer failed';

    const status = msg.includes('not found') ? 404 : 400;

    res.status(status).json({ message: msg });

  }

});



/**

 * POST /admins/:id/take-brokerage

 * Take brokerage from admin (Super Admin only)

 */

router.post('/admins/:id/take-brokerage', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    if (targetAdmin.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Cannot take brokerage from Super Admin' });

    }



    if (targetAdmin.role === 'ADMIN' && resolveOfficePartnerType(targetAdmin) === 'INTERNAL') {

      return res.status(403).json({

        message: 'INTERNAL office admins use Give Incentive, not Take Brokerage.',

      });

    }



    const { amount, description } = req.body;

    const result = await takeBrokerageFromAdminMainWallet(
      targetAdmin,
      req.admin,
      amount,
      description,
      { franchiseCharge: !!targetAdmin.isFranchiseRoot }
    );



    res.json({

      message: `Successfully took ${result.amount} from ${targetAdmin.name || targetAdmin.username} main wallet`,

      amount: result.amount,

      adminBalance: result.adminMainBalance,

      walletSource: 'main',

    });

  } catch (error) {

    const code = error.statusCode || 500;

    res.status(code).json({ message: error.message });

  }

});



/**

 * POST /admins/:id/give-incentive

 * Give incentive to admin (Super Admin only)

 */

router.post('/admins/:id/give-incentive', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const targetAdmin = await Admin.findById(req.params.id);

    if (!targetAdmin) {

      return res.status(404).json({ message: 'Admin not found' });

    }



    if (targetAdmin.role === 'SUPER_ADMIN') {

      return res.status(403).json({ message: 'Cannot give incentive to Super Admin' });

    }



    if (targetAdmin.role !== 'ADMIN') {

      return res.status(403).json({

        message: 'Give Incentive applies only to ADMIN accounts marked INTERNAL (office).',

      });

    }

    if (resolveOfficePartnerType(targetAdmin) !== 'INTERNAL') {

      return res.status(403).json({

        message:

          'Give Incentive is only for INTERNAL (office) admins. EXTERNAL admins use Take Brokerage, or Transfer all hierarchy to an INTERNAL admin.',

      });

    }



    const { amount, description } = req.body;

    /** Omitted ⇒ split between main wallet (trading) and temporary wallet (games); pass `trading` or `games` to credit one side only. */

    const scopeRaw = String(req.body.incentiveScope || 'games_and_trading').trim().toLowerCase();

    const INCENTIVE_SCOPES = new Set(['trading', 'games', 'games_and_trading']);

    const incentiveScope = INCENTIVE_SCOPES.has(scopeRaw) ? scopeRaw : 'trading';

    const incentiveScopeLabels = {

      trading: 'Trading',

      games: 'Games',

      games_and_trading: 'Games & trading',

    };

    const scopeTag = ` [${incentiveScopeLabels[incentiveScope]} incentive]`;



    const amtNum = typeof amount === 'number' ? amount : parseFloat(String(amount));

    if (!Number.isFinite(amtNum) || amtNum <= 0) {

      return res.status(400).json({ message: 'Please enter a valid amount' });

    }



    /** Split  into main (trading) vs temporary (games) wallet halves; remainder on trading. */

    const splitGamesAndTrading = (total) => {

      const t = Math.round(Number(total) * 100) / 100;

      const games = Math.floor((t * 100) / 2) / 100;

      const trading = Math.round((t - games) * 100) / 100;

      return { trading, games };

    };



    let tradingCredit = 0;

    let gamesCredit = 0;

    if (incentiveScope === 'trading') tradingCredit = amtNum;

    else if (incentiveScope === 'games') gamesCredit = amtNum;

    else {

      const parts = splitGamesAndTrading(amtNum);

      tradingCredit = parts.trading;

      gamesCredit = parts.games;

    }



    const superBal = Number(req.admin.wallet?.balance) || 0;

    if (superBal < amtNum) {

      return res.status(400).json({ message: `Insufficient wallet balance. Current balance: ${superBal}` });

    }



    req.admin.wallet.balance = superBal - amtNum;

    await req.admin.save();



    await WalletLedger.create({

      ownerId: req.admin._id,

      ownerType: 'ADMIN',

      adminCode: req.admin.adminCode,

      type: 'DEBIT',

      reason: 'ADJUSTMENT',

      amount: amtNum,

      balanceAfter: req.admin.wallet.balance,

      description: `Incentive given to ${targetAdmin.name || targetAdmin.username}${scopeTag}`,

      category: 'EXTRA_CHARGE',

      relatedTo: targetAdmin._id,

      relatedToType: 'ADMIN',

      performedBy: req.admin._id,

      meta: { incentiveScope },

    });



    const baseCreditDesc = `${description?.trim() || 'Incentive given by Super Admin'}${scopeTag}`;



    if (tradingCredit > 0) {

      const newMain = (Number(targetAdmin.wallet?.balance) || 0) + tradingCredit;

      targetAdmin.wallet.balance = newMain;

      await targetAdmin.save();

      const descMain =

        incentiveScope === 'games_and_trading'

          ? `${baseCreditDesc} (main/trading wallet)`

          : baseCreditDesc;

      await WalletLedger.create({

        ownerType: 'ADMIN',

        ownerId: targetAdmin._id,

        adminCode: targetAdmin.adminCode,

        type: 'CREDIT',

        reason: 'ADJUSTMENT',

        amount: tradingCredit,

        balanceAfter: newMain,

        description: descMain,

        category: 'EXTRA_CHARGE',

        relatedTo: req.admin._id,

        relatedToType: 'ADMIN',

        performedBy: req.admin._id,

        meta: { incentiveScope, incentiveWallet: 'main' },

      });

    }



    if (gamesCredit > 0) {

      targetAdmin.temporaryWallet.balance =

        (Number(targetAdmin.temporaryWallet?.balance) || 0) + gamesCredit;

      targetAdmin.temporaryWallet.totalEarned =

        (Number(targetAdmin.temporaryWallet?.totalEarned) || 0) + gamesCredit;

      await targetAdmin.save();

      const twBal = Number(targetAdmin.temporaryWallet.balance) || 0;

      const descGames =

        incentiveScope === 'games_and_trading'

          ? `${baseCreditDesc} [Temporary Wallet] (games share)`

          : `${baseCreditDesc} [Temporary Wallet]`;

      await WalletLedger.create({

        ownerType: 'ADMIN',

        ownerId: targetAdmin._id,

        adminCode: targetAdmin.adminCode,

        type: 'CREDIT',

        reason: 'ADJUSTMENT',

        amount: gamesCredit,

        balanceAfter: twBal,

        description: descGames,

        category: 'EXTRA_CHARGE',

        relatedTo: req.admin._id,

        relatedToType: 'ADMIN',

        performedBy: req.admin._id,

        meta: { incentiveScope, incentiveWallet: 'temporary' },

      });

    }



    res.json({

      message: `Successfully gave ${amtNum} incentive to ${targetAdmin.name || targetAdmin.username}`,

      amount: amtNum,

      adminBalance: targetAdmin.wallet.balance,

      adminTemporaryWalletBalance: targetAdmin.temporaryWallet.balance,

      incentiveScope,

      creditsTo: { trading: tradingCredit, games: gamesCredit },

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/**

 * DELETE /archive/permanent/users/:id

 * Permanently delete an archived user (Super Admin only)

 */

router.delete('/archive/permanent/users/:id', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const user = await User.findById(req.params.id);

    if (!user) {

      return res.status(404).json({ message: 'User not found' });

    }



    if (!user.deletedAt) {

      return res.status(400).json({ message: 'This user is not archived. Use regular delete first.' });

    }



    // Credit remaining balance to Super Admin before deletion

    const remainingBalance = user.wallet?.balance || 0;

    if (remainingBalance > 0) {

      // Add to Super Admin's wallet

      req.admin.wallet += remainingBalance;

      await req.admin.save();



      // Add to Super Admin's wallet ledger

      const superAdminLedgerEntry = new WalletLedger({

        ownerId: req.admin._id,

        ownerType: 'ADMIN',

        adminCode: req.admin.adminCode,

        type: 'CREDIT',

        amount: remainingBalance,

        balanceAfter: req.admin.wallet,

        description: `Remaining balance from permanently deleted user: ${user.username || user.email}`,

        category: 'USER_DELETION',

        relatedTo: user._id,

        relatedToType: 'USER'

      });

      await superAdminLedgerEntry.save();

    }



    // Delete user's trading data

    try {

      await Trade.deleteMany({ user: user._id });

      await Position.deleteMany({ user: user._id });

    } catch (err) {

      console.log('Error deleting user trades/positions:', err.message);

    }



    // Delete wallet ledger entries

    try {

      await WalletLedger.deleteMany({ ownerId: user._id, ownerType: 'USER' });

    } catch (err) {

      console.log('Error deleting wallet ledger:', err.message);

    }



    // Delete fund requests

    try {

      await FundRequest.deleteMany({ user: user._id });

    } catch (err) {

      console.log('Error deleting fund requests:', err.message);

    }



    // Delete the user

    await User.findByIdAndDelete(user._id);



    res.json({

      message: remainingBalance > 0 

        ? `User permanently deleted. ${remainingBalance} credited to Super Admin.`

        : 'User permanently deleted from archive',

      deletedUser: user.username || user.email,

      creditedAmount: remainingBalance

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== NIFTY NUMBER GAME (Admin) ====================



// Get all Nifty Number bets for a date

router.get('/nifty-number/bets', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date } = req.query;

    const filter = date ? { betDate: date } : {};

    const bets = await NiftyNumberBet.find(filter)

      .populate('user', 'name email username userId')

      .populate('admin', 'name adminCode')

      .sort({ createdAt: -1 })

      .limit(200);



    const stats = {

      totalBets: bets.length,

      totalAmount: bets.reduce((s, b) => s + b.amount, 0),

      pending: bets.filter(b => b.status === 'pending').length,

      won: bets.filter(b => b.status === 'won').length,

      lost: bets.filter(b => b.status === 'lost').length,

    };



    res.json({ bets, stats });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



/** Super-admin testing: settle active bracket trades at a manual Nifty price (e.g. 3:30 PM close). */

router.post('/nifty-bracket/manual-settle', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { currentPrice, tradeId, forceMidRangeAsExpired = true } = req.body;

    const price = parseFloat(currentPrice);

    if (!Number.isFinite(price) || price <= 0) {

      return res.status(400).json({ message: 'Valid currentPrice (Nifty LTP) is required' });

    }



    const filter = { status: 'active' };

    if (tradeId) filter._id = tradeId;



    const trades = await NiftyBracketTrade.find(filter);

    if (trades.length === 0) {

      return res.status(400).json({ message: 'No active Nifty Bracket trades found' });

    }



    const results = [];

    for (const t of trades) {

      try {

        const out = await resolveNiftyBracketTrade(t, price, {

          forceMidRangeAsExpired: !!forceMidRangeAsExpired,

          bypassSettlementTime: true,

        });

        results.push({

          tradeId: t._id,

          ok: true,

          status: out.trade.status,

          message: out.message,

        });

      } catch (e) {

        results.push({

          tradeId: t._id,

          ok: false,

          message: e.message,

        });

      }

    }



    const okCount = results.filter((r) => r.ok).length;

    res.json({

      message: `Settled ${okCount} of ${results.length} active trade(s) at ${price}`,

      currentPrice: price,

      forceMidRangeAsExpired: !!forceMidRangeAsExpired,

      results,

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Declare Nifty Number result for a date

router.post('/nifty-number/declare-result', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date, resultNumber, closingPrice } = req.body;

    if (!date) {

      return res.status(400).json({ message: 'Date is required' });

    }

    const out = await declareNiftyNumberResultForDate({ date, resultNumber, closingPrice });

    res.json(out);

  } catch (error) {

    res.status(400).json({ message: error.message });

  }

});



// ==================== BTC NUMBER GAME (Admin) ====================



router.get('/btc-number/bets', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date } = req.query;

    const filter = date ? { betDate: date } : {};

    const bets = await BtcNumberBet.find(filter)

      .populate('user', 'name email username userId')

      .populate('admin', 'name adminCode')

      .sort({ createdAt: -1 })

      .limit(200);



    const stats = {

      totalBets: bets.length,

      totalAmount: bets.reduce((s, b) => s + b.amount, 0),

      pending: bets.filter((b) => b.status === 'pending').length,

      won: bets.filter((b) => b.status === 'won').length,

      lost: bets.filter((b) => b.status === 'lost').length,

    };



    res.json({ bets, stats });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



router.post('/btc-number/declare-result', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date, resultNumber, closingPrice } = req.body;

    if (!date) {

      return res.status(400).json({ message: 'Date is required' });

    }

    const out = await declareBtcNumberResultForDate({ date, resultNumber, closingPrice });

    res.json(out);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Get Nifty Jackpot bids for a date (admin view)

router.get('/nifty-jackpot/bids', protectAdmin, async (req, res) => {

  try {

    const { date } = req.query;

    if (!date) return res.status(400).json({ message: 'Date is required' });



    const rawBids = await NiftyJackpotBid.find(buildNiftyJackpotIstDayQuery(date)).populate(

      'user',

      'name username phone'

    );

    const lockedDoc = await NiftyJackpotResult.findOne({ resultDate: date }).lean();

    const lockedNum =

      lockedDoc?.lockedPrice != null && Number.isFinite(Number(lockedDoc.lockedPrice))

        ? Number(lockedDoc.lockedPrice)

        : null;

    const resultDeclared = !!lockedDoc?.resultDeclared;

    const refPrice =

      resultDeclared && lockedNum != null && lockedNum > 0

        ? lockedNum

        : await resolveNiftyJackpotSpotPrice();

    const bids = sortJackpotBidsByDistanceToReference(rawBids, refPrice);



    const settings = await GameSettings.getSettings();

    const gc = settings.games?.niftyJackpot;

    const topWinners = gc?.topWinners || 20;

    const totalPool = bids.reduce((s, b) => s + (Number(b.amount) || 0), 0);



    const refOk = Number.isFinite(Number(refPrice)) && Number(refPrice) > 0;



    res.json({

      date,

      referencePrice: refOk ? Number(refPrice) : null,

      lockedPrice: lockedNum != null && lockedNum > 0 ? lockedNum : null,

      resultDeclared,

      rankingMode: resultDeclared && lockedNum != null ? 'nearest_locked_close' : 'nearest_spot',

      totalBids: bids.length,

      totalPool,

      topWinners,

      bids: bids.map((b, idx) => {

        const rank = idx + 1;

        // Always calculate prize percentages and amounts for all ranks 1-20 for admin display

        const prizePercent = rank <= 20 ? resolveJackpotPrizePercentForRank(rank, gc) : 0;

        const prize = rank <= 20 ? Math.round(totalPool * prizePercent / 100) : 0;

        const dist =

          refOk && b.niftyPriceAtBid != null && Number.isFinite(Number(b.niftyPriceAtBid))

            ? Math.abs(Number(b.niftyPriceAtBid) - Number(refPrice))

            : null;

        return {

          _id: b._id,

          user: {

            _id: b.user?._id,

            name: b.user?.name,

            username: b.user?.username,

            phone: b.user?.phone,

          },

          amount: b.amount,

          tickets: b.ticketCount ?? 1,

          rank,

          niftyPriceAtBid: b.niftyPriceAtBid ?? null,

          distanceToReference: dist,

          bidPlacedAt: b.createdAt || null,

          prizePercent,

          prize,

          status: b.status,

        };

      })

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Lock Nifty price for Jackpot (admin captures current market price; optional manualPrice for API/legacy)

router.post('/nifty-jackpot/lock-price', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date, manualPrice } = req.body;

    if (!date) return res.status(400).json({ message: 'Date is required' });



    // Check if already locked for this date

    const existing = await NiftyJackpotResult.findOne({ resultDate: date });

    if (existing) {

      return res.status(400).json({ message: `Price already locked for ${date}: ${existing.lockedPrice}` });

    }



    let lockedPrice = null;



    if (manualPrice && parseFloat(manualPrice) > 0) {

      // Admin manually entered a price

      lockedPrice = parseFloat(manualPrice);

    } else {

      // Try to get live Nifty price from Zerodha market data

      const allMarketData = getMarketData();

      // Kite instrument_token for NIFTY 50; legacy cache key 99926000 still mirrored from WebSocket

      const niftyData = allMarketData['256265'] || allMarketData['99926000'];

      if (niftyData && niftyData.ltp) {

        lockedPrice = niftyData.ltp;

      } else {

        const niftyBySymbol = Object.values(allMarketData).find(

          (d) => d.symbol === 'NIFTY 50' || d.symbol === 'NIFTY'

        );

        if (niftyBySymbol && niftyBySymbol.ltp) {

          lockedPrice = niftyBySymbol.ltp;

        }

      }

    }



    if (!lockedPrice) {

      return res.status(400).json({ message: 'Could not fetch Nifty price. Ensure Zerodha is connected and NIFTY 50 market data is available.' });

    }



    const result = await NiftyJackpotResult.create({

      resultDate: date,

      lockedPrice,

      lockedAt: new Date(),

      lockedBy: req.admin._id

    });



    res.json({

      message: `Nifty price locked at ${lockedPrice} for ${date}`,

      result: {

        resultDate: result.resultDate,

        lockedPrice: result.lockedPrice,

        lockedAt: result.lockedAt

      }

    });

  } catch (error) {

    if (error.code === 11000) {

      return res.status(400).json({ message: 'Price already locked for this date' });

    }

    console.error('Lock price error:', error);

    res.status(500).json({ message: error.message });

  }

});



// Get locked price for a date (admin)

router.get('/nifty-jackpot/locked-price', protectAdmin, async (req, res) => {

  try {

    const { date } = req.query;

    if (!date) return res.status(400).json({ message: 'Date is required' });



    const result = await NiftyJackpotResult.findOne({ resultDate: date });

    res.json({

      date,

      locked: !!result,

      lockedPrice: result?.lockedPrice || null,

      lockedAt: result?.lockedAt || null,

      resultDeclared: result?.resultDeclared || false

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Declare Nifty Jackpot result for a date

router.post('/nifty-jackpot/declare-result', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { date } = req.body;

    if (!date) return res.status(400).json({ message: 'Date is required' });



    const out = await declareNiftyJackpotResult(date);

    res.json({

      message: `Jackpot result declared for ${out.date}`,

      date: out.date,

      lockedPrice: out.closingPrice,

      rankingMode: 'nearest_close',

      summary: out.summary,

    });

  } catch (error) {

    if (error instanceof NiftyJackpotDeclareError) {

      return res.status(error.statusCode).json({ message: error.message });

    }

    res.status(500).json({ message: error.message });

  }

});



// ==================== ALL ACCOUNTS OVERVIEW (SUPER ADMIN ONLY) ====================

// Get complete hierarchy overview - all admins, brokers, sub-brokers, and users

router.get('/all-accounts-overview', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    // Get all admins (ADMIN, BROKER, SUB_BROKER)

    const allAdmins = await Admin.find({ role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] } })

      .select('-password -pin')

      .populate('parentId', 'name adminCode role')

      .sort({ role: 1, createdAt: -1 });

    

    // Get all users

    const allUsers = await User.find({})

      .select('username name email phone isActive wallet adminCode admin createdAt')

      .populate('admin', 'name adminCode role')

      .sort({ createdAt: -1 });

    

    // Calculate stats

    const stats = {

      totalAdmins: allAdmins.filter(a => a.role === 'ADMIN').length,

      totalBrokers: allAdmins.filter(a => a.role === 'BROKER').length,

      totalSubBrokers: allAdmins.filter(a => a.role === 'SUB_BROKER').length,

      totalUsers: allUsers.length,

      activeUsers: allUsers.filter(u => u.isActive).length,

      inactiveUsers: allUsers.filter(u => !u.isActive).length,

      totalWalletBalance: allUsers.reduce((sum, u) => sum + (u.wallet?.balance || 0), 0)

    };

    

    // Build hierarchy tree

    const adminsWithUsers = await Promise.all(allAdmins.map(async (admin) => {

      const userCount = await User.countDocuments({ admin: admin._id });

      const activeUserCount = await User.countDocuments({ admin: admin._id, isActive: true });

      const subordinateCount = await Admin.countDocuments({ parentId: admin._id });

      

      return {

        ...admin.toObject(),

        userCount,

        activeUserCount,

        subordinateCount

      };

    }));

    

    res.json({

      stats,

      admins: adminsWithUsers,

      users: allUsers,

      hierarchy: {

        admins: adminsWithUsers.filter(a => a.role === 'ADMIN'),

        brokers: adminsWithUsers.filter(a => a.role === 'BROKER'),

        subBrokers: adminsWithUsers.filter(a => a.role === 'SUB_BROKER')

      }

    });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// Search across all accounts (Super Admin only)

router.get('/search-all-accounts', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { q } = req.query;

    if (!q || q.length < 2) {

      return res.json({ admins: [], users: [] });

    }

    

    const searchRegex = new RegExp(q, 'i');

    

    // Search admins

    const admins = await Admin.find({

      role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] },

      $or: [

        { name: searchRegex },

        { username: searchRegex },

        { email: searchRegex },

        { adminCode: searchRegex },

        { phone: searchRegex }

      ]

    })

    .select('-password -pin')

    .populate('parentId', 'name adminCode role')

    .limit(20);

    

    // Search users

    const users = await User.find({

      $or: [

        { name: searchRegex },

        { username: searchRegex },

        { email: searchRegex },

        { phone: searchRegex }

      ]

    })

    .select('username name email phone isActive wallet adminCode admin createdAt')

    .populate('admin', 'name adminCode role')

    .limit(20);

    

    res.json({ admins, users });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

});



// ==================== TEMPORARY WALLET MANAGEMENT ====================



// Get all hierarchy temporary wallets (Super Admin only)

router.get('/hierarchy-temporary-wallets', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { month } = req.query;

    

    // Build query for admins with temporary wallet balance

    const query = {

      role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] }

    };

    

    // Get all admins with their temporary wallet data

    const admins = await Admin.find(query)

      .select('adminCode username role temporaryWallet')

      .sort({ role: 1, adminCode: 1 })

      .lean();

    

    // Filter by month if provided (based on lastReleasedAt or totalEarned > 0)

    let filteredAdmins = admins;

    if (month) {

      const [year, monthNum] = month.split('-');

      const startDate = new Date(year, monthNum - 1, 1);

      const endDate = new Date(year, monthNum, 0, 23, 59, 59);

      

      // For now, just return all admins with temporary wallet data

      // In future, you could filter based on transaction dates

      filteredAdmins = admins.filter(admin => 

        admin.temporaryWallet?.totalEarned > 0 ||

        admin.temporaryWallet?.balance > 0

      );

    }

    

    res.json(filteredAdmins);

  } catch (error) {

    console.error('Error fetching hierarchy temporary wallets:', error);

    res.status(500).json({ message: error.message });

  }

});



// Release temporary wallet funds to main wallet (Super Admin only)

router.post('/release-temporary-funds', protectAdmin, superAdminOnly, async (req, res) => {

  try {

    const { adminId, amount } = req.body;

    

    if (!adminId || !amount || amount <= 0) {

      return res.status(400).json({ message: 'Invalid admin ID or amount' });

    }

    

    // Get the admin

    const admin = await Admin.findById(adminId);

    if (!admin) {

      return res.status(404).json({ message: 'Admin not found' });

    }

    

    // Check if admin has sufficient temporary wallet balance

    const tempBalance = admin.temporaryWallet?.balance || 0;

    if (amount > tempBalance) {

      return res.status(400).json({ message: 'Insufficient temporary wallet balance' });

    }

    

    // Deduct from temporary wallet

    admin.temporaryWallet.balance -= amount;

    admin.temporaryWallet.totalReleased = (admin.temporaryWallet.totalReleased || 0) + amount;

    admin.temporaryWallet.lastReleasedAt = new Date();

    

    // Credit to main wallet

    admin.wallet.balance = (admin.wallet.balance || 0) + amount;

    

    await admin.save();

    

    // Create ledger entries

    // 1. Debit from temporary wallet

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: admin._id,

      adminCode: admin.adminCode,

      type: 'DEBIT',

      reason: 'TEMP_WALLET_RELEASE',

      amount: amount,

      balanceAfter: admin.temporaryWallet.balance,

      description: `Temporary wallet funds released to main wallet by SuperAdmin`,

      performedBy: req.admin._id

    });

    

    // 2. Credit to main wallet

    await WalletLedger.create({

      ownerType: 'ADMIN',

      ownerId: admin._id,

      adminCode: admin.adminCode,

      type: 'CREDIT',

      reason: 'TEMP_WALLET_RELEASE',

      amount: amount,

      balanceAfter: admin.wallet.balance,

      description: `Funds released from temporary wallet by SuperAdmin`,

      performedBy: req.admin._id

    });

    

    res.json({ 

      message: 'Funds released successfully',

      admin: {

        adminCode: admin.adminCode,

        username: admin.username,

        temporaryWallet: admin.temporaryWallet,

        wallet: admin.wallet

      }

    });

  } catch (error) {

    console.error('Error releasing temporary funds:', error);

    res.status(500).json({ message: error.message });

  }

});



// Use brokerage restriction routes

router.use('/brokerage-restriction', brokerageRestrictionRoutes);



// Use referral eligibility routes

router.use('/referral-eligibility', referralEligibilityRoutes);



router.use('/segment-grouping', segmentGroupingRoutes);



export default router;

