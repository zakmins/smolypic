import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Kiosk/device settings, not per-account: whether the shared front-desk PC
// speaks out loud is a property of the room, not of who's currently signed
// in, so — unlike theme/language — this deliberately isn't synced through
// /me/preferences. localStorage only, same read/write shape as theme.jsx.
const ENABLED_KEY = 'smolympic-tts-enabled';
const VOICE_KEY = 'smolympic-tts-voice';

export const TtsCtx = createContext({ enabled: true, setEnabled: () => {}, voice: 'female', setVoice: () => {} });

export function TtsProvider({ children }) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      const saved = localStorage.getItem(ENABLED_KEY);
      if (saved === '0') return false;
    } catch { /* storage unavailable */ }
    return true;
  });
  const [voice, setVoiceState] = useState(() => {
    try {
      const saved = localStorage.getItem(VOICE_KEY);
      if (saved === 'male' || saved === 'female') return saved;
    } catch { /* storage unavailable */ }
    return 'female';
  });

  useEffect(() => {
    try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
  }, [enabled]);
  useEffect(() => {
    try { localStorage.setItem(VOICE_KEY, voice); } catch { /* ignore */ }
  }, [voice]);

  const setEnabled = useCallback((v) => setEnabledState(!!v), []);
  const setVoice = useCallback((v) => { if (v === 'male' || v === 'female') setVoiceState(v); }, []);

  const value = useMemo(() => ({ enabled, setEnabled, voice, setVoice }), [enabled, setEnabled, voice, setVoice]);
  return <TtsCtx.Provider value={value}>{children}</TtsCtx.Provider>;
}

export const useTts = () => useContext(TtsCtx);
