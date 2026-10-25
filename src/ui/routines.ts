import { estimateSeconds } from '../presets';
import { newId, sanitizeRoutine, MAX_ROUTINE_STEPS, type Routine, type RoutineStep } from '../schemas/app';
import type { App, Screen } from './app';
import { clear, confirmDialog, h, toast } from './dom';

export interface RoutineRun { routine: Routine; stepIndex: number; rep: number; }

/** Seed routines offered when there are none yet (the user saves them explicitly). */
const STARTERS: { name: string; steps: RoutineStep[]; restSeconds: number }[] = [
  { name: 'Five-minute warm-up', restSeconds: 10, steps: [{ presetId: 'official:wide-line', reps: 1 }, { presetId: 'official:quick-reflex', reps: 1 }, { presetId: 'official:chase-steady', reps: 1 }] },
  { name: 'Precision focus', restSeconds: 15, steps: [{ presetId: 'official:pinpoint-pulse', reps: 2 }, { presetId: 'official:pixel-dot', reps: 1 }] },
  { name: 'Tracking focus', restSeconds: 15, steps: [{ presetId: 'official:chase-steady', reps: 1 }, { presetId: 'official:chase-strafe', reps: 1 }, { presetId: 'official:chase-switch', reps: 1 }] },
];

export function routineSeconds(app: App, r: { steps: RoutineStep[]; restSeconds: number }): { seconds: number; open: number } {
  let seconds = 0;
  let open = 0;
  let runs = 0;
  for (const s of r.steps) {
    const p = app.store.preset(s.presetId);
    const e = p ? estimateSeconds(p.config) : null;
    if (e === null) open += s.reps;
    else seconds += e * s.reps;
    runs += s.reps;
  }
  seconds += Math.max(0, runs - 1) * r.restSeconds + runs * app.store.settings.countdownSeconds;
  return { seconds, open };
}

export function durationText(s: { seconds: number; open: number }): string {
  const m = Math.round(s.seconds / 60);
  return `about ${m < 1 ? '<1' : m} min${s.open ? ` + ${s.open} open-ended run${s.open > 1 ? 's' : ''}` : ''}`;
}

/** The next step after the current one, or null at the end. Handles the rest pause. */
export function nextRoutineStep(app: App, rr: RoutineRun): { label: string; go: () => void } | null {
  const step = rr.routine.steps[rr.stepIndex]!;
  let next: RoutineRun;
  if (rr.rep < step.reps) next = { ...rr, rep: rr.rep + 1 };
  else if (rr.stepIndex + 1 < rr.routine.steps.length) next = { ...rr, stepIndex: rr.stepIndex + 1, rep: 1 };
  else return null;
  const p = app.store.preset(next.routine.steps[next.stepIndex]!.presetId);
  if (!p) return null;
  const play = () => {
    app.routineRun = next;
    app.go({ name: 'play', req: { presetId: p.id, practice: false, routine: { routineId: next.routine.id, stepIndex: next.stepIndex, rep: next.rep } } });
  };
  return {
    label: `${p.name}${next.routine.steps[next.stepIndex]!.reps > 1 ? ` (${next.rep}/${next.routine.steps[next.stepIndex]!.reps})` : ''}`,
    go: () => (rr.routine.restSeconds > 0 ? rest(app, rr.routine.restSeconds, p.name, play) : play()),
  };
}

function rest(app: App, seconds: number, nextName: string, play: () => void): void {
  const el = app.main;
  clear(el);
  let left = seconds;
  const count = h('p', { class: 'big', 'aria-live': 'polite', text: `${left}` });
  const skip = h('button', { class: 'primary', text: 'Skip rest' });
  const exit = h('button', { class: 'ghost', text: 'Exit routine' });
  el.append(h('h1', { text: 'Rest' }), h('p', { text: `Next: ${nextName}` }), count, h('div', { class: 'row' }, skip, exit));
  const timer = setInterval(() => {
    // navigated elsewhere during the rest: stop silently
    if (!count.isConnected) { clearInterval(timer); return; }
    left--;
    count.textContent = `${left}`;
    if (left <= 0) { clearInterval(timer); play(); }
  }, 1000);
  skip.addEventListener('click', () => { clearInterval(timer); play(); });
  exit.addEventListener('click', () => { clearInterval(timer); app.routineRun = null; app.go({ name: 'routines' }); });
  skip.focus();
}

