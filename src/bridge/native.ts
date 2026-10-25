// Native bridge: typed wrappers over the app's Tauri commands (src-tauri/src/commands.rs).
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Bridge, BridgeError, Bootstrap, NativeDiagnostics, PersonalBest, RunPage, RunQuery } from './types';
import { BridgeFailure } from './types';
import type { Preset } from '../schemas/preset';
import type { Routine, RunRecord, RunReplay, SetupProfile } from '../schemas/app';

const CODES = new Set(['locked', 'read_only', 'disk_full', 'permission', 'corrupt', 'schema_newer', 'invalid', 'not_found', 'cancelled', 'io', 'unavailable']);

function toFailure(e: unknown): BridgeFailure {
  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const be = e as BridgeError;
    return new BridgeFailure({ code: CODES.has(be.code) ? be.code : 'io', message: String(be.message) });
  }
  return new BridgeFailure({ code: 'io', message: String(e) });
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toFailure(e);
  }
}

export class NativeBridge implements Bridge {
  bootstrap(): Promise<Bootstrap> { return call('bootstrap'); }
  saveSettings(settings: unknown): Promise<void> { return call('save_settings', { json: JSON.stringify(settings) }); }
  upsertProfile(p: SetupProfile): Promise<void> { return call('upsert_profile', { id: p.id, json: JSON.stringify(p) }); }
  deleteProfile(id: string): Promise<void> { return call('delete_profile', { id }); }
  upsertPreset(p: Preset): Promise<void> { return call('upsert_preset', { id: p.id, json: JSON.stringify(p) }); }
  deletePreset(id: string): Promise<void> { return call('delete_preset', { id }); }
  setFavourite(presetId: string, on: boolean): Promise<void> { return call('set_favourite', { presetId, on }); }
  upsertRoutine(r: Routine): Promise<void> { return call('upsert_routine', { id: r.id, json: JSON.stringify(r) }); }
  deleteRoutine(id: string): Promise<void> { return call('delete_routine', { id }); }
  saveRun(run: RunRecord, replay: RunReplay | null, retention: string) {
    return call<{ saved: true; duplicate: boolean }>('save_run', {
      run: {
        id: run.id, presetId: run.presetId, presetName: run.presetName, comparisonKey: run.comparisonKey, score: run.score,
        direction: run.direction, valid: run.valid, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
        durationMs: run.durationMs, engineVersion: run.engineVersion, inputPolicy: run.inputPolicy, seed: run.seed,
        configHash: run.configHash, practiceLevel: run.practice ? run.practice.adaptiveLevel : null, recordJson: JSON.stringify(run),
      },
      replayJson: replay ? JSON.stringify(replay) : null,
      replayKind: replay ? replay.kind : null,
      retention,
    });
  }
  queryRuns(q: RunQuery): Promise<RunPage> { return call('query_runs', { query: q }); }
  personalBests(): Promise<PersonalBest[]> { return call('personal_bests'); }
  async getReplay(runId: string): Promise<RunReplay | null> {
    const s = await call<string | null>('get_replay', { runId });
    return s ? (JSON.parse(s) as RunReplay) : null;
  }
  deleteRun(id: string): Promise<void> { return call('delete_run', { id }); }
  pruneReplays(retention: string): Promise<number> { return call('prune_replays', { retention }); }
  exportRunsCsv(presetId: string | null): Promise<string | null> { return call('export_runs_csv', { presetId }); }
  exportText(kind: 'preset' | 'diagnostics' | 'run', suggestedName: string, content: string): Promise<string | null> {
    return call('export_text', { kind, suggestedName, content });
  }
  importPresetFile(): Promise<string | null> { return call('import_preset_file'); }
  backupDatabase(): Promise<string | null> { return call('backup_database'); }
  resetData(scope: 'runs' | 'everything'): Promise<string> { return call('reset_data', { scope }); }
  diagnostics(): Promise<NativeDiagnostics> { return call('diagnostics'); }
  async setFullscreen(on: boolean): Promise<void> {
    try { await getCurrentWindow().setFullscreen(on); } catch (e) { throw toFailure(e); }
  }
  async isFullscreen(): Promise<boolean> {
    try { return await getCurrentWindow().isFullscreen(); } catch { return false; }
  }
}

/** True inside the Tauri webview. */
export function isNative(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
