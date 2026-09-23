import { ImageOff } from 'lucide-react';
import type { VisitPhoto } from '@/lib/pm-visit';

type Urls = Map<string, { thumb: string | null; full: string | null }>;

/** Evidence photo thumbnails; each opens the full image (signed, short-lived URL) in a new tab. */
export function PhotoThumbs({ photos, urls, label }: { photos: VisitPhoto[]; urls: Urls; label: string }) {
  if (photos.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {photos.map((p) => {
        const u = urls.get(p.id);
        const taken = new Date(p.taken_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        return (
          <li key={p.id}>
            {u?.thumb ? (
              <a href={u.full ?? u.thumb} target="_blank" rel="noreferrer" title={`Photo taken ${taken}`} className="block">
                {/* Signed Storage URLs are short-lived and private; next/image optimisation is not used for them. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.thumb} alt={p.caption ?? `Photo taken ${taken}`} className="size-20 rounded-md border object-cover" loading="lazy" />
              </a>
            ) : (
              <span
                className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border bg-muted text-center text-[10px] text-muted-foreground"
                title={`Photo taken ${taken}`}
              >
                <ImageOff className="size-4" aria-hidden />
                Not available
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
