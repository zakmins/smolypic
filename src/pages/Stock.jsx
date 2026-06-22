import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Icons } from '../components/atoms.jsx';
import { STOCK_CATEGORIES, dzd, fmtDate, pageList } from '../utils.js';
import { useT } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Select from '../components/Select.jsx';
import DatePicker from '../components/DatePicker.jsx';

const LOG_PAGE_SIZE = 12;   // movement-log rows per page
const expiringSoon = (it) => it.expiry && (new Date(it.expiry) - Date.now()) / 86400000 <= 30;

// ── Stock › Management: KPIs + recent-sales history ───────────────────────────
export function StockManagement() {
  const t = useT();
  const { stock, stockLog, saveStockItem } = useContext(AppCtx);
  const [kpiModal, setKpiModal] = useState(null);   // 'low' | 'expiring' | 'out' | null
  const [editing, setEditing] = useState(null);     // item opened from a KPI list

  const totalValue = stock.reduce((s, it) => s + it.qty * it.buy, 0);
  const low = stock.filter((it) => it.qty < it.min);
  const expiring = stock.filter(expiringSoon);
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
      const fallback = it && it.sell != null ? it.sell * l.qty : null;
      const total = l.cost != null ? l.cost : fallback;
      return {
        id: l.id,
        name: it ? it.name : `#${l.itemId}`,
        category: it ? it.category : null,
        qty: l.qty,
        unit: total != null ? Math.round(total / l.qty) : null,
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

      <div className="stat-grid">
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
              <span className="sale-qty">×{s.qty}</span>
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
          out: { title: t('Out of stock'), tone: 'red', items: outOfStock },
        };
        const view = views[kpiModal];
        const detailFor = (it) => (kpiModal === 'expiring'
          ? t('expires {date}', { date: fmtDate(it.expiry) })
          : t('{qty} in stock · min {min}', { qty: it.qty, min: it.min }));
        return (
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
                        {expiringSoon(it) && <span className="badge amber">{t('Expiring')}</span>}
                      </td>
                      <td><span className="badge neutral">{t(it.category)}</span></td>
                      <td className="mono num" style={{ color: isLow ? 'var(--red)' : 'var(--text)', fontWeight: 700 }}>{it.qty}</td>
                      <td className="mono num" style={{ color: 'var(--muted)' }}>{it.min}</td>
                      <td className="mono num">{dzd(it.buy)}</td>
                      <td className="mono num">{it.sell ? dzd(it.sell) : '—'}</td>
                      <td className="mono num">{dzd(it.qty * it.buy)}</td>
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
                    <td className="mono num">{l.qty}</td>
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
                <span className="mono num" style={{ fontFamily: 'var(--mono)', width: 70, textAlign: 'right' }}>{t('{n} units', { n: c.qty })}</span>
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
      )}
      {confirmClearLog && (
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
  const submit = () => {
    if (!f.name.trim()) return;
    onSave({
      ...f,
      id: item?.id ?? Math.max(0, ...stock.map((s) => s.id)) + 1,
      qty: Number(f.qty), min: Number(f.min), buy: Number(f.buy),
      sell: f.sell === '' || f.sell == null ? null : Number(f.sell),
      expiry: f.expiry || null,
      lastRestock: item?.lastRestock ?? new Date().toISOString().slice(0, 10),
    });
  };
  return (
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
              <Select value={f.category} onChange={(v) => set('category', v)} ariaLabel={t('Category')}
                options={STOCK_CATEGORIES.map((c) => [c, t(c)])} /></div>
            <div className="field"><label>{t('Supplier')}</label>
              <input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder={t('Supplier name')} /></div>
            <div className="field"><label>{t('Quantity in stock')}</label>
              <input type="number" min="0" value={f.qty} onChange={(e) => set('qty', e.target.value)} /></div>
            <div className="field"><label>{t('Minimum threshold')}</label>
              <input type="number" min="0" value={f.min} onChange={(e) => set('min', e.target.value)} /></div>
            <div className="field"><label>{t('Purchase cost (DZD)')}</label>
              <input type="number" min="0" value={f.buy} onChange={(e) => set('buy', e.target.value)} /></div>
            <div className="field"><label>{t('Selling price (DZD)')}</label>
              <input type="number" min="0" value={f.sell ?? ''} onChange={(e) => set('sell', e.target.value)} placeholder={t('Leave empty if not sold')} /></div>
            <div className="field"><label>{t('Expiry date')}</label>
              <DatePicker value={f.expiry || ''} onChange={(v) => set('expiry', v)} ariaLabel={t('Expiry date')} placeholder="Expiry date" /></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={!f.name.trim()}>{item ? t('Save changes') : t('Add item')}</button>
        </div>
      </div>
    </div>
  );
}

function OpForm({ op, onClose, onSave }) {
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
  );
}
