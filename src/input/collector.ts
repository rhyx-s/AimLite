// Pointer input → one canonical, time-ordered sample stream for the engine.
//
// legacy-v1: one sample per pointermove event (like the source's mousemove), no coalesced samples.
// precise-v1: pointerrawupdate when available, else pointermove; each event's coalesced samples are
//             used instead of the parent (never both). Predicted events are never used.
// "pointerrawupdate" is a high-frequency browser event, not Windows Raw Input and not a polling-rate
// guarantee. Handlers only queue; the play loop drains the queue once per frame.
import type { InputPolicy } from '../engine/types';

export type InputEvent =
  | { kind: 'move'; t: number; x: number; y: number }
  | { kind: 'down'; t: number; x: number; y: number }
  | { kind: 'up'; t: number };

export interface InputCapabilities {
  secureContext: boolean;
  pointerRawUpdate: boolean;
  coalescedEvents: boolean;
  stream: 'pointermove' | 'pointermove+coalesced' | 'pointerrawupdate+coalesced' | 'pointerrawupdate';
}

const MAX_QUEUE = 20000;

export function detectCapabilities(policy: InputPolicy): InputCapabilities {
  const secure = typeof window !== 'undefined' && window.isSecureContext === true;
  const raw = secure && typeof window !== 'undefined' && 'onpointerrawupdate' in window;
  const coalesced = typeof PointerEvent !== 'undefined' && typeof PointerEvent.prototype.getCoalescedEvents === 'function';
  let stream: InputCapabilities['stream'] = 'pointermove';
  if (policy === 'precise-v1') stream = raw ? (coalesced ? 'pointerrawupdate+coalesced' : 'pointerrawupdate') : coalesced ? 'pointermove+coalesced' : 'pointermove';
  return { secureContext: secure, pointerRawUpdate: raw, coalescedEvents: coalesced, stream };
}

export class InputCollector {
  readonly caps: InputCapabilities;
  private queue: InputEvent[] = [];
  private rect: DOMRect | null = null;
  private readonly moveType: 'pointermove' | 'pointerrawupdate';
  private readonly useCoalesced: boolean;
  /** Diagnostics: events vs samples received, and samples dropped by the queue bound. */
  readonly stats = { events: 0, samples: 0, dropped: 0, firstT: 0, lastT: 0 };

  constructor(private readonly field: HTMLElement, policy: InputPolicy, private readonly button: number, private readonly onDownOutsideRun?: () => void) {
    this.caps = detectCapabilities(policy);
    this.moveType = this.caps.stream.startsWith('pointerrawupdate') ? 'pointerrawupdate' : 'pointermove';
    this.useCoalesced = this.caps.stream.endsWith('coalesced');
    window.addEventListener(this.moveType, this.onMove as EventListener, { passive: true });
    field.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp, { passive: true });
    field.addEventListener('contextmenu', this.onContext);
    this.refreshRect();
  }

  /** Re-read the field's position (after layout changes). */
  refreshRect(): void {
    this.rect = this.field.getBoundingClientRect();
  }

  private toField(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.rect ?? this.field.getBoundingClientRect();
    // CSS px relative to the field; the canvas backing scale (DPR) is a rendering detail only.
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private push(e: InputEvent): void {
    if (this.queue.length >= MAX_QUEUE) { this.queue.shift(); this.stats.dropped++; }
    this.queue.push(e);
    if (!this.stats.firstT) this.stats.firstT = e.t;
    this.stats.lastT = e.t;
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen' && e.pointerType !== '') return;
    this.stats.events++;
    const list = this.useCoalesced ? e.getCoalescedEvents() : [];
    if (list.length) {
      for (const c of list) {
        const p = this.toField(c.clientX, c.clientY);
        this.push({ kind: 'move', t: c.timeStamp, x: p.x, y: p.y });
        this.stats.samples++;
      }
    } else {
      const p = this.toField(e.clientX, e.clientY);
      this.push({ kind: 'move', t: e.timeStamp, x: p.x, y: p.y });
      this.stats.samples++;
    }
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== this.button) {
      if (e.button === 2 || e.button === 1) e.preventDefault();
      return;
    }
    e.preventDefault();
    this.field.focus({ preventScroll: true });
    const p = this.toField(e.clientX, e.clientY);
    this.push({ kind: 'move', t: e.timeStamp, x: p.x, y: p.y });
    this.push({ kind: 'down', t: e.timeStamp, x: p.x, y: p.y });
    this.onDownOutsideRun?.();
  };

  private onUp = (e: PointerEvent): void => {
    this.push({ kind: 'up', t: e.timeStamp });
  };

  private onContext = (e: Event): void => e.preventDefault();

  /** Take all queued events in time order (stable for equal timestamps). */
  drain(): InputEvent[] {
    const q = this.queue;
    this.queue = [];
    return q.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  }

  dispose(): void {
    window.removeEventListener(this.moveType, this.onMove as EventListener);
    this.field.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    this.field.removeEventListener('contextmenu', this.onContext);
    this.queue = [];
  }
}
