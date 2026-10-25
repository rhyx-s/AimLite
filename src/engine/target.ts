import type { Rng } from './rng';
import type { DirectionRule, FieldGeometry, ModeConfig, SpeedSizeRule } from './types';

/** Why a target is (re)activated: decides which on-hit / on-loss movement rules apply. */
export type ActivateReason = 'start' | 'hit' | 'loss';

let nextTargetId = 0;

/**
 * One target's state. Pure data + rules; the Game owns time, scheduling and scoring.
 * Positions are CSS px in field space; the centre sits on a half pixel (x + 0.5) as in the source.
 */
export class Target {
  readonly id: number;
  /** Index in the game's target list (stable, used for "the first target" radius sharing). */
  readonly index: number;
  x = 0;
  y = 0;
  r = 0;
  rMin: number;
  rMax: number;
  grow = true;
  enabled = false;
  damage = 0;
  lifePoints = 0;
  spawnAt = 0;
  /** Engine time the cursor entered the target, or null when outside. */
  overAt: number | null = null;
  hovered = false;
  /** Tracking-mode visual: the target is being tracked right now. */
  tracked = false;
  pendingActivation: number | null = null;
  // movement
  vx = 0;
  vy = 0;
  ax = 0;
  ay = 0;
  spinVx = 0;
  spinVy = 0;
  angle = 0;
  movingRadius = 0;
  angleStep = 0;
  strafeXPending = false;
  strafeYPending = false;

  constructor(
    index: number,
    private readonly cfg: ModeConfig,
    private readonly field: FieldGeometry,
    private readonly rng: Rng,
    bounds: { min: number; max: number },
  ) {
    this.id = nextTargetId++;
    this.index = index;
    this.rMin = bounds.min;
    this.rMax = bounds.max;
    if (cfg.enableMoving) {
      this.angle = cfg.synchRotation ? 0 : Math.PI * rng.next();
      this.movingRadius = cfg.randomizeMovingRadius ? rng.next() * cfg.movingRadius : cfg.movingRadius;
      this.angleStep = cfg.randomizeRotateDirection ? (rng.coin() ? cfg.angularVelocity : -cfg.angularVelocity) : cfg.angularVelocity;
      this.setSpeed();
      if (cfg.allowRandomizeDirectionX) this.randomizeSpeedDirX();
      if (cfg.allowRandomizeDirectionY) this.randomizeSpeedDirY();
      if (cfg.allowRandomizeSpeedSizeX) this.randomizeSpeedSizeX();
      if (cfg.allowRandomizeSpeedSizeY) this.randomizeSpeedSizeY();
      this.ax = cfg.accelX;
      this.ay = cfg.accelY;
      if (cfg.allowRandomizeAccelDirectionX && rng.coin()) this.ax = -this.ax;
      if (cfg.allowRandomizeAccelDirectionY && rng.coin()) this.ay = -this.ay;
      if (cfg.allowRandomizeAccelSizeX) this.randomizeAccelSizeX();
      if (cfg.allowRandomizeAccelSizeY) this.randomizeAccelSizeY();
    }
    this.r = this.radiusForStart();
  }

  /** Shrink-only pulses start big; everything else starts at the minimum. */
  radiusForStart(): number {
    return this.cfg.animationDecrease && !this.cfg.animationIncrease ? this.rMax : this.rMin;
  }

  /** Move to a new spawn point and reset the pulse. */
  changePos(): void {
    this.r = this.radiusForStart();
    this.grow = true;
    const { width: W, height: H } = this.field;
    if (this.cfg.randomTargetPosition) {
      let x: number;
      let y: number;
      if (this.cfg.strictInside) {
        const pulses = this.cfg.animationSpeed !== 0 && (this.cfg.animationIncrease || this.cfg.animationDecrease);
        const e = pulses ? this.rMax : this.rMin;
        x = Math.round(this.rng.next() * (W - 2 * e) + e);
        y = Math.round(this.rng.next() * (H - 2 * e) + e);
      } else {
        x = Math.round(this.rng.next() * W);
        y = Math.round(this.rng.next() * H);
      }
      this.x = x + 0.5;
      this.y = y + 0.5;
    } else {
      this.x = Math.round(W / 2) + 0.5;
      this.y = Math.round(H / 2) + 0.5;
    }
  }

