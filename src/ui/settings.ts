import { synth } from '../audio/synth';
import { ENGINE_VERSION } from '../engine/game';
import { detectCapabilities } from '../input/collector';
import { DEFAULT_SETTINGS, newId, sanitizeProfile, type AimContext, type Settings, type SetupProfile } from '../schemas/app';
import type { App, Screen } from './app';
import { append, clear, confirmDialog, h, keyLabel, toast } from './dom';
import { percentile, rt } from './runtime';
import { errorMessage } from './store';

const TABS = ['Look', 'Play', 'Audio', 'Keys', 'Accessibility', 'Profiles', 'Data', 'Diagnostics'] as const;
type Tab = (typeof TABS)[number];

export function mountSettings(app: App, el: HTMLElement, initial?: string): Screen {
  const store = app.store;
  let tab: Tab = (TABS as readonly string[]).includes(initial ?? '') ? (initial as Tab) : 'Look';
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const panel = h('section', { class: 'tab-panel', role: 'tabpanel', tabindex: '0' });
  el.append(h('header', { class: 'page-head' }, h('h1', { text: 'Settings' }), h('button', { class: 'ghost', text: 'Restore defaults (look, play, audio)', onclick: () => restoreDefaults() })), tabBar, panel);
  const cleanups: (() => void)[] = [];

  const set = (patch: Partial<Settings>): void => store.updateSettings(patch);
  const s = (): Settings => store.settings;

  const restoreDefaults = async (): Promise<void> => {
    if (!(await confirmDialog('Restore defaults?', 'Look, feedback, HUD, audio and play settings go back to their defaults. Profiles, keys, history and modes are kept.', 'Restore'))) return;
    const keep = { keyRestart: s().keyRestart, keyMute: s().keyMute, keyFullscreen: s().keyFullscreen, activeProfileId: s().activeProfileId, adaptiveLevels: s().adaptiveLevels, replayRetention: s().replayRetention, textScale: s().textScale, highContrast: s().highContrast, reduceMotion: s().reduceMotion };
    set({ ...DEFAULT_SETTINGS, ...keep });
    render();
  };

  // -------------------------------------------------- controls
  let uid = 0;
  const check = (label: string, key: keyof Settings, help?: string): HTMLElement => {
    const id = `s-${++uid}`;
    const c = h('input', { type: 'checkbox', id, checked: s()[key] === true });
    c.addEventListener('change', () => set({ [key]: c.checked } as Partial<Settings>));
    return h('div', { class: 'field-row' }, h('div', { class: 'check' }, c, h('label', { for: id, text: label })), help ? h('span', { class: 'help small muted', text: help }) : null);
  };
  const range = (label: string, key: keyof Settings, min: number, max: number, step: number, unit: string): HTMLElement => {
    const id = `s-${++uid}`;
    const out = h('output', { for: id, text: `${s()[key]}${unit}` });
    const r = h('input', { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(s()[key]) });
    r.addEventListener('input', () => { out.textContent = `${r.value}${unit}`; set({ [key]: Number(r.value) } as Partial<Settings>); });
    return h('div', { class: 'field-row' }, h('label', { for: id, text: label }), h('div', { class: 'row' }, r, out));
  };
  const color = (label: string, key: 'targetColor' | 'backgroundColor' | 'targetBorderColor'): HTMLElement => {
    const id = `s-${++uid}`;
    const c = h('input', { type: 'color', id, value: s()[key] });
    c.addEventListener('input', () => set({ [key]: c.value } as Partial<Settings>));
    return h('div', { class: 'field-row' }, h('label', { for: id, text: label }), c);
  };
  const choice = <K extends keyof Settings>(label: string, key: K, options: [Settings[K], string][], help?: string): HTMLElement => {
    const id = `s-${++uid}`;
    const sel = h('select', { id }, options.map(([v, t]) => h('option', { value: String(v), text: t, selected: s()[key] === v })));
    sel.addEventListener('change', () => {
      const opt = options.find(([v]) => String(v) === sel.value);
      if (opt) set({ [key]: opt[0] } as Partial<Settings>);
    });
    return h('div', { class: 'field-row' }, h('label', { for: id, text: label }), sel, help ? h('span', { class: 'help small muted', text: help }) : null);
  };

  // -------------------------------------------------- tabs
  const look = (): HTMLElement[] => [
    h('h2', { text: 'Targets' }),
    color('Target colour', 'targetColor'), range('Target opacity', 'targetOpacity', 10, 100, 5, ' %'), range('Target glow', 'targetGlow', 0, 100, 5, ' %'),
    check('3D shading', 'targetShading'), check('Target border', 'targetBorder'), color('Border colour', 'targetBorderColor'),
    check('Centre dot', 'centerDot'), check('Centre crosshair', 'centerCrosshair'), color('Field background', 'backgroundColor'),
    h('h2', { text: 'Feedback' }),
    check('Show where you clicked', 'showHitPlace'), check('Show hit target outlines', 'showHitTrace'), check('Show reaction time over hits', 'showReactionLabel'),
    check('Show misses', 'showMisses'), check('Show lost targets', 'showLosses'), range('Feedback fades after', 'fadeSeconds', 0.2, 10, 0.2, ' s'),
    check('Cursor trail', 'showCursorTrail', 'Draws your recent cursor path (off with reduced motion).'), range('Trail length (samples)', 'trailLength', 0, 200, 10, ''),
    h('h2', { text: 'Heads-up display' }),
    check('Timer', 'showTimer'), check('Score', 'showScore'), check('Live stats', 'showLiveStats'),
    check('Show archived site averages on modes', 'showSiteAverage', 'Values captured 2026-10-22. Not current, not percentiles, and not directly comparable with AimLite scores.'),
  ];

  const play = (): HTMLElement[] => [
    choice('Field size', 'fieldMode', [['classic', 'Classic (55 % of screen width, 600–1056 px)'], ['large', 'Large (fills the window; speeds scaled)']], 'Classic and large runs are compared separately.'),
    choice('Training mouse button', 'mouseButton', [[0, 'Left'], [1, 'Middle'], [2, 'Right'], [3, 'Back (X1)'], [4, 'Forward (X2)']]),
    choice('Countdown', 'countdownSeconds', [[0, 'None'], [1, '1 s'], [2, '2 s'], [3, '3 s'], [4, '4 s'], [5, '5 s']]),
    choice('Input policy', 'inputPolicy', [['legacy-v1', 'Legacy: one sample per move event, rounded path (site-compatible numbers)'], ['precise-v1', 'Precise: every coalesced sample, exact path']], 'Changes path length and trajectory numbers, so each policy has its own bests.'),
    check('Click-rate guard on official modes', 'clickRateGuard', 'Legacy rule: more than 25 clicks inside 2 s cancels the run. Never applied to your custom modes.'),
    h('p', { class: 'muted small', text: 'Adaptive practice (the “Practice” button on a mode) changes size and speed between runs only, within ±5 levels; benchmark runs are never adapted.' }),
    h('button', { class: 'ghost', text: 'Reset all practice levels', onclick: () => { set({ adaptiveLevels: {} }); toast('Practice levels reset', 'ok'); } }),
  ];

  const audio = (): HTMLElement[] => [
    check('Mute', 'muted'), range('Volume', 'volume', 0, 100, 5, ' %'),
    check('Hit sounds', 'soundHit'), check('Miss sounds', 'soundMiss'), check('Lost-target sounds', 'soundLoss'), check('Countdown beeps', 'soundCountdown'), check('Last ten seconds beeps', 'soundLastTen'),
    h('button', { text: 'Test sound', onclick: () => { synth.unlock(); setTimeout(() => synth.play('hit'), 50); } }),
    h('p', { class: 'muted small', text: 'All sounds are synthesised on the fly. Audio starts after your first click or key press and pauses when the window loses focus.' }),
  ];

  const keys = (): HTMLElement[] => {
    const binder = (label: string, key: 'keyRestart' | 'keyMute' | 'keyFullscreen'): HTMLElement => {
      const b = h('button', { text: keyLabel(s()[key]), 'aria-label': `${label}: ${keyLabel(s()[key])}. Press to change.` });
      b.addEventListener('click', () => {
        b.textContent = 'Press a key… (Esc cancels)';
        const onKey = (e: KeyboardEvent): void => {
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener('keydown', onKey, true);
          if (e.key !== 'Escape') {
            const used = (['keyRestart', 'keyMute', 'keyFullscreen'] as const).filter((k) => k !== key && s()[k] === e.code);
            if (['Space', 'Enter', 'Tab'].includes(e.code)) toast('Space, Enter and Tab are reserved.', 'error');
            else if (used.length) toast(`${keyLabel(e.code)} is already used.`, 'error');
            else set({ [key]: e.code } as Partial<Settings>);
          }
          b.textContent = keyLabel(s()[key]);
          b.setAttribute('aria-label', `${label}: ${keyLabel(s()[key])}. Press to change.`);
        };
        document.addEventListener('keydown', onKey, true);
        cleanups.push(() => document.removeEventListener('keydown', onKey, true));
      });
      return h('div', { class: 'field-row' }, h('span', { text: label }), b);
    };
    return [binder('Restart run', 'keyRestart'), binder('Mute / unmute', 'keyMute'), binder('Fullscreen', 'keyFullscreen'),
      h('p', { class: 'muted small', text: 'Fixed keys: Esc cancels a run, Enter starts when the field is focused, Space ends runs that allow it, arrow keys move between modes.' })];
  };

  const access = (): HTMLElement[] => [
    range('Text size', 'textScale', 80, 160, 10, ' %'), check('High contrast', 'highContrast'), check('Reduce motion', 'reduceMotion', 'Shorter transitions, no cursor trail, no hub shake.'),
    h('p', { class: 'muted small', text: 'Status is never shown by colour alone: the hub uses a dashed outline until touched, tracked targets get a white ring, misses are crosses and lost targets dashed rings.' }),
  ];

  const profiles = (): HTMLElement[] => {
    const out: HTMLElement[] = [h('p', { class: 'muted', text: 'A setup profile records the context you train for (game, camera mode, your mouse DPI as you enter it, sensitivity, display). It is saved with each run so you can interpret results. It does not convert sensitivity between games.' })];
    const active = h('select', { 'aria-label': 'Active profile' }, h('option', { value: '', text: 'No profile' }), store.profiles.map((p) => h('option', { value: p.id, text: p.name, selected: p.id === s().activeProfileId })));
    active.addEventListener('change', () => set({ activeProfileId: active.value || null }));
    out.push(h('div', { class: 'field-row' }, h('label', { text: 'Active profile' }), active));
    for (const p of store.profiles) {
      out.push(h('div', { class: 'routine-card' }, h('div', {}, h('h3', { text: p.name }), h('p', { class: 'muted small', text: [p.context, p.experience, p.mouseDpi ? `${p.mouseDpi} DPI (entered)` : '', p.gameSensitivity && `sens ${p.gameSensitivity}`, p.display].filter(Boolean).join(' · ') })),
        h('div', { class: 'row' }, h('button', { class: 'ghost', text: 'Edit', onclick: () => editProfile(p) }), h('button', { class: 'ghost danger-text', text: 'Delete', onclick: async () => { if (await confirmDialog('Delete profile?', `“${p.name}” will be removed. Runs keep the profile name they were saved with.`, 'Delete')) { await store.deleteProfile(p.id); render(); } } }))));
    }
    out.push(h('button', { class: 'primary', text: 'New profile', onclick: () => editProfile(null) }));
    return out;
  };

  const editProfile = (p: SetupProfile | null): void => {
    clear(panel);
    const f = (label: string, value: string, attrs: Record<string, string> = {}) => {
      const id = `p-${++uid}`;
      const i = h('input', { id, value, type: 'text', ...attrs });
      return { el: h('div', { class: 'field-row' }, h('label', { for: id, text: label }), i), i };
    };
    const nm = f('Name', p?.name ?? '', { maxlength: '60' });
    const ctxSel = h('select', { id: 'p-ctx' }, ([['free-cursor', 'Free cursor (menus, top-down)'], ['shift-lock', 'Shift-lock / locked camera'], ['first-person', 'First person'], ['desktop', 'Desktop / general'], ['other', 'Other']] as [AimContext, string][]).map(([v, t]) => h('option', { value: v, text: t, selected: (p?.context ?? 'free-cursor') === v })));
    const ex = f('Game / experience', p?.experience ?? '', { maxlength: '80' });
    const dpi = f('Mouse DPI (as you know it)', p?.mouseDpi ? String(p.mouseDpi) : '', { type: 'number', min: '50', max: '64000' });
    const sens = f('Game sensitivity', p?.gameSensitivity ?? '', { maxlength: '40' });
    const disp = f('Display', p?.display ?? '', { maxlength: '80', placeholder: 'e.g. 27" 1440p 144 Hz' });
    const notes = h('textarea', { id: 'p-notes', maxlength: '500', rows: '3' });
    notes.value = p?.notes ?? '';
    const err = h('p', { class: 'error', role: 'alert' });
    const save = h('button', { class: 'primary', text: 'Save profile' });
    save.addEventListener('click', async () => {
      const v = sanitizeProfile({ id: p?.id ?? newId('profile'), name: nm.i.value, context: ctxSel.value, experience: ex.i.value, mouseDpi: dpi.i.value ? Number(dpi.i.value) : null, gameSensitivity: sens.i.value, display: disp.i.value, notes: notes.value });
      if (!v) { err.textContent = 'Give the profile a name.'; return; }
      if (dpi.i.value && v.mouseDpi === null) { err.textContent = 'DPI must be 50 to 64000.'; return; }
      if (await store.saveProfile(v)) { tab = 'Profiles'; render(); }
    });
    panel.append(h('h2', { text: p ? 'Edit profile' : 'New profile' }), nm.el, h('div', { class: 'field-row' }, h('label', { for: 'p-ctx', text: 'Camera / cursor context' }), ctxSel), ex.el, dpi.el, sens.el, disp.el,
      h('div', { class: 'field-row' }, h('label', { for: 'p-notes', text: 'Notes' }), notes), err, h('div', { class: 'row' }, save, h('button', { class: 'ghost', text: 'Cancel', onclick: () => render() })));
    nm.i.focus();
  };

  const data = (): HTMLElement[] => {
    const st = store.storage;
    const out: (HTMLElement | null)[] = [
      h('h2', { text: 'Where your data lives' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Data folder' }), h('dd', { class: 'mono', text: st?.dataDir ?? 'not stored (browser preview)' }),
        h('dt', { text: 'Database' }), h('dd', { class: 'mono', text: st?.databasePath ?? '—' }),
        h('dt', { text: 'Automatic backups' }), h('dd', { class: 'mono', text: st?.backupsDir ?? '—' }),
        h('dt', { text: 'Schema' }), h('dd', { text: `${st?.schemaVersion ?? '—'} (this version reads ${st?.supportedSchemaVersion ?? '—'})` })),
      st?.readOnly ? h('p', { class: 'error', text: `Read-only: ${st.readOnlyReason}. Back up or export before doing anything else.` }) : null,
      h('p', { class: 'muted small', text: 'Uninstalling AimLite keeps this folder. Delete it yourself to remove all data.' }),
      h('h2', { text: 'Replays' }),
      choice('Keep detailed replays for', 'replayRetention', [['all', 'All runs'], ['recent-200', 'The latest 200 runs and your bests'], ['pb-only', 'Only your bests'], ['none', 'No runs (summaries only)']], 'Summaries, scores and bests are always kept.'),
      h('button', { class: 'ghost', text: 'Apply retention now', onclick: async () => { try { const n = await store.bridge.pruneReplays(s().replayRetention); toast(`Removed ${n} replay${n === 1 ? '' : 's'}`, 'ok'); } catch (e) { toast(errorMessage(e), 'error'); } } }),
      h('h2', { text: 'Export and backup' }),
      h('div', { class: 'row wrap' },
        h('button', { text: 'Export all runs (CSV)', onclick: async () => { try { const p = await store.bridge.exportRunsCsv(null); if (p) toast(`Exported to ${p}`, 'ok'); } catch (e) { toast(errorMessage(e), 'error'); } } }),
        h('button', { text: 'Back up database…', onclick: async () => { try { const p = await store.bridge.backupDatabase(); if (p) toast(`Backup written to ${p}`, 'ok'); } catch (e) { toast(errorMessage(e), 'error'); } } })),
      h('h2', { text: 'Reset' }),
      h('p', { class: 'muted small', text: 'Both resets first write a full backup into the backups folder above.' }),
      h('div', { class: 'row wrap' },
        h('button', { class: 'danger', text: 'Delete all run history…', disabled: !!st?.readOnly, onclick: async () => {
          if (!(await confirmDialog('Delete all run history?', 'Every run, best and replay is removed. Modes, routines, profiles and settings stay. A backup is written first.', 'Delete history', 'DELETE'))) return;
          try { const b = await store.bridge.resetData('runs'); await store.refreshPbs(); toast(`History deleted. Backup: ${b}`, 'ok', undefined, 12000); } catch (e) { toast(errorMessage(e), 'error'); }
        } }),
        h('button', { class: 'danger', text: 'Reset everything…', disabled: !!st?.readOnly, onclick: async () => {
          if (!(await confirmDialog('Reset everything?', 'History, custom modes, routines, profiles and settings are all removed. A backup is written first.', 'Reset everything', 'RESET'))) return;
          try { const b = await store.bridge.resetData('everything'); await store.load(); app.applySettings(); toast(`Everything reset. Backup: ${b}`, 'ok', undefined, 12000); render(); } catch (e) { toast(errorMessage(e), 'error'); }
        } })),
    ];
    return out.filter(Boolean) as HTMLElement[];
  };

  const diagnostics = (): HTMLElement[] => {
    const box = h('div', {}, h('p', { class: 'muted', text: 'Reading system information…' }));
    const report: Record<string, unknown> = { engineVersion: ENGINE_VERSION, collectedAt: new Date().toISOString() };
    const caps = { legacy: detectCapabilities('legacy-v1'), precise: detectCapabilities('precise-v1') };
    report.input = caps;
    report.display = { devicePixelRatio: rt.dpr(), screen: typeof screen !== 'undefined' ? { width: screen.width, height: screen.height } : null, window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight } };
    void store.bridge.diagnostics().then((d) => {
      report.native = d;
      clear(box);
      const acc = d.mouseAcceleration;
      append(box, [h('dl', { class: 'kv' },
        h('dt', { text: 'App' }), h('dd', { text: `${d.appVersion} (${d.identifier}), engine ${ENGINE_VERSION}` }),
        h('dt', { text: 'Windows' }), h('dd', { text: d.os }),
        h('dt', { text: 'WebView2 runtime' }), h('dd', { text: d.webview2Version ?? 'unavailable' }),
        h('dt', { text: 'Pointer speed' }), h('dd', { text: d.mouseSpeed === null ? 'unavailable' : `${d.mouseSpeed} of 20${d.mouseSpeed === 10 ? ' (default)' : ''}` }),
        h('dt', { text: 'Enhance pointer precision' }), h('dd', { text: acc === null ? 'unavailable' : acc.enabled ? `on (acceleration flag ${acc.enabled}, thresholds ${acc.threshold1}/${acc.threshold2})` : 'off' }),
        h('dt', { text: 'Window DPI / scale' }), h('dd', { text: `${d.windowDpi ?? 'unavailable'} DPI · scale ${d.scaleFactor ?? '?'} · devicePixelRatio ${rt.dpr()}` }),
        h('dt', { text: 'Monitors' }), h('dd', { text: d.monitors.length ? d.monitors.map((m) => `${m.name ?? 'monitor'} ${m.width}×${m.height} @${m.scaleFactor}`).join('; ') : 'unavailable' }),
        h('dt', { text: 'Mouse DPI' }), h('dd', { text: 'not detectable: enter it in a setup profile' }),
        h('dt', { text: 'Input stream' }), h('dd', { text: `legacy: ${caps.legacy.stream}; precise: ${caps.precise.stream} (secure context ${caps.legacy.secureContext ? 'yes' : 'no'})` }),
        h('dt', { text: 'Data folder' }), h('dd', { class: 'mono', text: d.dataDir ?? '—' }),
        h('dt', { text: 'Database size' }), h('dd', { text: d.databaseBytes === null ? '—' : `${(d.databaseBytes / 1024).toFixed(0)} KB` })),
        d.errors.length ? h('p', { class: 'muted small', text: `Notes: ${d.errors.join('; ')}` }) : null]);
    }).catch((e) => { clear(box); box.append(h('p', { class: 'error', text: `Diagnostics unavailable: ${errorMessage(e)}` })); });

    const frameOut = h('p', { 'aria-live': 'polite' });
    const frameBtn = h('button', { text: 'Measure display frames (3 s)' });
    frameBtn.addEventListener('click', () => {
      frameBtn.setAttribute('disabled', '');
      frameOut.textContent = 'Measuring… keep this window in front.';
      const iv: number[] = [];
      let last = 0;
      const t0 = rt.now();
      const step = (t: number): void => {
        if (last) iv.push(t - last);
        last = t;
        if (rt.now() - t0 < 3000) rt.raf(step);
        else {
          const med = percentile(iv, 50);
          const r = { frames: iv.length, medianMs: med, p95Ms: percentile(iv, 95), p99Ms: percentile(iv, 99), approxHz: med ? Math.round(1000 / med) : null, longFrames: iv.filter((x) => med !== null && x > med * 1.5).length };
          report.frames = r;
          frameOut.textContent = `${r.frames} frames · median ${r.medianMs?.toFixed(2)} ms (≈${r.approxHz} Hz) · p95 ${r.p95Ms?.toFixed(2)} ms · p99 ${r.p99Ms?.toFixed(2)} ms · ${r.longFrames} frames over 1.5× median. App timing only, not click-to-photon latency.`;
          frameBtn.removeAttribute('disabled');
        }
      };
      rt.raf(step);
    });

    const inputOut = h('p', { 'aria-live': 'polite' });
    const inputBtn = h('button', { text: 'Measure mouse input (move the mouse for 3 s)' });
    inputBtn.addEventListener('click', () => {
      inputBtn.setAttribute('disabled', '');
      inputOut.textContent = 'Move the mouse continuously…';
      const precise = caps.precise;
      const type = precise.stream.startsWith('pointerrawupdate') ? 'pointerrawupdate' : 'pointermove';
      let events = 0;
      let samples = 0;
      const uniq = new Set<string>();
      let first = 0;
      const onMove = (e: Event): void => {
        const pe = e as PointerEvent;
        if (!first) first = pe.timeStamp;
        events++;
        const list = precise.coalescedEvents ? pe.getCoalescedEvents() : [];
        for (const c of list.length ? list : [pe]) { samples++; uniq.add(`${c.timeStamp.toFixed(3)}:${c.clientX}:${c.clientY}`); }
      };
      window.addEventListener(type, onMove);
      setTimeout(() => {
        window.removeEventListener(type, onMove);
        const secs = 3;
        const r = { stream: precise.stream, eventsPerSecond: Math.round(events / secs), samplesPerSecond: Math.round(samples / secs), uniqueSamplesPerSecond: Math.round(uniq.size / secs) };
        report.inputRate = r;
        inputOut.textContent = events ? `${r.stream}: ${r.eventsPerSecond} events/s, ${r.uniqueSamplesPerSecond} unique samples/s. Observed delivery in this window, not your mouse's hardware polling rate.` : 'No movement seen. Try again and keep moving the mouse over this window.';
        inputBtn.removeAttribute('disabled');
      }, 3000);
    });

    const exportBtn = h('button', { class: 'ghost', text: 'Export diagnostics (JSON)' });
    exportBtn.addEventListener('click', async () => {
      try {
        const p = await store.bridge.exportText('diagnostics', `aimlite-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 1));
        if (p) toast(`Exported to ${p}`, 'ok');
      } catch (e) { toast(errorMessage(e), 'error'); }
    });
    return [h('p', { class: 'muted small', text: 'Everything here is read-only: AimLite never changes Windows mouse or display settings.' }), box, h('h2', { text: 'Probes' }), frameBtn, frameOut, inputBtn, inputOut, exportBtn];
  };

  const render = (): void => {
    for (const c of cleanups.splice(0)) c();
    clear(tabBar);
    for (const t of TABS) {
      const b = h('button', { role: 'tab', class: t === tab ? 'tab current' : 'tab', 'aria-selected': t === tab ? 'true' : 'false', tabindex: t === tab ? '0' : '-1', text: t, id: `tab-${t}` });
      b.addEventListener('click', () => { tab = t; render(); });
      b.addEventListener('keydown', (e) => {
        const i = TABS.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
          render();
          document.getElementById(`tab-${tab}`)?.focus();
        }
      });
      tabBar.append(b);
    }
    clear(panel);
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    const content = { Look: look, Play: play, Audio: audio, Keys: keys, Accessibility: access, Profiles: profiles, Data: data, Diagnostics: diagnostics }[tab]();
    panel.append(...content);
  };
  render();
  return { dispose: () => { for (const c of cleanups.splice(0)) c(); void store.flushSettings(); } };
}
