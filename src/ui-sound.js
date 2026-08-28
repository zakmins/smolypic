// Tiny UI feedback sounds (button clicks, not the French TTS speech), synthesized
// with Web Audio so there's no audio asset to bundle/package. One shared
// AudioContext, lazily created on first use (browsers block autoplay before a
// user gesture, and a click is exactly that).
let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function beep(freq, startOffset = 0, duration = 0.09, gain = 0.16) {
  try {
    const c = getCtx();
    const start = c.currentTime + startOffset;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g); g.connect(c.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch { /* Web Audio unavailable — silently skip */ }
}

// Two-note rising chirp.
export function playUnmuteSound() {
  beep(660, 0);
  beep(880, 0.07);
}

// Two-note falling chirp.
export function playMuteSound() {
  beep(520, 0);
  beep(360, 0.07);
}
