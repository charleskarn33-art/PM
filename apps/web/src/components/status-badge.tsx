import { humanizeStatus, type StatusTone } from '@ipt/shared';
import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status, tone }: { status: string; tone: StatusTone }) {
  return <Badge tone={tone}>{humanizeStatus(status)}</Badge>;
}
