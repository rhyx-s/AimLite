import type { PersonalBest } from '../bridge/types';
import type { RunSeries } from '../engine/summary';
import type { ModeConfig } from '../engine/types';
import { chart, type Series } from '../render/graph';
import type { RunRecord, RunReplay } from '../schemas/app';
import type { Preset } from '../schemas/preset';
import type { App, Screen } from './app';
import { announce, append, fmt, fmtMs, h, keyLabel, toast } from './dom';
import { scoreText } from './modes';
import { nextRoutineStep } from './routines';
import { errorMessage, type PlayRequest } from './store';

export interface FinishedRun {
  preset: Preset;
  record: RunRecord;
  replay: RunReplay | null;
  req: PlayRequest | null;
  pbBefore: PersonalBest | null;
  save: { state: 'saving' | 'saved' | 'failed' | 'history'; error?: string; promise?: Promise<void> };
  practiceChange: { from: number; to: number; reason: string } | null;
}

/** Bounded change of the practice level between runs (never inside a run). */
export function nextPracticeLevel(level: number, rec: RunRecord): { to: number; reason: string } {
  const s = rec.summary;
  let to = level;
  let reason = 'kept: not enough data';
  if (rec.status !== 'completed') return { to, reason: 'kept: the run did not complete' };
  if (s.scoreMode === 1) {
    const share = s.durationMs > 0 ? (s.trackingSeconds * 1000) / s.durationMs : 0;
    if (share >= 0.6) { to = level + 1; reason = `harder: on target ${Math.round(share * 100)} % of the time (≥ 60 %)`; }
    else if (share < 0.35) { to = level - 1; reason = `easier: on target ${Math.round(share * 100)} % of the time (< 35 %)`; }
    else reason = `kept: on target ${Math.round(share * 100)} % of the time`;
  } else if (s.hitRate !== null) {
    const lossShare = s.losses / Math.max(1, s.hits + s.losses);
    if (s.hitRate >= 0.9 && lossShare <= 0.1) { to = level + 1; reason = `harder: ${Math.round(s.hitRate * 100)} % hit rate, few lost targets`; }
    else if (s.hitRate < 0.7 || lossShare > 0.3) { to = level - 1; reason = `easier: ${Math.round(s.hitRate * 100)} % hit rate, ${Math.round(lossShare * 100)} % of targets lost`; }
    else reason = `kept: ${Math.round(s.hitRate * 100)} % hit rate`;
  }
  return { to: Math.max(-5, Math.min(5, to)), reason };
}

/** Called when a run ends: starts the save in the background and returns the results model. */
export function finishRun(app: App, preset: Preset, record: RunRecord, s: RunSeries, req: PlayRequest | null): FinishedRun {
  const store = app.store;
  const replay: RunReplay = { kind: s.stride > 1 ? 'preview' : 'full', series: s };
  const run: FinishedRun = { preset, record, replay, req, pbBefore: store.pbs.get(record.comparisonKey) ?? null, save: { state: 'saving' }, practiceChange: null };
  if (record.practice) {
    const from = record.practice.adaptiveLevel;
    const n = nextPracticeLevel(from, record);
    run.practiceChange = { from, to: n.to, reason: n.reason };
    if (n.to !== from) store.updateSettings({ adaptiveLevels: { ...store.settings.adaptiveLevels, [preset.id]: n.to } });
  }
  void saveRun(app, run);
  return run;
}

/** Save in the background. Mutates run.save in place so a screen holding the object sees the outcome. */
function saveRun(app: App, run: FinishedRun): Promise<void> {
  const store = app.store;
  const save = run.save;
  save.error = undefined;
  if (store.readOnly) {
    save.state = 'failed';
    save.error = 'Your data is open read-only, so this run was not saved. Export it below.';
    save.promise = Promise.resolve();
    return save.promise;
  }
  save.state = 'saving';
  save.promise = (async () => {
    try {
      await store.bridge.saveRun(run.record, run.replay, store.settings.replayRetention);
      save.state = 'saved';
      await store.refreshPbs();
    } catch (e) {
      save.state = 'failed';
      save.error = errorMessage(e);
    }
  })();
  return save.promise;
}

