import React, { useState } from 'react';
import { Icons } from './atoms.jsx';
import { useAuth } from '../auth.jsx';
import { useTheme } from '../theme.jsx';
import { useT } from '../i18n.jsx';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

// Top-level navigation. A bare `item` is its own button (Live status stands
// alone, no dropdown); a `group` is a collapsible dropdown holding sub-routes.
const NAV = [
  { type: 'item', key: 'live', label: 'Live status', icon: Icons.live },
  { type: 'group', key: 'members', label: 'Members', icon: Icons.members, items: [
    { key: 'customers', label: 'List of members', icon: Icons.members },
    { key: 'judo', label: 'Judo', icon: Icons.judo },
    { key: 'wrestling', label: 'Wrestling', icon: Icons.wrestling },
    { key: 'stats', label: 'Dashboard', icon: Icons.stats },
    { key: 'members-reports', label: 'Reports', icon: Icons.report },
  ]},
  { type: 'group', key: 'stock', label: 'Stock', icon: Icons.stock, items: [
    { key: 'stock', label: 'Management', icon: Icons.stock },
    { key: 'stock-inventory', label: 'Inventory', icon: Icons.report },
    { key: 'stock-dashboard', label: 'Dashboard', icon: Icons.stats },
  ]},
];

// The System group: the administrator manages users and settings; a coach only
// gets settings.
const systemGroup = (isAdmin) => ({
  type: 'group', key: 'system', label: 'System', icon: Icons.settings,
  items: [
    ...(isAdmin ? [{ key: 'users', label: 'Manage users', icon: Icons.shield }] : []),
    { key: 'settings', label: 'Settings', icon: Icons.settings },
  ],
});

export default function Sidebar({ route, setRoute }) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const t = useT();
  const nav = [...NAV, systemGroup(currentUser?.role === 'admin')];

  // Each dropdown starts open if it owns the current route, so the active page
  // is always visible after a reload.
  const ownerOf = (key) => nav.find((e) => e.type === 'group' && e.items.some((it) => it.key === key))?.key;
  const [open, setOpen] = useState(() => {
    const owner = ownerOf(route);
    return owner ? { [owner]: true } : {};
  });
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  return (
    <aside className="sidebar">
      <div className="logo">
        <img className="logo-img" src={theme === 'dark' ? logoDark : logoLight} alt="Sm'Olympic Gym" />
      </div>
      <nav className="nav" aria-label={t('Main navigation')}>
        {nav.map((entry) => (
          entry.type === 'item' ? (
            <button key={entry.key} className={`nav-item ${route === entry.key ? 'active' : ''}`} onClick={() => setRoute(entry.key)}>
              <entry.icon /> {t(entry.label)}
            </button>
          ) : (
            <div key={entry.key} className="nav-group">
              <button
                className={`nav-item nav-group-head ${open[entry.key] ? 'open' : ''} ${entry.items.some((it) => it.key === route) ? 'has-active' : ''}`}
                onClick={() => toggle(entry.key)}
                aria-expanded={!!open[entry.key]}
              >
                <entry.icon /> <span className="nav-group-label">{t(entry.label)}</span>
                <Icons.chevron className="nav-caret" />
              </button>
              {open[entry.key] && (
                <div className="nav-sub">
                  {entry.items.map((it) => (
                    <button key={it.key} className={`nav-item nav-subitem ${route === it.key ? 'active' : ''}`} onClick={() => setRoute(it.key)}>
                      <it.icon /> {t(it.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        ))}
      </nav>
      <div className="nav-spacer" />
      <div className="sidebar-foot">v0.1.0 · {t('entrance reader online')}</div>
    </aside>
  );
}
