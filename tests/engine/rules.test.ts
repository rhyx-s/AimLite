import { describe, expect, it } from 'vitest';
import { animationCoeff, classicField, radiusPx, targetLifeMs, TICK_MS } from '../../src/engine/geometry';
import { calcEff, calcPrecision, distanceBonus, effBonus, precisionBonus, reactionBonus } from '../../src/engine/metrics';
import { summarize } from '../../src/engine/summary';
import { runIsValid } from '../../src/schemas/app';
import { base, expectedRadius, FIELD, live, preset, run, start, to } from './helpers';

describe('geometry', () => {
  it('scales radius with field width (0.001 + 0.00199 × size)', () => {
    expect(radiusPx(15, 800)).toBeCloseTo(24.68, 3);
    expect(radiusPx(1, 800)).toBeCloseTo(2.392, 3);
    expect(radiusPx(20, 1056)).toBeCloseTo(43.085, 3);
  });
  it('pulse coefficient: speed 15 → 0.985, 0 → 1 (no pulse), clamped', () => {
    expect(animationCoeff(15)).toBeCloseTo(0.985, 10);
    expect(animationCoeff(0)).toBe(1);
    expect(animationCoeff(250)).toBeCloseTo(0.9, 10);
  });
  it('target life: grow+shrink pulse ≈ 2 × ln(max/min)/ln(1/k) ticks; static = 750 ms; override wins', () => {
    const ea = preset('official:pinpoint-pulse');
    const ticks = Math.log(24.68 / 2.392) / Math.log(1 / 0.985);
    const approx = (2 * ticks * 1000) / 61;
    expect(Math.abs(targetLifeMs(ea, 800) - approx)).toBeLessThan(2 * TICK_MS * 2);
    expect(targetLifeMs(base(), 800)).toBe(750);
    expect(targetLifeMs(base({ targetLifeTime: 800 }), 800)).toBe(800);
  });
  it('classic field = 55 % of screen width, clamped 600–1056, height × ratio', () => {
    expect(classicField(1920, 0.62)).toEqual({ width: 1056, height: 655 });
    expect(classicField(1366, 0.62)).toEqual({ width: 751, height: 466 });
    expect(classicField(800, 0.62)).toEqual({ width: 600, height: 372 });
  });
});

describe('per-hit metrics', () => {
  it('precision: centre and ≤1 px are 100, half radius is 50, outside floors at 0', () => {
    expect(calcPrecision(100, 100, 20, 100, 100)).toBe(100);
    expect(calcPrecision(100, 100, 20, 101, 100)).toBe(100);
    expect(calcPrecision(100, 100, 20, 110, 100)).toBe(50);
    expect(calcPrecision(100, 100, 20, 130, 100)).toBe(0);
  });
  it('bonus thresholds', () => {
    const c = base({ bonusProcPrecision: 50, bonusProcEff: 100, bonusProcReaction: 100, bonusProcDistance: 200 });
    expect(precisionBonus(c, 100)).toBe(50);
    expect(precisionBonus(c, 49)).toBe(25); // round(24.5) = 25 (half up)
    expect(effBonus(c, 80)).toBe(0);
    expect(effBonus(c, 79)).toBe(0);
    expect(effBonus(c, 90)).toBe(50);
    expect(effBonus(c, 100)).toBe(100);
    expect(reactionBonus(c, 159, 750)).toBe(100);
    expect(reactionBonus(c, 160, 750)).toBe(100);
    expect(reactionBonus(c, 455, 750)).toBe(50);
    expect(reactionBonus(c, 750, 750)).toBe(0);
    expect(reactionBonus(c, 751, 750)).toBe(0);
    expect(distanceBonus(c, 400, 800)).toBe(100);
  });
  it('trajectory: first hit 0, no movement 100, capped at 100', () => {
    expect(calcEff(0, 100, 100)).toBe(0);
    expect(calcEff(1, 100, 0)).toBe(100);
    expect(calcEff(1, 100, 125)).toBe(80);
    expect(calcEff(1, 120, 100)).toBe(100);
  });
});

