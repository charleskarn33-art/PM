import { TableCell, TableRow } from '@/components/ui/table';

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-12 text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}
