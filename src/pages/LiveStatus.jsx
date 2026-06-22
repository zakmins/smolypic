import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { api } from '../api.js';
import { Avatar, SportBadge, MembershipBadge, Icons } from '../components/atoms.jsx';
import { hhmmss, fmtTime, fmtDate, durationLabel, daysRemaining, memberStatus, usesSessionQuota, isSessionsOwed, expiringReason, initials, dzd } from '../utils.js';
import { useT } from '../i18n.jsx';

const TWO_HOURS = 2 * 3600 * 1000;

export default function LiveStatus() {
  const { members, presence, exits, today, setRoute, setFocusMemberId, removeGuestSession } = useContext(AppCtx);
  const t = useT();
  const [, tick] = useState(0);
  const [modal, setModal] = useState(null);   // 'inside' | 'exits' | 'subscribed' | 'entries' | 'owed' | 'expiring' | null
  const [subscribed, setSubscribed] = useState(null);   // fetched on open
  const [entriesToday, setEntriesToday] = useState(null);
  const [owedList, setOwedList] = useState(null);
  const [expiringList, setExpiringList] = useState(null);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Recomputed every tick so counts stay live and the 2h window rolls forward.
  const now = Date.now();

  const insideRows = [...presence]
    .filter((p) => !p.guest || p.expiresAt > now)   // walk-ins drop off after their 2h window
    .sort((a, b) => b.entryTime - a.entryTime)
    .map((p) => (p.guest ? p : { ...p, member: members.find((m) => m.id === p.memberId) }))
    .filter((p) => p.guest || p.member);

  const recentExits = exits
    .filter((x) => now - x.exitTime <= TWO_HOURS)
    .map((x) => ({ ...x, member: members.find((m) => m.id === x.memberId) }))
    .filter((x) => x.member)
    .sort((a, b) => b.exitTime - a.exitTime);

  // Counts shown on the KPI cards stay live off the tick — they recompute from
  // `members`, which both the swipe and renew responses refresh in AppCtx.
  const owedCount = members.filter(isSessionsOwed).length;
  const expiringCount = members.filter((m) => expiringReason(m) != null).length;

  // Lists for the fetched modals load lazily when their card is opened.
  useEffect(() => {
    if (modal === 'subscribed') {
      setSubscribed(null);
      api('/live/subscribed-today').then(setSubscribed).catch(() => setSubscribed([]));
    } else if (modal === 'entries') {
      setEntriesToday(null);
      api('/live/entries-today').then(setEntriesToday).catch(() => setEntriesToday([]));
    } else if (modal === 'owed') {
      setOwedList(null);
      api('/live/sessions-owed').then(setOwedList).catch(() => setOwedList([]));
    } else if (modal === 'expiring') {
      setExpiringList(null);
      api('/live/expiring-soon').then(setExpiringList).catch(() => setExpiringList([]));
    }
  }, [modal]);

  // Registered member → Members page with their drawer open. Walk-ins have no profile.
  const goToMember = (id) => { setFocusMemberId(id); setRoute('customers'); setModal(null); };

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  // ── row renderers (reuse .live-row / .exit-row) ──
  const memberRow = (row) => {
    const { member, entryTime } = row;
    const status = memberStatus(member);
    const expired = status === 'expired';
    const isSession = member.membershipType === 'session';
    const usesSessions = usesSessionQuota(member);   // pay-per-session or metered sub
    const days = daysRemaining(member);
    return (
      <div key={`m-${member.id}`} className={`live-row ${expired ? 'expired' : ''}`}
        onClick={() => goToMember(member.id)} role="button" title={t("Open {name}'s profile", { name: member.name })}>
        <Avatar member={member} />
        <div style={{ minWidth: 0 }}>
          <div className="live-name">
            {member.name}{' '}
            {expired && <Icons.warn width="14" height="14" style={{ color: 'var(--red)', verticalAlign: '-2px' }} />}
          </div>
          <div className="live-meta">
            {member.sports.map((s) => <SportBadge key={s} sport={s} />)}
            <MembershipBadge member={member} />
          </div>
        </div>
        <div>
          <div className="live-timer" style={{ color: expired ? 'var(--red)' : isSession ? 'var(--amber)' : 'var(--green)' }}>
            {hhmmss(now - entryTime)}
          </div>
          <div className={`live-remaining ${expired ? 'warn' : ''}`}>
            {usesSessions
              ? (member.sessionsLeft > 0
                  ? (member.sessionsLeft === 1 ? t('{n} session left', { n: member.sessionsLeft }) : t('{n} sessions left', { n: member.sessionsLeft }))
                  : t('{n} sessions — see staff', { n: member.sessionsLeft }))
              : (days > 0 ? t('{n} days remaining', { n: days }) : t('subscription expired'))}
          </div>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{t('in')} {fmtTime(entryTime)}</div>
      </div>
    );
  };

  const guestRow = (row) => {
    const minsLeft = Math.max(0, Math.ceil((row.expiresAt - now) / 60000));
    return (
      <div key={`g-${row.guestId}`} className="live-row guest">
        <div className="avatar" style={{ background: 'var(--amber)' }} aria-hidden="true">{initials(row.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="live-name">{row.name}</div>
          <div className="live-meta">
            <span className="badge amber">{t('Session')}</span>
            <span className="badge neutral mono">{dzd(row.amount)}</span>
          </div>
        </div>
        <div>
          <div className="live-timer" style={{ color: 'var(--amber)' }}>{hhmmss(now - row.entryTime)}</div>
          <div className="live-remaining">{t('{n} min left', { n: minsLeft })}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{t('in')} {fmtTime(row.entryTime)}</span>
          <button className="icon-btn" style={{ width: 30, height: 30 }} title={t('Remove from floor')}
            aria-label={t('Remove {name} from the floor', { name: row.name })} onClick={() => removeGuestSession(row.guestId)}>
            <Icons.trash width="15" height="15" />
          </button>
        </div>
      </div>
    );
  };

  const subscriberRow = (s, i) => {
    const m = s.member;
    return (
      <div key={`s-${m.id}-${i}`} className="live-row" onClick={() => goToMember(m.id)}
        role="button" title={t("Open {name}'s profile", { name: m.name })}>
        <Avatar member={m} />
        <div style={{ minWidth: 0 }}>
          <div className="live-name">{m.name}</div>
          <div className="live-meta">
            {m.sports.map((sp) => <SportBadge key={sp} sport={sp} />)}
            <MembershipBadge member={m} />
          </div>
        </div>
        <div>
          <div className="live-timer" style={{ color: 'var(--green)', fontSize: 16 }}>{dzd(s.amount)}</div>
          <div className="live-remaining">{t('paid')} {fmtTime(s.paymentTime)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{s.durationLabel}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{t('ends')} {fmtDate(s.subEnd)}</div>
        </div>
      </div>
    );
  };

  const entryRow = (e, i) => {
    const inside = e.exitTime == null;
    if (e.guest) {
      return (
        <div key={`eg-${e.guestId}-${i}`} className="live-row guest">
          <div className="avatar" style={{ background: 'var(--amber)' }} aria-hidden="true">{initials(e.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="live-name">{e.name}</div>
            <div className="live-meta"><span className="badge amber">{t('Session')}</span></div>
          </div>
          <div>
            {inside
              ? <div className="live-timer" style={{ color: 'var(--amber)' }}>{hhmmss(now - e.entryTime)}</div>
              : <div className="live-remaining">{t('Exited {time}', { time: fmtTime(e.exitTime) })}</div>}
            {inside && <div className="live-remaining">{t('Inside')}</div>}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{t('in')} {fmtTime(e.entryTime)}</div>
        </div>
      );
    }
    const m = e.member;
    return (
      <div key={`em-${m.id}-${i}`} className="live-row" onClick={() => goToMember(m.id)}
        role="button" title={t("Open {name}'s profile", { name: m.name })}>
        <Avatar member={m} />
        <div style={{ minWidth: 0 }}>
          <div className="live-name">{m.name}</div>
          <div className="live-meta">
            {m.sports.map((sp) => <SportBadge key={sp} sport={sp} />)}
            <MembershipBadge member={m} />
          </div>
        </div>
        <div>
          {inside
            ? <div className="live-timer" style={{ color: 'var(--green)' }}>{hhmmss(now - e.entryTime)}</div>
            : <div className="live-remaining">{t('Exited {time}', { time: fmtTime(e.exitTime) })}</div>}
          {inside && <div className="live-remaining" style={{ color: 'var(--green)' }}>{t('Inside')}</div>}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{t('in')} {fmtTime(e.entryTime)}</div>
      </div>
    );
  };

  const owedRow = (o) => {
    const m = o.member;
    return (
      <div key={`o-${m.id}`} className="live-row" onClick={() => goToMember(m.id)}
        role="button" title={t("Open {name}'s profile", { name: m.name })}>
        <Avatar member={m} />
        <div style={{ minWidth: 0 }}>
          <div className="live-name">{m.name}</div>
          <div className="live-meta">
            {m.sports.map((sp) => <SportBadge key={sp} sport={sp} />)}
            <MembershipBadge member={m} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="live-name" style={{ color: 'var(--red)', fontSize: 14 }}>{o.owed === 1 ? t('owes {n} session', { n: o.owed }) : t('owes {n} sessions', { n: o.owed })}</div>
          <div className="live-remaining">{t('collect {amount}', { amount: dzd(o.amountToCollect) })}</div>
        </div>
      </div>
    );
  };

  const expiringRow = (r) => {
    const m = r.member;
    const dateRed = r.reason === 'date' || r.reason === 'both';
    const sessRed = r.reason === 'sessions' || r.reason === 'both';
    return (
      <div key={`x-${m.id}`} className="live-row" onClick={() => goToMember(m.id)}
        role="button" title={t("Open {name}'s profile", { name: m.name })}>
        <Avatar member={m} />
        <div style={{ minWidth: 0 }}>
          <div className="live-name">{m.name}</div>
          <div className="live-meta">
            {m.sports.map((sp) => <SportBadge key={sp} sport={sp} />)}
            <MembershipBadge member={m} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="live-name" style={{ fontSize: 14, color: dateRed ? 'var(--red)' : 'var(--text)' }}>
            {r.daysRemaining === 1 ? t('{n} day left', { n: r.daysRemaining }) : t('{n} days left', { n: r.daysRemaining })}
          </div>
          <div className="live-remaining" style={sessRed ? { color: 'var(--red)', fontWeight: 800 } : undefined}>
            {r.sessionsLeft == null ? t('Unlimited') : (r.sessionsLeft === 1 ? t('{n} session left', { n: r.sessionsLeft }) : t('{n} sessions left', { n: r.sessionsLeft }))}
          </div>
        </div>
      </div>
    );
  };

  const card = (key, label, count, sub, color) => (
    <div className="stat-card clickable" role="button" tabIndex={0}
      onClick={() => setModal(key)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') setModal(key); }}>
      <Icons.arrow className="kpi-arrow" width="18" height="18" />
      <div className="k">{label}</div>
      <div className="v" style={color ? { color } : undefined}>{count}</div>
      <div className="sub">{sub}</div>
    </div>
  );

  const titles = { inside: t('Currently inside'), exits: t('Recent exits'), subscribed: t('Subscribed today'), entries: t('Entries today'), owed: t('Sessions owed'), expiring: t('Expiring soon') };
  const counts = { inside: insideRows.length, exits: recentExits.length, subscribed: today.subscriptionCount, entries: today.entries, owed: owedCount, expiring: expiringCount };

  const renderBody = () => {
    if (modal === 'inside') {
      return insideRows.length === 0
        ? <div className="empty-state">{t('Nobody on the floor. The next swipe lands here.')}</div>
        : insideRows.map((row) => (row.guest ? guestRow(row) : memberRow(row)));
    }
    if (modal === 'exits') {
      return recentExits.length === 0
        ? <div className="empty-state">{t('No exits in the last 2 hours.')}</div>
        : recentExits.map((x, i) => (
          <div key={`x-${x.memberId}-${i}`} className="exit-row" onClick={() => goToMember(x.member.id)}
            role="button" title={t("Open {name}'s profile", { name: x.member.name })}>
            <Avatar member={x.member} size="sm" />
            <div>
              <div className="exit-name">{x.member.name}</div>
              <div className="exit-meta">{t('stayed')} {durationLabel(x.exitTime - x.entryTime)}</div>
            </div>
            <div className="exit-time">{t('out')} {fmtTime(x.exitTime)}</div>
          </div>
        ));
    }
    if (modal === 'subscribed') {
      if (subscribed == null) return <div className="empty-state">{t('Loading…')}</div>;
      return subscribed.length === 0
        ? <div className="empty-state">{t('No subscriptions started or renewed today.')}</div>
        : subscribed.map(subscriberRow);
    }
    if (modal === 'entries') {
      if (entriesToday == null) return <div className="empty-state">{t('Loading…')}</div>;
      return entriesToday.length === 0
        ? <div className="empty-state">{t('No entries yet today.')}</div>
        : entriesToday.map(entryRow);
    }
    if (modal === 'owed') {
      if (owedList == null) return <div className="empty-state">{t('Loading…')}</div>;
      return owedList.length === 0
        ? <div className="empty-state">{t('Nobody is owed sessions — all balances are square.')}</div>
        : owedList.map(owedRow);
    }
    if (modal === 'expiring') {
      if (expiringList == null) return <div className="empty-state">{t('Loading…')}</div>;
      return expiringList.length === 0
        ? <div className="empty-state">{t('No memberships about to lapse.')}</div>
        : expiringList.map(expiringRow);
    }
    return null;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Live gym status')}</div>
          <div className="page-sub">{t('Entrance reader feed — swipes update this board in real time.')}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {card('inside', t('Currently inside'), insideRows.length, t('on the floor'), 'var(--green)')}
        {card('exits', t('Recent exits'), recentExits.length, t('left in the last 2 hours'))}
        {card('subscribed', t('Subscribed today'), today.subscriptionCount, t('started or renewed today'))}
        {card('entries', t('Entries today'), today.entries, t('swipes & sessions today'))}
        {card('expiring', t('Expiring soon'), expiringCount, t('lapsing on date or sessions'), expiringCount ? 'var(--red)' : undefined)}
        {card('owed', t('Sessions owed'), owedCount, t('club owes — collect payment'), owedCount ? 'var(--amber)' : undefined)}
      </div>

      {modal && (
        <div className="modal-center" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titles[modal]}>
            <div className="modal-head">
              <div className="modal-title">{titles[modal]}</div>
              <span className="panel-sub" style={{ marginLeft: 12 }}>{t('{n} total', { n: counts[modal] })}</span>
              <button className="x-btn" onClick={() => setModal(null)} aria-label={t('Close')}>×</button>
            </div>
            <div className="modal-body kpi-list" style={{ padding: 0 }}>{renderBody()}</div>
          </div>
        </div>
      )}
    </>
  );
}
