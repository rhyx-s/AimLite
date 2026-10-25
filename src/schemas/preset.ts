import fieldsJson from './fields.json';
import type { ConfigKey, ModeConfig } from '../engine/types';

export interface FieldDef {
  key: ConfigKey;
  group: string;
  type: 'bool' | 'int' | 'num' | 'enum';
  min?: number;
  max?: number;
  step?: number;
  values?: number[];
  labels?: string[];
  label: string;
  help: string;
}

export const FIELD_GROUPS: string[] = fieldsJson.groups;
export const FIELDS: FieldDef[] = fieldsJson.fields as FieldDef[];
export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export interface Preset {
  id: string;
  version: number;
  official: boolean;
  name: string;
  category: string;
  description: string;
  config: ModeConfig;
  /** Custom presets: the preset this one was cloned from. */
  basedOn?: string;
}

export const MAX_PRESET_JSON_BYTES = 64 * 1024;
export const MAX_NAME = 60;
export const MAX_DESCRIPTION = 400;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Collapse control characters and trim; never interpreted as HTML (all UI text uses textContent). */
export function cleanText(s: string, max: number): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out.trim().slice(0, max);
}

/** Validate a gameplay config: every field present, typed and in bounds, plus dangerous combinations. */
export function validateConfig(raw: unknown, name = 'Custom'): ValidationResult<ModeConfig> {
  if (!isObj(raw)) return { ok: false, errors: ['config must be an object'] };
  const errors: string[] = [];
  const out: Record<string, unknown> = { name };
  for (const f of FIELDS) {
    const v = raw[f.key];
    if (f.type === 'bool') {
      if (typeof v !== 'boolean') errors.push(`${f.key}: expected true/false`);
      else out[f.key] = v;
    } else if (f.type === 'enum') {
      if (typeof v !== 'number' || !f.values!.includes(v)) errors.push(`${f.key}: expected one of ${f.values!.join(', ')}`);
      else out[f.key] = v;
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${f.key}: expected a finite number`);
      else if (v < f.min! || v > f.max!) errors.push(`${f.key}: ${v} is outside ${f.min} to ${f.max}`);
      else if (f.type === 'int' && !Number.isInteger(v)) errors.push(`${f.key}: expected a whole number`);
      else out[f.key] = v;
    }
  }
  const unknown = Object.keys(raw).filter((k) => k !== 'name' && !FIELD_BY_KEY.has(k as ConfigKey));
  if (unknown.length) errors.push(`unknown fields: ${unknown.slice(0, 5).join(', ')}`);
  if (errors.length) return { ok: false, errors };
  const c = out as unknown as ModeConfig;
  errors.push(...comboProblems(c));
  return errors.length ? { ok: false, errors } : { ok: true, value: c };
}

/** Combinations that would hang, never end or silently do nothing. */
export function comboProblems(c: ModeConfig): string[] {
  const p: string[] = [];
  const timer = c.ggTimer > 0 && c.scoreMode !== 2;
  if (!timer && !c.ggHits && !c.ggMisses && !c.ggLosses && !c.ggTargets && !c.ggApples && !c.ggSpace) {
    p.push(c.scoreMode === 2 ? 'Stopwatch mode needs an end condition other than the time limit (for example "End after N hits").' : 'Add at least one end condition (time limit, hits, misses, losses, spawns, perfect hits or Space).');
  }
  if (c.multiMode && !c.syncTarget) p.push('"Score per set" needs "Synchronised sets".');
  if (c.multiMode && c.targetsOnStart < 2) p.push('"Score per set" needs at least 2 targets at start.');
  if (c.scoreMode === 1 && c.ggHits > 0 && c.targetLifePoints === 0) p.push('Tracking mode only registers hits when "Ticks on target to break it" is above 0.');
  if (c.oneTimeTargets && c.ggHits > c.targetsOnStart + (c.addTargetPeriod > 0 || c.addTargetHits > 0 ? c.maxTargets : 0) && !timer && !c.ggSpace) {
    p.push('With one-time targets there are fewer targets than the hits needed to finish, and nothing else ends the run.');
  }
  if (c.enableAccel && !c.enableMoving) p.push('Acceleration needs "Targets move".');
  if (c.roundMoving && !c.enableMoving) p.push('Orbit needs "Targets move".');
  return p;
}

export function validatePreset(raw: unknown): ValidationResult<Preset> {
  if (!isObj(raw)) return { ok: false, errors: ['preset must be a JSON object'] };
  const name = typeof raw.name === 'string' ? cleanText(raw.name, MAX_NAME) : '';
  if (!name) return { ok: false, errors: ['name is required (1 to 60 characters)'] };
  const cfg = validateConfig(raw.config, name);
  if (!cfg.ok) return cfg;
  const description = typeof raw.description === 'string' ? cleanText(raw.description, MAX_DESCRIPTION) : '';
  const category = typeof raw.category === 'string' ? cleanText(raw.category, 40) || 'Custom' : 'Custom';
  const id = typeof raw.id === 'string' && /^custom:[a-z0-9-]{1,64}$/.test(raw.id) ? raw.id : newCustomId();
  const basedOn = typeof raw.basedOn === 'string' && raw.basedOn.length <= 80 ? raw.basedOn : undefined;
  return { ok: true, value: { id, version: 1, official: false, name, category, description, config: cfg.value, ...(basedOn ? { basedOn } : {}) } };
}

/** Parse an imported file's text. Size is checked before parsing; nothing is evaluated. */
export function parsePresetFile(text: string): ValidationResult<Preset> {
  if (new TextEncoder().encode(text).length > MAX_PRESET_JSON_BYTES) return { ok: false, errors: ['file is larger than 64 KB'] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
  if (isObj(data) && data.format === 'aimlite-preset' && isObj(data.preset)) data = data.preset;
  const r = validatePreset(data);
  if (r.ok) r.value.id = newCustomId(); // an import never overwrites an existing preset
  return r;
}

export function exportPresetText(p: Preset): string {
  const preset = { version: p.version, name: p.name, category: p.category, description: p.description, config: p.config, ...(p.basedOn ? { basedOn: p.basedOn } : {}) };
  return JSON.stringify({ format: 'aimlite-preset', formatVersion: 1, preset }, null, 1);
}

export function newCustomId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'custom:' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable canonical JSON of a config (sorted keys, name excluded) for hashing and comparison. */
export function canonicalConfig(c: ModeConfig): string {
  const keys = FIELDS.map((f) => f.key).sort();
  return JSON.stringify(keys.map((k) => [k, c[k]]));
}

/** FNV-1a 64-bit as hex: a fast, stable identity for configs (not a security hash). */
export function hashString(s: string): string {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * p) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** Human rule summary built from the config itself, so custom presets get one too. */
export function ruleSummary(c: ModeConfig): string[] {
  const out: string[] = [];
  const end: string[] = [];
  if (c.ggTimer > 0 && c.scoreMode !== 2) end.push(`${c.ggTimer} s`);
  if (c.ggHits) end.push(`${c.ggHits} ${c.multiMode ? 'sets' : 'hits'}`);
  if (c.ggMisses) end.push(`${c.ggMisses} miss${c.ggMisses > 1 ? 'es' : ''}`);
  if (c.ggLosses) end.push(`${c.ggLosses} lost`);
  if (c.ggTargets) end.push(`${c.ggTargets} spawns`);
  if (c.ggApples) end.push(`${c.ggApples} perfect hits`);
  if (c.ggSpace) end.push('Space');
  out.push(`Ends: ${end.join(' or ') || 'never'}`);
  switch (c.scoreMode) {
    case 0: {
      const parts = [`+${c.spHit}${c.multiMode ? ' per set' : ' per hit'}`];
      if (c.spMiss) parts.push(`−${c.spMiss} per miss`);
      if (c.spLoss && !c.disableLosses) parts.push(`−${c.spLoss} per lost target`);
      out.push(`Points: ${parts.join(', ')}`);
      break;
    }
    case 1: out.push('Points: +1 per tick (61/s) with the cursor on a target' + (c.requireMousePressed ? ' while holding the button' : '')); break;
    case 2: out.push(`Stopwatch: finish time${c.spMissPenalty ? `, +${c.spMissPenalty} s per miss` : ''}. Lower is better.`); break;
    case 3: out.push('Reaction: average reaction time, +1 s per early or missed click. Lower is better.'); break;
  }
  const bonuses: string[] = [];
  if (c.bonusProcPrecision) bonuses.push(`precision ${c.bonusProcPrecision}`);
  if (c.bonusProcReaction) bonuses.push(`reaction ${c.bonusProcReaction}`);
  if (c.bonusProcEff) bonuses.push(`path ${c.bonusProcEff}`);
  if (c.bonusProcDistance) bonuses.push(`distance ${c.bonusProcDistance}`);
  if (bonuses.length && c.scoreMode === 0) out.push(`Bonuses (max): ${bonuses.join(', ')}`);
  const t: string[] = [];
  t.push(c.targetsOnStart === c.maxTargets || c.maxTargets < c.targetsOnStart ? `${c.targetsOnStart} target${c.targetsOnStart > 1 ? 's' : ''}` : `${c.targetsOnStart} → ${c.maxTargets} targets`);
  if (c.radiusMin !== c.radiusMax && c.animationSpeed > 0 && (c.animationIncrease || c.animationDecrease)) t.push('pulsing');
  if (c.enableMoving) t.push(c.useStrafe && c.enableAccel ? 'strafing' : c.roundMoving ? 'orbiting' : 'moving');
  if (c.useCheckpoint && c.scoreMode !== 1) t.push('touch the hub between hits');
  if (c.syncTarget) t.push('in sets');
  if (c.targetLifeTime) t.push(`expire after ${c.targetLifeTime} ms`);
  out.push(`Targets: ${t.join(', ')}`);
  return out;
}
