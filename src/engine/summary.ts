import type { Game, Point } from './game';
import type { Agg } from './metrics';

export interface AggSummary { avg: number | null; min: number | null; max: number | null; n: number; }

/** Everything the results screen and history need, as plain finite JSON (null = not applicable). */
export interface RunSummary {
  score: number;
  scoreMode: 0 | 1 | 2 | 3;
  direction: 'higher' | 'lower';
  status: 'completed' | 'cancelled';
  endReason: string | null;
  cancelReason: string | null;
  durationMs: number;
  hits: number;
  multiHits: number;
  misses: number;
  losses: number;
  targetsSpawned: number;
  /** Hit rate: hits ÷ (hits + misses). Distinct from centre precision. Null without clicks. */
  hitRate: number | null;
  perfectHits: number;
  comboMax: number;
  trackingSeconds: number;
  penaltySeconds: number;
  missPoints: number;
  lossPoints: number;
  bonusTotals: { precision: number; reaction: number; eff: number; distance: number };
  reaction: AggSummary;
  aiming: AggSummary;
  capture: AggSummary;
  precision: AggSummary;
  eff: AggSummary;
  distance: AggSummary & { total: number };
  path: AggSummary & { total: number };
  speed: AggSummary;
  hpm: AggSummary;
  radius: AggSummary;
  attempts: { time: number; penalty: number }[];
  input: { moves: number; duplicates: number; stale: number; downs: number };
}

/** Raw time series for graphs and replay. Values are copied, never converted in place. */
export interface RunSeries {
  score: Point[];
  spawns: Point[];
  hits: { t: number; x: number; y: number; radius: number; mouseX: number; mouseY: number; reaction: number; aiming: number; precision: number; eff: number; minDist: number; traceDist: number; byTracking: boolean }[];
  multiHits: { t: number; reaction: number; eff: number; distance: number }[];
  misses: { t: number; x: number; y: number }[];
  losses: { t: number; x: number; y: number }[];
  bonuses: Record<'precision' | 'reaction' | 'eff' | 'distance', Point[]>;
  /** Flat [t, x, y, …] cursor samples; `stride` > 1 means they were decimated. */
  samples: number[];
  stride: number;
  field: { width: number; height: number };
  checkpoint: { x: number; y: number; radius: number } | null;
}

const agg = (a: Agg): AggSummary => a.toJSON();

export function summarize(g: Game): RunSummary {
  const clicks = g.hits.filter((h) => !h.byTracking).length + g.misses.length;
  const hitCount = g.hits.filter((h) => !h.byTracking).length;
  const c = g.cfg;
  const tot = (a: Agg): number => Math.round(a.sum);
  return {
    score: finite(g.cfg.scoreMode === 2 ? (g.state === 'over' ? g.score : g.durationMs / 1000 + g.penaltySeconds) : g.score),
    scoreMode: c.scoreMode,
    direction: g.scoreDirection,
    status: g.state === 'over' ? 'completed' : 'cancelled',
    endReason: g.endReason,
    cancelReason: g.cancelReason,
    durationMs: Math.round(g.durationMs),
    hits: g.hits.length,
    multiHits: g.multiHits.length,
    misses: g.misses.length,
    losses: g.losses.length,
    targetsSpawned: g.targetTotal,
    hitRate: clicks > 0 ? hitCount / clicks : null,
    perfectHits: g.apples,
    comboMax: g.comboMax,
    trackingSeconds: Math.round((g.trackingTicks / 61) * 1000) / 1000,
    penaltySeconds: g.penaltySeconds,
    missPoints: c.scoreMode === 0 ? g.misses.length * c.spMiss : 0,
    lossPoints: c.scoreMode === 0 && !c.disableLosses ? g.losses.length * c.spLoss : 0,
    bonusTotals: { precision: tot(g.bonus.precision), reaction: tot(g.bonus.reaction), eff: tot(g.bonus.eff), distance: tot(g.bonus.distance) },
    reaction: agg(g.agg.reaction),
    aiming: agg(g.agg.aiming),
    capture: agg(g.agg.capture),
    precision: agg(g.agg.precision),
    eff: agg(g.agg.eff),
    distance: { ...agg(g.agg.distance), total: tot(g.agg.distance) },
    path: { ...agg(g.agg.path), total: tot(g.agg.path) },
    speed: agg(g.agg.speed),
    hpm: agg(g.agg.hpm),
    radius: agg(g.agg.radius),
    attempts: g.attempts.map((a) => ({ ...a })),
    input: { ...g.input },
  };
}

export function series(g: Game): RunSeries {
  return {
    score: g.scoreLog.map((p) => ({ ...p })),
    spawns: g.targetSpawns.map((p) => ({ ...p })),
    hits: g.hits.map((h) => ({
      t: h.t, x: h.x, y: h.y, radius: h.radius, mouseX: h.mouseX, mouseY: h.mouseY, reaction: h.reactionTime,
      aiming: h.aimingTime, precision: h.precision, eff: h.eff, minDist: h.minDist, traceDist: h.traceDist, byTracking: h.byTracking,
    })),
    multiHits: g.multiHits.map((m) => ({ t: m.t, reaction: m.reactionTime, eff: m.eff, distance: m.distance })),
    misses: g.misses.map((m) => ({ t: m.t, x: m.x, y: m.y })),
    losses: g.losses.map((l) => ({ t: l.t, x: l.x, y: l.y })),
    bonuses: {
      precision: g.bonusSeries.precision.map((p) => ({ ...p })),
      reaction: g.bonusSeries.reaction.map((p) => ({ ...p })),
      eff: g.bonusSeries.eff.map((p) => ({ ...p })),
      distance: g.bonusSeries.distance.map((p) => ({ ...p })),
    },
    samples: g.samples.slice(),
    stride: g.sampleStride,
    field: { ...g.field },
    checkpoint: g.checkpoint ? { x: g.checkpoint.x, y: g.checkpoint.y, radius: g.checkpoint.radius } : null,
  };
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
