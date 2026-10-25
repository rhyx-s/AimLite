import type { RunRow } from '../bridge/types';
import { chart } from '../render/graph';
import type { RunRecord } from '../schemas/app';
import type { App, Screen } from './app';
import { append, clear, confirmDialog, fmt, fmtDate, fmtMs, h, toast } from './dom';
import { scoreText } from './modes';
import { errorMessage } from './store';

const PAGE = 20;

/** Median and median absolute deviation of the last n values (null when empty). */
export function recentStats(scores: number[], n = 10): { median: number | null; mad: number | null; count: number } {
  const last = scores.slice(-n);
  if (!last.length) return { median: null, mad: null, count: 0 };
  const med = (v: number[]): number => {
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const m = med(last);
  return { median: m, mad: med(last.map((v) => Math.abs(v - m))), count: last.length };
}

function setupLabel(r: RunRow): string {
  const f = r.field as RunRecord['field'] | null;
  const parts = [f ? `${f.mode === 'classic' ? 'Classic' : 'Large'} ${f.width}×${f.height}` : 'unknown field', r.inputPolicy === 'precise-v1' ? 'precise input' : 'legacy input'];
  if (r.practiceLevel !== null) parts.push(`practice ${r.practiceLevel > 0 ? '+' : ''}${r.practiceLevel}`);
  return parts.join(', ');
}

export function mountProgress(app: App, el: HTMLElement, presetId?: string): Screen {
  const store = app.store;
  let filter = presetId ?? '';
  let page = 0;
  let disposed = false;
  const select = h('select', { 'aria-label': 'Mode' }, h('option', { value: '', text: 'All modes' }), store.allPresets().map((p) => h('option', { value: p.id, text: p.name, selected: p.id === filter })));
  const exportBtn = h('button', { class: 'ghost', text: 'Export CSV' });
  const summaryBox = h('section', { class: 'progress-summary', 'aria-live': 'polite' });
  const tableBox = h('section', {});
  el.append(h('header', { class: 'page-head' }, h('h1', { text: 'Progress' }), h('div', { class: 'row' }, select, exportBtn)), summaryBox, tableBox);

  const loadSummary = async (): Promise<void> => {
    clear(summaryBox);
    if (!filter) {
      summaryBox.append(h('p', { class: 'muted', text: 'Pick a mode to see its bests, recent median and score chart. Bests are only compared within the same setup (field size, input policy, practice level).' }));
      return;
    }
    const p = store.preset(filter);
    summaryBox.append(h('p', { class: 'muted', text: 'Loading…' }));
    let rows: RunRow[];
    try {
      rows = (await store.bridge.queryRuns({ presetId: filter, validOnly: true, limit: 500, offset: 0 })).rows;
    } catch (e) {
      clear(summaryBox);
      summaryBox.append(h('p', { class: 'error', text: `Could not load history: ${errorMessage(e)}` }));
      return;
    }
    if (disposed) return;
    clear(summaryBox);
    if (!rows.length) {
      summaryBox.append(h('p', { class: 'muted', text: 'No completed runs for this mode yet.' }));
      return;
    }
    const groups = new Map<string, RunRow[]>();
    for (const r of rows) {
      const g = groups.get(r.comparisonKey) ?? [];
      g.push(r);
      groups.set(r.comparisonKey, g);
    }
    const keys = [...groups.keys()];
    const keySel = h('select', { 'aria-label': 'Setup' }, keys.map((k) => h('option', { value: k, text: `${setupLabel(groups.get(k)![0]!)} (${groups.get(k)!.length} runs)` })));
    const body = h('div', {});
    const renderGroup = (k: string): void => {
      clear(body);
      const list = [...groups.get(k)!].sort((a, b) => a.startedAt - b.startedAt);
      const lower = list[0]!.direction === 'lower';
      const scores = list.map((r) => r.score);
      const best = lower ? Math.min(...scores) : Math.max(...scores);
      const st = recentStats(scores);
      const mode = p?.config.scoreMode ?? (lower ? 2 : 0);
      append(body, [
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: 'Best' }), h('span', { class: 'tile-value', text: scoreText(best, mode) })),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: `Median of last ${st.count}` }), h('span', { class: 'tile-value', text: st.median === null ? '—' : scoreText(st.median, mode) })),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: 'Variability (MAD)' }), h('span', { class: 'tile-value', text: st.mad === null ? '—' : mode >= 2 ? `${st.mad.toFixed(3)} s` : fmt(st.mad) }), h('span', { class: 'tile-note muted', text: 'median distance from the median' })),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label', text: 'Runs' }), h('span', { class: 'tile-value', text: String(list.length) }))),
        chart({ title: `${p?.name ?? 'Mode'}: score per run`, xLabel: 'Run', yLabel: lower ? 'Score (s, lower is better)' : 'Score', lowerIsBetter: lower, formatX: (v) => v.toFixed(0), series: [{ label: 'Score', points: list.map((r, i) => ({ x: i + 1, y: r.score })), dots: true }] }),
        list.some((r) => r.summary?.hitRate !== null && r.summary?.precision?.avg !== null && r.summary?.precision?.avg !== undefined)
          ? chart({ title: 'Speed vs accuracy per run', xLabel: 'Hit rate (%)', yLabel: 'Hits per minute', formatX: (v) => v.toFixed(0), formatY: (v) => v.toFixed(0), series: [{ label: 'Run', dots: true, points: list.filter((r) => r.summary?.hitRate !== null && r.summary?.hpm?.avg !== null).map((r) => ({ x: (r.summary.hitRate ?? 0) * 100, y: r.summary.hpm.avg ?? 0 })).sort((a, b) => a.x - b.x) }] })
          : null]);
    };
    keySel.addEventListener('change', () => renderGroup(keySel.value));
    summaryBox.append(h('label', { class: 'row' }, 'Setup: ', keySel), body);
    renderGroup(keys[0]!);
  };

  const loadTable = async (): Promise<void> => {
    clear(tableBox);
    let res;
    try {
      res = await store.bridge.queryRuns({ presetId: filter || undefined, limit: PAGE, offset: page * PAGE });
    } catch (e) {
      tableBox.append(h('p', { class: 'error', text: `Could not load history: ${errorMessage(e)}` }), h('button', { text: 'Retry', onclick: () => void loadTable() }));
      return;
    }
    if (disposed) return;
    const pages = Math.max(1, Math.ceil(res.total / PAGE));
    tableBox.append(h('h2', { text: `History (${res.total} run${res.total === 1 ? '' : 's'})` }));
    if (!res.rows.length) {
      tableBox.append(h('p', { class: 'muted', text: 'No runs yet. Finished and cancelled runs (longer than 3 s) appear here.' }));
      return;
    }
    const tbody = h('tbody', {});
    for (const r of res.rows) {
      const p = store.preset(r.presetId);
      const mode = p?.config.scoreMode ?? (r.direction === 'lower' ? 2 : 0);
      const state = r.status === 'cancelled' ? 'Cancelled' : r.valid ? (r.practiceLevel !== null ? 'Practice' : 'Valid') : 'Not eligible';
      const view = h('button', { class: 'small ghost', text: 'View', 'aria-label': `View run ${fmtDate(r.startedAt)}` });
      view.addEventListener('click', async () => {
        try {
          const replay = r.hasReplay ? await store.bridge.getReplay(r.id) : null;
          const preset = store.preset(r.presetId);
          if (!preset) { toast('That mode no longer exists.', 'error'); return; }
          const record = { ...(r as unknown as RunRecord), summary: r.summary, config: preset.config, practice: r.practiceLevel === null ? null : { adaptiveLevel: r.practiceLevel }, inputPolicy: r.inputPolicy as RunRecord['inputPolicy'], field: r.field, profileName: r.profileName } as RunRecord;
          app.go({ name: 'results', run: { preset, record, replay, req: null, pbBefore: null, save: { state: 'history' }, practiceChange: null } });
        } catch (e) {
          toast(`Could not open the run: ${errorMessage(e)}`, 'error');
        }
      });
      const del = h('button', { class: 'small ghost danger-text', text: 'Delete', 'aria-label': `Delete run ${fmtDate(r.startedAt)}` });
      del.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this run?', `${r.presetName}, ${fmtDate(r.startedAt)}, score ${scoreText(r.score, mode)}. This cannot be undone (backups in Settings → Data).`, 'Delete'))) return;
        try {
          await store.bridge.deleteRun(r.id);
          await store.refreshPbs();
          void loadTable();
          void loadSummary();
        } catch (e) {
          toast(`Not deleted: ${errorMessage(e)}`, 'error');
        }
      });
      tbody.append(h('tr', {},
        h('td', { text: fmtDate(r.startedAt) }),
        h('td', { text: r.presetName }),
        h('td', { class: 'num', text: scoreText(r.score, mode) }),
        h('td', { text: state }),
        h('td', { class: 'num', text: String(r.summary?.hits ?? '—') }),
        h('td', { class: 'num', text: r.summary?.hitRate === null || r.summary?.hitRate === undefined ? '—' : `${Math.round(r.summary.hitRate * 100)} %` }),
        h('td', { class: 'num', text: r.summary?.precision?.avg === null || r.summary?.precision?.avg === undefined ? '—' : `${fmt(r.summary.precision.avg, 1)} %` }),
        h('td', { class: 'num', text: fmtMs(r.durationMs, 1) }),
        h('td', { class: 'small', text: setupLabel(r) }),
        h('td', {}, view, del)));
    }
    tableBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'runs' },
      h('thead', {}, h('tr', {}, ['Date', 'Mode', 'Score', 'Status', 'Hits', 'Hit rate', 'Centre', 'Duration', 'Setup', ''].map((t) => h('th', { scope: 'col', text: t })))), tbody)));
    const prev = h('button', { class: 'ghost', text: '← Newer', disabled: page === 0 });
    const next = h('button', { class: 'ghost', text: 'Older →', disabled: page + 1 >= pages });
    prev.addEventListener('click', () => { page--; void loadTable(); });
    next.addEventListener('click', () => { page++; void loadTable(); });
    tableBox.append(h('div', { class: 'row' }, prev, h('span', { class: 'muted', text: `Page ${page + 1} of ${pages}` }), next));
  };

  select.addEventListener('change', () => { filter = select.value; page = 0; void loadSummary(); void loadTable(); });
  exportBtn.addEventListener('click', async () => {
    try {
      const path = await store.bridge.exportRunsCsv(filter || null);
      if (path) toast(`Exported to ${path}`, 'ok');
    } catch (e) {
      toast(`Export failed: ${errorMessage(e)}`, 'error');
    }
  });
  void loadSummary();
  void loadTable();
  return { dispose: () => { disposed = true; } };
}
