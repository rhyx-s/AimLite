// App state shared by the screens, and every persistence call with user-facing error handling.
import { BridgeFailure, type Bridge, type PersonalBest, type StorageInfo } from '../bridge/types';
import { comparisonKey, effectiveConfig, fieldFor, OFFICIAL_PRESETS } from '../presets';
import { DEFAULT_SETTINGS, sanitizeProfile, sanitizeRoutine, sanitizeSettings, type FieldMode, type Routine, type Settings, type SetupProfile } from '../schemas/app';
import { validatePreset, type Preset } from '../schemas/preset';
import type { ModeConfig } from '../engine/types';
import { toast } from './dom';
import { rt } from './runtime';

export function errorMessage(e: unknown): string {
  if (e instanceof BridgeFailure) {
    switch (e.error.code) {
      case 'locked': return 'The database is busy (another AimLite window or a backup tool may be using it). Try again in a moment.';
      case 'read_only': return e.error.message;
      case 'disk_full': return 'The disk is full. Free some space, then retry.';
      case 'permission': return 'AimLite is not allowed to write its data folder. Check the folder permissions (Help → Data location).';
      case 'corrupt': return 'The database looks damaged. Your data was not changed; back it up from Settings → Data before anything else.';
      case 'schema_newer': return 'This data was written by a newer AimLite. It is opened read-only.';
      case 'invalid': return `Rejected: ${e.error.message}`;
      default: return e.error.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export interface PlayRequest {
  presetId: string;
  practice: boolean;
  routine?: { routineId: string; stepIndex: number; rep: number };
}

export class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  custom: Preset[] = [];
  favourites = new Set<string>();
  routines: Routine[] = [];
  profiles: SetupProfile[] = [];
  pbs = new Map<string, PersonalBest>();
  storage: StorageInfo | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly bridge: Bridge) {}

  async load(): Promise<void> {
    const b = await this.bridge.bootstrap();
    this.storage = b.storage;
    this.settings = sanitizeSettings(b.settings);
    this.custom = b.presets.map((p) => validatePreset(p)).filter((r) => r.ok).map((r) => (r as { value: Preset }).value);
    this.favourites = new Set(b.favourites);
    this.profiles = b.profiles.map(sanitizeProfile).filter((p): p is SetupProfile => p !== null);
    this.routines = b.routines.map((r) => sanitizeRoutine(r, (id) => !!this.preset(id))).filter((r) => r.ok).map((r) => (r as { value: Routine }).value);
    await this.refreshPbs();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const f of this.listeners) f();
  }

  get readOnly(): boolean {
    return !!this.storage?.readOnly;
  }

  allPresets(): Preset[] {
    return [...OFFICIAL_PRESETS, ...this.custom];
  }

  preset(id: string): Preset | undefined {
    return OFFICIAL_PRESETS.find((p) => p.id === id) ?? this.custom.find((p) => p.id === id);
  }

  activeProfile(): SetupProfile | null {
    return this.profiles.find((p) => p.id === this.settings.activeProfileId) ?? null;
  }

  async refreshPbs(): Promise<void> {
    try {
      const list = await this.bridge.personalBests();
      this.pbs = new Map(list.map((p) => [p.comparisonKey, p]));
    } catch (e) {
      toast(`Could not load personal bests: ${errorMessage(e)}`, 'error');
    }
  }

  /** Field geometry for a preset under the current settings and window. */
  geometry(p: Preset, available?: { width: number; height: number }, mode: FieldMode = this.settings.fieldMode): { width: number; height: number; classicWidth: number; mode: FieldMode } {
    const classic = fieldFor('classic', p.config.gameFieldRatio, rt.screenWidth(), { width: 0, height: 0 });
    if (mode === 'classic') return { ...classic, classicWidth: classic.width, mode };
    // Large: snap the scale to 0.05 steps so a window size class keeps one comparison key.
    const av = available ?? { width: classic.width * 1.5, height: classic.height * 1.5 };
    const fit = fieldFor('large', p.config.gameFieldRatio, rt.screenWidth(), av);
    const k = Math.max(1.05, Math.min(2.5, Math.floor((fit.width / classic.width) * 20) / 20));
    const width = Math.round(classic.width * k);
    return { width, height: Math.round(width * p.config.gameFieldRatio), classicWidth: classic.width, mode };
  }

  practiceLevel(p: Preset, practice: boolean): number | null {
    return practice ? this.settings.adaptiveLevels[p.id] ?? 0 : null;
  }

  runConfig(p: Preset, geo: { width: number; classicWidth: number; mode: FieldMode }, level: number | null): ModeConfig {
    return effectiveConfig(p.config, geo.mode, geo.width, geo.classicWidth, level);
  }

  keyFor(p: Preset, geo: { width: number; height: number; mode: FieldMode }, level: number | null): string {
    return comparisonKey(p, { fieldMode: geo.mode, width: geo.width, height: geo.height, inputPolicy: this.settings.inputPolicy, practiceLevel: level });
  }

  /** PB for this preset under the current classic/large setup (fixed runs). */
  pbFor(p: Preset): PersonalBest | null {
    const geo = this.geometry(p, this.lastAvailable ?? undefined);
    return this.pbs.get(this.keyFor(p, geo, null)) ?? null;
  }

  lastAvailable: { width: number; height: number } | null = null;

  // --------------------------------------------------------- settings

  updateSettings(patch: Partial<Settings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flushSettings(); }, 300);
  }

  async flushSettings(): Promise<boolean> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.readOnly) return false;
    try {
      await this.bridge.saveSettings(this.settings);
      return true;
    } catch (e) {
      toast(`Settings not saved: ${errorMessage(e)}`, 'error', { label: 'Retry', run: () => { void this.flushSettings(); } });
      return false;
    }
  }

  // --------------------------------------------------------- entities

  async savePreset(p: Preset): Promise<boolean> {
    try {
      await this.bridge.upsertPreset(p);
      const i = this.custom.findIndex((x) => x.id === p.id);
      if (i >= 0) this.custom[i] = p;
      else this.custom.push(p);
      this.emit();
      return true;
    } catch (e) {
      toast(`Preset not saved: ${errorMessage(e)}`, 'error');
      return false;
    }
  }

  async deletePreset(id: string): Promise<boolean> {
    try {
      await this.bridge.deletePreset(id);
      this.custom = this.custom.filter((p) => p.id !== id);
      this.favourites.delete(id);
      this.emit();
      return true;
    } catch (e) {
      toast(`Preset not deleted: ${errorMessage(e)}`, 'error');
      return false;
    }
  }

  async toggleFavourite(id: string): Promise<void> {
    const on = !this.favourites.has(id);
    try {
      await this.bridge.setFavourite(id, on);
      if (on) this.favourites.add(id);
      else this.favourites.delete(id);
      this.emit();
    } catch (e) {
      toast(`Favourite not saved: ${errorMessage(e)}`, 'error');
    }
  }

  async saveRoutine(r: Routine): Promise<boolean> {
    try {
      await this.bridge.upsertRoutine(r);
      const i = this.routines.findIndex((x) => x.id === r.id);
      if (i >= 0) this.routines[i] = r;
      else this.routines.push(r);
      this.emit();
      return true;
    } catch (e) {
      toast(`Routine not saved: ${errorMessage(e)}`, 'error');
      return false;
    }
  }

  async deleteRoutine(id: string): Promise<void> {
    try {
      await this.bridge.deleteRoutine(id);
      this.routines = this.routines.filter((r) => r.id !== id);
      this.emit();
    } catch (e) {
      toast(`Routine not deleted: ${errorMessage(e)}`, 'error');
    }
  }

  async saveProfile(p: SetupProfile): Promise<boolean> {
    try {
      await this.bridge.upsertProfile(p);
      const i = this.profiles.findIndex((x) => x.id === p.id);
      if (i >= 0) this.profiles[i] = p;
      else this.profiles.push(p);
      this.emit();
      return true;
    } catch (e) {
      toast(`Profile not saved: ${errorMessage(e)}`, 'error');
      return false;
    }
  }

  async deleteProfile(id: string): Promise<void> {
    try {
      await this.bridge.deleteProfile(id);
      this.profiles = this.profiles.filter((p) => p.id !== id);
      if (this.settings.activeProfileId === id) this.updateSettings({ activeProfileId: null });
      this.emit();
    } catch (e) {
      toast(`Profile not deleted: ${errorMessage(e)}`, 'error');
    }
  }
}
