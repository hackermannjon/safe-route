import { create } from 'zustand';

export type ColorScheme = 'dark' | 'light';

/** Also read by the inline script in index.html, which applies it before the first paint. */
export const THEME_STORAGE_KEY = 'safe-route:theme';

function storedChoice(): ColorScheme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

interface ThemeState {
  /** The driver's pick; null follows the system. */
  choice: ColorScheme | null;
  choose: (scheme: ColorScheme) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  choice: storedChoice(),
  choose: (choice) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Private windows may refuse storage; the pick still holds for this visit.
    }
    set({ choice });
  },
}));
