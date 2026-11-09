import { replaceEqualDeep } from '@tanstack/react-query';
import type { PlayerProfile } from '../shared/schemas/quiz';

function isProfile(value: unknown): value is PlayerProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'playerId' in value &&
    typeof value.playerId === 'string'
  );
}

/**
 * The server returns a recovery code only when it is created or rotated, so a
 * background refetch would otherwise wipe it from the screen before the player
 * has saved it. Keep it for the same player for the rest of this page session.
 * It is never written to browser storage.
 */
export function keepRecoveryCode(previous: unknown, next: unknown): unknown {
  if (!isProfile(previous) || !isProfile(next)) return next;
  if (next.recoveryCode || !previous.recoveryCode || previous.playerId !== next.playerId) {
    return next;
  }
  return { ...next, recoveryCode: previous.recoveryCode };
}

/** Query `structuralSharing` hook: keeps the code and preserves unchanged references. */
export function shareProfileData(previous: unknown, next: unknown): unknown {
  return replaceEqualDeep(previous, keepRecoveryCode(previous, next));
}
