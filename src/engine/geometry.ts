import type { ModeConfig } from './types';

/** Legacy simulation rate. One tick = 1000/61 ms ≈ 16.393 ms. */
export const SIM_HZ = 61;
export const TICK_MS = 1000 / SIM_HZ;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Config radius value (0–100 scale) → CSS px for a field width: width × (0.001 + 0.00199 × value). */
export function radiusPx(value: number, width: number): number {
  return round3(width * ((0.2 - 0.001) / 100 * value + 0.001));
}

/** Radius bounds in px; the two config values are swapped if min > max (as the source does). */
export function radiusBounds(cfg: Pick<ModeConfig, 'radiusMin' | 'radiusMax'>, width: number): { min: number; max: number } {
  const lo = Math.min(cfg.radiusMin, cfg.radiusMax);
  const hi = Math.max(cfg.radiusMin, cfg.radiusMax);
  return { min: radiusPx(lo, width), max: radiusPx(hi, width) };
}

/** Pulse coefficient for animation speed 0–100: 0.9 + 0.001 × (100 − speed). 1 = no pulse. */
export function animationCoeff(speed: number): number {
  const s = Math.min(100, Math.max(0, speed));
  return (1 - 0.9) / 100 * (100 - s) + 0.9;
}

/**
 * Target life used by the reaction bonus (ms): ticks needed to pulse from min to max (×2 when it
 * grows and shrinks) at 61 Hz, else 750 ms. targetLifeTime > 0 overrides it.
 */
export function targetLifeMs(cfg: ModeConfig, width: number): number {
  let life: number;
  const coeff = animationCoeff(cfg.animationSpeed);
  if (coeff < 1) {
    const { min, max } = radiusBounds(cfg, width);
    let n = 0;
    for (let r = min; r < max; ) {
      n++;
      r = round3(r / coeff);
      if (n > 1000) break;
    }
    if (cfg.animationIncrease && cfg.animationDecrease) n *= 2;
    life = Math.round(1000 * n / SIM_HZ);
  } else {
    life = 750;
  }
  if (cfg.targetLifeTime > 0) life = cfg.targetLifeTime;
  return life;
}

/** Classic field: 55 % of the screen width, clamped to 600–1056 px; height = width × ratio. */
export function classicField(screenWidth: number, ratio: number): { width: number; height: number } {
  let w = Math.round(screenWidth * 0.55);
  w = Math.min(1056, Math.max(600, w));
  return { width: w, height: Math.round(w * ratio) };
}

export const distance = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
