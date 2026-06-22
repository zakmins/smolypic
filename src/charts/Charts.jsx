// Recharts-powered charts skinned to the Smolympic token system.
// Page-level APIs are unchanged: LineChart, BarChart, Donut, Heatmap.
// Colors arrive as 'var(--token)' strings and are resolved per active theme.
import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  BarChart as RBarChart, Bar, Cell,
  PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useResolveColor } from '../theme.jsx';

const kFmt = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);
const nFmt = (v) => new Intl.NumberFormat('en-US').format(v);

function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null;
  // A richer per-point heading (e.g. full date) wins over the short axis label.
  const heading = payload[0]?.payload?.tip ?? label;
  // Optional per-point breakdown (e.g. categories sold that day).
  const breakdown = payload[0]?.payload?.breakdown;
  return (
    <div className="rc-tooltip">
      {heading != null && <div className="t">{heading}</div>}
      {payload.map((p, i) => (
        <div className="row" key={i}>
          <i style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name != null && p.name !== 'value' ? `${p.name}: ` : ''}{nFmt(p.value)}{suffix}</span>
        </div>
      ))}
      {breakdown?.length > 0 && (
        <div className="rc-tooltip-sub">
          {breakdown.map((b, i) => (
            <div className="row" key={`b${i}`}>
              <i style={{ background: b.color }} />
              <span>{b.label}: {nFmt(b.value)}{suffix}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const axisProps = (resolve) => ({
  stroke: resolve('var(--faint)'),
  tick: { fill: resolve('var(--faint)'), fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
  tickLine: false,
  axisLine: false,
});

export function LineChart({ series, labels, height = 220, interval = 'preserveStartEnd', minTickGap = 26, tips, breakdowns }) {
  const resolve = useResolveColor();
  const data = labels.map((l, i) => {
    const row = { label: l };
    if (tips) row.tip = tips[i];
    if (breakdowns) row.breakdown = breakdowns[i];
    series.forEach((s, si) => { row[s.name || `s${si}`] = s.data[i] ?? null; });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={resolve('var(--line)')} vertical={false} />
        <XAxis dataKey="label" {...axisProps(resolve)} interval={interval} minTickGap={minTickGap} />
        <YAxis {...axisProps(resolve)} tickFormatter={kFmt} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: resolve('var(--line-strong)') }} />
        {series.map((s, si) => {
          const key = s.name || `s${si}`;
          const color = resolve(s.color);
          return s.fill ? (
            <Area key={key} type="monotone" dataKey={key} name={s.name}
              stroke={color} strokeWidth={2.4} fill={color} fillOpacity={0.12}
              dot={false} activeDot={{ r: 4.5, strokeWidth: 0 }} connectNulls
              animationDuration={600} />
          ) : (
            <Line key={key} type="monotone" dataKey={key} name={s.name}
              stroke={color} strokeWidth={s.dashed ? 1.8 : 2.4}
              strokeDasharray={s.dashed ? '5 5' : undefined}
              dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls
              animationDuration={600} />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function BarChart({ data, height = 220, color = 'var(--accent)', suffix = '' }) {
  const resolve = useResolveColor();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -16 }} barCategoryGap="32%">
        <CartesianGrid stroke={resolve('var(--line)')} vertical={false} />
        <XAxis dataKey="label" {...axisProps(resolve)} interval={0} minTickGap={4} />
        <YAxis {...axisProps(resolve)} tickFormatter={(v) => `${kFmt(v)}${suffix}`} width={52} />
        <Tooltip content={<ChartTooltip suffix={suffix} />} cursor={{ fill: resolve('var(--raised)'), opacity: 0.6 }} />
        <Bar dataKey="value" radius={[6, 6, 2, 2]} maxBarSize={36} animationDuration={600}>
          {data.map((d, i) => <Cell key={i} fill={resolve(d.color || color)} fillOpacity={d.value === 0 ? 0.2 : 1} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, size = 196, thickness = 26, centerLabel, centerValue }) {
  const resolve = useResolveColor();
  const outer = (size - 10) / 2; // recharts PieChart has a 5px default margin
  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie data={data} dataKey="value" nameKey="label"
          innerRadius={outer - thickness} outerRadius={outer}
          paddingAngle={2.5} cornerRadius={5} stroke="none" animationDuration={700}>
          {data.map((d, i) => <Cell key={i} fill={resolve(d.color)} />)}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
      <div className="donut-center">
        <div className="v">{centerValue}</div>
        <div className="k">{centerLabel}</div>
      </div>
    </div>
  );
}

export function Heatmap({ grid, hours, days }) {
  const max = Math.max(...grid.flat(), 1);
  const cols = { gridTemplateColumns: `repeat(${hours.length}, 1fr)` };
  return (
    <div className="heatmap">
      {grid.map((row, r) => (
        <div className="heat-row" key={days[r]}>
          <span className="heat-day">{days[r]}</span>
          <div className="heat-cells" style={cols}>
            {row.map((v, c) => (
              <div key={c} className="heat-cell"
                style={{ '--heat': v === 0 ? 3 : 8 + (v / max) * 88 }}
                title={`${days[r]} ${hours[c]} — ${v} entries`} />
            ))}
          </div>
        </div>
      ))}
      <div className="heat-hours">
        <span />
        <div className="labels" style={cols}>
          {hours.map((h, i) => <span key={h}>{i % 2 === 0 ? h : ''}</span>)}
        </div>
      </div>
    </div>
  );
}
