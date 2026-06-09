import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import BankAccount from '../models/BankAccount.js';
import FundRequest from '../models/FundRequest.js';
import WalletLedger from '../models/WalletLedger.js';
import Trade from '../models/Trade.js';
import { protectUser } from '../middleware/auth.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';
import {
  migrateNseBseWalletIfNeeded,
  readNseBseWalletFromDb,
} from '../utils/nseBseWallet.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import { repairCryptoWalletBalance, repairNseBseWalletBalance } from '../utils/repairSubwalletBalance.js';
import { isAbsurdWalletInr } from '../utils/walletBalanceSanity.js';
import TradeService from '../services/tradeService.js';

/** Wallet-scoped TRADE_PNL / autosquare ledger rows (never match global isAutoSquare alone). */
function pnlLedgerFilterForWallet(w) {
  if (w === 'crypto') {
    return { $or: [{ description: { $regex: /\(Crypto\)/i } }, { 'meta.segment': 'CRYPTO' }] };
  }
  if (w === 'forex') {
    return { $or: [{ description: { $regex: /\(Forex\)/i } }, { 'meta.segment': 'FOREX' }] };
  }
  if (w === 'mcx') {
    return { $or: [{ description: { $regex: /\(MCX\)/i } }, { 'meta.segment': 'MCX' }] };
  }
  if (w === 'games') {
    return { description: { $regex: /\(Games\)/i } };
  }
  if (w === 'trading') {
    return {
      $or: [
        { description: { $regex: /\(NSE\/BSE\)/i } },
        { 'meta.segment': 'NSE/BSE' },
      ],
    };
  }
  return null;
}

/** Short labels matching user Accounts UI (cash vs Trading naming). */
function subwalletLedgerLabel(walletType) {
  switch (walletType) {
    case 'wallet':
      return 'Main Wallet (cash)';
    case 'cryptoWallet':
      return 'Crypto account ()';
    case 'forexWallet':
      return 'Forex account ()';
    case 'mcxWallet':
      return 'MCX account';
    case 'gamesWallet':
      return 'Games account';
    case 'tradingAccount':
    case 'nseBseWallet':
      return 'NSE & BSE Wallet';
    default:
      return walletType || '—';
  }
}

function enrichCashBridgeRow(row, segmentKey) {
  const desc = row.description || '';
  const cash = 'Main Wallet (cash)';
  const sub =
    segmentKey === 'forex'
      ? 'Forex account ()'
      : 'Crypto account ()';
  let fromLabel = cash;
  let toLabel = sub;
  if (segmentKey === 'forex') {
    if (desc.includes('Forex → Main')) {
      fromLabel = sub;
      toLabel = cash;
    }
  } else if (desc.includes('Crypto → Main')) {
    fromLabel = sub;
    toLabel = cash;
  }
  return {
    id: String(row._id),
    at: row.createdAt,
    amount: Number(row.amount),
    kind: 'main_cash_bridge',
    description: row.description,
    sourceLabel: fromLabel,
    targetLabel: toLabel,
  };
}

/** Main wallet cash ↔ MCX subwallet bridge rows (`MCX_TRANSFER`). */
function enrichMcxCashBridgeRow(row) {
  const desc = row.description || '';
  const cash = 'Main Wallet (cash)';
  const sub = 'MCX account';
  let fromLabel = cash;
  let toLabel = sub;
  if (desc.includes('MCX Account → Wallet')) {
    fromLabel = sub;
    toLabel = cash;
  }
  return {
    id: String(row._id),
    at: row.createdAt,
    amount: Number(row.amount),
    kind: 'main_cash_bridge',
    description: row.description,
    sourceLabel: fromLabel,
    targetLabel: toLabel,
  };
}

/** Main wallet cash ↔ Games subwallet bridge rows (`GAMES_TRANSFER`). */
function enrichGamesCashBridgeRow(row) {
  const desc = row.description || '';
  const cash = 'Main Wallet (cash)';
  const sub = 'Games account';
  let fromLabel = cash;
  let toLabel = sub;
  if (desc.includes('Games Account → Wallet')) {
    fromLabel = sub;
    toLabel = cash;
  }
  return {
    id: String(row._id),
    at: row.createdAt,
    amount: Number(row.amount),
    kind: 'main_cash_bridge',
    description: row.description,
    sourceLabel: fromLabel,
    targetLabel: toLabel,
  };
}