  /** Movement rules applied when the target comes back after a hit or a loss. */
  applyRespawnRules(reason: 'hit' | 'loss'): void {
    const c = this.cfg;
    const hit = reason === 'hit';
    if (hit ? c.randomizeAccelSizeOnHitX : c.randomizeAccelSizeOnLossX) this.randomizeAccelSizeX();
    if (hit ? c.randomizeAccelSizeOnHitY : c.randomizeAccelSizeOnLossY) this.randomizeAccelSizeY();
    this.applyDirection(hit ? c.directionOnHitX : c.directionOnLossX, 'x');
    this.applyDirection(hit ? c.directionOnHitY : c.directionOnLossY, 'y');
    this.applySpeedSize(hit ? c.speedSizeOnHitX : c.speedSizeOnLossX, 'x');
    this.applySpeedSize(hit ? c.speedSizeOnHitY : c.speedSizeOnLossY, 'y');
    this.applyAccelDirection(hit ? c.accelDirectionOnHitX : c.accelDirectionOnLossX, 'x');
    this.applyAccelDirection(hit ? c.accelDirectionOnHitY : c.accelDirectionOnLossY, 'y');
    if (hit ? c.resetSpeedOnHit : c.resetSpeedOnLoss) {
      this.setSpeed();
      if (c.allowRandomizeDirectionX) this.randomizeSpeedDirX();
      if (c.allowRandomizeDirectionY) this.randomizeSpeedDirY();
    }
  }

  private applyDirection(rule: DirectionRule, axis: 'x' | 'y'): void {
    if (rule === 2) {
      if (axis === 'x') this.vx = -this.vx;
      else this.vy = -this.vy;
    } else if (rule === 1) {
      if (axis === 'x') this.randomizeSpeedDirX();
      else this.randomizeSpeedDirY();
    }
  }

  private applySpeedSize(rule: SpeedSizeRule, axis: 'x' | 'y'): void {
    if (rule === 1) {
      if (axis === 'x') this.randomizeSpeedSizeX();
      else this.randomizeSpeedSizeY();
    } else if (rule === 2) {
      // Step away from zero by speedStep, keeping the sign; a step past zero clamps to 0 (source rule).
      if (axis === 'x') this.vx = stepSpeed(this.vx, this.cfg.speedStepX);
      else this.vy = stepSpeed(this.vy, this.cfg.speedStepY);
    }
  }

  /** Rule 2 reverses both axes' acceleration (the source's reverseAccelDirection does both). */
  private applyAccelDirection(rule: DirectionRule, axis: 'x' | 'y'): void {
    if (rule === 2) {
      this.ax = -this.ax;
      this.ay = -this.ay;
    } else if (rule === 1) {
      if (axis === 'x') {
        if (this.rng.coin()) this.ax = -this.ax;
      } else if (this.rng.coin()) this.ay = -this.ay;
    }
  }

  setSpeed(): void {
    this.vx = this.cfg.speedX;
    this.vy = this.cfg.speedY;
  }
  private randomizeSpeedDirX(): void {
    if (this.rng.coin()) this.vx = -this.vx;
  }
  private randomizeSpeedDirY(): void {
    if (this.rng.coin()) this.vy = -this.vy;
  }
  private randomizeSpeedSizeX(): void {
    const a = this.rng.next() * this.cfg.speedX;
    this.vx = this.vx > 0 ? a : -a;
  }
  private randomizeSpeedSizeY(): void {
    const a = this.rng.next() * this.cfg.speedY;
    this.vy = this.vy > 0 ? a : -a;
  }
  private randomizeAccelSizeX(): void {
    const a = this.rng.next() * this.cfg.accelX;
    this.ax = this.ax > 0 ? a : -a;
  }
  private randomizeAccelSizeY(): void {
    const a = this.rng.next() * this.cfg.accelY;
    this.ay = this.ay > 0 ? a : -a;
  }

  /** Change the radius bounds by `delta` px (floors: max 6 px, min 4 px). */
  changeRadius(delta: number, immediate: boolean): void {
    this.rMax = Math.max(6, +(this.rMax + delta).toFixed(3));
    this.rMin = Math.max(4, +(this.rMin + delta).toFixed(3));
    if (immediate) this.r = this.radiusForStart();
  }

  contains(px: number, py: number, inset: number): boolean {
    return Math.hypot(px - this.x, py - this.y) < this.r - inset;
  }
}

function stepSpeed(v: number, step: number): number {
  if (v > 0) {
    const n = v + step;
    return n < 0 ? 0 : n;
  }
  const n = v - step;
  return n > 0 ? 0 : n;
}
