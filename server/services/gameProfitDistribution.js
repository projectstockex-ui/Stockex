import Admin from '../models/Admin.js';
import User from '../models/User.js';
import WalletLedger from '../models/WalletLedger.js';
import GameSettings from '../models/GameSettings.js';
import { atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import { debitBtcUpDownSuperAdminPool } from '../utils/btcUpDownSuperAdminPool.js';
import { adminReceivesHierarchyBrokerage } from '../utils/adminBrokerageEligibility.js';
import { 
  processConditionalReferralPayout 
} from './referralPayoutService.js';
import { 
  trackHierarchyEarnings 
} from './superAdminEarningsService.js';

/**
 * NOTE: Franchise root logic is not applicable for games - games profit/loss always goes to Super Admin
 * This function is kept for reference but not used in games distribution
 */
function findFranchiseRootInChain(hierarchyChain) {
  // Always return null for games - franchise root only applies to trading
  return null;
}

/** Ledger meta: your % of the distribution base (user loss pool, win-side brokerage, or gross fee). */
function gameProfitLedgerMeta(shareAmount, baseAmount, profitKind, gameKey, transactionId = null, userId = null) {
  const gk = gameKey && typeof gameKey === 'string' ? gameKey : undefined;
  const s = Number(shareAmount);
  const b = Number(baseAmount);
  const meta = { profitKind, gameKey: gk };
  
  if (transactionId) {
    meta.transactionId = transactionId;
  }
  
  if (userId) {
    meta.relatedUserId = userId;
  }
  
  if (!Number.isFinite(s) || !Number.isFinite(b) || b === 0) {
    return meta;
  }
  const sharePercent = parseFloat(((s / b) * 100).toFixed(2));
  return { ...meta, sharePercent, baseAmount: parseFloat(b.toFixed(2)) };
}

/** @see gameProfitLedgerMeta — exported for custom game flows (e.g. BTC Jackpot hierarchy) that still need Share % in admin wallet ledger. */
export { gameProfitLedgerMeta as buildGameProfitLedgerMeta };

/**
 * Splits a **base amount** through the user’s admin hierarchy using `profit*Percent` from GameSettings
 * (same cascade as win-side: SubBroker → Broker → Admin → SuperAdmin remainder).
 *
 * **Do not use for end-user *loss* stakes in games** — games hierarchy/brokerage is funded from the
 * **win** side only (`distributeWinBrokerage`, `creditNiftyJackpotGrossHierarchyFromPool`, etc.). Calling
 * this on a losing bet incorrectly mints GAME_PROFIT-style hierarchy from the loss pool; production
 * game paths must not do that. Keep this only for non-game or legacy call sites you explicitly own.
 *
 * @param {Object} user       - The user document (must have hierarchyPath, admin, adminCode)
 * @param {Number} amount     - Total amount to split (not “user loss” in games; see note above)
 * @param {String} gameName   - Game identifier for logging (e.g. 'NiftyUpDown', 'NiftyNumber')
 * @param {String} refId      - Optional reference ID (bet/trade ID)
 * @param {String} gameKey    - Game settings key (e.g. 'niftyUpDown', 'niftyNumber') for per-game percentages
 * @returns {Object}          - Distribution summary { distributions, totalDistributed }
 */
export async function distributeGameProfit(user, amount, gameName, refId, gameKey) {
  if (!user || amount <= 0) return { distributions: {}, totalDistributed: 0 };
  if (user.isDemo || user.settings?.isDemo) {
    console.log(`[GameProfit] Skipped — demo user ${user.userId || user._id}`);
    return { distributions: {}, totalDistributed: 0 };
  }

  try {
    // Get per-game profit distribution percentages, fallback to global
    const settings = await GameSettings.getSettings();
    const gameConfig = gameKey ? settings.games?.[gameKey] : null;
    const globalDist = settings.profitDistribution || {};

    const subBrokerPercent = gameConfig?.profitSubBrokerPercent ?? globalDist.subBrokerPercent ?? 10;
    const brokerPercent = gameConfig?.profitBrokerPercent ?? globalDist.brokerPercent ?? 20;
    const adminPercent = gameConfig?.profitAdminPercent ?? globalDist.adminPercent ?? 30;
    // Option: If SubBroker not available, should their share go to Broker? (default: true)
    const subBrokerShareToBroker = gameConfig?.subBrokerShareToBroker ?? true;
    // SuperAdmin gets the remainder (100 - admin - broker - subBroker)

    // Build hierarchy chain from user's direct admin up to SuperAdmin
    const hierarchyChain = [];
    let currentAdmin = null;

    // Start with user's direct admin
    if (user.admin) {
      currentAdmin = await Admin.findById(user.admin).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    } else if (user.adminCode) {
      currentAdmin = await Admin.findOne({ adminCode: user.adminCode, status: 'ACTIVE' }).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    }

    while (currentAdmin) {
      hierarchyChain.push({
        admin: currentAdmin,
        role: currentAdmin.role
      });

      if (currentAdmin.role === 'SUPER_ADMIN' || !currentAdmin.parentId) {
        break;
      }

      currentAdmin = await Admin.findById(currentAdmin.parentId).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    }

    // If no hierarchy found, nothing to distribute
    if (hierarchyChain.length === 0) {
      console.log(`[GameProfit] No hierarchy found for user ${user.userId || user._id}, skipping distribution`);
      return { distributions: {}, totalDistributed: 0 };
    }

    // Determine which roles exist in hierarchy
    const hasSubBroker = hierarchyChain.some(h => h.role === 'SUB_BROKER');
    const hasBroker = hierarchyChain.some(h => h.role === 'BROKER');
    const hasAdmin = hierarchyChain.some(h => h.role === 'ADMIN');
    const hasSuperAdmin = hierarchyChain.some(h => h.role === 'SUPER_ADMIN');

    // Calculate shares with cascading logic
    let sbShare = subBrokerPercent;
    let brShare = brokerPercent;
    let adShare = adminPercent;
    let saShare = Math.max(0, 100 - adminPercent - brokerPercent - subBrokerPercent);

    // If no SubBroker, their share goes to Broker (if enabled) or next up
    if (!hasSubBroker) {
      if (subBrokerShareToBroker && hasBroker) {
        // SubBroker share goes to Broker (configurable option)
        brShare += sbShare;
      } else if (hasAdmin) {
        // If option disabled or no broker, share goes to Admin
        adShare += sbShare;
      } else {
        // Otherwise goes to SuperAdmin
        saShare += sbShare;
      }
      sbShare = 0;
    }

    // If no Broker, their share goes to Admin (or next up)
    if (!hasBroker) {
      if (hasAdmin) {
        adShare += brShare;
      } else {
        saShare += brShare;
      }
      brShare = 0;
    }

    // If no Admin, their share goes to SuperAdmin
    if (!hasAdmin) {
      saShare += adShare;
      adShare = 0;
    }

    // Build distribution map
    const distributions = {};
    if (hasSubBroker && sbShare > 0) distributions.SUB_BROKER = parseFloat((amount * sbShare / 100).toFixed(2));
    if (hasBroker && brShare > 0) distributions.BROKER = parseFloat((amount * brShare / 100).toFixed(2));
    if (hasAdmin && adShare > 0) distributions.ADMIN = parseFloat((amount * adShare / 100).toFixed(2));
    if (hasSuperAdmin && saShare > 0) distributions.SUPER_ADMIN = parseFloat((amount * saShare / 100).toFixed(2));

    // NOTE: Franchise root logic is not applicable for games
    // Games profit/loss always goes to Super Admin, franchise root only applies to trading
    
    // Credit each admin in hierarchy (one payout per role bucket — duplicate roles in chain must not double-pay)
    let totalDistributed = 0;
    const creditedProfitRoles = new Set();
    let divertedToSuperAdmin = 0;
    
    for (const { admin, role } of hierarchyChain) {
      const shareAmount = distributions[role] || 0;
      if (shareAmount <= 0) continue;
      if (creditedProfitRoles.has(role)) continue;
      creditedProfitRoles.add(role);

      if (!adminReceivesHierarchyBrokerage(admin, 'games')) {
        divertedToSuperAdmin += shareAmount;
        continue;
      }

      // NOTE: Franchise root logic is not applicable for games
      // Games profit/loss always goes to Super Admin, franchise root only applies to trading

      // Credit to temporary wallet instead of main wallet (except for SUPER_ADMIN)
      if (role === 'SUPER_ADMIN') {
        admin.wallet.balance += shareAmount;
        admin.stats.totalBrokerage = (admin.stats.totalBrokerage || 0) + shareAmount;
      } else {
        admin.temporaryWallet.balance = (admin.temporaryWallet.balance || 0) + shareAmount;
        admin.temporaryWallet.totalEarned = (admin.temporaryWallet.totalEarned || 0) + shareAmount;
      }
      await admin.save();

      // Create wallet ledger entry
      await WalletLedger.create({
        ownerType: 'ADMIN',
        ownerId: admin._id,
        adminCode: admin.adminCode,
        type: 'CREDIT',
        reason: 'GAME_PROFIT',
        amount: shareAmount,
        balanceAfter: role === 'SUPER_ADMIN' ? admin.wallet.balance : admin.temporaryWallet.balance,
        description: `${gameName} profit share - ${role} (${((shareAmount / amount) * 100).toFixed(1)}% of ${amount.toFixed(2)})${role !== 'SUPER_ADMIN' ? ' [Temporary Wallet]' : ''}`,
        reference: refId ? { type: 'Manual', id: null } : undefined,
        meta: gameProfitLedgerMeta(shareAmount, amount, 'USER_LOSS_POOL', gameKey, null, user._id),
      });

      totalDistributed += shareAmount;
    }

    // NOTE: Franchise root diversion is not applicable for games
    // Games profit/loss always goes to Super Admin, franchise root only applies to trading

    if (divertedToSuperAdmin > 0) {
      const saInChain = hierarchyChain.find((h) => h.role === 'SUPER_ADMIN')?.admin;
      const saDoc = saInChain
        ? await Admin.findById(saInChain._id)
        : await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (saDoc) {
        saDoc.wallet.balance = (saDoc.wallet.balance || 0) + divertedToSuperAdmin;
        saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + divertedToSuperAdmin;
        await saDoc.save();
        await WalletLedger.create({
          ownerType: 'ADMIN',
          ownerId: saDoc._id,
          adminCode: saDoc.adminCode,
          type: 'CREDIT',
          reason: 'GAME_PROFIT',
          amount: divertedToSuperAdmin,
          balanceAfter: saDoc.wallet.balance,
          description: `${gameName} profit — diverted from company employees (${divertedToSuperAdmin.toFixed(2)})`,
          reference: refId ? { type: 'Manual', id: null } : undefined,
          meta: gameProfitLedgerMeta(divertedToSuperAdmin, amount, 'USER_LOSS_POOL', gameKey, null, user._id),
        });
        totalDistributed += divertedToSuperAdmin;
      }
    }

    // Referrers are not paid from referred users' losses; SA keeps hierarchy share. (Stake/win referral rules only.)

    console.log(`[GameProfit] ${gameName}: Distributed ${totalDistributed.toFixed(2)} of ${amount.toFixed(2)} for user ${user.userId || user._id} | SA:${distributions.SUPER_ADMIN || 0} AD:${distributions.ADMIN || 0} BR:${distributions.BROKER || 0} SB:${distributions.SUB_BROKER || 0}`);

    return { distributions, totalDistributed };

  } catch (error) {
    console.error(`[GameProfit] Error distributing ${gameName} profit for user ${user.userId || user._id}:`, error);
    return { distributions: {}, totalDistributed: 0 };
  }
}

/**
 * Up/Down wins: split win-side brokerage () using per-game Brokerage Distribution percents.
 * — profitUserPercent → credited to user's games wallet
 * — profitSubBrokerPercent / profitBrokerPercent / profitAdminPercent + remainder → hierarchy (same cascade as distributeGameProfit)
 * Percents are of total brokerage (sum should be ≤ 100%; remainder → Super Admin share).
 *
 * @param {object} [options]
 * @param {boolean} [options.fundFromBtcPool=true] — If true, debit Super Admin BTC pool before split (BTC Up/Down). If false (e.g. Nifty Up/Down), skip pool debit; amounts are credited from the withheld win fee only.
 * @param {string} [options.ledgerGameId='btcupdown'] — gamesWallet ledger gameId for user rebate line
 * @param {boolean} [options.skipUserRebate=false] — If true, do not credit the user their profitUserPercent share of T (remainder goes to hierarchy via SA remainder). Use when the caller already credited full gross prize separately.
 */
export async function distributeWinBrokerage(userId, user, totalBrokerage, gameName, gameKey, options = {}) {
  const { fundFromBtcPool = true, ledgerGameId = 'btcupdown', skipUserRebate = false, transactionId = null } = options;
  const T = Number(totalBrokerage);
  if (!user || !userId || !Number.isFinite(T) || T <= 0) {
    return { userRebate: 0, distributions: {}, totalDistributed: 0 };
  }
  if (user.isDemo || user.settings?.isDemo) {
    console.log(`[WinBrokerage] Skipped — demo user ${user.userId || user._id}`);
    return { userRebate: 0, distributions: {}, totalDistributed: 0 };
  }

  try {
    if (fundFromBtcPool) {
      const poolMeta =
        ledgerGameId && userId
          ? {
              poolDebitKind: 'GAME_WIN_BROKERAGE_POOL_DEBIT',
              gameKey: ledgerGameId,
              relatedUserId: userId,
            }
          : null;
      const poolOut = await debitBtcUpDownSuperAdminPool(
        T,
        `${gameName} — release win brokerage for hierarchy / user split (−${T.toFixed(2)})`,
        poolMeta
      );
      if (!poolOut.ok) {
        console.error(`[WinBrokerage] Super Admin pool could not fund brokerage split (${T.toFixed(2)})`);
        return { userRebate: 0, distributions: {}, totalDistributed: 0, poolFunded: false };
      }
    }

    const settings = await GameSettings.getSettings();
    const gameConfig = gameKey ? settings.games?.[gameKey] : null;
    const globalDist = settings.profitDistribution || {};

    const clampPct = (v, def) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(100, Math.max(0, n));
    };
    const userShare = clampPct(gameConfig?.profitUserPercent ?? globalDist.userPercent ?? 0, 0);
    let sbShare = clampPct(gameConfig?.profitSubBrokerPercent ?? globalDist.subBrokerPercent ?? 10, 10);
    let brShare = clampPct(gameConfig?.profitBrokerPercent ?? globalDist.brokerPercent ?? 20, 20);
    let adShare = clampPct(gameConfig?.profitAdminPercent ?? globalDist.adminPercent ?? 30, 30);
    let saShare = Math.max(0, 100 - userShare - sbShare - brShare - adShare);
    const subBrokerShareToBroker = gameConfig?.subBrokerShareToBroker ?? true;

    const hierarchyChain = [];
    let currentAdmin = null;
    if (user.admin) {
      currentAdmin = await Admin.findById(user.admin).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    } else if (user.adminCode) {
      currentAdmin = await Admin.findOne({ adminCode: user.adminCode, status: 'ACTIVE' }).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    }
    
    console.log(`[WinBrokerage] Building hierarchy for user ${user.userId || user._id}, totalBrokerage: ${totalBrokerage}`);
    
    while (currentAdmin) {
      console.log(`[WinBrokerage] Adding to hierarchy: ${currentAdmin.username || currentAdmin.adminCode} (${currentAdmin.role}) - receivesHierarchyBrokerage: ${currentAdmin.receivesHierarchyBrokerage}, status: ${currentAdmin.status}`);
      hierarchyChain.push({ admin: currentAdmin, role: currentAdmin.role });
      if (currentAdmin.role === 'SUPER_ADMIN' || !currentAdmin.parentId) break;
      currentAdmin = await Admin.findById(currentAdmin.parentId).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
    }

    const hasSubBroker = hierarchyChain.some((h) => h.role === 'SUB_BROKER');
    const hasBroker = hierarchyChain.some((h) => h.role === 'BROKER');
    const hasAdmin = hierarchyChain.some((h) => h.role === 'ADMIN');
    const hasSuperAdmin = hierarchyChain.some((h) => h.role === 'SUPER_ADMIN');

    if (!hasSubBroker) {
      if (subBrokerShareToBroker && hasBroker) brShare += sbShare;
      else if (hasAdmin) adShare += sbShare;
      else saShare += sbShare;
      sbShare = 0;
    }
    if (!hasBroker) {
      if (hasAdmin) adShare += brShare;
      else saShare += brShare;
      brShare = 0;
    }
    if (!hasAdmin) {
      saShare += adShare;
      adShare = 0;
    }

    const userAmt = skipUserRebate
      ? 0
      : parseFloat(((T * userShare) / 100).toFixed(2));
    let sbAmt = parseFloat(((T * sbShare) / 100).toFixed(2));
    let brAmt = parseFloat(((T * brShare) / 100).toFixed(2));
    let adAmt = parseFloat(((T * adShare) / 100).toFixed(2));
    let saAmt = parseFloat((T - userAmt - sbAmt - brAmt - adAmt).toFixed(2));
    if (saAmt < 0) saAmt = 0;

    if (userAmt > 0) {
      const gw = await atomicGamesWalletUpdate(User, userId, { balance: userAmt });
      await recordGamesWalletLedger(userId, {
        gameId: ledgerGameId,
        entryType: 'credit',
        amount: userAmt,
        balanceAfter: gw.balance,
        description: `${gameName} — brokerage rebate (user share)`,
        meta: { brokerageRebate: true, userShare },
      });
    }

    const distributions = {};
    if (hasSubBroker && sbAmt > 0) distributions.SUB_BROKER = sbAmt;
    if (hasBroker && brAmt > 0) distributions.BROKER = brAmt;
    if (hasAdmin && adAmt > 0) distributions.ADMIN = adAmt;
    if (hasSuperAdmin && saAmt > 0) distributions.SUPER_ADMIN = saAmt;

    let totalDistributed = 0;
    const lumpNoChain = parseFloat((sbAmt + brAmt + adAmt + saAmt).toFixed(2));
    if (hierarchyChain.length === 0) {
      if (lumpNoChain > 0) {
        const saDoc = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
        if (saDoc) {
          saDoc.wallet.balance = (saDoc.wallet.balance || 0) + lumpNoChain;
          saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + lumpNoChain;
          await saDoc.save();
          await WalletLedger.create({
            ownerType: 'ADMIN',
            ownerId: saDoc._id,
            adminCode: saDoc.adminCode,
            type: 'CREDIT',
            reason: 'GAME_PROFIT',
            amount: lumpNoChain,
            balanceAfter: saDoc.wallet.balance,
            description: `${gameName} win brokerage (no user hierarchy → Super Admin)`,
            meta: gameProfitLedgerMeta(lumpNoChain, T, 'WIN_BROKERAGE', gameKey, transactionId, userId),
          });
          totalDistributed += lumpNoChain;
        }
      }
      console.log(
        `[WinBrokerage] ${gameName}: user rebate ${userAmt.toFixed(2)}, hierarchy ${totalDistributed.toFixed(2)} (no chain)`
      );
      return {
        userRebate: userAmt,
        distributions: lumpNoChain > 0 ? { SUPER_ADMIN: lumpNoChain } : {},
        totalDistributed,
      };
    }

    // NOTE: Franchise root logic is not applicable for games
    // Games profit/loss always goes to Super Admin, franchise root only applies to trading
    
    const creditedRolesWinBrk = new Set();
    let superAdminCreditedInChain = false;
    let divertedWinBrokerageToSuperAdmin = 0;
    
    console.log(`[WinBrokerage] Distribution breakdown: SUB_BROKER=${distributions.SUB_BROKER || 0}, BROKER=${distributions.BROKER || 0}, ADMIN=${distributions.ADMIN || 0}, SUPER_ADMIN=${distributions.SUPER_ADMIN || 0}`);
    
    for (const { admin, role } of hierarchyChain) {
      const shareAmount = distributions[role] || 0;
      console.log(`[WinBrokerage] Processing ${admin.username || admin.adminCode} (${role}): shareAmount=${shareAmount}, receivesHierarchyBrokerage=${admin.receivesHierarchyBrokerage}, status=${admin.status}`);
      
      if (shareAmount <= 0) {
        console.log(`[WinBrokerage] Skipping ${admin.username || admin.adminCode} - no share amount`);
        continue;
      }
      if (creditedRolesWinBrk.has(role)) {
        console.log(`[WinBrokerage] Skipping ${admin.username || admin.adminCode} - role ${role} already credited`);
        continue;
      }
      creditedRolesWinBrk.add(role);
      
      const isEligible = adminReceivesHierarchyBrokerage(admin);
      console.log(`[WinBrokerage] Eligibility check for ${admin.username || admin.adminCode}: ${isEligible}`);
      
      if (!isEligible) {
        console.log(`[WinBrokerage] Admin ${admin.username || admin.adminCode} (${role}) brokerage diverted to SuperAdmin: receivesHierarchyBrokerage=${admin.receivesHierarchyBrokerage}, status=${admin.status}, amount=${shareAmount.toFixed(2)}`);
        divertedWinBrokerageToSuperAdmin += shareAmount;
        continue;
      }
      
      // NOTE: Franchise root logic is not applicable for games
      // Games profit/loss always goes to Super Admin, franchise root only applies to trading
      
      console.log(`[WinBrokerage] CREDITING ${admin.username || admin.adminCode} (${role}): ${shareAmount.toFixed(2)} to TEMPORARY WALLET`);
      // Credit to temporary wallet instead of main wallet (except for SUPER_ADMIN)
      if (role === 'SUPER_ADMIN') {
        admin.wallet.balance = (admin.wallet.balance || 0) + shareAmount;
        admin.stats.totalBrokerage = (admin.stats.totalBrokerage || 0) + shareAmount;
      } else {
        admin.temporaryWallet.balance = (admin.temporaryWallet.balance || 0) + shareAmount;
        admin.temporaryWallet.totalEarned = (admin.temporaryWallet.totalEarned || 0) + shareAmount;
      }
      await admin.save();
      await WalletLedger.create({
        ownerType: 'ADMIN',
        ownerId: admin._id,
        adminCode: admin.adminCode,
        type: 'CREDIT',
        reason: 'GAME_PROFIT',
        amount: shareAmount,
        balanceAfter: role === 'SUPER_ADMIN' ? admin.wallet.balance : admin.temporaryWallet.balance,
        description: `${gameName} win brokerage — ${role} (${shareAmount.toFixed(2)})${role !== 'SUPER_ADMIN' ? ' [Temporary Wallet]' : ''}`,
        meta: gameProfitLedgerMeta(shareAmount, T, 'WIN_BROKERAGE', gameKey, transactionId, userId),
      });
      totalDistributed += shareAmount;
      if (role === 'SUPER_ADMIN') superAdminCreditedInChain = true;
    }

    // NOTE: Franchise root diversion is not applicable for games
    // Games profit/loss always goes to Super Admin, franchise root only applies to trading

    if (divertedWinBrokerageToSuperAdmin > 0) {
      const saInChain = hierarchyChain.find((h) => h.role === 'SUPER_ADMIN')?.admin;
      const saDoc =
        (saInChain && adminReceivesHierarchyBrokerage(saInChain)
          ? await Admin.findById(saInChain._id)
          : null) || (await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }));
      if (saDoc) {
        saDoc.wallet.balance = (saDoc.wallet.balance || 0) + divertedWinBrokerageToSuperAdmin;
        saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + divertedWinBrokerageToSuperAdmin;
        await saDoc.save();
        await WalletLedger.create({
          ownerType: 'ADMIN',
          ownerId: saDoc._id,
          adminCode: saDoc.adminCode,
          type: 'CREDIT',
          reason: 'GAME_PROFIT',
          amount: divertedWinBrokerageToSuperAdmin,
          balanceAfter: saDoc.wallet.balance,
          description: `${gameName} win brokerage — diverted from company employees (${divertedWinBrokerageToSuperAdmin.toFixed(2)})`,
          meta: gameProfitLedgerMeta(divertedWinBrokerageToSuperAdmin, T, 'WIN_BROKERAGE', gameKey, transactionId, userId),
        });
        totalDistributed += divertedWinBrokerageToSuperAdmin;
        if (String(saDoc.role) === 'SUPER_ADMIN') superAdminCreditedInChain = true;
      }
    }

    if (saAmt > 0 && !superAdminCreditedInChain) {
      const saDoc = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (saDoc) {
        saDoc.wallet.balance = (saDoc.wallet.balance || 0) + saAmt;
        saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + saAmt;
        await saDoc.save();
        await WalletLedger.create({
          ownerType: 'ADMIN',
          ownerId: saDoc._id,
          adminCode: saDoc.adminCode,
          type: 'CREDIT',
          reason: 'GAME_PROFIT',
          amount: saAmt,
          balanceAfter: saDoc.wallet.balance,
          description: `${gameName} win brokerage — Super Admin remainder (${saAmt.toFixed(2)})`,
          meta: gameProfitLedgerMeta(saAmt, T, 'WIN_BROKERAGE', gameKey, transactionId, userId),
        });
        totalDistributed += saAmt;
      }
    }

    // Transfer SuperAdmin's brokerage share to referral client if user was referred
    const totalSuperAdminShare = distributions.SUPER_ADMIN || 0;
    if (totalSuperAdminShare > 0) {
      try {
        // Fetch the user with referredBy information
        const referredUser = await User.findById(userId).select('referredBy username email admin');
        if (referredUser && referredUser.referredBy) {
          const { isReferralEnabledForUser } = await import('../utils/referralDistributionHelper.js');
          const referralAllowed = await isReferralEnabledForUser(referredUser._id, 'games');
          if (!referralAllowed) {
            console.log(
              `[ReferralBrokerage] Referral in games disabled for hierarchy of ${referredUser.username}. Skipping transfer.`
            );
          } else {
          // Get the referral client
          const referralClient = await User.findById(referredUser.referredBy).select('username email wallet');
          if (referralClient) {
            // Determine the segment based on gameKey (legacy per-segment flags still apply)
            let segment = 'games'; // default
            if (gameKey?.includes('mcx') || gameKey?.includes('MCX')) {
              segment = 'mcx';
            } else if (gameKey?.includes('forex') || gameKey?.includes('Forex') || gameKey?.includes('FOREX')) {
              segment = 'forex';
            }
            
            const segmentAllowed = await isReferralEnabledForUser(referredUser._id, segment);
            if (!segmentAllowed) {
              console.log(`[ReferralBrokerage] Referral disabled for segment ${segment} for ${referredUser.username}. Skipping.`);
            } else {
              console.log(`[ReferralBrokerage] User ${referredUser.username} was referred by ${referralClient.username}. Processing referral commission ${totalSuperAdminShare.toFixed(2)} for segment ${segment}.`);
              
              // Track Super Admin earnings from this hierarchy
              try {
                await trackHierarchyEarnings(referredUser.admin, totalSuperAdminShare, segment);
              } catch (error) {
                console.error(`[ReferralBrokerage] Error tracking Super Admin earnings:`, error);
              }
              
              // Process referral commission with eligibility check
              const payoutResult = await processConditionalReferralPayout(
                referredUser._id,
                totalSuperAdminShare,
                segment,
                {
                  gameKey,
                  relatedUserId: userId,
                  referralClientId: referralClient._id,
                  referredUsername: referredUser.username,
                  referrerUsername: referralClient.username
                }
              );
              
              if (payoutResult.success) {
                console.log(`[ReferralBrokerage] Successfully paid ${totalSuperAdminShare.toFixed(2)} referral commission to ${referralClient.username}`);
              } else if (payoutResult.held) {
                console.log(`[ReferralBrokerage] Referral commission held: ${payoutResult.reason}`);
              } else {
                console.log(`[ReferralBrokerage] Referral commission failed: ${payoutResult.reason}`);
              }
            }
          }
          }
        }
      } catch (error) {
        console.error('[ReferralBrokerage] Error transferring to referral client:', error);
      }
    }

    console.log(
      `[WinBrokerage] ${gameName}: user ${userAmt.toFixed(2)} | distributed ${totalDistributed.toFixed(2)} of brokerage ${T.toFixed(2)}`
    );
    return { userRebate: userAmt, distributions, totalDistributed };
  } catch (error) {
    console.error(`[WinBrokerage] ${gameName}:`, error);
    return { userRebate: 0, distributions: {}, totalDistributed: 0 };
  }
}

