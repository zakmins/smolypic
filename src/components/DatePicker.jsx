import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './atoms.jsx';
import { fmtDate, dayKey } from '../utils.js';
import { useT } from '../i18n.jsx';

// Custom, theme-matched date picker — a styled trigger + a portaled calendar
// popover (portaled so the drawer's overflow never clips it). Value is the same
// 'YYYY-MM-DD' string an <input type="date"> uses, so it's a drop-in swap.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];   // Monday-first

const parseDay = (v) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);     // local midnight, no TZ drift
};
const firstOfMonth = (base) => new Date(base.getFullYear(), base.getMonth(), 1);

export default function DatePicker({ value, onChange, placeholder = 'Any date', ariaLabel, width = 140 }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => firstOfMonth(parseDay(value) || new Date()));
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  const openPicker = () => {
    setView(firstOfMonth(parseDay(value) || new Date()));   // jump to the selected month
    setOpen(true);
  };

  // Place the fixed popover under the trigger (flip above if it'd overflow).
  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const W = 272, H = 326, gap = 6;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    let top = r.bottom + gap;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - gap);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const todayKey = dayKey(new Date());
  // 6 weeks of cells (Monday-first), spilling into adjacent months greyed out.
  const cells = useMemo(() => {
    const y = view.getFullYear(), mo = view.getMonth();
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7;
    const start = new Date(y, mo, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date: d, key: dayKey(d), inMonth: d.getMonth() === mo };
    });
  }, [view]);

  const pick = (d) => { onChange(dayKey(d)); setOpen(false); };
  const shift = (n) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));

  const pop = open && pos && createPortal(
    <div ref={popRef} className="dp-pop" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={t('Choose a date')}>
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label={t('Previous month')}>‹</button>
        <div className="dp-title">{t(MONTHS[view.getMonth()])} {view.getFullYear()}</div>
        <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label={t('Next month')}>›</button>
      </div>
      <div className="dp-grid">
        {DOW.map((d) => <div key={d} className="dp-dow">{t(d)}</div>)}
        {cells.map((c) => (
          <button type="button" key={c.key}
            className={`dp-day${c.inMonth ? '' : ' out'}${c.key === todayKey ? ' today' : ''}${c.key === value ? ' sel' : ''}`}
            onClick={() => pick(c.date)} aria-current={c.key === value ? 'date' : undefined}>
            {c.date.getDate()}
          </button>
        ))}
      </div>
      <div className="dp-foot">
        <button type="button" className="btn sm ghost" onClick={() => pick(new Date())}>{t('Today')}</button>
        {value && <button type="button" className="btn sm ghost" onClick={() => { onChange(''); setOpen(false); }}>{t('Clear')}</button>}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="dp" style={{ minWidth: width }}>
      <button type="button" ref={triggerRef} className={`dp-trigger${open ? ' open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}>
        <Icons.calendar width="15" height="15" />
        <span className={value ? 'dp-val' : 'dp-placeholder'}>{value ? fmtDate(parseDay(value)) : t(placeholder)}</span>
        {value && (
          <span className="dp-clear" role="button" tabIndex={-1} aria-label={t('Clear date')}
            onClick={(e) => { e.stopPropagation(); onChange(''); }}>×</span>
        )}
      </button>
      {pop}
    </div>
  );
}
