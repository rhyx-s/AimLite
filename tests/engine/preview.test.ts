import { describe, expect, it } from 'vitest';
import { BoundedPreview, MAX_PREVIEW_RECORDS, previewRecordCount } from '../../src/ui/preview';
import { Game } from '../../src/engine/game';
import { OFFICIAL_PRESETS } from '../../src/presets';
import type { ModeConfig } from '../../src/engine/types';

const base = OFFICIAL_PRESETS[0]!.config;
const extreme: ModeConfig = { ...base, scoreMode: 0, targetsOnStart: 200, maxTargets: 200, targetLifeTime: 1,
  targetDelay: 0, targetDelayRandom: false, changePositionOnLoss: true, disableLosses: false,
  ggTimer: 0, ggHits: 0, ggMisses: 0, ggLosses: 0, ggTargets: 0, ggApples: 0, ggSpace: true,
  oneTimeTargets: false, useCheckpoint: false, syncTarget: false, multiMode: false };

describe('bounded builder previews', () => {
  it('keeps hostile imported preview histories bounded through many restarts', () => {
    const preview = new BoundedPreview(extreme, { width: 360, height: 224 }, 1);
    preview.begin(0);
    for (let t = 16; t <= 60_000; t += 16) {
      preview.advance(t);
      expect(previewRecordCount(preview.game)).toBeLessThanOrEqual(MAX_PREVIEW_RECORDS);
      expect(preview.game.state).toBe('playing');
    }
    expect(preview.restarts).toBeGreaterThan(10);
  });

  it('also recycles a low-churn preview with no automatic end condition', () => {
    const preview = new BoundedPreview({ ...extreme, targetsOnStart: 1, maxTargets: 1, targetLifeTime: 0 }, { width: 360, height: 224 }, 2);
    preview.begin(0);
    for (let t = 16; t <= 16_000; t += 16) preview.advance(t);
    expect(preview.restarts).toBeGreaterThanOrEqual(3);
  });

  it('does not alter ordinary scored engine history or end conditions', () => {
    const game = new Game({ ...extreme, targetsOnStart: 1, maxTargets: 1, ggSpace: false, ggLosses: 10 },
      { width: 360, height: 224 }, { seed: 1, inputPolicy: 'legacy-v1', countdownSeconds: 0, clickRateGuard: false });
    game.begin(0);
    for (let t = 16; t <= 1000 && game.state === 'playing'; t += 16) game.advance(t);
    expect(game.losses).toHaveLength(10);
    expect(game.endReason).toBe('losses');
    expect(game.scoreLog.length).toBeGreaterThanOrEqual(10);
  });
});
