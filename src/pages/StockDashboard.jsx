import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { BarChart, LineChart, Donut } from '../charts/Charts.jsx';
import { dzd } from '../utils.js';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

export default function StockDashboard() {
  const t = useT();
  const { showToast } = useContext(AppCtx);
  const [d, setD] = useState(null);

  useEffect(() => {
    api('/reports/stock').then(setD).catch((e) => showToast(`Stock dashboard failed: ${e.message}`));
  }, [showToast]);

  if (!d) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">{t('Stock dashboard')}</div>
            <div className="page-sub">{t('Sales, profit & shrinkage — this month.')}</div>
          </div>
        </div>
        <div className="empty-state" style={{ paddingTop: 80 }}>{t('Crunching the numbers…')}</div>
      </>
    );
  }

  const catTotal = d.byCategory.reduce((a, c) => a + c.value, 0) || 1;
  const stockCatTotal = d.valueByCategory.reduce((a, c) => a + c.value, 0) || 1;
  const year = new Date().getFullYear();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Stock dashboard')}</div>
          <div className="page-sub">{t('Sales, profit & shrinkage — this month.')}</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Sales revenue')}</div>
          <div className="v mono">{dzd(d.salesRevenueMonth)}</div>
          <div className="sub">{t('this month')}</div>
        </div>
        <div className="stat-card violet hoverable">
          <div className="k">{t('Gross profit')}</div>
          <div className="v mono">{dzd(d.grossProfitMonth)}</div>
          <div className="sub">{t('{n}% margin this month', { n: d.marginPct })}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Stock value')}</div>
          <div className="v mono">{dzd(d.stockValue)}</div>
          <div className="sub">{t('at purchase cost')}</div>
        </div>
        <div className="stat-card hoverable">
          <div className="k">{t('Inventory losses')}</div>
          <div className="v mono" style={{ color: d.lossesMonth ? 'var(--red)' : 'var(--green)' }}>{dzd(d.lossesMonth)}</div>
          <div className="sub">{t('{n} units damaged + expired', { n: d.lossUnitsMonth })}</div>
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
          <div className="panel-head"><div className="panel-title">{t('Sales by category')}</div></div>
          <div className="panel-body" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            {d.byCategory.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>{t('No sales recorded yet.')}</div>
            ) : (
              <>
                <Donut data={d.byCategory} centerValue={`${Math.round(catTotal / 1000)}k`} centerLabel={t('DZD YTD')} />
                <div style={{ display: 'grid', gap: 10 }}>
                  {d.byCategory.map((c) => (
                    <div key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                      <i style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: 'inline-block' }} />
                      <span style={{ width: 96, whiteSpace: 'nowrap' }}>{t(c.label)}</span>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 12 }}>{dzd(c.value)}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{Math.round((c.value / catTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
