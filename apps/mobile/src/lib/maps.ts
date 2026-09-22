/** Native maps deep link (Apple Maps on iOS, geo: intent on Android). */
export function mapsUrl(platform: string, lat: number, lng: number, label: string): string {
  const q = encodeURIComponent(label);
  return platform === 'ios' ? `maps:0,0?q=${q}&ll=${lat},${lng}` : `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
}

/** Browser fallback when no native maps app handles the deep link. */
export function webMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
