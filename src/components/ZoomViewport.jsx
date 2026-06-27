import React, { useEffect, useRef } from 'react';

// ── Cursor-anchored zoom for the whole app shell ─────────────────────────────
// Hold Ctrl (⌘ on macOS / pinch on a trackpad) and scroll to zoom toward the
// pointer; release the modifier and the wheel scrolls pages normally. The view
// eases toward the gesture's target each frame (a requestAnimationFrame lerp)
// so a fast flick of the wheel glides instead of stepping — that's the "smooth"
// part. We pin the point under the cursor while zooming (origin 0,0 + a manual
// translate), and clamp the pan so the canvas always covers the viewport (no
// empty margins). Scale floor is 1 so "dezoom" lands exactly back at rest.
//
// At rest (scale 1) we set transform:none so the canvas is NOT a containing
// block — that keeps the app's many position:fixed modals/drawers anchored to
// the real viewport. They only shift if a modal is opened while already zoomed,
// which is the rare case; everything outside the canvas (toast, swipe popup)
// stays correct always.

const MIN = 1;
const MAX = 4;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function ZoomViewport({ children }) {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;

    const target = { scale: 1, x: 0, y: 0 };   // where the gesture wants to be
    const cur = { scale: 1, x: 0, y: 0 };       // what's painted this frame
    let raf = 0;

    const isIdentity = () =>
      cur.scale <= 1.0002 && Math.abs(cur.x) < 0.5 && Math.abs(cur.y) < 0.5;

    const apply = () => {
      canvas.style.transform = isIdentity()
        ? 'none'
        : `translate(${cur.x}px, ${cur.y}px) scale(${cur.scale})`;
    };

    const tick = () => {
      const k = 0.22;   // per-frame easing (~60fps): smooth but still snappy
      cur.scale += (target.scale - cur.scale) * k;
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      const settled =
        Math.abs(target.scale - cur.scale) < 0.0005 &&
        Math.abs(target.x - cur.x) < 0.05 &&
        Math.abs(target.y - cur.y) < 0.05;
      if (settled) { cur.scale = target.scale; cur.x = target.x; cur.y = target.y; }
      apply();
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;   // plain scroll → leave page scrolling alone
      e.preventDefault();                      // also suppresses Chromium's native ctrl+wheel zoom
      const rect = viewport.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // World point under the cursor at the current target (transform-origin 0,0).
      const wx = (px - target.x) / target.scale;
      const wy = (py - target.y) / target.scale;
      const factor = Math.exp(-e.deltaY * 0.0015);   // delta → smooth multiplicative step
      const next = clamp(target.scale * factor, MIN, MAX);
      target.scale = next;
      // Keep that same world point pinned under the cursor…
      target.x = px - wx * next;
      target.y = py - wy * next;
      // …but never expose empty space: pan stays within [width*(1-scale), 0].
      target.x = clamp(target.x, rect.width * (1 - next), 0);
      target.y = clamp(target.y, rect.height * (1 - next), 0);
      kick();
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={viewportRef} className="zoom-viewport">
      <div ref={canvasRef} className="zoom-canvas">{children}</div>
    </div>
  );
}
