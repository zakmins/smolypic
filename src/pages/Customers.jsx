import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Avatar, SportBadge, MembershipBadge, Icons } from '../components/atoms.jsx';
import Select from '../components/Select.jsx';
import DatePicker from '../components/DatePicker.jsx';
import { SPORTS, dzd, fmtDate, age, daysRemaining, memberStatus, fmtTime, durationLabel,
  isSubscription, isUnlimitedSub, usesSessionQuota, remainingLabel, pageList,
  insuranceStatus, insuranceDaysLeft, INSURANCE_PRICE,
  subPlans } from '../utils.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import Portal from '../components/Portal.jsx';

const SORTS = {
  name: { label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
  start: { label: 'Start date', fn: (a, b) => new Date(b.subStart) - new Date(a.subStart) },
  end: { label: 'End date', fn: (a, b) => new Date(a.subEnd) - new Date(b.subEnd) },
  paid: { label: 'Amount paid', fn: (a, b) => b.amountPaid - a.amountPaid },
  balance: { label: 'Balance due', fn: (a, b) => (b.balance || 0) - (a.balance || 0) },
};

// Entry-history pager shows 5 visits per page (pageList lives in utils).
const ENTRY_PAGE_SIZE = 5;
// Members table pager.
const MEMBERS_PAGE_SIZE = 50;

export default function Customers() {
  const t = useT();
  const { members, presence, saveMember, renewMember, payInsurance, payBalance, deleteMember, focusMemberId, setFocusMemberId } = useContext(AppCtx);
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('all');
  const [sport, setSport] = useState('all');
  const [status, setStatus] = useState('all');
  const [insurance, setInsurance] = useState('all');
  const [sort, setSort] = useState('name');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);   // member object or 'new'
  const [renewing, setRenewing] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Opened from another page (e.g. the live floor modal): focus that member's drawer.
  useEffect(() => {
    if (focusMemberId != null) {
      setSelected(focusMemberId);
      setFocusMemberId(null);
    }
  }, [focusMemberId, setFocusMemberId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members
      .filter((m) => !needle || m.name.toLowerCase().includes(needle) || (m.phone || '').replace(/\s/g, '').includes(needle.replace(/\s/g, '')))
      .filter((m) => gender === 'all' || m.gender === gender)
      .filter((m) => sport === 'all' || m.sports.includes(sport))
      .filter((m) => {
        if (status === 'all') return true;
        const s = memberStatus(m);
        if (status === 'active') return s === 'active';
        if (status === 'expired') return s === 'expired';
        if (status === 'owing') return m.balance > 0;
        return true;
      })
      .filter((m) => insurance === 'all' || (insurance === 'yes') === m.insurance)
      .sort(SORTS[sort].fn);
  }, [members, q, gender, sport, status, insurance, sort]);

  const sel = selected ? members.find((m) => m.id === selected) : null;

  // Members table: fixed-size pages (mounting hundreds of <tr>s at once is what
  // made the page feel like it "hung" for a moment after jumping here from a KPI
  // modal) — each page still scrolls within itself if it overflows the panel.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, gender, sport, status, insurance, sort]);   // any change ⇒ back to page 1
  const totalPages = Math.max(1, Math.ceil(filtered.length / MEMBERS_PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * MEMBERS_PAGE_SIZE, page * MEMBERS_PAGE_SIZE);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Members')}</div>
          <div className="page-sub">{t('{n} registered · {shown} shown', { n: members.length, shown: filtered.length })}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={() => setEditing('new')}><Icons.plus width="15" height="15" /> {t('New member')}</button>
        </div>
      </div>

      <div className="toolbar">
        <input type="search" placeholder={t('Search name or phone…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search members')} />
        <Select value={gender} onChange={setGender} ariaLabel={t('Filter by gender')}
          options={[['all', t('All genders')], ['M', t('Male')], ['F', t('Female')]]} />
        <Select value={sport} onChange={setSport} ariaLabel={t('Filter by sport')}
          options={[['all', t('All sports')], ...SPORTS.map((s) => [s, t(s[0] + s.slice(1).toLowerCase())])]} />
        <Select value={status} onChange={setStatus} ariaLabel={t('Filter by status')}
          options={[['all', t('Any status')], ['active', t('Active')], ['expired', t('Expired')], ['owing', t('Owing balance')]]} />
        <Select value={insurance} onChange={setInsurance} ariaLabel={t('Filter by insurance')}
          options={[['all', t('Insurance: any')], ['yes', t('Insured')], ['no', t('Not insured')]]} />
        <Select value={sort} onChange={setSort} ariaLabel={t('Sort')}
          options={Object.entries(SORTS).map(([k, v]) => [k, t('Sort: {label}', { label: t(v.label) })])} />
      </div>

      <div className="panel" style={{ overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th></th><th>{t('Member')}</th><th>{t('Phone')}</th><th>{t('Sports')}</th>
                <th>{t('Remaining')}</th><th>{t('Ends')}</th><th>{t('Gender')}</th><th>{t('Insurance')}</th><th>{t('Paid')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((m) => {
                const s = memberStatus(m);
                return (
                  <tr key={m.id} onClick={() => setSelected(m.id)}>
                    <td style={{ width: 50 }}><Avatar member={m} /></td>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td className="mono">{m.phone}</td>
                    <td><div className="live-meta" style={{ margin: 0 }}>{m.sports.map((sp) => <SportBadge key={sp} sport={sp} />)}</div></td>
                    <td className="mono num" style={{ color: s === 'expired' ? 'var(--red)' : 'var(--text)' }}>
                      {remainingLabel(m)}
                    </td>
                    <td className="mono">{fmtDate(m.subEnd)}</td>
                    <td>{m.gender === 'M' ? t('Male') : t('Female')}</td>
                    <td>{m.insurance ? <span className="badge green">✓</span> : <span className="badge neutral">✗</span>}</td>
                    <td className="mono num">
                      {dzd(m.amountPaid)}
                      {m.balance > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>{t('owes {amount}', { amount: dzd(m.balance) })}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="9"><div className="empty-state">{t('No members match these filters. Clear a filter or register a new member.')}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pager" style={{ padding: '12px 14px', margin: 0 }}>
            <button className="pager-btn" disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('Previous page')}>‹ {t('Prev')}</button>
            {pageList(page, totalPages).map((p, idx) => (p === '…'
              ? <span key={`gap-${idx}`} className="pager-gap">…</span>
              : <button key={p} className={`pager-btn ${p === page ? 'on' : ''}`}
                  aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="pager-btn" disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={t('Next page')}>{t('Next')} ›</button>
          </div>
        )}
      </div>

      {sel && (
        <MemberDrawer member={sel} presence={presence}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(sel)}
          onRenew={() => setRenewing(sel)}
          onCollect={() => setCollecting(sel)}
          onPayInsurance={payInsurance}
          onDelete={() => setConfirmDelete(sel)} />
      )}
      {editing && (
        <MemberForm member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(m) => { saveMember(m); setEditing(null); }} />
      )}
      {renewing && (
        <RenewForm member={renewing} onClose={() => setRenewing(null)}
          onSave={(payload) => { renewMember(renewing.id, payload); setRenewing(null); }} />
      )}
      {collecting && (
        <CollectBalanceForm member={collecting} onClose={() => setCollecting(null)}
          onSave={(amount) => { payBalance(collecting.id, amount); setCollecting(null); }} />
      )}
      {confirmDelete && (
        <Portal>
        <div className="modal-center" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{t('Delete member')}</div></div>
            <div className="modal-body">
              {t('Delete ')}<strong>{confirmDelete.name}</strong>{t(' and their RFID tag assignment? Entry history will be kept for accounting. This can\'t be undone.')}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>{t('Keep member')}</button>
              <button className="btn danger" onClick={() => { deleteMember(confirmDelete.id); setConfirmDelete(null); setSelected(null); }}>{t('Delete member')}</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}

function MemberDrawer({ member: m, presence, onClose, onEdit, onRenew, onCollect, onPayInsurance, onDelete }) {
  const t = useT();
  const { pricing } = useContext(AppCtx);
  const insurancePrice = pricing?.insurance ?? INSURANCE_PRICE;
  const ins = insuranceStatus(m);
  const days = daysRemaining(m);
  const usesSessions = usesSessionQuota(m);   // metered sub
  const pct = usesSessions
    ? Math.max(0, Math.min(100, (m.sessionsLeft / m.sessionsTotal) * 100))
    : Math.max(0, Math.min(100, (days / m.durationDays) * 100));
  const barClass = pct <= 15 ? 'low' : pct <= 40 ? 'mid' : '';
  const insideNow = presence.some((p) => p.memberId === m.id);

  const [visits, setVisits] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let live = true;
    setVisits(null); setPage(1);
    // Pull the full history once; the pager below pages through it client-side.
    api(`/members/${m.id}/entries?limit=1000`).then((v) => live && setVisits(v)).catch(() => live && setVisits([]));
    return () => { live = false; };
  }, [m.id]);
  const totalPages = visits ? Math.max(1, Math.ceil(visits.length / ENTRY_PAGE_SIZE)) : 1;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('{name} profile', { name: m.name })}>
        <div className="modal-head">
          <div className="modal-title">{t('Member profile')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
            <Avatar member={m} size="lg" />
            <div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 22 }}>{m.name}</div>
              <div className="live-meta" style={{ marginTop: 6 }}>
                {m.sports.map((s) => <SportBadge key={s} sport={s} />)}
                <MembershipBadge member={m} />
                {insideNow && <span className="badge green">● {t('Inside now')}</span>}
                {memberStatus(m) === 'expired' && <span className="badge red">{t('Expired')}</span>}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              <span>{usesSessions ? t('Sessions remaining') : t('Subscription progress')}</span>
              <span className="mono" style={{ fontFamily: 'var(--mono)' }}>
                {usesSessions
                  ? <>{`${m.sessionsLeft} / ${m.sessionsTotal}`}{m.sessionsLeft < 0 ? t(' — club owes {n}', { n: Math.abs(m.sessionsLeft) }) : ''}</>
                  : <>{`${Math.max(days, 0)} / ${m.durationDays} `}{t('days')}</>}
              </span>
            </div>
            <div className="progress"><div className={barClass} style={{ width: `${pct}%` }} /></div>
          </div>

          <div className="kv">
            <span className="k">{t('Date of birth')}</span><span className="v">{m.dob ? `${fmtDate(m.dob)} · ${t('{n} yrs', { n: age(m.dob) })}` : '—'}</span>
            <span className="k">{t('Phone')}</span><span className="v mono">{m.phone}</span>
            <span className="k">{t('Gender')}</span><span className="v">{m.gender === 'M' ? t('Male') : t('Female')}</span>
            {m.bloodType && <><span className="k">{t('Blood type')}</span><span className="v">{m.bloodType}</span></>}
            <span className="k">{t('RFID tag')}</span><span className="v mono">{m.rfidUid}</span>
            <span className="k">{t('Subscription')}</span><span className="v">{fmtDate(m.subStart)} → {fmtDate(m.subEnd)}</span>
            {isSubscription(m) && <><span className="k">{t('Access')}</span><span className="v">{isUnlimitedSub(m) ? t('Unlimited') : t('Metered — {left} / {total} sessions', { left: m.sessionsLeft, total: m.sessionsTotal })}</span></>}
            <span className="k">{t('Amount paid')}</span><span className="v mono">{dzd(m.amountPaid)}</span>
            {m.balance > 0 && <><span className="k">{t('Balance due')}</span><span className="v mono" style={{ color: 'var(--red)', fontWeight: 700 }}>{dzd(m.balance)}</span></>}
            <span className="k">{t('Last payment')}</span><span className="v">{fmtDate(m.paymentDate)}</span>
            <span className="k">{t('Last visit')}</span><span className="v">{fmtDate(m.lastVisit)}</span>
          </div>

          {/* Insurance — a 500 DZD fee paid once per year, renewed annually */}
          <div className="ins-card">
            <Icons.shield width="20" height="20" className={`ins-ico ${ins}`} />
            <div style={{ minWidth: 0 }}>
              <div className="ins-title">
                {ins === 'none' ? t('Not insured') : ins === 'active' ? t('Insured') : t('Insurance expired')}
              </div>
              <div className="ins-sub">
                {ins === 'none'
                  ? t('{price} DZD / year', { price: insurancePrice })
                  : ins === 'active'
                    ? (insuranceDaysLeft(m) === 1
                      ? t('Valid until {date} · {n} day left', { date: fmtDate(m.insuranceExpiry), n: insuranceDaysLeft(m) })
                      : t('Valid until {date} · {n} days left', { date: fmtDate(m.insuranceExpiry), n: insuranceDaysLeft(m) }))
                    : t('Expired {date} — renewal due', { date: fmtDate(m.insuranceExpiry) })}
              </div>
            </div>
            {ins !== 'active' && (
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => onPayInsurance(m.id)}>
                {ins === 'none' ? t('Enrol · {price} DZD', { price: insurancePrice }) : t('Renew · {price} DZD', { price: insurancePrice })}
              </button>
            )}
          </div>

          {/* Outstanding balance — shown only when the member owes money */}
          {m.balance > 0 && (
            <div className="ins-card" style={{ marginTop: 12 }}>
              <Icons.warn width="20" height="20" style={{ color: 'var(--red)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="ins-title">{t('Balance due')}</div>
                <div className="ins-sub">{t('{amount} still owed on this membership', { amount: dzd(m.balance) })}</div>
              </div>
              <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => onCollect(m)}>
                {t('Collect payment')}
              </button>
            </div>
          )}

          <div className="panel-title" style={{ margin: '22px 0 10px' }}>{t('Entry history')}</div>
          {visits == null ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>{t('Loading visits…')}</div>
          ) : visits.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>{t('No recorded visits yet — history fills in as they swipe.')}</div>
          ) : (
            <>
              {visits.slice((page - 1) * ENTRY_PAGE_SIZE, page * ENTRY_PAGE_SIZE).map((v, i) => (
                <div key={(page - 1) * ENTRY_PAGE_SIZE + i} className="leader-row">
                  <span className="mono" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                    {fmtDate(v.exitTime)} · {t('in')} {fmtTime(v.entryTime)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>{durationLabel(v.exitTime - v.entryTime)}</span>
                </div>
              ))}
              {totalPages > 1 && (
                <div className="pager">
                  <button className="pager-btn" disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('Previous page')}>‹ {t('Prev')}</button>
                  {pageList(page, totalPages).map((p, idx) => (p === '…'
                    ? <span key={`gap-${idx}`} className="pager-gap">…</span>
                    : <button key={p} className={`pager-btn ${p === page ? 'on' : ''}`}
                        aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>
                  ))}
                  <button className="pager-btn" disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={t('Next page')}>{t('Next')} ›</button>
                </div>
              )}
              <div className="pager-meta">{`${visits.length === 1 ? t('{n} visit', { n: visits.length }) : t('{n} visits', { n: visits.length })} · ${t('page {page} of {total}', { page, total: totalPages })}`}</div>
            </>
          )}
        </div>
        <div className="modal-foot" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" onClick={onRenew}>{t('Renew / add sessions')}</button>
          <button className="btn" onClick={onEdit}>{t('Edit')}</button>
          <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>{t('Delete')}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// The only valid membership categories — a single choice, never mixed. Each maps
// to a set of sports; the admin-defined subscription plans (Settings) live under
// these categories and decide price + session quota.
const CATEGORIES = [
  { key: 'GYM', label: 'Gym', sports: ['GYM'] },
  { key: 'GYM_CARDIO', label: 'Gym + Cardio', sports: ['GYM', 'CARDIO'] },
  { key: 'CARDIO', label: 'Cardio', sports: ['CARDIO'] },
  { key: 'JUDO', label: 'Judo', sports: ['JUDO'] },
  { key: 'WRESTLING', label: 'Wrestling', sports: ['WRESTLING'] },
];
// A subscription plan's dropdown label: name, price, and session quota.
const planLabel = (p, t) =>
  `${p.label} — ${dzd(p.price)}${p.sessions != null ? ` · ${p.sessions} ${t('sess/mo')}` : ''}`;
const categoryOf = (sports) => {
  const s = new Set(sports || []);
  if (s.has('JUDO')) return 'JUDO';
  if (s.has('WRESTLING')) return 'WRESTLING';
  if (s.has('GYM') && s.has('CARDIO')) return 'GYM_CARDIO';
  if (s.has('CARDIO')) return 'CARDIO';
  return 'GYM';
};
// The member's current monthly session quota (rounded), or null when unlimited —
// used to pre-select the closest matching plan when editing/renewing.
const monthlyQuotaOf = (m) => {
  if (m.sessionsTotal == null) return null;
  const months = Math.max(1, Math.round((m.durationDays || 30) / 30));
  return Math.round(m.sessionsTotal / months);
};

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const blank = () => ({
  name: '', gender: 'M', dob: '2000-01-01', phone: '', bloodType: '',
  category: 'GYM', planId: null,
  months: 1, monthlyPrice: 2500, insurance: false, rfidUid: '', photo: undefined,
});

// Webcam portrait capture. `value`: undefined ⇒ unchanged, null ⇒ removed, a
// data-URL ⇒ a freshly captured photo. The camera is released on capture/cancel,
// when the photo is removed, and on unmount — the webcam light never stays on.
function PhotoField({ member, value, onChange }) {
  const t = useT();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState('');

  const stop = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);
  useEffect(() => stop, [stop]);   // release on unmount

  // Attach the stream once the <video> is in the DOM.
  useEffect(() => {
    if (live && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [live]);

  const start = async () => {
    setErr('');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true });
      setLive(true);
    } catch {
      stop();
      setErr(t('No camera available — saving without a photo'));
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight), SIZE = 320;
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    c.getContext('2d').drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    onChange(c.toDataURL('image/jpeg', 0.7));
    stop(); setLive(false);
  };

  const cancel = () => { stop(); setLive(false); };
  const remove = () => { stop(); setLive(false); onChange(null); };

  const fresh = typeof value === 'string' ? value : null;          // newly captured
  const showExisting = value === undefined && member?.hasPhoto;     // keep current photo
  const hasShot = fresh || showExisting;

  return (
    <div className="field full">
      <label>{t('Photo')}</label>
      <div className="photo-field">
        {live ? (
          <>
            <video ref={videoRef} className="photo-box" muted playsInline />
            <div className="photo-actions">
              <button type="button" className="btn sm primary" onClick={capture}>{t('Capture')}</button>
              <button type="button" className="btn sm ghost" onClick={cancel}>{t('Cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="photo-box photo-preview">
              {fresh ? <img src={fresh} alt="" />
                : showExisting ? <img src={`smolphoto://photo/${member.id}?v=${member.photoTag ?? 0}`} alt="" />
                  : <Icons.camera width="30" height="30" style={{ color: 'var(--faint)' }} />}
            </div>
            <div className="photo-actions">
              <button type="button" className="btn sm" onClick={start}>{hasShot ? t('Retake') : t('Take photo')}</button>
              {hasShot && <button type="button" className="btn sm danger" onClick={remove}>{t('Remove photo')}</button>}
            </div>
          </>
        )}
      </div>
      {err && <div className="photo-note">{err}</div>}
    </div>
  );
}

function MemberForm({ member, onClose, onSave }) {
  const t = useT();
  const [f, setF] = useState(() => {
    if (!member) return blank();
    const months = member.durationDays ? Math.max(1, Math.round(member.durationDays / 30)) : 1;
    return {
      name: member.name, gender: member.gender, dob: member.dob || '2000-01-01', phone: member.phone || '',
      bloodType: member.bloodType || '',
      category: categoryOf(member.sports), planId: null,
      months, monthlyPrice: Math.round((member.amountPaid || 0) / months) || 0,
      insurance: !!member.insurance, rfidUid: member.rfidUid || '', photo: undefined,
    };
  });
  const { pricing } = useContext(AppCtx);
  const insurancePrice = pricing?.insurance ?? INSURANCE_PRICE;
  // Partial payments (new members only): null ⇒ pay the full total; a number ⇒ a
  // deposit, leaving the rest as the member's balance. Editing never bills.
  const [paidNow, setPaidNow] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const months = Math.max(1, Number(f.months) || 1);
  const plans = subPlans(pricing, f.category);
  const selectedPlan = plans.find((p) => p.id === f.planId) || null;

  // Default / re-sync the selected plan whenever the category or price book changes.
  useEffect(() => {
    if (!pricing) return;
    const list = subPlans(pricing, f.category);
    if (!list.length) { setF((x) => (x.planId === null ? x : { ...x, planId: null })); return; }
    if (list.some((p) => p.id === f.planId)) return;
    const quota = member ? monthlyQuotaOf(member) : undefined;
    const pick = (member ? list.find((p) => p.sessions === quota) : null) || list[0];
    setF((x) => ({ ...x, planId: pick.id }));
  }, [pricing, f.category]);   // eslint-disable-line react-hooks/exhaustive-deps

  // For a new member, keep the monthly price in step with the chosen plan
  // (still editable as a manual override).
  useEffect(() => {
    if (member || !selectedPlan) return;
    setF((x) => ({ ...x, monthlyPrice: selectedPlan.price }));
  }, [member, selectedPlan]);
  const monthly = Math.max(0, Number(f.monthlyPrice) || 0);
  const total = months * monthly;
  // Default the deposit to the full total; it tracks the total until manually set.
  const paid = paidNow == null ? total : Math.min(total, Math.max(0, Number(paidNow) || 0));
  const balance = Math.max(0, total - paid);
  useEffect(() => { if (!member) setPaidNow((p) => (p == null ? null : Math.min(p, total))); }, [member, total]);

  const submit = () => {
    if (!f.name.trim()) return;
    const category = CATEGORIES.find((c) => c.key === f.category) || CATEGORIES[0];
    const durationDays = months * 30;
    const start = member?.subStart ?? new Date().toISOString().slice(0, 19);
    const end = new Date(new Date(start).getTime() + durationDays * 86400000).toISOString().slice(0, 19);
    // A plan with a session quota ⇒ metered (sessions × months); an unlimited
    // plan (sessions = null) carries no quota (NULL).
    const perMonth = selectedPlan && selectedPlan.sessions != null ? selectedPlan.sessions : null;
    const sessionsTotal = perMonth != null ? perMonth * months : null;
    const sessionsLeft = sessionsTotal == null
      ? null
      : (member && member.sessionsTotal != null ? member.sessionsLeft : sessionsTotal);
    onSave({
      id: member?.id,                       // undefined ⇒ the API creates it
      name: f.name, gender: f.gender, dob: f.dob, phone: f.phone, bloodType: f.bloodType || null,
      rfidUid: f.rfidUid || undefined,      // undefined ⇒ the API assigns one
      sports: category.sports,
      membershipType: 'subscription',
      durationDays,
      subStart: start, subEnd: member ? member.subEnd : end,
      sessionsTotal, sessionsLeft,
      amountPaid: member ? undefined : paid,
      total: member ? undefined : total,
      insurance: f.insurance,
      ...(f.photo !== undefined ? { photo: f.photo } : {}),   // omit ⇒ leave photo unchanged
    });
  };

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Member form')}>
        <div className="modal-head">
          <div className="modal-title">{member ? t('Edit — {name}', { name: member.name }) : t('New member')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field full"><label>{t('Full name')}</label>
              <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Yacine Benali')} /></div>
            <div className="field"><label>{t('Date of birth')}</label>
              <DatePicker value={f.dob} onChange={(v) => set('dob', v)} ariaLabel={t('Date of birth')} placeholder="Date of birth" /></div>
            <div className="field"><label>{t('Gender')}</label>
              <Select value={f.gender} onChange={(v) => set('gender', v)} ariaLabel={t('Gender')}
                options={[['M', t('Male')], ['F', t('Female')]]} /></div>
            <div className="field"><label>{t('Phone')}</label>
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder={t('05xx xx xx xx')} /></div>
            <div className="field"><label>{t('Blood type')}</label>
              <Select value={f.bloodType} onChange={(v) => set('bloodType', v)} ariaLabel={t('Blood type')}
                options={BLOOD_TYPES.map((b) => [b, b])} /></div>
            <PhotoField member={member} value={f.photo} onChange={(v) => set('photo', v)} />
            <div className="field full"><label>{t('Membership category')}</label>
              <div className="chip-row">
                {CATEGORIES.map((c) => (
                  <button key={c.key} type="button" className={`chip ${f.category === c.key ? 'on' : ''}`}
                    onClick={() => set('category', c.key)}>{t(c.label)}</button>
                ))}
              </div></div>
            <div className="field"><label>{t('RFID tag UID')}</label>
              <input data-rfid-capture value={f.rfidUid} onChange={(e) => set('rfidUid', e.target.value)}
                placeholder={t('Click here, then scan the tag')} /></div>

            <div className="field"><label>{t('Months')}</label>
              <input type="number" min="1" value={f.months} onChange={(e) => set('months', Number(e.target.value))} /></div>
            <div className="field full"><label>{t('Subscription plan')}</label>
              {plans.length ? (
                <Select value={f.planId || ''} onChange={(v) => set('planId', v)} ariaLabel={t('Subscription plan')}
                  options={plans.map((p) => [p.id, planLabel(p, t)])} />
              ) : (
                <div style={{ marginTop: 9, fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>
                  {t('No plans for this category — add one in Settings.')}
                </div>
              )}</div>
            <div className="field"><label>{t('Monthly price (DZD)')}</label>
              <input type="number" min="0" value={f.monthlyPrice} onChange={(e) => set('monthlyPrice', Number(e.target.value))} /></div>
            <div className="field"><label>{t('Total')}</label>
              <input disabled value={t('{total} DZD  ({months} mo × {monthly})', { total, months, monthly })} /></div>

            {!member && (
              <>
                <div className="field"><label>{t('Amount paid now (DZD)')}</label>
                  <input type="number" min="0" max={total} value={paid}
                    onChange={(e) => setPaidNow(Number(e.target.value))} /></div>
                <div className="field"><label>{t('Balance due')}</label>
                  <input disabled value={dzd(balance)}
                    style={balance > 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined} /></div>
              </>
            )}

            <div className="field"><label>{t('Insurance')}</label>
              <div className="check-row" style={{ marginTop: 9 }}>
                <input id="ins" type="checkbox" checked={f.insurance} onChange={(e) => set('insurance', e.target.checked)} />
                <label htmlFor="ins" style={{ margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 13.5, fontWeight: 500 }}>{t('Member is insured · {price} DZD/yr', { price: insurancePrice })}</label>
              </div></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={!f.name.trim()}>
            {member ? t('Save changes') : t('Register member')}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function RenewForm({ member: m, onClose, onSave }) {
  const t = useT();
  const { pricing } = useContext(AppCtx);
  const category = categoryOf(m.sports);
  const [months, setMonths] = useState(1);
  const [planId, setPlanId] = useState(null);
  const [amount, setAmount] = useState(2500);
  // Partial payment: null ⇒ pay the full fee; a number ⇒ a deposit, the rest is
  // added to the member's balance. Tracks the total until manually changed.
  const [paidNow, setPaidNow] = useState(null);
  const plans = subPlans(pricing, category);
  const selectedPlan = plans.find((p) => p.id === planId) || null;
  // Default the plan (match the member's current quota where possible) on load.
  useEffect(() => {
    if (!pricing) return;
    const list = subPlans(pricing, category);
    if (!list.length) { setPlanId(null); return; }
    if (list.some((p) => p.id === planId)) return;
    const quota = monthlyQuotaOf(m);
    setPlanId((list.find((p) => p.sessions === quota) || list[0]).id);
  }, [pricing, category]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Suggest the configured price for the chosen plan + period (still editable).
  useEffect(() => {
    if (!selectedPlan) return;
    setAmount(selectedPlan.price * Math.max(1, months));
  }, [selectedPlan, months]);

  // The full fee for this renewal, the deposit collected now, and the shortfall.
  const total = amount;
  const paid = paidNow == null ? total : Math.min(total, Math.max(0, Number(paidNow) || 0));
  const balance = Math.max(0, total - paid);
  useEffect(() => { setPaidNow((p) => (p == null ? null : Math.min(p, total))); }, [total]);

  const submit = () => {
    // Extend the date and apply the chosen plan for the renewed period. A plan
    // with a session quota ⇒ metered (sessions × months); unlimited ⇒ no quota.
    const mo = Math.max(1, months);
    const perMonth = selectedPlan && selectedPlan.sessions != null ? selectedPlan.sessions : null;
    const sessionsTotal = perMonth != null ? perMonth * mo : null;
    onSave({ days: mo * 30, applyPlan: true, sessionsTotal, amount: paid, total, method: 'Cash' });
  };

  const payFields = (
    <>
      <div className="field"><label>{t('Amount paid now (DZD)')}</label>
        <input type="number" min="0" max={total} value={paid}
          onChange={(e) => setPaidNow(Number(e.target.value))} /></div>
      <div className="field"><label>{t('Balance due')}</label>
        <input disabled value={dzd(balance)}
          style={balance > 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined} /></div>
    </>
  );

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Renew membership')}>
        <div className="modal-head">
          <div className="modal-title">{t('Renew — {name}', { name: m.name })}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>{t('Months')}</label>
              <input type="number" min="1" value={months} onChange={(e) => setMonths(Number(e.target.value))} /></div>
            <div className="field"><label>{t('Amount (DZD)')}</label>
              <input type="number" min="0" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
            {plans.length > 0 && (
              <div className="field full"><label>{t('Subscription plan')}</label>
                <Select value={planId || ''} onChange={(v) => setPlanId(v)} ariaLabel={t('Subscription plan')}
                  options={plans.map((p) => [p.id, planLabel(p, t)])} /></div>
            )}
            {payFields}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit}>{t('Extend subscription')}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// Collect part or all of a member's outstanding balance. Defaults to the full
// amount owed; staff can take a smaller instalment, leaving the rest on balance.
function CollectBalanceForm({ member: m, onClose, onSave }) {
  const t = useT();
  const [amount, setAmount] = useState(m.balance);
  const pay = Math.min(m.balance, Math.max(0, Number(amount) || 0));
  const remaining = Math.max(0, m.balance - pay);
  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Collect payment')}>
        <div className="modal-head">
          <div className="modal-title">{t('Collect payment — {name}', { name: m.name })}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>{t('Outstanding balance')}</label>
              <input disabled value={dzd(m.balance)} /></div>
            <div className="field"><label>{t('Amount to collect (DZD)')}</label>
              <input type="number" min="0" max={m.balance} value={amount} autoFocus
                onChange={(e) => setAmount(Number(e.target.value))} /></div>
            <div className="field"><label>{t('Remaining after')}</label>
              <input disabled value={dzd(remaining)}
                style={remaining > 0 ? { color: 'var(--red)', fontWeight: 700 } : { color: 'var(--green)', fontWeight: 700 }} /></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={() => onSave(pay)} disabled={pay <= 0}>{t('Collect {amount}', { amount: dzd(pay) })}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
