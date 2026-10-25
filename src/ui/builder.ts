import { BoundedPreview } from './preview';
import { randomSeed } from '../engine/rng';
import type { ConfigKey, ModeConfig } from '../engine/types';
import { FieldRenderer } from '../render/field';
import { comboProblems, exportPresetText, FIELD_GROUPS, FIELDS, newCustomId, parsePresetFile, ruleSummary, validatePreset, type FieldDef, type Preset } from '../schemas/preset';
import type { App, Screen } from './app';
import { clear, confirmDialog, h, toast } from './dom';
import { rt } from './runtime';
import { errorMessage } from './store';

/** Why a field currently has no effect (null = it applies). Shown next to disabled inputs. */
export function inapplicable(c: ModeConfig, key: ConfigKey): string | null {
  const points = c.scoreMode === 0;
  switch (key) {
    case 'spHit': case 'spMiss': case 'spLoss': case 'bonusProcPrecision': case 'bonusProcReaction': case 'bonusProcEff': case 'bonusProcDistance':
      return points ? null : 'Only used in Points scoring.';
    case 'spMissPenalty': return c.scoreMode === 2 ? null : 'Only used in Stopwatch scoring.';
    case 'targetLifePoints': case 'requireMousePressed': return c.scoreMode === 1 ? null : 'Only used in Tracking scoring.';
    case 'multiMode': return c.syncTarget ? null : 'Needs synchronised sets.';
    case 'useCheckpoint': return c.scoreMode === 1 ? 'Not used in Tracking scoring.' : null;
    case 'checkpointPositionX': case 'checkpointPositionY': case 'checkpointSize':
      return c.useCheckpoint && c.scoreMode !== 1 ? null : 'Turn on the hub first.';
    case 'ggTimer': return c.scoreMode === 2 ? 'Stopwatch runs end by hits (or another condition), not by time.' : null;
    case 'animationSpeed': case 'animationIncrease': case 'animationDecrease': case 'animationAccel':
      return c.radiusMin !== c.radiusMax ? null : 'Set different "Size from" and "Size to" values to pulse.';
    case 'animationAccelByHit': case 'animationAccelByTime':
      return c.radiusMin !== c.radiusMax && c.animationAccel !== 0 ? null : 'Set a non-zero pulse speed change first.';
    case 'changeRadiusForAll': return c.changeRadiusOnHit !== 0 ? null : 'Set a radius change per hit first.';
    case 'targetDelayRandom': return c.targetDelay > 0 ? null : 'Set a respawn delay first.';
    case 'addTargetPeriod': case 'addTargetHits': return c.maxTargets > c.targetsOnStart ? null : 'Maximum targets must be above the start count.';
    case 'speedX': case 'speedY': case 'allowRandomizeDirectionX': case 'allowRandomizeDirectionY': case 'allowRandomizeSpeedSizeX': case 'allowRandomizeSpeedSizeY':
    case 'directionOnHitX': case 'directionOnHitY': case 'directionOnLossX': case 'directionOnLossY': case 'speedSizeOnHitX': case 'speedSizeOnHitY':
    case 'speedSizeOnLossX': case 'speedSizeOnLossY': case 'reboundSpeed': case 'resetSpeedOnHit': case 'resetSpeedOnLoss': case 'enableAccel': case 'roundMoving':
      return c.enableMoving ? null : 'Turn on "Targets move" first.';
    case 'speedStepX': return c.enableMoving && (c.speedSizeOnHitX === 2 || c.speedSizeOnLossX === 2) ? null : 'Used when an X speed rule is "Step".';
    case 'speedStepY': return c.enableMoving && (c.speedSizeOnHitY === 2 || c.speedSizeOnLossY === 2) ? null : 'Used when a Y speed rule is "Step".';
    case 'accelX': case 'accelY': case 'maxSpeedX': case 'maxSpeedY': case 'allowRandomizeAccelDirectionX': case 'allowRandomizeAccelDirectionY':
    case 'allowRandomizeAccelSizeX': case 'allowRandomizeAccelSizeY': case 'accelDirectionOnHitX': case 'accelDirectionOnHitY': case 'accelDirectionOnLossX':
    case 'accelDirectionOnLossY': case 'randomizeAccelSizeOnHitX': case 'randomizeAccelSizeOnHitY': case 'randomizeAccelSizeOnLossX': case 'randomizeAccelSizeOnLossY':
    case 'reverseAccelDirectionOnWall': case 'useStrafe':
      return c.enableMoving && c.enableAccel ? null : 'Turn on "Targets move" and "Acceleration" first.';
    case 'strafeRangeX': case 'strafeRangeY': return c.enableMoving && c.enableAccel && c.useStrafe ? null : 'Turn on strafing first.';
    case 'movingRadius': case 'randomizeMovingRadius': case 'angularVelocity': case 'randomizeRotateDirection': case 'synchRotation':
      return c.enableMoving && c.roundMoving ? null : 'Turn on "Orbit" first.';
    default: return null;
  }
}

