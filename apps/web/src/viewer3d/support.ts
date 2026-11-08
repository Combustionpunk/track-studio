// Whether this browser can draw the 3D view (#83). Kept apart from the viewer so the track page can ask without
// loading three.js.

let cached: boolean | undefined;

export function hasWebGL(): boolean {
  if (cached !== undefined) return cached;
  try {
    const c = document.createElement("canvas");
    cached = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    cached = false;
  }
  return cached;
}
