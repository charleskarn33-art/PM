export type Stroke = [number, number][];

/** Adds a touch point to a stroke, dropping points closer than `min` px to the previous one (keeps signatures light to send). */
export function addPoint(stroke: Stroke, x: number, y: number, min = 2): Stroke {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(last[0] - x, last[1] - y) < min) return stroke;
  return [...stroke, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]];
}

/** True when something was actually drawn (a stroke with at least two points). */
export const hasSignature = (strokes: readonly Stroke[]) => strokes.some((s) => s.length > 1);
