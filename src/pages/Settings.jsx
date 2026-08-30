import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { useTheme } from '../theme.jsx';
import { useLanguage, LANGUAGES } from '../i18n.jsx';
import { useTts } from '../tts-settings.jsx';
import { useAuth } from '../auth.jsx';
import { Icons } from '../components/atoms.jsx';
import Select from '../components/Select.jsx';
import Portal from '../components/Portal.jsx';
import { dzd, planDurationLabel, planUnit } from '../utils.js';

const CATEGORY_LABEL = { GYM: 'Gym', CARDIO: 'Cardio', GYM_CARDIO: 'Gym + Cardio', JUDO: 'Judo', WRESTLING: 'Wrestling' };
// CATEGORY_LABEL is translated at render via t().
const CATEGORY_ORDER = ['GYM', 'GYM_CARDIO', 'CARDIO', 'JUDO', 'WRESTLING'];

const money = (v) => Math.max(0, Math.round(Number(v) || 0));

function PriceInput({ value, onChange, ...rest }) {
  return (
    <div className="price-input">
      <input type="number" min="0" value={value} onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(money(e.target.value))} {...rest} />
      <span>DZD</span>
    </div>
  );
}

export default function Settings() {
  const { theme } = useTheme();
  const { language, t } = useLanguage();
  const { enabled: ttsEnabled, setEnabled: setTtsEnabled, voice: ttsVoice, setVoice: setTtsVoice } = useTts();
  const { currentUser } = useAuth();
  const { pricing, savePricing, savePreferences } = useContext(AppCtx);
  const isAdmin = currentUser?.role === 'admin';

  // A local, editable copy of the price book. Re-synced whenever the canonical
  // one changes (initial load or after a successful save).
  const [draft, setDraft] = useState(pricing);
  const [seq, setSeq] = useState(0);   // unique keys for freshly added session rows
  useEffect(() => { setDraft(pricing); }, [pricing]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(pricing), [draft, pricing]);

  const setInsurance = (v) => setDraft((d) => ({ ...d, insurance: v }));
  const setSession = (i, key, val) =>
    setDraft((d) => ({ ...d, sessions: d.sessions.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)) }));
  const addSession = () => {
    setDraft((d) => ({ ...d, sessions: [...d.sessions, { id: `custom-${seq}`, label: 'New session', price: 0 }] }));
    setSeq((n) => n + 1);
  };
  const removeSession = (i) => setDraft((d) => ({ ...d, sessions: d.sessions.filter((_, idx) => idx !== i) }));
  // Subscriptions are a flat list managed like the members page: a read-only
  // table, a right-hand drawer for details/edit, and a modal to create. Each
  // create/edit/delete persists immediately (base on `draft` so any pending
  // insurance/session edits are saved too, never lost). `subFilter`/`subQuery`
  // only filter the view; `selectedSub`/`creatingSub` drive the drawer/modal.
  const [subFilter, setSubFilter] = useState('ALL');
  const [subQuery, setSubQuery] = useState('');
  const [selectedSub, setSelectedSub] = useState(null);   // subscription id | null
  const [creatingSub, setCreatingSub] = useState(false);
  const upsertSub = (sub) => {
    const list = (pricing && pricing.subscriptions) || [];
    const next = list.some((p) => p.id === sub.id) ? list.map((p) => (p.id === sub.id ? sub : p)) : [...list, sub];
    savePricing({ ...draft, subscriptions: next });
  };
  const deleteSub = (id) => savePricing({ ...draft, subscriptions: ((pricing && pricing.subscriptions) || []).filter((p) => p.id !== id) });

  if (!draft) {
    return (
      <>
        <div className="page-head"><div><div className="page-title">{t('Settings')}</div></div></div>
        <div className="empty-state" style={{ paddingTop: 80 }}>{t('Loading settings…')}</div>
      </>
    );
  }

  // Subscription list + the current filtered view + the open drawer's plan.
  const subs = (pricing && pricing.subscriptions) || [];
  const subQ = subQuery.trim().toLowerCase();
  const subRows = subs.filter((p) =>
    (subFilter === 'ALL' || p.category === subFilter) && (!subQ || p.label.toLowerCase().includes(subQ)));
  const selSub = selectedSub != null ? subs.find((p) => p.id === selectedSub) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Settings')}</div>
          <div className="page-sub">{isAdmin ? t('Appearance, language and the price book.') : t('Appearance and language.')}</div>
        </div>
      </div>

      <div className="settings-cols">
        {/* ── Appearance ── */}
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Appearance')}</div></div>
          <div className="panel-body">
            <div className="set-row">
              <div>
                <div className="set-row-title">{t('Theme')}</div>
                <div className="set-row-sub">{t('Light or dark interface.')}</div>
              </div>
              <div className="chip-row" style={{ marginLeft: 'auto' }}>
                <button type="button" className={`chip ${theme === 'light' ? 'on' : ''}`}
                  onClick={() => savePreferences({ theme: 'light' })}><Icons.sun width="14" height="14" /> {t('Light')}</button>
                <button type="button" className={`chip ${theme === 'dark' ? 'on' : ''}`}
                  onClick={() => savePreferences({ theme: 'dark' })}><Icons.moon width="14" height="14" /> {t('Dark')}</button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Language ── */}
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Language')}</div></div>
          <div className="panel-body">
            <div className="set-row">
              <div>
                <div className="set-row-title">{t('Interface language')}</div>
                <div className="set-row-sub">{t('Applies across the whole app.')}</div>
              </div>
              <div style={{ marginLeft: 'auto', minWidth: 170 }}>
                <Select value={language} onChange={(l) => savePreferences({ language: l })} ariaLabel={t('Interface language')} options={LANGUAGES} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Voice announcements ── */}
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Voice announcements')}</div></div>
          <div className="panel-body">
            <div className="set-row">
              <div>
                <div className="set-row-title">{t('Announcements')}</div>
                <div className="set-row-sub">{t('Speak a welcome message on every card swipe.')}</div>
              </div>
              <div className="chip-row" style={{ marginLeft: 'auto' }}>
                <button type="button" className={`chip ${ttsEnabled ? 'on' : ''}`} onClick={() => setTtsEnabled(true)}>{t('On')}</button>
                <button type="button" className={`chip ${!ttsEnabled ? 'on' : ''}`} onClick={() => setTtsEnabled(false)}>{t('Off')}</button>
              </div>
            </div>
            <div className="set-row">
              <div>
                <div className="set-row-title">{t('Voice')}</div>
                <div className="set-row-sub">{t('Which French voice reads the announcement.')}</div>
              </div>
              <div className="chip-row" style={{ marginLeft: 'auto' }}>
                <button type="button" className={`chip ${ttsVoice === 'female' ? 'on' : ''}`} onClick={() => setTtsVoice('female')}>{t('Female')}</button>
                <button type="button" className={`chip ${ttsVoice === 'male' ? 'on' : ''}`} onClick={() => setTtsVoice('male')}>{t('Male')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <>
          {/* ── Insurance ── */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head"><div className="panel-title">{t('Insurance')}</div><div className="panel-sub">{t('Yearly fee per member')}</div></div>
            <div className="panel-body">
              <div className="set-row">
                <div>
                  <div className="set-row-title">{t('Annual insurance')}</div>
                  <div className="set-row-sub">{t('Charged once a year on enrolment and renewal.')}</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <PriceInput value={draft.insurance} onChange={setInsurance} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Session prices ── */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div className="panel-title">{t('Session prices')}</div>
              <div className="panel-sub">{t('Pay-per-session & walk-in amounts')}</div>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={addSession}><Icons.plus width="14" height="14" /> {t('Add')}</button>
            </div>
            <div className="panel-body">
              <div className="price-list">
                {draft.sessions.map((s, i) => (
                  <div className="price-list-row" key={s.id ?? i}>
                    <input className="set-text grow" value={s.label} placeholder={t('Session name')}
                      onChange={(e) => setSession(i, 'label', e.target.value)} />
                    <PriceInput value={s.price} onChange={(v) => setSession(i, 'price', v)} />
                    <button className="icon-btn danger" aria-label={t('Remove')} title={t('Remove')}
                      onClick={() => removeSession(i)} disabled={draft.sessions.length <= 1}><Icons.trash width="16" height="16" /></button>
                  </div>
                ))}
              </div>
              <div className="set-note">{t('The first session price is the default rate billed per pay-per-session entry. All of them show as quick amounts when adding a walk-in.')}</div>
            </div>
          </div>

          {/* ── Subscription plans ── */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div className="panel-title">{t('Subscription plans')}</div>
              <div className="panel-sub">{t('{n} plans', { n: subs.length })}</div>
              <button className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => setCreatingSub(true)}>
                <Icons.plus width="14" height="14" /> {t('New subscription')}
              </button>
            </div>
            <div className="panel-body">
              <div className="sub-toolbar">
                <Select value={subFilter} onChange={setSubFilter} ariaLabel={t('Filter by category')} width={180}
                  options={[['ALL', t('All categories')], ...CATEGORY_ORDER.map((c) => [c, t(CATEGORY_LABEL[c])])]} />
                <input className="set-text grow" type="search" placeholder={t('Search plans…')} value={subQuery}
                  onChange={(e) => setSubQuery(e.target.value)} />
              </div>
              {subRows.length === 0 ? (
                <div className="empty-state" style={{ padding: '26px 0' }}>
                  {subs.length === 0 ? t('No subscriptions yet — add one.') : t('No plans match your filters.')}
                </div>
              ) : (
                <div className="sub-list-scroll">
                  <table className="table">
                    <thead>
                      <tr><th>{t('Category')}</th><th>{t('Plan name')}</th><th>{t('Duration')}</th><th>{t('Sessions')}</th><th>{t('Price')}</th></tr>
                    </thead>
                    <tbody>
                      {subRows.map((p) => (
                        <tr key={p.id} onClick={() => setSelectedSub(p.id)}>
                          <td>{t(CATEGORY_LABEL[p.category])}</td>
                          <td style={{ fontWeight: 600 }}>{p.label}</td>
                          <td className="mono num">{planDurationLabel(p, t)}</td>
                          <td className="mono num">{p.sessions != null ? p.sessions : t('Unlimited')}</td>
                          <td className="mono num">{dzd(p.price)}{p.unit === 'week' ? '' : ` / ${t('mo')}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {dirty && (
            <div className="settings-bar">
              <span>{t('Unsaved changes')}</span>
              <button className="btn ghost" onClick={() => setDraft(pricing)}>{t('Discard')}</button>
              <button className="btn primary" onClick={() => savePricing(draft)}>{t('Save changes')}</button>
            </div>
          )}

          {selSub && (
            <SubDrawer sub={selSub}
              onClose={() => setSelectedSub(null)}
              onSave={(v) => upsertSub(v)}
              onDelete={() => { deleteSub(selSub.id); setSelectedSub(null); }} />
          )}
          {creatingSub && (
            <SubCreateModal
              onClose={() => setCreatingSub(false)}
              onCreate={(v) => { upsertSub(v); setCreatingSub(false); }} />
          )}
        </>
      )}
    </>
  );
}

// Shared editable fields for a subscription (create modal + drawer edit mode).
// A plan is billed either by the month (a recurring rate, sessions = per
// month — unchanged from before) or by the week (a flat price for a fixed
// span, sessions = the total for that whole span).
function SubFields({ value, onChange, t }) {
  const unit = planUnit(value);
  // Duration/sessions/price mean something different under each unit (a rate
  // vs. a flat total) — switching units resets them rather than silently
  // reinterpreting whatever numbers were typed for the old one.
  const setUnit = (v) => onChange({ ...value, unit: v, duration: 1, sessions: null, price: 0 });
  return (
    <div className="form-grid">
      <div className="field full"><label>{t('Category')}</label>
        <Select value={value.category} onChange={(v) => onChange({ ...value, category: v })} ariaLabel={t('Category')}
          options={CATEGORY_ORDER.map((c) => [c, t(CATEGORY_LABEL[c])])} /></div>
      <div className="field full"><label>{t('Plan name')}</label>
        <input value={value.label} placeholder={t('e.g. 3× / week')}
          onChange={(e) => onChange({ ...value, label: e.target.value })} /></div>
      <div className="field"><label>{t('Billed by')}</label>
        <Select value={unit} onChange={setUnit} ariaLabel={t('Billed by')}
          options={[['month', t('Month')], ['week', t('Week')]]} /></div>
      <div className="field"><label>{unit === 'week' ? t('How many weeks') : t('How many months')}</label>
        <input type="number" min="1" value={value.duration ?? 1} onFocus={(e) => e.target.select()}
          onChange={(e) => onChange({ ...value, duration: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></div>
      <div className="field"><label>{unit === 'week' ? t('Sessions (total)') : t('Sessions / month')}</label>
        <input type="number" min="1" value={value.sessions ?? ''} placeholder={t('Unlimited')} onFocus={(e) => e.target.select()}
          onChange={(e) => onChange({ ...value, sessions: e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value) || 0)) })} /></div>
      <div className="field"><label>{unit === 'week' ? t('Total price (DZD)') : t('Monthly price (DZD)')}</label>
        <input type="number" min="0" value={value.price} onFocus={(e) => e.target.select()}
          onChange={(e) => onChange({ ...value, price: money(e.target.value) })} /></div>
    </div>
  );
}

// Right-hand drawer: read-only details with an Edit toggle + Delete.
function SubDrawer({ sub, onClose, onSave, onDelete }) {
  const { t } = useLanguage();
  const [editMode, setEditMode] = useState(false);
  const [v, setV] = useState(sub);
  // Re-sync (and exit edit mode) whenever the underlying plan changes — including
  // right after a save, when the persisted plan flows back down.
  useEffect(() => { setV(sub); setEditMode(false); }, [sub]);
  const valid = v.label.trim() !== '';
  return (
    <Portal>
      <div className="overlay" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Subscription details')}>
          <div className="modal-head">
            <div className="modal-title">{editMode ? t('Edit subscription') : t('Subscription details')}</div>
            <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
          </div>
          <div className="modal-body">
            {editMode ? (
              <SubFields value={v} onChange={setV} t={t} />
            ) : (
              <>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 22, marginBottom: 8 }}>{sub.label}</div>
                <div className="live-meta" style={{ marginBottom: 18 }}>
                  <span className="badge neutral">{t(CATEGORY_LABEL[sub.category])}</span>
                </div>
                <div className="kv">
                  <span className="k">{t('Category')}</span><span className="v">{t(CATEGORY_LABEL[sub.category])}</span>
                  <span className="k">{t('Plan name')}</span><span className="v">{sub.label}</span>
                  <span className="k">{t('Duration')}</span><span className="v">{planDurationLabel(sub, t)}</span>
                  <span className="k">{sub.unit === 'week' ? t('Sessions (total)') : t('Sessions / month')}</span>
                  <span className="v">{sub.sessions != null ? t('{n} sessions', { n: sub.sessions }) : t('Unlimited')}</span>
                  <span className="k">{sub.unit === 'week' ? t('Total price') : t('Monthly price')}</span><span className="v mono">{dzd(sub.price)}</span>
                </div>
              </>
            )}
          </div>
          <div className="modal-foot" style={{ justifyContent: 'flex-start' }}>
            {editMode ? (
              <>
                <button className="btn ghost" onClick={() => { setV(sub); setEditMode(false); }}>{t('Cancel')}</button>
                <button className="btn primary" disabled={!valid} onClick={() => onSave(v)}>{t('Save changes')}</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => setEditMode(true)}>{t('Edit')}</button>
                <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>{t('Delete')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// Modal to create a new subscription.
function SubCreateModal({ onClose, onCreate }) {
  const { t } = useLanguage();
  const [v, setV] = useState({ category: 'GYM', label: '', unit: 'month', duration: 1, sessions: null, price: 0 });
  const valid = v.label.trim() !== '';
  return (
    <Portal>
      <div className="modal-center" onClick={onClose}>
        <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('New subscription')}>
          <div className="modal-head">
            <div className="modal-title">{t('New subscription')}</div>
            <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
          </div>
          <div className="modal-body"><SubFields value={v} onChange={setV} t={t} /></div>
          <div className="modal-foot">
            <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn primary" disabled={!valid} onClick={() => onCreate({ ...v, id: `sub-${Date.now()}` })}>{t('Create subscription')}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
