import Trade from '../models/Trade.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';
import {
  resolvePattiCascadeCredits,
  resolvePattiAdminSaBrokerageContext,
  pattiSegmentKeyFromTrade,
} from '../services/pattiTradeSettlement.js';
import { subwalletCloseBalancePnL } from './subwalletCashWallet.js';
import {
  roundMoney as round2,
  chargeTotal,
  computeUserGrossClosePnL,
  computeAdminBookPoolForPatti,
  reconcileStoredGrossPnL,
  computeUserNetClosePnL,
  computeTotalEconomicImpact,
  isPrepaidSubwalletTrade,
} from './bookPnL.js';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  BROKER: 'Broker',
  SUB_BROKER: 'Sub-broker',
};

function mapLedgerRow(row, adm) {
  return {
    ledgerId: row._id,
    type: row.type,
    reason: row.reason,
    amount: round2(row.amount),
    ownerName: adm?.name || adm?.username || row.adminCode,
    ownerRole: adm?.role,
    ownerRoleLabel: ROLE_LABEL[adm?.role] || adm?.role,
    sharePct: row.meta?.pattiChildPct ?? row.meta?.franchiseSharePct ?? null,
    pattiSource: row.meta?.pattiSource,
    createdAt: row.createdAt,
    description: row.description,
    isPatti:
      row.reason === 'TRADE_PNL' ||
      row.meta?.pattiSharing === true ||
      !!row.meta?.pattiSource,
    isBrokerage: row.reason === 'BROKERAGE',
  };
}

/**
 * Full close breakdown: user gross/net, B_BOOK admin pool, patti (if configured), ledger credits.
 */
