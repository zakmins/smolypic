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
  const [mode, setMode] = useState('days');   // 'days' | 'months' | 'years'
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  const openPicker = () => {
    setView(firstOfMonth(parseDay(value) || new Date()));   // jump to the selected month
    setMode('days');
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
  // Header ‹ › steps by month (days view), year (months view) or decade (years view).
  const shift = (n) => setView((v) => {
    if (mode === 'days') return new Date(v.getFullYear(), v.getMonth() + n, 1);
    if (mode === 'months') return new Date(v.getFullYear() + n, v.getMonth(), 1);
    return new Date(v.getFullYear() + n * 12, v.getMonth(), 1);   // years view: jump a decade
  });

  const selDay = parseDay(value);
  const decadeStart = Math.floor(view.getFullYear() / 12) * 12;   // 12-year page of years
  const years = Array.from({ length: 12 }, (_, i) => decadeStart + i);

  // Title text + what tapping it drills up into (days → months → years).
  const headLabel = mode === 'days' ? `${t(MONTHS[view.getMonth()])} ${view.getFullYear()}`
    : mode === 'months' ? `${view.getFullYear()}`
    : `${decadeStart}–${decadeStart + 11}`;
  const onTitle = () => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'years');

  const pop = open && pos && createPortal(
    <div ref={popRef} className="dp-pop" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={t('Choose a date')}>
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => shift(-1)}
          aria-label={t(mode === 'days' ? 'Previous month' : mode === 'months' ? 'Previous year' : 'Previous years')}>‹</button>
        <button type="button" className="dp-title" onClick={onTitle}
          aria-label={t('Choose month and year')}>{headLabel}</button>
        <button type="button" className="dp-nav" onClick={() => shift(1)}
          aria-label={t(mode === 'days' ? 'Next month' : mode === 'months' ? 'Next year' : 'Next years')}>›</button>
      </div>
      {mode === 'days' && (
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
      )}
      {mode === 'months' && (
        <div className="dp-mgrid">
          {MONTHS.map((m, i) => {
            const isSel = selDay && selDay.getFullYear() === view.getFullYear() && selDay.getMonth() === i;
            const isNow = new Date().getFullYear() === view.getFullYear() && new Date().getMonth() === i;
            return (
              <button type="button" key={m}
                className={`dp-cell${isNow ? ' today' : ''}${isSel ? ' sel' : ''}`}
                onClick={() => { setView(new Date(view.getFullYear(), i, 1)); setMode('days'); }}>
                {t(MONTHS[i]).slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}
      {mode === 'years' && (
        <div className="dp-mgrid">
          {years.map((y) => {
            const isSel = selDay && selDay.getFullYear() === y;
            const isNow = new Date().getFullYear() === y;
            return (
              <button type="button" key={y}
                className={`dp-cell${isNow ? ' today' : ''}${isSel ? ' sel' : ''}`}
                onClick={() => { setView(new Date(y, view.getMonth(), 1)); setMode('months'); }}>
                {y}
              </button>
            );
          })}
        </div>
      )}
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
