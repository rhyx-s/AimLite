import { CATEGORY_ORDER, estimateSeconds, SITE_AVERAGES } from '../presets';
import { ruleSummary, type Preset } from '../schemas/preset';
import type { App, Screen } from './app';
import { clear, fmt, h } from './dom';

export function scoreText(score: number, mode: number): string {
  if (mode === 2 || mode === 3) return `${score.toFixed(mode === 3 ? 4 : 3)} s`;
  return fmt(score);
}

export function mountModes(app: App, el: HTMLElement): Screen {
  const store = app.store;
  let query = '';
  let favOnly = false;
  const search = h('input', { type: 'search', placeholder: 'Search modes', 'aria-label': 'Search modes', autocomplete: 'off' });
  const favToggle = h('input', { type: 'checkbox', id: 'fav-only' });
  const list = h('div', { class: 'mode-groups' });
  const setupNote = h('p', { class: 'muted small' });
  el.append(
    h('header', { class: 'page-head' },
      h('h1', { text: 'Training modes' }),
      h('div', { class: 'row' }, search, h('label', { class: 'check' }, favToggle, ' Favourites only'))),
    setupNote,
    list);

  const card = (p: Preset): HTMLElement => {
    const pb = store.pbFor(p);
    const fav = store.favourites.has(p.id);
    const est = estimateSeconds(p.config);
    const avg = store.settings.showSiteAverage ? SITE_AVERAGES[p.id] : undefined;
    const rules = ruleSummary(p.config);
    const play = h('button', { class: 'mode-play', 'data-preset': p.id, 'aria-label': `Play ${p.name}. ${p.description}` },
      h('span', { class: 'mode-name', text: p.name }),
      h('span', { class: 'mode-desc', text: p.description || rules.join('. ') }),
      h('span', { class: 'mode-meta' },
        h('span', { text: est ? `~${est >= 60 ? `${Math.round(est / 60)} min` : `${est} s`}` : 'until done' }),
        h('span', { class: 'pb', text: pb ? `Best ${scoreText(pb.score, p.config.scoreMode)}` : 'No best yet' })),
      avg ? h('span', { class: 'mode-avg muted small', text: `Site average, ${avg.snapshotDate} snapshot: ${scoreText(avg.value, p.config.scoreMode)} (not directly comparable)` }) : null);
    play.addEventListener('click', () => app.go({ name: 'play', req: { presetId: p.id, practice: false } }));
    const favBtn = h('button', { class: fav ? 'icon fav on' : 'icon fav', 'aria-pressed': fav ? 'true' : 'false', 'aria-label': `${fav ? 'Remove' : 'Add'} ${p.name} ${fav ? 'from' : 'to'} favourites`, title: 'Favourite', text: fav ? '★' : '☆' });
    favBtn.addEventListener('click', async () => { await store.toggleFavourite(p.id); render(); });
    const practice = h('button', { class: 'small ghost', text: 'Practice', title: 'Adaptive practice: size/speed adjust between runs; kept apart from benchmark results' });
    practice.addEventListener('click', () => app.go({ name: 'play', req: { presetId: p.id, practice: true } }));
    const details = h('details', { class: 'rules' }, h('summary', { text: 'Rules' }), h('ul', {}, rules.map((r) => h('li', { text: r }))));
    return h('div', { class: 'mode-card', role: 'listitem' }, play, h('div', { class: 'mode-actions' }, favBtn, practice, h('button', { class: 'small ghost', text: 'Progress', onclick: () => app.go({ name: 'progress', presetId: p.id }) }), p.official ? null : h('button', { class: 'small ghost', text: 'Edit', onclick: () => app.go({ name: 'builder', presetId: p.id }) })), details);
  };

  const render = (): void => {
    clear(list);
    const s = store.settings;
    setupNote.textContent = `Bests shown for: ${s.fieldMode === 'classic' ? 'Classic field' : 'Large field'}, ${s.inputPolicy === 'legacy-v1' ? 'legacy input' : 'precise input'}. Change in Settings → Play.`;
    const q = query.trim().toLowerCase();
    const presets = store.allPresets().filter((p) => (!favOnly || store.favourites.has(p.id)) && (!q || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q)));
    if (!presets.length) {
      list.append(h('p', { class: 'muted', text: favOnly ? 'No favourites match. Use ☆ on a mode to add it.' : 'No modes match your search.' }));
      return;
    }
    const cats = [...new Set([...CATEGORY_ORDER, ...presets.map((p) => p.official ? p.category : 'Custom')])];
    const favs = presets.filter((p) => store.favourites.has(p.id));
    if (favs.length && !favOnly) list.append(group('Favourites', favs));
    for (const c of cats) {
      const items = presets.filter((p) => (p.official ? p.category : 'Custom') === c);
      if (items.length) list.append(group(c, items));
    }
  };

  const group = (title: string, items: Preset[]): HTMLElement =>
    h('section', { class: 'mode-group', 'aria-label': title }, h('h2', { text: title }), h('div', { class: 'mode-grid', role: 'list' }, items.map(card)));

  // arrow keys move between mode cards
  const onKey = (e: KeyboardEvent): void => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const btns = [...list.querySelectorAll<HTMLButtonElement>('.mode-play')];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const grid = btns[i]!.closest('.mode-grid');
    const perRow = grid ? Math.max(1, Math.round(grid.clientWidth / Math.max(1, btns[i]!.closest('.mode-card')!.clientWidth))) : 1;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? perRow : -perRow;
    btns[Math.max(0, Math.min(btns.length - 1, i + step))]!.focus();
  };
  list.addEventListener('keydown', onKey);
  search.addEventListener('input', () => { query = search.value; render(); });
  favToggle.addEventListener('change', () => { favOnly = favToggle.checked; render(); });
  const off = store.onChange(render);
  render();
  return { dispose: () => { off(); } };
}
