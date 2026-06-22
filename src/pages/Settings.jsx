import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { useTheme } from '../theme.jsx';
import { useLanguage, LANGUAGES } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { Icons } from '../components/atoms.jsx';
import Select from '../components/Select.jsx';

const CATEGORY_LABEL = { GYM: 'Gym', CARDIO: 'Cardio', GYM_CARDIO: 'Gym + Cardio', JUDO: 'Judo', WRESTLING: 'Wrestling' };
const TIERS = [['2', '2× / week'], ['3', '3× / week'], ['4', '4× / week'], ['unlimited', 'Unlimited']];
// CATEGORY_LABEL / TIER labels are translated at render via t().
const WEEKLY_CATS = ['GYM', 'CARDIO', 'GYM_CARDIO'];
const MONTHLY_CATS = ['JUDO', 'WRESTLING'];

const money = (v) => Math.max(0, Math.round(Number(v) || 0));

function PriceInput({ value, onChange, ...rest }) {
  return (
    <div className="price-input">
      <input type="number" min="0" value={value} onChange={(e) => onChange(money(e.target.value))} {...rest} />
      <span>DZD</span>
    </div>
  );
}

export default function Settings() {
  const { theme } = useTheme();
  const { language, t } = useLanguage();
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
  const setSub = (cat, tier, val) =>
    setDraft((d) => ({ ...d, subscriptions: { ...d.subscriptions, [cat]: { ...d.subscriptions[cat], [tier]: val } } }));

  if (!draft) {
    return (
      <>
        <div className="page-head"><div><div className="page-title">{t('Settings')}</div></div></div>
        <div className="empty-state" style={{ paddingTop: 80 }}>{t('Loading settings…')}</div>
      </>
    );
  }

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

          {/* ── Subscription prices ── */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head"><div className="panel-title">{t('Subscription prices')}</div><div className="panel-sub">{t('Monthly, by membership category')}</div></div>
            <div className="panel-body" style={{ overflowX: 'auto' }}>
              <table className="price-table">
                <thead>
                  <tr>
                    <th>{t('Category')}</th>
                    {TIERS.map(([k, label]) => <th key={k}>{t(label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {WEEKLY_CATS.map((cat) => (
                    <tr key={cat}>
                      <td className="cat-cell">{t(CATEGORY_LABEL[cat])}</td>
                      {TIERS.map(([tier]) => (
                        <td key={tier}>
                          <PriceInput value={draft.subscriptions[cat]?.[tier] ?? 0} onChange={(v) => setSub(cat, tier, v)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="set-note" style={{ margin: '16px 0 8px' }}>{t('Monthly-only memberships (no weekly session limit):')}</div>
              <div className="price-list">
                {MONTHLY_CATS.map((cat) => (
                  <div className="price-list-row" key={cat}>
                    <span className="cat-cell" style={{ flex: 1 }}>{t(CATEGORY_LABEL[cat])}</span>
                    <PriceInput value={draft.subscriptions[cat]?.monthly ?? 0} onChange={(v) => setSub(cat, 'monthly', v)} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {dirty && (
            <div className="settings-bar">
              <span>{t('Unsaved changes')}</span>
              <button className="btn ghost" onClick={() => setDraft(pricing)}>{t('Discard')}</button>
              <button className="btn primary" onClick={() => savePricing(draft)}>{t('Save changes')}</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