describe('hit adjudication', () => {
  it('strict radius boundary: distance must be < r − 0.25', () => {
    const r = expectedRadius(20, FIELD.width);
    const g = start(base());
    const t = live(g)[0]!;
    expect(t.r).toBeCloseTo(r, 6);
    expect(g.pointerDown(10, t.x + (r - 0.25 + 1e-6), t.y)).toBe('miss');
    const g2 = start(base());
    const t2 = live(g2)[0]!;
    expect(g2.pointerDown(10, t2.x + (r - 0.26), t2.y)).toBe('hit');
  });

  it('a hit and a miss score +100 / −50 and are logged with their engine time', () => {
    const g = start(base());
    const t = live(g)[0]!;
    to(g, 100).pointerDown(100, t.x, t.y);
    to(g, 150).pointerDown(150, 1, 1);
    expect(g.score).toBe(50);
    expect(g.hits[0]!.t).toBe(100);
    expect(g.misses[0]!.t).toBe(150);
    expect(g.scoreLog.map((p) => p.v)).toEqual([100, 50]);
  });

  it('first-hit exclusions: aiming, distance, path and trajectory start at the 2nd hit', () => {
    const g = start(base());
    let t = live(g)[0]!;
    to(g, 200).pointerDown(200, t.x, t.y);
    expect(g.hits[0]!.eff).toBe(0);
    expect(g.agg.aiming.n).toBe(0);
    expect(g.agg.eff.n).toBe(0);
    expect(g.agg.reaction.n).toBe(1);
    to(g, 300);
    t = live(g)[0]!;
    to(g, 350).pointerMove(350, t.x, t.y);
    to(g, 400).pointerDown(400, t.x, t.y);
    expect(g.agg.aiming.n).toBe(1);
    expect(g.hits[1]!.aimingTime).toBe(200);
    expect(g.hits[1]!.minDist).toBe(Math.round(Math.hypot(t.x - g.hits[0]!.mouseX, t.y - g.hits[0]!.mouseY)));
  });

  it('legacy policy rounds each path segment; precise does not', () => {
    const mk = (policy: 'legacy-v1' | 'precise-v1') => {
      const g = start(base(), { inputPolicy: policy });
      const t = live(g)[0]!;
      const { x, y } = t; // the target respawns after the hit
      g.pointerDown(10, x, y);
      for (let i = 1; i <= 10; i++) g.pointerMove(10 + i, x + i * 0.4, y);
      return g;
    };
    const legacy = mk('legacy-v1');
    const precise = mk('precise-v1');
    // segments of 0.4 px round to 0 in legacy: path 0; precise sums to 4 px
    expect((legacy as unknown as { traceDist: number }).traceDist).toBe(0);
    expect((precise as unknown as { traceDist: number }).traceDist).toBeCloseTo(4, 6);
  });

  it('checkpoint: a click is blocked until the hub is touched, and the hub resets after each hit outside it', () => {
    const g = start(base({ useCheckpoint: true, checkpointSize: 15, targetDelay: 0 }));
    const cp = g.checkpoint!;
    expect(cp.radius).toBe(16);
    expect(cp.x).toBeCloseTo(16 + 0.5 * (FIELD.width - 32), 6);
    let t = live(g)[0]!;
    expect(g.pointerDown(10, t.x, t.y)).toBe('blocked');
    expect(g.hits.length + g.misses.length).toBe(0);
    g.pointerMove(20, cp.x, cp.y);
    expect(cp.touched).toBe(true);
    g.pointerMove(30, t.x, t.y);
    expect(g.pointerDown(40, t.x, t.y)).toBe('hit');
    expect(cp.touched).toBe(false);
    g.advance(60);
    t = live(g)[0]!;
    expect(g.pointerDown(70, t.x, t.y)).toBe('blocked');
  });

  it('moving targets are judged at their last simulated (displayed) position, not an interpolated one', () => {
    const cfg = base({ enableMoving: true, speedX: 5, speedY: 0, randomTargetPosition: false });
    const g = start(cfg);
    const t = live(g)[0]!;
    const x0 = t.x;
    const n = 3;
    g.advance(n * TICK_MS + 0.1);
    expect(t.x).toBeCloseTo(x0 + 5 * n, 6);
    // 5 ms later (between ticks) the target has not moved in the simulation
    const r = t.r;
    expect(g.pointerDown(n * TICK_MS + 5, x0 + 5 * n - (r - 0.5), t.y)).toBe('hit');
    const g2 = start(cfg);
    g2.advance(n * TICK_MS + 0.1);
    const t2 = live(g2)[0]!;
    // where it will be after the next tick, but outside it now → miss
    expect(g2.pointerDown(n * TICK_MS + 5, t2.x + 5 + (r - 0.3), t2.y)).toBe('miss');
  });
});

