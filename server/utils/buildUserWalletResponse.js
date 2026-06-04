import User from '../models/User.js';
import GameSettings from '../models/GameSettings.js';
import { recalculateUsedMargin } from './recalculateUsedMargin.js';
import { migrateNseBseWalletIfNeeded, readNseBseWalletFromDb } from './nseBseWallet.js';

/**
 * Full wallet payload for GET /api/user/wallet (NSE/BSE, crypto, MCX, games, main).
 */
export async function buildUserWalletResponse(userId) {
  const user = await User.findById(userId).select(
    'wallet nseBseWallet cryptoWallet forexWallet mcxWallet gamesWallet marginSettings rmsSettings'
  );
  if (!user) return null;

  let gamesTicketValue = 300;
  try {
    const gs = await GameSettings.getSettings();
    gamesTicketValue = gs?.tokenValue || 300;
  } catch {
    /* default */
  }

  await migrateNseBseWalletIfNeeded(userId);
  const liveNse = await readNseBseWalletFromDb(userId);
  const freshUser = await User.findById(userId)
    .select('wallet nseBseWallet cryptoWallet forexWallet mcxWallet gamesWallet marginSettings rmsSettings')
    .lean();
  const walletUser = freshUser || user;

  let mainWalletBalance = liveNse.mainBalance || walletUser.wallet?.cashBalance || 0;
  if (mainWalletBalance === 0 && walletUser.wallet?.balance > 0) {
    mainWalletBalance = walletUser.wallet.balance;
    await User.updateOne({ _id: userId }, { $set: { 'wallet.cashBalance': mainWalletBalance } });
  }

  const nseBseBalance = liveNse.balance;
  const usedMarginFromDb = liveNse.usedMargin;
  const recalculatedMargin = await recalculateUsedMargin(userId);
  const usedMargin = recalculatedMargin.nseBseWallet ?? recalculatedMargin.wallet ?? usedMarginFromDb;

  const availableMargin =
    nseBseBalance +
    (walletUser.wallet?.collateralValue || 0) +
    Math.max(0, walletUser.wallet?.unrealizedPnL || 0) -
    Math.abs(Math.min(0, walletUser.wallet?.unrealizedPnL || 0)) -
    usedMargin;

  const nseBseAvailable = Math.max(0, nseBseBalance - usedMargin);

  let ledgerStatus = null;
  try {
    const { getLedgerStatusForApi } = await import('../services/nseBseLedgerAutosquareService.js');
    ledgerStatus = await getLedgerStatusForApi(userId);
  } catch {
    ledgerStatus = null;
  }

  return {
    gamesTicketValue,
    cashBalance: mainWalletBalance,
    nseBseWallet: {
      balance: nseBseBalance,
      usedMargin,
      transferableBalance: nseBseAvailable,
      availableBalance: nseBseAvailable,
      equity: ledgerStatus?.realBalance ?? nseBseBalance + (walletUser.nseBseWallet?.unrealizedPnL || 0),
      realBalance: ledgerStatus?.realBalance ?? nseBseBalance,
      totalMtm: ledgerStatus?.totalMtm ?? 0,
      availableMargin: ledgerStatus?.availableMargin ?? nseBseAvailable,
      ledgerReferenceBalance: walletUser.nseBseWallet?.ledgerReferenceBalance ?? nseBseBalance,
      ledgerClosePercent: 0,
      ledgerMinEquityFloor: 0,
      ledgerLossPercent: 0,
      ledgerAutosquareActive: ledgerStatus?.ledgerAutosquareActive ?? false,
      realizedPnL: walletUser.nseBseWallet?.realizedPnL || 0,
      unrealizedPnL:
        (ledgerStatus?.totalMtm ?? walletUser.nseBseWallet?.unrealizedPnL) || 0,
      todayRealizedPnL: walletUser.nseBseWallet?.todayRealizedPnL || 0,
      todayUnrealizedPnL: walletUser.nseBseWallet?.todayUnrealizedPnL || 0,
    },
    tradingBalance: nseBseBalance,
    usedMargin,
    collateralValue: walletUser.wallet?.collateralValue || 0,
    realizedPnL: walletUser.wallet?.realizedPnL || 0,
    unrealizedPnL: walletUser.wallet?.unrealizedPnL || 0,
    todayRealizedPnL: walletUser.wallet?.todayRealizedPnL || 0,
    todayUnrealizedPnL: walletUser.wallet?.todayUnrealizedPnL || 0,
    availableMargin,
    totalBalance: mainWalletBalance + nseBseBalance,
    cryptoWallet: {
      balance: user.cryptoWallet?.balance || 0,
      usedMargin: recalculatedMargin.cryptoWallet,
      transferableBalance: Math.max(0, (user.cryptoWallet?.balance || 0) - recalculatedMargin.cryptoWallet),
      realizedPnL: user.cryptoWallet?.realizedPnL || 0,
      unrealizedPnL: user.cryptoWallet?.unrealizedPnL || 0,
      todayRealizedPnL: user.cryptoWallet?.todayRealizedPnL || 0,
    },
    forexWallet: {
      balance: user.forexWallet?.balance || 0,
      usedMargin: recalculatedMargin.forexWallet,
      transferableBalance: Math.max(0, (user.forexWallet?.balance || 0) - recalculatedMargin.forexWallet),
      realizedPnL: user.forexWallet?.realizedPnL || 0,
      unrealizedPnL: user.forexWallet?.unrealizedPnL || 0,
      todayRealizedPnL: user.forexWallet?.todayRealizedPnL || 0,
    },
    tradingAccountTransferable: nseBseAvailable,
    mcxWallet: {
      balance: user.mcxWallet?.balance || 0,
      usedMargin: recalculatedMargin.mcxWallet,
      transferableBalance: Math.max(0, (user.mcxWallet?.balance || 0) - recalculatedMargin.mcxWallet),
      realizedPnL: user.mcxWallet?.realizedPnL || 0,
      unrealizedPnL: user.mcxWallet?.unrealizedPnL || 0,
      todayRealizedPnL: user.mcxWallet?.todayRealizedPnL || 0,
      todayUnrealizedPnL: user.mcxWallet?.todayUnrealizedPnL || 0,
      availableBalance: (user.mcxWallet?.balance || 0) - recalculatedMargin.mcxWallet,
    },
    gamesWallet: {
      balance: user.gamesWallet?.balance || 0,
      usedMargin: recalculatedMargin.gamesWallet,
      transferableBalance: Math.max(0, (user.gamesWallet?.balance || 0) - recalculatedMargin.gamesWallet),
      realizedPnL: user.gamesWallet?.realizedPnL || 0,
      unrealizedPnL: user.gamesWallet?.unrealizedPnL || 0,
      todayRealizedPnL: user.gamesWallet?.todayRealizedPnL || 0,
      todayUnrealizedPnL: user.gamesWallet?.todayUnrealizedPnL || 0,
      availableBalance: (user.gamesWallet?.balance || 0) - recalculatedMargin.gamesWallet,
    },
    wallet: {
      balance: mainWalletBalance,
      cashBalance: mainWalletBalance,
      tradingBalance: nseBseBalance,
      usedMargin,
      blocked: usedMargin,
      totalDeposited: walletUser.wallet?.totalDeposited || 0,
      totalWithdrawn: walletUser.wallet?.totalWithdrawn || 0,
      totalPnL: walletUser.wallet?.realizedPnL || 0,
      transactions: walletUser.wallet?.transactions,
    },
    marginAvailable: availableMargin,
    marginSettings: user.marginSettings,
    rmsStatus: user.rmsSettings?.tradingBlocked ? 'BLOCKED' : 'ACTIVE',
    rmsBlockReason: user.rmsSettings?.blockReason,
  };
}
