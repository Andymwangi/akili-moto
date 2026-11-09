const PLAYER_NAME_CACHE_KEY = 'akili-moto.player-state';

export type CachedPlayerState = Readonly<{
  displayName: string;
  resume: boolean;
}>;

export function getCachedPlayerState(): CachedPlayerState | null {
  try {
    const stored = window.localStorage.getItem(PLAYER_NAME_CACHE_KEY);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!('displayName' in parsed) || typeof parsed.displayName !== 'string') return null;
    if (!('resume' in parsed) || typeof parsed.resume !== 'boolean') return null;

    const { displayName, resume } = parsed;
    if (displayName.length < 2 || displayName.length > 24) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(displayName)) return null;
    return { displayName, resume };
  } catch {
    return null;
  }
}

export function getCachedPlayerName(): string | null {
  return getCachedPlayerState()?.displayName ?? null;
}

export function cachePlayerName(displayName: string, resume = true): void {
  try {
    window.localStorage.setItem(
      PLAYER_NAME_CACHE_KEY,
      JSON.stringify({ displayName, resume } satisfies CachedPlayerState),
    );
  } catch {
    // The server profile remains authoritative when browser storage is unavailable.
  }
}

export type ResumeDecision = Readonly<{ startGame: boolean; cache?: CachedPlayerState }>;

/**
 * Decides, once per player identity, whether to skip the name screen.
 * A profile created on this request starts on the name screen; a player who
 * started before in this browser resumes; a signed-in identity with no browser
 * record (storage was cleared) is treated as returning.
 */
export function decideResume(input: {
  displayName: string;
  isNewProfile: boolean;
  cached: CachedPlayerState | null;
}): ResumeDecision {
  const { displayName, isNewProfile, cached } = input;
  if (isNewProfile) return { startGame: false, cache: { displayName, resume: false } };
  if (cached?.resume) {
    return cached.displayName === displayName
      ? { startGame: true }
      : { startGame: true, cache: { displayName, resume: true } };
  }
  if (!cached) return { startGame: true, cache: { displayName, resume: true } };
  return { startGame: false };
}
