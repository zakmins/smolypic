import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getAuthToken, setAuthToken, setUnauthorizedHandler } from './api.js';

export const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [ready, setReady] = useState(false);   // false until an existing token is validated

  // A 401 from any request clears the session and drops us back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setCurrentUser(null));
  }, []);

  // Resume an existing session on load: a stored token is validated against /me.
  useEffect(() => {
    let live = true;
    const token = getAuthToken();
    if (!token) { setReady(true); return undefined; }
    api('/me')
      .then((u) => { if (live) setCurrentUser(u); })
      .catch(() => { if (live) setAuthToken(null); })
      .finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api('/login', { method: 'POST', body: { username, password } });
    setAuthToken(token);
    setCurrentUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* token may already be gone */ }
    setAuthToken(null);
    setCurrentUser(null);
  }, []);

  const value = useMemo(
    () => ({ currentUser, token: getAuthToken(), ready, login, logout }),
    [currentUser, ready, login, logout],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
