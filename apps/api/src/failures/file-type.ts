import { sniffImage } from '../pm/image-type.js';

export interface AttachmentType {
  kind: 'PHOTO' | 'DOCUMENT';
  contentType: string;
  ext: string;
}

/**
 * What an attached file is, from its first bytes (never its name or the
 * client's Content-Type): a JPEG, PNG or WebP photo, or a PDF document.
 */
export function sniffAttachment(data: Buffer): AttachmentType | null {
  const image = sniffImage(data);
  if (image) return { kind: 'PHOTO', ...image };
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'DOCUMENT', contentType: 'application/pdf', ext: 'pdf' };
  return null;
}
