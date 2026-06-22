import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './atoms.jsx';

// Custom, theme-matched dropdown — a styled trigger + a portaled options list
// (portaled so a scroll container can't clip it). Drop-in for a native <select>:
// `options` is [{value,label}] or [value,label] pairs; onChange gets the value.

const norm = (options) => options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));

export default function Select({ value, onChange, options, ariaLabel, width, placeholder = 'Select…' }) {
  const opts = norm(options);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const current = opts.find((o) => o.value === value);

  // Place the fixed popover under the trigger (flip above if it'd overflow).
  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const wanted = Math.min(300, opts.length * 38 + 10);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < wanted && above > below;
    setPos({
      left: r.left, minW: r.width,
      top: up ? undefined : r.bottom + 5,
      bottom: up ? window.innerHeight - r.top + 5 : undefined,
      maxH: Math.max(120, Math.min(wanted, (up ? above : below) - 5)),
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = opts.findIndex((o) => o.value === value);
        const next = e.key === 'ArrowDown' ? Math.min(opts.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (opts[next]) onChange(opts[next].value);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open, opts, value, onChange]);

  const choose = (v) => { onChange(v); setOpen(false); };

  const pop = open && pos && createPortal(
    <div ref={popRef} className="sel-pop" role="listbox" aria-label={ariaLabel}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minW, maxHeight: pos.maxH }}>
      {opts.map((o) => (
        <button type="button" key={String(o.value)} role="option" aria-selected={o.value === value}
          className={`sel-opt${o.value === value ? ' on' : ''}`} onClick={() => choose(o.value)}>
          <span>{o.label}</span>
          {o.value === value && <Icons.check width="14" height="14" />}
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div className="sel" style={width ? { width } : undefined}>
      <button type="button" ref={triggerRef} className={`sel-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        <span className={current ? 'sel-val' : 'sel-placeholder'}>{current ? current.label : placeholder}</span>
        <Icons.chevron width="15" height="15" className="sel-caret" />
      </button>
      {pop}
    </div>
  );
}
