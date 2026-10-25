import { describe, expect, it } from 'vitest';
import { OFFICIAL_PRESETS } from '../../src/presets';
import { DEFAULT_SETTINGS, sanitizeProfile, sanitizeRoutine, sanitizeSettings } from '../../src/schemas/app';
import { comboProblems, exportPresetText, parsePresetFile, ruleSummary, validatePreset } from '../../src/schemas/preset';

const custom = () => ({ ...JSON.parse(JSON.stringify(OFFICIAL_PRESETS[0]!)), id: 'custom:abc', official: false, name: 'Mine' });

describe('preset import', () => {
  it('round-trips an export and always gets a fresh id', () => {
    const p = validatePreset(custom());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = parsePresetFile(exportPresetText(p.value));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.config).toEqual(p.value.config);
    expect(r.value.id).not.toBe('custom:abc');
    expect(r.value.official).toBe(false);
  });

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['too large', JSON.stringify({ name: 'x'.repeat(70 * 1024) })],
    ['no name', JSON.stringify({ ...custom(), name: '   ' })],
    ['out of bounds', JSON.stringify({ ...custom(), config: { ...custom().config, targetsOnStart: 100000 } })],
    ['string number', JSON.stringify({ ...custom(), config: { ...custom().config, spHit: '100' } })],
    ['fractional int', JSON.stringify({ ...custom(), config: { ...custom().config, hitsToKill: 1.5 } })],
    ['unknown field', JSON.stringify({ ...custom(), config: { ...custom().config, evil: 1 } })],
    ['missing field', JSON.stringify({ ...custom(), config: { ...custom().config, spMiss: undefined } })],
    ['bad enum', JSON.stringify({ ...custom(), config: { ...custom().config, scoreMode: 4 } })],
    ['never ends', JSON.stringify({ ...custom(), config: { ...custom().config, ggTimer: 0, ggHits: 0, ggMisses: 0, ggLosses: 0 } })],
    ['score per set without sets', JSON.stringify({ ...custom(), config: { ...custom().config, multiMode: true, syncTarget: false } })],
  ])('rejects %s', (_label, text) => {
    expect(parsePresetFile(text).ok).toBe(false);
  });

  it('strips control characters and keeps HTML as plain text', () => {
    const r = validatePreset({ ...custom(), name: 'A\u0000B <img src=x onerror=alert(1)>' });
    expect(r.ok && r.value.name).toBe('A B <img src=x onerror=alert(1)>');
  });

  it('stopwatch mode needs a non-timer end condition', () => {
    const c = { ...custom().config, scoreMode: 2, ggTimer: 100, ggHits: 0 };
    expect(comboProblems(c).length).toBe(1);
  });

  it('every official preset has a readable rule summary', () => {
    for (const p of OFFICIAL_PRESETS) {
      const lines = ruleSummary(p.config);
      expect(lines[0]).toMatch(/^Ends: /);
      expect(lines.join(' ')).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('settings, profiles, routines', () => {
  it('settings: defaults for garbage, clamps numbers, ignores unknown keys', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ targetGlow: 500, volume: 900, countdownSeconds: 2.6, targetColor: 'red', fieldMode: 'huge', muted: true, evil: 1, keyRestart: 'KeyT' });
    expect(s.volume).toBe(100);
    expect(s.targetGlow).toBe(100);
    expect(sanitizeSettings({ targetGlow: -5 }).targetGlow).toBe(0);
    expect(sanitizeSettings({}).targetGlow).toBe(28);
    expect(s.countdownSeconds).toBe(3);
    expect(s.targetColor).toBe(DEFAULT_SETTINGS.targetColor);
    expect(s.fieldMode).toBe('classic');
    expect(s.muted).toBe(true);
    expect(s.keyRestart).toBe('KeyT');
    expect('evil' in s).toBe(false);
  });
  it('profiles: manual DPI only within a plausible range', () => {
    expect(sanitizeProfile({ id: 'profile:a', name: 'Desk', mouseDpi: 800 })!.mouseDpi).toBe(800);
    expect(sanitizeProfile({ id: 'profile:a', name: 'Desk', mouseDpi: 1e9 })!.mouseDpi).toBeNull();
    expect(sanitizeProfile({ id: 'x', name: 'Desk' })).toBeNull();
  });
  it('routines: known modes, 1–20 reps, 0–300 s rest', () => {
    const exists = (id: string) => id.startsWith('official:');
    expect(sanitizeRoutine({ id: 'routine:a', name: 'Warm-up', steps: [{ presetId: 'official:x', reps: 2 }], restSeconds: 10 }, exists).ok).toBe(true);
    expect(sanitizeRoutine({ id: 'routine:a', name: 'W', steps: [{ presetId: 'custom:gone', reps: 2 }], restSeconds: 10 }, exists).ok).toBe(false);
    expect(sanitizeRoutine({ id: 'routine:a', name: 'W', steps: [{ presetId: 'official:x', reps: 0 }], restSeconds: 10 }, exists).ok).toBe(false);
    expect(sanitizeRoutine({ id: 'routine:a', name: 'W', steps: [], restSeconds: 10 }, exists).ok).toBe(false);
    expect(sanitizeRoutine({ id: 'routine:a', name: 'W', steps: [{ presetId: 'official:x', reps: 1 }], restSeconds: 900 }, exists).ok).toBe(false);
  });
});
