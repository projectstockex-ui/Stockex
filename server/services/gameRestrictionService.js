import Admin from '../models/Admin.js';
import User from '../models/User.js';
import GameSettings from '../models/GameSettings.js';
import { collectHierarchyAdminIds } from '../utils/hierarchyAdminIds.js';

/** Canonical keys — match GameSettings.games.* and wallet ledger meta.gameKey */
export const HIERARCHY_BLOCKABLE_GAME_KEYS = [
  'niftyUpDown',
  'btcUpDown',
  'niftyNumber',
  'niftyBracket',
  'niftyJackpot',
  'btcJackpot',
  'btcNumber',
];

const ALLOWED = new Set(HIERARCHY_BLOCKABLE_GAME_KEYS);
const MAX_DENY_GAMES = 32;

/** Client / API → stored deny list */
export function sanitizeGameDenylist(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, MAX_DENY_GAMES)) {
    let k = '';
    if (typeof item === 'string') k = item.trim();
    else if (item && typeof item === 'object' && typeof item.gameKey === 'string') k = item.gameKey.trim();
    if (ALLOWED.has(k)) out.push(k);
  }
  return [...new Set(out)];
}

async function mergeGameDenylistForAdminIds(idsOrdered) {
  if (!idsOrdered?.length) return [];
  const docs = await Admin.find({ _id: { $in: idsOrdered } })
    .select('restrictions.gameDenylist')
    .lean();
  const byId = Object.fromEntries(docs.map((d) => [String(d._id), d]));
  const merged = [];
  for (const id of idsOrdered) {
    const list = byId[String(id)]?.restrictions?.gameDenylist;
    if (Array.isArray(list)) merged.push(...list.filter((x) => ALLOWED.has(String(x))));
  }
  return [...new Set(merged)];
}

/** Admin document only (e.g. merging denies along one admin node's ancestor IDs). */
export async function getMergedGameDenylist(adminDoc) {
  if (!adminDoc?._id) return [];
  const ids = collectHierarchyAdminIds({
    hierarchyPath: adminDoc.hierarchyPath,
    admin: adminDoc,
  });
  return mergeGameDenylistForAdminIds(ids);
}

/**
 * User row (+ populated admin) or any object with optional hierarchyPath + admin.
 * Unions User.hierarchyPath with manager chain so sub-broker denies apply even when user.admin is stale.
 */
export async function getMergedGameDenylistForPrincipal(userLike) {
  const ids = collectHierarchyAdminIds(userLike);
  return mergeGameDenylistForAdminIds(ids);
}

function labelForGameKey(gameKey) {
  const labels = {
    niftyUpDown: 'Nifty Up/Down',
    btcUpDown: 'BTC Up/Down',
    niftyNumber: 'Nifty Number',
    niftyBracket: 'Nifty Bracket',
    niftyJackpot: 'Nifty Jackpot',
    btcJackpot: 'BTC Jackpot',
    btcNumber: 'BTC Number',
  };
  return labels[gameKey] || gameKey;
}

export async function assertHierarchyGameNotDenied(user, gameKey) {
  if (!ALLOWED.has(gameKey)) return;

  // Only check if games are enabled globally and if the specific game is enabled
  // Hierarchy-based game blocking has been removed - only superadmin can enable/disable games
  try {
    const gameSettings = await GameSettings.getSettings();
    const globalGamesEnabled = gameSettings?.gamesEnabled ?? true; // Default to enabled if not set
    const gameEnabled = gameSettings?.games?.[gameKey]?.enabled ?? true; // Default to enabled if not set

    // If games are globally disabled or specific game is disabled, block access
    if (!globalGamesEnabled) {
      console.log('[GameRestriction] Games are globally disabled in GameSettings');
      throw new Error('Games are currently unavailable');
    }

    if (!gameEnabled) {
      console.log('[GameRestriction] Game', gameKey, 'is disabled in GameSettings');
      throw new Error(`${labelForGameKey(gameKey)} is currently disabled`);
    }

    console.log('[GameRestriction] Games are globally enabled and', gameKey, 'is enabled in GameSettings, allowing access');
  } catch (error) {
    if (error.message.includes('disabled') || error.message.includes('unavailable')) {
      throw error;
    }
    console.error('[GameRestriction] Error checking GameSettings:', error.message);
  }
}

export async function assertHierarchyGameNotDeniedForUserId(userId, gameKey) {
  const user = await User.findById(userId).populate({
    path: 'admin',
    select: 'restrictions hierarchyPath role adminCode',
  });
  await assertHierarchyGameNotDenied(user, gameKey);
}
