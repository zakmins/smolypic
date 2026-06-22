// Per-user accent theming. Each user has one hex color that themes the whole app
// while they're logged in. We override ONLY the accent-family CSS variables at
// runtime (inline on <html>, which beats the :root[data-theme] rules), so the
// light/dark base palette set by theme.jsx keeps working underneath.

// Every variable applyAccent overrides — clearAccent removes exactly these so the
// CSS default (emerald) palette shows through again.
const ACCENT_VARS = [
  '--accent', '--accent-2', '--grad', '--accent-soft', '--accent-glow', '--on-accent',
  '--bg', '--bg-grad', '--panel', '--panel-2', '--raised', '--tooltip-bg',
  '--line', '--line-strong', '--text', '--muted', '--faint',
];

// The default neutral surfaces/text carry a faint green hue (≈150°). We re-tint
// them to the accent hue, keeping each token's own saturation & lightness, so a
// coach's whole environment matches their color instead of just the accent
// widgets. These are the exact values from styles.css :root[data-theme=…].
const SURFACES = {
  dark: {
    '--bg': '#070C0A', '--panel': '#0E1512', '--panel-2': '#131C18',
    '--raised': '#1B2620', '--tooltip-bg': '#16201B',
    '--text': '#EAF4EF', '--muted': '#8FA69C', '--faint': '#5E7269',
  },
  light: {
    '--bg': '#F2F6F4', '--panel': '#FFFFFF', '--panel-2': '#F6FAF8',
    '--raised': '#EAF2EE', '--tooltip-bg': '#0E1512',
    '--text': '#0C1512', '--muted': '#5B6E66', '--faint': '#8FA39A',
  },
};
// Lines: dark uses a greenish base at low alpha; light uses solid hex.
const LINES = {
  dark: { '--line': ['#9EC0B1', 0.13], '--line-strong': ['#9EC0B1', 0.26] },
  light: { '--line': ['#E3ECE7', 1], '--line-strong': ['#CFDDD6', 1] },
};
// Corner glow opacities, matching the original --bg-grad per theme.
const GRAD_ALPHA = { dark: [0.07, 0.06], light: [0.08, 0.06] };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// Swap a base color's hue to `hue`, keeping its saturation & lightness.
function tintHex(hue, baseHex) {
  const { r, g, b } = hexToRgb(baseHex);
  const { s, l } = rgbToHsl(r, g, b);
  return hslToHex(hue, s, l);
}
// Same, returned as an rgba() string at the given alpha.
function tintRgba(hue, baseHex, a) {
  const { r, g, b } = hexToRgb(tintHex(hue, baseHex));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Apply a user's hex color to the accent-family variables for the active theme. */
export function applyAccent(hex, theme = 'dark') {
  if (!hex) return clearAccent();
  const root = document.documentElement;
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);

  // Gradient partner: nudge the hue and lighten slightly, the way emerald→teal does.
  const accent2 = hslToHex(h + 16, clamp(s * 0.96, 0, 1), clamp(l + 0.04, 0, 0.92));

  // Soft/glow alphas track the original token values per theme.
  const softA = theme === 'light' ? 0.11 : 0.13;
  const glowA = theme === 'light' ? 0.30 : 0.32;

  // Readable text on the accent: dark ink on light colors, white on dark ones.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const onAccent = luminance > 0.55 ? '#04140D' : '#FFFFFF';

  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-2', accent2);
  root.style.setProperty('--grad', `linear-gradient(115deg, ${hex} 10%, ${accent2} 90%)`);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, ${softA})`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, ${glowA})`);
  root.style.setProperty('--on-accent', onAccent);

  // ── Tint the background to match ──────────────────────────────────────────
  const t = theme === 'light' ? 'light' : 'dark';

  // Corner glows: accent in one corner, its gradient partner in the other.
  const a2 = hexToRgb(accent2);
  const [g1, g2] = GRAD_ALPHA[t];
  root.style.setProperty('--bg-grad',
    `radial-gradient(1100px 500px at 85% -10%, rgba(${r}, ${g}, ${b}, ${g1}), transparent 60%), `
    + `radial-gradient(900px 460px at -10% 110%, rgba(${a2.r}, ${a2.g}, ${a2.b}, ${g2}), transparent 55%)`);

  // Neutral surfaces & text: hue-swapped to the accent, depth ladder preserved.
  for (const [name, base] of Object.entries(SURFACES[t])) {
    root.style.setProperty(name, tintHex(h, base));
  }
  for (const [name, [base, alpha]] of Object.entries(LINES[t])) {
    root.style.setProperty(name, alpha === 1 ? tintHex(h, base) : tintRgba(h, base, alpha));
  }
}

/** Remove the overrides so the CSS default (emerald) palette shows through. */
export function clearAccent() {
  const root = document.documentElement;
  ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
}