/**
 * Nifty Jackpot: % of gross prize to hierarchy (Sub-Broker / Broker / Admin), with the same
 * cascade as win brokerage when a role is missing in the chain. Used when
 * grossPrize*Percent settings sum to > 0 (replaces brokeragePercent for net prize).
 *
 * @returns {Promise<{ sbAmt: number, brAmt: number, adAmt: number, saAmt: number, totalHierarchy: number, hierarchyChain: Array, distributions: object }>}
 */
export async function computeNiftyJackpotGrossHierarchyBreakdown(user, grossPrize, gameConfig) {
  const G = Number(grossPrize);
  const empty = {
    sbAmt: 0,
    brAmt: 0,
    adAmt: 0,
    saAmt: 0,
    totalHierarchy: 0,
    hierarchyChain: [],
    distributions: {},
  };
  if (!user || !Number.isFinite(G) || G <= 0) return empty;

  const pctSb = Number(gameConfig?.grossPrizeSubBrokerPercent) || 0;
  const pctBr = Number(gameConfig?.grossPrizeBrokerPercent) || 0;
  const pctAd = Number(gameConfig?.grossPrizeAdminPercent) || 0;
  if (pctSb + pctBr + pctAd <= 0) return empty;

  let sbAmt = parseFloat(((G * pctSb) / 100).toFixed(2));
  let brAmt = parseFloat(((G * pctBr) / 100).toFixed(2));
  let adAmt = parseFloat(((G * pctAd) / 100).toFixed(2));
  let saAmt = 0;

  const subBrokerShareToBroker = gameConfig?.subBrokerShareToBroker ?? true;

  const hierarchyChain = [];
  let currentAdmin = null;
  if (user.admin) {
    currentAdmin = await Admin.findById(user.admin).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
  } else if (user.adminCode) {
    currentAdmin = await Admin.findOne({ adminCode: user.adminCode, status: 'ACTIVE' }).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
  }
  while (currentAdmin) {
    hierarchyChain.push({ admin: currentAdmin, role: currentAdmin.role });
    if (currentAdmin.role === 'SUPER_ADMIN' || !currentAdmin.parentId) break;
    currentAdmin = await Admin.findById(currentAdmin.parentId).select('+receivesHierarchyBrokerage +status +role +parentId +wallet +stats +adminCode +username');
  }

  const hasSubBroker = hierarchyChain.some((h) => h.role === 'SUB_BROKER');
  const hasBroker = hierarchyChain.some((h) => h.role === 'BROKER');
  const hasAdmin = hierarchyChain.some((h) => h.role === 'ADMIN');
  const hasSuperAdmin = hierarchyChain.some((h) => h.role === 'SUPER_ADMIN');

  if (!hasSubBroker) {
    if (subBrokerShareToBroker && hasBroker) brAmt += sbAmt;
    else if (hasAdmin) adAmt += sbAmt;
    else saAmt += sbAmt;
    sbAmt = 0;
  }
  if (!hasBroker) {
    if (hasAdmin) adAmt += brAmt;
    else saAmt += brAmt;
    brAmt = 0;
  }
  if (!hasAdmin) {
    saAmt += adAmt;
    adAmt = 0;
  }

  const distributions = {};
  if (hasSubBroker && sbAmt > 0) distributions.SUB_BROKER = sbAmt;
  if (hasBroker && brAmt > 0) distributions.BROKER = brAmt;
  if (hasAdmin && adAmt > 0) distributions.ADMIN = adAmt;
  if (hasSuperAdmin && saAmt > 0) distributions.SUPER_ADMIN = saAmt;

  const totalHierarchy = parseFloat((sbAmt + brAmt + adAmt + saAmt).toFixed(2));

  return {
    sbAmt,
    brAmt,
    adAmt,
    saAmt,
    pctSb,
    pctBr,
    pctAd,
    grossPrize: G,
    totalHierarchy,
    hierarchyChain,
    distributions,
  };
}

