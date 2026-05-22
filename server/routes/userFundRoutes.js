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
import { protectUser } from '../middleware/auth.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';

/** Short labels matching user Accounts UI (cash vs Trading naming). */
function subwalletLedgerLabel(walletType) {
  switch (walletType) {
    case 'wallet':
      return 'Main Wallet (cash)';
    case 'cryptoWallet':
      return 'Crypto account (₹)';
    case 'forexWallet':
      return 'Forex account (₹)';
    case 'mcxWallet':
      return 'MCX account';
    case 'gamesWallet':
      return 'Games account';
    case 'tradingAccount':
      return 'Trading account (IND)';
    default:
      return walletType || '—';
  }
}

function enrichCashBridgeRow(row, segmentKey) {
  const desc = row.description || '';
  const cash = 'Main Wallet (cash)';
  const sub =
    segmentKey === 'forex'
      ? 'Forex account (₹)'
      : 'Crypto account (₹)';
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
  const tr = 'Trading account';
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
      const [meshRows, directRows] = await Promise.all([
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

      const seen = new Set();
      const combined = [...mesh, ...bridge]
        .filter((e) => {
          const k = `${e.id}-${new Date(e.at).getTime()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, lim);

      return res.json({ entries: combined });
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

    const [meshRows, directRows, pnlRows] = await Promise.all([
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
        description: w === 'crypto' 
          ? { $regex: /\(Crypto\)/ }
          : w === 'forex'
            ? { $regex: /\(Forex\)/ }
            : w === 'mcx'
              ? { $regex: /\(MCX\)/ }
              : { $regex: /\(Games\)/ }
      })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean(),
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
      kind: 'trade_pnl',
      type: row.type,
      description: row.description || '',
      isAutoSquare: row.isAutoSquare || false,
    }));

    const seen = new Set();
    const combined = [...mesh, ...bridge, ...pnlEntries]
      .filter((e) => {
        const k = `${e.id}-${new Date(e.at).getTime()}`;
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
        message: `Withdrawal blocked! Your trading account has negative balance of ₹${Math.abs(effectiveTradingBalance).toLocaleString()}. Please settle your P&L first by depositing funds to your trading account.`,
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
          message: `Minimum withdrawal amount is ₹${admin.charges.minWithdrawal}` 
        });
      }
      if (amount > admin.charges.maxWithdrawal) {
        return res.status(400).json({ 
          message: `Maximum withdrawal amount is ₹${admin.charges.maxWithdrawal}` 
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

// Internal transfer between main wallet and trading account
router.post('/internal-transfer', protectUser, async (req, res) => {
  try {
    const { amount, direction } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    if (!['toAccount', 'toWallet'].includes(direction)) {
      return res.status(400).json({ message: 'Invalid transfer direction' });
    }
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Dual wallet system - handle legacy balance field
    // If cashBalance is 0 but balance has value, use balance as the source
    let mainWalletBalance = user.wallet?.cashBalance || 0;
    if (mainWalletBalance === 0 && user.wallet?.balance > 0) {
      // Migrate legacy balance to cashBalance
      mainWalletBalance = user.wallet.balance;
      user.wallet.cashBalance = mainWalletBalance;
    }
    const tradingBalance = user.wallet?.tradingBalance || 0;
    const usedMargin = user.wallet?.usedMargin || 0;
    const availableTradingBalance = tradingBalance - usedMargin;
    
    let newCashBalance, newTradingBalance;
    
    if (direction === 'toAccount') {
      // Transfer from Main Wallet to Trading Account
      if (amount > mainWalletBalance) {
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ₹${mainWalletBalance}` });
      }
      
      newCashBalance = mainWalletBalance - amount;
      newTradingBalance = tradingBalance + amount;
      
    } else {
      // Transfer from Trading Account to Main Wallet
      // Check if trading account has negative effective balance (including unrealized P&L)
      const unrealizedPnL = user.wallet?.unrealizedPnL || 0;
      const effectiveTradingBalance = tradingBalance + unrealizedPnL;
      
      if (effectiveTradingBalance < 0) {
        return res.status(400).json({ 
          message: `Transfer blocked! Your trading account has negative balance of ₹${Math.abs(effectiveTradingBalance).toLocaleString()}. Please settle your P&L first.`,
          code: 'NEGATIVE_TRADING_BALANCE',
          deficit: Math.abs(effectiveTradingBalance)
        });
      }
      
      // Allow withdrawal of free margin only (trading balance - used margin)
      if (amount > availableTradingBalance) {
        return res.status(400).json({ 
          message: `Insufficient free margin. Available for withdrawal: ₹${availableTradingBalance.toLocaleString()}. Used margin: ₹${usedMargin.toLocaleString()}` 
        });
      }
      
      newTradingBalance = tradingBalance - amount;
      newCashBalance = mainWalletBalance + amount;
    }
    
    // Use updateOne to avoid full document validation issues with segmentPermissions
    await User.updateOne(
      { _id: req.user._id },
      { 
        $set: { 
          'wallet.cashBalance': newCashBalance,
          'wallet.tradingBalance': newTradingBalance,
          'wallet.balance': newCashBalance // Legacy field
        }
      }
    );
    
    // Update local user object for response
    user.wallet.cashBalance = newCashBalance;
    user.wallet.tradingBalance = newTradingBalance;
    
    // Create ledger entry for the transfer
    const description = direction === 'toAccount' 
      ? 'Internal Transfer: Wallet → Trading Account'
      : 'Internal Transfer: Trading Account → Wallet';
    
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: direction === 'toAccount' ? 'DEBIT' : 'CREDIT',
      reason: 'ADJUSTMENT',
      amount: amount,
      balanceAfter: user.wallet.cashBalance,
      description,
      reference: {
        type: 'Manual',
        id: null
      }
    });
    
    res.json({ 
      message: 'Transfer successful',
      mainWalletBalance: user.wallet.cashBalance,
      tradingBalance: user.wallet.tradingBalance
    });
  } catch (error) {
    console.error('Internal transfer error:', error);
    res.status(500).json({ message: error.message });
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
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ₹${mainWalletBalance}` });
      }
      convertedAmount = amount;
      newCashBalance = mainWalletBalance - amount;
      newCryptoBalance = cryptoBalance + convertedAmount;
      
    } else {
      if (amount > cryptoBalance) {
        return res.status(400).json({ message: `Insufficient balance in Crypto Account. Available: ₹${cryptoBalance.toFixed(2)}` });
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
      ? `Crypto Transfer: Main → Crypto (₹${amount.toLocaleString()})`
      : `Crypto Transfer: Crypto → Main (₹${convertedAmount.toLocaleString()})`;
    
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

// Forex wallet transfer (INR) — main cash ↔ forex trading balance
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
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ₹${mainWalletBalance}` });
      }
      newCashBalance = mainWalletBalance - amount;
      newForexBalance = forexBalance + amount;
    } else {
      if (amount > forexBalance) {
        return res.status(400).json({ message: `Insufficient balance in Forex Account. Available: ₹${forexBalance.toFixed(2)}` });
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
          ? `Forex Transfer: Main → Forex (₹${amount.toLocaleString()})`
          : `Forex Transfer: Forex → Main (₹${amount.toLocaleString()})`,
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
        return res.status(400).json({ message: `Insufficient balance in Main Wallet. Available: ₹${mainWalletBalance.toLocaleString()}` });
      }
      
      newCashBalance = mainWalletBalance - amount;
      newMcxBalance = mcxBalance + amount;
      
    } else {
      // Transfer from MCX Account to Main Wallet
      // Allow withdrawal of free margin only
      if (amount > availableMcxBalance) {
        return res.status(400).json({ 
          message: `Insufficient free margin. Available for withdrawal: ₹${availableMcxBalance.toLocaleString()}. Used margin: ₹${mcxUsedMargin.toLocaleString()}` 
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
      ? `MCX Transfer: Wallet → MCX Account (₹${amount.toLocaleString()})`
      : `MCX Transfer: MCX Account → Wallet (₹${amount.toLocaleString()})`;
    
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
          message: `Insufficient balance in Main Wallet. Available: ₹${mainWalletBalance.toLocaleString()}`,
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
          message: `Insufficient balance in Games account. Balance: ₹${gamesBalance.toLocaleString()}`,
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
          message: `Insufficient balance in Games account. Balance: ₹${gamesBalance.toLocaleString()}`,
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
      ? `Games Transfer: Wallet → Games Account (₹${amount.toLocaleString()})`
      : `Games Transfer: Games Account → Wallet (₹${amount.toLocaleString()})`;
    
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
