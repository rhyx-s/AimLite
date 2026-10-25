import type { InputPolicy } from '../engine/types';
import type { RunSeries, RunSummary } from '../engine/summary';
import { cleanText } from './preset';

// ------------------------------------------------------------------ settings

export type FieldMode = 'classic' | 'large';
export type MouseButtonSetting = 0 | 1 | 2 | 3 | 4; // pointer button: left, middle, right, back, forward

export interface Settings {
  schema: 1;
  // look
  targetColor: string;
  targetOpacity: number; // 0–100 % visible
  targetGlow: number; // 0–100 % halo strength around targets (0 = off)
  targetShading: boolean;
  targetBorder: boolean;
  targetBorderColor: string;
  centerDot: boolean;
  centerCrosshair: boolean;
  backgroundColor: string;
  showHitPlace: boolean;
  showHitTrace: boolean;
  showReactionLabel: boolean;
  showMisses: boolean;
  showLosses: boolean;
  fadeSeconds: number; // 0.2–10
  showCursorTrail: boolean;
  trailLength: number; // samples, 0–200
  // HUD
  showTimer: boolean;
  showScore: boolean;
  showLiveStats: boolean;
  showSiteAverage: boolean;
  // audio
  muted: boolean;
  volume: number; // 0–100
  soundHit: boolean;
  soundMiss: boolean;
  soundLoss: boolean;
  soundCountdown: boolean;
  soundLastTen: boolean;
  // play
  countdownSeconds: number; // 0–5
  fieldMode: FieldMode;
  mouseButton: MouseButtonSetting;
  inputPolicy: InputPolicy;
  clickRateGuard: boolean;
  keyRestart: string;
  keyMute: string;
  keyFullscreen: string;
  // accessibility
  textScale: number; // 80–160 %
  highContrast: boolean;
  reduceMotion: boolean;
  // data
  replayRetention: 'all' | 'recent-200' | 'pb-only' | 'none';
  activeProfileId: string | null;
  // adaptive practice levels by preset id (−5..+5), only used by practice runs
  adaptiveLevels: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  schema: 1,
  targetColor: '#b48cff',
  targetOpacity: 100,
  targetGlow: 28,
  targetShading: true,
  targetBorder: false,
  targetBorderColor: '#ffffff',
  centerDot: true,
  centerCrosshair: false,
  backgroundColor: '#0e0b17',
  showHitPlace: true,
  showHitTrace: true,
  showReactionLabel: true,
  showMisses: true,
  showLosses: true,
  fadeSeconds: 1.8,
  showCursorTrail: false,
  trailLength: 40,
  showTimer: true,
  showScore: true,
  showLiveStats: true,
  showSiteAverage: false,
  muted: false,
  volume: 60,
  soundHit: true,
  soundMiss: true,
  soundLoss: true,
  soundCountdown: true,
  soundLastTen: true,
  countdownSeconds: 3,
  fieldMode: 'classic',
  mouseButton: 0,
  inputPolicy: 'legacy-v1',
  clickRateGuard: true,
  keyRestart: 'KeyR',
  keyMute: 'KeyM',
  keyFullscreen: 'F11',
  textScale: 100,
  highContrast: false,
  reduceMotion: false,
  replayRetention: 'recent-200',
  activeProfileId: null,
  adaptiveLevels: {},
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[A-Za-z0-9]{1,24}$/;

/** Merge stored settings onto defaults, keeping only valid, in-range values. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, adaptiveLevels: {} };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const D = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const out = s as unknown as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number): void => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  };
  for (const k of Object.keys(D)) {
    const d = D[k];
    const v = r[k];
    if (typeof d === 'boolean' && typeof v === 'boolean') out[k] = v;
  }
  for (const k of ['targetColor', 'targetBorderColor', 'backgroundColor']) if (typeof r[k] === 'string' && HEX.test(r[k] as string)) out[k] = r[k];
  for (const k of ['keyRestart', 'keyMute', 'keyFullscreen']) if (typeof r[k] === 'string' && KEY.test(r[k] as string)) out[k] = r[k];
  num('targetOpacity', 10, 100);
  num('targetGlow', 0, 100);
  num('fadeSeconds', 0.2, 10);
  num('trailLength', 0, 200);
  num('volume', 0, 100);
  num('countdownSeconds', 0, 5);
  num('textScale', 80, 160);
  s.countdownSeconds = Math.round(s.countdownSeconds);
  s.trailLength = Math.round(s.trailLength);
  if (r.fieldMode === 'classic' || r.fieldMode === 'large') s.fieldMode = r.fieldMode;
  if (typeof r.mouseButton === 'number' && [0, 1, 2, 3, 4].includes(r.mouseButton)) s.mouseButton = r.mouseButton as MouseButtonSetting;
  if (r.inputPolicy === 'legacy-v1' || r.inputPolicy === 'precise-v1') s.inputPolicy = r.inputPolicy;
  if (r.replayRetention === 'all' || r.replayRetention === 'recent-200' || r.replayRetention === 'pb-only' || r.replayRetention === 'none') s.replayRetention = r.replayRetention;
  if (typeof r.activeProfileId === 'string' && r.activeProfileId.length <= 80) s.activeProfileId = r.activeProfileId;
  if (typeof r.adaptiveLevels === 'object' && r.adaptiveLevels !== null) {
    for (const [k, v] of Object.entries(r.adaptiveLevels as Record<string, unknown>).slice(0, 500)) {
      if (k.length <= 80 && typeof v === 'number' && Number.isInteger(v) && v >= -5 && v <= 5) s.adaptiveLevels[k] = v;
    }
  }
  return s;
}

// ------------------------------------------------------------------ setup profiles

export type AimContext = 'free-cursor' | 'shift-lock' | 'first-person' | 'desktop' | 'other';

/** Context record for interpreting results. Not a sensitivity conversion. */
export interface SetupProfile {
  id: string;
  name: string;
  context: AimContext;
  experience: string;
  mouseDpi: number | null; // entered by the user
  gameSensitivity: string;
  display: string;
  notes: string;
  updatedAt: number;
}

export function sanitizeProfile(raw: unknown): SetupProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? cleanText(r.name, 60) : '';
  const id = typeof r.id === 'string' && /^profile:[a-z0-9-]{1,64}$/.test(r.id) ? r.id : null;
  if (!name || !id) return null;
  const ctx = ['free-cursor', 'shift-lock', 'first-person', 'desktop', 'other'].includes(r.context as string) ? (r.context as AimContext) : 'other';
  const dpi = typeof r.mouseDpi === 'number' && Number.isFinite(r.mouseDpi) && r.mouseDpi >= 50 && r.mouseDpi <= 64000 ? Math.round(r.mouseDpi) : null;
  const str = (k: string, n: number): string => (typeof r[k] === 'string' ? cleanText(r[k] as string, n) : '');
  return { id, name, context: ctx, experience: str('experience', 80), mouseDpi: dpi, gameSensitivity: str('gameSensitivity', 40), display: str('display', 80), notes: str('notes', 500), updatedAt: Date.now() };
}

