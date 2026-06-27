import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { Avatar, BeltStrip, ResultBadge, Icons } from '../components/atoms.jsx';
import Select from '../components/Select.jsx';
import DatePicker from '../components/DatePicker.jsx';
import { BELTS, BELT_COLOR, age, fmtDate } from '../utils.js';
import { BarChart } from '../charts/Charts.jsx';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import Portal from '../components/Portal.jsx';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RESULTS = [['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze'], ['loss', 'Loss']];

export default function Judo() {
  const t = useT();
  const { members, showToast } = useContext(AppCtx);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Selected-student editor + new-competition draft.
  const [form, setForm] = useState(null);       // { belt, weightCat, notes }
  const [comp, setComp] = useState({ date: '', event: '', result: 'gold' });
  // Weekly-schedule editor.
  const [editSched, setEditSched] = useState(false);
  const [schedDraft, setSchedDraft] = useState([]);

  const load = useCallback(() => {
    setError(null);
    api('/judo').then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const students = data?.students ?? [];
  const schedule = data?.schedule ?? [];

  const roster = useMemo(() =>
    students.map((s) => ({ ...s, member: members.find((m) => m.id === s.memberId) })).filter((s) => s.member),
  [students, members]);

  const beltDist = BELTS.slice(0, 7).map((b, i) => ({
    label: t(b.split(' ')[0]), value: roster.filter((s) => s.belt === i).length, color: BELT_COLOR[i] === '#E8E6E0' ? '#C9CDD6' : BELT_COLOR[i],
  }));

  const selected = sel != null ? roster.find((s) => s.memberId === sel) : null;

  const openStudent = (s) => {
    setSel(s.memberId);
    setForm({ belt: s.belt, weightCat: s.weightCat || '', notes: s.notes || '' });
    setComp({ date: '', event: '', result: 'gold' });
  };
  const closeStudent = () => { setSel(null); setForm(null); };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveStudent = async () => {
    try {
      setData(await api(`/judo/students/${sel}`, { method: 'PUT', body: form }));
      showToast('Judo record saved');
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };
  const addComp = async () => {
    if (!comp.event.trim()) return;
    try {
      setData(await api(`/judo/students/${sel}/competitions`, { method: 'POST', body: comp }));
      setComp({ date: '', event: '', result: 'gold' });
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };
  const delComp = async (cid) => {
    try { setData(await api(`/judo/competitions/${cid}`, { method: 'DELETE' })); }
    catch (e) { showToast('Delete failed: {msg}', { msg: e.message }); }
  };

  // ── Schedule editing ──
  const startEditSched = () => { setSchedDraft(schedule.map((s) => ({ ...s }))); setEditSched(true); };
  const setSchedRow = (i, k, v) => setSchedDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addSchedRow = () => setSchedDraft((d) => [...d, { day: 'Monday', time: '', group: '' }]);
  const removeSchedRow = (i) => setSchedDraft((d) => d.filter((_, idx) => idx !== i));
  const saveSched = async () => {
    try {
      setData(await api('/judo/schedule', { method: 'PUT', body: { schedule: schedDraft } }));
      setEditSched(false);
      showToast('Schedule updated');
    } catch (e) { showToast('Save failed: {msg}', { msg: e.message }); }
  };

  if (error && !data) {
    return (
      <>
        <div className="page-head">
          <div><div className="page-title">{t('Judo')}</div></div>
        </div>
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--red)', marginBottom: 12 }}>
            {t('Couldn\'t load data — {msg}', { msg: error })}
          </div>
          <button className="btn primary" onClick={load}>{t('Retry')}</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('Judo')}</div>
          <div className="page-sub">{t('{count} students on the tatami · 5 sessions a week', { count: roster.length })}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <div className="panel-head"><div className="panel-title">{t('Belt distribution')}</div></div>
          <div className="panel-body"><BarChart data={beltDist} height={190} /></div>
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
                    <span className="mono" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{s.time}</span>
                    <span className="badge judo" style={{ marginLeft: 'auto' }}>{t(s.group)}</span>
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
        <div className="panel-head"><div className="panel-title">{t('Students')}</div><div className="panel-sub">{t('click a row for record & notes')}</div></div>
        <table className="table">
          <thead>
            <tr><th></th><th>{t('Student')}</th><th>{t('Belt')}</th><th>{t('Rank')}</th><th>{t('Weight cat.')}</th><th>{t('Age')}</th><th>{t('Attendance')}</th><th>{t('Competitions')}</th></tr>
          </thead>
          <tbody>
            {roster.map((s) => (
              <tr key={s.memberId} onClick={() => openStudent(s)}>
                <td style={{ width: 50 }}><Avatar member={s.member} /></td>
                <td style={{ fontWeight: 600 }}>{s.member.name}</td>
                <td><BeltStrip level={s.belt} /></td>
                <td>{t(BELTS[s.belt])}</td>
                <td className="mono">{s.weightCat || '—'}</td>
                <td className="num">{age(s.member.dob)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="progress" style={{ width: 70 }}>
                      <div className={s.attendanceRate < 65 ? 'low' : s.attendanceRate < 80 ? 'mid' : ''} style={{ width: `${s.attendanceRate}%` }} />
                    </div>
                    <span className="mono num" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.attendanceRate}%</span>
                  </div>
                </td>
                <td className="num">{s.competitions.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && form && (
        <Portal>
        <div className="overlay" onClick={closeStudent}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Judo student record')}>
            <div className="modal-head">
              <div className="modal-title">{t('Judo record')}</div>
              <button className="x-btn" onClick={closeStudent} aria-label={t('Close')}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
                <Avatar member={selected.member} size="lg" />
                <div>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 900, fontSize: 20 }}>{selected.member.name}</div>
                  <div style={{ marginTop: 8 }}><BeltStrip level={form.belt} /></div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
                    {t(BELTS[form.belt])} · {age(selected.member.dob)} {t('yrs')}
                  </div>
                </div>
              </div>

              <div className="form-grid">
                <div className="field"><label>{t('Belt rank')}</label>
                  <Select value={form.belt} onChange={(v) => setField('belt', Number(v))} ariaLabel={t('Belt rank')}
                    options={BELTS.map((b, i) => [i, t(b)])} /></div>
                <div className="field"><label>{t('Weight category')}</label>
                  <input value={form.weightCat} onChange={(e) => setField('weightCat', e.target.value)} placeholder={t('e.g. -73 kg')} /></div>
                <div className="field full"><label>{t('Coach notes')}</label>
                  <textarea rows="3" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('Training notes, goals, injuries…')} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn primary" onClick={saveStudent}>{t('Save changes')}</button>
              </div>

              <div className="panel-title" style={{ margin: '22px 0 10px' }}>{t('Competition history')}</div>
              {selected.competitions.length === 0 ? (
                <div className="empty-state" style={{ padding: '12px 0' }}>{t('No competitions yet — first entry goes here.')}</div>
              ) : selected.competitions.map((c) => (
                <div key={c.id} className="leader-row">
                  <span className="mono" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{fmtDate(c.date)}</span>
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
        </Portal>
      )}
    </>
  );
}
