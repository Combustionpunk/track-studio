// Numeric helpers that behave exactly like the Python reference (bake.py / fit.py), so rounded output matches
// digit for digit.

/** Python's float `%`: the result takes the sign of the divisor. */
export function pyMod(a: number, b: number): number {
  const m = a % b;
  return m !== 0 && b < 0 !== m < 0 ? m + b : m;
}

/**
 * Python's `round(v, digits)` / `f"{v:.{digits}f}"` as a decimal string: rounds the exact binary value, ties to even.
 * (JS `toFixed` rounds ties away from zero, `Math.round` rounds them up.)
 */
export function pyFormat(v: number, digits: number): string {
  if (!Number.isFinite(v)) return String(v);
  const neg = v < 0 || Object.is(v, -0);
  // toFixed(100) is the exact decimal expansion for any value this engine produces (|v| < 1e15, not subnormal)
  const exact = Math.abs(v).toFixed(100);
  const dot = exact.indexOf(".");
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  let kept = intPart + frac.slice(0, digits);
  const rest = frac.slice(digits);
  const first = rest.charCodeAt(0) - 48;
  const tail = /[1-9]/.test(rest.slice(1));
  const lastKept = kept.charCodeAt(kept.length - 1) - 48;
  const roundUp = first > 5 || (first === 5 && (tail || lastKept % 2 === 1));
  if (roundUp) kept = incrementDecimal(kept);
  const out = digits > 0 ? `${kept.slice(0, kept.length - digits)}.${kept.slice(kept.length - digits)}` : kept;
  return neg ? `-${out}` : out;
}

function incrementDecimal(s: string): string {
  const d = s.split("");
  let i = d.length - 1;
  while (i >= 0) {
    if (d[i] === "9") {
      d[i] = "0";
      i--;
    } else {
      d[i] = String.fromCharCode(d[i].charCodeAt(0) + 1);
      return d.join("");
    }
  }
  return `1${d.join("")}`;
}

/** Python's `round(v, digits)` as a number. */
export function pyRound(v: number, digits: number): number {
  const r = Number(pyFormat(v, digits));
  return r === 0 ? 0 : r; // Python keeps -0.0; JSON consumers don't care and -0 only causes surprises in JS
}

/** Python's `round(v)` to an integer (ties to even). */
export function pyRoundInt(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** `round(v, 3)` — every stored coordinate goes through this, like `r3` in bake.py. */
export const r3 = (v: number): number => pyRound(v, 3);

/** CPython's math.radians / math.degrees use these exact factors. */
export const radians = (deg: number): number => deg * (Math.PI / 180);
export const degrees = (rad: number): number => rad * (180 / Math.PI);

/** numpy.searchsorted on an ascending array. */
export function searchSorted(a: ArrayLike<number>, v: number, side: "left" | "right" = "left"): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (side === "left" ? a[mid] < v : a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