// ------------------------------------------------------------------ routines

export interface RoutineStep { presetId: string; reps: number; }
export interface Routine { id: string; name: string; steps: RoutineStep[]; restSeconds: number; updatedAt: number; }

export const MAX_ROUTINE_STEPS = 30;

export function sanitizeRoutine(raw: unknown, presetExists: (id: string) => boolean): { ok: true; value: Routine } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['routine must be an object'] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  const name = typeof r.name === 'string' ? cleanText(r.name, 60) : '';
  if (!name) errors.push('Give the routine a name.');
  const id = typeof r.id === 'string' && /^routine:[a-z0-9-]{1,64}$/.test(r.id) ? r.id : null;
  if (!id) errors.push('invalid routine id');
  const steps: RoutineStep[] = [];
  if (!Array.isArray(r.steps) || r.steps.length === 0) errors.push('Add at least one mode.');
  else if (r.steps.length > MAX_ROUTINE_STEPS) errors.push(`At most ${MAX_ROUTINE_STEPS} steps.`);
  else {
    for (const st of r.steps as unknown[]) {
      const s = st as Record<string, unknown>;
      const pid = typeof s?.presetId === 'string' ? s.presetId : '';
      const reps = typeof s?.reps === 'number' && Number.isInteger(s.reps) ? s.reps : 0;
      if (!presetExists(pid)) errors.push(`Unknown mode in step ${steps.length + 1}.`);
      else if (reps < 1 || reps > 20) errors.push(`Repetitions must be 1 to 20 (step ${steps.length + 1}).`);
      else steps.push({ presetId: pid, reps });
    }
  }
  const rest = typeof r.restSeconds === 'number' && Number.isFinite(r.restSeconds) ? Math.round(r.restSeconds) : 0;
  if (rest < 0 || rest > 300) errors.push('Rest must be 0 to 300 seconds.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: id!, name, steps, restSeconds: rest, updatedAt: Date.now() } };
}

export function newId(prefix: 'routine' | 'profile' | 'run'): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return `${prefix}:${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ runs

/** Everything needed to reproduce, compare and display a run. */
export interface RunRecord {
  id: string;
  presetId: string;
  presetName: string;
  /** Runs are only compared (PBs, medians) within one comparison key. */
  comparisonKey: string;
  score: number;
  direction: 'higher' | 'lower';
  valid: boolean;
  status: 'completed' | 'cancelled';
  startedAt: number; // epoch ms
  endedAt: number;
  durationMs: number;
  engineVersion: string;
  inputPolicy: InputPolicy;
  seed: number;
  configHash: string;
  config: unknown;
  field: { width: number; height: number; dpr: number; mode: FieldMode };
  practice: { adaptiveLevel: number } | null;
  profileId: string | null;
  profileName: string | null;
  settingsSnapshot: { mouseButton: number; countdownSeconds: number; clickRateGuard: boolean; targetOpacity: number };
  summary: RunSummary;
  frame: { medianMs: number | null; p95Ms: number | null; p99Ms: number | null; frames: number };
}

export interface RunReplay { kind: 'full' | 'preview'; series: RunSeries; }

/** A run is valid for PBs only when it completed by its own end rule and has a meaningful score. */
export function runIsValid(s: RunSummary): boolean {
  if (s.status !== 'completed' || !Number.isFinite(s.score)) return false;
  if (s.direction === 'lower') return s.score > 0 && (s.hits > 0 || s.multiHits > 0);
  return s.durationMs > 0;
}
