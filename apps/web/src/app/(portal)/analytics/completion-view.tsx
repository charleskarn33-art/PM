import { CalendarCheck, CalendarClock, CalendarX, Clock, Percent } from 'lucide-react';
import Link from 'next/link';
import { BarList } from '@/components/charts/bar-list';
import { LineChart } from '@/components/charts/line-chart';
import { KpiCard } from '@/components/kpi-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { pct } from '@/lib/format';
import { monthLabel, type Completion } from './types';

const GROUP = { region: 'Region', county: 'County', technician: 'Technician' } as const;

export function CompletionView({ d, canConfigure }: { d: Completion; canConfigure: boolean }) {
  const t = d.total;
  const target = d.targetPct;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="PM due" value={t.due} icon={CalendarClock} tone="info" hint={`${monthLabel(d.range.from)} – ${monthLabel(d.range.to)}, not cancelled`} />
        <KpiCard label="Completed" value={t.completed} icon={CalendarCheck} tone="success" hint="Completed or approved" />
        <KpiCard label="Completion rate" value={pct(t.ratePct)} icon={Percent} tone="primary" hint={target == null ? 'No target configured' : `Target ${pct(target)}${t.belowTarget ? ' — below target' : ''}`} />
        <KpiCard label="On time" value={pct(t.onTimePct)} icon={Clock} tone="info" hint={`${t.onTime} finished by the due date, ${t.late} late`} />
        <KpiCard label="Overdue" value={t.overdue} icon={CalendarX} tone={t.overdue ? 'danger' : 'neutral'} hint={`${t.open} still open, not yet due`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completion by month due</CardTitle>
          <CardDescription>Share of the PMs due each month that were completed, and completed on time.</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            title="PM completion rate and on-time rate by month due"
            series={[
              { key: 'rate', label: 'Completion rate', color: 'var(--series-1)' },
              { key: 'onTime', label: 'On-time rate', color: 'var(--series-2)' },
            ]}
            data={d.trend.map((m) => ({ label: monthLabel(m.month), values: { rate: m.ratePct, onTime: m.onTimePct } }))}
            unit="%"
            max={100}
            reference={target == null ? null : { value: target, label: `Target ${pct(target)}` }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completion rate by {GROUP[d.by].toLowerCase()}</CardTitle>
          <CardDescription>
            {d.by === 'technician' ? 'By the technician the PM was assigned to. ' : ''}
            Lowest first.{' '}
            {target == null ? (
              <>
                No completion target is configured
                {canConfigure ? (
                  <>
                    {' '}
                    (<Link href="/admin/settings#thresholds" className="underline">set one in Settings</Link>)
                  </>
                ) : null}
                .
              </>
            ) : (
              <>Groups below the {pct(target)} target are marked.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {d.groups.length ? (
            <BarList
              max={100}
              items={d.groups.map((g) => ({
                label: g.name,
                value: g.ratePct,
                display: `${pct(g.ratePct)} (${g.completed}/${g.due})`,
                note: g.belowTarget ? 'below target' : undefined,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No PM was due in this period.</p>
          )}
          {d.groups.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{GROUP[d.by]}</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.groups.map((g) => (
                    <TableRow key={g.id ?? 'none'}>
                      <TableCell>
                        {g.name}
                        {g.region ? <span className="ml-1 text-xs text-muted-foreground">({g.region})</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.due}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.onTime}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.late}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.overdue}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.open}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {pct(g.ratePct)}
                        {g.belowTarget ? <span className="ml-1 text-xs font-normal text-danger">below target</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
