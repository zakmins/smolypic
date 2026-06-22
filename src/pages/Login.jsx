import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useT } from '../i18n.jsx';

export default function Login() {
  const t = useT();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true); setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || t('Could not sign in'));
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card panel" onSubmit={submit}>
        <div className="login-head">
          <div className="page-title" style={{ fontSize: 22 }}>{t('Sign in')}</div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>{t('Username')}</label>
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder={t('e.g. smail')} autoComplete="username" />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>{t('Password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="current-password" />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="btn primary" style={{ width: '100%', justifyContent: 'center' }}
          disabled={busy || !username.trim() || !password}>
          {busy ? t('Signing in…') : t('Sign in')}
        </button>
      </form>
    </div>
  );
}
