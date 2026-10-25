import { synth } from '../audio/synth';
import { ENGINE_VERSION, Game } from '../engine/game';
import { randomSeed } from '../engine/rng';
import { InputCollector } from '../input/collector';
import { FieldRenderer } from '../render/field';
import { configHash } from '../presets';
import { newId, runIsValid, type RunRecord } from '../schemas/app';
import { ruleSummary } from '../schemas/preset';
import { summarize, series } from '../engine/summary';
import type { App, Screen } from './app';
import { announce, fmt, h, keyLabel, toast } from './dom';
import { scoreText } from './modes';
import { finishRun } from './results';
import { percentile, rt } from './runtime';
import { errorMessage, type PlayRequest } from './store';

const MAX_FRAME_SAMPLES = 30000;
/** Cancelled runs shorter than this are not stored. */
const MIN_CANCELLED_SAVE_MS = 3000;

export function mountPlay(app: App, el: HTMLElement, req: PlayRequest): Screen {
  const store = app.store;
  const preset = store.preset(req.presetId);
  if (!preset) {
    el.append(h('p', { class: 'error', text: 'That mode no longer exists.' }), h('button', { text: 'Back to modes', onclick: () => app.go({ name: 'modes' }) }));
    return { dispose: () => undefined };
  }
  const s = () => store.settings;
  const level = store.practiceLevel(preset, req.practice);
  const routine = app.routineRun;

  // ---- layout
  const title = h('h1', { text: preset.name });
  const badges = h('div', { class: 'badges' },
    preset.official ? null : h('span', { class: 'badge', text: 'Custom' }),
    level !== null ? h('span', { class: 'badge practice', text: `Adaptive practice · level ${level > 0 ? '+' : ''}${level}` }) : null,
    routine ? h('span', { class: 'badge', text: `Routine: ${routine.routine.name} · step ${routine.stepIndex + 1}/${routine.routine.steps.length} · rep ${routine.rep}/${routine.routine.steps[routine.stepIndex]!.reps}` }) : null);
  const btnBack = h('button', { class: 'ghost', text: '← Modes' });
  const btnRestart = h('button', { text: `Restart (${keyLabel(s().keyRestart)})` });
  const btnMute = h('button', { class: 'ghost', 'aria-pressed': s().muted ? 'true' : 'false', text: s().muted ? 'Sound off' : 'Sound on' });
  const btnFull = h('button', { class: 'ghost', text: `Fullscreen (${keyLabel(s().keyFullscreen)})` });
  const hudTime = h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: 'Time' }), h('span', { class: 'hud-value', text: '—' }));
  const hudScore = h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: 'Score' }), h('span', { class: 'hud-value', text: '0' }));
  const hudStats = h('div', { class: 'hud-stats', 'aria-hidden': 'true' });
  const overlay = h('div', { class: 'field-overlay', 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'field-canvas', 'aria-hidden': 'true' });
  const field = h('div', { class: 'field', tabindex: '0', role: 'application', 'aria-roledescription': 'training field', 'aria-describedby': 'field-help' }, canvas, overlay);
  const help = h('p', { id: 'field-help', class: 'muted small', text: `Click the field or press Enter to start. Esc cancels, ${keyLabel(s().keyRestart)} restarts.${preset.config.ggSpace ? ' Space ends the run.' : ''} Training button: ${['left', 'middle', 'right', 'back', 'forward'][s().mouseButton]}.` });
  const rules = h('details', { class: 'rules' }, h('summary', { text: 'Rules' }), h('ul', {}, ruleSummary(preset.config).map((r) => h('li', { text: r }))));
  const fieldWrap = h('div', { class: 'field-wrap' }, field);
  el.append(
    h('header', { class: 'play-head' }, h('div', {}, title, badges), h('div', { class: 'row' }, btnBack, btnRestart, btnMute, btnFull)),
    h('div', { class: 'hud' }, hudTime, hudScore, hudStats),
    fieldWrap, help, rules);

  const renderer = new FieldRenderer(canvas);
  let game: Game;
  let collector: InputCollector | null = null;
  let geo = store.geometry(preset);
  let key = '';
  let dpr = rt.dpr();
  let raf = 0;
  let ignoreDownUntil = -Infinity;
  let frames: number[] = [];
  let lastFrame = 0;
  let startedAtEpoch = 0;
  let ended = false;
  let hudAt = 0;
  let seen = { hits: 0, misses: 0, losses: 0 };
  let clockMismatch = 0;
  let disposed = false;

  const available = (): { width: number; height: number } => {
    const w = el.clientWidth - 24;
    const hgt = (window.innerHeight || 800) - field.getBoundingClientRect().top - 60;
    return { width: w > 0 ? w : 1056, height: hgt > 200 ? hgt : 655 };
  };

  const newGame = (): void => {
    store.lastAvailable = available();
    geo = store.geometry(preset, store.lastAvailable);
    dpr = rt.dpr();
    const cfg = store.runConfig(preset, geo, level);
    key = store.keyFor(preset, geo, level);
    game = new Game(cfg, { width: geo.width, height: geo.height }, {
      seed: randomSeed(),
      inputPolicy: s().inputPolicy,
      // the legacy click-rate guard only applies to official benchmark presets
      clickRateGuard: s().clickRateGuard && preset.official,
      countdownSeconds: s().countdownSeconds,
    });
    renderer.resize(geo.width, geo.height, dpr);
    renderer.reset();
    collector?.dispose();
    collector = new InputCollector(field, s().inputPolicy, s().mouseButton, onFieldDown);
    frames = [];
    lastFrame = 0;
    ended = false;
    seen = { hits: 0, misses: 0, losses: 0 };
    ignoreDownUntil = -Infinity;
    message('Click the field or press Enter to start');
    updateHud(true);
    field.setAttribute('aria-label', `${preset.name} training field, ${geo.width} by ${geo.height}. Ready.`);
  };

  const message = (text: string | null): void => {
    const isCount = !!text && /^d$/.test(text);
    overlay.textContent = '';
    if (text) overlay.append(isCount ? h('span', { text }) : text);
    overlay.classList.toggle('count', isCount);
    overlay.classList.toggle('show', !!text);
  };

  const begin = (t: number): void => {
    if (game.state !== 'idle') return;
    synth.unlock();
    collector?.refreshRect();
    startedAtEpoch = Date.now();
    game.begin(t);
    if (s().countdownSeconds === 0) message(null);
    announce(`${preset.name} started`);
  };

  // the pointerdown that starts a run is not a game click
  function onFieldDown(): void {
    if (game.state === 'idle') {
      const t = rt.now();
      begin(t);
      ignoreDownUntil = t + 1;
    } else if (game.state === 'over' || game.state === 'cancelled') {
      if (!ended || game.state === 'cancelled') { restart(); ignoreDownUntil = rt.now() + 1; }
    }
  }

  const restart = (): void => {
    if (game.state === 'playing' || game.state === 'countdown') {
      game.cancel('restart');
      maybeSaveCancelled();
    }
    newGame();
  };

  const cancel = (reason: 'user' | 'focus-lost' | 'geometry-changed'): void => {
    if (game.state !== 'playing' && game.state !== 'countdown') return;
    game.cancel(reason);
  };

  const record = (): RunRecord => {
    const sum = summarize(game);
    const fr = frames.slice(1);
    return {
      id: newId('run'),
      presetId: preset.id,
      presetName: preset.name,
      comparisonKey: key,
      score: sum.score,
      direction: sum.direction,
      valid: runIsValid(sum),
      status: sum.status,
      startedAt: startedAtEpoch,
      endedAt: Date.now(),
      durationMs: sum.durationMs,
      engineVersion: ENGINE_VERSION,
      inputPolicy: game.opts.inputPolicy,
      seed: game.opts.seed,
      configHash: configHash(game.cfg),
      config: game.cfg,
      field: { width: geo.width, height: geo.height, dpr, mode: geo.mode },
      practice: level === null ? null : { adaptiveLevel: level },
      profileId: store.activeProfile()?.id ?? null,
      profileName: store.activeProfile()?.name ?? null,
      settingsSnapshot: { mouseButton: s().mouseButton, countdownSeconds: s().countdownSeconds, clickRateGuard: game.opts.clickRateGuard, targetOpacity: s().targetOpacity },
      summary: sum,
      frame: { medianMs: percentile(fr, 50), p95Ms: percentile(fr, 95), p99Ms: percentile(fr, 99), frames: fr.length },
    };
  };

  const maybeSaveCancelled = (): void => {
    if (game.state !== 'cancelled' || game.durationMs < MIN_CANCELLED_SAVE_MS || store.readOnly) return;
    const rec = record();
    store.bridge.saveRun(rec, null, s().replayRetention).catch((e) => toast(`Cancelled run not stored: ${errorMessage(e)}`, 'error'));
  };

  const updateHud = (force = false): void => {
    const now = rt.now();
    if (!force && now - hudAt < 100) return;
    hudAt = now;
    const c = game.cfg;
    const st = game.state;
    hudTime.lastElementChild!.textContent = s().showTimer ? (game.timerLimit > 0 ? `${Math.max(0, game.clockSeconds)} s` : `${(st === 'idle' ? 0 : game.clockSeconds).toFixed(1)} s`) : '·';
    hudScore.lastElementChild!.textContent = s().showScore ? scoreText(game.displayScore, c.scoreMode) : '·';
    hudStats.textContent = '';
    if (!s().showLiveStats) return;
    const clicks = game.hits.filter((x) => !x.byTracking).length + game.misses.length;
    const items: [string, string][] = c.scoreMode === 1
      ? [['On target', `${(game.trackingTicks / 61).toFixed(1)} s`], ['Breaks', String(game.hits.length)], ['Lost', String(game.losses.length)]]
      : [
          ['Hits', String(c.multiMode ? `${game.hits.length} (${game.multiHits.length} sets)` : game.hits.length)],
          ['Misses', String(game.misses.length)],
          ['Lost', String(game.losses.length)],
          ['Hit rate', clicks ? `${Math.round((100 * game.hits.length) / clicks)} %` : '—'],
          ['Centre', game.agg.precision.n ? `${fmt(game.agg.precision.avg, 1)} %` : '—'],
          ['Reaction', game.agg.reaction.n ? `${Math.round(game.agg.reaction.avg)} ms` : '—'],
        ];
    if (c.scoreMode === 2 && game.penaltySeconds) items.push(['Penalty', `+${game.penaltySeconds} s`]);
    if (c.scoreMode === 3) items.push(['Tries', `${game.attempts.length}/${c.ggHits || '∞'}`]);
    for (const [k, v] of items) hudStats.append(h('span', { class: 'stat' }, h('span', { class: 'hud-label', text: k }), h('span', { text: v })));
  };

  const handleEvents = (): void => {
    for (const e of game.takeEvents()) {
      switch (e.type) {
        case 'countdown': message(String(e.n)); if (s().soundCountdown) synth.play('countdown'); break;
        case 'start': message(null); synth.play('start'); break;
        case 'hit': if (s().soundHit) synth.play(e.precision === 100 ? 'perfect' : 'hit'); break;
        case 'damage': synth.play('damage'); break;
        case 'miss': if (s().soundMiss) synth.play('miss'); break;
        case 'loss': if (s().soundLoss) synth.play('loss'); break;
        case 'checkpoint-touch': synth.play('hub'); break;
        case 'checkpoint-shake': synth.play('blocked'); break;
        case 'last-ten': if (s().soundLastTen) synth.play('last-ten'); break;
        case 'end': synth.play('end'); break;
        case 'cancel': {
          synth.play('cancel');
          const why = { user: 'Cancelled', 'focus-lost': 'Cancelled: the window lost focus', stall: 'Cancelled: the app stalled (no frames for a moment)', 'geometry-changed': 'Cancelled: the field size or display scale changed', 'click-rate': 'Cancelled: more than 25 clicks in 2 s (click-rate guard, Settings → Play)', restart: 'Restarted' }[e.reason];
          message(`${why}. Click or press Enter to restart.`);
          announce(why);
          if (e.reason !== 'restart') maybeSaveCancelled();
          break;
        }
      }
    }
    // feedback marks for new hits / misses / losses
    for (; seen.hits < game.hits.length; seen.hits++) {
      const x = game.hits[seen.hits]!;
      renderer.addFx({ t: x.t, x: x.x, y: x.y, r: x.radius, mx: x.mouseX, my: x.mouseY, kind: 'hit', perfect: x.precision === 100, label: x.byTracking ? null : (x.reactionTime / 1000).toFixed(3) });
    }
    for (; seen.misses < game.misses.length; seen.misses++) {
      const m = game.misses[seen.misses]!;
      renderer.addFx({ t: m.t, x: m.x, y: m.y, r: 0, mx: m.x, my: m.y, kind: 'miss', perfect: false, label: null });
    }
    for (; seen.losses < game.losses.length; seen.losses++) {
      const l = game.losses[seen.losses]!;
      renderer.addFx({ t: l.t, x: l.x, y: l.y, r: 8, mx: l.x, my: l.y, kind: 'loss', perfect: false, label: null });
    }
  };

  const frame = (): void => {
    if (disposed) return;
    raf = rt.raf(frame);
    const now = rt.now();
    if (game.state === 'playing') {
      if (lastFrame) {
        if (frames.length >= MAX_FRAME_SAMPLES) frames.splice(0, MAX_FRAME_SAMPLES / 2);
        frames.push(now - lastFrame);
      }
      lastFrame = now;
    }
    // display scale changed (window moved to another monitor) → geometry no longer valid
    if (rt.dpr() !== dpr) {
      if (game.state === 'playing' || game.state === 'countdown') cancel('geometry-changed');
      else if (game.state === 'idle') newGame();
      dpr = rt.dpr();
      renderer.resize(geo.width, geo.height, dpr);
    }
    for (const ev of collector?.drain() ?? []) {
      let t = ev.t;
      // event clocks should match performance.now(); if not (some test/host setups), use frame time
      if (Math.abs(t - now) > 5000) { t = now; clockMismatch++; }
      if (ev.kind === 'move') {
        game.pointerMove(t, ev.x, ev.y);
        if (s().showCursorTrail) renderer.pushTrail(ev.x, ev.y, s().trailLength);
      } else if (ev.kind === 'down') {
        if (t <= ignoreDownUntil) continue;
        game.pointerDown(t, ev.x, ev.y);
      } else {
        game.pointerUp(t);
      }
    }
    game.advance(now);
    handleEvents();
    renderer.draw(game, s());
    updateHud();
    if (game.state === 'over' && !ended) {
      ended = true;
      message('Done!');
      updateHud(true);
      const rec = record();
      (rec.summary.input as Record<string, number>).clockMismatch = clockMismatch;
      const rep = series(game);
      setTimeout(() => {
        if (disposed) return;
        app.go({ name: 'results', run: finishRun(app, preset, rec, rep, req) });
      }, s().reduceMotion ? 200 : 700);
    }
  };

  // ---- keys and window events
  const onKey = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (game.state === 'playing' || game.state === 'countdown') { e.preventDefault(); cancel('user'); }
      return;
    }
    if (e.code === s().keyRestart) { e.preventDefault(); restart(); field.focus(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === field) {
      e.preventDefault();
      if (game.state === 'idle') begin(rt.now());
      else if (game.state === 'cancelled' || game.state === 'over') { newGame(); begin(rt.now()); }
      else if (e.key === ' ' && game.state === 'playing') game.space(rt.now());
      return;
    }
    if (e.key === ' ' && game.state === 'playing') { e.preventDefault(); game.space(rt.now()); }
  };
  const onBlur = (): void => cancel('focus-lost');
  const onVisibility = (): void => { if (document.hidden) cancel('focus-lost'); };
  const onResize = (): void => {
    collector?.refreshRect();
    const next = store.geometry(preset, available());
    if (next.width === geo.width && next.height === geo.height) return;
    if (game.state === 'playing' || game.state === 'countdown') cancel('geometry-changed');
    else if (game.state === 'idle') newGame();
  };
  const onScroll = (): void => collector?.refreshRect();

  btnBack.addEventListener('click', () => app.go({ name: 'modes' }));
  btnRestart.addEventListener('click', () => { restart(); field.focus(); });
  btnMute.addEventListener('click', () => {
    store.updateSettings({ muted: !s().muted });
    btnMute.textContent = s().muted ? 'Sound off' : 'Sound on';
    btnMute.setAttribute('aria-pressed', s().muted ? 'true' : 'false');
  });
  btnFull.addEventListener('click', () => { void app.toggleFullscreen(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);

  newGame();
  field.focus({ preventScroll: true });
  raf = rt.raf(frame);

  return {
    dispose: () => {
      disposed = true;
      if (game.state === 'playing' || game.state === 'countdown') { game.cancel('user'); maybeSaveCancelled(); }
      rt.caf(raf);
      collector?.dispose();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    },
  };
}
