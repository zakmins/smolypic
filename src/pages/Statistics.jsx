import React, { useCallback, useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Avatar, SportBadge, MembershipBadge, Icons } from '../components/atoms.jsx';
import { LineChart, BarChart, Donut, Heatmap } from '../charts/Charts.jsx';
import { dzd, fmtDate, dayKey, memberStatus } from '../utils.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import Portal from '../components/Portal.jsx';
import DatePicker from '../components/DatePicker.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}h`);

const ymd = (d) => dayKey(d);                                  // Date → 'YYYY-MM-DD'
const yearStartKey = () => ymd(new Date(new Date().getFullYear(), 0, 1));
const daysAgoKey = (n) => ymd(new Date(Date.now() - n * 86400000));

// Each filterable panel fetches its own dataset for its [from, to] window from
// /stats/panel, refetching whenever a bound changes (empty bound = unbounded).
function usePanelData(metric, initialFrom, initialTo) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [data, setData] = useState(null);
  useEffect(() => {
    const qs = new URLSearchParams({ metric });
    if (from) qs.set('after', from);
    if (to) qs.set('before', to);
    let alive = true;
    setData(null);
    api(`/stats/panel?${qs.toString()}`).then((r) => { if (alive) setData(r.data); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [metric, from, to]);
  return { from, to, setFrom, setTo, data };
}

// Compact before/after date pickers pinned to the right of a panel title.
function RangeFilter({ panel }) {
  const t = useT();
  return (
    <div className="range-filter">
      <DatePicker value={panel.from} onChange={panel.setFrom} placeholder={t('Start')} ariaLabel={t('Filter from date')} width={126} />
      <span className="range-filter-sep" aria-hidden="true">→</span>
      <DatePicker value={panel.to} onChange={panel.setTo} placeholder={t('End')} ariaLabel={t('Filter to date')} width={126} />
    </div>
  );
}

function PanelLoading() {
  const t = useT();
  return <div className="empty-state" style={{ padding: '28px 0' }}>{t('Loading…')}</div>;
}

export default function Statistics() {
  const t = useT();
  const { members, setRoute, setFocusMemberId } = useContext(AppCtx);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [kpiModal, setKpiModal] = useState(null);   // 'active' | 'inactive' | null
  const [revGran, setRevGran] = useState('months'); // revenue trend granularity: 'days' | 'weeks' | 'months'

  // Filterable panels — each carries its own before/after window. Defaults mirror
  // the windows these panels used before the filter (YTD / last 60 / last 30 days).
  const revBySport = usePanelData('revenueBySport', yearStartKey(), ymd(new Date()));
  const memberGrowth = usePanelData('memberGrowth', yearStartKey(), ymd(new Date()));
  const activeBySport = usePanelData('activeBySport', yearStartKey(), ymd(new Date()));
  const peakHours = usePanelData('heatmap', daysAgoKey(60), ymd(new Date()));
  const topVisitors = usePanelData('topVisitors', daysAgoKey(30), ymd(new Date()));

  const load = useCallback(() => {
    setError(null);
    api('/stats').then(setStats).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Esc closes the KPI drill-down modal.
  useEffect(() => {
    if (!kpiModal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setKpiModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kpiModal]);

  // Open a member's profile drawer from a KPI list (mirrors Live status).
  const goToMember = (id) => { setFocusMemberId(id); setRoute('customers'); setKpiModal(null); };

  if (!stats) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">{t('Statistics')}</div>
            <div className="page-sub">{t('Revenue, membership health and floor usage — year to date.')}</div>
          </div>
        </div>
        {error ? (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--red)', marginBottom: 12 }}>
              {t('Couldn\'t load data — {msg}', { msg: error })}
            </div>
            <button className="btn primary" onClick={load}>{t('Retry')}</button>
          </div>
        ) : (
          <div className="empty-state" style={{ paddingTop: 80 }}>{t('Crunching the numbers…')}</div>
        )}
      </>
    );
  }

  const REVENUE_MONTHLY = stats.revenueMonthly;
  const REVENUE_WEEKLY = stats.revenueWeekly;
  const REVENUE_DAILY30 = stats.revenueDaily30;
  const revViews = {
    // Days: 30 points — force a uniform every-other-day tick so labels space evenly
    // instead of recharts dropping them irregularly by pixel gap.
    days: { sub: t('last 30 days'), interval: 1, labels: REVENUE_DAILY30.map((d) => d.day), data: REVENUE_DAILY30.map((d) => d.value), tips: REVENUE_DAILY30.map((d) => d.date) },
    weeks: { sub: t('last 12 weeks'), interval: 0, labels: REVENUE_WEEKLY.map((w) => w.week), data: REVENUE_WEEKLY.map((w) => w.value), tips: REVENUE_WEEKLY.map((w) => w.tip) },
    months: { sub: t('this year'), interval: 0, labels: REVENUE_MONTHLY.map((m) => m.month), data: REVENUE_MONTHLY.map((m) => m.value), tips: REVENUE_MONTHLY.map((m) => m.tip) },
  };
  const revTrend = revViews[revGran];
  const INACTIVE = stats.inactive;
  // Member revenue (subscriptions + sessions) collected in the current calendar
  // month — bucketed by month, so it naturally resets to 0 when a new month
  // begins. Stock sales never touch the payments table, so this is members-only.
  const monthIdx = new Date().getMonth();
  const MONTH_REVENUE = REVENUE_MONTHLY[monthIdx]?.value || 0;
  const MONTH_LABEL = `${REVENUE_MONTHLY[monthIdx]?.month} ${new Date().getFullYear()}`;
  // Members with a still-valid membership (not expired / out of sessions).
  const ACTIVE = members.filter((m) => memberStatus(m) !== 'expired');

  // YTD subscriptions/sessions split — feeds the Total Revenue KPI card.
  const split = stats.revenueSplit;
  const splitTotal = split.subscriptions + split.sessions || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Statistics')}</div>
          <div className="page-sub">{t('Revenue, membership health and floor usage — year to date.')}</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Total Revenue')}</div>
          <div className="v mono">{dzd(splitTotal)}</div>
          <div className="sub">{t('subscriptions + sessions')}</div>
        </div>
        <div className="stat-card violet hoverable">
          <div className="k">{t('Revenue this month')}</div>
          <div className="v mono">{dzd(MONTH_REVENUE)}</div>
          <div className="sub">{MONTH_LABEL}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('active')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('active'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Active members')}</div>
          <div className="v" style={{ color: 'var(--green)' }}>{ACTIVE.length}</div>
          <div className="sub">{t('with a valid membership')}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('inactive')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('inactive'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Inactive 30+ days')}</div>
          <div className="v" style={{ color: INACTIVE.length ? 'var(--amber)' : 'var(--green)' }}>{INACTIVE.length}</div>
          <div className="sub">{t('worth a phone call this week')}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div className="panel-title">{t('Revenue trend')}</div>
            <div className="panel-sub">{revTrend.sub}</div>
            <div className="chip-row" style={{ marginLeft: 'auto' }}>
              {[['days', t('Days')], ['weeks', t('Weeks')], ['months', t('Months')]].map(([k, label]) => (
                <button key={k} className={`chip ${revGran === k ? 'on' : ''}`}
                  onClick={() => setRevGran(k)} aria-pressed={revGran === k}>{label}</button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            <LineChart labels={revTrend.labels} height={230} interval={revTrend.interval} minTickGap={4} tips={revTrend.tips} series={[
              { name: t('Revenue'), data: revTrend.data, color: 'var(--accent)', fill: true },
            ]} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Monthly revenue — {year}', { year: new Date().getFullYear() })}</div></div>
          <div className="panel-body"><BarChart data={REVENUE_MONTHLY.map((m) => ({ label: m.month, value: m.value }))} height={210} /></div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Revenue by sport')}</div>
            <RangeFilter panel={revBySport} />
          </div>
          <div className="panel-body" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            {revBySport.data ? (() => {
              const bySport = revBySport.data.bySport;
              const sTotal = bySport.reduce((s, d) => s + d.value, 0) || 1;
              const splTot = (revBySport.data.subscriptions + revBySport.data.sessions) || 1;
              return (
                <>
                  <Donut data={bySport} centerValue={`${Math.round(sTotal / 1000)}k`} centerLabel={t('DZD')} />
                  <div style={{ display: 'grid', gap: 10 }}>
                    {bySport.map((d) => (
                      <div key={d.label} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                        <i style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: 'inline-block' }} />
                        <span style={{ width: 96, whiteSpace: 'nowrap' }}>{d.label}</span>
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 12 }}>{dzd(d.value)}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{Math.round((d.value / sTotal) * 100)}%</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, fontSize: 12.5, color: 'var(--muted)' }}>
                      {t('Subscriptions {a}% · Sessions {b}%', { a: Math.round((revBySport.data.subscriptions / splTot) * 100), b: Math.round((revBySport.data.sessions / splTot) * 100) })}
                    </div>
                  </div>
                </>
              );
            })() : <PanelLoading />}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Member growth')}</div>
            <RangeFilter panel={memberGrowth} />
          </div>
          <div className="panel-body">
            {memberGrowth.data ? (
              <LineChart labels={memberGrowth.data.map((m) => m.month)} height={200} interval={0} series={[
                { name: t('Total members'), data: memberGrowth.data.map((m) => m.value), color: 'var(--green)', fill: true },
              ]} />
            ) : <PanelLoading />}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Active members by sport')}</div>
            <RangeFilter panel={activeBySport} />
          </div>
          <div className="panel-body">
            {activeBySport.data ? <BarChart data={activeBySport.data} height={200} /> : <PanelLoading />}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-head">
            <div className="panel-title">{t('Peak hours — entries by hour × day')}</div>
            <RangeFilter panel={peakHours} />
          </div>
          <div className="panel-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {peakHours.data ? <Heatmap grid={peakHours.data} hours={HOURS} days={DAYS.map((d) => t(d))} /> : <PanelLoading />}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Most frequent visitors')}</div>
            <RangeFilter panel={topVisitors} />
          </div>
          <div className="panel-body">
            {!topVisitors.data ? <PanelLoading />
              : topVisitors.data.length === 0 ? <div className="empty-state" style={{ padding: '28px 0' }}>{t('No visits in this range.')}</div>
              : topVisitors.data.slice(0, 5).map((tv, i) => (
                <div key={tv.member.id} className="leader-row">
                  <span className={`leader-rank ${i < 3 ? 'top' : ''}`}>{i + 1}</span>
                  <Avatar member={tv.member} size="sm" />
                  <span style={{ fontWeight: 600 }}>{tv.member.name}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                    {t('{visits} visits · avg {min} min', { visits: tv.visits, min: tv.avgMin })}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {kpiModal && (() => {
        const views = {
          active: { title: t('Active members'), items: ACTIVE, tone: 'green' },
          inactive: { title: t('Inactive 30+ days'), items: INACTIVE, tone: 'amber' },
        };
        const view = views[kpiModal];
        return (
          <Portal>
          <div className="modal-center" onClick={() => setKpiModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={view.title}>
              <div className="modal-head">
                <div className="modal-title">{view.title}</div>
                <span className="panel-sub" style={{ marginLeft: 12 }}>{t('{n} total', { n: view.items.length })}</span>
                <button className="x-btn" onClick={() => setKpiModal(null)} aria-label={t('Close')}>×</button>
              </div>
              <div className="modal-body kpi-list" style={{ padding: 0 }}>
                {view.items.length === 0 ? (
                  <div className="empty-state" style={{ padding: '28px 0' }}>
                    {kpiModal === 'inactive' ? t('Everyone has trained recently.') : t('Nothing to show here.')}
                  </div>
                ) : view.items.map((m) => (
                  <div key={m.id} className="live-row" role="button" tabIndex={0}
                    title={t("Open {name}'s profile", { name: m.name })}
                    onClick={() => goToMember(m.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToMember(m.id); } }}>
                    <Avatar member={m} />
                    <div style={{ minWidth: 0 }}>
                      <div className="live-name">{m.name}</div>
                      <div className="live-meta">
                        {m.sports.map((s) => <SportBadge key={s} sport={s} />)}
                        <MembershipBadge member={m} />
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: `var(--${view.tone})` }}>
                      {t('last seen {date}', { date: fmtDate(m.lastVisit) })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}
    </>
  );
}
