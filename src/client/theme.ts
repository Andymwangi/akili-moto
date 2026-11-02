export type ColorTheme = 'light' | 'dark';

type ThemeStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;

const THEME_STORAGE_KEY = 'akili-moto-theme';

export function resolveTheme(storage: ThemeStorage, prefersLight: boolean): ColorTheme {
  try {
    const preference = storage.getItem(THEME_STORAGE_KEY);
    if (preference === 'light' || preference === 'dark') return preference;
  } catch {
    // Theme selection can still follow the system when storage is unavailable.
  }
  return prefersLight ? 'light' : 'dark';
}

export function persistTheme(storage: ThemeStorage, theme: ColorTheme): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection remains usable for the current session without storage.
  }
}
