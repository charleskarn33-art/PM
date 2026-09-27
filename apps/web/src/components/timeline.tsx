import { humanizeStatus } from '@ipt/shared';
import type { Attachment, TimelineEntry } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

/** The failure's record: comments, status changes and recorded edits, oldest first. */
export function Timeline({ entries, actionNumbers }: { entries: TimelineEntry[]; actionNumbers?: Map<string, string> }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {entries.map((u) => (
        <li key={u.id} className="border-l-2 pl-3" style={{ borderColor: u.kind === 'COMMENT' ? 'var(--info)' : u.kind === 'STATUS' ? 'var(--warning)' : 'var(--border)' }}>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(u.createdAt)} · {u.author?.fullName ?? 'System'}
            {u.correctiveActionId && actionNumbers?.get(u.correctiveActionId) ? ` · ${actionNumbers.get(u.correctiveActionId)}` : ''}
          </p>
          {u.kind === 'STATUS' && u.toStatus ? (
            <p className="font-medium">{u.fromStatus ? `${humanizeStatus(u.fromStatus)} → ${humanizeStatus(u.toStatus)}` : humanizeStatus(u.toStatus)}</p>
          ) : null}
          {u.body ? <p className="whitespace-pre-wrap">{u.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}

const size = (n: number) => (n < 1_000_000 ? `${Math.max(1, Math.round(n / 1000))} KB` : `${(n / 1_000_000).toFixed(1)} MB`);

/** Photos (thumbnails) and documents (download links), relayed from the API. */
export function AttachmentList({ failureId, files, remove }: { failureId: string; files: Attachment[]; remove?: (a: Attachment) => React.ReactNode }) {
  if (!files.length) return <p className="text-sm text-muted-foreground">No photos or documents.</p>;
  const url = (a: Attachment) => `/files/failures/${failureId}/attachments/${a.id}`;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {files.map((a) => (
        <li key={a.id} className="flex gap-3 rounded-lg border p-2 text-sm">
          {a.kind === 'PHOTO' ? (
            <a href={url(a)} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- relayed from the API */}
              <img src={url(a)} alt={a.caption ?? a.fileName} className="size-20 rounded object-cover" loading="lazy" />
            </a>
          ) : (
            <a href={url(a)} className="flex size-20 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold">
              PDF
            </a>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <a href={url(a)} className="block truncate font-medium hover:underline" {...(a.kind === 'PHOTO' ? { target: '_blank', rel: 'noreferrer' } : {})}>
              {a.caption ?? a.fileName}
            </a>
            <p className="text-xs text-muted-foreground">
              {a.uploadedBy.fullName} · {formatDateTime(a.createdAt)} · {size(a.sizeBytes)}
            </p>
            {remove ? remove(a) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
