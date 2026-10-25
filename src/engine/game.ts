// The AimLite training engine. DOM-free and deterministic: time is passed in, randomness comes from
// a seeded Rng, and render rate never touches state. See docs/ENGINE.md for the time model.
import { animationCoeff, radiusBounds, SIM_HZ, targetLifeMs, TICK_MS } from './geometry';
import {
  Agg, calcEff, calcPrecision, distanceBonus, effBonus, precisionBonus, reactionBonus,
  type HitRecord, type MultiHitRecord,
} from './metrics';
import { Rng } from './rng';
import { Target, type ActivateReason } from './target';
import type { CancelReason, EndReason, EngineOptions, FieldGeometry, GameState, ModeConfig } from './types';

export const ENGINE_VERSION = 'aimlite-engine-1';
/** A gap longer than this between engine updates while playing cancels the run (no unseen catch-up). */
export const STALL_MS = 250;
/** Replay sample cap; past it the stored path is decimated 2:1 (summaries are unaffected). */
export const MAX_REPLAY_SAMPLES = 24000;
const CLICK_GUARD_COUNT = 25;
const CLICK_GUARD_MS = 2000;

export type GameEvent =
  | { type: 'countdown'; n: number }
  | { type: 'start' }
  | { type: 'hit'; t: number; precision: number }
  | { type: 'damage'; t: number }
  | { type: 'miss'; t: number }
  | { type: 'loss'; t: number }
  | { type: 'checkpoint-touch' }
  | { type: 'checkpoint-shake' }
  | { type: 'last-ten'; secondsLeft: number }
  | { type: 'end'; reason: EndReason }
  | { type: 'cancel'; reason: CancelReason };

export interface MissRecord { t: number; x: number; y: number; num: number; }
export interface LossRecord { t: number; x: number; y: number; num: number; }
export interface Point { t: number; v: number; }

interface Scheduled {
  at: number;
  seq: number;
  run: () => void;
  cancelled: boolean;
}

export interface Checkpoint { x: number; y: number; radius: number; touched: boolean; shakeUntil: number; }

/** Precedence for things due at the same engine time: second timer, then scheduled timeouts, then the tick. */
const ORDER = { second: 0, scheduled: 1, tick: 2 } as const;

export class Game {
  readonly cfg: ModeConfig;
  readonly field: FieldGeometry;
  readonly opts: EngineOptions;
  readonly rng: Rng;
  state: GameState = 'idle';
  endReason: EndReason | null = null;
  cancelReason: CancelReason | null = null;

  /** Absolute host time (ms) when countdown began and when play started. */
  private countdownAt = 0;
  private playAt = 0;
  /** Engine time = ms since play start. */
  t = 0;
  private lastHostTime = 0;
  private ticks = 0;
  private seconds = 0;
  private countdownShown = 0;
  private queue: Scheduled[] = [];
  private seq = 0;

  targets: Target[] = [];
  checkpoint: Checkpoint | null = null;
  readonly lifeMs: number;
  animSpeed: number;
  coeff: number;
  currentSyncTargets = 0;

  // cursor
  mouseX = Number.NaN;
  mouseY = Number.NaN;
  mouseDown = false;
  private traceLast: { x: number; y: number } | null = null;
  private traceDist = 0;
  private clickTimes: number[] = [];

  // records
  hits: HitRecord[] = [];
  multiHits: MultiHitRecord[] = [];
  misses: MissRecord[] = [];
  losses: LossRecord[] = [];
  targetSpawns: Point[] = [];
  scoreLog: Point[] = [];
  attempts: { time: number; penalty: number }[] = [];
  samples: number[] = []; // flat [t, x, y, ...]
  sampleStride = 1;
  private sampleSkip = 0;
  events: GameEvent[] = [];

  // scoring state
  score = 0;
  targetTotal = 0;
  apples = 0;
  comboCur = 0;
  comboMax = 0;
  penaltySeconds = 0;
  private penaltyCur = 0;
  durationMs = 0;
  trackingTicks = 0;
  readonly agg = {
    reaction: new Agg(), aiming: new Agg(), capture: new Agg(), precision: new Agg(), eff: new Agg(),
    distance: new Agg(), path: new Agg(), speed: new Agg(), radius: new Agg(), hpm: new Agg(),
  };
  readonly bonus = { precision: new Agg(), reaction: new Agg(), eff: new Agg(), distance: new Agg() };
  readonly bonusSeries: Record<'precision' | 'reaction' | 'eff' | 'distance', Point[]> = { precision: [], reaction: [], eff: [], distance: [] };
  /** Input diagnostics. */
  readonly input = { moves: 0, duplicates: 0, stale: 0, downs: 0 };

