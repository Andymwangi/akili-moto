const PLAYER_NAME_CACHE_KEY = 'akili-moto.player-state';

type CachedPlayerState = Readonly<{
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
