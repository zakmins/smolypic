import React, { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppCtx } from '../App.jsx';
import { useT } from '../i18n.jsx';
import { dzd } from '../utils.js';

// Quick walk-in session: charge a one-off amount and drop the person onto the
// floor for 2 hours. Not a registered member. The amount presets are the
// configured session prices (Settings → Session prices).
export default function FreeSessionModal({ onClose, onAdd }) {
  const t = useT();
  const { pricing } = useContext(AppCtx);
  const presets = useMemo(() => {
    const prices = (pricing?.sessions || []).map((s) => s.price).filter((p) => p > 0);
    const uniq = [...new Set(prices)].sort((a, b) => a - b);
    return uniq.length ? uniq : [300, 400];
  }, [pricing]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(presets[0]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (!(amount > 0)) return;
    onAdd(name.trim(), amount);
  };

  return createPortal(
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Add session')}>
        <div className="modal-head">
          <div className="modal-title">{t('Session')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 18 }}>
            <label>{t('Name')}</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('Walk-in visitor')}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          </div>

          <div className="field">
            <label>{t('Amount')}</label>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {presets.map((p) => (
                <button key={p} type="button" className={`chip ${amount === p ? 'on' : ''}`}
                  onClick={() => setAmount(p)}>{dzd(p)}</button>
              ))}
            </div>
            <input type="number" min="0" step="50" value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              aria-label={t('Custom amount in DZD')} />
          </div>

          <div className="kv" style={{ marginTop: 18 }}>
            <span className="k">{t('Charge')}</span><span className="v mono">{dzd(amount || 0)}</span>
            <span className="k">{t('On the floor')}</span><span className="v">{t('2 hours, then auto-removed')}</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={!(amount > 0)}>{t('Add session')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