export function mountRoutines(app: App, el: HTMLElement, editId?: string): Screen {
  const store = app.store;
  const listBox = h('section', {});
  const editor = h('section', { class: 'panel' });
  el.append(h('header', { class: 'page-head' }, h('h1', { text: 'Routines' }), h('button', { class: 'primary', text: 'New routine', onclick: () => edit(null) })), listBox, editor);

  const start = (r: Routine): void => {
    const first = store.preset(r.steps[0]!.presetId);
    if (!first) { toast('A mode in this routine no longer exists. Edit the routine.', 'error'); return; }
    app.routineRun = { routine: r, stepIndex: 0, rep: 1 };
    app.go({ name: 'play', req: { presetId: first.id, practice: false, routine: { routineId: r.id, stepIndex: 0, rep: 1 } } });
  };

  const renderList = (): void => {
    clear(listBox);
    if (!store.routines.length) {
      listBox.append(h('p', { class: 'muted', text: 'No routines yet. Start from a suggestion or make your own. Routine lengths here are suggestions, not a proven optimum.' }));
      for (const s of STARTERS) {
        listBox.append(h('div', { class: 'routine-card' },
          h('div', {}, h('h3', { text: s.name }), h('p', { class: 'muted small', text: `${s.steps.map((x) => store.preset(x.presetId)?.name ?? '?').join(' → ')} · ${durationText(routineSeconds(app, s))}` })),
          h('button', { text: 'Use this', onclick: () => edit({ id: newId('routine'), name: s.name, steps: s.steps.map((x) => ({ ...x })), restSeconds: s.restSeconds, updatedAt: Date.now() }) })));
      }
      return;
    }
    for (const r of store.routines) {
      const missing = r.steps.some((s) => !store.preset(s.presetId));
      listBox.append(h('div', { class: 'routine-card' },
        h('div', {}, h('h3', { text: r.name }),
          h('p', { class: 'muted small', text: `${r.steps.map((s) => `${store.preset(s.presetId)?.name ?? 'missing mode'}${s.reps > 1 ? ` ×${s.reps}` : ''}`).join(' → ')} · rest ${r.restSeconds} s · ${durationText(routineSeconds(app, r))}` })),
        h('div', { class: 'row' },
          h('button', { class: 'primary', text: 'Start', disabled: missing, onclick: () => start(r) }),
          h('button', { class: 'ghost', text: 'Edit', onclick: () => edit(r) }),
          h('button', { class: 'ghost danger-text', text: 'Delete', onclick: async () => { if (await confirmDialog('Delete routine?', `“${r.name}” will be removed.`, 'Delete')) { await store.deleteRoutine(r.id); renderList(); } } }))));
    }
  };

  const edit = (r: Routine | null): void => {
    clear(editor);
    const draft = r ? { ...r, steps: r.steps.map((s) => ({ ...s })) } : { id: newId('routine'), name: '', steps: [] as RoutineStep[], restSeconds: 10, updatedAt: Date.now() };
    const name = h('input', { type: 'text', maxlength: '60', value: draft.name, id: 'routine-name' });
    const restIn = h('input', { type: 'number', min: '0', max: '300', step: '5', value: String(draft.restSeconds), id: 'routine-rest' });
    const stepsBox = h('ol', { class: 'steps' });
    const errors = h('div', { class: 'error', role: 'alert' });
    const est = h('p', { class: 'muted small' });
    const presetSel = h('select', { 'aria-label': 'Mode to add' }, store.allPresets().map((p) => h('option', { value: p.id, text: p.name })));
    const renderSteps = (): void => {
      clear(stepsBox);
      draft.steps.forEach((s, i) => {
        const reps = h('input', { type: 'number', min: '1', max: '20', value: String(s.reps), 'aria-label': `Repetitions for step ${i + 1}` });
        reps.addEventListener('input', () => { s.reps = Number(reps.value); est.textContent = durationText(routineSeconds(app, draft)); });
        const move = (d: number) => { const j = i + d; if (j < 0 || j >= draft.steps.length) return; [draft.steps[i], draft.steps[j]] = [draft.steps[j]!, draft.steps[i]!]; renderSteps(); };
        stepsBox.append(h('li', { class: 'row' },
          h('span', { class: 'grow', text: store.preset(s.presetId)?.name ?? 'missing mode' }),
          h('label', { class: 'row' }, '×', reps),
          h('button', { class: 'small ghost', text: '↑', 'aria-label': `Move step ${i + 1} up`, disabled: i === 0, onclick: () => move(-1) }),
          h('button', { class: 'small ghost', text: '↓', 'aria-label': `Move step ${i + 1} down`, disabled: i === draft.steps.length - 1, onclick: () => move(1) }),
          h('button', { class: 'small ghost danger-text', text: 'Remove', 'aria-label': `Remove step ${i + 1}`, onclick: () => { draft.steps.splice(i, 1); renderSteps(); } })));
      });
      est.textContent = draft.steps.length ? `Estimated: ${durationText(routineSeconds(app, { ...draft, restSeconds: Number(restIn.value) || 0 }))}` : '';
    };
    const add = h('button', { text: 'Add step' });
    add.addEventListener('click', () => {
      if (draft.steps.length >= MAX_ROUTINE_STEPS) { errors.textContent = `At most ${MAX_ROUTINE_STEPS} steps.`; return; }
      draft.steps.push({ presetId: presetSel.value, reps: 1 });
      renderSteps();
    });
    restIn.addEventListener('input', renderSteps);
    const save = h('button', { class: 'primary', text: 'Save routine' });
    save.addEventListener('click', async () => {
      const v = sanitizeRoutine({ ...draft, name: name.value, restSeconds: Number(restIn.value) }, (id) => !!store.preset(id));
      if (!v.ok) { errors.textContent = v.errors.join(' '); return; }
      errors.textContent = '';
      if (await store.saveRoutine(v.value)) { toast('Routine saved', 'ok'); clear(editor); renderList(); }
    });
    editor.append(h('h2', { text: r ? 'Edit routine' : 'New routine' }),
      h('label', { for: 'routine-name', text: 'Name' }), name,
      h('label', { for: 'routine-rest', text: 'Rest between runs (seconds)' }), restIn,
      h('h3', { text: 'Steps' }), stepsBox, h('div', { class: 'row' }, presetSel, add), est, errors,
      h('div', { class: 'row' }, save, h('button', { class: 'ghost', text: 'Cancel', onclick: () => clear(editor) })));
    renderSteps();
    name.focus();
  };

  renderList();
  if (editId) {
    const r = store.routines.find((x) => x.id === editId);
    if (r) edit(r);
  }
  return { dispose: () => undefined };
}
