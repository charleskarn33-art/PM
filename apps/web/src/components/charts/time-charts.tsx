'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

export interface Series {
  key: string;
  name: string;
  color: string;
}

const AXIS = { stroke: 'var(--chart-axis)', tick: { fill: 'var(--chart-muted)', fontSize: 12 }, tickLine: false } as const;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' });
};

/** Values lead, series names follow; each row keyed with a short line in the series colour. */
function ChartTooltip({ active, payload, label, unit }: TooltipContentProps<number, string> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-xs text-muted-foreground">{monthLabel(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: p.color }} aria-hidden />
          <strong className="tabular-nums">{p.value == null ? '—' : `${Number(p.value).toLocaleString()}${unit ?? ''}`}</strong>
          <span className="text-muted-foreground">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

/** Monthly columns for one or more count series (legend shown for two or more). */
export function MonthlyColumns({ data, series, height = 240 }: { data: Record<string, string | number | null>[]; series: Series[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`Monthly ${series.map((s) => s.name.toLowerCase()).join(' and ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -12 }} barGap={2} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
          {series.length > 1 ? (
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: 12 }}
              // Legend text stays in text ink; the swatch carries the series colour.
              formatter={(value) => <span style={{ color: 'var(--muted-foreground)' }}>{value}</span>}
            />
          ) : null}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.length <= 6 ? <LabelList dataKey={s.key} position="top" fill="var(--foreground)" fontSize={11} /> : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A single percentage over months (0–100 axis); gaps where nothing was due. */
export function MonthlyPercentLine({ data, dataKey, name, height = 240 }: { data: Record<string, string | number | null>[]; dataKey: string; name: string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${name} by month`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 20, right: 40, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...AXIS} axisLine={false} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
            content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} unit="%" />}
          />
          <Line
            // Straight segments: a smoothed curve would overshoot and suggest values that were never recorded.
            type="linear"
            dataKey={dataKey}
            name={name}
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--chart-surface)', strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={dataKey}
              content={({ x, y, value, index }) =>
                index === data.length - 1 && value != null ? (
                  <text x={Number(x) + 8} y={Number(y) + 4} textAnchor="start" fontSize={12} fontWeight={600} fill="var(--foreground)">
                    {`${value}%`}
                  </text>
                ) : null
              }
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
