// Seeded PRNG (mulberry32). Only the engine consumes it, in simulation order, so a seed plus the
// input log reproduces a run regardless of render rate.
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Fair coin, the equivalent of the source's Math.round(Math.random()). */
  coin(): boolean {
    return this.next() >= 0.5;
  }
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}