/**
 * Debit Super Admin pool and credit admin wallets from a prior {@link computeNiftyJackpotGrossHierarchyBreakdown}.
 * @param {object} [options]
 * @param {string} [options.gameLabel='Nifty Jackpot'] — Used in pool debit reason and WalletLedger descriptions
 * @param {string} [options.logTag='JackpotGrossHierarchy'] — Console / error log prefix
 */
export async function creditNiftyJackpotGrossHierarchyFromPool(userId, user, breakdown, options = {}) {
  const gameLabel = options.gameLabel || 'Nifty Jackpot';
  const logTag = options.logTag || 'JackpotGrossHierarchy';
  const gameKey = options.gameKey;
  const T = Number(breakdown?.totalHierarchy);
  if (!userId || !user || !Number.isFinite(T) || T <= 0) {
    return { poolOk: true, totalDistributed: 0 };
  }

  try {
    const poolMeta = {
      poolDebitKind: 'JACKPOT_GROSS_HIERARCHY_POOL_DEBIT',
      ...(gameKey ? { gameKey } : {}),
      ...(userId ? { relatedUserId: userId } : {}),
    };
    const poolOut = await debitBtcUpDownSuperAdminPool(
      T,
      `${gameLabel} — gross prize hierarchy share (−${T.toFixed(2)})`,
      poolMeta
    );
    if (!poolOut.ok) {
      console.error(`[${logTag}] Super Admin pool debit failed (${T.toFixed(2)})`);
      return { poolOk: false, totalDistributed: 0 };
    }

    const { hierarchyChain, distributions } = breakdown;
    let totalDistributed = 0;

    const lumpNoChain = parseFloat(
      (
        (breakdown.sbAmt || 0) +
        (breakdown.brAmt || 0) +
        (breakdown.adAmt || 0) +
        (breakdown.saAmt || 0)
      ).toFixed(2)
    );

    if (hierarchyChain.length === 0) {
      if (lumpNoChain > 0) {
        const saDoc = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
        if (saDoc) {
          saDoc.wallet.balance = (saDoc.wallet.balance || 0) + lumpNoChain;
          saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + lumpNoChain;
          await saDoc.save();
          await WalletLedger.create({
            ownerType: 'ADMIN',
            ownerId: saDoc._id,
            adminCode: saDoc.adminCode,
            type: 'CREDIT',
            reason: 'GAME_PROFIT',
            amount: lumpNoChain,
            balanceAfter: saDoc.wallet.balance,
            description: `${gameLabel} win brokerage — Super Admin remainder (no hierarchy, ${lumpNoChain.toFixed(2)})`,
            meta: gameProfitLedgerMeta(lumpNoChain, T, 'JACKPOT_GROSS_FEE', gameKey, null, userId),
          });
          totalDistributed += lumpNoChain;
        }
      }
      return { poolOk: true, totalDistributed };
    }

    const creditedGrossRoles = new Set();
    let superAdminCreditedInChain = false;
    let divertedGrossHierarchyToSuperAdmin = 0;
    
    console.log(`[${logTag}] Processing gross hierarchy for ${hierarchyChain.length} admins, total: ${T}`);
    
    for (const { admin, role } of hierarchyChain) {
      const shareAmount = distributions[role] || 0;
      console.log(`[${logTag}] Processing ${admin.username || admin.adminCode} (${role}): shareAmount=${shareAmount}, receivesHierarchyBrokerage=${admin.receivesHierarchyBrokerage}, status=${admin.status}`);
      
      if (shareAmount <= 0) continue;
      if (creditedGrossRoles.has(role)) continue;
      creditedGrossRoles.add(role);
      
      // Check if admin is eligible to receive brokerage
      if (!adminReceivesHierarchyBrokerage(admin, 'games')) {
        console.log(`[${logTag}] Admin ${admin.username || admin.adminCode} (${role}) gross hierarchy diverted to SuperAdmin: receivesHierarchyBrokerage=${admin.receivesHierarchyBrokerage}, status=${admin.status}, amount=${shareAmount.toFixed(2)}`);
        divertedGrossHierarchyToSuperAdmin += shareAmount;
        continue;
      }
      
      console.log(`[${logTag}] CREDITING ${admin.username || admin.adminCode} (${role}): ${shareAmount.toFixed(2)} to ${role === 'SUPER_ADMIN' ? 'MAIN' : 'TEMPORARY'} WALLET`);
      // Credit to temporary wallet instead of main wallet (except for SUPER_ADMIN)
      if (role === 'SUPER_ADMIN') {
        admin.wallet.balance = (admin.wallet.balance || 0) + shareAmount;
        admin.stats.totalBrokerage = (admin.stats.totalBrokerage || 0) + shareAmount;
      } else {
        admin.temporaryWallet.balance = (admin.temporaryWallet.balance || 0) + shareAmount;
        admin.temporaryWallet.totalEarned = (admin.temporaryWallet.totalEarned || 0) + shareAmount;
      }
      await admin.save();
      await WalletLedger.create({
        ownerType: 'ADMIN',
        ownerId: admin._id,
        adminCode: admin.adminCode,
        type: 'CREDIT',
        reason: 'GAME_PROFIT',
        amount: shareAmount,
        balanceAfter: role === 'SUPER_ADMIN' ? admin.wallet.balance : admin.temporaryWallet.balance,
        description: (() => {
            const pctMap = { SUB_BROKER: breakdown.pctSb, BROKER: breakdown.pctBr, ADMIN: breakdown.pctAd };
            const pct = pctMap[role];
            const gp = breakdown.grossPrize;
            const tempWalletTag = role !== 'SUPER_ADMIN' ? ' [Temporary Wallet]' : '';
            return pct > 0 && gp > 0
              ? `${gameLabel} win brokerage — ${role} (${pct.toFixed(1)}% of ${gp.toFixed(2)} = ${shareAmount.toFixed(2)})${tempWalletTag}`
              : `${gameLabel} win brokerage — ${role} (${shareAmount.toFixed(2)})${tempWalletTag}`;
          })(),
        meta: gameProfitLedgerMeta(shareAmount, Number(breakdown.grossPrize) || 0, 'JACKPOT_GROSS_FEE', gameKey, null, userId),
      });
      totalDistributed += shareAmount;
      if (role === 'SUPER_ADMIN') superAdminCreditedInChain = true;
    }

    // Handle diverted brokerage and remainder to Super Admin
    const totalSuperAdminAmount = (breakdown.saAmt || 0) + divertedGrossHierarchyToSuperAdmin;
    if (totalSuperAdminAmount > 0 && !superAdminCreditedInChain) {
      const saDoc = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (saDoc) {
        console.log(`[${logTag}] CREDITING Super Admin: ${totalSuperAdminAmount.toFixed(2)} (remainder: ${breakdown.saAmt || 0}, diverted: ${divertedGrossHierarchyToSuperAdmin})`);
        saDoc.wallet.balance = (saDoc.wallet.balance || 0) + totalSuperAdminAmount;
        saDoc.stats.totalBrokerage = (saDoc.stats.totalBrokerage || 0) + totalSuperAdminAmount;
        await saDoc.save();
        await WalletLedger.create({
          ownerType: 'ADMIN',
          ownerId: saDoc._id,
          adminCode: saDoc.adminCode,
          type: 'CREDIT',
          reason: 'GAME_PROFIT',
          amount: totalSuperAdminAmount,
          balanceAfter: saDoc.wallet.balance,
          description: divertedGrossHierarchyToSuperAdmin > 0 
            ? `${gameLabel} gross prize fee — Super Admin (${(breakdown.saAmt || 0).toFixed(2)} remainder + ${divertedGrossHierarchyToSuperAdmin.toFixed(2)} diverted from disabled admins)`
            : `${gameLabel} gross prize fee — Super Admin remainder (${totalSuperAdminAmount.toFixed(2)})`,
          meta: gameProfitLedgerMeta(
            totalSuperAdminAmount,
            Number(breakdown.grossPrize) || 0,
            'JACKPOT_GROSS_FEE',
            gameKey,
            null,
            userId
          ),
        });
        totalDistributed += totalSuperAdminAmount;
      }
    }

    console.log(
      `[${logTag}] user ${user.userId || userId}: distributed ${totalDistributed.toFixed(2)} of gross fee ${T.toFixed(2)}`
    );
    return { poolOk: true, totalDistributed };
  } catch (error) {
    console.error(`[${logTag}]`, error);
    return { poolOk: false, totalDistributed: 0 };
  }
}