export function mountResults(app: App, el: HTMLElement, run: FinishedRun): Screen {
  const store = app.store;
  const { preset, record } = run;
  const sum = record.summary;
  const mode = sum.scoreMode;
  const lower = sum.direction === 'lower';
  // the config the run actually used (large-field / practice adjustments included)
  const runCfg = (record.config ?? preset.config) as ModeConfig;
  let disposed = false;

  const status = h('p', { class: 'save-status', role: 'status' });
  const statusActions = h('div', { class: 'row' });
  const renderStatus = (): void => {
    statusActions.textContent = '';
    switch (run.save.state) {
      case 'saving': status.textContent = 'Saving…'; break;
      case 'saved': status.textContent = record.valid ? 'Saved to your history.' : 'Saved to your history (not eligible as a best).'; break;
      case 'history': status.textContent = 'From your history.'; break;
      case 'failed':
        status.textContent = `Not saved: ${run.save.error ?? 'unknown error'}`;
        status.classList.add('error');
        statusActions.append(
          h('button', { text: 'Retry save', onclick: async () => { status.classList.remove('error'); const p = saveRun(app, run); renderStatus(); await p; if (!disposed) renderStatus(); } }),
          h('button', { class: 'ghost', text: 'Export run (JSON)', onclick: () => exportRun() }));
        break;
    }
  };
  const exportRun = async (): Promise<void> => {
    try {
      const p = await store.bridge.exportText('run', `${preset.name}-${new Date(record.startedAt).toISOString().slice(0, 19).replace(/:/g, '-')}.json`, JSON.stringify({ format: 'aimlite-run', formatVersion: 1, record, replay: run.replay }));
      if (p) toast(`Exported to ${p}`, 'ok');
    } catch (e) {
      toast(`Export failed: ${errorMessage(e)}`, 'error');
    }
  };

  // PB comparison: only against valid runs with the same comparison key
  let pbLine: string;
  const before = run.pbBefore;
  if (!record.valid) pbLine = record.status === 'cancelled' ? 'Cancelled runs never count as bests.' : 'This run is not eligible as a best (no completed hits).';
  else if (!before) pbLine = 'First valid run for this setup: it is your best.';
  else {
    const better = lower ? sum.score < before.score : sum.score > before.score;
    const diff = sum.score - before.score;
    pbLine = better ? `New best! Previous: ${scoreText(before.score, mode)}.` : `Best: ${scoreText(before.score, mode)} (${diff >= 0 ? '+' : ''}${mode >= 2 ? diff.toFixed(3) + ' s' : fmt(diff)}).`;
  }

  const tile = (label: string, value: string, note?: string): HTMLElement =>
    h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: label }), h('span', { class: 'tile-value', text: value }), note ? h('span', { class: 'tile-note muted', text: note }) : null);

  const tiles = h('div', { class: 'tiles' },
    tile('Score', scoreText(sum.score, mode), lower ? 'lower is better' : undefined),
    mode === 1 ? tile('On target', `${sum.trackingSeconds.toFixed(1)} s`, sum.durationMs ? `${Math.round((sum.trackingSeconds * 100000) / sum.durationMs)} % of the run` : undefined) : null,
    tile('Hits', String(sum.hits), sum.multiHits ? `${sum.multiHits} sets` : undefined),
    mode !== 1 ? tile('Misses', String(sum.misses)) : null,
    tile('Lost', String(sum.losses)),
    sum.hitRate !== null ? tile('Hit rate', `${Math.round(sum.hitRate * 100)} %`, 'hits ÷ clicks') : null,
    tile('Centre precision', sum.precision.avg !== null ? `${fmt(sum.precision.avg, 1)} %` : '—', 'how close to the centre'),
    tile('Reaction', fmtMs(sum.reaction.avg), sum.reaction.min !== null ? `best ${fmtMs(sum.reaction.min)}` : undefined),
    tile('Aim time', fmtMs(sum.aiming.avg), 'between hits'),
    tile('Path efficiency', sum.eff.avg !== null ? `${fmt(sum.eff.avg, 1)} %` : '—', 'straight ÷ actual path'),
    tile('Hits per minute', fmt(sum.hpm.avg, 0)),
    tile('Best combo', String(sum.comboMax)),
    tile('Duration', fmtMs(sum.durationMs, 1)),
  );

  const breakdown = h('table', { class: 'breakdown' }, h('caption', { text: 'Points breakdown' }), h('tbody', {},
    mode === 0 ? [
      row('Hit points', `+${fmt((runCfg.multiMode ? sum.multiHits : sum.hits) * runCfg.spHit)}`),
      sum.bonusTotals.precision ? row('Precision bonus', `+${fmt(sum.bonusTotals.precision)}`) : null,
      sum.bonusTotals.reaction ? row('Reaction bonus', `+${fmt(sum.bonusTotals.reaction)}`) : null,
      sum.bonusTotals.eff ? row('Path bonus', `+${fmt(sum.bonusTotals.eff)}`) : null,
      sum.bonusTotals.distance ? row('Distance bonus', `+${fmt(sum.bonusTotals.distance)}`) : null,
      sum.missPoints ? row('Misses', `−${fmt(sum.missPoints)}`) : null,
      sum.lossPoints ? row('Lost targets', `−${fmt(sum.lossPoints)}`) : null,
    ] : mode === 2 ? [row('Time', fmtMs(sum.durationMs)), row('Miss penalties', `+${sum.penaltySeconds} s`)]
      : mode === 3 ? sum.attempts.map((a, i) => row(`Try ${i + 1}`, `${a.time.toFixed(3)} s${a.penalty ? ` (incl. ${a.penalty} s penalty)` : ''}`))
        : [row('Ticks on target', String(Math.round(sum.trackingSeconds * 61)))]));

  const head = h('header', { class: 'page-head' },
    h('div', {}, h('h1', { text: `${preset.name} — ${record.status === 'completed' ? 'results' : 'cancelled'}` }),
      h('p', { class: 'muted', text: `${record.practice ? `Adaptive practice (level ${record.practice.adaptiveLevel}) · ` : ''}${record.field.mode === 'classic' ? 'Classic' : 'Large'} field ${record.field.width}×${record.field.height} · ${record.inputPolicy === 'legacy-v1' ? 'legacy' : 'precise'} input${record.profileName ? ` · profile ${record.profileName}` : ''}` })),
    h('p', { class: 'pb-line', text: pbLine }));

  // actions
  const actions = h('div', { class: 'row' });
  const retry = run.req ? h('button', { class: 'primary', text: `Retry (${keyLabel(store.settings.keyRestart)})`, onclick: () => app.go({ name: 'play', req: { ...run.req!, routine: undefined } }) }) : null;
  if (app.routineRun && run.req?.routine) {
    const next = nextRoutineStep(app, app.routineRun);
    if (next) actions.append(h('button', { class: 'primary', text: `Next: ${next.label}`, onclick: () => next.go() }));
    else actions.append(h('button', { class: 'primary', text: 'Routine complete — back to routines', onclick: () => { app.routineRun = null; app.go({ name: 'routines' }); } }));
    actions.append(h('button', { class: 'ghost', text: 'Exit routine', onclick: () => { app.routineRun = null; app.go({ name: 'routines' }); } }));
  }
  if (retry) actions.append(retry);
  actions.append(h('button', { class: 'ghost', text: 'Modes', onclick: () => app.go({ name: 'modes' }) }), h('button', { class: 'ghost', text: 'Progress', onclick: () => app.go({ name: 'progress', presetId: preset.id }) }), h('button', { class: 'ghost', text: 'Export run', onclick: () => exportRun() }));

  append(el, [head, actions, h('div', { class: 'row' }, status, statusActions), tiles,
    run.practiceChange ? h('p', { class: 'note', text: `Practice level ${run.practiceChange.from} → ${run.practiceChange.to} (${run.practiceChange.reason}). Practice results are kept apart from benchmark bests.` }) : null]);

  const s = run.replay?.series ?? null;
  if (s) {
    el.append(h('div', { class: 'results-grid' }, replayView(s, store.settings.backgroundColor), missMap(s)));
    el.append(h('div', { class: 'charts' }, ...charts(s, mode, lower)));
  } else {
    el.append(h('p', { class: 'muted', text: 'No replay data stored for this run (replay retention setting).' }));
  }
  el.append(breakdown);

  const onKey = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT')) return;
    if (e.code === store.settings.keyRestart && retry && !e.ctrlKey) { e.preventDefault(); retry.click(); }
  };
  document.addEventListener('keydown', onKey);
  renderStatus();
  if (run.save.state === 'saving' && run.save.promise) {
    void run.save.promise.then(() => {
      if (disposed) return;
      renderStatus();
      announce(run.save.state === 'saved' ? 'Run saved' : 'Run not saved');
    });
  }
  announce(`${preset.name} finished. Score ${scoreText(sum.score, mode)}. ${pbLine}`);
  return { dispose: () => { disposed = true; document.removeEventListener('keydown', onKey); } };
}

