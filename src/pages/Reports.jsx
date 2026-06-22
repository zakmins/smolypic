import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, LineChart, Donut } from '../charts/Charts.jsx';
import { dzd } from '../utils.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

// A section heading that separates the distinct reports on the page.
function SectionHead({ title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '8px 0 14px' }}>
      <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontStyle: 'italic', fontSize: 18 }}>{title}</div>
      {sub && <div className="panel-sub" style={{ marginLeft: 0 }}>{sub}</div>}
    </div>
  );
}

export default function MembersReports() {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api('/reports/members').then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const year = new Date().getFullYear();

  if (!data) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">{t('Reports')}</div>
            <div className="page-sub">{t('Session revenue & insurance — year to date.')}</div>
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

  const s = data.sessions;
  const ins = data.insurance;
  const coverage = [
    { label: t('Insured'), value: ins.insuredCount, color: '#22C55E' },
    { label: t('Not insured'), value: ins.notInsuredCount, color: '#FF5468' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Reports')}</div>
          <div className="page-sub">{t('Session revenue & insurance — year to date.')}</div>
        </div>
      </div>

      {/* ── Session Reports ─────────────────────────────────────────────── */}
      <SectionHead title={t('Session Reports')} sub={t('One-off sessions added with + Session')} />

      <div className="stat-grid">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Session revenue (YTD)')}</div>
          <div className="v mono">{dzd(s.revenueYtd)}</div>
          <div className="sub">{t('{n} sessions this year', { n: s.countYtd })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Total sessions (YTD)')}</div>
          <div className="v">{s.countYtd}</div>
          <div className="sub">{t('{n} today', { n: s.countToday })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Avg. session price')}</div>
          <div className="v mono">{dzd(s.avgPrice)}</div>
          <div className="sub">{t('per session, this year')}</div>
        </div>
        <div className="stat-card violet hoverable">
          <div className="k">{t('Sessions this month')}</div>
          <div className="v mono">{dzd(s.revenueMonth)}</div>
          <div className="sub">{t('{n} sessions', { n: s.countMonth })}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div className="panel-title">{t('Session revenue by month')}</div>
            <div className="panel-sub">{year}</div>
          </div>
          <div className="panel-body">
            <BarChart data={s.monthly.map((m) => ({ label: m.month, value: m.value }))} height={220} color="#22C55E" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Sessions per day')}</div>
            <div className="panel-sub">{t('last 30 days')}</div>
          </div>
          <div className="panel-body">
            <LineChart height={210} interval={1} minTickGap={4}
              labels={s.daily.map((d) => d.day)} tips={s.daily.map((d) => d.date)}
              series={[{ name: t('Sessions'), data: s.daily.map((d) => d.count), color: 'var(--accent)', fill: true }]} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Sessions — key figures')}</div></div>
          <div className="panel-body">
            {[
              [t('Sessions today'), String(s.countToday), dzd(s.revenueToday)],
              [t('This month'), t('{n} sessions', { n: s.countMonth }), dzd(s.revenueMonth)],
              [t('This year'), t('{n} sessions', { n: s.countYtd }), dzd(s.revenueYtd)],
              [t('Average price'), null, dzd(s.avgPrice)],
              [t('All time'), t('{n} sessions', { n: s.countAllTime }), dzd(s.revenueAllTime)],
            ].map(([label, count, value]) => (
              <div key={label} className="leader-row">
                <span style={{ fontWeight: 600 }}>{label}</span>
                {count && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--muted)' }}>{count}</span>}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 13 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Insurance Report ────────────────────────────────────────────── */}
      <SectionHead title={t('Insurance Report')} sub={t('{fee} / member / year', { fee: dzd(ins.feePerYear) })} />

      <div className="stat-grid">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Insurance revenue')}</div>
          <div className="v mono">{dzd(ins.revenueAllTime)}</div>
          <div className="sub">{t('{amount} this month', { amount: dzd(ins.revenueMonth) })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Insured members')}</div>
          <div className="v" style={{ color: 'var(--green)' }}>{ins.insuredCount}</div>
          <div className="sub">{t('{n}% of {total} covered', { n: ins.coverageRate, total: ins.totalMembers })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Not insured')}</div>
          <div className="v" style={{ color: ins.notInsuredCount ? 'var(--red)' : 'var(--green)' }}>{ins.notInsuredCount}</div>
          <div className="sub">{t('members without cover')}</div>
        </div>
        <div className="stat-card violet hoverable">
          <div className="k">{t('Expiring ≤ 30 days')}</div>
          <div className="v">{ins.expiringSoon}</div>
          <div className="sub">{t('{n} already lapsed', { n: ins.lapsedCount })}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div className="panel-title">{t('Insurance revenue by month')}</div>
            <div className="panel-sub">{year}</div>
          </div>
          <div className="panel-body">
            <BarChart data={ins.monthly.map((m) => ({ label: m.month, value: m.value }))} height={220} color="#6366F1" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Coverage')}</div></div>
          <div className="panel-body" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            <Donut data={coverage} centerValue={`${ins.coverageRate}%`} centerLabel={t('insured')} />
            <div style={{ display: 'grid', gap: 10 }}>
              {coverage.map((d) => (
                <div key={d.label} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: 'inline-block' }} />
                  <span style={{ width: 84, whiteSpace: 'nowrap' }}>{d.label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Insurance — key figures')}</div></div>
          <div className="panel-body">
            {[
              [t('Fee per member / year'), dzd(ins.feePerYear)],
              [t('Revenue this year'), dzd(ins.revenueYtd)],
              [t('Revenue this month'), dzd(ins.revenueMonth)],
              [t('Lapsed (need renewal)'), String(ins.lapsedCount)],
            ].map(([label, value]) => (
              <div key={label} className="leader-row">
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 13 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
