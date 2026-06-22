// Smolympic data client. This is a desktop app: the SQLite database lives in the
// Electron main process and is reached over IPC (window.smolympic.api) — there is
// no HTTP server. The api(path, opts) signature is unchanged, so callers don't care.
const TOKEN_KEY = 'smolympic-token';

// Token lives in localStorage and a module cache so every request can attach it.
let authToken = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export const getAuthToken = () => authToken;

/** The auth provider registers a handler here so a 401 anywhere bounces to login. */
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body } = {}) {
  const bridge = typeof window !== 'undefined' && window.smolympic && window.smolympic.api;
  if (!bridge) {
    throw new Error('Smolympic must run in the desktop app (Electron). Start it with: npm run electron:dev');
  }

  const res = await window.smolympic.api({ method, path, body, token: authToken });

  if (res.status === 401) {
    setAuthToken(null);
    if (onUnauthorized) onUnauthorized();
    throw new Error('Your session has expired — please sign in again.');
  }
  if (res.status >= 400) {
    throw new Error(res.error || 'Request failed');
  }
  return res.data;
}
