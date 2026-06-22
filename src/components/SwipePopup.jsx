import React from 'react';
import { Avatar, SportBadge, Icons } from './atoms.jsx';
import { daysRemaining, memberStatus, fmtDate, fmtTime, durationLabel, isUnlimitedSub } from '../utils.js';
import { useT } from '../i18n.jsx';

/* The card stays on screen until the operator dismisses it (click ×, the
   overlay, or press Esc). Back-to-back swipes queue behind it. */
export default function SwipePopup({ event, queued, onDismiss }) {
  const t = useT();
  const { kind, member } = event;

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (kind === 'unknown') {
    return (
      <div className="popup-layer" onClick={onDismiss}>
        <div className="swipe-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label={t('Unknown tag')}>
          <div className="swipe-band unknown" />
          <div className="swipe-head">
            <span className="badge red">{t('Unknown tag')}</span>
            <span className="swipe-time mono">{fmtTime(event.at)}</span>
            <button className="x-btn" onClick={onDismiss} aria-label={t('Dismiss')}>×</button>
          </div>
          <div className="swipe-body">
            <div className="avatar lg" style={{ background: 'var(--raised)', color: 'var(--red)' }}>?</div>
            <div>
              <div className="swipe-name" style={{ color: 'var(--red)' }}>{t('UNKNOWN TAG')}</div>
              <div className="swipe-rows">
                <div><span className="k">{t('Tag UID')}</span><span className="v mono">{event.rfidUid}</span></div>
                <div><span className="k">{t('Action')}</span><span className="v">{t('Not registered — check with reception')}</span></div>
              </div>
            </div>
          </div>
          {queued > 0 && <div className="swipe-queue-hint">{t('+{queued} waiting', { queued })}</div>}
        </div>
      </div>
    );
  }

  const status = memberStatus(member);
  const days = daysRemaining(member);
  const isSession = member.membershipType === 'session';
  const expired = status === 'expired';
  const owed = isSession && member.sessionsLeft < 0;
  const entering = kind === 'in';

  return (
    <div className="popup-layer" onClick={onDismiss}>
      <div className="swipe-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label={entering ? t('Member entry') : t('Member exit')}>
        <div className={`swipe-band ${entering ? 'in' : 'out'}`} />
        <div className="swipe-head">
          <span className={`badge ${entering ? 'green' : 'red'}`}>{entering ? t('→ Entry') : t('← Exit')}</span>
          <span className="swipe-time mono">{fmtTime(event.at)}</span>
          <button className="x-btn" onClick={onDismiss} aria-label={t('Dismiss')}>×</button>
        </div>
        <div className="swipe-body">
          <Avatar member={member} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="swipe-name">{member.name}</div>
            <div className="live-meta" style={{ marginTop: 8 }}>
              {member.sports.map((s) => <SportBadge key={s} sport={s} />)}
            </div>
            <div className="swipe-rows">
              <div>
                <span className="k">{t('Membership')}</span>
                <span className="v">{isSession ? t('Pay-per-session') : t('Subscription')}</span>
              </div>
              {isSession ? (
                <div>
                  <span className="k">{t('Sessions left')}</span>
                  <span className="v mono" style={{ color: member.sessionsLeft > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {member.sessionsLeft}{owed ? t('  (club owes {n})', { n: Math.abs(member.sessionsLeft) }) : ''}
                  </span>
                </div>
              ) : (
                <>
                  <div>
                    <span className="k">{t('Subscription ends')}</span>
                    <span className="v mono" style={{ color: expired ? 'var(--red)' : 'var(--text)' }}>{fmtDate(member.subEnd)}</span>
                  </div>
                  <div>
                    <span className="k">{t('Days remaining')}</span>
                    <span className="v mono" style={{ color: expired ? 'var(--red)' : 'var(--green)' }}>
                      {days > 0 ? t('{days} days', { days }) : (Math.abs(days) === 1 ? t('expired {n} day ago', { n: Math.abs(days) }) : t('expired {n} days ago', { n: Math.abs(days) }))}
                    </span>
                  </div>
                  <div>
                    <span className="k">{t('Sessions')}</span>
                    {isUnlimitedSub(member)
                      ? <span className="v">{t('Unlimited')}</span>
                      : <span className="v mono" style={{ color: member.sessionsLeft > 0 ? 'var(--green)' : 'var(--red)' }}>{t('{n} left', { n: member.sessionsLeft })}</span>}
                  </div>
                </>
              )}
              <div><span className="k">{t('Last visit')}</span><span className="v">{fmtDate(member.lastVisit)}</span></div>
              {!entering && (
                <div><span className="k">{t('Stay duration')}</span><span className="v mono">{durationLabel(event.at - event.entryTime)}</span></div>
              )}
            </div>
          </div>
        </div>
        {expired && (
          <div className="swipe-warning">
            <Icons.warn width="18" height="18" />
            {isSession
              ? (owed ? t('OUT OF SESSIONS — club owes {n}, collect payment', { n: Math.abs(member.sessionsLeft) }) : t('NO SESSIONS LEFT — contact staff'))
              : t('SUBSCRIPTION EXPIRED — contact staff')}
          </div>
        )}
        {!expired && !isSession && days <= 7 && (
          <div className="swipe-warning amber">
            <Icons.warn width="18" height="18" /> {days === 1 ? t('Subscription ends in {days} day', { days }) : t('Subscription ends in {days} days', { days })}
          </div>
        )}
        {queued > 0 && <div className="swipe-queue-hint">{t('+{queued} waiting', { queued })}</div>}
      </div>
    </div>
  );
}
