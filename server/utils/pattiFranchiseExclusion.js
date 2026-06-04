/**
 * Individual patti sharing and franchise ₹/crore are mutually exclusive per admin.
 */

export const PATTI_FRANCHISE_CONFLICT_MSG =
  'Individual Patti Sharing and Franchise cannot be active on the same admin. Disable Patti Sharing first, or turn off Franchise root.';

export function isIndividualPattiSharingEnabled(admin) {
  return admin?.pattiSharing?.enabled === true;
}

/** Turn off franchise root + clear subtree ₹/crore when patti is enabled on this admin. */
export async function disableFranchiseForPattiAdmin(admin) {
  if (!admin || admin.isFranchiseRoot !== true) return { cleared: null };
  const { clearFranchiseSubtreeRates } = await import('./franchiseBrokerage.js');
  admin.isFranchiseRoot = false;
  if (admin.restrictMode) {
    admin.restrictMode.brokerageChargePerCrore = 0;
    admin.markModified('restrictMode');
  }
  const cleared = await clearFranchiseSubtreeRates(admin._id);
  return { cleared };
}
