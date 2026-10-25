import { Game } from '../../src/engine/game';
import type { EngineOptions, ModeConfig } from '../../src/engine/types';
import { OFFICIAL_PRESETS } from '../../src/presets';

export const FIELD = { width: 800, height: 496 };

export function preset(id: string): ModeConfig {
  const p = OFFICIAL_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error('no preset ' + id);
  return { ...p.config };
}

/** A neutral config: one static r=20 target at a random spot, 100 s, +100 / −50, no bonuses. */
export function base(over: Partial<ModeConfig> = {}): ModeConfig {
  return {
    ...preset('official:quick-reflex'),
    name: 'test',
    bonusProcReaction: 0,
    bonusProcEff: 0,
    bonusProcPrecision: 0,
    bonusProcDistance: 0,
    spMiss: 50,
    ...over,
  };
}

export function opts(over: Partial<EngineOptions> = {}): EngineOptions {
  return { seed: 42, inputPolicy: 'legacy-v1', clickRateGuard: false, countdownSeconds: 0, ...over };
}

/** Start a game at host time 0 (no countdown): targets with no delay are live at t = 0. */
export function start(cfg: ModeConfig, o: Partial<EngineOptions> = {}, field = FIELD): Game {
  const g = new Game(cfg, field, opts(o));
  g.begin(0);
  return g;
}

/** Advance in fixed host-frame steps up to `until` (ms). */
export function run(g: Game, until: number, frameMs = 1000 / 60, from = 0): void {
  let t = from;
  while (t < until) {
    t = Math.min(until, t + frameMs);
    g.advance(t);
  }
}

/** Advance in 10 ms frames from the game's last host time to `t` (real play always has frames). */
export function to(g: Game, t: number): Game {
  let now = (g as unknown as { lastHostTime: number }).lastHostTime;
  while (now < t) {
    now = Math.min(t, now + 10);
    g.advance(now);
  }
  return g;
}

export function live(g: Game) {
  return g.targets.filter((t) => t.enabled);
}

/** Radius in px for a size value at a field width, computed here independently of the engine. */
export const expectedRadius = (value: number, width: number): number => Math.round(width * (0.00199 * value + 0.001) * 1000) / 1000;
