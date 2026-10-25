import officialJson from './official.json';
import siteAveragesJson from './site-averages.json';
import { ENGINE_VERSION } from '../engine/game';
import { classicField } from '../engine/geometry';
import type { InputPolicy, ModeConfig } from '../engine/types';
import type { FieldMode } from '../schemas/app';
import { canonicalConfig, hashString, type Preset } from '../schemas/preset';

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** The 27 official presets: immutable benchmark definitions. */
export const OFFICIAL_PRESETS: readonly Preset[] = deepFreeze(officialJson as Preset[]);

export const SITE_AVERAGES: Readonly<Record<string, { value: number; snapshotDate: string }>> = siteAveragesJson.averages;

export const CATEGORY_ORDER = ['Precision', 'Precision + speed', 'Flick', 'Reaction', 'Speed clear', 'Tracking', 'Mixed', 'Custom'];

/** Field size in CSS px. Classic follows the legacy rule; large fills the available area. */
export function fieldFor(mode: FieldMode, ratio: number, screenWidth: number, available: { width: number; height: number }): { width: number; height: number } {
  if (mode === 'classic') return classicField(screenWidth, ratio);
  let w = Math.floor(Math.max(600, available.width));
  let h = Math.round(w * ratio);
  if (h > available.height && available.height >= 300) {
    h = Math.floor(available.height);
    w = Math.round(h / ratio);
  }
  return { width: w, height: h };
}

const PX_FIELDS: (keyof ModeConfig)[] = ['speedX', 'speedY', 'speedStepX', 'speedStepY', 'accelX', 'accelY', 'maxSpeedX', 'maxSpeedY', 'movingRadius', 'changeRadiusOnHit', 'checkpointSize'];

/**
 * The config the engine actually runs. Classic = the preset unchanged. Large fields scale pixel
 * speeds, steps, orbit, radius changes and the hub with the field (radii already scale with width);
 * practice levels change size and speed. Both get their own comparison key.
 */
export function effectiveConfig(c: ModeConfig, mode: FieldMode, fieldWidth: number, classicWidth: number, practiceLevel: number | null): ModeConfig {
  const out = { ...c } as Record<string, unknown>;
  if (mode === 'large' && classicWidth > 0) {
    const k = fieldWidth / classicWidth;
    for (const f of PX_FIELDS) out[f] = +((c[f] as number) * k).toFixed(4);
    out.checkpointSize = Math.max(1, Math.round(c.checkpointSize * k));
  }
  if (practiceLevel) {
    const size = 1 - 0.06 * practiceLevel;
    const speed = 1 + 0.06 * practiceLevel;
    out.radiusMin = Math.min(100, Math.max(0.5, +(c.radiusMin * size).toFixed(3)));
    out.radiusMax = Math.min(100, Math.max(0.5, +(c.radiusMax * size).toFixed(3)));
    for (const f of ['speedX', 'speedY', 'accelX', 'accelY', 'maxSpeedX', 'maxSpeedY'] as const) out[f] = +((out[f] as number) * speed).toFixed(4);
  }
  return out as unknown as ModeConfig;
}

export function comparisonKey(p: { config: ModeConfig }, o: { fieldMode: FieldMode; width: number; height: number; inputPolicy: InputPolicy; practiceLevel: number | null }): string {
  const body = [ENGINE_VERSION, canonicalConfig(p.config), o.fieldMode, o.width, o.height, o.inputPolicy, o.practiceLevel === null ? 'fixed' : `practice:${o.practiceLevel}`].join('|');
  return hashString(body);
}

export function configHash(c: ModeConfig): string {
  return hashString(canonicalConfig(c));
}

/** Rough run length in seconds for routine estimates; null when it depends on the player. */
export function estimateSeconds(c: ModeConfig): number | null {
  if (c.ggTimer > 0 && c.scoreMode !== 2) return c.ggTimer;
  if (c.scoreMode === 3 && c.ggHits) return Math.round(c.ggHits * ((c.targetDelay / 2) + 3000 + 400) / 1000);
  if (c.ggHits) return Math.round(c.ggHits * 0.6);
  return null;
}