/** Main cash ↔ Trading balance (`ADJUSTMENT` internal-transfer rows only). */
function enrichTradingInternalRow(row) {
  const desc = row.description || '';
  const cash = 'Main Wallet (cash)';
  const tr = 'NSE & BSE Wallet';
  let sourceLabel = cash;
  let targetLabel = tr;
  if (desc.includes('Trading Account → Wallet')) {
    sourceLabel = tr;
    targetLabel = cash;
  }
  return {
    id: String(row._id),
    at: row.createdAt,
    amount: Number(row.amount),
    kind: 'main_trading_bridge',
    description: row.description,
    sourceLabel,
    targetLabel,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for payment proof uploads
const proofUploadDir = path.join(__dirname, '..', 'uploads', 'proofs');
if (!fs.existsSync(proofUploadDir)) {
  fs.mkdirSync(proofUploadDir, { recursive: true });
}

const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, proofUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'proof-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

const router = express.Router();

// GET …/subwallet-transfer-ledger?wallet=crypto|forex|mcx|games|trading — Main↔sub + cross-wallet (where applicable)
router.get('/subwallet-transfer-ledger', protectUser, async (req, res) => {
  try {
    const w = String(req.query.wallet || '').toLowerCase();
    const allowed = ['crypto', 'forex', 'mcx', 'games', 'trading'];
    if (!allowed.includes(w)) {
      return res.status(400).json({
        message: 'Query wallet must be one of: crypto, forex, mcx, games, trading',
      });
    }
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);

    if (w === 'trading') {
      try {
        await TradeService.reconcileUndebitedBrokerage(req.user._id, 'nse');
      } catch (reconcileErr) {
        console.warn('[subwallet-transfer-ledger] NSE brokerage reconcile:', reconcileErr?.message || reconcileErr);
      }

      const nseBrokerageLedgerFilter = {
        $or: [
          { description: { $regex: /\(NSE\/BSE\)/i } },
          { 'meta.segment': 'NSE/BSE' },
        ],
      };
      const nseTransferLedgerFilter = {
        $or: [
          { 'meta.sourceWallet': { $in: ['nseBseWallet', 'tradingAccount'] } },
          { 'meta.targetWallet': { $in: ['nseBseWallet', 'tradingAccount'] } },
          { description: { $regex: /NSE\s*&\s*BSE|Trading Account/i } },
        ],
      };

      const [meshRows, directRows, pnlRows, brokerageLedgerRows, transferLedgerRows, brokerageRows] =
        await Promise.all([
        WalletTransferService.getTransferHistory(req.user._id),
        WalletLedger.find({
          ownerType: 'USER',
          ownerId: req.user._id,
          reason: 'ADJUSTMENT',
          $or: [
            { description: /^Internal Transfer: Wallet → Trading Account/ },
            { description: /^Internal Transfer: Trading Account → Wallet/ },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(lim)
          .lean(),
        WalletLedger.find({
          ownerType: 'USER',
          ownerId: req.user._id,
          reason: 'TRADE_PNL',
          ...pnlLedgerFilterForWallet('trading'),
        })
          .sort({ createdAt: -1 })
          .limit(lim)
          .lean(),
        WalletLedger.find({
          ownerType: 'USER',
          ownerId: req.user._id,
          reason: 'BROKERAGE',
          ...nseBrokerageLedgerFilter,
        })
          .sort({ createdAt: -1 })
          .limit(lim)
          .lean(),
        WalletLedger.find({
          ownerType: 'USER',
          ownerId: req.user._id,
          reason: { $in: ['WALLET_TRANSFER_DEBIT', 'WALLET_TRANSFER_CREDIT'] },
          ...nseTransferLedgerFilter,
        })
          .sort({ createdAt: -1 })
          .limit(lim)
          .lean(),
        Trade.find({
          user: req.user._id,
          commission: { $gt: 0 },
          $or: [
            { exchange: { $in: ['NSE', 'NFO', 'BSE', 'BFO'] } },
            { segment: { $in: ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FNO'] } },
          ],
        })
          .sort({ updatedAt: -1 })
          .limit(lim)
          .select(
            'tradeId symbol side commission createdAt openedAt brokeragePrepaidRoundTrip walletBrokerageDebited'
          )
          .lean(),
      ]);

      const mesh = (meshRows || [])
        .filter(
          (row) =>
            row.sourceWallet === 'tradingAccount' || row.targetWallet === 'tradingAccount'
        )
        .map((row) => ({
          id: row.transferId,
          at: row.createdAt,
          amount: Number(row.amount),
          kind: 'between_wallets',
          sourceWallet: row.sourceWallet,
          targetWallet: row.targetWallet,
          sourceLabel: subwalletLedgerLabel(row.sourceWallet),
          targetLabel: subwalletLedgerLabel(row.targetWallet),
          description: row.description || null,
        }));

      const bridge = (directRows || []).map((row) => enrichTradingInternalRow(row));

      const pnlEntries = (pnlRows || []).map((row) => ({
        id: row._id.toString(),
        at: row.createdAt,
        amount: Number(row.amount),
        kind: row.isAutoSquare ? 'trade_autosquare' : 'trade_pnl',
        type: row.type,
        description: row.description || '',
        isAutoSquare: row.isAutoSquare || false,
      }));

      const ledgerTradeIds = new Set(
        (brokerageLedgerRows || [])
          .map((row) => String(row?.meta?.tradeId || '').trim())
          .filter(Boolean)
      );
      const ledgerTradeRefIds = new Set(
        (brokerageLedgerRows || [])
          .map((row) => (row?.reference?.id ? String(row.reference.id) : ''))
          .filter(Boolean)
      );

      const brokerageFromLedger = (brokerageLedgerRows || []).map((row) => {
        const inferredLegFromDesc = /\bfor\s+open\+close\b/i.test(String(row?.description || ''))
          ? 'OPEN+CLOSE'
          : /\bfor\s+close\b/i.test(String(row?.description || ''))
            ? 'CLOSE'
            : /\bfor\s+open\b/i.test(String(row?.description || ''))
              ? 'OPEN'
              : '';
        const metaLeg = String(row?.meta?.leg || '').toUpperCase();
        const leg = row?.meta?.prepaidRoundTrip
          ? 'OPEN+CLOSE'
          : metaLeg === 'OPEN+CLOSE'
            ? 'OPEN+CLOSE'
            : metaLeg || inferredLegFromDesc || 'OPEN+CLOSE';
        return {
          id: `wl-brk-${String(row._id)}`,
          at: row.createdAt,
          amount: Number(row.amount) || 0,
          kind: 'trade_brokerage',
          type: 'DEBIT',
          description: row.description || `Brokerage (NSE/BSE) for ${leg}`,
          tradeId: row.meta?.tradeId || null,
          tradeRefId: row?.reference?.id ? String(row.reference.id) : null,
          leg,
        };
      });

      const brokerageFromTrades = (brokerageRows || [])
        .filter((row) => {
          if (row.walletBrokerageDebited !== true) return false;
          const tId = String(row?.tradeId || '').trim();
          const tRef = row?._id ? String(row._id) : '';
          if (tId && ledgerTradeIds.has(tId)) return false;
          if (tRef && ledgerTradeRefIds.has(tRef)) return false;
          return true;
        })
        .map((row) => {
          const prepaid = row.brokeragePrepaidRoundTrip !== false;
          const leg = prepaid ? 'OPEN+CLOSE' : 'OPEN';
          return {
            id: `brk-${String(row._id)}`,
            at: row.openedAt || row.createdAt,
            amount: Number(row.commission) || 0,
            kind: 'trade_brokerage',
            type: 'DEBIT',
            description: `${row.symbol || 'Trade'} ${row.side || ''} Brokerage (NSE/BSE) for ${leg}`.trim(),
            tradeId: row.tradeId || null,
            tradeRefId: row?._id ? String(row._id) : null,
            leg,
          };
        });

      const transferEntries = (transferLedgerRows || []).map((row) => ({
        id: `wl-xfer-${String(row._id)}`,
        at: row.createdAt,
        amount: Number(row.amount) || 0,
        kind: 'wallet_transfer',
        type: row.reason === 'WALLET_TRANSFER_CREDIT' ? 'CREDIT' : 'DEBIT',
        description: row.description || row.reason,
        reason: row.reason,
      }));

      const seen = new Set();
      const combined = [
        ...mesh,
        ...bridge,
        ...pnlEntries,
        ...transferEntries,
        ...brokerageFromLedger,
        ...brokerageFromTrades,
      ]
        .filter((e) => {
          if (
            (e.kind === 'trade_pnl' || e.kind === 'trade_autosquare') &&
            Number(e.amount) < 0.01
          ) {
            return false;
          }
          const k =
            e.kind === 'trade_brokerage'
              ? e.tradeId
                ? `brk-trade-${e.tradeId}-${String(e.leg || 'OPEN').toUpperCase().replace(/\s+/g, '')}`
                : e.tradeRefId
                  ? `brk-ref-${e.tradeRefId}-${String(e.leg || 'OPEN').toUpperCase().replace(/\s+/g, '')}`
                  : `${e.id}-${new Date(e.at).getTime()}`
              : `${e.id}-${new Date(e.at).getTime()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, lim);

      return res.json({ entries: combined });
    }

    if (w === 'crypto') {
      try {
        const uSnap = await User.findById(req.user._id).select('cryptoWallet').lean();
        const bal = Number(uSnap?.cryptoWallet?.balance) || 0;
        const um = Number(uSnap?.cryptoWallet?.usedMargin) || 0;
        if (bal < 1 && um < 1) {
          await repairCryptoWalletBalance(req.user._id);
        }
      } catch (repairErr) {
        console.warn('[subwallet-transfer-ledger] crypto repair:', repairErr?.message || repairErr);
      }
    }

    const segmentKey = w;
    const walletKey =
      w === 'forex'
        ? 'forexWallet'
        : w === 'mcx'
          ? 'mcxWallet'
          : w === 'games'
            ? 'gamesWallet'
            : 'cryptoWallet';
    const directReason =
      w === 'forex'
        ? 'FOREX_TRANSFER'
        : w === 'mcx'
          ? 'MCX_TRANSFER'
          : w === 'games'
            ? 'GAMES_TRANSFER'
            : 'CRYPTO_TRANSFER';

    const tradeSegmentQuery =
      w === 'mcx'
        ? {
            $or: [
              { exchange: 'MCX' },
              { segment: { $in: ['MCX', 'MCXFUT', 'MCXOPT', 'COMMODITY'] } },
            ],
          }
        : w === 'crypto'
          ? {
              $or: [
                { isCrypto: true },
                { exchange: 'BINANCE' },
                { segment: 'CRYPTOFUT' },
                { segment: 'CRYPTOOPT' },
              ],
            }
          : w === 'forex'
            ? {
                $or: [
                  { isForex: true },
                  { exchange: 'FOREX' },
                  { segment: 'FOREXFUT' },
                  { segment: 'FOREXOPT' },
                ],
              }
            : null;

    const brokerageLedgerFilter =
      w === 'crypto'
        ? { $or: [{ description: { $regex: /\(Crypto\)/i } }, { 'meta.segment': 'CRYPTO' }] }
        : w === 'forex'
          ? { $or: [{ description: { $regex: /\(Forex\)/i } }, { 'meta.segment': 'FOREX' }] }
          : w === 'mcx'
            ? { $or: [{ description: { $regex: /\(MCX\)/i } }, { 'meta.segment': 'MCX' }] }
            : w === 'games'
              ? { description: { $regex: /\(Games\)/i } }
              : null;

    const [meshRows, directRows, pnlRows, brokerageLedgerRows, brokerageRows] = await Promise.all([
      WalletTransferService.getTransferHistory(req.user._id),
      WalletLedger.find({
        ownerType: 'USER',
        ownerId: req.user._id,
        reason: directReason,
      })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean(),
      WalletLedger.find({
        ownerType: 'USER',
        ownerId: req.user._id,
        reason: 'TRADE_PNL',
        ...pnlLedgerFilterForWallet(w),
      })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean(),
      brokerageLedgerFilter
        ? WalletLedger.find({
            ownerType: 'USER',
            ownerId: req.user._id,
            reason: 'BROKERAGE',
            ...brokerageLedgerFilter,
          })
            .sort({ createdAt: -1 })
            .limit(lim)
            .lean()
        : [],
      tradeSegmentQuery
        ? Trade.find({
            user: req.user._id,
            commission: { $gt: 0 },
            ...tradeSegmentQuery,
          })
            .sort({ createdAt: -1 })
            .limit(lim)
          .select(
            'tradeId symbol side commission createdAt updatedAt openedAt status walletBrokerageDebited brokeragePrepaidRoundTrip'
          )
          .lean()
        : [],
    ]);

    const mesh = (meshRows || [])
      .filter(
        (row) =>
          row.sourceWallet === walletKey || row.targetWallet === walletKey
      )
      .map((row) => ({
        id: row.transferId,
        at: row.createdAt,
        amount: Number(row.amount),
        kind: 'between_wallets',
        sourceWallet: row.sourceWallet,
        targetWallet: row.targetWallet,
        sourceLabel: subwalletLedgerLabel(row.sourceWallet),
        targetLabel: subwalletLedgerLabel(row.targetWallet),
        description: row.description || null,
      }));

    let bridge;
    if (w === 'crypto' || w === 'forex') {
      bridge = (directRows || []).map((row) => enrichCashBridgeRow(row, segmentKey));
    } else if (w === 'mcx') {
      bridge = (directRows || []).map((row) => enrichMcxCashBridgeRow(row));
    } else {
      bridge = (directRows || []).map((row) => enrichGamesCashBridgeRow(row));
    }

    // Add P&L entries for MCX trades (including auto-square)
    const pnlEntries = (pnlRows || []).map((row) => ({
      id: row._id.toString(),
      at: row.createdAt,
      amount: Number(row.amount),
      kind: row.isAutoSquare ? 'trade_autosquare' : 'trade_pnl',
      type: row.type,
      description: row.description || '',
      isAutoSquare: row.isAutoSquare || false,
    }));

    const ledgerTradeIds = new Set(
      (brokerageLedgerRows || [])
        .map((row) => String(row?.meta?.tradeId || '').trim())
        .filter(Boolean)
    );
    const ledgerTradeRefIds = new Set(
      (brokerageLedgerRows || [])
        .map((row) => (row?.reference?.id ? String(row.reference.id) : ''))
        .filter(Boolean)
    );

    const brokerageFromLedger = (brokerageLedgerRows || []).map((row) => {
      const inferredLegFromDesc = /\bfor\s+open\+close\b/i.test(String(row?.description || ''))
        ? 'OPEN+CLOSE'
        : /\bfor\s+close\b/i.test(String(row?.description || ''))
          ? 'CLOSE'
          : /\bfor\s+open\b/i.test(String(row?.description || ''))
            ? 'OPEN'
            : '';
      const metaLeg = String(row?.meta?.leg || '').toUpperCase();
      const leg = row?.meta?.prepaidRoundTrip
        ? 'OPEN+CLOSE'
        : metaLeg === 'OPEN+CLOSE'
          ? 'OPEN+CLOSE'
          : metaLeg || inferredLegFromDesc || 'OPEN';
      const segLabel = w === 'mcx' ? 'MCX' : w === 'crypto' ? 'CRYPTO' : w === 'forex' ? 'FOREX' : 'NSE/BSE';
      const baseDescRaw = String(row?.description || 'Brokerage').trim();
      const baseDescNoLeg = baseDescRaw
        .replace(/\s+for\s+(OPEN\+CLOSE|OPEN|CLOSE)\s*$/i, '')
        .trim();
      const hasSegmentTag = /\((MCX|CRYPTO|FOREX|NSE\/BSE)\)/i.test(baseDescNoLeg);
      const normalizedBase = hasSegmentTag ? baseDescNoLeg : `${baseDescNoLeg} (${segLabel})`;
      return {
      id: `wl-brk-${String(row._id)}`,
      at: row.createdAt,
      amount: Number(row.amount) || 0,
      kind: 'trade_brokerage',
      type: 'DEBIT',
      description: `${normalizedBase} for ${leg}`,
      tradeId: row.meta?.tradeId || null,
      tradeRefId: row?.reference?.id ? String(row.reference.id) : null,
      leg,
      };
    });

    const brokerageFromTrades = (brokerageRows || [])
      // Fallback only when wallet was actually debited (never show commission without balance cut).
      .filter((row) => {
        if (row.walletBrokerageDebited !== true) return false;
        const tId = String(row?.tradeId || '').trim();
        const tRef = row?._id ? String(row._id) : '';
        if (tId && ledgerTradeIds.has(tId)) return false;
        if (tRef && ledgerTradeRefIds.has(tRef)) return false;
        return true;
      })
      .map((row) => ({
        leg: row.brokeragePrepaidRoundTrip !== false ? 'OPEN+CLOSE' : 'OPEN',
        id: `brk-${String(row._id)}`,
        at: row.openedAt || row.createdAt,
        amount: Number(row.commission) || 0,
        kind: 'trade_brokerage',
        type: 'DEBIT',
        description: `${row.symbol || 'Trade'} ${row.side || ''} Brokerage (${w.toUpperCase()}) for ${
          row.brokeragePrepaidRoundTrip !== false ? 'OPEN+CLOSE' : 'OPEN'
        }`.trim(),
        tradeId: row.tradeId || null,
        tradeRefId: row?._id ? String(row._id) : null,
      }));

    const seen = new Set();
    const combined = [...mesh, ...bridge, ...pnlEntries, ...brokerageFromLedger, ...brokerageFromTrades]
      .filter((e) => {
        if (
          (e.kind === 'trade_pnl' || e.kind === 'trade_autosquare') &&
          Number(e.amount) < 0.01
        ) {
          return false;
        }
        const k =
          e.kind === 'trade_brokerage'
            ? e.tradeId
              ? `brk-trade-${e.tradeId}-${String(e.leg || 'OPEN').toUpperCase().replace(/\s+/g, '')}`
              : e.tradeRefId
                ? `brk-ref-${e.tradeRefId}-${String(e.leg || 'OPEN').toUpperCase().replace(/\s+/g, '')}`
                : `${e.id}-${new Date(e.at).getTime()}`
            : `${e.id}-${new Date(e.at).getTime()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, lim);

    res.json({ entries: combined });
  } catch (error) {
    console.error('subwallet-transfer-ledger:', error);
    res.status(500).json({ message: error.message });
  }
});

// Rebuild crypto cash balance from transfers + ledger (fixes bad autosquare state).
router.post('/repair-crypto-wallet', protectUser, async (req, res) => {
  try {
    const result = await repairCryptoWalletBalance(req.user._id);
    const user = await User.findById(req.user._id).select('cryptoWallet').lean();
    res.json({
      message: 'Crypto wallet repaired from ledger history',
      ...result,
      cryptoWallet: user?.cryptoWallet || {},
    });
  } catch (error) {
    console.error('repair-crypto-wallet:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/repair-nse-bse-wallet', protectUser, async (req, res) => {
  try {
    const result = await repairNseBseWalletBalance(req.user._id);
    const live = await readNseBseWalletFromDb(req.user._id);
    res.json({
      message: 'NSE/BSE wallet repaired from transfer and ledger history',
      ...result,
      balance: live.balance,
      usedMargin: live.usedMargin,
    });
  } catch (error) {
    console.error('repair-nse-bse-wallet:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get admin's bank accounts (for deposit)
router.get('/admin-bank-accounts', protectUser, async (req, res) => {
  try {
    const accounts = await BankAccount.find({ 
      adminCode: req.user.adminCode,
      isActive: true 
    }).select('-admin');
    
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create fund request (deposit) with image upload
router.post('/fund-request/deposit', protectUser, uploadProof.single('proofImage'), async (req, res) => {
  try {
    const { amount, paymentMethod, bankAccountId, referenceId, remarks } = req.body;
    
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    // Verify bank account belongs to user's admin
    if (bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        adminCode: req.user.adminCode
      });
      if (!bankAccount) {
        return res.status(400).json({ message: 'Invalid bank account' });
      }
    }
    
    // Get proof image URL if uploaded
    const proofUrl = req.file ? `/uploads/proofs/${req.file.filename}` : '';
    
    const request = await FundRequest.create({
      user: req.user._id,
      userId: req.user.userId,
      adminCode: req.user.adminCode,
      hierarchyPath: req.user.hierarchyPath || [],
      type: 'DEPOSIT',
      amount: parseFloat(amount),
      paymentMethod,
      bankAccount: bankAccountId || null,
      referenceId: referenceId || '',
      proofUrl: proofUrl,
      userRemarks: remarks || ''
    });
    
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create fund request (withdrawal)
router.post('/fund-request/withdraw', protectUser, async (req, res) => {
  try {
    const { amount, paymentMethod, withdrawalDetails, remarks } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    // Check if trading account has negative balance - block withdrawal until P&L is settled
    const tradingBalance = req.user.wallet.tradingBalance || 0;
    const unrealizedPnL = req.user.wallet.unrealizedPnL || 0;
    const effectiveTradingBalance = tradingBalance + unrealizedPnL;
    
    if (effectiveTradingBalance < 0) {
      return res.status(400).json({ 
        message: `Withdrawal blocked! Your trading account has negative balance of ${Math.abs(effectiveTradingBalance).toLocaleString()}. Please settle your P&L first by depositing funds to your trading account.`,
        code: 'NEGATIVE_TRADING_BALANCE',
        deficit: Math.abs(effectiveTradingBalance)
      });
    }
    
    // Check user balance
    if (req.user.wallet.cashBalance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    
    // Get admin to check withdrawal limits
    const admin = await Admin.findOne({ adminCode: req.user.adminCode });
    if (admin) {
      if (amount < admin.charges.minWithdrawal) {
        return res.status(400).json({ 
          message: `Minimum withdrawal amount is ${admin.charges.minWithdrawal}` 
        });
      }
      if (amount > admin.charges.maxWithdrawal) {
        return res.status(400).json({ 
          message: `Maximum withdrawal amount is ${admin.charges.maxWithdrawal}` 
        });
      }
    }
    
    const request = await FundRequest.create({
      user: req.user._id,
      userId: req.user.userId,
      adminCode: req.user.adminCode,
      hierarchyPath: req.user.hierarchyPath || [],
      type: 'WITHDRAWAL',
      amount,
      paymentMethod,
      userRemarks: remarks || '',
      withdrawalDetails: withdrawalDetails || {}
    });
    
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get my fund requests
router.get('/fund-requests', protectUser, async (req, res) => {
  try {
    const { status, type } = req.query;
    const query = { user: req.user._id };
    
    if (status) query.status = status;
    if (type) query.type = type;
    
    const requests = await FundRequest.find(query)
      .populate('bankAccount', 'type bankName upiId')
      .sort({ createdAt: -1 });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel fund request
router.post('/fund-requests/:id/cancel', protectUser, async (req, res) => {
  try {
    const request = await FundRequest.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'PENDING'
    });
    
    if (!request) {
      return res.status(404).json({ message: 'Fund request not found or cannot be cancelled' });
    }
    
    request.status = 'CANCELLED';
    await request.save();
    
    res.json({ message: 'Fund request cancelled', request });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get my wallet ledger
router.get('/ledger', protectUser, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const ledger = await WalletLedger.find({
      ownerType: 'USER',
      ownerId: req.user._id
    }).sort({ createdAt: -1 }).limit(parseInt(limit));
    
    res.json(ledger);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get my admin info (limited)
router.get('/my-admin', protectUser, async (req, res) => {
  try {
    const admin = await Admin.findOne({ adminCode: req.user.adminCode })
      .select('name adminCode charges.minWithdrawal charges.maxWithdrawal charges.withdrawalFee');
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    res.json(admin);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** NSE & BSE wallet balance — always read from MongoDB (My Accounts card uses this). */
router.get('/nse-bse-wallet', protectUser, async (req, res) => {
  try {
    await migrateNseBseWalletIfNeeded(req.user._id);
    try {
      await TradeService.reconcileUndebitedBrokerage(req.user._id, 'nse');
    } catch (reconcileErr) {
      console.warn('[nse-bse-wallet] brokerage reconcile:', reconcileErr?.message || reconcileErr);
    }
    let live = await readNseBseWalletFromDb(req.user._id);
    let repaired = false;
    const rawDoc = await User.collection.findOne(
      { _id: req.user._id },
      { projection: { 'nseBseWallet.balance': 1, 'wallet.tradingBalance': 1 } }
    );
    const rawBal =
      rawDoc?.nseBseWallet?.balance != null
        ? Number(rawDoc.nseBseWallet.balance)
        : Number(rawDoc?.wallet?.tradingBalance);
    let hasAbsurdQty = false;
    const bigQtyRows = await Trade.find({
      user: req.user._id,
      status: 'OPEN',
      quantity: { $gt: 50_000 },
      isCrypto: { $ne: true },
      exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] },
    })
      .select('quantity originalQty autoSquareHistory')
      .limit(10)
      .lean();
    if (bigQtyRows.length) {
      const { isAbsurdOpenQuantity } = await import('../utils/walletBalanceSanity.js');
      hasAbsurdQty = bigQtyRows.some((r) => isAbsurdOpenQuantity(r));
    }

    if (isAbsurdWalletInr(rawBal) || hasAbsurdQty) {
      try {
        await repairNseBseWalletBalance(req.user._id);
        live = await readNseBseWalletFromDb(req.user._id);
        repaired = true;
      } catch (repairErr) {
        console.error('[nse-bse-wallet] auto-repair failed:', repairErr?.message || repairErr);
      }
    }
    const recalculated = await recalculateUsedMargin(req.user._id);
    const usedMargin = recalculated.nseBseWallet ?? recalculated.wallet ?? live.usedMargin;
    const available = Math.max(0, live.balance - usedMargin);
    const walletUser = await User.findById(req.user._id)
      .select('nseBseWallet.profitBlocked wallet.tradingWalletBlocked')
      .lean();
    const { isWalletProfitBlocked } = await import('../utils/walletBlock.js');
    res.json({
      balance: live.balance,
      usedMargin,
      availableBalance: available,
      transferableBalance: available,
      mainBalance: live.mainBalance,
      balanceRepaired: repaired,
      profitBlocked: isWalletProfitBlocked(walletUser, 'nseBse'),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Internal transfer: Main Wallet ↔ NSE & BSE wallet (Deposit/Withdraw on My Accounts card)
router.post('/internal-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    if (!['toAccount', 'toWallet'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }

    const user = await User.findById(req.user._id).select('adminCode');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const sourceWallet = direction === 'toAccount' ? 'wallet' : 'nseBseWallet';
    const targetWallet = direction === 'toAccount' ? 'nseBseWallet' : 'wallet';

    await WalletTransferService.executeTransfer(
      req.user._id,
      sourceWallet,
      targetWallet,
      amount,
      'Main Wallet ↔ NSE & BSE Wallet',
      null
    );

    const after = await readNseBseWalletFromDb(req.user._id);
    const mainBalance = after.mainBalance;
    const nseBseBalance = after.balance;

    res.json({
      message: 'Transfer successful',
      mainWalletBalance: mainBalance,
      cashBalance: mainBalance,
      nseBseBalance,
      nseBseWallet: { balance: nseBseBalance, usedMargin: after.usedMargin },
      tradingBalance: nseBseBalance,
    });
  } catch (error) {
    console.error('Internal transfer error:', error);
    const status = String(error.message || '').includes('Insufficient') ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

// Crypto transfer between main wallet and crypto account
router.post('/crypto-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    if (!['toCrypto', 'fromCrypto'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { assertWalletOperationsAllowed } = await import('../utils/walletBlock.js');
    assertWalletOperationsAllowed(user, 'cryptoWallet');
    
    // Get current balances
    let mainWalletBalance = user.wallet?.cashBalance || 0;
    if (mainWalletBalance === 0 && user.wallet?.balance > 0) {
      mainWalletBalance = user.wallet.balance;
      user.wallet.cashBalance = mainWalletBalance;
    }
    const cryptoBalance = user.cryptoWallet?.balance || 0;
    
    let newCashBalance, newCryptoBalance, convertedAmount;
    
    if (direction === 'toCrypto') {
      if (amount > mainWalletBalance) {
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ${mainWalletBalance}` });
      }
      convertedAmount = amount;
      newCashBalance = mainWalletBalance - amount;
      newCryptoBalance = cryptoBalance + convertedAmount;
      
    } else {
      if (amount > cryptoBalance) {
        return res.status(400).json({ message: `Insufficient balance in Crypto Account. Available: ${cryptoBalance.toFixed(2)}` });
      }
      convertedAmount = amount;
      newCryptoBalance = cryptoBalance - amount;
      newCashBalance = mainWalletBalance + convertedAmount;
    }
    
    // Use updateOne to avoid full document validation issues
    await User.updateOne(
      { _id: req.user._id },
      { 
        $set: { 
          'wallet.cashBalance': newCashBalance,
          'wallet.balance': newCashBalance,
          'cryptoWallet.balance': newCryptoBalance
        }
      }
    );
    
    // Create ledger entry for the transfer
    const description = direction === 'toCrypto'
      ? `Crypto Transfer: Main → Crypto (${amount.toLocaleString()})`
      : `Crypto Transfer: Crypto → Main (${convertedAmount.toLocaleString()})`;
    
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: direction === 'toCrypto' ? 'DEBIT' : 'CREDIT',
      reason: 'CRYPTO_TRANSFER',
      amount: direction === 'toCrypto' ? amount : amount,
      balanceAfter: newCashBalance,
      description,
      reference: {
        type: 'Manual',
        id: null
      }
    });
    
    res.json({
      message: 'Transfer successful',
      mainWalletBalance: newCashBalance,
      cryptoBalance: newCryptoBalance,
      convertedAmount,
      currency: 'INR'
    });
  } catch (error) {
    console.error('Crypto transfer error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Forex wallet transfer (Stockex coins) — main cash ↔ forex trading balance
router.post('/forex-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    if (!['toForex', 'fromForex'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { assertWalletOperationsAllowed: assertForexWallet } = await import('../utils/walletBlock.js');
    assertForexWallet(user, 'forexWallet');

    let mainWalletBalance = user.wallet?.cashBalance || 0;
    if (mainWalletBalance === 0 && user.wallet?.balance > 0) {
      mainWalletBalance = user.wallet.balance;
      user.wallet.cashBalance = mainWalletBalance;
    }
    const forexBalance = user.forexWallet?.balance || 0;
    let newCashBalance;
    let newForexBalance;

    if (direction === 'toForex') {
      if (amount > mainWalletBalance) {
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ${mainWalletBalance}` });
      }
      newCashBalance = mainWalletBalance - amount;
      newForexBalance = forexBalance + amount;
    } else {
      if (amount > forexBalance) {
        return res.status(400).json({ message: `Insufficient balance in Forex Account. Available: ${forexBalance.toFixed(2)}` });
      }
      newForexBalance = forexBalance - amount;
      newCashBalance = mainWalletBalance + amount;
    }

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          'wallet.cashBalance': newCashBalance,
          'wallet.balance': newCashBalance,
          'forexWallet.balance': newForexBalance,
        },
      }
    );

    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: direction === 'toForex' ? 'DEBIT' : 'CREDIT',
      reason: 'FOREX_TRANSFER',
      amount,
      balanceAfter: newCashBalance,
      description:
        direction === 'toForex'
          ? `Forex Transfer: Main → Forex (${amount.toLocaleString()})`
          : `Forex Transfer: Forex → Main (${amount.toLocaleString()})`,
      reference: { type: 'Manual', id: null },
    });

    res.json({
      message: 'Transfer successful',
      mainWalletBalance: newCashBalance,
      forexBalance: newForexBalance,
      currency: 'INR',
    });
  } catch (error) {
    console.error('Forex transfer error:', error);
    res.status(500).json({ message: error.message });
  }
});

// MCX transfer between main wallet and MCX account
router.post('/mcx-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    if (!['toMcx', 'fromMcx'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { assertWalletOperationsAllowed: assertMcxWallet } = await import('../utils/walletBlock.js');
    assertMcxWallet(user, 'mcxWallet');
    
    // Get current balances
    let mainWalletBalance = user.wallet?.cashBalance || 0;
    if (mainWalletBalance === 0 && user.wallet?.balance > 0) {
      mainWalletBalance = user.wallet.balance;
      user.wallet.cashBalance = mainWalletBalance;
    }
    const mcxBalance = user.mcxWallet?.balance || 0;
    const mcxUsedMargin = user.mcxWallet?.usedMargin || 0;
    const availableMcxBalance = mcxBalance - mcxUsedMargin;
    
    let newCashBalance, newMcxBalance;
    
    if (direction === 'toMcx') {
      // Transfer from Main Wallet to MCX Account
      if (amount > mainWalletBalance) {
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ${mainWalletBalance.toLocaleString()}` });
      }
      
      newCashBalance = mainWalletBalance - amount;
      newMcxBalance = mcxBalance + amount;
      
    } else {
      // Transfer from MCX Account to Main Wallet
      // Allow withdrawal of free margin only
      if (amount > availableMcxBalance) {
        return res.status(400).json({ 
          message: `Insufficient free margin. Available for withdrawal: ${availableMcxBalance.toLocaleString()}. Used margin: ${mcxUsedMargin.toLocaleString()}` 
        });
      }
      
      newMcxBalance = mcxBalance - amount;
      newCashBalance = mainWalletBalance + amount;
    }
    
    // Use updateOne to avoid full document validation issues
    await User.updateOne(
      { _id: req.user._id },
      { 
        $set: { 
          'wallet.cashBalance': newCashBalance,
          'wallet.balance': newCashBalance,
          'mcxWallet.balance': newMcxBalance
        }
      }
    );
    
    // Create ledger entry for the transfer
    const description = direction === 'toMcx' 
      ? `MCX Transfer: Wallet → MCX Account (${amount.toLocaleString()})`
      : `MCX Transfer: MCX Account → Wallet (${amount.toLocaleString()})`;
    
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: direction === 'toMcx' ? 'DEBIT' : 'CREDIT',
      reason: 'MCX_TRANSFER',
      amount: amount,
      balanceAfter: newCashBalance,
      description,
      reference: {
        type: 'Manual',
        id: null
      }
    });
    
    res.json({ 
      message: 'Transfer successful',
      mainWalletBalance: newCashBalance,
      mcxBalance: newMcxBalance
    });
  } catch (error) {
    console.error('MCX transfer error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Games transfer between main wallet and Games account
router.post('/games-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    if (!['toGames', 'fromGames'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { assertWalletOperationsAllowed: assertGamesWallet } = await import('../utils/walletBlock.js');
    assertGamesWallet(user, 'gamesWallet');
    
    // Get current balances
    let mainWalletBalance = user.wallet?.cashBalance || 0;
    if (mainWalletBalance === 0 && user.wallet?.balance > 0) {
      mainWalletBalance = user.wallet.balance;
      user.wallet.cashBalance = mainWalletBalance;
    }
    const gamesBalance = user.gamesWallet?.balance || 0;

    let updated;
    if (direction === 'toGames') {
      if (amount > mainWalletBalance) {
        return res.status(400).json({
          message: `Insufficient balance in Main Wallet. Available: ${mainWalletBalance.toLocaleString()}`,
        });
      }
      updated = await User.findOneAndUpdate(
        { _id: req.user._id },
        {
          $inc: {
            'wallet.cashBalance': -amount,
            'wallet.balance': -amount,
            'gamesWallet.balance': amount,
          },
        },
        { new: true, select: 'wallet.cashBalance gamesWallet.balance' }
      );
    } else {
      if (amount > gamesBalance) {
        return res.status(400).json({
          message: `Insufficient balance in Games account. Balance: ${gamesBalance.toLocaleString()}`,
        });
      }
      updated = await User.findOneAndUpdate(
        {
          _id: req.user._id,
          'gamesWallet.balance': { $gte: amount },
        },
        [
          {
            $set: {
              'wallet.cashBalance': {
                $add: [{ $toDouble: { $ifNull: ['$wallet.cashBalance', 0] } }, amount],
              },
              'wallet.balance': {
                $add: [{ $toDouble: { $ifNull: ['$wallet.balance', 0] } }, amount],
              },
              'gamesWallet.balance': {
                $subtract: [{ $toDouble: { $ifNull: ['$gamesWallet.balance', 0] } }, amount],
              },
              'gamesWallet.usedMargin': {
                $min: [
                  { $toDouble: { $ifNull: ['$gamesWallet.usedMargin', 0] } },
                  {
                    $subtract: [{ $toDouble: { $ifNull: ['$gamesWallet.balance', 0] } }, amount],
                  },
                ],
              },
            },
          },
        ],
        { new: true, select: 'wallet.cashBalance gamesWallet.balance' }
      );
      if (!updated) {
        return res.status(400).json({
          message: `Insufficient balance in Games account. Balance: ${gamesBalance.toLocaleString()}`,
        });
      }
    }

    const newCashBalance =
      updated?.wallet?.cashBalance ??
      (direction === 'toGames' ? mainWalletBalance - amount : mainWalletBalance + amount);
    const newGamesBalance =
      updated?.gamesWallet?.balance ??
      (direction === 'toGames' ? gamesBalance + amount : gamesBalance - amount);

    // Create ledger entry for the transfer
    const description = direction === 'toGames' 
      ? `Games Transfer: Wallet → Games Account (${amount.toLocaleString()})`
      : `Games Transfer: Games Account → Wallet (${amount.toLocaleString()})`;
    
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: direction === 'toGames' ? 'DEBIT' : 'CREDIT',
      reason: 'GAMES_TRANSFER',
      amount: amount,
      balanceAfter: newCashBalance,
      description,
      reference: {
        type: 'Manual',
        id: null
      }
    });

    const transferAt = new Date();
    await recordGamesWalletLedger(user._id, {
      gameId: direction === 'toGames' ? 'transfer_in' : 'transfer_out',
      entryType: direction === 'toGames' ? 'credit' : 'debit',
      amount,
      balanceAfter: newGamesBalance,
      orderPlacedAt: transferAt,
      description:
        direction === 'toGames'
          ? 'Main wallet → Games account'
          : 'Games account → Main wallet',
    });
    
    res.json({ 
      message: 'Transfer successful',
      mainWalletBalance: newCashBalance,
      gamesBalance: newGamesBalance
    });
  } catch (error) {
    console.error('Games transfer error:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
