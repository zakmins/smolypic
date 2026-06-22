import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Avatar, ResultBadge, Icons } from '../components/atoms.jsx';
import Select from '../components/Select.jsx';
import DatePicker from '../components/DatePicker.jsx';
import { WEIGHT_CATS, age, fmtDate } from '../utils.js';
import { BarChart } from '../charts/Charts.jsx';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RESULTS = [['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['loss', 'Loss']];
const STYLES = ['Freestyle', 'Greco-Roman'];

export default function Wrestling() {
  const t = useT();
  const { members, showToast } = useContext(AppCtx);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);

  const [form, setForm] = useState(null);       // { category, style, weightKg, heightCm }
  const [comp, setComp] = useState({ date: '', event: '', result: 'gold' });
  const [editSched, setEditSched] = useState(false);
  const [schedDraft, setSchedDraft] = useState([]);

  useEffect(() => {
    api('/wrestling').then(setData).catch((e) => showToast('Wrestling data failed: {message}', { message: e.message }));
  }, [showToast]);

  const students = data?.students ?? [];
  const schedule = data?.schedule ?? [];

  const roster = useMemo(() =>
    students.map((s) => ({ ...s, member: members.find((m) => m.id === s.memberId) })).filter((s) => s.member),
  [students, members]);

  const catDist = WEIGHT_CATS.map((c, i) => ({
    label: c.replace('weight', '').replace('Super Heavy', 'S.Hvy').slice(0, 6), value: roster.filter((s) => s.category === i).length,
  }));

  const selected = sel != null ? roster.find((s) => s.memberId === sel) : null;

  const openStudent = (s) => {
    setSel(s.memberId);
    setForm({
      category: s.category, style: s.style || 'Freestyle',
      weightKg: s.weightKg ?? '', heightCm: s.heightCm ?? '',
    });
    setComp({ date: '', event: '', result: 'gold' });
  };
  const closeStudent = () => { setSel(null); setForm(null); };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveStudent = async () => {
    try {
      setData(await api(`/wrestling/students/${sel}`, { method: 'PUT', body: form }));
      showToast('Wrestling record saved');
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };
  const addComp = async () => {
    if (!comp.event.trim()) return;
    try {
      setData(await api(`/wrestling/students/${sel}/competitions`, { method: 'POST', body: comp }));
      setComp({ date: '', event: '', result: 'gold' });
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };
  const delComp = async (cid) => {
    try { setData(await api(`/wrestling/competitions/${cid}`, { method: 'DELETE' })); }
    catch (e) { showToast('Delete failed: {msg}', { msg: e.message }); }
  };

  // ── Schedule editing ──
  const startEditSched = () => { setSchedDraft(schedule.map((s) => ({ ...s }))); setEditSched(true); };
  const setSchedRow = (i, k, v) => setSchedDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addSchedRow = () => setSchedDraft((d) => [...d, { day: 'Monday', time: '', group: '' }]);
  const removeSchedRow = (i) => setSchedDraft((d) => d.filter((_, idx) => idx !== i));
  const saveSched = async () => {
    try {
      setData(await api('/wrestling/schedule', { method: 'PUT', body: { schedule: schedDraft } }));
      setEditSched(false);
      showToast('Schedule updated');
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Wrestling')}</div>
          <div className="page-sub">{roster.length === 1 ? t('{n} wrestler · freestyle & Greco-Roman', { n: roster.length }) : t('{n} wrestlers · freestyle & Greco-Roman', { n: roster.length })}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Weight category distribution')}</div></div>
          <div className="panel-body"><BarChart data={catDist} height={190} color="var(--wrestling)" /></div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{t('Weekly schedule')}</div>
            {!editSched ? (
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={startEditSched}>{t('Edit')}</button>
            ) : (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn sm ghost" onClick={() => setEditSched(false)}>{t('Cancel')}</button>
                <button className="btn sm primary" onClick={saveSched}>{t('Save')}</button>
              </div>
            )}
          </div>
          <div className="panel-body">
            {!editSched ? (
              schedule.length === 0
                ? <div className="empty-state" style={{ padding: '12px 0' }}>{t('No sessions scheduled.')}</div>
                : schedule.map((s, i) => (
                  <div key={`${s.day}-${s.time}-${i}`} className="leader-row">
                    <strong style={{ width: 100 }}>{t(s.day)}</strong>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{s.time}</span>
                    <span className="badge wrestling" style={{ marginLeft: 'auto' }}>{t(s.group)}</span>
                  </div>
                ))
            ) : (
              <>
                {schedDraft.map((s, i) => (
                  <div key={i} className="sched-edit-row">
                    <Select value={s.day} onChange={(v) => setSchedRow(i, 'day', v)} ariaLabel={t('Day')}
                      options={WEEKDAYS.map((d) => [d, t(d)])} />
                    <input value={s.time} onChange={(e) => setSchedRow(i, 'time', e.target.value)} placeholder="18:00–19:30" />
                    <input value={s.group} onChange={(e) => setSchedRow(i, 'group', e.target.value)} placeholder={t('Group')} />
                    <button className="icon-btn danger" aria-label={t('Remove')} onClick={() => removeSchedRow(i)}><Icons.trash width="15" height="15" /></button>
                  </div>
                ))}
                <button className="btn sm" style={{ marginTop: 4 }} onClick={addSchedRow}><Icons.plus width="14" height="14" /> {t('Add slot')}</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div className="panel-title">{t('Wrestlers')}</div><div className="panel-sub">{t('click a row for physical stats & record')}</div></div>
        <table className="table">
          <thead>
            <tr><th></th><th>{t('Wrestler')}</th><th>{t('Category')}</th><th>{t('Style')}</th><th>{t('Weight')}</th><th>{t('Height')}</th><th>{t('Age')}</th><th>{t('Attendance')}</th><th>{t('Comps')}</th></tr>
          </thead>
          <tbody>
            {roster.map((s) => (
              <tr key={s.memberId} onClick={() => openStudent(s)}>
                <td style={{ width: 50 }}><Avatar member={s.member} /></td>
                <td style={{ fontWeight: 600 }}>{s.member.name}</td>
                <td><span className="badge wrestling">{WEIGHT_CATS[s.category]}</span></td>
                <td>{t(s.style)}</td>
                <td className="mono num">{s.weightKg != null ? `${s.weightKg} kg` : '—'}</td>
                <td className="mono num">{s.heightCm != null ? `${s.heightCm} cm` : '—'}</td>
                <td className="num">{age(s.member.dob)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="progress" style={{ width: 70 }}>
                      <div className={s.attendanceRate < 65 ? 'low' : s.attendanceRate < 80 ? 'mid' : ''} style={{ width: `${s.attendanceRate}%` }} />
                    </div>
                    <span className="num" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.attendanceRate}%</span>
                  </div>
                </td>
                <td className="num">{s.competitions.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && form && (
        <div className="overlay" onClick={closeStudent}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Wrestler record')}>
            <div className="modal-head">
              <div className="modal-title">{t('Wrestler record')}</div>
              <button className="x-btn" onClick={closeStudent} aria-label={t('Close')}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
                <Avatar member={selected.member} size="lg" />
                <div>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 20 }}>{selected.member.name}</div>
                  <div className="live-meta" style={{ marginTop: 8 }}>
                    <span className="badge wrestling">{WEIGHT_CATS[form.category]}</span>
                    <span className="badge neutral">{t(form.style)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{age(selected.member.dob)} {t('yrs')}</span>
                  </div>
                </div>
              </div>

              <div className="form-grid">
                <div className="field"><label>{t('Category')}</label>
                  <Select value={form.category} onChange={(v) => setField('category', Number(v))} ariaLabel={t('Category')}
                    options={WEIGHT_CATS.map((c, i) => [i, c])} /></div>
                <div className="field"><label>{t('Style')}</label>
                  <Select value={form.style} onChange={(v) => setField('style', v)} ariaLabel={t('Style')}
                    options={STYLES.map((s) => [s, t(s)])} /></div>
                <div className="field"><label>{t('Weight (kg)')}</label>
                  <input type="number" min="0" value={form.weightKg} onChange={(e) => setField('weightKg', e.target.value)} /></div>
                <div className="field"><label>{t('Height (cm)')}</label>
                  <input type="number" min="0" value={form.heightCm} onChange={(e) => setField('heightCm', e.target.value)} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn primary" onClick={saveStudent}>{t('Save changes')}</button>
              </div>

              <div className="panel-title" style={{ margin: '22px 0 10px' }}>{t('Competition history')}</div>
              {selected.competitions.length === 0 ? (
                <div className="empty-state" style={{ padding: '12px 0' }}>{t('No competitions yet — first entry goes here.')}</div>
              ) : selected.competitions.map((c) => (
                <div key={c.id} className="leader-row">
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{fmtDate(c.date)}</span>
                  <span style={{ fontWeight: 600 }}>{c.event}</span>
                  <span style={{ marginLeft: 'auto' }}><ResultBadge result={c.result} /></span>
                  <button className="icon-btn danger" aria-label={t('Remove')} style={{ marginLeft: 4 }} onClick={() => delComp(c.id)}><Icons.trash width="15" height="15" /></button>
                </div>
              ))}

              <div className="comp-add">
                <DatePicker value={comp.date} onChange={(v) => setComp((c) => ({ ...c, date: v }))} ariaLabel={t('Date')} placeholder="Date" />
                <input value={comp.event} onChange={(e) => setComp((c) => ({ ...c, event: e.target.value }))} placeholder={t('Competition name')} />
                <Select value={comp.result} onChange={(v) => setComp((c) => ({ ...c, result: v }))} ariaLabel={t('Result')}
                  options={RESULTS.map(([v, l]) => [v, t(l)])} />
                <button className="btn sm primary" onClick={addComp} disabled={!comp.event.trim()}><Icons.plus width="14" height="14" /> {t('Add')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