export async function getTradeCloseBreakdown(tradeId) {
  const trade = await Trade.findById(tradeId).lean();
  if (!trade) {
    const err = new Error('Trade not found');
    err.statusCode = 404;
    throw err;
  }
  if (trade.status !== 'CLOSED') {
    const err = new Error('Trade is not closed');
    err.statusCode = 400;
    throw err;
  }

  const user = trade.user
    ? await User.findById(trade.user).select('username fullName userId adminCode').lean()
    : null;

  const directAdmin = trade.adminCode
    ? await Admin.findOne({ adminCode: trade.adminCode }).select(
        'name username adminCode role status parentId pattiSharing'
      )
    : null;

  const screenGross = computeUserGrossClosePnL(trade);
  const grossStoredRaw = round2(trade.realizedPnL ?? trade.pnl ?? screenGross);
  const grossCanonical = reconcileStoredGrossPnL(trade);
  const grossSignCorrected =
    Number.isFinite(Number(trade.realizedPnL ?? trade.pnl)) &&
    Math.abs(grossCanonical - grossStoredRaw) > 0.02;

  const netCanonical = computeUserNetClosePnL(trade, grossCanonical);
  const netStoredRaw = round2(trade.netPnL ?? netCanonical);
  const netSignCorrected =
    Number.isFinite(Number(trade.netPnL)) && Math.abs(netCanonical - netStoredRaw) > 0.02;

  const charges = round2(chargeTotal(trade));
  const commission = round2(Number(trade.commission) || 0);
  const walletPnL = round2(subwalletCloseBalancePnL(trade, grossCanonical, netCanonical));
  const totalEconomicImpact = computeTotalEconomicImpact(trade, grossCanonical);
  const prepaidBrokerage = isPrepaidSubwalletTrade(trade);

  const adminPnL = round2(
    trade.bookType === 'B_BOOK' ? computeAdminBookPoolForPatti(trade) : trade.adminPnL ?? 0
  );

  let pattiBlock = {
    active: false,
    childPct: null,
    parentPct: null,
    segmentKey: pattiSegmentKeyFromTrade(trade),
    credits: [],
    totalPool: adminPnL,
  };

  if (directAdmin && user && trade.bookType === 'B_BOOK') {
    const ctx = await resolvePattiAdminSaBrokerageContext(directAdmin, user, trade);
    if (ctx.active) {
      const { credits, segKey, pattiRootId } = await resolvePattiCascadeCredits(
        directAdmin,
        user,
        trade,
        adminPnL
      );
      const childPct = ctx.childPct;
      const parentPct = childPct != null ? round2(100 - childPct) : null;

      const adminIds = [...new Set(credits.map((c) => String(c.adminId)))];
      const admins = await Admin.find({ _id: { $in: adminIds } })
        .select('name username adminCode role')
        .lean();
      const adminMap = new Map(admins.map((a) => [String(a._id), a]));

      let pattiRootDoc = null;
      if (pattiRootId) {
        pattiRootDoc = adminMap.get(String(pattiRootId)) || (await Admin.findById(pattiRootId).lean());
      }

      pattiBlock = {
        active: true,
        childPct,
        parentPct,
        segmentKey: segKey || ctx.segKey,
        pattiRoot: pattiRootDoc
          ? {
              name: pattiRootDoc.name || pattiRootDoc.username,
              adminCode: pattiRootDoc.adminCode,
            }
          : null,
        credits: credits.map((c) => {
          const adm = adminMap.get(String(c.adminId));
          const pct =
            c.source === 'individual_patti_parent'
              ? parentPct
              : c.childPct;
          return {
            adminId: c.adminId,
            name: adm?.name || adm?.username || 'Admin',
            adminCode: adm?.adminCode || '',
            role: adm?.role || '',
            roleLabel: ROLE_LABEL[adm?.role] || adm?.role || '',
            sharePct: pct,
            amount: round2(c.amount),
            source: c.source,
            label:
              c.source === 'individual_patti_parent'
                ? `${c.childPct ?? parentPct}% parent (Super Admin)`
                : c.source === 'hierarchy_patti_net'
                  ? `${c.childPct}% net of pool (${ROLE_LABEL[adm?.role] || adm?.role})`
                  : c.source === 'hierarchy_patti_child'
                    ? `${c.childPct}% of pool (${ROLE_LABEL[adm?.role] || adm?.role})`
                    : c.source === 'hierarchy_patti_upline'
                      ? `Upline remainder (${adm?.role || 'parent'})`
                      : `${c.childPct}% ${ROLE_LABEL[adm?.role] || adm?.role || 'level'}`,
          };
        }),
        totalPool: adminPnL,
      };
    }
  }

  const ledgerRows = await WalletLedger.find({
    'reference.type': 'Trade',
    'reference.id': trade._id,
    ownerType: 'ADMIN',
    $or: [
      { reason: 'TRADE_PNL' },
      { reason: 'BROKERAGE' },
      { 'meta.pattiSharing': true },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  const ledgerCredits = await Promise.all(
    ledgerRows.map(async (row) => {
      const adm = await Admin.findById(row.ownerId).select('name username adminCode role').lean();
      return mapLedgerRow(row, adm);
    })
  );

  const brokerageLedger = ledgerCredits.filter((r) => r.isBrokerage);
  const pattiLedger = ledgerCredits.filter((r) => r.isPatti && !r.isBrokerage);

  if (grossSignCorrected || netSignCorrected) {
    const repairSet = {};
    if (grossSignCorrected) {
      repairSet.realizedPnL = grossCanonical;
      repairSet.pnl = grossCanonical;
    }
    if (netSignCorrected || grossSignCorrected) {
      repairSet.netPnL = netCanonical;
    }
    if (trade.bookType === 'B_BOOK') {
      repairSet.adminPnL = adminPnL;
    }
    if (Object.keys(repairSet).length > 0) {
      await Trade.updateOne({ _id: trade._id }, { $set: repairSet });
    }
  }

  const notes = [];
  if (grossSignCorrected) {
    notes.push({
      code: 'GROSS_SIGN_FIXED',
      message:
        `Stored gross (${grossStoredRaw.toLocaleString('en-IN')}) did not match entry/exit sign — corrected to ${grossCanonical.toLocaleString('en-IN')}.`,
    });
  } else if (Math.abs(screenGross - grossStoredRaw) > 0.02) {
    notes.push({
      code: 'GROSS_VS_SCREEN',
      message:
        'Screen P&L from exit/entry differs from stored gross (different LTP or rounding at close).',
    });
  }
  if (netSignCorrected) {
    notes.push({
      code: 'NET_CORRECTED',
      message: prepaidBrokerage
        ? 'Net shown is price P&L credited to wallet (brokerage was debited separately on open).'
        : 'Stored net did not match gross − charges; showing corrected net.',
    });
  }
  if (prepaidBrokerage && commission > 0 && grossCanonical < 0) {
    notes.push({
      code: 'PREPAID_BROKERAGE',
      message:
        `Round-trip brokerage ${commission.toLocaleString('en-IN')} was debited on open. Total impact ≈ ${Math.abs(totalEconomicImpact).toLocaleString('en-IN')} (loss + brokerage).`,
    });
  }
  if (trade.bookType === 'B_BOOK') {
    notes.push({
      code: 'ADMIN_BOOK',
      message:
        'B_BOOK admin pool = opposite of user price P&L (not brokerage). Brokerage is split separately in the ledger.',
      userGross: grossCanonical,
      adminPool: adminPnL,
    });
  }

  return {
    trade: {
      _id: trade._id,
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      side: trade.side,
      productType: trade.productType,
      quantity: trade.quantity,
      lots: trade.lots,
      lotSize: trade.lotSize,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      effectiveExitPrice: trade.effectiveExitPrice,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      closeReason: trade.closeReason,
      segment: trade.segment,
      exchange: trade.exchange,
      bookType: trade.bookType,
      isCrypto: trade.isCrypto,
      brokeragePrepaidRoundTrip: trade.brokeragePrepaidRoundTrip !== false,
    },
    user: user
      ? {
          username: user.username,
          fullName: user.fullName,
          userId: user.userId,
          userCode: user.userCode,
        }
      : null,
    pnl: {
      screenGross,
      grossPnL: grossCanonical,
      grossStoredRaw,
      grossSignCorrected,
      netPnL: netCanonical,
      netStoredRaw,
      netSignCorrected,
      walletPnL,
      totalEconomicImpact,
      closingCharges: charges,
      commission,
      adminPnL,
      bookType: trade.bookType,
      prepaidBrokerage,
    },
    patti: pattiBlock,
    ledgerCredits,
    brokerageLedger,
    pattiLedger,
    notes,
  };
}

/**
 * Admin may view breakdown if SA, or trade under their adminCode subtree, or they have a ledger row on this trade.
 */
export async function assertAdminCanViewTradeBreakdown(admin, tradeId) {
  if (!admin) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  if (admin.role === 'SUPER_ADMIN') return;

  const trade = await Trade.findById(tradeId).select('adminCode user').lean();
  if (!trade) {
    const err = new Error('Trade not found');
    err.statusCode = 404;
    throw err;
  }

  if (trade.adminCode === admin.adminCode) return;

  const ledgerHit = await WalletLedger.exists({
    ownerType: 'ADMIN',
    ownerId: admin._id,
    'reference.type': 'Trade',
    'reference.id': trade._id,
  });
  if (ledgerHit) return;

  const user = trade.user ? await User.findById(trade.user).select('createdBy').lean() : null;
  if (user?.createdBy) {
    let current = await Admin.findById(user.createdBy).select('adminCode parentId role');
    while (current) {
      if (current.adminCode === admin.adminCode) return;
      if (!current.parentId) break;
      current = await Admin.findById(current.parentId).select('adminCode parentId role');
    }
  }

  const err = new Error('Not allowed to view this trade breakdown');
  err.statusCode = 403;
  throw err;
}
