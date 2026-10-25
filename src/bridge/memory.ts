// In-memory bridge: used by tests and the browser-only dev preview. It is NOT the product's storage;
// nothing here survives a reload. The native bridge (native.ts) is used inside the desktop app.
import type { Bridge, Bootstrap, PersonalBest, RunPage, RunQuery, RunRow, StorageInfo } from './types';
import { BridgeFailure } from './types';
import type { Preset } from '../schemas/preset';
import type { Routine, RunRecord, RunReplay, SetupProfile } from '../schemas/app';

export class MemoryBridge implements Bridge {
  settings: unknown = null;
  profiles = new Map<string, SetupProfile>();
  presets = new Map<string, Preset>();
  favourites = new Set<string>();
  routines = new Map<string, Routine>();
  runs = new Map<string, RunRecord>();
  replays = new Map<string, RunReplay>();
  exported: { kind: string; name: string; content: string }[] = [];
  /** Tests can queue a file text for the next import dialog, or make saves fail. */
  nextImport: string | null = null;
  failSaves: BridgeFailure | null = null;
  fullscreen = false;

  async bootstrap(): Promise<Bootstrap> {
    const storage: StorageInfo = { kind: 'memory', dataDir: null, databasePath: null, schemaVersion: 1, supportedSchemaVersion: 1, readOnly: false, readOnlyReason: null, backupsDir: null };
    return {
      settings: this.settings,
      profiles: [...this.profiles.values()],
      presets: [...this.presets.values()],
      favourites: [...this.favourites],
      routines: [...this.routines.values()],
      storage,
    };
  }
  async saveSettings(s: unknown): Promise<void> { this.settings = JSON.parse(JSON.stringify(s)); }
  async upsertProfile(p: SetupProfile): Promise<void> { this.profiles.set(p.id, { ...p }); }
  async deleteProfile(id: string): Promise<void> { this.profiles.delete(id); }
  async upsertPreset(p: Preset): Promise<void> {
    if (p.official) throw new BridgeFailure({ code: 'invalid', message: 'official presets are read-only' });
    this.presets.set(p.id, JSON.parse(JSON.stringify(p)));
  }
  async deletePreset(id: string): Promise<void> { this.presets.delete(id); this.favourites.delete(id); }
  async setFavourite(id: string, on: boolean): Promise<void> { if (on) this.favourites.add(id); else this.favourites.delete(id); }
  async upsertRoutine(r: Routine): Promise<void> { this.routines.set(r.id, { ...r, steps: r.steps.map((s) => ({ ...s })) }); }
  async deleteRoutine(id: string): Promise<void> { this.routines.delete(id); }

  async saveRun(run: RunRecord, replay: RunReplay | null): Promise<{ saved: true; duplicate: boolean }> {
    if (this.failSaves) throw this.failSaves;
    if (this.runs.has(run.id)) return { saved: true, duplicate: true };
    this.runs.set(run.id, JSON.parse(JSON.stringify(run)));
    if (replay) this.replays.set(run.id, JSON.parse(JSON.stringify(replay)));
    return { saved: true, duplicate: false };
  }

  private row(r: RunRecord): RunRow {
    return {
      id: r.id, presetId: r.presetId, presetName: r.presetName, comparisonKey: r.comparisonKey, score: r.score, direction: r.direction,
      valid: r.valid, status: r.status, startedAt: r.startedAt, durationMs: r.durationMs, hasReplay: this.replays.has(r.id),
      summary: r.summary, practiceLevel: r.practice ? r.practice.adaptiveLevel : null, profileName: r.profileName, inputPolicy: r.inputPolicy, field: r.field,
    };
  }

  async queryRuns(q: RunQuery): Promise<RunPage> {
    let list = [...this.runs.values()];
    if (q.presetId) list = list.filter((r) => r.presetId === q.presetId);
    if (q.comparisonKey) list = list.filter((r) => r.comparisonKey === q.comparisonKey);
    if (q.validOnly) list = list.filter((r) => r.valid);
    list.sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : -1));
    return { rows: list.slice(q.offset, q.offset + q.limit).map((r) => this.row(r)), total: list.length };
  }

  async personalBests(): Promise<PersonalBest[]> {
    const best = new Map<string, RunRecord>();
    for (const r of this.runs.values()) {
      if (!r.valid) continue;
      const b = best.get(r.comparisonKey);
      if (!b || (r.direction === 'higher' ? r.score > b.score : r.score < b.score)) best.set(r.comparisonKey, r);
    }
    return [...best.values()].map((r) => ({ comparisonKey: r.comparisonKey, presetId: r.presetId, score: r.score, direction: r.direction, runId: r.id, startedAt: r.startedAt }));
  }

  async getReplay(id: string): Promise<RunReplay | null> { return this.replays.get(id) ?? null; }
  async deleteRun(id: string): Promise<void> { this.runs.delete(id); this.replays.delete(id); }
  async pruneReplays(): Promise<number> { return 0; }
  async exportRunsCsv(presetId: string | null): Promise<string | null> {
    this.exported.push({ kind: 'csv', name: 'runs.csv', content: String(presetId) });
    return 'memory://runs.csv';
  }
  async exportText(kind: 'preset' | 'diagnostics' | 'run', name: string, content: string): Promise<string | null> {
    this.exported.push({ kind, name, content });
    return `memory://${name}`;
  }
  async importPresetFile(): Promise<string | null> {
    const t = this.nextImport;
    this.nextImport = null;
    return t;
  }
  async backupDatabase(): Promise<string | null> { return null; }
  async resetData(scope: 'runs' | 'everything'): Promise<string> {
    this.runs.clear();
    this.replays.clear();
    if (scope === 'everything') { this.presets.clear(); this.routines.clear(); this.profiles.clear(); this.favourites.clear(); this.settings = null; }
    return 'memory://backup';
  }
  async diagnostics() {
    return {
      appVersion: 'dev', identifier: 'local.devideus.aimlite', os: 'browser preview', webview2Version: null, mouseSpeed: null, mouseAcceleration: null,
      windowDpi: null, scaleFactor: null, monitors: [], dataDir: null, databasePath: null, databaseBytes: null, errors: ['Browser preview: native diagnostics unavailable.'],
    };
  }
  async setFullscreen(on: boolean): Promise<void> { this.fullscreen = on; }
  async isFullscreen(): Promise<boolean> { return this.fullscreen; }
}
