import { synth } from '../audio/synth';
import type { Store, PlayRequest } from './store';
import { clear, h, initFeedback, keyLabel, toast } from './dom';
import { mountModes } from './modes';
import { mountPlay } from './play';
import { mountResults, type FinishedRun } from './results';
import { mountProgress } from './progress';
import { mountRoutines, type RoutineRun } from './routines';
import { mountBuilder } from './builder';
import { mountSettings } from './settings';
import { mountHelp } from './help';
import { icon } from './icons';
import { errorMessage } from './store';

export type View =
  | { name: 'modes' }
  | { name: 'play'; req: PlayRequest }
  | { name: 'results'; run: FinishedRun }
  | { name: 'progress'; presetId?: string }
  | { name: 'routines'; editId?: string }
  | { name: 'builder'; presetId?: string }
  | { name: 'settings'; tab?: string }
  | { name: 'help' };

export interface Screen { dispose(): void; }

const NAV: { name: View['name']; label: string }[] = [
  { name: 'modes', label: 'Modes' },
  { name: 'routines', label: 'Routines' },
  { name: 'progress', label: 'Progress' },
  { name: 'builder', label: 'Builder' },
  { name: 'settings', label: 'Settings' },
  { name: 'help', label: 'Help' },
];

export class App {
  readonly main: HTMLElement;
  private readonly nav: HTMLElement;
  private screen: Screen | null = null;
  view: View = { name: 'modes' };
  routineRun: RoutineRun | null = null;

  constructor(readonly root: HTMLElement, readonly store: Store) {
    clear(root);
    this.nav = h('nav', { class: 'sidebar', 'aria-label': 'Main' });
    this.main = h('main', { class: 'content', id: 'main', tabindex: '-1' });
    const skip = h('a', { class: 'skip', href: '#main', text: 'Skip to content' });
    root.append(skip, h('div', { class: 'shell' }, this.nav, this.main));
    initFeedback(root);
    this.renderNav();
    this.applySettings();
    store.onChange(() => this.applySettings());
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('focus', () => synth.setFocus(true));
    window.addEventListener('blur', () => synth.setFocus(false));
    const unlock = () => synth.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    if (store.readOnly) {
      toast(`Your data is open read-only: ${store.storage?.readOnlyReason ?? ''}. Back it up from Settings → Data.`, 'error');
    }
  }

  private renderNav(): void {
    clear(this.nav);
    this.nav.append(h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), h('span', { class: 'brand-name', text: 'AimLite' })));
    const list = h('ul', {});
    for (const n of NAV) {
      const current = this.view.name === n.name || (n.name === 'modes' && (this.view.name === 'play' || this.view.name === 'results'));
      list.append(h('li', {}, h('button', { class: current ? 'nav current' : 'nav', 'aria-current': current ? 'page' : null, 'aria-label': n.label, title: n.label, onclick: () => this.go({ name: n.name } as View) }, icon(n.name), h('span', { text: n.label }))));
    }
    this.nav.append(list);
    if (this.store.storage?.kind === 'memory') this.nav.append(h('p', { class: 'warn small', text: 'Browser preview: nothing is saved. Use the desktop app.' }));
    this.nav.append(h('div', { class: 'sidebar-foot muted small' },
      h('div', {}, h('span', { class: 'kbd', text: keyLabel(this.store.settings.keyFullscreen) }), ' fullscreen'),
      h('div', {}, h('span', { class: 'kbd', text: keyLabel(this.store.settings.keyMute) }), ' mute')));
  }

  go(v: View): void {
    this.screen?.dispose();
    this.screen = null;
    clear(this.main);
    this.view = v;
    this.renderNav();
    try {
      switch (v.name) {
        case 'modes': this.screen = mountModes(this, this.main); break;
        case 'play': this.screen = mountPlay(this, this.main, v.req); break;
        case 'results': this.screen = mountResults(this, this.main, v.run); break;
        case 'progress': this.screen = mountProgress(this, this.main, v.presetId); break;
        case 'routines': this.screen = mountRoutines(this, this.main, v.editId); break;
        case 'builder': this.screen = mountBuilder(this, this.main, v.presetId); break;
        case 'settings': this.screen = mountSettings(this, this.main, v.tab); break;
        case 'help': this.screen = mountHelp(this, this.main); break;
      }
    } catch (e) {
      this.main.append(h('p', { class: 'error', role: 'alert', text: `This screen failed to open: ${errorMessage(e)}` }));
    }
    if (v.name !== 'play') this.main.focus({ preventScroll: true });
  }

  applySettings(): void {
    const s = this.store.settings;
    const de = document.documentElement;
    de.style.fontSize = `${s.textScale}%`;
    de.classList.toggle('high-contrast', s.highContrast);
    de.classList.toggle('reduce-motion', s.reduceMotion);
    synth.configure(s.volume / 100, s.muted);
  }

  private onKey = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    const s = this.store.settings;
    if (e.code === s.keyFullscreen) {
      e.preventDefault();
      void this.toggleFullscreen();
    } else if (e.code === s.keyMute) {
      e.preventDefault();
      this.store.updateSettings({ muted: !s.muted });
      toast(this.store.settings.muted ? 'Sound off' : 'Sound on', 'info', undefined, 1500);
    }
  };

  async toggleFullscreen(): Promise<void> {
    try {
      const on = await this.store.bridge.isFullscreen();
      await this.store.bridge.setFullscreen(!on);
    } catch (e) {
      toast(`Fullscreen unavailable: ${errorMessage(e)}`, 'error');
    }
  }
}
