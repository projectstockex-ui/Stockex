import GameSettings from '../models/GameSettings.js';

export async function getAllowEditSubordinateClientValues() {
  const settings = await GameSettings.getSettings();
  return settings?.adminHierarchyClientSettings?.allowEditSubordinateClientValues === true;
}

/**
 * Whether actor may view/edit a user's segment settings.
 * Direct clients (matching adminCode) are always allowed for the owning admin role.
 */
export function canManageUserSegmentSettings(actorAdmin, targetUser, allowSubordinateClients) {
  if (!actorAdmin || !targetUser) return false;
  if (actorAdmin.role === 'SUPER_ADMIN') return true;

  const isDirectClient = targetUser.adminCode === actorAdmin.adminCode;
  if (isDirectClient) return true;

  if (!allowSubordinateClients) return false;

  const actorId = String(actorAdmin._id || '');
  return (targetUser.hierarchyPath || []).some((id) => String(id) === actorId);
}
