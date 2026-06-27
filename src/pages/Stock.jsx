import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Icons } from '../components/atoms.jsx';
import { STOCK_CATEGORIES, dzd, fmtDate, pageList, isWeightItem, fmtWeight, fmtStockQty, buyPerKg } from '../utils.js';
import { useT } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Select from '../components/Select.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Portal from '../components/Portal.jsx';

const LOG_PAGE_SIZE = 12;   // movement-log rows per page
// Shelf life measured to the END of the expiry day, so an item is still good ON
// its expiry date and only counts as expired the day after. Null expiry ⇒ never
// flagged. "Expiring soon" is the next 30 days and excludes already-expired
// items — those get their own (red) bucket so they don't hide as amber warnings.
const expiryMsLeft = (it) => (it.expiry
  ? new Date(`${String(it.expiry).slice(0, 10)}T23:59:59`).getTime() - Date.now()
  : null);
const isExpired = (it) => { const ms = expiryMsLeft(it); return ms != null && ms < 0; };
const expiringSoon = (it) => { const ms = expiryMsLeft(it); return ms != null && ms >= 0 && ms <= 30 * 86400000; };

// ── Stock › Management: KPIs + recent-sales history ───────────────────────────
export function StockManagement() {
  const t = useT();
  const { stock, stockLog, saveStockItem } = useContext(AppCtx);
  const [kpiModal, setKpiModal] = useState(null);   // 'low' | 'expiring' | 'expired' | 'out' | null
  const [editing, setEditing] = useState(null);     // item opened from a KPI list

  const totalValue = Math.round(stock.reduce((s, it) => s + it.qty * it.buy, 0));
  const low = stock.filter((it) => it.qty < it.min);
  const expiring = stock.filter(expiringSoon);
  const expired = stock.filter(isExpired);
  const outOfStock = stock.filter((it) => it.qty === 0);

  // Esc closes the KPI drill-down modal.
  useEffect(() => {
    if (!kpiModal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setKpiModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kpiModal]);

  // Compact relative-time label ("just now" / "23 min ago" / "5 h ago" / "2 d ago").
  const timeAgo = (dateStr) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (mins < 1) return t('just now');
    if (mins < 60) return t('{n} min ago', { n: mins });
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return t('{n} h ago', { n: hrs });
    return t('{n} d ago', { n: Math.round(hrs / 24) });
  };

  // The last 5 sold movements, priced at the sale time (or current sell price).
  const recentSales = useMemo(() => stockLog
    .filter((l) => l.action === 'remove' && l.reason === 'Sold')
    .slice(0, 5)
    .map((l) => {
      const it = stock.find((x) => x.id === l.itemId);
      const weight = isWeightItem(it);
      const fallback = it && it.sell != null ? it.sell * l.qty : null;
      const total = l.cost != null ? l.cost : fallback;
      return {
        id: l.id,
        name: it ? it.name : `#${l.itemId}`,
        category: it ? it.category : null,
        weight,
        // Weight sales show the portion ("200 g"); unit sales show a ×count and a per-unit price.
        qtyLabel: weight ? fmtWeight(l.qty) : `×${l.qty}`,
        unit: !weight && total != null ? Math.round(total / l.qty) : null,
        total,
        date: l.date,
      };
    }), [stockLog, stock]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Stock management')}</div>
          <div className="page-sub">{t('Overview & recent sales')}</div>
        </div>
      </div>

      <div className="stat-grid five">
        <div className="stat-card accent hoverable">
          <div className="k">{t('Total stock value')}</div>
          <div className="v mono">{dzd(totalValue)}</div>
          <div className="sub">{t('at purchase cost')}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('low')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('low'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Below threshold')}</div>
          <div className="v" style={{ color: low.length ? 'var(--red)' : 'var(--green)' }}>{low.length}</div>
          <div className="sub">{t('items need a restock order')}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('expiring')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('expiring'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Expiring ≤ 30 days')}</div>
          <div className="v" style={{ color: expiring.length ? 'var(--amber)' : 'var(--green)' }}>{expiring.length}</div>
          <div className="sub">{t('supplement batches to rotate')}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('expired')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('expired'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Expired')}</div>
          <div className="v" style={{ color: expired.length ? 'var(--red)' : 'var(--green)' }}>{expired.length}</div>
          <div className="sub">{t('past expiry — write off')}</div>
        </div>
        <div className="stat-card clickable" role="button" tabIndex={0}
          onClick={() => setKpiModal('out')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKpiModal('out'); } }}>
          <Icons.arrow className="kpi-arrow" width="18" height="18" />
          <div className="k">{t('Out of stock')}</div>
          <div className="v" style={{ color: outOfStock.length ? 'var(--red)' : 'var(--green)' }}>{outOfStock.length}</div>
          <div className="sub">{t('items at zero — restock now')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <div className="panel-title">{t('Recent sales')}</div>
          <div className="panel-sub">{t('last 5 items sold')}</div>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {recentSales.length === 0 ? (
            <div className="empty-state" style={{ padding: '22px 0' }}>{t('No sales recorded yet.')}</div>
          ) : recentSales.map((s) => (
            <div key={s.id} className="sale-row">
              <span className="sale-qty">{s.qtyLabel}</span>
              <div className="sale-main">
                <div className="sale-name">{s.name}</div>
                <div className="sale-meta">
                  {s.category && <span className="badge neutral">{t(s.category)}</span>}
                  <span>{timeAgo(s.date)}</span>
                  {s.unit != null && <span>· {t('{price} each', { price: dzd(s.unit) })}</span>}
                </div>
              </div>
              <div className="sale-amount mono">{s.total != null ? dzd(s.total) : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {kpiModal && (() => {
        const views = {
          low: { title: t('Below threshold'), tone: 'red', items: low },
          expiring: { title: t('Expiring ≤ 30 days'), tone: 'amber', items: expiring },
          expired: { title: t('Expired'), tone: 'red', items: expired },
          out: { title: t('Out of stock'), tone: 'red', items: outOfStock },
        };
        const view = views[kpiModal];
        const detailFor = (it) => (kpiModal === 'expiring'
          ? t('expires {date}', { date: fmtDate(it.expiry) })
          : kpiModal === 'expired'
          ? t('expired {date}', { date: fmtDate(it.expiry) })
          : t('{qty} in stock · min {min}', {
            qty: isWeightItem(it) ? fmtWeight(it.qty) : it.qty,
            min: isWeightItem(it) ? fmtWeight(it.min) : it.min,
          }));
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
                  <div className="empty-state" style={{ padding: '28px 0' }}>{t('Nothing to show here.')}</div>
                ) : view.items.map((it) => (
                  <div key={it.id} className="kpi-stock-row" role="button" tabIndex={0}
                    title={t('Open {name}', { name: it.name })}
                    onClick={() => { setEditing(it); setKpiModal(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(it); setKpiModal(null); } }}>
                    <Icons.warn width="16" height="16" style={{ color: `var(--${view.tone})`, flex: 'none' }} />
                    <span className="name">{it.name}</span>
                    <span className="badge neutral">{t(it.category)}</span>
                    <span className={`right ${view.tone}`}>{detailFor(it)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}

      {editing && (
        <StockForm item={editing} stock={stock}
          onClose={() => setEditing(null)}
          onSave={(it) => { saveStockItem(it); setEditing(null); }} />
      )}
    </>
  );
}

// ── Stock › Inventory: items, movement log, most consumed ─────────────────────
export function StockInventory() {
  const t = useT();
  const { stock, stockLog, consumed, saveStockItem, stockOperation, deleteStockItem, clearStockLog } = useContext(AppCtx);
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('inventory');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);   // item | 'new'
  const [op, setOp] = useState(null);             // { item, action }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmClearLog, setConfirmClearLog] = useState(false);
  const [logPage, setLogPage] = useState(1);

  const filtered = useMemo(() => stock
    .filter((it) => cat === 'all' || it.category === cat)
    .filter((it) => !q || it.name.toLowerCase().includes(q.toLowerCase())),
  [stock, cat, q]);

  // Movement-log pagination (the log can hold dozens of rows).
  const logPages = Math.max(1, Math.ceil(stockLog.length / LOG_PAGE_SIZE));
  const logCur = Math.min(logPage, logPages);
  const logRows = stockLog.slice((logCur - 1) * LOG_PAGE_SIZE, logCur * LOG_PAGE_SIZE);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Inventory')}</div>
          <div className="page-sub">{t('{n} items tracked · full audit trail on every movement', { n: stock.length })}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn primary" onClick={() => setEditing('new')}><Icons.plus width="15" height="15" /> {t('New item')}</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'inventory' ? 'on' : ''}`} onClick={() => setTab('inventory')}>{t('Items')}</button>
        <button className={`tab ${tab === 'log' ? 'on' : ''}`} onClick={() => setTab('log')}>{t('Movement log')}</button>
        <button className={`tab ${tab === 'consumed' ? 'on' : ''}`} onClick={() => setTab('consumed')}>{t('Most consumed')}</button>
      </div>

      {tab === 'inventory' && (
        <>
          <div className="toolbar">
            <input type="search" placeholder={t('Search items…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search stock')} />
            <div className="chip-row">
              <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>{t('All')}</button>
              {STOCK_CATEGORIES.map((c) => (
                <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{t(c)}</button>
              ))}
            </div>
          </div>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="table">
              <thead>
                <tr><th>{t('Item')}</th><th>{t('Category')}</th><th>{t('Qty')}</th><th>{t('Min')}</th><th>{t('Buy')}</th><th>{t('Sell')}</th><th>{t('Value')}</th><th>{t('Supplier')}</th><th>{t('Restocked')}</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((it) => {
                  const isLow = it.qty < it.min;
                  return (
                    <tr key={it.id} onClick={() => setEditing(it)}>
                      <td style={{ fontWeight: 600 }}>
                        {it.name}{' '}
                        {isLow && <span className="badge red">{t('Low')}</span>}{' '}
                        {expiringSoon(it) && <span className="badge amber">{t('Expiring')}</span>}{' '}
                        {isExpired(it) && <span className="badge red">{t('Expired')}</span>}
                      </td>
                      <td><span className="badge neutral">{t(it.category)}</span></td>
                      <td className="mono num" style={{ color: isLow ? 'var(--red)' : 'var(--text)', fontWeight: 700 }}>{fmtStockQty(it)}</td>
                      <td className="mono num" style={{ color: 'var(--muted)' }}>{isWeightItem(it) ? fmtWeight(it.min) : it.min}</td>
                      <td className="mono num">{isWeightItem(it) ? t('{price}/kg', { price: dzd(buyPerKg(it)) }) : dzd(it.buy)}</td>
                      <td className="mono num">{isWeightItem(it) ? t('by scoop') : (it.sell ? dzd(it.sell) : '—')}</td>
                      <td className="mono num">{dzd(Math.round(it.qty * it.buy))}</td>
                      <td style={{ color: 'var(--muted)' }}>{it.supplier}</td>
                      <td className="mono">{fmtDate(it.lastRestock)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn sm" onClick={() => setOp({ item: it, action: 'add' })}>{t('+ Restock')}</button>{' '}
                        <button className="btn sm ghost" onClick={() => setOp({ item: it, action: 'remove' })}>{t('− Remove')}</button>{' '}
                        <button className="btn sm danger" onClick={() => setConfirmDelete(it)}>{t('Delete')}</button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="10"><div className="empty-state">{t('No items in this view. Add an item or switch category.')}</div></td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {tab === 'log' && (
        <div className="panel">
          {isAdmin && stockLog.length > 0 && (
            <div className="panel-head">
              <div className="panel-title">{t('Movement log')}</div>
              <button className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirmClearLog(true)}>
                <Icons.trash width="14" height="14" /> {t('Clear log')}
              </button>
            </div>
          )}
          <table className="table">
            <thead><tr><th>{t('Date')}</th><th>{t('Item')}</th><th>{t('Action')}</th><th>{t('Qty')}</th><th>{t('Reason')}</th><th>{t('Cost')}</th></tr></thead>
            <tbody>
              {logRows.map((l) => {
                const it = stock.find((x) => x.id === l.itemId);
                return (
                  <tr key={l.id} style={{ cursor: 'default' }}>
                    <td className="mono">{fmtDate(l.date)}</td>
                    <td style={{ fontWeight: 600 }}>{it ? it.name : t('Item #{id}', { id: l.itemId })}</td>
                    <td>{l.action === 'add' ? <span className="badge green">{t('+ Added')}</span> : <span className="badge red">{t('− Removed')}</span>}</td>
                    <td className="mono num">{isWeightItem(it) ? fmtWeight(l.qty) : l.qty}</td>
                    <td style={{ color: 'var(--muted)' }}>{t(l.reason)}</td>
                    <td className="mono num">{l.cost ? dzd(l.cost) : '—'}</td>
                  </tr>
                );
              })}
              {stockLog.length === 0 && (
                <tr><td colSpan="6"><div className="empty-state">{t('No movements recorded yet.')}</div></td></tr>
              )}
            </tbody>
          </table>
          {logPages > 1 && (
            <div className="pager" style={{ padding: '12px 14px' }}>
              <button className="pager-btn" disabled={logCur === 1}
                onClick={() => setLogPage(logCur - 1)} aria-label={t('Previous page')}>‹ {t('Prev')}</button>
              {pageList(logCur, logPages).map((p, idx) => (p === '…'
                ? <span key={`gap-${idx}`} className="pager-gap">…</span>
                : <button key={p} className={`pager-btn ${p === logCur ? 'on' : ''}`}
                    aria-current={p === logCur ? 'page' : undefined} onClick={() => setLogPage(p)}>{p}</button>
              ))}
              <button className="pager-btn" disabled={logCur === logPages}
                onClick={() => setLogPage(logCur + 1)} aria-label={t('Next page')}>{t('Next')} ›</button>
            </div>
          )}
        </div>
      )}

      {tab === 'consumed' && (
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Most consumed — last 30 days')}</div></div>
          <div className="panel-body">
            {consumed.map((c, i) => (
              <div key={c.name} className="leader-row">
                <span className={`leader-rank ${i === 0 ? 'top' : ''}`}>{i + 1}</span>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <div className="progress" style={{ width: 180, marginLeft: 'auto' }}>
                  <div style={{ width: `${(c.qty / (consumed[0]?.qty || 1)) * 100}%`, background: 'var(--accent)' }} />
                </div>
                <span className="mono num" style={{ fontFamily: 'var(--mono)', width: 70, textAlign: 'right' }}>{c.unit === 'g' ? fmtWeight(c.qty) : t('{n} units', { n: c.qty })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <StockForm item={editing === 'new' ? null : editing} stock={stock}
          onClose={() => setEditing(null)}
          onSave={(it) => { saveStockItem(it); setEditing(null); }} />
      )}
      {op && (
        <OpForm op={op} onClose={() => setOp(null)}
          onSave={(qty, reason, cost) => { stockOperation(op.item.id, op.action, qty, reason, cost); setOp(null); }} />
      )}
      {confirmDelete && (
        <Portal>
        <div className="modal-center" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{t('Delete item')}</div></div>
            <div className="modal-body">{t('Remove')} <strong>{confirmDelete.name}</strong> {t('from inventory? Its movement history stays in the log.')}</div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>{t('Keep item')}</button>
              <button className="btn danger" onClick={() => { deleteStockItem(confirmDelete.id); setConfirmDelete(null); }}>{t('Delete item')}</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
      {confirmClearLog && (
        <Portal>
        <div className="modal-center" onClick={() => setConfirmClearLog(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{t('Clear movement log')}</div></div>
            <div className="modal-body">{t('Permanently delete all recorded stock movements? Item quantities are not affected. This cannot be undone.')}</div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmClearLog(false)}>{t('Cancel')}</button>
              <button className="btn danger" onClick={() => { clearStockLog(); setConfirmClearLog(false); }}>{t('Clear log')}</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}

function StockForm({ item, stock, onClose, onSave }) {
  const t = useT();
  const [f, setF] = useState(item ? { ...item } : {
    name: '', category: 'Equipment', qty: 0, min: 1, buy: 0, sell: '', supplier: '', expiry: '',
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // ── Sell-by-weight mode ──
  // The server tracks weight items in grams and prices buy per gram. The form is
  // friendlier: you buy whole containers, so initial stock is a container count
  // (grams = containers × container size) and cost is per container (→ per-gram
  // buy = cost ÷ container grams). Scoops are {g, price}. Once a weight item
  // exists its grams are managed via Restock/Sell, so the field is read-only on
  // edit (a partially-sold tub isn't a whole number of containers).
  const isExistingWeight = item?.unit === 'g';
  const [weight, setWeight] = useState(isWeightItem(item));
  const [w, setW] = useState(() => ({
    qtyContainers: '',
    minKg: item?.unit === 'g' ? item.min / 1000 : 1,
    containerKg: item?.containerSize ? item.containerSize / 1000 : '',
    costPerContainer: item?.unit === 'g' && item.containerSize ? Math.round(item.buy * item.containerSize) : '',
    portions: item?.unit === 'g' && item.portions?.length ? item.portions.map((p) => ({ ...p })) : [{ g: 100, price: '' }],
  }));
  const setWv = (k, v) => setW((x) => ({ ...x, [k]: v }));
  const setPortion = (i, k, v) => setW((x) => ({ ...x, portions: x.portions.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));
  const addPortion = () => setW((x) => ({ ...x, portions: [...x.portions, { g: '', price: '' }] }));
  const removePortion = (i) => setW((x) => ({ ...x, portions: x.portions.filter((_, j) => j !== i) }));

  const containerGrams = Math.round(Number(w.containerKg) * 1000) || 0;
  // Weight items need a container size so buy-per-gram can be derived.
  const invalid = !f.name.trim() || (weight && !(containerGrams > 0));

  const submit = () => {
    if (invalid) return;
    const id = item?.id ?? Math.max(0, ...stock.map((s) => s.id)) + 1;
    const lastRestock = item?.lastRestock ?? new Date().toISOString().slice(0, 10);
    if (weight) {
      const costPer = Number(w.costPerContainer) || 0;
      const portions = w.portions
        .map((p) => ({ g: Math.round(Number(p.g)), price: Math.round(Number(p.price)) }))
        .filter((p) => p.g > 0 && p.price >= 0);
      onSave({
        id, lastRestock,
        name: f.name, category: f.category, supplier: f.supplier, expiry: f.expiry || null,
        unit: 'g',
        // Existing weight item: keep its exact grams (managed via Restock/Sell).
        // New / converted item: derive grams from the container count entered.
        qty: isExistingWeight ? item.qty : (Math.round(Number(w.qtyContainers) * containerGrams) || 0),
        min: Math.round(Number(w.minKg) * 1000) || 0,
        buy: containerGrams > 0 ? costPer / containerGrams : 0,   // DZD per gram
        sell: null,
        containerSize: containerGrams,
        portions,
      });
    } else {
      onSave({
        ...f, id, lastRestock,
        unit: 'unit', containerSize: null, portions: [],
        qty: Number(f.qty), min: Number(f.min), buy: Number(f.buy),
        sell: f.sell === '' || f.sell == null ? null : Number(f.sell),
        expiry: f.expiry || null,
      });
    }
  };

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Stock item form')}>
        <div className="modal-head">
          <div className="modal-title">{item ? t('Edit — {name}', { name: item.name }) : t('New stock item')}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field full"><label>{t('Item name')}</label>
              <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Whey protein 2 kg')} /></div>
            <div className="field"><label>{t('Category')}</label>
              <Select value={f.category} onChange={(v) => { set('category', v); if (v !== 'Supplements') setWeight(false); }} ariaLabel={t('Category')}
                options={STOCK_CATEGORIES.map((c) => [c, t(c)])} /></div>
            <div className="field"><label>{t('Supplier')}</label>
              <input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder={t('Supplier name')} /></div>

            {/* Sell-by-weight (scoops) is a supplements-only concept. */}
            {f.category === 'Supplements' && (
              <div className="field full">
                <div className="check-row">
                  <input id="sellByWeight" type="checkbox" checked={weight} onChange={(e) => setWeight(e.target.checked)} />
                  <label htmlFor="sellByWeight" style={{ margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 13.5, fontWeight: 500 }}>
                    {t('Sold by weight (scoops) — e.g. whey priced per 100 g / 200 g')}
                  </label>
                </div>
              </div>
            )}

            {!weight ? (
              <>
                <div className="field"><label>{t('Quantity in stock')}</label>
                  <input type="number" min="0" value={f.qty} onChange={(e) => set('qty', e.target.value)} /></div>
                <div className="field"><label>{t('Minimum threshold')}</label>
                  <input type="number" min="0" value={f.min} onChange={(e) => set('min', e.target.value)} /></div>
                <div className="field"><label>{t('Purchase cost (DZD)')}</label>
                  <input type="number" min="0" value={f.buy} onChange={(e) => set('buy', e.target.value)} /></div>
                <div className="field"><label>{t('Selling price (DZD)')}</label>
                  <input type="number" min="0" value={f.sell ?? ''} onChange={(e) => set('sell', e.target.value)} placeholder={t('Leave empty if not sold')} /></div>
              </>
            ) : (
              <>
                <div className="field"><label>{t('Container size (kg)')}</label>
                  <input type="number" min="0" step="0.1" value={w.containerKg} onChange={(e) => setWv('containerKg', e.target.value)} placeholder={t('e.g. 4')} /></div>
                <div className="field"><label>{t('Cost per container (DZD)')}</label>
                  <input type="number" min="0" value={w.costPerContainer} onChange={(e) => setWv('costPerContainer', e.target.value)} placeholder={t('What you pay for one')} /></div>
                {isExistingWeight ? (
                  <div className="field"><label>{t('Quantity in stock')}</label>
                    <input disabled value={`${fmtWeight(item.qty)} · ${t('adjust via Restock / Sell')}`} /></div>
                ) : (
                  <div className="field"><label>{t('Quantity in stock (containers)')}</label>
                    <input type="number" min="0" step="1" value={w.qtyContainers} onChange={(e) => setWv('qtyContainers', e.target.value)} placeholder={t('e.g. 4')} /></div>
                )}
                <div className="field"><label>{t('Minimum threshold (kg)')}</label>
                  <input type="number" min="0" step="0.1" value={w.minKg} onChange={(e) => setWv('minKg', e.target.value)} /></div>
              </>
            )}

            <div className="field"><label>{t('Expiry date')}</label>
              <DatePicker value={f.expiry || ''} onChange={(v) => set('expiry', v)} ariaLabel={t('Expiry date')} placeholder="Expiry date" /></div>

            {weight && (
              <div className="field full">
                <label>{t('Scoop prices')}</label>
                <div className="scoop-editor">
                  {w.portions.map((p, i) => (
                    <div key={i} className="scoop-row">
                      <input type="number" min="0" value={p.g} onChange={(e) => setPortion(i, 'g', e.target.value)}
                        placeholder={t('grams')} aria-label={t('Scoop size in grams')} />
                      <span className="scoop-x">g →</span>
                      <input type="number" min="0" value={p.price} onChange={(e) => setPortion(i, 'price', e.target.value)}
                        placeholder={t('price')} aria-label={t('Scoop price in DZD')} />
                      <span className="scoop-x">DZD</span>
                      <button type="button" className="icon-btn danger" aria-label={t('Remove')} onClick={() => removePortion(i)}>
                        <Icons.trash width="15" height="15" />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn sm ghost" onClick={addPortion} style={{ marginTop: 6 }}>
                    <Icons.plus width="14" height="14" /> {t('Add scoop')}
                  </button>
                  <div className="scoop-hint">{t('A custom amount is always available when selling, even with no preset scoops.')}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={invalid}>{item ? t('Save changes') : t('Add item')}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// Weight items (sold by the gram) get a portion-aware form; everything else
// keeps the original whole-unit quantity form.
function OpForm({ op, onClose, onSave }) {
  return isWeightItem(op.item)
    ? <WeightOpForm op={op} onClose={onClose} onSave={onSave} />
    : <UnitOpForm op={op} onClose={onClose} onSave={onSave} />;
}

function UnitOpForm({ op, onClose, onSave }) {
  const t = useT();
  const adding = op.action === 'add';
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState(adding ? 'Restock' : 'Sold');
  const [cost, setCost] = useState(adding ? op.item.buy : '');
  // Sale price per unit — pre-filled from the item's selling price, editable per sale.
  const [salePrice, setSalePrice] = useState(op.item.sell != null ? op.item.sell : '');
  const selling = !adding && reason === 'Sold';

  // cost column stores: restock → total buy cost; sale → total revenue; else null.
  const logCost = adding
    ? Number(cost) * qty
    : (selling && salePrice !== '' ? Number(salePrice) * qty : null);

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Stock operation')}>
        <div className="modal-head">
          <div className="modal-title">{t(adding ? 'Restock — {name}' : 'Remove — {name}', { name: op.item.name })}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>{t('Quantity')}</label>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
            {adding ? (
              <div className="field"><label>{t('Cost per unit (DZD)')}</label>
                <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            ) : (
              <div className="field"><label>{t('Reason')}</label>
                <Select value={reason} onChange={setReason} ariaLabel={t('Reason')}
                  options={[['Sold', t('Sold')], ['Damaged', t('Damaged')], ['Expired', t('Expired')], ['Used internally', t('Used internally')]]} /></div>
            )}
            {selling && (
              <div className="field"><label>{t('Sale price per unit (DZD)')}</label>
                <input type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={t('Selling price')} /></div>
            )}
            {selling && salePrice !== '' && (
              <div className="field"><label>{t('Total')}</label>
                <input disabled value={dzd(Number(salePrice) * qty)} /></div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={() => onSave(qty, reason, logCost)}>
            {adding ? t('Add {qty} to stock', { qty }) : t('Remove {qty} from stock', { qty })}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// Sell-by-weight operations. Restock adds whole containers (× container size);
// a sale subtracts a preset scoop, a custom gram amount, or the whole/remaining
// quantity, logging the exact revenue. Write-offs subtract a gram amount.
// All quantities passed to onSave are in grams (matching the item's qty unit).
function WeightOpForm({ op, onClose, onSave }) {
  const t = useT();
  const adding = op.action === 'add';
  const item = op.item;
  const available = item.qty;                                   // grams in stock
  const containerKg = item.containerSize ? item.containerSize / 1000 : 0;
  const perContainerCost = item.containerSize ? Math.round(item.buy * item.containerSize) : 0;
  const portions = item.portions || [];

  // Restock
  const [containers, setContainers] = useState(1);
  const [cost, setCost] = useState(perContainerCost || '');
  // Remove / sell
  const [reason, setReason] = useState('Sold');
  const [sel, setSel] = useState(portions.length ? 0 : 'custom');   // portion index or 'custom'
  const [customG, setCustomG] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [writeoffG, setWriteoffG] = useState('');                   // grams for non-sale removals

  const selling = !adding && reason === 'Sold';

  // Resolve the operation into grams out / reason / logged cost.
  const restockGrams = Math.round(Number(containers) * (item.containerSize || 0)) || 0;
  let outGrams = 0; let outReason = reason; let outCost = null; let summary = '';
  if (adding) {
    outGrams = restockGrams; outReason = 'Restock';
    outCost = Math.round(Number(containers) * (Number(cost) || 0)) || null;
    summary = restockGrams > 0 ? t('Adds {w} · {cost}', { w: fmtWeight(restockGrams), cost: dzd(outCost || 0) }) : '';
  } else if (selling) {
    const g = sel === 'custom' ? Math.round(Number(customG)) || 0 : (portions[sel]?.g || 0);
    const price = sel === 'custom' ? Math.round(Number(customPrice)) || 0 : (portions[sel]?.price || 0);
    outGrams = g; outReason = 'Sold'; outCost = price;
    summary = g > 0 ? t('Sell {w} · {cost}', { w: fmtWeight(g), cost: dzd(price) }) : '';
  } else {
    outGrams = Math.round(Number(writeoffG)) || 0; outReason = reason; outCost = null;
    summary = outGrams > 0 ? t('Remove {w}', { w: fmtWeight(outGrams) }) : '';
  }
  const over = !adding && outGrams > available;
  const canSave = adding ? restockGrams > 0 : outGrams > 0;

  return (
    <Portal>
    <div className="modal-center" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Stock operation')}>
        <div className="modal-head">
          <div className="modal-title">{t(adding ? 'Restock — {name}' : 'Sell / remove — {name}', { name: item.name })}</div>
          <button className="x-btn" onClick={onClose} aria-label={t('Close')}>×</button>
        </div>
        <div className="modal-body">
          <div className="weight-op-meta">
            {t('In stock: {w}', { w: fmtWeight(available) })}
            {item.containerSize ? ` · ${t('container {kg} kg', { kg: Number(containerKg) })}` : ''}
          </div>
          <div className="form-grid">
            {adding ? (
              <>
                <div className="field"><label>{t('Containers ({kg} kg each)', { kg: Number(containerKg) })}</label>
                  <input type="number" min="1" value={containers} onChange={(e) => setContainers(e.target.value)} /></div>
                <div className="field"><label>{t('Cost per container (DZD)')}</label>
                  <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
              </>
            ) : (
              <div className="field full"><label>{t('Reason')}</label>
                <Select value={reason} onChange={setReason} ariaLabel={t('Reason')}
                  options={[['Sold', t('Sold')], ['Damaged', t('Damaged')], ['Expired', t('Expired')], ['Used internally', t('Used internally')]]} /></div>
            )}

            {selling && (
              <div className="field full">
                <label>{t('Scoop')}</label>
                <div className="chip-row" style={{ flexWrap: 'wrap' }}>
                  {portions.map((p, i) => (
                    <button key={i} type="button" className={`chip ${sel === i ? 'on' : ''}`} onClick={() => setSel(i)}>
                      {fmtWeight(p.g)} · {dzd(p.price)}
                    </button>
                  ))}
                  <button type="button" className={`chip ${sel === 'custom' ? 'on' : ''}`} onClick={() => setSel('custom')}>{t('Custom')}</button>
                </div>
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {item.containerSize ? (
                    <button type="button" className="btn sm ghost" onClick={() => { setSel('custom'); setCustomG(String(item.containerSize)); }}>
                      {t('Whole container ({kg} kg)', { kg: Number(containerKg) })}
                    </button>
                  ) : null}
                  <button type="button" className="btn sm ghost" onClick={() => { setSel('custom'); setCustomG(String(available)); }}>
                    {t('All remaining ({w})', { w: fmtWeight(available) })}
                  </button>
                </div>
              </div>
            )}

            {selling && sel === 'custom' && (
              <>
                <div className="field"><label>{t('Amount (g)')}</label>
                  <input type="number" min="0" value={customG} onChange={(e) => setCustomG(e.target.value)} placeholder={t('e.g. 250')} /></div>
                <div className="field"><label>{t('Price (DZD)')}</label>
                  <input type="number" min="0" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder={t('Sale price')} /></div>
              </>
            )}

            {!adding && !selling && (
              <div className="field"><label>{t('Amount to remove (g)')}</label>
                <input type="number" min="0" value={writeoffG} onChange={(e) => setWriteoffG(e.target.value)} placeholder={t('e.g. 500')} /></div>
            )}
          </div>

          {summary && (
            <div className={`weight-op-summary${over ? ' over' : ''}`}>
              {summary}{over && ` · ${t('more than in stock — will clamp to 0')}`}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" disabled={!canSave} onClick={() => onSave(outGrams, outReason, outCost)}>
            {adding ? t('Add to stock') : (selling ? t('Confirm sale') : t('Remove'))}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
