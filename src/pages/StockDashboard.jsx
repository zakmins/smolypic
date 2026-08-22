import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, LineChart, Donut } from '../charts/Charts.jsx';
import { dzd, dayKey } from '../utils.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import DatePicker from '../components/DatePicker.jsx';

// Compact before/after date filter, pinned to the right of a panel title.
function RangeFilter({ from, to, setFrom, setTo }) {
  const t = useT();
  return (
    <div className="range-filter">
      <DatePicker value={from} onChange={setFrom} placeholder={t('Start')} ariaLabel={t('Filter from date')} width={126} />
      <span className="range-filter-sep" aria-hidden="true">→</span>
      <DatePicker value={to} onChange={setTo} placeholder={t('End')} ariaLabel={t('Filter to date')} width={126} />
    </div>
  );
}

export default function StockDashboard() {
  const t = useT();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  // Shared date filter driving the top KPI cards. Defaults to year-to-date
  // (an empty bound means unbounded on that side).
  const [from, setFrom] = useState(() => dayKey(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(() => dayKey(new Date()));
  const [sum, setSum] = useState(null);

  // "Sales by category" panel — its own before/after window (defaults to YTD).
  const [sbcFrom, setSbcFrom] = useState(() => dayKey(new Date(new Date().getFullYear(), 0, 1)));
  const [sbcTo, setSbcTo] = useState(() => dayKey(new Date()));
  const [sbc, setSbc] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api('/reports/stock').then(setD).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Recompute the card figures whenever the range changes.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('after', from);
    if (to) qs.set('before', to);
    let alive = true;
    setSum(null);
    api(`/reports/stock/summary?${qs.toString()}`).then((r) => { if (alive) setSum(r); }).catch(() => { if (alive) setSum(null); });
    return () => { alive = false; };
  }, [from, to]);

  // Fetch "Sales by category" for its own range.
  useEffect(() => {
    const qs = new URLSearchParams({ metric: 'salesByCategory' });
    if (sbcFrom) qs.set('after', sbcFrom);
    if (sbcTo) qs.set('before', sbcTo);
    let alive = true;
    setSbc(null);
    api(`/reports/stock/panel?${qs.toString()}`).then((r) => { if (alive) setSbc(r.data); }).catch(() => { if (alive) setSbc(null); });
    return () => { alive = false; };
  }, [sbcFrom, sbcTo]);

  if (!d) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">{t('Stock dashboard')}</div>
            <div className="page-sub">{t('Sales, profit & shrinkage — this month.')}</div>
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

  const stockCatTotal = d.valueByCategory.reduce((a, c) => a + c.value, 0) || 1;
  const year = new Date().getFullYear();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Stock dashboard')}</div>
          <div className="page-sub">{t('Sales, profit & shrinkage.')}</div>
        </div>
      </div>

      <div className="stock-hero">
        <div className="stock-hl">
          <div className="stock-hl-k">{t('Value at purchase cost')}</div>
          <div className="stock-hl-v">{dzd(d.stockValue)}</div>
        </div>
        <span className="stock-hl-sep" aria-hidden="true">→</span>
        <div className="stock-hl">
          <div className="stock-hl-k">{t('Value at sale price')}</div>
          <div className="stock-hl-v grad-text">{dzd(d.stockValueSale)}</div>
        </div>
      </div>

      <div className="stock-filter-bar">
        <span className="stock-filter-label">{t('Showing')}</span>
        <DatePicker value={from} onChange={setFrom} placeholder={t('Start')} ariaLabel={t('Filter from date')} width={152} />
        <span className="range-filter-sep" aria-hidden="true">→</span>
        <DatePicker value={to} onChange={setTo} placeholder={t('End')} ariaLabel={t('Filter to date')} width={152} />
      </div>

      <div className="stat-grid">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Sales revenue')}</div>
          <div className="v mono">{sum ? dzd(sum.salesRevenue) : '…'}</div>
          <div className="sub">{t('gross sales')}</div>
        </div>
        <div className="stat-card violet hoverable">
          <div className="k">{t('Gross profit')}</div>
          <div className="v mono">{sum ? dzd(sum.grossProfit) : '…'}</div>
          <div className="sub">{t('{n}% margin', { n: sum ? sum.marginPct : 0 })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Units sold')}</div>
          <div className="v">{sum ? sum.unitsSold : '…'}</div>
          <div className="sub">{t('items sold')}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Inventory losses')}</div>
          <div className="v mono" style={{ color: sum && sum.losses ? 'var(--red)' : 'var(--green)' }}>{sum ? dzd(sum.losses) : '…'}</div>
          <div className="sub">{t('{n} units damaged + expired', { n: sum ? sum.lossUnits : 0 })}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div className="panel-title">{t('Sales revenue by month')}</div>
            <div className="panel-sub">{year}</div>
          </div>
          <div className="panel-body">
            <BarChart data={d.monthly.map((m) => ({ label: m.month, value: m.value }))} height={220} color="#22C55E" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Sales by category')}</div>
            <RangeFilter from={sbcFrom} to={sbcTo} setFrom={setSbcFrom} setTo={setSbcTo} />
          </div>
          <div className="panel-body" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            {!sbc ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>{t('Loading…')}</div>
            ) : sbc.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>{t('No sales recorded yet.')}</div>
            ) : (() => {
              const total = sbc.reduce((a, c) => a + c.value, 0) || 1;
              return (
                <>
                  <Donut data={sbc} centerValue={`${Math.round(total / 1000)}k`} centerLabel={t('DZD')} />
                  <div style={{ display: 'grid', gap: 10 }}>
                    {sbc.map((c) => (
                      <div key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                        <i style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: 'inline-block' }} />
                        <span style={{ width: 96, whiteSpace: 'nowrap' }}>{t(c.label)}</span>
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 12 }}>{dzd(c.value)}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{Math.round((c.value / total) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Stock value by category')}</div><div className="panel-sub">{t('at purchase cost')}</div></div>
          <div className="panel-body" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            {d.valueByCategory.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>{t('No stock on hand.')}</div>
            ) : (
              <>
                <Donut data={d.valueByCategory} centerValue={`${Math.round(stockCatTotal / 1000)}k`} centerLabel={t('DZD')} />
                <div style={{ display: 'grid', gap: 10 }}>
                  {d.valueByCategory.map((c) => (
                    <div key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                      <i style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: 'inline-block' }} />
                      <span style={{ width: 96, whiteSpace: 'nowrap' }}>{t(c.label)}</span>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 12 }}>{dzd(c.value)}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{Math.round((c.value / stockCatTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel wide">
          <div className="panel-head">
            <div className="panel-title">{t('Daily sales')}</div>
            <div className="panel-sub">{t('last 30 days')}</div>
          </div>
          <div className="panel-body">
            <LineChart height={210} interval={1} minTickGap={4}
              labels={d.daily.map((x) => x.day)} tips={d.daily.map((x) => x.date)}
              breakdowns={d.daily.map((x) => x.breakdown)}
              series={[{ name: t('Sales'), data: d.daily.map((x) => x.value), color: 'var(--accent)', fill: true }]} />
          </div>
        </div>
      </div>
    </>
  );
}
