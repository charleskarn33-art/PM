/**
 * The image type from the file's first bytes (not from its name or the
 * client's Content-Type, which can be anything). Only JPEG, PNG and WebP.
 */
export function sniffImage(data: Buffer): { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png' };
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return { contentType: 'image/webp', ext: 'webp' };
  return null;
}
