import type { App, Screen } from './app';
import { h, keyLabel } from './dom';

export function mountHelp(app: App, el: HTMLElement): Screen {
  const s = app.store.settings;
  const st = app.store.storage;
  const sec = (title: string, ...items: (HTMLElement | string)[]): HTMLElement => h('section', { class: 'help-sec' }, h('h2', { text: title }), ...items.map((i) => (typeof i === 'string' ? h('p', { text: i }) : i)));
  const list = (...items: string[]): HTMLElement => h('ul', {}, items.map((t) => h('li', { text: t })));
  el.append(
    h('header', { class: 'page-head' }, h('h1', { text: 'Help' })),
    sec('Controls', list(
      'Click the field (or focus it and press Enter) to start. A countdown runs first (Settings → Play).',
      `Esc cancels a run. ${keyLabel(s.keyRestart)} restarts. ${keyLabel(s.keyMute)} mutes. ${keyLabel(s.keyFullscreen)} toggles fullscreen.`,
      'Space ends a run only in modes that allow it (shown in the rules).',
      'Arrow keys move between modes on the Modes screen; Tab moves through every control.',
      'Switching to another window, a display-scale change or resizing the field cancels the run, so nothing is scored unseen.')),
    sec('How scores work', list(
      'Points modes: points per hit plus bonuses (precision = closeness to the centre, reaction = speed after the target appears, path = straightness of the cursor path, distance = length of the move), minus points for misses and lost targets.',
      'Tracking modes: one point per simulation tick (61 per second) with the cursor on a target.',
      'Stopwatch modes: time to finish plus miss penalties. Lower is better.',
      'Reaction modes: average reaction time; early or missed clicks add a second to that try. Lower is better.',
      'Hit rate (hits ÷ clicks) and centre precision (how close to the middle) are different things and are shown separately.',
      'The simulation runs at a fixed 61 ticks per second regardless of your monitor. What you see is the last simulated position, which is exactly what a click is judged against.')),
    sec('Comparing results', list(
      'Bests and medians only compare runs with the same mode, field size, input policy and practice level.',
      'Adaptive practice changes size and speed between runs only; its results never count as benchmark bests.',
      'The rules follow the original site’s recovered formulas; that alone does not make scores equal to scores on the website, whose timing, field size and input handling differ.',
      'Cancelled runs are kept in history (if longer than 3 s) but never count as bests.')),
    sec('Your data',
      h('p', {}, 'Stored on this computer only, in ', h('code', { text: st?.dataDir ?? '(browser preview: not stored)' }), '. Nothing is uploaded; AimLite makes no network requests.'),
      'Back up or export from Settings → Data. Uninstalling keeps your data; delete the folder yourself to remove it.'),
    sec('Troubleshooting', list(
      'Blank or white window: the Microsoft Edge WebView2 Runtime is missing or broken. Install or repair “Microsoft Edge WebView2 Runtime” from Microsoft, then restart AimLite.',
      'No sound: sound starts after your first click or key press. Check Settings → Audio (mute, volume) and the Windows volume mixer.',
      'Blurry or wrongly sized field: Windows display scaling changed. Restart the run; Settings → Diagnostics shows the DPI AimLite sees.',
      '“Not saved” after a run: the message says why (disk full, permissions, database busy). Use Retry or Export run on the results screen; your result is not lost while the screen is open.',
      'Permission errors: make sure your user account can write the data folder shown above.',
      '“Read-only data”: the database came from a newer AimLite or failed its integrity check. Back it up from Settings → Data before anything else.',
      'Windows SmartScreen warning: this local build is unsigned. Only run builds you made or trust.')),
    sec('About',
      'AimLite is an independent, offline 2D mouse-precision trainer. Its 27 built-in modes are re-implemented from the publicly visible rules of aim400kg.com’s training modes; AimLite is not affiliated with that site, and its code, names, look and sounds are its own.',
      'It trains free-cursor control. It does not change Windows settings, read other programs or convert game sensitivity, and better scores here do not guarantee better aim in any game.'),
  );
  return { dispose: () => undefined };
}
