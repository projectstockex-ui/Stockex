/** Franchise mode uses /crore fields — segment brokerage UI is hidden. */

export function isAdminFranchiseBrokerageActive(admin) {
  if (!admin) return false;
  return admin.isFranchiseRoot === true || admin.franchiseSubtreeActive === true;
}

export function isUserFranchiseBrokerageActive(user) {
  if (!user) return false;
  return user.franchiseActive === true;
}
