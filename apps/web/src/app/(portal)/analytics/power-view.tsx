import Link from 'next/link';
import type { ReactNode } from 'react';
import { LineChart } from '@/components/charts/line-chart';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { FLAG_LABELS, monthLabel, num, type Power, type SiteRef } from './types';

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone="danger">
          {FLAG_LABELS[f] ?? f}
        </Badge>
      ))}
    </span>
  );
}

function SiteCell({ site, visitId }: { site: SiteRef; visitId: string }) {
  return (
    <>
      <Link href={`/sites/${site.id}`} className="font-medium hover:underline">
        {site.siteCode}
      </Link>{' '}
      <span className="text-muted-foreground">{site.siteName}</span>
      {site.isDemo ? <span className="ml-1 text-xs text-muted-foreground">(demo)</span> : null}
      <Link href={`/visits/${visitId}`} className="ml-2 text-xs text-muted-foreground underline">
        PM
      </Link>
    </>
  );
}

const limitText = (v: number | null, unit: string, kind: 'max' | 'min') => (v == null ? 'none set' : `${kind === 'max' ? 'above' : 'below'} ${num(v, 3)}${unit}`);

export function PowerView({ d, canConfigure }: { d: Power; canConfigure: boolean }) {
  const t = d.thresholds;
  const months = (trend: { month: string }[]) => trend.map((m) => monthLabel(m.month));
  const none = [t.dcLoadKwMax, t.rectifierVoltageMin, t.batteryVoltageMin, t.batteryUnitVoltageMin, t.fuelLevelMinPct, t.generatorServiceHours].every((v) => v == null);
  return (
    <div className="space-y-6">
      {none ? (
        <Alert tone="info">
          No power thresholds are configured, so no site is flagged. Readings are shown as recorded.
          {canConfigure ? (
            <>
              {' '}
              <Link href="/admin/settings#thresholds" className="underline">
                Set thresholds in Settings
              </Link>
              .
            </>
          ) : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DC load</CardTitle>
          <CardDescription>
            DC power = rectifier voltage × load current, from each PM. Flagged: load {limitText(t.dcLoadKwMax, ' kW', 'max')}; rectifier voltage {limitText(t.rectifierVoltageMin, ' V', 'min')}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Readings" value={d.dc.readings} />
            <Stat label="Sites reported" value={d.dc.sitesReported} />
            <Stat label="Sites flagged" value={d.dc.sitesFlagged} />
            <Stat label="Average load" value={num(d.dc.overall.avgDcPowerKw, 3, ' kW')} />
            <Stat label="Highest load" value={num(d.dc.overall.maxDcPowerKw, 3, ' kW')} />
          </div>
          <LineChart
            title="Average DC load per month"
            series={[{ key: 'kw', label: 'Average DC load', color: 'var(--series-1)' }]}
            data={d.dc.trend.map((m, i) => ({ label: months(d.dc.trend)[i]!, values: { kw: m.avgDcPowerKw } }))}
            unit=" kW"
            decimals={3}
            reference={t.dcLoadKwMax == null ? null : { value: t.dcLoadKwMax, label: `Limit ${num(t.dcLoadKwMax, 3)} kW` }}
          />
          <SiteTable
            headings={['DC load', 'Load current', 'Rectifier voltage']}
            rows={d.dc.sites.map((s) => ({ ...s, cells: [num(s.dcPowerKw, 3, ' kW'), num(s.loadCurrentA, 2, ' A'), num(s.rectifierVoltageV, 2, ' V')] }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batteries</CardTitle>
          <CardDescription>
            Flagged: bank voltage {limitText(t.batteryVoltageMin, ' V', 'min')}; any single battery {limitText(t.batteryUnitVoltageMin, ' V', 'min')}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Readings" value={d.battery.readings} />
            <Stat label="Sites reported" value={d.battery.sitesReported} />
            <Stat label="Sites flagged" value={d.battery.sitesFlagged} />
            <Stat label="Average bank voltage" value={num(d.battery.overall.avgBatteryVoltageV, 2, ' V')} />
            <Stat label="Lowest single battery" value={num(d.battery.overall.minUnitVoltageV, 2, ' V')} />
          </div>
          <LineChart
            title="Average battery bank voltage per month"
            series={[{ key: 'v', label: 'Average bank voltage', color: 'var(--series-1)' }]}
            data={d.battery.trend.map((m, i) => ({ label: months(d.battery.trend)[i]!, values: { v: m.avgBatteryVoltageV } }))}
            unit=" V"
            decimals={2}
            zero={false}
            reference={t.batteryVoltageMin == null ? null : { value: t.batteryVoltageMin, label: `Minimum ${num(t.batteryVoltageMin, 2)} V` }}
          />
          <SiteTable
            headings={['Bank voltage', 'Lowest battery', 'Batteries recorded']}
            rows={d.battery.sites.map((s) => ({ ...s, cells: [num(s.batteryVoltageV, 2, ' V'), num(s.minUnitVoltageV, 2, ' V'), String(s.unitsRecorded)] }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generators</CardTitle>
          <CardDescription>
            Flagged: fuel {limitText(t.fuelLevelMinPct, '%', 'min')}; running hours {t.generatorServiceHours == null ? 'none set' : `at or above ${num(t.generatorServiceHours, 0)} h`}. &ldquo;Needs service&rdquo; is what the technician recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Readings" value={d.generator.readings} />
            <Stat label="Sites reported" value={d.generator.sitesReported} />
            <Stat label="Sites flagged" value={d.generator.sitesFlagged} />
            <Stat label="Average fuel level" value={num(d.generator.overall.avgFuelLevelPct, 1, '%')} />
            <Stat label="Recorded as needing service" value={d.generator.overall.requiresService} />
          </div>
          <LineChart
            title="Average generator fuel level per month"
            series={[{ key: 'fuel', label: 'Average fuel level', color: 'var(--series-1)' }]}
            data={d.generator.trend.map((m, i) => ({ label: months(d.generator.trend)[i]!, values: { fuel: m.avgFuelLevelPct } }))}
            unit="%"
            max={100}
            reference={t.fuelLevelMinPct == null ? null : { value: t.fuelLevelMinPct, label: `Minimum ${num(t.fuelLevelMinPct, 1)}%` }}
          />
          <SiteTable
            headings={['Fuel level', 'Running hours', 'Needs service']}
            rows={d.generator.sites.map((s) => ({
              ...s,
              cells: [num(s.fuelLevelPct, 1, '%'), num(s.runningHours, 1, ' h'), s.requiresService == null ? '—' : s.requiresService ? 'Yes' : 'No'],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SiteTable({ headings, rows }: { headings: string[]; rows: { site: SiteRef; visitId: string; recordedAt: string; flags: string[]; cells: string[] }[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No readings from finished PMs in this period.</p>;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">Latest reading per site {rows.length > 1 ? '(flagged first)' : ''}</p>
      <div className="max-h-96 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead>Recorded</TableHead>
              {headings.map((h) => (
                <TableHead key={h} className="text-right">
                  {h}
                </TableHead>
              ))}
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.site.id}>
                <TableCell className="whitespace-nowrap">
                  <SiteCell site={r.site} visitId={r.visitId} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.recordedAt)}</TableCell>
                {r.cells.map((c, i) => (
                  <TableCell key={headings[i]} className="text-right tabular-nums">
                    {c}
                  </TableCell>
                ))}
                <TableCell>
                  <Flags flags={r.flags} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