describe('scoring modes', () => {
  it('grouped sets score once per set', () => {
    const cfg = { ...preset('official:pair-sweep'), bonusProcEff: 0, bonusProcDistance: 0, animationSpeed: 0, targetDelay: 0 };
    const g = start(cfg);
    const [a, b] = live(g);
    g.pointerDown(100, a!.x, a!.y);
    expect(g.score).toBe(0);
    expect(g.multiHits.length).toBe(0);
    g.pointerDown(200, b!.x, b!.y);
    expect(g.multiHits.length).toBe(1);
    expect(g.score).toBe(100);
    expect(g.multiHits[0]!.reactionTime).toBe(200);
    // the set respawns together
    g.advance(250);
    expect(live(g).length).toBe(2);
  });

  it('tracking score is a function of simulation time, not render rate', () => {
    const cfg = base({ scoreMode: 1, radiusMin: 60, radiusMax: 60, randomTargetPosition: false, ggTimer: 100 });
    const scores = [1000 / 30, 1000 / 60, 1000 / 144, 1000 / 240, 7.3].map((frame) => {
      const g = start(cfg);
      const t = live(g)[0]!;
      g.pointerMove(0, t.x, t.y);
      run(g, 1500, frame);
      return g.score;
    });
    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).toBe(Math.floor(1500 / TICK_MS)); // 91 ticks
  });

  it('moving-target tracking is identical across frame schedules', () => {
    const cfg = { ...preset('official:chase-steady') };
    const outcome = (frame: number) => {
      const g = start(cfg, { seed: 7 });
      let t = 0;
      let nextInput = 50;
      while (t < 3000) {
        t = Math.min(3000, t + frame);
        // a cursor that samples the target every 50 ms of host time, delivered at exact times
        while (nextInput <= t) {
          g.advance(nextInput);
          const tg = live(g)[0];
          if (tg) g.pointerMove(nextInput, tg.x + 3, tg.y);
          nextInput += 50;
        }
        g.advance(t);
      }
      return { score: g.score, x: live(g)[0]!.x };
    };
    const a = outcome(1000 / 60);
    expect(outcome(1000 / 144)).toEqual(a);
    expect(outcome(1000 / 240)).toEqual(a);
    expect(outcome(11.3)).toEqual(a);
  });

  it('target expiry is a loss at the first tick past its life', () => {
    const g = start(base({ targetLifeTime: 800, spLoss: 30 }));
    run(g, 900);
    expect(g.losses.length).toBe(1);
    const k = Math.ceil(800 / TICK_MS);
    expect(g.losses[0]!.t).toBeCloseTo(k * TICK_MS, 6);
    expect(g.score).toBe(-30);
  });

  it('reaction mode: early clicks add a second to the attempt; score is the running average', () => {
    const cfg = { ...preset('official:wait-click'), targetDelay: 1000, targetDelayRandom: false };
    const g = start(cfg);
    to(g, 500).pointerDown(500, 5, 5); // false start
    expect(g.penaltySeconds).toBe(1);
    to(g, 1000);
    const t = live(g)[0]!;
    expect(t.spawnAt).toBe(1000);
    to(g, 1300).pointerDown(1300, t.x, t.y);
    expect(g.attempts[0]).toEqual({ time: 1.3, penalty: 1 });
    expect(g.score).toBeCloseTo(1.3, 6);
    to(g, 2300);
    const t2 = live(g)[0]!;
    to(g, 2500).pointerDown(2500, t2.x, t2.y);
    expect(g.score).toBeCloseTo(0.75, 6);
  });

  it('reaction mode random delay adds 3 s to every non-zero delay', () => {
    const cfg = { ...preset('official:wait-click') };
    const g = start(cfg, { seed: 1 });
    run(g, 2999);
    expect(live(g).length).toBe(0);
  });

  it('stopwatch: finish time plus miss penalties, lower is better', () => {
    const cfg = base({ scoreMode: 2, ggTimer: 0, ggHits: 3, targetsOnStart: 3, maxTargets: 3, oneTimeTargets: true, spMissPenalty: 1 });
    const g = start(cfg);
    to(g, 100).pointerDown(100, 1, 1);
    const ts = live(g).map((t) => ({ x: t.x, y: t.y }));
    to(g, 400).pointerDown(400, ts[0]!.x, ts[0]!.y);
    to(g, 800).pointerDown(800, ts[1]!.x, ts[1]!.y);
    to(g, 1250).pointerDown(1250, ts[2]!.x, ts[2]!.y);
    expect(g.state).toBe('over');
    expect(g.endReason).toBe('hits');
    expect(g.score).toBeCloseTo(2.25, 9);
    expect(summarize(g).direction).toBe('lower');
  });

  it('hits-to-kill needs several clicks; damage is neither hit nor miss', () => {
    const g = start(base({ hitsToKill: 3 }));
    const t = live(g)[0]!;
    expect(g.pointerDown(10, t.x, t.y)).toBe('damage');
    expect(g.pointerDown(20, t.x, t.y)).toBe('damage');
    expect(g.pointerDown(30, t.x, t.y)).toBe('hit');
    expect(g.misses.length).toBe(0);
  });

  it('switch tracking: ticks on target break it and it respawns elsewhere', () => {
    const cfg = { ...preset('official:chase-switch'), enableMoving: false };
    const g = start(cfg);
    const t = live(g)[0]!;
    const x0 = t.x;
    g.pointerMove(0, t.x, t.y);
    run(g, 40 * TICK_MS + 1);
    expect(g.hits.length).toBe(1);
    expect(g.hits[0]!.byTracking).toBe(true);
    expect(g.score).toBe(40);
    run(g, 60 * TICK_MS, 1000 / 60, 40 * TICK_MS + 1);
    expect(live(g)[0]!.x).not.toBe(x0);
  });
});

