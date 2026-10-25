// Tiny DOM helpers. All text goes through textContent: nothing user-supplied is parsed as HTML.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

let liveRegion: HTMLElement | null = null;
let toastBox: HTMLElement | null = null;

export function initFeedback(root: HTMLElement): void {
  liveRegion = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  toastBox = h('div', { class: 'toasts', 'aria-live': 'assertive' });
  root.append(liveRegion, toastBox);
}

/** Screen-reader announcement. */
export function announce(text: string): void {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  liveRegion.textContent = text;
}

/** Visible message (error / info) with an optional action. */
export function toast(text: string, kind: 'info' | 'error' | 'ok' = 'info', action?: { label: string; run: () => void }, ms = 6000): void {
  if (!toastBox) return;
  const close = h('button', { class: 'ghost small', 'aria-label': 'Dismiss', text: '✕' });
  const prefix = kind === 'error' ? 'Error: ' : kind === 'ok' ? '✓ ' : '';
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', { text: prefix + text }), action ? h('button', { class: 'small', text: action.label, onclick: () => { action.run(); t.remove(); } }) : null, close);
  close.addEventListener('click', () => t.remove());
  toastBox.append(t);
  if (ms > 0 && kind !== 'error') setTimeout(() => t.remove(), ms);
}

/** In-app confirmation dialog (keyboard accessible). Optional typed confirmation word. */
export function confirmDialog(title: string, body: string, confirmLabel: string, typeWord?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const input = typeWord ? h('input', { type: 'text', 'aria-label': `Type ${typeWord} to confirm`, autocomplete: 'off' }) : null;
    const ok = h('button', { class: 'danger', text: confirmLabel, disabled: !!typeWord });
    const cancel = h('button', { text: 'Cancel' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title', text: title }),
      h('p', { text: body }),
      typeWord ? h('p', { class: 'muted', text: `Type ${typeWord} to confirm.` }) : null,
      input,
      h('div', { class: 'row end' }, cancel, ok));
    const back = h('div', { class: 'modal-back' }, box);
    const done = (v: boolean) => { back.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus(); resolve(v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Tab') {
        const f = [...box.querySelectorAll<HTMLElement>('button, input')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1]!.focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0]!.focus(); }
      }
    };
    input?.addEventListener('input', () => { ok.toggleAttribute('disabled', input.value.trim() !== typeWord); });
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    (input ?? cancel).focus();
  });
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const fmtMs = (ms: number | null | undefined, digits = 3): string => (ms === null || ms === undefined || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(digits)} s`);

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
