'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface LineSeries {
  key: string;
  label: string;
  /** A CSS colour token, e.g. var(--series-1). Assign in a fixed order. */
  color: string;
}

export interface LinePoint {
  /** The x label (e.g. "Sep 2026"). */
  label: string;
  /** Values per series key; null = nothing recorded (a gap in the line). */
  values: Record<string, number | null>;
}

interface Props {
  series: LineSeries[];
  data: LinePoint[];
  /** Appended to values in the axis, tooltip and table (e.g. "%", " kW"). */
  unit?: string;
  decimals?: number;
  /** Start the y axis at zero (rates, counts); false fits the data (voltages). */
  zero?: boolean;
  /** Fixed y maximum (e.g. 100 for percentages). */
  max?: number;
  /** A configured target or limit, drawn as a dashed reference line. */
  reference?: { value: number; label: string } | null;
  /** Accessible summary of what the chart shows. */
  title: string;
  height?: number;
}

const PAD = { top: 12, right: 16, bottom: 28, left: 48 };

/** Round tick values; never finer than the precision shown (whole numbers for counts). */
function niceTicks(lo: number, hi: number, minStep: number, count = 4): number[] {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const fits = (s: number) => Math.abs(s / minStep - Math.round(s / minStep)) < 1e-9;
  const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && fits(s)) ?? 10 * mag);
  const out: number[] = [];
  // From the step at or below `lo` to the step at or above `hi`, so every value sits inside the labelled range.
  const end = Math.ceil(hi / step - 1e-9) * step;
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * A line chart for monthly trends: one y axis, thin 2px lines with gaps where
 * nothing was recorded, a legend for two or more series, a crosshair with a
 * tooltip on hover or arrow keys, and the same figures as a table.
 */
export function LineChart({ series, data, unit = '', decimals = 1, zero = true, max, reference, title, height = 220 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const id = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('en-GB', { maximumFractionDigits: decimals })}${unit}`);
  const known = data.flatMap((d) => series.map((s) => d.values[s.key])).filter((v): v is number => v != null);
  if (reference) known.push(reference.value);
  const hasData = data.some((d) => series.some((s) => d.values[s.key] != null));
  let lo = zero ? 0 : Math.min(...known);
  let hi = max ?? Math.max(...known, zero ? 1 : -Infinity);
  if (!zero && known.length) {
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const ticks = known.length ? niceTicks(lo, hi, 10 ** -decimals) : [0, 1];
  lo = Math.min(lo, ticks[0]!);
  hi = Math.max(hi, ticks.at(-1)!);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? plotW / 2 : (i * plotW) / (data.length - 1));
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const pathOf = (key: string) => {
    let d = '';
    let pen = false;
    data.forEach((p, i) => {
      const v = p.values[key];
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // Every nth x label, counted back from the latest month, so they never collide.
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 64))));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = data.length <= 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (data.length - 1));
    setActive(Math.min(data.length - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.min(data.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : data.length)) + step)));
    } else if (e.key === 'Escape') setActive(null);
  };

  const point = active != null ? data[active] : null;
  const tipLeft = active != null ? x(active) : 0;

  return (
    <figure className="space-y-2">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={box} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-t`}
          tabIndex={hasData ? 0 : -1}
          className="block touch-none overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerMove={hasData ? pick : undefined}
          onPointerLeave={() => setActive(null)}
          onKeyDown={hasData ? onKey : undefined}
          onBlur={() => setActive(null)}
        >
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tabular-nums">
                {fmt(t)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--chart-axis)" strokeWidth={1} />
          {data.map((p, i) =>
            (data.length - 1 - i) % every === 0 ? (
              <text key={p.label} x={x(i)} y={height - 8} textAnchor={i === 0 && data.length > 1 ? 'start' : i === data.length - 1 && data.length > 1 ? 'end' : 'middle'} fontSize={11} fill="var(--chart-muted)">
                {p.label}
              </text>
            ) : null,
          )}
          {reference ? (
            <g>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="4 4" />
              <text x={width - PAD.right} y={y(reference.value) - 5} textAnchor="end" fontSize={11} fill="var(--foreground)">
                {reference.label}
              </text>
            </g>
          ) : null}
          {series.map((s) => (
            <g key={s.key}>
              <path d={pathOf(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {data.map((p, i) => {
                const v = p.values[s.key];
                return v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={active === i ? 4.5 : 3} fill={s.color} stroke="var(--chart-surface)" strokeWidth={2} />;
              })}
            </g>
          ))}
          {active != null ? <line x1={tipLeft} x2={tipLeft} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--chart-axis)" strokeWidth={1} pointerEvents="none" /> : null}
          {!hasData ? (
            <text x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} textAnchor="middle" fontSize={13} fill="var(--chart-muted)">
              Nothing recorded in this period
            </text>
          ) : null}
        </svg>
        {point ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: tipLeft, transform: tipLeft > width / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
          >
            <p className="mb-1 font-medium">{point.label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums">{fmt(point.values[s.key])}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Show as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1.5 pr-4 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-4">{p.label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1.5 pr-4 text-right tabular-nums">
                      {fmt(p.values[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