describe('end conditions and lifecycle', () => {
  it('timer ends the run at its limit; the second timer wins a tie with input at the same instant', () => {
    const g = start(base({ ggTimer: 1 }));
    const t = live(g)[0]!;
    to(g, 995);
    g.pointerDown(1000, t.x, t.y);
    expect(g.state).toBe('over');
    expect(g.endReason).toBe('timer');
    expect(g.hits.length).toBe(0);
    expect(g.durationMs).toBe(1000);
  });

  it('simultaneous conditions on one click: perfect-hit count is checked before the hit count', () => {
    const g = start(base({ ggHits: 1, ggApples: 1 }));
    const t = live(g)[0]!;
    g.pointerDown(50, t.x, t.y);
    expect(g.endReason).toBe('apples');
  });

  it('sudden death ends on the first miss', () => {
    const g = start(preset('official:pinpoint-sudden-death'));
    g.pointerDown(30, 2, 2);
    expect(g.state).toBe('over');
    expect(g.endReason).toBe('misses');
  });

  it('Space ends a run only when the mode allows it', () => {
    const a = start(base());
    a.space(10);
    expect(a.state).toBe('playing');
    const b = start(base({ ggSpace: true }));
    b.space(10);
    expect(b.state).toBe('over');
    expect(b.endReason).toBe('space');
  });

  it('cancel clears pending work; nothing changes afterwards; the run is invalid', () => {
    const g = start(base({ targetDelay: 500 }));
    to(g, 510);
    const t = live(g)[0]!;
    g.pointerDown(510, t.x, t.y);
    g.cancel('user');
    const snapshot = JSON.stringify(summarize(g));
    run(g, 5000, 1000 / 60, 510);
    g.pointerDown(5000, 1, 1);
    expect(JSON.stringify(summarize(g))).toBe(snapshot);
    expect(live(g).length).toBe(0);
    const s = summarize(g);
    expect(s.status).toBe('cancelled');
    expect(runIsValid(s)).toBe(false);
  });

  it('a stalled update (>250 ms gap) cancels instead of catching up unseen', () => {
    const g = start(base({ scoreMode: 1, ggTimer: 100 }));
    g.advance(100);
    g.advance(500);
    expect(g.state).toBe('cancelled');
    expect(g.cancelReason).toBe('stall');
  });

  it('click-rate guard cancels on 26 clicks inside 2 s, and is optional', () => {
    const on = start(base(), { clickRateGuard: true });
    const off = start(base(), { clickRateGuard: false });
    for (let i = 0; i < 26; i++) {
      on.pointerDown(i * 50, 1, 1);
      off.pointerDown(i * 50, 1, 1);
      on.advance(i * 50);
      off.advance(i * 50);
    }
    expect(on.cancelReason).toBe('click-rate');
    expect(off.state).toBe('playing');
  });

  it('countdown: no play before it ends, events per second', () => {
    const g = start(base(), { countdownSeconds: 3 });
    expect(g.state).toBe('countdown');
    g.advance(1500);
    g.advance(2500);
    expect(g.takeEvents().filter((e) => e.type === 'countdown').map((e) => (e as { n: number }).n)).toEqual([3, 2, 1]);
    g.advance(3000);
    expect(g.state).toBe('playing');
  });
});

describe('determinism', () => {
  const script = (seed: number) => {
    const g = start(preset('official:orbit-chaos'), { seed });
    const pos: number[] = [];
    for (let t = 16; t < 4000; t += 16) {
      g.advance(t);
      const tg = live(g)[0];
      if (tg && t % 400 === 0) g.pointerDown(t, tg.x, tg.y);
      if (t % 200 === 0) pos.push(...g.targets.map((x) => Math.round(x.x * 1000)));
    }
    return { pos, s: JSON.stringify(summarize(g)) };
  };
  it('same seed + same inputs → identical run; another seed differs', () => {
    expect(script(5)).toEqual(script(5));
    expect(script(5).pos).not.toEqual(script(6).pos);
  });
});
