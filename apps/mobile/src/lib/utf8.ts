/** UTF-8 encode/decode without relying on TextEncoder/TextDecoder availability. */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 >= 0xf0) cp = ((b0 & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else if (b0 >= 0xe0) cp = ((b0 & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else cp = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}
