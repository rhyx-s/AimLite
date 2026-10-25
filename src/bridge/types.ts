import type { Preset } from '../schemas/preset';
import type { Routine, RunRecord, RunReplay, SetupProfile } from '../schemas/app';

/** Structured native error. `code` drives the UI message. */
export interface BridgeError {
  code: 'locked' | 'read_only' | 'disk_full' | 'permission' | 'corrupt' | 'schema_newer' | 'invalid' | 'not_found' | 'cancelled' | 'io' | 'unavailable';
  message: string;
}

export class BridgeFailure extends Error {
  constructor(readonly error: BridgeError) {
    super(error.message);
  }
}

export interface Bootstrap {
  settings: unknown | null;
  profiles: unknown[];
  presets: unknown[];
  favourites: string[];
  routines: unknown[];
  storage: StorageInfo;
}

export interface StorageInfo {
  kind: 'native' | 'memory';
  dataDir: string | null;
  databasePath: string | null;
  schemaVersion: number;
  supportedSchemaVersion: number;
  /** True when the database is from a newer AimLite: writes are refused, export still works. */
  readOnly: boolean;
  readOnlyReason: string | null;
  backupsDir: string | null;
}

export interface RunRow {
  id: string;
  presetId: string;
  presetName: string;
  comparisonKey: string;
  score: number;
  direction: 'higher' | 'lower';
  valid: boolean;
  status: string;
  startedAt: number;
  durationMs: number;
  hasReplay: boolean;
  summary: RunRecord['summary'];
  practiceLevel: number | null;
  profileName: string | null;
  inputPolicy: string;
  field: RunRecord['field'];
}

export interface RunQuery {
  presetId?: string;
  comparisonKey?: string;
  validOnly?: boolean;
  limit: number;
  offset: number;
}

export interface RunPage { rows: RunRow[]; total: number; }

export interface PersonalBest { comparisonKey: string; presetId: string; score: number; direction: 'higher' | 'lower'; runId: string; startedAt: number; }

export interface NativeDiagnostics {
  appVersion: string;
  identifier: string;
  os: string;
  webview2Version: string | null;
  mouseSpeed: number | null; // 1–20 (Windows pointer speed)
  mouseAcceleration: { enabled: boolean; threshold1: number; threshold2: number } | null;
  windowDpi: number | null;
  scaleFactor: number | null;
  monitors: { name: string | null; width: number; height: number; scaleFactor: number; x: number; y: number }[];
  dataDir: string | null;
  databasePath: string | null;
  databaseBytes: number | null;
  errors: string[];
}

export type SaveRunResult = { saved: true; duplicate: boolean } ;

/** The only way the UI talks to native code. Every method is typed and validated on both sides. */
export interface Bridge {
  bootstrap(): Promise<Bootstrap>;
  saveSettings(settings: unknown): Promise<void>;
  upsertProfile(p: SetupProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  upsertPreset(p: Preset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  setFavourite(presetId: string, on: boolean): Promise<void>;
  upsertRoutine(r: Routine): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  saveRun(run: RunRecord, replay: RunReplay | null, retention: string): Promise<SaveRunResult>;
  queryRuns(q: RunQuery): Promise<RunPage>;
  personalBests(): Promise<PersonalBest[]>;
  getReplay(runId: string): Promise<RunReplay | null>;
  deleteRun(id: string): Promise<void>;
  pruneReplays(retention: string): Promise<number>;
  /** Native save dialog → CSV of runs (all, or one preset). Returns the chosen path or null if cancelled. */
  exportRunsCsv(presetId: string | null): Promise<string | null>;
  /** Native save dialog for a text document the UI produced (preset JSON, diagnostics, unsaved run). */
  exportText(kind: 'preset' | 'diagnostics' | 'run', suggestedName: string, content: string): Promise<string | null>;
  /** Native open dialog → file text (size-limited). Null if cancelled. */
  importPresetFile(): Promise<string | null>;
  /** Consistent SQLite backup to a user-chosen file. */
  backupDatabase(): Promise<string | null>;
  /** Backs up automatically, then deletes all runs (and optionally everything else). Returns the backup path. */
  resetData(scope: 'runs' | 'everything'): Promise<string>;
  diagnostics(): Promise<NativeDiagnostics>;
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
}