export function mountBuilder(app: App, el: HTMLElement, presetId?: string): Screen {
  const store = app.store;
  let source: Preset = store.preset(presetId ?? '') ?? store.allPresets()[0]!;
  let draft: Preset = clone(source);
  let previewGame: BoundedPreview | null = null;
  let raf = 0;
  let disposed = false;

  const baseSel = h('select', { 'aria-label': 'Start from' }, store.allPresets().map((p) => h('option', { value: p.id, text: `${p.official ? '' : '★ '}${p.name}`, selected: p.id === source.id })));
  const name = h('input', { type: 'text', maxlength: '60', id: 'b-name' });
  const desc = h('input', { type: 'text', maxlength: '400', id: 'b-desc' });
  const errors = h('div', { class: 'error', role: 'alert' });
  const summary = h('ul', { class: 'small muted' });
  const form = h('div', { class: 'builder-form' });
  const previewCanvas = h('canvas', { class: 'preview', 'aria-hidden': 'true' });
  const renderer = new FieldRenderer(previewCanvas);
  const saveBtn = h('button', { class: 'primary', text: 'Save' });
  const tryBtn = h('button', { text: 'Save and play' });
  const delBtn = h('button', { class: 'ghost danger-text', text: 'Delete' });
  const exportBtn = h('button', { class: 'ghost', text: 'Export JSON' });
  const importBtn = h('button', { class: 'ghost', text: 'Import JSON' });
  const readOnlyNote = h('p', { class: 'note' });

  el.append(
    h('header', { class: 'page-head' }, h('h1', { text: 'Mode builder' }), h('div', { class: 'row' }, h('label', { class: 'row' }, 'Start from ', baseSel), importBtn)),
    readOnlyNote,
    h('div', { class: 'builder' },
      h('div', { class: 'builder-main' },
        h('label', { for: 'b-name', text: 'Name' }), name,
        h('label', { for: 'b-desc', text: 'Description' }), desc,
        form),
      h('aside', { class: 'builder-side' },
        h('h2', { text: 'Preview' }), previewCanvas, h('p', { class: 'muted small', text: 'Live preview with no input. Restarts periodically to limit memory use. Speeds are shown at the preview size.' }),
        h('h2', { text: 'Rules' }), summary, errors,
        h('div', { class: 'row wrap' }, saveBtn, tryBtn, exportBtn, delBtn))));

  const setDraft = (p: Preset, editable: boolean): void => {
    draft = editable ? clone(p) : { ...clone(p), id: newCustomId(), official: false, name: `${p.name} (copy)`, category: 'Custom', basedOn: p.id };
    name.value = draft.name;
    desc.value = draft.description;
    readOnlyNote.textContent = editable ? 'Editing your custom mode. Saving changes it for future runs; past results keep the config they were played with.' : `${p.name} is an official benchmark mode and stays unchanged. You are editing a copy.`;
    delBtn.toggleAttribute('disabled', !editable);
    renderForm();
    validate();
    restartPreview();
  };

  const input = (f: FieldDef): HTMLElement => {
    const id = `f-${f.key}`;
    const v = draft.config[f.key];
    const reason = inapplicable(draft.config, f.key);
    let ctl: HTMLInputElement | HTMLSelectElement;
    if (f.type === 'bool') {
      ctl = h('input', { type: 'checkbox', id, checked: v === true });
    } else if (f.type === 'enum') {
      ctl = h('select', { id }, f.values!.map((val, i) => h('option', { value: String(val), text: f.labels?.[i] ?? String(val), selected: val === v })));
    } else {
      ctl = h('input', { type: 'number', id, min: String(f.min), max: String(f.max), step: String(f.step ?? 1), value: String(v), inputmode: 'decimal' });
    }
    if (reason) { ctl.setAttribute('aria-describedby', `${id}-why`); }
    ctl.addEventListener('change', () => {
      const cfg = draft.config as unknown as Record<string, unknown>;
      if (f.type === 'bool') cfg[f.key] = (ctl as HTMLInputElement).checked;
      else cfg[f.key] = Number(ctl.value);
      renderForm(f.key);
      validate();
      restartPreview();
    });
    const label = h('label', { for: id, text: f.label });
    return h('div', { class: reason ? 'field-row inapplicable' : 'field-row', title: f.help || '' },
      f.type === 'bool' ? h('div', { class: 'check' }, ctl, label) : h('div', {}, label, ctl),
      f.help ? h('span', { class: 'help small muted', text: f.help }) : null,
      reason ? h('span', { class: 'why small', id: `${id}-why`, text: `No effect now: ${reason}` }) : null);
  };

  const renderForm = (focusKey?: ConfigKey): void => {
    const open = new Set([...form.querySelectorAll('details[open]')].map((d) => d.getAttribute('data-group')));
    clear(form);
    FIELD_GROUPS.forEach((g, i) => {
      const fields = FIELDS.filter((f) => f.group === g);
      const det = h('details', { class: 'group', 'data-group': g, open: open.size ? open.has(g) : i < 2 }, h('summary', { text: g }), fields.map(input));
      form.append(det);
    });
    if (focusKey) form.querySelector<HTMLElement>(`#f-${focusKey}`)?.focus();
  };

  const validate = (): boolean => {
    draft.name = name.value;
    draft.description = desc.value;
    const r = validatePreset(draft);
    clear(summary);
    for (const line of ruleSummary(draft.config)) summary.append(h('li', { text: line }));
    if (!r.ok) {
      errors.textContent = r.errors.join(' ');
      saveBtn.setAttribute('disabled', '');
      tryBtn.setAttribute('disabled', '');
      return false;
    }
    errors.textContent = '';
    saveBtn.removeAttribute('disabled');
    tryBtn.removeAttribute('disabled');
    return true;
  };

  const restartPreview = (): void => {
    if (comboProblems(draft.config).length) { previewGame = null; return; }
    const W = 360;
    const H = Math.round(W * draft.config.gameFieldRatio);
    renderer.resize(W, H, rt.dpr());
    renderer.reset();
    previewGame = new BoundedPreview({ ...draft.config }, { width: W, height: H }, randomSeed());
    previewGame.begin(rt.now());
  };

  const tick = (): void => {
    if (disposed) return;
    raf = rt.raf(tick);
    if (!previewGame) return;
    previewGame.advance(rt.now());
    renderer.draw(previewGame.game, store.settings);
  };

  const save = async (): Promise<Preset | null> => {
    if (!validate()) return null;
    const r = validatePreset(draft);
    if (!r.ok) return null;
    const p = { ...r.value, id: draft.id };
    if (await store.savePreset(p)) {
      toast(`Saved “${p.name}”`, 'ok');
      source = p;
      setDraft(p, true);
      refreshBaseSel();
      return p;
    }
    return null;
  };

  const refreshBaseSel = (): void => {
    clear(baseSel);
    for (const p of store.allPresets()) baseSel.append(h('option', { value: p.id, text: `${p.official ? '' : '★ '}${p.name}`, selected: p.id === source.id }));
  };

  name.addEventListener('input', validate);
  desc.addEventListener('input', validate);
  baseSel.addEventListener('change', () => {
    const p = store.preset(baseSel.value);
    if (p) { source = p; setDraft(p, !p.official); }
  });
  saveBtn.addEventListener('click', () => { void save(); });
  tryBtn.addEventListener('click', async () => {
    const p = await save();
    if (p) app.go({ name: 'play', req: { presetId: p.id, practice: false } });
  });
  delBtn.addEventListener('click', async () => {
    if (draft.official || !store.custom.some((p) => p.id === draft.id)) return;
    if (!(await confirmDialog('Delete this mode?', `“${draft.name}” will be removed. Its past runs stay in your history.`, 'Delete'))) return;
    if (await store.deletePreset(draft.id)) {
      source = store.allPresets()[0]!;
      refreshBaseSel();
      setDraft(source, false);
    }
  });
  exportBtn.addEventListener('click', async () => {
    if (!validate()) return;
    try {
      const path = await store.bridge.exportText('preset', `${draft.name}.json`, exportPresetText(draft));
      if (path) toast(`Exported to ${path}`, 'ok');
    } catch (e) {
      toast(`Export failed: ${errorMessage(e)}`, 'error');
    }
  });
  importBtn.addEventListener('click', async () => {
    let text: string | null;
    try {
      text = await store.bridge.importPresetFile();
    } catch (e) {
      toast(`Import failed: ${errorMessage(e)}`, 'error');
      return;
    }
    if (text === null) return;
    const r = parsePresetFile(text);
    if (!r.ok) {
      errors.textContent = `Import rejected: ${r.errors.slice(0, 6).join(' ')}`;
      toast('Import rejected: the file is not a valid AimLite preset. Nothing was changed.', 'error');
      return;
    }
    source = r.value;
    setDraft(r.value, true);
    readOnlyNote.textContent = 'Imported. Review it, then Save to keep it.';
  });

  setDraft(source, !source.official);
  raf = rt.raf(tick);
  return { dispose: () => { disposed = true; rt.caf(raf); } };
}

function clone(p: Preset): Preset {
  return JSON.parse(JSON.stringify(p)) as Preset;
}
