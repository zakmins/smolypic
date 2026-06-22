import React from 'react';
import { initials, SPORT_COLOR, BELT_COLOR } from '../utils.js';
import { useT } from '../i18n.jsx';

export function Avatar({ member, size = '' }) {
  // With a portrait, fill the rounded-square shape with the JPEG served over
  // smolphoto://; photoTag busts the cache when a photo is replaced/removed.
  if (member.hasPhoto) {
    return (
      <div className={`avatar ${size} has-photo`} aria-hidden="true">
        <img src={`smolphoto://photo/${member.id}?v=${member.photoTag ?? 0}`} alt="" />
      </div>
    );
  }
  return (
    <div className={`avatar ${size}`} style={{ background: `hsl(${member.hue} 62% 62%)` }} aria-hidden="true">
      {initials(member.name)}
    </div>
  );
}

export const SportBadge = ({ sport }) => (
  <span className={`badge ${sport.toLowerCase()}`}>{sport}</span>
);

export function MembershipBadge({ member }) {
  const t = useT();
  if (member.membershipType === 'session') return <span className="badge amber">{t('Session')}</span>;
  return <span className="badge green">{t('Subscribed')}</span>;
}

export function BeltStrip({ level }) {
  const t = useT();
  return (
    <div className="belt-strip" title={t('Belt level {n} of 8', { n: level + 1 })}>
      {BELT_COLOR.map((c, i) => (
        <span key={i} className={`belt-seg ${i <= level ? 'earned' : ''}`}
          style={i <= level ? { background: c } : undefined} />
      ))}
    </div>
  );
}

export const ResultBadge = ({ result }) => {
  const t = useT();
  const map = { gold: ['amber', '🥇 Gold'], silver: ['neutral', '🥈 Silver'], bronze: ['gym', '🥉 Bronze'], loss: ['neutral', 'Loss'] };
  const [cls, label] = map[result] || ['neutral', result];
  return <span className={`badge ${cls}`}>{t(label)}</span>;
};

// Minimal inline icon set (stroke icons, inherit currentColor).
const I = (path, extra = null) => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {path}{extra}
  </svg>
);
export const Icons = {
  live: I(<><circle cx="12" cy="12" r="3" /><path d="M5 5a10 10 0 0 1 14 0M3 12a9 9 0 0 1 2.6-6.4M21 12a9 9 0 0 0-2.6-6.4" /></>),
  members: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" /></>),
  judo: I(<><circle cx="12" cy="5" r="2.6" /><path d="M5 11l5 1 2 4 4 5M19 10l-7 2M9 21l2-5" /></>),
  wrestling: I(<><circle cx="7" cy="5" r="2.2" /><circle cx="17" cy="5" r="2.2" /><path d="M5 21l3-8 4 3 4-3 3 8M9 13l3-4 3 4" /></>),
  stats: I(<><path d="M3 21h18" /><rect x="5" y="11" width="3.4" height="7" rx="1" /><rect x="10.3" y="6" width="3.4" height="12" rx="1" /><rect x="15.6" y="13" width="3.4" height="5" rx="1" /></>),
  stock: I(<><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>),
  warn: I(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>),
  swipe: I(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  calendar: I(<><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>),
  chevron: I(<path d="M6 9l6 6 6-6" />),
  check: I(<path d="M20 6 9 17l-5-5" />),
  camera: I(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
  plus: I(<path d="M12 5v14M5 12h14" />),
  sun: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: I(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  shield: I(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>),
  logout: I(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>),
  arrow: I(<path d="M5 12h14M13 6l6 6-6 6" />),
  trash: I(<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>),
  report: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" /></>),
  settings: I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
};
