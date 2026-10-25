// Gameplay configuration. Field names follow the legacy config schema recovered by the REA pass
// (docs/FIDELITY-MATRIX.md maps every field to its behaviour, evidence and tests).

/** 0 points, 1 tracking, 2 stopwatch (lower is better), 3 reaction average (lower is better). */
export type ScoreMode = 0 | 1 | 2 | 3;
/** On hit/loss: 0 keep, 1 randomise sign, 2 reverse. */
export type DirectionRule = 0 | 1 | 2;
/** On hit/loss: 0 keep, 1 randomise size (0..configured), 2 step by speedStep. */
export type SpeedSizeRule = 0 | 1 | 2;

export interface ModeConfig {
  name: string;
  scoreMode: ScoreMode;
  // targets & spawning
  targetLifePoints: number;
  requireMousePressed: boolean;
  targetsOnStart: number;
  maxTargets: number;
  addTargetPeriod: number;
  addTargetHits: number;
  randomTargetPosition: boolean;
  changePositionOnHit: boolean;
  changePositionOnLoss: boolean;
  strictInside: boolean;
  syncTarget: boolean;
  multiMode: boolean;
  targetLifeTime: number;
  oneTimeTargets: boolean;
  hitsToKill: number;
  targetDelay: number;
  targetDelayRandom: boolean;
  disableLosses: boolean;
  // size & pulse
  animationSpeed: number;
  animationIncrease: boolean;
  animationDecrease: boolean;
  radiusMin: number;
  radiusMax: number;
  animationAccel: number;
  animationAccelByTime: boolean;
  animationAccelByHit: boolean;
  changeRadiusOnHit: number;
  changeRadiusForAll: boolean;
  // scoring
  spHit: number;
  bonusProcPrecision: number;
  bonusProcReaction: number;
  bonusProcEff: number;
  bonusProcDistance: number;
  spMiss: number;
  spLoss: number;
  spMissPenalty: number;
  // checkpoint
  useCheckpoint: boolean;
  checkpointPositionX: number;
  checkpointPositionY: number;
  checkpointSize: number;
  // end conditions
  ggTimer: number;
  ggHits: number;
  ggMisses: number;
  ggLosses: number;
  ggTargets: number;
  ggApples: number;
  ggSpace: boolean;
  // field
  gameFieldRatio: number;
  // movement
  enableMoving: boolean;
  speedX: number;
  speedY: number;
  allowRandomizeDirectionX: boolean;
  allowRandomizeDirectionY: boolean;
  allowRandomizeSpeedSizeX: boolean;
  allowRandomizeSpeedSizeY: boolean;
  directionOnHitX: DirectionRule;
  directionOnHitY: DirectionRule;
  directionOnLossX: DirectionRule;
  directionOnLossY: DirectionRule;
  speedSizeOnHitX: SpeedSizeRule;
  speedSizeOnHitY: SpeedSizeRule;
  speedSizeOnLossX: SpeedSizeRule;
  speedSizeOnLossY: SpeedSizeRule;
  speedStepX: number;
  speedStepY: number;
  reboundSpeed: number;
  resetSpeedOnHit: boolean;
  resetSpeedOnLoss: boolean;
  // acceleration & strafing
  enableAccel: boolean;
  accelX: number;
  accelY: number;
  maxSpeedX: number;
  maxSpeedY: number;
  allowRandomizeAccelDirectionX: boolean;
  allowRandomizeAccelDirectionY: boolean;
  allowRandomizeAccelSizeX: boolean;
  allowRandomizeAccelSizeY: boolean;
  accelDirectionOnHitX: DirectionRule;
  accelDirectionOnHitY: DirectionRule;
  accelDirectionOnLossX: DirectionRule;
  accelDirectionOnLossY: DirectionRule;
  randomizeAccelSizeOnHitX: boolean;
  randomizeAccelSizeOnHitY: boolean;
  randomizeAccelSizeOnLossX: boolean;
  randomizeAccelSizeOnLossY: boolean;
  reverseAccelDirectionOnWall: boolean;
  useStrafe: boolean;
  strafeRangeX: number;
  strafeRangeY: number;
  // orbit
  roundMoving: boolean;
  synchRotation: boolean;
  movingRadius: number;
  randomizeMovingRadius: boolean;
  randomizeRotateDirection: boolean;
  angularVelocity: number;
}

export type ConfigKey = Exclude<keyof ModeConfig, 'name'>;

/** Field geometry in CSS pixels. Gameplay never uses device pixels. */
export interface FieldGeometry {
  width: number;
  height: number;
}

/**
 * Input policy (stored with every run):
 * - legacy-v1: one sample per pointermove parent event, path segments rounded to whole px (as the source did).
 * - precise-v1: every coalesced sample, unrounded path segments. Changes path/trajectory numbers, so its
 *   results get a different comparison key.
 */
export type InputPolicy = 'legacy-v1' | 'precise-v1';

export interface EngineOptions {
  seed: number;
  inputPolicy: InputPolicy;
  /** Legacy click-rate guard: 25 clicks inside 2 s cancels the run. */
  clickRateGuard: boolean;
  /** Countdown seconds before play (0 = none). */
  countdownSeconds: number;
}

export type GameState = 'idle' | 'countdown' | 'playing' | 'over' | 'cancelled';

export type CancelReason = 'user' | 'focus-lost' | 'stall' | 'geometry-changed' | 'click-rate' | 'restart';

export type EndReason = 'timer' | 'hits' | 'misses' | 'losses' | 'targets' | 'apples' | 'space';
