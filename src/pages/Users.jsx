import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icons } from '../components/atoms.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Select from '../components/Select.jsx';
import { initials, fmtDate, fmtTime, pageList, dayKey } from '../utils.js';
import { useAuth } from '../auth.jsx';
import { useT } from '../i18n.jsx';
import Portal from '../components/Portal.jsx';

// A few on-brand presets alongside the native picker.
const PRESETS = ['#10D98E', '#0FBFB4', '#4D9FFF', '#B07CFF', '#FFB224', '#FF5468', '#22C7E6', '#2BD786'];

function Swatch({ color, name, size = '' }) {
  return (
    <div className={`avatar ${size}`} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

const RoleBadge = ({ role }) => {
  const t = useT();
  return role === 'admin'
    ? <span className="badge gym">{t('Administrator')}</span>
    : <span className="badge neutral">{t('Coach')}</span>;
};

export default function Users() {
  const { currentUser } = useAuth();
  const t = useT();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null);   // user id → history drawer
  const [editing, setEditing] = useState(null);     // user object or 'new'
  const [confirmDelete, setConfirmDelete] = useState(null);

  const toastTimer = useRef(null);
  const flash = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try { setUsers(await api('/users')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (payload, id) => {
    try {
      if (id != null) await api(`/users/${id}`, { method: 'PUT', body: payload });
      else await api('/users', { method: 'POST', body: payload });
      await load();
      setEditing(null);
      flash(id != null ? t('User updated') : t('Coach added'));
    } catch (e) { flash(t('Save failed: {message}', { message: e.message })); }
  };

  const remove = async (u) => {
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      await load();
      setConfirmDelete(null); setSelected(null);
      flash(t('Coach deleted'));
    } catch (e) { flash(t('Delete failed: {message}', { message: e.message })); }
  };

  const sel = selected != null ? users.find((u) => u.id === selected) : null;
  const coaches = useMemo(() => users.filter((u) => u.role === 'coach').length, [users]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Manage users')}</div>
          <div className="page-sub">{coaches === 1
            ? t('{count} accounts · {coaches} coach · 1 administrator', { count: users.length, coaches })
            : t('{count} accounts · {coaches} coaches · 1 administrator', { count: users.length, coaches })}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={() => setEditing('new')}><Icons.plus width="15" height="15" /> {t('New coach')}</button>
        </div>
      </div>

      {error && (
        <div className="empty-state" style={{ color: 'var(--red)', paddingTop: 40 }}>
          {t('Could not load users — {error}', { error })}
          <div style={{ marginTop: 12 }}><button className="btn" onClick={load}>{t('Retry')}</button></div>
        </div>
      )}

      {!error && (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr><th></th><th>{t('Name')}</th><th>{t('Username')}</th><th>{t('Role')}</th><th>{t('Phone')}</th><th>{t('Color')}</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} onClick={() => setSelected(u.id)}>
                  <td style={{ width: 50 }}><Swatch color={u.color} name={u.fullName || u.username} /></td>
                  <td style={{ fontWeight: 600 }}>{u.fullName || '—'}{u.id === currentUser.id && <span className="badge neutral" style={{ marginLeft: 8 }}>{t('You')}</span>}</td>
                  <td className="mono">{u.username}</td>
                  <td><RoleBadge role={u.role} /></td>
                  <td className="mono">{u.phone || '—'}</td>
                  <td><span className="mono" style={{ color: 'var(--muted)' }}>{u.color}</span></td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setEditing(u)}>{t('Edit')}</button>{' '}
                    {u.role !== 'admin' && (
                      <button className="btn sm danger" onClick={() => setConfirmDelete(u)} title={t('Delete coach')}>
                        {t('Delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {loading && <tr><td colSpan="7"><div className="empty-state">{t('Loading users…')}</div></td></tr>}
              {!loading && users.length === 0 && (
                <tr><td colSpan="7"><div className="empty-state">{t('No users yet — add your first coach.')}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {sel && <HistoryDrawer user={sel} onClose={() => setSelected(null)}
        onEdit={() => setEditing(sel)} onDelete={() => setConfirmDelete(sel)} />}
      {editing && <UserForm user={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSave={save} />}
      {confirmDelete && (
        <Portal>
        <div className="modal-center" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{t('Delete coach')}</div></div>
            <div className="modal-body">
              {t('Delete')} <strong>{confirmDelete.fullName || confirmDelete.username}</strong>{t('? They will no longer be able to sign in. Their activity history is kept for the audit trail. This can\'t be undone.')}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>{t('Keep coach')}</button>
              <button className="btn danger" onClick={() => remove(confirmDelete)}>{t('Delete coach')}</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function UserForm({ user, onClose, onSave }) {
  const t = useT();
  const [f, setF] = useState(user
    ? { username: user.username, password: '', fullName: user.fullName || '', address: user.address || '', phone: user.phone || '', color: user.color }
    : { username: '', password: '', fullName: '', address: '', phone: '', color: '#B07CFF' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => {
    if (!f.username.trim()) return;
    if (!user && !f.password) return;   // password required on create
    const payload = {
      username: f.username.trim(), fullName: f.fullName, address: f.address, phone: f.phone, color: f.color,
    };
    if (f.password) payload.password = f.password;   // only send when set
    onSave(payload, user?.id);
  };

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('User form')}>
        <div className="modal-head">
          <div className="modal-title">{user ? t('Edit — {name}', { name: user.fullName || user.username }) : t('New coach')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          {/* Live preview of the chosen accent */}
          <div className="user-preview" style={{ marginBottom: 18 }}>
            <div className="avatar lg" style={{ background: f.color }}>{initials(f.fullName || f.username || '–')}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 18 }}>{f.fullName || t('New coach')}</div>
              <div className="page-sub" style={{ marginTop: 2 }}>{t('This color themes the whole app while they\'re signed in.')}</div>
              <div className="user-preview-bar" style={{ background: `linear-gradient(115deg, ${f.color}, ${f.color}cc)` }} />
            </div>
          </div>

          <div className="form-grid">
            <div className="field"><label>{t('Username')}</label>
              <input value={f.username} onChange={(e) => set('username', e.target.value)} placeholder={t('e.g. karim')} autoComplete="off" /></div>
            <div className="field"><label>{user ? t('New password (optional)') : t('Password')}</label>
              <input type="password" value={f.password} onChange={(e) => set('password', e.target.value)}
                placeholder={user ? t('Leave blank to keep current') : t('Set a password')} autoComplete="new-password" /></div>
            <div className="field full"><label>{t('Full name')}</label>
              <input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder={t('e.g. Karim Boudiaf')} /></div>
            <div className="field full"><label>{t('Address')}</label>
              <input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder={t('Street, district, city')} /></div>
            <div className="field"><label>{t('Phone')}</label>
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0xxx xx xx xx" /></div>
            <div className="field"><label>{t('Accent color')}</label>
              <div className="color-picker">
                <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} aria-label={t('Pick a color')} />
                <input className="mono" value={f.color} onChange={(e) => set('color', e.target.value)} style={{ width: 110 }} />
              </div>
            </div>
            <div className="field full"><label>{t('Presets')}</label>
              <div className="chip-row">
                {PRESETS.map((c) => (
                  <button key={c} type="button" className="swatch-btn"
                    onClick={() => set('color', c)} title={c}
                    style={{ background: c, outline: f.color.toLowerCase() === c.toLowerCase() ? '2px solid var(--text)' : 'none' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={!f.username.trim() || (!user && !f.password)}>
            {user ? t('Save changes') : t('Add coach')}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

const ACTION_LABEL = {
  login: 'Signed in', logout: 'Signed out',
  'member.create': 'Member', 'member.update': 'Member', 'member.delete': 'Member', 'member.renew': 'Renewal',
  'member.insurance': 'Insurance',
  'stock.create': 'Stock', 'stock.update': 'Stock', 'stock.delete': 'Stock', 'stock.op': 'Stock',
  'session.free': 'Session', 'session.remove': 'Session',
  'user.create': 'User', 'user.update': 'User', 'user.delete': 'User',
};

// Coarser groups for the activity filter — one entry per dropdown option.
const ACTION_GROUP = {
  login: 'auth', logout: 'auth',
  'member.create': 'member', 'member.update': 'member', 'member.delete': 'member',
  'member.renew': 'renew', 'member.insurance': 'renew',
  'stock.create': 'stock', 'stock.update': 'stock', 'stock.delete': 'stock', 'stock.op': 'stock',
  'session.free': 'session', 'session.remove': 'session',
  'user.create': 'user', 'user.update': 'user', 'user.delete': 'user',
};
const GROUP_ORDER = ['auth', 'member', 'renew', 'stock', 'session', 'user'];
const GROUP_LABEL = { auth: 'Sign-ins', member: 'Members', renew: 'Renewals', stock: 'Stock', session: 'Sessions', user: 'Users' };
const ACT_PAGE_SIZE = 8;

function HistoryDrawer({ user, onClose, onEdit, onDelete }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [day, setDay] = useState('');        // '' ⇒ all days
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    api(`/users/${user.id}/activity`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [user.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const timeline = data?.timeline ?? [];
  // Only offer action groups that actually appear in this user's history.
  const groupsPresent = useMemo(() => {
    const seen = new Set(timeline.map((t) => ACTION_GROUP[t.action]));
    return GROUP_ORDER.filter((g) => seen.has(g));
  }, [timeline]);
  // Date + action + free-text filters, then paginate whatever remains.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return timeline.filter((t) => {
      if (day && dayKey(t.createdAt) !== day) return false;
      if (group !== 'all' && ACTION_GROUP[t.action] !== group) return false;
      if (needle) {
        const hay = `${t.detail || ''} ${ACTION_LABEL[t.action] || t.action} ${t.target || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [timeline, day, group, q]);
  useEffect(() => { setPage(1); }, [day, group, q, user.id]);   // any change ⇒ back to page 1

  const totalPages = Math.max(1, Math.ceil(filtered.length / ACT_PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * ACT_PAGE_SIZE, page * ACT_PAGE_SIZE);
  const hasFilter = !!(day || q || group !== 'all');

  return (
    <Portal>
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('{name} history', { name: user.fullName || user.username })}>
        <div className="modal-head">
          <div className="modal-title">{t('Activity history')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
            <div className="avatar lg" style={{ background: user.color }}>{initials(user.fullName || user.username)}</div>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 20 }}>{user.fullName || user.username}</div>
              <div className="live-meta" style={{ marginTop: 6 }}>
                <RoleBadge role={user.role} />
                <span className="badge neutral mono">@{user.username}</span>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={onEdit}>{t('Edit')}</button>
              {user.role !== 'admin' && <button className="btn sm danger" onClick={onDelete}>{t('Delete')}</button>}
            </div>
          </div>

          <div className="kv" style={{ marginBottom: 18 }}>
            <span className="k">{t('Address')}</span><span className="v">{user.address || '—'}</span>
            <span className="k">{t('Phone')}</span><span className="v mono">{user.phone || '—'}</span>
            <span className="k">{t('Account created')}</span><span className="v">{fmtDate(user.createdAt)}</span>
          </div>

          <div className="panel-title" style={{ margin: '8px 0 12px' }}>{t('Timeline · newest first')}</div>

          {data != null && data.timeline.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <input type="search" placeholder={t('Search activity…')} value={q} onChange={(e) => setQ(e.target.value)}
                style={{ flex: '1 1 150px' }} aria-label={t('Search activity')} />
              <DatePicker value={day} onChange={setDay} ariaLabel={t('Filter by day')} placeholder={t('Any date')} width={140} />
              <Select value={group} onChange={setGroup} width={150} ariaLabel={t('Filter by action')}
                options={[['all', t('All actions')], ...groupsPresent.map((g) => [g, t(GROUP_LABEL[g])])]} />
              {hasFilter && <button className="btn sm ghost" onClick={() => { setQ(''); setDay(''); setGroup('all'); }}>{t('Clear')}</button>}
            </div>
          )}

          {error ? (
            <div className="empty-state" style={{ color: 'var(--red)' }}>{t('Could not load history — {error}', { error })}</div>
          ) : data == null ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>{t('Loading history…')}</div>
          ) : data.timeline.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>{t('No activity recorded yet.')}</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>{t('No activity matches these filters.')}</div>
          ) : (
            <>
              <div className="timeline">
                {pageRows.map((ev, i) => {
                  const isAuth = ev.action === 'login' || ev.action === 'logout';
                  return (
                    <div key={(page - 1) * ACT_PAGE_SIZE + i} className="timeline-row">
                      <span className={`timeline-dot ${ev.action === 'logout' ? 'muted' : ''}`} aria-hidden="true" />
                      <div className="timeline-body">
                        <div className="timeline-detail">
                          <span className={`badge ${isAuth ? 'green' : 'neutral'}`} style={{ marginRight: 8 }}>
                            {ACTION_LABEL[ev.action] ? t(ACTION_LABEL[ev.action]) : ev.action}
                          </span>
                          {ev.detail}
                        </div>
                        <div className="timeline-time mono">{fmtDate(ev.createdAt)} · {fmtTime(ev.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="pager">
                  <button className="pager-btn" disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('Previous page')}>{t('‹ Prev')}</button>
                  {pageList(page, totalPages).map((p, idx) => (p === '…'
                    ? <span key={`gap-${idx}`} className="pager-gap">…</span>
                    : <button key={p} className={`pager-btn ${p === page ? 'on' : ''}`}
                        aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>
                  ))}
                  <button className="pager-btn" disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={t('Next page')}>{t('Next ›')}</button>
                </div>
              )}
              <div className="pager-meta">{filtered.length === 1
                ? t('{n} entry · page {page} of {total}', { n: filtered.length, page, total: totalPages })
                : t('{n} entries · page {page} of {total}', { n: filtered.length, page, total: totalPages })}</div>
            </>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}
