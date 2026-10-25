import { Game } from '../engine/game';
import type { FieldGeometry, ModeConfig } from '../engine/types';

export const MAX_PREVIEW_RECORDS = 2048;
export const PREVIEW_CYCLE_MS = 5000;

/** Preview budgets never truncate scored-run histories or change benchmark rules. */
export function previewRecordCount(g: Game): number {
  return g.hits.length + g.multiHits.length + g.misses.length + g.losses.length
    + g.targetSpawns.length + g.scoreLog.length + g.attempts.length + g.samples.length
    + Object.values(g.bonusSeries).reduce((n, points) => n + points.length, 0);
}

/** Recycle the entire disposable preview, including its pending timers and histories. */
export class BoundedPreview {
  game: Game;
  restarts = 0;

  constructor(private cfg: ModeConfig, private field: FieldGeometry, private seed: number) {
    this.game = this.create();
  }

  private create(): Game {
    return new Game(this.cfg, this.field, {
      seed: this.seed, inputPolicy: 'legacy-v1', clickRateGuard: false, countdownSeconds: 0,
    });
  }

  begin(now: number): void { this.game.begin(now); }

  advance(now: number): void {
    this.game.advance(now);
    this.game.takeEvents();
    if (this.game.state !== 'playing' || this.game.t >= PREVIEW_CYCLE_MS
      || previewRecordCount(this.game) > MAX_PREVIEW_RECORDS) {
      this.restarts++;
      this.seed = (this.seed + 1) >>> 0;
      this.game = this.create();
      this.game.begin(now);
    }
  }
}
