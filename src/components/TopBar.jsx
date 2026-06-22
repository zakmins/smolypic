import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { dzd, initials } from '../utils.js';
import { Icons } from './atoms.jsx';
import { useLanguage } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import FreeSessionModal from './FreeSessionModal.jsx';

export default function TopBar() {
  const { presence, today, simulateSwipe, addGuestSession } = useContext(AppCtx);
  const { language, t } = useLanguage();
  const { currentUser, logout } = useAuth();
  const [now, setNow] = useState(new Date());
  const [freeSession, setFreeSession] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  // Guests drop off the floor once their 2h window lapses — count only active ones.
  const insideNow = presence.filter((p) => !p.guest || p.expiresAt > now.getTime()).length;

  return (
    <header className="topbar">
      <div>
        <div className="clock">{hh}:{mm}<small>:{ss}</small></div>
        <div className="clock-date">{now.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>
      <div className="top-divider" />
      <div className="topstat">
        <div className="v" style={{ color: 'var(--green)' }}>{insideNow}</div>
        <div className="k">{t('Inside now')}</div>
      </div>
      <div className="topstat">
        <div className="v">{today.entries}</div>
        <div className="k">{t('Entries today')}</div>
      </div>
      <div className="top-divider" />
      <div className="topstat">
        <div className="v mono">{dzd(today.sessionRevenue)}</div>
        <div className="k">{today.sessionCount === 1 ? t('{n} session today', { n: today.sessionCount }) : t('{n} sessions today', { n: today.sessionCount })}</div>
      </div>
      <div className="topstat">
        <div className="v mono">{dzd(today.subscriptionRevenue)}</div>
        <div className="k">{today.subscriptionCount === 1 ? t('{n} subscription today', { n: today.subscriptionCount }) : t('{n} subscriptions today', { n: today.subscriptionCount })}</div>
      </div>
      <div className="top-actions">
        {import.meta.env.DEV && (
          <button className="btn sm ghost" onClick={simulateSwipe} title={t('Test only: emulates a real RFID reader scanning a tag (or press S anywhere)')} aria-label={t('Simulate RFID scan (test)')}>
            <Icons.swipe width="15" height="15" /> {t('Test scan')}
          </button>
        )}
        <button className="btn primary" onClick={() => setFreeSession(true)} title={t('Add a walk-in paid session to the floor')}>
          <Icons.plus width="16" height="16" /> {t('Session')}
        </button>
        <div className="top-divider" />
        {currentUser && (
          <div className="topuser" title={t('Signed in as {name}', { name: currentUser.fullName || currentUser.username })}>
            <div className="topuser-swatch" style={{ background: currentUser.color }} aria-hidden="true">
              {initials(currentUser.fullName || currentUser.username)}
            </div>
            <div className="topuser-meta">
              <div className="topuser-name">{currentUser.fullName || currentUser.username}</div>
              <div className="topuser-role">{currentUser.role === 'admin' ? t('Administrator') : t('Coach')}</div>
            </div>
          </div>
        )}
        <button className="icon-btn" onClick={logout} title={t('Sign out')} aria-label={t('Sign out')}>
          <Icons.logout width="17" height="17" />
        </button>
      </div>
      {freeSession && (
        <FreeSessionModal
          onClose={() => setFreeSession(false)}
          onAdd={(name, amount) => { addGuestSession(name, amount); setFreeSession(false); }}
        />
      )}
    </header>
  );
}
