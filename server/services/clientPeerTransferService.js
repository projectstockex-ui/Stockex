import mongoose from 'mongoose';
import User from '../models/User.js';
import WalletLedger from '../models/WalletLedger.js';
import Notification from '../models/Notification.js';
import {
  buildHierarchyPeerTransferFilter,
  getHierarchyScopeMeta,
  usersShareSameHierarchyScope,
} from '../utils/clientPeerTransferHierarchy.js';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function getMainWalletCash(user) {
  const cash = Number(user?.wallet?.cashBalance);
  if (Number.isFinite(cash) && cash > 0) return round2(cash);
  return round2(Number(user?.wallet?.balance) || 0);
}

function normalizeUserId(id) {
  return String(id || '').trim().toUpperCase();
}

async function sameHierarchyScope(sender, recipient) {
  return usersShareSameHierarchyScope(sender, recipient);
}

export async function resolveRecipientForSender(senderId, recipientUserId) {
  const rid = normalizeUserId(recipientUserId);
  if (!rid) {
    const err = new Error('Recipient User ID is required');
    err.statusCode = 400;
    throw err;
  }

  const sender = await User.findById(senderId)
    .select('_id userId username fullName adminCode admin hierarchyPath isActive isDemo wallet.cashBalance wallet.balance')
    .lean();
  if (!sender) {
    const err = new Error('Sender not found');
    err.statusCode = 404;
    throw err;
  }

  if (normalizeUserId(sender.userId) === rid) {
    const err = new Error('You cannot transfer to your own account');
    err.statusCode = 400;
    throw err;
  }

  const recipient = await User.findOne({ userId: new RegExp(`^${rid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
    .select('_id userId username fullName adminCode admin hierarchyPath isActive isDemo')
    .lean();

  if (!recipient) {
    const err = new Error('Recipient not found. Check the User ID.');
    err.statusCode = 404;
    throw err;
  }

  if (!recipient.isActive) {
    const err = new Error('Recipient account is not active');
    err.statusCode = 400;
    throw err;
  }

  if (sender.isDemo || recipient.isDemo) {
    const err = new Error('Transfers are not allowed for demo accounts');
    err.statusCode = 400;
    throw err;
  }

  if (!(await sameHierarchyScope(sender, recipient))) {
    const err = new Error(
      'You can only transfer to clients under the same hierarchy (same Admin tree)'
    );
    err.statusCode = 403;
    throw err;
  }

  return {
    sender,
    recipient: {
      _id: recipient._id,
      userId: recipient.userId,
      username: recipient.username,
      fullName: recipient.fullName,
      displayName: recipient.fullName || recipient.username || recipient.userId,
    },
  };
}

export async function lookupRecipient(senderId, recipientUserId) {
  const { recipient } = await resolveRecipientForSender(senderId, recipientUserId);
  return { recipient };
}

/**
 * Clients eligible for peer transfer (same ADMIN hierarchy, active, not demo, not self).
 */
export async function listEligibleClients(senderId, { search = '', limit = 300 } = {}) {
  const sender = await User.findById(senderId)
    .select('_id userId adminCode admin hierarchyPath')
    .lean();
  if (!sender) return { clients: [], total: 0, scope: null };

  const { filter, mode, adminRootId } = await buildHierarchyPeerTransferFilter(sender);
  if (!filter) return { clients: [], total: 0, scope: null };

  const lim = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 500);
  const term = String(search || '').trim();
  if (term.length >= 1) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ userId: rx }, { username: rx }, { fullName: rx }] },
    ];
  }

  const rows = await User.find(filter)
    .select('userId username fullName admin')
    .populate('admin', 'name username adminCode role')
    .sort({ fullName: 1, username: 1, userId: 1 })
    .limit(lim)
    .lean();

  const scopeMeta =
    mode === 'hierarchy' && adminRootId ? await getHierarchyScopeMeta(adminRootId) : null;

  const clients = rows.map((u) => {
    const mgr = u.admin && typeof u.admin === 'object' ? u.admin : null;
    const managerLabel = mgr
      ? `${mgr.name || mgr.username || mgr.adminCode || 'Manager'}${mgr.adminCode ? ` (${mgr.adminCode})` : ''}`
      : '';
    return {
      userId: u.userId,
      username: u.username || '',
      fullName: u.fullName || '',
      displayName: u.fullName || u.username || u.userId,
      managerLabel,
      managerRole: mgr?.role || '',
    };
  });

  return {
    clients,
    total: clients.length,
    scope: scopeMeta
      ? {
          type: 'hierarchy',
          adminName: scopeMeta.adminName,
          adminCode: scopeMeta.adminCode,
        }
      : { type: mode === 'adminCode_fallback' ? 'direct_manager' : mode },
  };
}

export async function executePeerTransfer(senderId, { recipientUserId, amount, remarks = '' }) {
  const transferAmount = round2(amount);
  if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
    const err = new Error('Transfer amount must be greater than 0');
    err.statusCode = 400;
    throw err;
  }

  const { sender, recipient } = await resolveRecipientForSender(senderId, recipientUserId);
  const senderCash = getMainWalletCash(sender);

  if (transferAmount > senderCash + 0.01) {
    const err = new Error(
      `Insufficient Main Wallet balance. Available: ${senderCash.toLocaleString('en-IN')}`
    );
    err.statusCode = 400;
    throw err;
  }

  const transferId = `PT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const note = String(remarks || '').trim().slice(0, 200);
  const adminCode = sender.adminCode || recipient.adminCode || 'SYSTEM';

  const debitSender = await User.findOneAndUpdate(
    {
      _id: sender._id,
      $or: [
        { 'wallet.cashBalance': { $gte: transferAmount - 0.01 } },
        { 'wallet.balance': { $gte: transferAmount - 0.01 } },
      ],
    },
    {
      $inc: {
        'wallet.cashBalance': -transferAmount,
        'wallet.balance': -transferAmount,
      },
    },
    { new: true }
  );

  if (!debitSender) {
    const err = new Error('Insufficient Main Wallet balance or transfer could not be completed');
    err.statusCode = 400;
    throw err;
  }

  const creditRecipient = await User.findByIdAndUpdate(
    recipient._id,
    {
      $inc: {
        'wallet.cashBalance': transferAmount,
        'wallet.balance': transferAmount,
      },
    },
    { new: true }
  );

  if (!creditRecipient) {
    await User.updateOne(
      { _id: sender._id },
      {
        $inc: {
          'wallet.cashBalance': transferAmount,
          'wallet.balance': transferAmount,
        },
      }
    );
    const err = new Error('Recipient wallet update failed. Your balance was restored.');
    err.statusCode = 500;
    throw err;
  }

  const senderBalanceAfter = getMainWalletCash(debitSender);
  const recipientBalanceAfter = getMainWalletCash(creditRecipient);

  const senderDesc =
    `Sent ${transferAmount.toLocaleString('en-IN')} to ${recipient.displayName} (${recipient.userId})` +
    (note ? ` — ${note}` : '');
  const recipientDesc =
    `Received ${transferAmount.toLocaleString('en-IN')} from ${sender.fullName || sender.username || sender.userId}` +
    (note ? ` — ${note}` : '');

  await WalletLedger.create([
    {
      ownerType: 'USER',
      ownerId: sender._id,
      adminCode,
      type: 'DEBIT',
      reason: 'CLIENT_TRANSFER_OUT',
      amount: transferAmount,
      balanceAfter: senderBalanceAfter,
      description: senderDesc,
      reference: { type: 'Manual', id: null },
      meta: {
        transferId,
        counterpartyUserId: recipient._id,
        counterpartyPublicId: recipient.userId,
        counterpartyName: recipient.displayName,
        remarks: note,
      },
    },
    {
      ownerType: 'USER',
      ownerId: recipient._id,
      adminCode,
      type: 'CREDIT',
      reason: 'CLIENT_TRANSFER_IN',
      amount: transferAmount,
      balanceAfter: recipientBalanceAfter,
      description: recipientDesc,
      reference: { type: 'Manual', id: null },
      meta: {
        transferId,
        counterpartyUserId: sender._id,
        counterpartyPublicId: sender.userId,
        counterpartyName: sender.fullName || sender.username || sender.userId,
        remarks: note,
      },
    },
  ]);

  try {
    await Notification.create({
      title: 'Wallet transfer received',
      subject: `${transferAmount.toLocaleString('en-IN')} credited to Main Wallet`,
      description: recipientDesc,
      senderType: 'SYSTEM',
      targetType: 'SINGLE_USER',
      targetUserId: recipient._id,
      priority: 'HIGH',
    });
  } catch {
    /* optional */
  }

  return {
    success: true,
    transferId,
    amount: transferAmount,
    senderBalanceAfter,
    recipientBalanceAfter,
    recipient: {
      userId: recipient.userId,
      username: recipient.username,
      fullName: recipient.fullName,
      displayName: recipient.displayName,
    },
  };
}

export async function getPeerTransferHistory(userId, { limit = 50 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const oid = new mongoose.Types.ObjectId(userId);

  const rows = await WalletLedger.find({
    ownerType: 'USER',
    ownerId: oid,
    reason: { $in: ['CLIENT_TRANSFER_IN', 'CLIENT_TRANSFER_OUT'] },
  })
    .sort({ createdAt: -1 })
    .limit(lim)
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    transferId: row.meta?.transferId || null,
    type: row.type,
    reason: row.reason,
    direction: row.reason === 'CLIENT_TRANSFER_OUT' ? 'sent' : 'received',
    amount: round2(row.amount),
    balanceAfter: round2(row.balanceAfter),
    description: row.description,
    counterpartyUserId: row.meta?.counterpartyPublicId || null,
    counterpartyName: row.meta?.counterpartyName || null,
    remarks: row.meta?.remarks || '',
    createdAt: row.createdAt,
  }));
}

export default {
  lookupRecipient,
  listEligibleClients,
  executePeerTransfer,
  getPeerTransferHistory,
  getMainWalletCash,
};
