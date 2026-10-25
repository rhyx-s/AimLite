// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryBridge } from '../../src/bridge/memory';
import { BridgeFailure } from '../../src/bridge/types';
import { OFFICIAL_PRESETS } from '../../src/presets';
import type { Preset } from '../../src/schemas/preset';
import { App } from '../../src/ui/app';
import { setRuntime } from '../../src/ui/runtime';
import { Store } from '../../src/ui/store';
import { BoundedPreview, MAX_PREVIEW_RECORDS, previewRecordCount } from '../../src/ui/preview';

// ---- deterministic host clock + frame scheduler
let clock = 1000;
let rafQueue: { id: number; cb: (t: number) => void }[] = [];
let rafId = 0;
setRuntime({
  now: () => clock,
  raf: (cb) => { rafQueue.push({ id: ++rafId, cb }); return rafId; },
  caf: (id) => { rafQueue = rafQueue.filter((r) => r.id !== id); },
  screenWidth: () => 1920,
  dpr: () => 1,
});
function frames(ms: number, step = 16): void {
  const end = clock + ms;
  while (clock < end) {
    clock = Math.min(end, clock + step);
    const q = rafQueue;
    rafQueue = [];
    for (const r of q) r.cb(clock);
  }
}
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

// jsdom has no PointerEvent in some versions: a minimal stand-in with the fields the app reads
if (typeof window.PointerEvent === 'undefined') {
  class PE extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
}
const pointer = (target: EventTarget, type: string, x: number, y: number, button = 0): void => {
  target.dispatchEvent(new window.PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true, pointerType: 'mouse' } as PointerEventInit));
};
const key = (k: string, code = k, target: EventTarget = document): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true }));
};

/** A quick test mode: one static centre target (classic field 1056×655 → centre 528.5, 328.5). */
function testPreset(over: Partial<Preset['config']> = {}): Preset {
  const base = OFFICIAL_PRESETS.find((p) => p.id === 'official:wide-line')!;
  return {
    id: 'custom:test', version: 1, official: false, name: 'Test Centre', category: 'Custom', description: 'test',
    config: { ...base.config, name: 'Test Centre', randomTargetPosition: false, changeRadiusOnHit: 0, ggTimer: 0, ggHits: 3, targetDelay: 0, ...over },
  };
}
const CX = 528.5;
const CY = 328.5;

let root: HTMLElement;
let bridge: MemoryBridge;
let app: App;

async function boot(settings: Record<string, unknown> = { countdownSeconds: 0 }): Promise<void> {
  bridge = new MemoryBridge();
  bridge.settings = settings;
  bridge.presets.set('custom:test', testPreset());
  const store = new Store(bridge);
  await store.load();
  app = new App(root, store);
  app.go({ name: 'modes' });
}

const field = (): HTMLElement => root.querySelector<HTMLElement>('.field')!;
const h1 = (): string => root.querySelector('h1')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const host = document.createElement('div');
  host.id = 'app';
  document.body.replaceChildren(host);
  root = document.getElementById('app')!;
  rafQueue = [];
  clock = 1000;
});
afterEach(() => {
  // one App per test: dispose its screen so its document listeners do not leak into the next test
  app?.go({ name: "help" });
  vi.useRealTimers();
});

async function playTestRun(): Promise<void> {
  root.querySelector<HTMLButtonElement>('.mode-play[data-preset="custom:test"]')!.click();
  expect(h1()).toBe('Test Centre');
  frames(32);
  pointer(field(), 'pointerdown', CX, CY); // starts the run (not a game click)
  frames(32);
  for (let i = 0; i < 3; i++) {
    pointer(window, 'pointermove', CX + 1, CY);
    pointer(field(), 'pointerdown', CX, CY);
    frames(100);
  }
  vi.advanceTimersByTime(800);
  await flush();
}