function row(k: string, v: string): HTMLElement {
  return h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: v }));
}

/** All hits, clicks, misses and losses over the field, with the best reaction marked. */
function replayView(s: RunSeries, bg: string): HTMLElement {
  const W = s.field.width;
  const H = s.field.height;
  const scale = Math.min(1, 520 / W);
  const c = h('canvas', { width: Math.round(W * scale * 2), height: Math.round(H * scale * 2), role: 'img', class: 'replay' });
  c.style.width = `${Math.round(W * scale)}px`;
  const best = s.hits.filter((x) => !x.byTracking).reduce<null | (typeof s.hits)[number]>((b, x) => (!b || x.reaction < b.reaction ? x : b), null);
  c.setAttribute('aria-label', `Replay: ${s.hits.length} hits, ${s.misses.length} misses, ${s.losses.length} lost targets${best ? `, best reaction ${(best.reaction / 1000).toFixed(3)} s` : ''}.`);
  const ctx = (() => { try { return c.getContext('2d'); } catch { return null; } })();
  if (ctx) {
    ctx.setTransform(2 * scale, 0, 0, 2 * scale, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // cursor path (possibly decimated preview)
    ctx.strokeStyle = 'rgba(180,160,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i + 2 < s.samples.length; i += 3) {
      const x = s.samples[i + 1]!;
      const y = s.samples[i + 2]!;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (s.checkpoint) {
      ctx.strokeStyle = 'rgba(80,200,120,0.6)';
      ctx.beginPath(); ctx.arc(s.checkpoint.x, s.checkpoint.y, s.checkpoint.radius, 0, Math.PI * 2); ctx.stroke();
    }
    for (const x of s.hits) {
      ctx.beginPath(); ctx.arc(x.x, x.y, x.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180,140,255,0.14)'; ctx.fill();
      ctx.strokeStyle = x === best ? 'rgba(255,220,60,0.95)' : 'rgba(180,140,255,0.55)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x.mouseX, x.mouseY, 2, 0, Math.PI * 2);
      ctx.strokeStyle = x.precision === 100 ? 'rgba(255,220,60,1)' : 'rgba(255,255,255,0.8)'; ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,90,90,0.9)';
    ctx.lineWidth = 1.5;
    for (const m of s.misses) {
      ctx.beginPath(); ctx.moveTo(m.x - 3, m.y - 3); ctx.lineTo(m.x + 3, m.y + 3); ctx.moveTo(m.x + 3, m.y - 3); ctx.lineTo(m.x - 3, m.y + 3); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,170,60,0.8)';
    ctx.setLineDash([3, 3]);
    for (const l of s.losses) { ctx.beginPath(); ctx.arc(l.x, l.y, 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    if (best) {
      ctx.fillStyle = '#ffdc3c';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${(best.reaction / 1000).toFixed(3)} s`, best.x, best.y - best.radius - 4);
    }
  }
  return h('figure', { class: 'panel' }, h('figcaption', { text: `Replay${s.stride > 1 ? ' (path decimated)' : ''}` }), c,
    h('p', { class: 'muted small', text: 'Rings: targets you hit (yellow = best reaction). Dots: where you clicked (yellow = dead centre). ✕ misses, dashed rings lost targets.' }));
}

/**
 * Where clicks land relative to the target, in target radii. Misses are only placed when exactly
 * one target was live (otherwise the intended target is unknown, and they stay unclassified).
 * Over/undershoot is measured along the approach direction from the previous click.
 */
function missMap(s: RunSeries): HTMLElement {
  const pts: { dx: number; dy: number; hit: boolean; along: number | null }[] = [];
  let prev: { x: number; y: number } | null = null;
  for (const x of s.hits) {
    if (x.byTracking) continue;
    const dx = (x.mouseX - x.x) / x.radius;
    const dy = (x.mouseY - x.y) / x.radius;
    let along: number | null = null;
    if (prev) {
      const ax = x.x - prev.x;
      const ay = x.y - prev.y;
      const len = Math.hypot(ax, ay);
      if (len > 2 * x.radius) along = (dx * ax + dy * ay) / len;
    }
    pts.push({ dx, dy, hit: true, along });
    prev = { x: x.mouseX, y: x.mouseY };
  }
  const n = pts.length;
  const box = h('figure', { class: 'panel' }, h('figcaption', { text: 'Click offsets (in target radii)' }));
  if (!n) {
    box.append(h('p', { class: 'muted', text: 'No clicked hits in this run.' }));
    return box;
  }
  const size = 220;
  const c = h('canvas', { width: size * 2, height: size * 2, role: 'img', class: 'missmap' });
  c.style.width = `${size}px`;
  const mx = pts.reduce((a, p) => a + p.dx, 0) / n;
  const my = pts.reduce((a, p) => a + p.dy, 0) / n;
  const alongs = pts.map((p) => p.along).filter((v): v is number => v !== null);
  const over = alongs.filter((v) => v > 0.15).length;
  const under = alongs.filter((v) => v < -0.15).length;
  const dir = (v: number, pos: string, neg: string): string => (Math.abs(v) < 0.05 ? '' : v > 0 ? pos : neg);
  const bias = [dir(mx, 'right', 'left'), dir(my, 'low', 'high')].filter(Boolean).join(' and ');
  c.setAttribute('aria-label', `Average offset ${mx.toFixed(2)}, ${my.toFixed(2)} radii${bias ? ` (${bias})` : ''}.`);
  const ctx = (() => { try { return c.getContext('2d'); } catch { return null; } })();
  if (ctx) {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const R = size / 2 - 10;
    const cx = size / 2;
    ctx.strokeStyle = 'rgba(140,150,170,0.6)';
    ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cx, R / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cx); ctx.lineTo(cx + R, cx); ctx.moveTo(cx, cx - R); ctx.lineTo(cx, cx + R); ctx.stroke();
    ctx.fillStyle = 'rgba(180,140,255,0.85)';
    for (const p of pts) { ctx.beginPath(); ctx.arc(cx + p.dx * R, cx + p.dy * R, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#5ab0ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx + mx * R, cx + my * R, 5, 0, Math.PI * 2); ctx.stroke();
  }
  box.append(c, h('ul', { class: 'small' },
    h('li', { text: `Average offset: ${mx.toFixed(2)} x, ${my.toFixed(2)} y radii${bias ? ` — you tend to click ${bias} of centre` : ' — centred'}` }),
    alongs.length ? h('li', { text: `Along your approach: ${over} overshoots, ${under} undershoots, ${alongs.length - over - under} on line (of ${alongs.length} long moves)` }) : null,
    s.misses.length ? h('li', { text: `${s.misses.length} miss${s.misses.length === 1 ? ' is' : 'es are'} shown on the replay; misses are not assigned to a target here.` }) : null));
  return box;
}

function charts(s: RunSeries, mode: number, lower: boolean): HTMLElement[] {
  const sec = (ms: number): number => ms / 1000;
  const out: HTMLElement[] = [];
  const fs = (v: number) => `${v.toFixed(0)} s`;
  if (s.score.length) {
    out.push(chart({ title: mode === 1 ? 'Score (sampled each second)' : 'Score over the run', xLabel: 'Time (s)', yLabel: mode === 3 ? 'Avg reaction (s)' : 'Points', formatX: fs, lowerIsBetter: lower, series: [{ label: 'Score', points: s.score.map((p) => ({ x: sec(p.t), y: p.v })), step: mode !== 3 }] }));
  }
  const clicked = s.hits.filter((x) => !x.byTracking);
  if (clicked.length) {
    out.push(chart({ title: 'Reaction time per hit', xLabel: 'Time (s)', yLabel: 'Reaction (ms)', formatX: fs, lowerIsBetter: true, series: [{ label: 'Reaction', points: clicked.map((x) => ({ x: sec(x.t), y: x.reaction })), dots: true }] }));
    out.push(chart({ title: 'Centre precision per hit', xLabel: 'Time (s)', yLabel: 'Precision (%)', formatX: fs, series: [{ label: 'Precision', points: clicked.map((x) => ({ x: sec(x.t), y: x.precision })), dots: true }] }));
    const later = clicked.slice(1);
    if (later.length) out.push(chart({ title: 'Path efficiency per hit (from the 2nd hit)', xLabel: 'Time (s)', yLabel: 'Efficiency (%)', formatX: fs, series: [{ label: 'Efficiency', points: later.map((x) => ({ x: sec(x.t), y: x.eff })), dots: true }] }));
  }
  const counters: Series[] = [];
  if (s.hits.length) counters.push({ label: 'Hits', points: s.hits.map((x, i) => ({ x: sec(x.t), y: i + 1 })), step: true });
  if (s.misses.length) counters.push({ label: 'Misses', points: s.misses.map((x, i) => ({ x: sec(x.t), y: i + 1 })), step: true });
  if (s.losses.length) counters.push({ label: 'Lost', points: s.losses.map((x, i) => ({ x: sec(x.t), y: i + 1 })), step: true });
  if (counters.length) out.push(chart({ title: 'Running totals', xLabel: 'Time (s)', yLabel: 'Count', formatX: fs, formatY: (v) => v.toFixed(0), series: counters }));
  return out;
}
