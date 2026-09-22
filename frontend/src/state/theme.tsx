import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'tracker.theme';

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemTheme();
}

type ThemeValue = { mode: ThemeMode; resolved: ResolvedTheme; setMode: (mode: ThemeMode) => void };

const ThemeContext = createContext<ThemeValue>({ mode: 'system', resolved: 'light', setMode: () => {} });

function storedMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/**
 * Applies `data-theme` on <html> so CSS tokens switch, and persists the choice.
 * Follows the OS automatically while the mode is `system`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(storedMode()));

  useEffect(() => {
    setResolved(resolve(mode));
    document.documentElement.dataset.theme = resolve(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = query.matches ? 'dark' : 'light';
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(THEME_KEY, next);
    setModeState(next);
  }, []);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
