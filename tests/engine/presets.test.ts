import { describe, expect, it } from 'vitest';
import { Game } from '../../src/engine/game';
import { series, summarize } from '../../src/engine/summary';
import { comparisonKey, effectiveConfig, OFFICIAL_PRESETS } from '../../src/presets';
import sourceMap from '../../src/presets/source-map.json';
import { runIsValid } from '../../src/schemas/app';
import { validateConfig } from '../../src/schemas/preset';
import { FIELD, live, opts } from './helpers';

/** Every number in a JSON-able value is finite (no NaN / Infinity leaking into results). */
function allFinite(v: unknown, path = '$'): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => allFinite(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => allFinite(x, `${path}.${k}`));
  return [];
}

/**
 * A simple bot: tracks in tracking modes; elsewhere every 120 ms it touches the hub if needed and
 * clicks the newest live target, missing on purpose every 9th action (so miss paths run too).
 */
function playToEnd(cfg: Game['cfg'], seed: number): Game {
  const g = new Game(cfg, FIELD, opts({ seed }));
  g.begin(0);
  let t = 0;
  let next = 100;
  let actions = 0;
  const frame = 1000 / 60;
  while (g.state === 'playing' && t < 400_000) {
    t += frame;
    g.advance(t);
    if (g.state !== 'playing') break;
    const targets = live(g);
    const tg = targets[targets.length - 1];
    if (cfg.scoreMode === 1) {
      if (tg) g.pointerMove(t, tg.x, tg.y);
      continue;
    }
    if (t < next) continue;
    next = t + 120;
    actions++;
    if (actions % 9 === 0 && cfg.scoreMode !== 3) {
      g.pointerDown(t, 1.5, 1.5);
      g.pointerUp(t);
      continue;
    }
    if (!tg) continue;
    if (g.checkpoint && !g.checkpoint.touched) g.pointerMove(t, g.checkpoint.x, g.checkpoint.y);
    g.pointerMove(t, tg.x, tg.y);
    g.pointerDown(t, tg.x, tg.y);
    g.pointerUp(t);
  }
  return g;
}

describe('official presets', () => {
  it('there are 27, each mapped to its source id, each valid', () => {
    expect(OFFICIAL_PRESETS.length).toBe(27);
    const ids = new Set(sourceMap.modes.map((m) => m.sourceId));
    expect(ids.size).toBe(27);
    for (const p of OFFICIAL_PRESETS) {
      expect(sourceMap.modes.find((m) => m.id === p.id)).toBeTruthy();
      const v = validateConfig(p.config, p.name);
      expect(v.ok, `${p.id}: ${!v.ok ? v.errors.join('; ') : ''}`).toBe(true);
    }
  });

  it('are immutable', () => {
    const p = OFFICIAL_PRESETS[0]!;
    expect(() => { (p.config as { spHit: number }).spHit = 1; }).toThrow();
  });

  for (const p of OFFICIAL_PRESETS) {
    it(`${p.name} plays through the real engine to its end condition`, () => {
      const g = playToEnd(p.config, 1234);
      expect(g.state, `${p.id} did not finish`).toBe('over');
      const s = summarize(g);
      const expected: string[] = [];
      if (p.config.ggTimer > 0 && p.config.scoreMode !== 2) expected.push('timer');
      if (p.config.ggHits) expected.push('hits');
      if (p.config.ggMisses) expected.push('misses');
      if (p.config.ggLosses) expected.push('losses');
      expect(expected).toContain(s.endReason);
      // pure tracking modes score time on target and never register hits
      if (p.config.scoreMode !== 1 || p.config.targetLifePoints > 0) expect(s.hits + s.multiHits).toBeGreaterThan(0);
      else expect(s.trackingSeconds).toBeGreaterThan(0);
      expect(allFinite(s)).toEqual([]);
      expect(allFinite(series(g))).toEqual([]);
      if (p.config.scoreMode === 1) expect(s.score).toBeGreaterThan(0);
      expect(runIsValid(s)).toBe(true);
    });
  }
});

describe('comparison keys', () => {
  const p = OFFICIAL_PRESETS[0]!;
  const k = (o: Partial<Parameters<typeof comparisonKey>[1]>) =>
    comparisonKey(p, { fieldMode: 'classic', width: 1056, height: 655, inputPolicy: 'legacy-v1', practiceLevel: null, ...o });
  it('differ by field mode, size, input policy and practice level', () => {
    const a = k({});
    expect(k({})).toBe(a);
    expect(k({ fieldMode: 'large' })).not.toBe(a);
    expect(k({ width: 800, height: 496 })).not.toBe(a);
    expect(k({ inputPolicy: 'precise-v1' })).not.toBe(a);
    expect(k({ practiceLevel: 0 })).not.toBe(a);
    expect(k({ practiceLevel: 1 })).not.toBe(k({ practiceLevel: 0 }));
  });
  it('large fields scale pixel speeds and the hub; classic leaves the preset untouched', () => {
    const c = OFFICIAL_PRESETS.find((x) => x.id === 'official:chase-fast')!.config;
    expect(effectiveConfig(c, 'classic', 1056, 1056, null)).toEqual(c);
    const big = effectiveConfig(c, 'large', 2112, 1056, null);
    expect(big.accelX).toBeCloseTo(c.accelX * 2, 6);
    expect(big.radiusMin).toBe(c.radiusMin); // radius already scales with width
    const hub = OFFICIAL_PRESETS.find((x) => x.id === 'official:hub-flick')!.config;
    expect(effectiveConfig(hub, 'large', 2112, 1056, null).checkpointSize).toBe(30);
  });
  it('practice levels change size/speed only for practice runs and stay in bounds', () => {
    const c = OFFICIAL_PRESETS.find((x) => x.id === 'official:pixel-dot')!.config;
    const harder = effectiveConfig(c, 'classic', 1056, 1056, 5);
    expect(harder.radiusMin).toBeLessThan(c.radiusMin);
    expect(validateConfig(harder).ok).toBe(true);
    expect(validateConfig(effectiveConfig(c, 'classic', 1056, 1056, -5)).ok).toBe(true);
  });
});
