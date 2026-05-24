/** Round to 2 decimals (paise) for transfer comparisons */
export function roundTransferAmount(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Format INR for transfer UI/errors */
export function fmtTransferInr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Client-side error when amount exceeds transferable (matches server wording). */
export function buildTransferInsufficientError(details, amount) {
  if (!details) return 'Transfer amount exceeds available balance.';
  const { displayName, totalBalance, usedMargin, transferable } = details;
  const amt = roundTransferAmount(amount);
  const max = roundTransferAmount(transferable);
  if (usedMargin > 0 && amt > max) {
    return (
      `You have already used margin (${fmtTransferInr(usedMargin)}) in open trades. You can transfer up to ${fmtTransferInr(max)} only (not more). ` +
      `(${displayName} balance: ${fmtTransferInr(totalBalance)} − Used margin: ${fmtTransferInr(usedMargin)} = Transferable: ${fmtTransferInr(transferable)})`
    );
  }
  return `Insufficient balance in ${displayName}. Maximum you can transfer is ${fmtTransferInr(transferable)}.`;
}

export function validateTransferAmount(limits, sourceWallet, amount) {
  const details = limits?.[sourceWallet];
  if (!details) return { valid: true };
  const amt = roundTransferAmount(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { valid: false, error: 'Enter a valid transfer amount greater than 0' };
  }
  const max = roundTransferAmount(details.transferable);
  if (amt > max) {
    return { valid: false, error: buildTransferInsufficientError(details, amt) };
  }
  return { valid: true };
}
