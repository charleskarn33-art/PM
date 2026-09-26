import { describe, expect, it } from 'vitest';
import { addPoint, hasSignature } from './signature';

describe('signature strokes', () => {
  it('keeps points at least 2 px apart, rounded to 0.1 px', () => {
    let s = addPoint([], 10.04, 20.06);
    s = addPoint(s, 11, 20.5); // too close
    s = addPoint(s, 14, 22);
    expect(s).toEqual([
      [10, 20.1],
      [14, 22],
    ]);
    expect(hasSignature([s])).toBe(true);
    expect(hasSignature([[[1, 1]]])).toBe(false);
  });
});
