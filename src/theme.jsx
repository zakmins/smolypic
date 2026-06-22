import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'smolympic-theme';
export const ThemeCtx = createContext({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return 'dark';
  });

  // Attribute is set synchronously (here and in toggle) so chart components
  // resolving CSS variables during render always read the active theme.
  document.documentElement.dataset.theme = theme;

  useEffect(() => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      return next;
    });
  }, []);
  // Set a specific theme (used when applying a user's saved preference).
  const applyTheme = useCallback((next) => {
    if (next !== 'dark' && next !== 'light') return;
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, []);
  const value = useMemo(() => ({ theme, toggleTheme, setTheme: applyTheme }), [theme, toggleTheme, applyTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Resolve 'var(--x)' color strings to concrete values; recomputed on theme change
 *  so Recharts (which sets SVG attributes, not CSS) follows the active theme. */
export function useResolveColor() {
  const { theme } = useTheme();
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const cache = {};
    return (c, fallback = '#10D98E') => {
      if (!c) return fallback;
      const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
      if (!m) return c;
      if (!(m[1] in cache)) cache[m[1]] = style.getPropertyValue(m[1]).trim() || fallback;
      return cache[m[1]];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
