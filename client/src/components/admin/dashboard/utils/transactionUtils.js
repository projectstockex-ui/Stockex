/**
 * Transaction utility functions for AdminDashboard
 */

/**
 * Format transaction reference for display
 * @param {object} tx - Transaction object
 * @returns {string} Formatted reference
 */
export function formatAllTxReference(tx) {
  const r = tx.reference;
  if (!r || !r.type) return '—';
  const id = r.id ? String(r.id).slice(-10) : '';
  return id ? `${r.type} ·…${id}` : r.type;
}

/**
 * Superadmin platform ledger: mirror client line (client CREDIT → your DEBIT; client DEBIT → your CREDIT).
 * @param {object} tx - Transaction object
 * @returns {object} Transaction state with amountStr, badge, amountCls
 */
export function yourAccountFromClientTx(tx) {
  const amt = Number(tx.amount) || 0;
  const abs = amt.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  /** Pool / Kuber rows — already "your" DEBIT/CREDIT, do not flip. */
  if (tx.saPoolDebit || tx.kuberWalletTx) {
    if (tx.type === 'DEBIT') {
      return {
        state: 'DEBIT',
        amountStr: `−${abs}`,
        badge: 'bg-red-500/20 text-red-300',
        amountCls: 'text-red-400',
      };
    }
    return {
      state: 'CREDIT',
      amountStr: `+${abs}`,
      badge: 'bg-green-500/20 text-green-300',
      amountCls: 'text-green-400',
    };
  }

  if (tx.type === 'CREDIT') {
    return {
      state: 'DEBIT',
      amountStr: `−${abs}`,
      badge: 'bg-red-500/20 text-red-300',
      amountCls: 'text-red-400',
    };
  }

  return {
    state: 'CREDIT',
    amountStr: `+${abs}`,
    badge: 'bg-green-500/20 text-green-300',
    amountCls: 'text-green-400',
  };
}

/**
 * All transaction segments for filtering
 */
export const ALL_TX_SEGMENTS = [
  { id: 'users', label: 'Users', hint: 'Trading wallet ledger', color: 'bg-blue-600' },
  { id: 'admin', label: 'Admins', hint: 'ADMIN role', color: 'bg-purple-600' },
  { id: 'broker', label: 'Brokers', hint: 'BROKER role', color: 'bg-indigo-600' },
  { id: 'sub_broker', label: 'Sub-Brokers', hint: 'SUB_BROKER role', color: 'bg-pink-600' },
  { id: 'demo', label: 'Demo', hint: 'Demo accounts', color: 'bg-gray-600' },
  { id: 'games', label: 'Games', hint: 'Game transactions', color: 'bg-yellow-600' },
  { id: 'mcx', label: 'MCX', hint: 'MCX segment', color: 'bg-orange-600' },
  { id: 'crypto', label: 'Crypto', hint: 'Crypto segment', color: 'bg-cyan-600' },
  { id: 'forex', label: 'Forex', hint: 'Forex segment', color: 'bg-teal-600' },
];
