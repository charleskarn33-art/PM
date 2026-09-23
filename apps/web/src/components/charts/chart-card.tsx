import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * A chart with its title and a table view of the same numbers, so every value
 * is readable without hovering and without relying on colour.
 */
export function ChartCard({
  title,
  description,
  table,
  empty,
  children,
}: {
  title: string;
  description?: ReactNode;
  table?: TableView;
  /** Shown instead of the chart when there is no data. */
  empty?: string | false;
  children: ReactNode;
}) {
  return (
    // min-w-0: inside a grid, let wide tables scroll within the card instead of widening the page.
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {empty ? <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p> : children}
        {table && !empty && table.rows.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-info">Show table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {table.columns.map((c) => (
                      <th key={c} className="py-1 pr-4 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {r.map((v, j) => (
                        <td key={j} className="py-1 pr-4 tabular-nums">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
