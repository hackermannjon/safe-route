import { useCallback, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useThemeStore, type ColorScheme } from '../stores/useThemeStore';
import { useMediaQuery } from './useMediaQuery';

export type { ColorScheme };

/**
 * Dark is the product default; light when the OS asks for it, unless the driver picked one.
 * The pick goes on the root element, where the tokens read it, before any effect below runs,
 * so the map reads the new palette when it restyles.
 */
export function useColorScheme(): { theme: ColorScheme; toggleTheme: () => void } {
  const system: ColorScheme = useMediaQuery('(prefers-color-scheme: light)') ? 'light' : 'dark';
  const choice = useThemeStore((s) => s.choice);
  const choose = useThemeStore((s) => s.choose);
  const theme = choice ?? system;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (choice) root.dataset.theme = choice;
    else delete root.dataset.theme;
  }, [choice]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || still) {
      choose(next);
      return;
    }
    // The snapshot is taken once the callback returns, so the new palette must be committed by then.
    document.startViewTransition(() => flushSync(() => choose(next)));
  }, [choose, theme]);
  return { theme, toggleTheme };
}