describe('app flow', () => {
  it('select a mode → finish a run → results → saved → retry → history', async () => {
    await boot();
    await playTestRun();
    expect(h1()).toBe('Test Centre — results');
    expect(root.textContent).toContain('First valid run for this setup');
    await flush();
    expect(bridge.runs.size).toBe(1);
    const run = [...bridge.runs.values()][0]!;
    expect(run.valid).toBe(true);
    expect(run.summary.hits).toBe(3);
    expect(run.summary.misses).toBe(0);
    expect(run.summary.endReason).toBe('hits');
    expect(run.field).toMatchObject({ mode: 'classic', width: 1056, height: 655 });
    expect(root.querySelector('.save-status')!.textContent).toContain('Saved');
    // retry goes straight back to the same mode
    [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Retry'))!.click();
    expect(h1()).toBe('Test Centre');
    // history
    app.go({ name: 'progress' });
    await flush();
    expect(root.querySelectorAll('table.runs tbody tr').length).toBe(1);
    expect(root.textContent).toContain('History (1 run)');
  });

  it('a failed save keeps the result on screen and can be retried', async () => {
    await boot();
    bridge.failSaves = new BridgeFailure({ code: 'disk_full', message: 'disk full' });
    await playTestRun();
    await flush();
    expect(root.querySelector('.save-status')!.textContent).toContain('Not saved');
    expect(root.querySelector('.save-status')!.textContent).toContain('disk is full');
    expect(bridge.runs.size).toBe(0);
    bridge.failSaves = null;
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry save')!.click();
    await flush();
    expect(bridge.runs.size).toBe(1);
    expect(root.querySelector('.save-status')!.textContent).toContain('Saved');
  });

  it('Esc cancels; a cancelled run is stored as invalid and never becomes a best', async () => {
    await boot();
    root.querySelector<HTMLButtonElement>('.mode-play[data-preset="custom:test"]')!.click();
    field().focus();
    key('Enter', 'Enter', field());
    frames(3500);
    key('Escape');
    frames(32);
    await flush();
    expect(root.querySelector('.field-overlay')!.textContent).toContain('Cancelled');
    expect(bridge.runs.size).toBe(1);
    const r = [...bridge.runs.values()][0]!;
    expect(r.status).toBe('cancelled');
    expect(r.valid).toBe(false);
    expect(await bridge.personalBests()).toEqual([]);
  });

  it('switching away from the window cancels the run', async () => {
    await boot();
    root.querySelector<HTMLButtonElement>('.mode-play[data-preset="custom:test"]')!.click();
    pointer(field(), 'pointerdown', CX, CY);
    frames(100);
    window.dispatchEvent(new Event('blur'));
    frames(32);
    expect(root.querySelector('.field-overlay')!.textContent).toContain('lost focus');
  });

  it('100 restarts leave no extra input listeners behind', async () => {
    await boot();
    const added = new Map<string, number>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((t: string, l: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => { added.set(t, (added.get(t) ?? 0) + 1); add(t, l, o); });
    vi.spyOn(window, 'removeEventListener').mockImplementation((t: string, l: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => { added.set(t, (added.get(t) ?? 0) - 1); remove(t, l, o); });
    root.querySelector<HTMLButtonElement>('.mode-play[data-preset="custom:test"]')!.click();
    for (let i = 0; i < 100; i++) {
      pointer(field(), 'pointerdown', 5, 5);
      frames(20);
      key('r', 'KeyR');
      frames(20);
    }
    app.go({ name: 'modes' });
    for (const t of ['pointermove', 'pointerup', 'blur', 'resize']) expect(added.get(t) ?? 0, t).toBeLessThanOrEqual(0);
    expect(rafQueue.length).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('builder', () => {
  it('bounds an imported high-churn preview and releases its RAF loop on exit', async () => {
    await boot();
    app.go({ name: 'builder' });
    const malicious = testPreset({ scoreMode: 0, targetsOnStart: 200, maxTargets: 200,
      targetLifeTime: 1, targetDelay: 0, targetDelayRandom: false, changePositionOnLoss: true,
      disableLosses: false, oneTimeTargets: false, syncTarget: false, multiMode: false,
      ggTimer: 0, ggHits: 0, ggMisses: 0, ggLosses: 0, ggTargets: 0, ggApples: 0, ggSpace: true });
    bridge.nextImport = JSON.stringify({ format: 'aimlite-preset', preset: malicious });
    const advance = BoundedPreview.prototype.advance;
    let observed = 0;
    const spy = vi.spyOn(BoundedPreview.prototype, 'advance').mockImplementation(function (this: BoundedPreview, now: number) {
      advance.call(this, now);
      observed++;
      expect(previewRecordCount(this.game)).toBeLessThanOrEqual(MAX_PREVIEW_RECORDS);
    });
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Import JSON')!.click();
    await flush();
    expect(root.textContent).toContain('Imported. Review it');
    frames(10_000);
    expect(observed).toBeGreaterThan(500);
    expect(bridge.presets.size).toBe(1);
    app.go({ name: 'modes' });
    expect(rafQueue).toHaveLength(0);
    spy.mockRestore();
  });

  it('rejects an invalid import and changes nothing', async () => {
    await boot();
    app.go({ name: 'builder' });
    bridge.nextImport = JSON.stringify({ format: 'aimlite-preset', preset: { name: 'Evil', config: { ...testPreset().config, targetsOnStart: 99999 } } });
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Import JSON')!.click();
    await flush();
    expect(root.querySelector('.builder-side .error')!.textContent).toContain('Import rejected');
    expect(bridge.presets.size).toBe(1);
  });

  it('clones an official mode, saves the copy and keeps the official one unchanged', async () => {
    await boot();
    app.go({ name: 'builder', presetId: 'official:pinpoint-pulse' });
    expect(root.textContent).toContain('official benchmark mode and stays unchanged');
    const name = root.querySelector<HTMLInputElement>('#b-name')!;
    name.value = 'My Pulse';
    name.dispatchEvent(new Event('input'));
    const hits = root.querySelector<HTMLInputElement>('#f-spHit')!;
    hits.value = '250';
    hits.dispatchEvent(new Event('change'));
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();
    await flush();
    const saved = [...bridge.presets.values()].find((p) => p.name === 'My Pulse')!;
    expect(saved.config.spHit).toBe(250);
    expect(saved.official).toBe(false);
    expect(OFFICIAL_PRESETS.find((p) => p.id === 'official:pinpoint-pulse')!.config.spHit).toBe(100);
  });

  it('marks fields that have no effect and explains why', async () => {
    await boot();
    app.go({ name: 'builder', presetId: 'official:pinpoint-pulse' });
    expect(root.querySelector('#f-spMissPenalty-why')!.textContent).toContain('Only used in Stopwatch');
  });
});

describe('settings', () => {
  it('persist and reload', async () => {
    await boot();
    app.go({ name: 'settings', tab: 'Audio' });
    const vol = root.querySelector<HTMLInputElement>('input[type=range]')!;
    vol.value = '35';
    vol.dispatchEvent(new Event('input'));
    await app.store.flushSettings();
    expect((bridge.settings as { volume: number }).volume).toBe(35);
    const again = new Store(bridge);
    await again.load();
    expect(again.settings.volume).toBe(35);
    expect(again.settings.countdownSeconds).toBe(0);
  });

  it('keyboard: arrow keys move between mode cards', async () => {
    await boot();
    const btns = [...root.querySelectorAll<HTMLButtonElement>('.mode-play')];
    btns[0]!.focus();
    btns[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(btns[1]);
  });
});