  constructor(cfg: ModeConfig, field: FieldGeometry, opts: EngineOptions) {
    this.cfg = { ...cfg };
    if (!this.cfg.syncTarget) this.cfg.multiMode = false;
    this.field = { ...field };
    this.opts = { ...opts };
    this.rng = new Rng(opts.seed);
    this.animSpeed = cfg.animationSpeed;
    this.coeff = animationCoeff(this.animSpeed);
    this.lifeMs = targetLifeMs(this.cfg, field.width);
  }

  get scoreDirection(): 'higher' | 'lower' {
    return this.cfg.scoreMode === 2 || this.cfg.scoreMode === 3 ? 'lower' : 'higher';
  }

  /** Live score shown in the HUD (stopwatch modes show elapsed time + penalties). */
  get displayScore(): number {
    if (this.cfg.scoreMode === 2) return (this.state === 'playing' ? this.t : this.durationMs) / 1000 + this.penaltySeconds;
    return this.score;
  }

  /** Seconds left (timed modes) or elapsed, for the HUD. */
  get clockSeconds(): number {
    const limit = this.timerLimit;
    if (limit > 0) return limit - this.seconds;
    return this.t / 1000;
  }

  get timerLimit(): number {
    return this.cfg.ggTimer > 0 && this.cfg.scoreMode !== 2 ? this.cfg.ggTimer : 0;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Begin the countdown (or play directly when countdownSeconds is 0). */
  begin(hostTime: number): void {
    if (this.state !== 'idle') return;
    this.countdownAt = hostTime;
    this.lastHostTime = hostTime;
    if (this.opts.countdownSeconds > 0) {
      this.state = 'countdown';
      this.countdownShown = this.opts.countdownSeconds;
      this.events.push({ type: 'countdown', n: this.countdownShown });
      this.playAt = hostTime + this.opts.countdownSeconds * 1000;
    } else {
      this.playAt = hostTime;
      this.startPlay();
    }
  }

  private startPlay(): void {
    this.state = 'playing';
    this.t = 0;
    this.events.push({ type: 'start' });
    if (this.cfg.useCheckpoint && this.cfg.scoreMode !== 1) {
      const e = this.cfg.checkpointSize + 1;
      const f = 2 * e;
      this.checkpoint = {
        x: e + (this.cfg.checkpointPositionX * (this.field.width - f)) / 100,
        y: e + (this.cfg.checkpointPositionY * (this.field.height - f)) / 100,
        radius: e, touched: false, shakeUntil: 0,
      };
    }
    for (let i = 0; i < this.cfg.targetsOnStart; i++) this.createTarget();
    this.drain(0);
  }

  /** Advance to host time. Call once per frame and before each input. */
  advance(hostTime: number): void {
    if (this.state === 'countdown') {
      this.lastHostTime = hostTime;
      const left = Math.ceil((this.playAt - hostTime) / 1000);
      if (left < this.countdownShown && left > 0) {
        this.countdownShown = left;
        this.events.push({ type: 'countdown', n: left });
      }
      if (hostTime >= this.playAt) {
        this.startPlay();
      } else return;
    }
    if (this.state !== 'playing') return;
    if (hostTime - this.lastHostTime > STALL_MS) {
      this.cancel('stall');
      return;
    }
    this.lastHostTime = Math.max(this.lastHostTime, hostTime);
    this.drain(hostTime - this.playAt);
  }

  /** Process everything due up to engine time T, in time order (ties: second, scheduled, tick). */
  private drain(T: number): void {
    for (;;) {
      if (this.state !== 'playing') return;
      const tSecond = (this.seconds + 1) * 1000;
      const tTick = (this.ticks + 1) * TICK_MS;
      const q = this.nextScheduled();
      const tSched = q ? q.at : Infinity;
      let kind: keyof typeof ORDER = 'second';
      let at = tSecond;
      if (tSched < at || (tSched === at && ORDER.scheduled < ORDER[kind])) { kind = 'scheduled'; at = tSched; }
      if (tTick < at) { kind = 'tick'; at = tTick; }
      if (at > T) break;
      this.t = at;
      if (kind === 'second') this.onSecond();
      else if (kind === 'scheduled') { this.queue.splice(this.queue.indexOf(q!), 1); q!.run(); }
      else this.onTick();
    }
    if (this.state === 'playing' && T > this.t) this.t = T;
  }

  private nextScheduled(): Scheduled | undefined {
    if (this.queue.length > 64) this.queue = this.queue.filter((s) => !s.cancelled);
    let best: Scheduled | undefined;
    for (const s of this.queue) {
      if (s.cancelled) continue;
      if (!best || s.at < best.at || (s.at === best.at && s.seq < best.seq)) best = s;
    }
    if (!best) this.queue.length = 0;
    return best;
  }

  private schedule(delayMs: number, run: () => void): Scheduled {
    const s: Scheduled = { at: this.t + Math.max(0, delayMs), seq: this.seq++, run, cancelled: false };
    this.queue.push(s);
    return s;
  }

  private gg(reason: EndReason): void {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.endReason = reason;
    this.durationMs = this.t;
    if (this.cfg.scoreMode === 2) this.score = this.durationMs / 1000 + this.penaltySeconds;
    this.queue.length = 0;
    this.targets.forEach((tg) => { tg.enabled = false; });
    this.events.push({ type: 'end', reason });
  }

  cancel(reason: CancelReason): void {
    if (this.state !== 'playing' && this.state !== 'countdown' && this.state !== 'idle') return;
    if (this.state === 'playing') this.durationMs = this.t;
    this.state = 'cancelled';
    this.cancelReason = reason;
    this.queue.length = 0;
    this.targets.forEach((tg) => { tg.enabled = false; });
    this.events.push({ type: 'cancel', reason });
  }

  // ---------------------------------------------------------------- timers

  private onSecond(): void {
    this.seconds++;
    const c = this.cfg;
    if (c.addTargetPeriod > 0 && this.seconds % c.addTargetPeriod === 0 && this.targets.length < c.maxTargets) this.createTarget();
    if (c.animationAccel !== 0 && c.animationAccelByTime) this.changeAnimationSpeed();
    const limit = this.timerLimit;
    if (c.scoreMode === 1) this.scoreLog.push({ t: this.t, v: this.score });
    if (limit > 0 && this.seconds >= limit - 10 && this.seconds < limit) this.events.push({ type: 'last-ten', secondsLeft: limit - this.seconds });
    if (limit > 0 && this.seconds >= limit) this.gg('timer');
  }

  private onTick(): void {
    this.ticks++;
    for (const tg of this.targets) this.tickTarget(tg);
    this.updateHover();
  }

  private changeAnimationSpeed(): void {
    if (this.cfg.radiusMin === this.cfg.radiusMax) return;
    this.animSpeed = +(this.animSpeed + this.cfg.animationAccel).toFixed(1);
    this.coeff = animationCoeff(this.animSpeed);
  }

  // ---------------------------------------------------------------- targets

  private createTarget(): void {
    const c = this.cfg;
    const first = this.targets[0];
    const bounds = first && c.changeRadiusOnHit !== 0 && c.changeRadiusForAll
      ? { min: first.rMin, max: first.rMax }
      : radiusBounds(c, this.field.width);
    const tg = new Target(this.targets.length, c, this.field, this.rng, bounds);
    this.useDelay(tg, 'start');
    this.targets.push(tg);
  }

  private delayFor(): number {
    let d = this.cfg.targetDelay;
    if (this.cfg.targetDelayRandom) {
      d = Math.round(this.rng.next() * d);
      if (this.cfg.scoreMode === 3 && d > 0) d += 3000;
    }
    return d;
  }

  private useDelay(tg: Target, reason: ActivateReason): void {
    const delay = this.delayFor();
    if (this.state !== 'playing') return;
    if (this.cfg.syncTarget) {
      // `tg` may not be in the list yet (creation): it is disabled either way.
      if (!this.targets.every((o) => !o.enabled)) return;
      if (this.cfg.multiMode && reason === 'hit') this.onMultiHit(tg);
      if (this.state !== 'playing') return;
      const s = this.schedule(delay, () => {
        let n = 0;
        for (const o of this.targets) {
          n++;
          this.cancelPending(o);
          this.activate(o, reason);
        }
        this.currentSyncTargets = n;
      });
      this.cancelPending(tg);
      tg.pendingActivation = s.seq;
    } else {
      this.cancelPending(tg);
      const s = this.schedule(delay, () => { tg.pendingActivation = null; this.activate(tg, reason); });
      tg.pendingActivation = s.seq;
    }
  }

  private cancelPending(tg: Target): void {
    if (tg.pendingActivation === null) return;
    const s = this.queue.find((q) => q.seq === tg.pendingActivation);
    if (s) s.cancelled = true;
    tg.pendingActivation = null;
  }

  private activate(tg: Target, reason: ActivateReason): void {
    tg.enabled = true;
    tg.lifePoints = this.cfg.targetLifePoints;
    if (reason === 'start' || (reason === 'hit' && this.cfg.changePositionOnHit) || (reason === 'loss' && this.cfg.changePositionOnLoss)) {
      this.onChangePos();
      tg.changePos();
    }
    if (reason !== 'start' && this.cfg.enableMoving) tg.applyRespawnRules(reason);
    tg.spawnAt = this.t;
    this.updateHoverFor(tg);
  }

  private onChangePos(): void {
    if (this.cfg.scoreMode !== 3) {
      this.targetTotal++;
      this.targetSpawns.push({ t: this.t, v: this.targetTotal });
    }
    if (this.cfg.ggTargets && this.targetTotal >= this.cfg.ggTargets) this.gg('targets');
  }

  private deactivate(tg: Target): void {
    tg.enabled = false;
    tg.damage = 0;
    tg.lifePoints = 0;
    tg.tracked = false;
  }

  private loss(tg: Target): void {
    if (!this.cfg.disableLosses) {
      this.losses.push({ t: this.t, x: tg.x, y: tg.y, num: this.losses.length + 1 });
      this.comboCur = 0;
      if (this.cfg.scoreMode === 0) this.addScore(-this.cfg.spLoss);
      this.events.push({ type: 'loss', t: this.t });
      if (this.cfg.ggLosses && this.losses.length >= this.cfg.ggLosses) this.gg('losses');
    }
    this.deactivate(tg);
    this.useDelay(tg, 'loss');
  }

  private tickTarget(tg: Target): void {
    if (!tg.enabled || this.state !== 'playing') return;
    const c = this.cfg;
    if (c.targetLifeTime > 0 && this.t - tg.spawnAt >= c.targetLifeTime) {
      this.loss(tg);
      return; // deviation: the source kept updating an expired target for the rest of the tick
    }
    if (c.scoreMode === 1 && tg.hovered) {
      if (c.requireMousePressed && !this.mouseDown) {
        tg.tracked = false;
      } else {
        tg.tracked = true;
        this.score++;
        this.trackingTicks++;
        if (tg.lifePoints > 0) {
          tg.lifePoints--;
          if (tg.lifePoints <= 0) {
            tg.tracked = false;
            this.registerHit(tg, this.mouseX, this.mouseY, true);
            if (!tg.enabled) return;
          }
        }
      }
    }
    if (c.enableMoving) this.moveTarget(tg);
    this.scaleTarget(tg);
  }

  private moveTarget(tg: Target): void {
    const c = this.cfg;
    const { width: W, height: H } = this.field;
    if (c.roundMoving) {
      tg.spinVx = Math.cos(tg.angle) * tg.movingRadius;
      tg.spinVy = Math.sin(tg.angle) * tg.movingRadius;
      tg.angle -= tg.angleStep;
    }
    const nx = tg.x + tg.vx + tg.spinVx;
    const ny = tg.y + tg.vy + tg.spinVy;
    if (nx + tg.r > W || nx - tg.r < 0) {
      tg.vx = (-tg.vx * (100 - c.reboundSpeed)) / 100;
      tg.spinVx = -tg.spinVx;
      if (c.reverseAccelDirectionOnWall) tg.ax = -tg.ax;
    }
    if (ny + tg.r > H || ny - tg.r < 0) {
      tg.vy = (-tg.vy * (100 - c.reboundSpeed)) / 100;
      tg.spinVy = -tg.spinVy;
      if (c.reverseAccelDirectionOnWall) tg.ay = -tg.ay;
    }
    tg.x += tg.vx + tg.spinVx;
    tg.y += tg.vy + tg.spinVy;
    if (c.enableAccel) this.accelerate(tg);
  }

  private accelerate(tg: Target): void {
    const c = this.cfg;
    let bx = tg.vx + tg.ax;
    let by = tg.vy + tg.ay;
    if (c.maxSpeedX && Math.abs(bx) >= c.maxSpeedX) bx = bx > 0 ? c.maxSpeedX : -c.maxSpeedX;
    if (c.maxSpeedY && Math.abs(by) >= c.maxSpeedY) by = by > 0 ? c.maxSpeedY : -c.maxSpeedY;
    if (c.useStrafe) {
      if (!tg.strafeXPending) {
        tg.strafeXPending = true;
        this.schedule(this.rng.next() * c.strafeRangeX, () => {
          tg.ax = tg.vx > 0 ? -Math.abs(c.accelX) : Math.abs(c.accelX);
          tg.vx += tg.ax;
          tg.strafeXPending = false;
        });
      }
      if (!tg.strafeYPending) {
        tg.strafeYPending = true;
        this.schedule(this.rng.next() * c.strafeRangeY, () => {
          tg.ay = tg.vy > 0 ? -Math.abs(c.accelY) : Math.abs(c.accelY);
          tg.vy += tg.ay;
          tg.strafeYPending = false;
        });
      }
    }
    tg.vx = bx;
    tg.vy = by;
  }

  private scaleTarget(tg: Target): void {
    const c = this.cfg;
    if (c.radiusMin === c.radiusMax || this.coeff === 1) return;
    const k = this.coeff;
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    if (c.animationIncrease && c.animationDecrease) {
      tg.r = tg.grow ? r3(tg.r / k) : r3(tg.r * k);
      if (tg.r > tg.rMax) { tg.r = tg.rMax; tg.grow = false; }
      if (tg.r < tg.rMin) { tg.r = tg.rMin; tg.grow = true; this.loss(tg); }
    } else if (c.animationIncrease) {
      tg.r = r3(tg.r / k);
      if (tg.r > tg.rMax) { tg.r = tg.rMin; this.loss(tg); }
    } else if (c.animationDecrease) {
      tg.r = r3(tg.r * k);
      if (tg.r < tg.rMin) { tg.r = tg.rMax; this.loss(tg); }
    }
  }

  // ---------------------------------------------------------------- input

  private inField(x: number, y: number): boolean {
    return x > 0 && x < this.field.width && y > 0 && y < this.field.height;
  }

  /** Clamp an input timestamp that is older than the engine's time (already-advanced frame). */
  private inputTime(hostTime: number): number {
    if (this.state === 'playing' && hostTime - this.playAt < this.t) {
      this.input.stale++;
      return this.playAt + this.t;
    }
    return hostTime;
  }

  pointerMove(hostTime: number, x: number, y: number): void {
    const h = this.inputTime(hostTime);
    this.advance(h);
    if (x === this.mouseX && y === this.mouseY) { this.input.duplicates++; return; }
    this.input.moves++;
    this.mouseX = x;
    this.mouseY = y;
    if (this.state !== 'playing') return;
    this.recordSample(x, y);
    if (this.traceLast) {
      const seg = Math.hypot(x - this.traceLast.x, y - this.traceLast.y);
      this.traceDist += this.opts.inputPolicy === 'legacy-v1' ? Math.round(seg) : seg;
      this.traceLast = { x, y };
    }
    const cp = this.checkpoint;
    if (cp && !cp.touched && Math.hypot(x - cp.x, y - cp.y) <= cp.radius) {
      cp.touched = true;
      this.events.push({ type: 'checkpoint-touch' });
    }
    this.updateHover();
  }

  private recordSample(x: number, y: number): void {
    if (this.sampleSkip > 0) { this.sampleSkip--; return; }
    this.samples.push(Math.round(this.t * 10) / 10, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    this.sampleSkip = this.sampleStride - 1;
    if (this.samples.length >= MAX_REPLAY_SAMPLES * 3) {
      const kept: number[] = [];
      for (let i = 0; i < this.samples.length; i += 6) kept.push(this.samples[i]!, this.samples[i + 1]!, this.samples[i + 2]!);
      this.samples = kept;
      this.sampleStride *= 2;
    }
  }

  private updateHover(): void {
    for (const tg of this.targets) this.updateHoverFor(tg);
  }

  private updateHoverFor(tg: Target): void {
    const inside = tg.enabled && Number.isFinite(this.mouseX) && Math.hypot(this.mouseX - tg.x, this.mouseY - tg.y) <= tg.r;
    if (inside && !tg.hovered) { tg.hovered = true; tg.overAt = this.t; }
    else if (!inside && tg.hovered) { tg.hovered = false; tg.overAt = null; tg.tracked = false; }
  }

  /** Training-button press inside the field. Returns what happened, for the UI. */
  pointerDown(hostTime: number, x: number, y: number): 'hit' | 'miss' | 'blocked' | 'damage' | 'ignored' {
    const h = this.inputTime(hostTime);
    this.advance(h);
    this.mouseDown = true;
    if (this.state !== 'playing') return 'ignored';
    this.input.downs++;
    if (x !== this.mouseX || y !== this.mouseY) {
      this.mouseX = x;
      this.mouseY = y;
      this.updateHover();
    }
    let result: 'hit' | 'miss' | 'blocked' | 'damage' | 'ignored' = 'ignored';
    if (this.inField(x, y)) {
      result = 'miss';
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const tg = this.targets[i]!;
        if (!tg.enabled || !tg.contains(x, y, 0.25)) continue;
        const cp = this.checkpoint;
        if (!cp) {
          result = this.clickTarget(tg, x, y);
        } else if (cp.touched) {
          result = this.clickTarget(tg, x, y);
          if (Math.hypot(x - cp.x, y - cp.y) > cp.radius) cp.touched = false;
        } else {
          cp.shakeUntil = this.t + 200;
          this.events.push({ type: 'checkpoint-shake' });
          result = 'blocked';
        }
        break;
      }
      if (result === 'miss') this.registerMiss(x, y);
    }
    this.guardClicks(h);
    return result;
  }

  pointerUp(hostTime: number): void {
    this.advance(this.inputTime(hostTime));
    this.mouseDown = false;
  }

  /** Space key: ends the run when the mode allows it. */
  space(hostTime: number): void {
    this.advance(this.inputTime(hostTime));
    if (this.cfg.ggSpace) this.gg('space');
  }

  private guardClicks(hostTime: number): void {
    if (!this.opts.clickRateGuard || this.state !== 'playing') return;
    this.clickTimes.push(hostTime);
    if (this.clickTimes.length > CLICK_GUARD_COUNT) {
      this.clickTimes.shift();
      if (hostTime - this.clickTimes[0]! <= CLICK_GUARD_MS) this.cancel('click-rate');
    }
  }

  private clickTarget(tg: Target, x: number, y: number): 'hit' | 'damage' | 'ignored' {
    if (++tg.damage < this.cfg.hitsToKill) {
      this.events.push({ type: 'damage', t: this.t });
      return 'damage';
    }
    if (this.cfg.scoreMode === 1) {
      tg.damage = 0;
      return 'ignored'; // tracking modes score time on target, not clicks
    }
    this.registerHit(tg, x, y, false);
    return 'hit';
  }

  private registerMiss(x: number, y: number): void {
    if (this.cfg.scoreMode === 1) return;
    this.misses.push({ t: this.t, x, y, num: this.misses.length + 1 });
    this.comboCur = 0;
    this.events.push({ type: 'miss', t: this.t });
    switch (this.cfg.scoreMode) {
      case 0: this.addScore(-this.cfg.spMiss); break;
      case 2:
        if (this.cfg.spMissPenalty > 0) this.penaltySeconds = Math.round(10 * (this.penaltySeconds + this.cfg.spMissPenalty)) / 10;
        break;
      case 3:
        this.penaltySeconds += 1;
        this.penaltyCur += 1;
        this.logScore();
        break;
    }
    if (this.cfg.ggMisses && this.misses.length >= this.cfg.ggMisses) this.gg('misses');
  }

  private addScore(delta: number): void {
    this.score += delta;
    this.logScore();
  }

  private logScore(): void {
    this.scoreLog.push({ t: this.t, v: this.score });
  }

  // ---------------------------------------------------------------- hits & scoring

  private registerHit(tg: Target, mx: number, my: number, byTracking: boolean): void {
    const c = this.cfg;
    const index = this.hits.length;
    const prev = this.hits[index - 1];
    const now = this.t;
    let captureTime = tg.overAt === null ? 0 : now - tg.overAt;
    if (captureTime > 1000) captureTime = 0;
    const minDist = prev ? this.minDistFrom(prev.mouseX, prev.mouseY, mx, my) : 0;
    const traceDist = prev ? Math.round(this.traceDist * 1000) / 1000 : 0;
    const precision = calcPrecision(tg.x, tg.y, tg.r, mx, my);
    const eff = calcEff(index, minDist, traceDist);
    const aimingTime = prev ? now - prev.t : 0;
    const reactionTime = Math.max(0, now - tg.spawnAt);
    const elapsedS = now / 1000;
    const hit: HitRecord = {
      t: now, index, targetId: tg.id, x: tg.x, y: tg.y, radius: +tg.r.toFixed(1), mouseX: mx, mouseY: my,
      reactionTime, captureTime, aimingTime, precision, traceDist, minDist, eff,
      hpm: elapsedS > 0 ? Math.round((60 * (index + 1)) / elapsedS) : 0,
      reactionBonus: reactionBonus(c, reactionTime, this.lifeMs),
      precisionBonus: precisionBonus(c, precision),
      effBonus: effBonus(c, eff),
      distanceBonus: distanceBonus(c, minDist, this.field.width),
      cursorSpeed: aimingTime > 0 ? Math.round((1000 * traceDist) / aimingTime) : 0,
      combo: 0,
      byTracking,
    };
    this.hits.push(hit);
    // a new trace starts at this click
    this.traceLast = { x: mx, y: my };
    this.traceDist = 0;
    this.events.push({ type: 'hit', t: now, precision });
    this.processHit(hit);
    // target goes away (and maybe the whole set completes)
    this.deactivate(tg);
    if (!c.oneTimeTargets) this.useDelay(tg, 'hit');
    if (c.animationAccel !== 0 && c.animationAccelByHit) this.changeAnimationSpeed();
    if (c.addTargetHits > 0 && this.hits.length % c.addTargetHits === 0 && this.targets.length < c.maxTargets && !(c.syncTarget && c.multiMode)) this.createTarget();
    if (c.changeRadiusOnHit !== 0) {
      const immediate = this.animSpeed === 0;
      if (c.changeRadiusForAll) this.targets.forEach((o) => o.changeRadius(c.changeRadiusOnHit, immediate));
      else tg.changeRadius(c.changeRadiusOnHit, immediate);
    }
  }

  private minDistFrom(px: number, py: number, x: number, y: number): number {
    const cp = this.checkpoint;
    if (cp) {
      const mxm = Math.abs(x + px) / 2;
      const mym = Math.abs(y + py) / 2;
      const dm = Math.round(Math.hypot(mxm - cp.x, mym - cp.y));
      if (dm > cp.radius) {
        const k = cp.radius / dm;
        const ex = cp.x + (mxm - cp.x) * k;
        const ey = cp.y + (mym - cp.y) * k;
        return Math.round(Math.hypot(x - ex, y - ey)) + Math.round(Math.hypot(ex - px, ey - py));
      }
    }
    return Math.round(Math.hypot(x - px, y - py));
  }

  private processHit(h: HitRecord): void {
    const c = this.cfg;
    const a = this.agg;
    a.precision.add(h.precision);
    if (h.precision === 100) {
      this.apples++;
      if (c.ggApples && this.apples >= c.ggApples) this.gg('apples');
    }
    if (c.bonusProcPrecision > 0) this.addBonus('precision', h.precisionBonus, h.t);
    a.capture.add(h.captureTime);
    a.radius.add(h.radius);
    if (!c.multiMode) {
      this.addReaction(h.reactionTime, h.reactionBonus, h.t);
      if (h.index > 0) {
        a.aiming.add(h.aimingTime);
        a.distance.add(h.minDist);
        if (c.bonusProcDistance > 0) this.addBonus('distance', h.distanceBonus, h.t);
        a.path.add(h.traceDist);
        a.eff.add(h.eff);
        if (c.bonusProcEff > 0) this.addBonus('eff', h.effBonus, h.t);
        a.speed.add(h.cursorSpeed);
      }
      this.comboCur++;
      h.combo = this.comboCur;
      this.comboMax = Math.max(this.comboMax, this.comboCur);
      a.hpm.add(h.hpm);
    }
    // score
    switch (c.scoreMode) {
      case 0: {
        let g = 0;
        if (c.bonusProcPrecision > 0) g += h.precisionBonus;
        if (!c.multiMode) {
          g += c.spHit;
          if (c.bonusProcReaction > 0) g += h.reactionBonus;
          if (c.bonusProcEff > 0) g += h.effBonus;
          if (c.bonusProcDistance > 0) g += h.distanceBonus;
        }
        this.score += g;
        if (!c.multiMode) this.logScore();
        break;
      }
      case 3:
        if (!c.multiMode) { this.score = this.reactionAvgSeconds(); this.penaltyCur = 0; this.logScore(); }
        break;
      default:
        break;
    }
    if (c.ggHits && !c.multiMode && this.hits.length >= c.ggHits) this.gg('hits');
  }

  private addReaction(ms: number, bonus: number, t: number): void {
    const withPenalty = ms + 1000 * this.penaltyCur;
    if (this.cfg.scoreMode === 3) this.attempts.push({ time: +(withPenalty / 1000).toFixed(3), penalty: this.penaltyCur });
    this.agg.reaction.add(withPenalty);
    if (this.cfg.bonusProcReaction > 0) this.addBonus('reaction', bonus, t);
  }

  private reactionAvgSeconds(): number {
    return +(this.agg.reaction.avg / 1000).toFixed(4);
  }

  private addBonus(kind: 'precision' | 'reaction' | 'eff' | 'distance', v: number, t: number): void {
    this.bonus[kind].add(v);
    this.bonusSeries[kind].push({ t, v });
  }

  /** A synchronised set was fully cleared (grouped modes). */
  private onMultiHit(lastTarget: Target): void {
    const c = this.cfg;
    const n = this.currentSyncTargets;
    if (n <= 0 || this.hits.length < n) return;
    const set = this.hits.slice(this.hits.length - n);
    const first = set[0]!;
    const rest = set.slice(1);
    const e = Math.max(1, n - 1);
    let effSum = 0, minSum = 0, pathSum = 0, aimSum = 0, speedSum = 0, effB = 0, distB = 0;
    let precB = first.precisionBonus;
    let reactB = first.reactionBonus;
    for (const h of rest) {
      effSum += h.eff; minSum += h.minDist; pathSum += h.traceDist; aimSum += h.aimingTime; speedSum += h.cursorSpeed;
      if (c.bonusProcPrecision > 0) precB += h.precisionBonus;
      if (c.bonusProcReaction > 0) reactB += h.reactionBonus;
      if (c.bonusProcEff > 0) effB += h.effBonus;
      if (c.bonusProcDistance > 0) distB += h.distanceBonus;
    }
    const last = set[set.length - 1]!;
    const spanS = (last.t - first.t) / 1000;
    const reactionTime = this.t - lastTarget.spawnAt;
    const m: MultiHitRecord = {
      t: this.t, num: this.multiHits.length + 1,
      eff: Math.round((100 * effSum) / e) / 100,
      distance: Math.round(minSum / e),
      path: Math.round(pathSum / e),
      reactionTime,
      bonusPrecision: Math.round(precB / n),
      bonusReaction: Math.round(reactB / n),
      bonusEff: Math.round(effB / e),
      bonusDistance: Math.round(distB / e),
      aimingTime: Math.round(aimSum / e),
      cursorSpeed: Math.round(speedSum / e),
      hpm: spanS > 0 ? Math.round((60 * n) / spanS) : 0,
      combo: 0,
    };
    this.multiHits.push(m);
    if (c.addTargetHits > 0 && this.hits.length % c.addTargetHits === 0 && this.targets.length < c.maxTargets) this.createTarget();
    this.addReaction(m.reactionTime, m.bonusReaction, m.t);
    const a = this.agg;
    a.aiming.add(m.aimingTime);
    a.distance.add(m.distance);
    if (c.bonusProcDistance > 0) this.addBonus('distance', m.bonusDistance, m.t);
    a.path.add(m.path);
    a.eff.add(m.eff);
    if (c.bonusProcEff > 0) this.addBonus('eff', m.bonusEff, m.t);
    a.speed.add(m.cursorSpeed);
    this.comboCur++;
    m.combo = this.comboCur;
    this.comboMax = Math.max(this.comboMax, this.comboCur);
    a.hpm.add(m.hpm);
    if (c.scoreMode === 0) {
      this.score += c.spHit + m.bonusReaction + m.bonusPrecision + m.bonusEff + m.bonusDistance;
      this.logScore();
    } else if (c.scoreMode === 3) {
      this.score = this.reactionAvgSeconds();
      this.penaltyCur = 0;
      this.logScore();
    }
    if (c.ggHits && this.multiHits.length >= c.ggHits) this.gg('hits');
  }

  /** Remove and return pending UI events (sounds, banners). */
  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Tick rate as a constant for UI/diagnostics. */
  static readonly SIM_HZ = SIM_HZ;
}
