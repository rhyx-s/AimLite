import type { ModeConfig } from './types';

/** One registered hit, with the per-hit metrics the scoring rules use. Times are engine ms. */
export interface HitRecord {
  t: number;
  index: number;
  targetId: number;
  x: number;
  y: number;
  radius: number;
  mouseX: number;
  mouseY: number;
  /** Click time − target spawn time. */
  reactionTime: number;
  /** Click time − cursor entering the target (0 if longer than 1 s). */
  captureTime: number;
  /** Click time − previous hit (0 for the first hit). */
  aimingTime: number;
  /** 100 − 100·d/r, floored at 0; d ≤ 1 px counts as dead centre. */
  precision: number;
  /** Cursor path length since the previous hit. */
  traceDist: number;
  /** Straight distance from the previous hit's click (via the checkpoint edge when there is one). */
  minDist: number;
  /** Trajectory efficiency %, min(100, minDist / traceDist). */
  eff: number;
  hpm: number;
  reactionBonus: number;
  precisionBonus: number;
  effBonus: number;
  distanceBonus: number;
  cursorSpeed: number;
  combo: number;
  /** Tracking modes: the hit was awarded by time-on-target (life points), not a click. */
  byTracking: boolean;
}

/** A completed synchronised set in grouped ("multi") modes. */
export interface MultiHitRecord {
  t: number;
  num: number;
  eff: number;
  distance: number;
  path: number;
  reactionTime: number;
  bonusPrecision: number;
  bonusReaction: number;
  bonusEff: number;
  bonusDistance: number;
  aimingTime: number;
  cursorSpeed: number;
  hpm: number;
  combo: number;
}

export function calcPrecision(tx: number, ty: number, r: number, mx: number, my: number): number {
  let d = +Math.hypot(mx - tx, my - ty).toFixed(3);
  if (d <= 1) d = 0;
  const p = +(100 - (100 * d) / r).toFixed(2);
  return p < 0 ? 0 : p;
}

export function calcEff(index: number, minDist: number, traceDist: number): number {
  if (index <= 0) return 0;
  if (traceDist <= 0) return 100;
  const e = Math.round((10000 * minDist) / traceDist) / 100;
  return e > 100 ? 100 : e;
}

/** Full bonus under 160 ms, falling linearly to 0 at the target's life; 0 past it. */
export function reactionBonus(cfg: ModeConfig, reactionMs: number, lifeMs: number): number {
  let k: number;
  if (reactionMs > lifeMs) k = 0;
  else if (reactionMs < 160) k = 1;
  else k = 1 - (reactionMs - 160) / (lifeMs - 160);
  return Math.round(cfg.bonusProcReaction * k);
}

export const precisionBonus = (cfg: ModeConfig, precision: number): number => Math.round((cfg.bonusProcPrecision * precision) / 100);

/** Only trajectory above 80 % pays: (eff − 80) × 5 % of the maximum. */
export function effBonus(cfg: ModeConfig, eff: number): number {
  const d = Math.max(0, eff - 80) * 5;
  return Math.round((cfg.bonusProcEff * d) / 100);
}

export function distanceBonus(cfg: ModeConfig, minDist: number, fieldWidth: number): number {
  const k = Math.round((1e4 * minDist) / fieldWidth) / 1e4;
  return Math.round(cfg.bonusProcDistance * k);
}

/** Running avg / min / max (min/max ignore the "0 = unset" quirk of the source). */
export class Agg {
  sum = 0;
  n = 0;
  min = Number.NaN;
  max = Number.NaN;
  add(v: number): void {
    this.sum += v;
    this.n++;
    if (!(v >= this.min)) this.min = v;
    if (!(v <= this.max)) this.max = v;
  }
  get avg(): number {
    return this.n ? this.sum / this.n : Number.NaN;
  }
  toJSON(): { avg: number | null; min: number | null; max: number | null; n: number } {
    const f = (v: number): number | null => (Number.isFinite(v) ? v : null);
    return { avg: f(this.avg), min: f(this.min), max: f(this.max), n: this.n };
  }
}
