// Host clock and frame scheduler. Production uses performance.now() and requestAnimationFrame;
// tests replace them to drive runs deterministically.
export interface Runtime {
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  screenWidth(): number;
  dpr(): number;
}

export const rt: Runtime = {
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  screenWidth: () => (typeof screen !== 'undefined' && screen.width ? screen.width : 1920),
  dpr: () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1),
};

export function setRuntime(r: Partial<Runtime>): void {
  Object.assign(rt, r);
}

/** Percentile of a numeric list (nearest-rank on a sorted copy). Null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}
