import SystemSettings from '../models/SystemSettings.js';
import User from '../models/User.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** @returns {Promise<{ trialDays: number, demoBalance: number }>} */
export async function getDemoAccountSettings() {
  const settings = await SystemSettings.getSettings();
  const raw = settings?.demoAccountSettings?.trialDays ?? 7;
  const trialDays = Math.min(30, Math.max(1, Math.floor(Number(raw) || 7)));
  const demoBalance = Math.max(
    0,
    Number(settings?.demoAccountSettings?.demoBalance ?? 1_000_000) || 1_000_000
  );
  return { trialDays, demoBalance };
}

export async function getDemoTrialDays() {
  const { trialDays } = await getDemoAccountSettings();
  return trialDays;
}

/** Demo expiry = end of calendar day (start + trialDays), e.g. join May 25 + 7 days → through June 1 EOD, expires after. */
export async function buildDemoExpiresAt(fromDate = new Date()) {
  const { trialDays } = await getDemoAccountSettings();
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const expires = new Date(start.getTime() + trialDays * MS_PER_DAY);
  expires.setHours(23, 59, 59, 999);
  return expires;
}

export function isDemoUser(user) {
  return !!(user?.isDemo || user?.settings?.isDemo);
}

/** Demo trades: no hierarchy brokerage / win-fee splits to admins. */
export function shouldSkipBrokerageDistribution(user) {
  return isDemoUser(user);
}

/**
 * Permanently remove an expired demo user and related data.
 * Called when demoExpiresAt has passed and user did not convert to real.
 */
export async function deleteExpiredDemoUser(user) {
  const userId = user._id;
  const username = user.username || user.email;

  const [
    { default: Position },
    { default: Trade },
    { default: WalletLedger },
    { default: FundRequest },
    { default: GamesWalletLedger },
    { default: GameTransactionSlip },
    { default: Referral },
    { default: Watchlist },
    { default: BrokerageTracking },
    { default: Charges },
    { default: Notification },
    { default: BtcNumberBet },
    { default: BtcJackpotBid },
    { default: NiftyJackpotBid },
    { default: NiftyNumberBet },
    { default: NiftyBracketTrade },
    { default: UpDownExpiredRefund },
    { default: UpDownWindowSettlement },
    { default: PlatformChargeLedger },
    { default: BrokerChangeRequest },
  ] = await Promise.all([
    import('../models/Position.js'),
    import('../models/Trade.js'),
    import('../models/WalletLedger.js'),
    import('../models/FundRequest.js'),
    import('../models/GamesWalletLedger.js'),
    import('../models/GameTransactionSlip.js'),
    import('../models/Referral.js'),
    import('../models/Watchlist.js'),
    import('../models/BrokerageTracking.js'),
    import('../models/Charges.js'),
    import('../models/Notification.js'),
    import('../models/BtcNumberBet.js'),
    import('../models/BtcJackpotBid.js'),
    import('../models/NiftyJackpotBid.js'),
    import('../models/NiftyNumberBet.js'),
    import('../models/NiftyBracketTrade.js'),
    import('../models/UpDownExpiredRefund.js'),
    import('../models/UpDownWindowSettlement.js'),
    import('../models/PlatformChargeLedger.js'),
    import('../models/BrokerChangeRequest.js'),
  ]);

  await Promise.all([
    Position.deleteMany({ user: userId }),
    Trade.deleteMany({ user: userId }),
    WalletLedger.deleteMany({ ownerType: 'USER', ownerId: userId }),
    FundRequest.deleteMany({ user: userId }),
    GamesWalletLedger.deleteMany({ user: userId }),
    GameTransactionSlip.deleteMany({ user: userId }),
    Referral.deleteMany({ $or: [{ referrer: userId }, { referredUser: userId }] }),
    Watchlist.deleteMany({ user: userId }),
    BrokerageTracking.deleteMany({ user: userId }),
    Charges.deleteMany({ user: userId }),
    Notification.deleteMany({
      $or: [
        { targetUserId: userId },
        { targetUserIds: userId },
        { 'readBy.userId': userId },
      ],
    }),
    BtcNumberBet.deleteMany({ user: userId }),
    BtcJackpotBid.deleteMany({ user: userId }),
    NiftyJackpotBid.deleteMany({ user: userId }),
    NiftyNumberBet.deleteMany({ user: userId }),
    NiftyBracketTrade.deleteMany({ user: userId }),
    UpDownExpiredRefund.deleteMany({ user: userId }),
    UpDownWindowSettlement.deleteMany({ user: userId }),
    PlatformChargeLedger.deleteMany({ user: userId }),
    BrokerChangeRequest.deleteMany({ user: userId }),
  ]);

  await User.deleteOne({ _id: userId });
  console.log(`[DemoCleanup] Removed expired demo account: ${username} (${userId})`);
  return true;
}

export async function cleanupExpiredDemoAccounts() {
  const now = new Date();
  const expiredUsers = await User.find({
    isDemo: true,
    demoExpiresAt: { $lt: now },
  }).select('_id username email demoExpiresAt');

  if (!expiredUsers.length) return { removed: 0 };

  let removed = 0;
  for (const user of expiredUsers) {
    try {
      await deleteExpiredDemoUser(user);
      removed += 1;
    } catch (err) {
      console.error(`[DemoCleanup] Failed to remove ${user.username}:`, err.message);
    }
  }
  console.log(`[DemoCleanup] Removed ${removed} expired demo account(s)`);
  return { removed };
}
