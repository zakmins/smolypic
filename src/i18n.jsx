import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FR } from './translations.js';

// Language preference + a tiny translation helper. UI strings are written in
// English in the JSX and wrapped in t(); the French copy lives in translations.js
// keyed by the exact English source string. Missing keys fall back to English.
const KEY = 'smolympic-lang';
export const LANGUAGES = [
  ['en', 'English'],
  ['fr', 'Français'],
];
export const LangCtx = createContext({ language: 'en', setLanguage: () => {}, t: (s) => s });

// Replace {token} placeholders from a vars object.
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'fr' || saved === 'en') return saved;
    } catch { /* storage unavailable */ }
    return 'en';
  });

  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(KEY, language); } catch { /* ignore */ }
  }, [language]);

  const setLanguage = useCallback((l) => setLanguageState(l === 'fr' ? 'fr' : 'en'), []);

  const t = useCallback((str, vars) => {
    const base = language === 'fr' ? (FR[str] ?? str) : str;
    return interpolate(base, vars);
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useLanguage = () => useContext(LangCtx);
// Convenience hook for components that only need the translate function.
export const useT = () => useContext(LangCtx).t;
