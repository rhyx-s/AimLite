// Draws the engine's current state. Rendering reads state only: it never advances time, consumes
// randomness or awards points. Positions are the last simulated tick (no interpolation), so what
// you see is exactly what a click is judged against.
import type { Game } from '../engine/game';
import type { Settings } from '../schemas/app';

/** A fading feedback mark. x/y = target (or miss) position, mx/my = where the click landed. */
export interface Fx { t: number; x: number; y: number; r: number; mx: number; my: number; kind: 'hit' | 'miss' | 'loss'; perfect: boolean; label: string | null; }

const MAX_FX = 400;
type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: RGB, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const shade = (c: RGB, d: number): RGB => [c[0] + d, c[1] + d, c[2] + d].map((v) => Math.max(0, Math.min(255, v))) as RGB;
const lum = (c: RGB): number => (c[0] + c[1] + c[2]) / 3;

export class FieldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  fx: Fx[] = [];
  private trail: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    } catch {
      this.ctx = null; // no canvas support: the run still works, nothing is drawn
    }
  }

  /** CSS size + DPR-scaled backing buffer. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  addFx(f: Fx): void {
    this.fx.push(f);
    if (this.fx.length > MAX_FX) this.fx.splice(0, this.fx.length - MAX_FX);
  }

  pushTrail(x: number, y: number, max: number): void {
    this.trail.push(x, y);
    if (this.trail.length > max * 2) this.trail.splice(0, this.trail.length - max * 2);
  }

  reset(): void {
    this.fx = [];
    this.trail = [];
  }

  draw(g: Game | null, s: Settings): void {
    const c = this.ctx;
    if (!c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = rgb(s.backgroundColor);
    this.drawBackdrop(c, s.backgroundColor, bg);
    if (!g) return;
    const ink: RGB = lum(bg) > 128 ? [0, 0, 0] : [255, 255, 255];
    this.drawHub(c, g, s);
    const life = Math.max(200, s.fadeSeconds * 1000);
    this.fx = this.fx.filter((f) => g.t - f.t <= life);
    this.drawMarks(c, g, s, ink, life);
    this.drawTargets(c, g, s);
    this.drawClickPlaces(c, g, s, ink, life);
    this.drawTrail(c, s, ink);
  }

  private backdrop: { key: string; canvas: HTMLCanvasElement } | null = null;

  /** Field background: the chosen colour with a soft light falloff and violet glow, painted once per size/colour. */
  private drawBackdrop(c: CanvasRenderingContext2D, hex: string, bg: RGB): void {
    const key = `${hex}|${this.width}|${this.height}|${this.dpr}`;
    if (!this.backdrop || this.backdrop.key !== key) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(this.width * this.dpr));
      cv.height = Math.max(1, Math.round(this.height * this.dpr));
      const b = cv.getContext('2d');
      if (b) {
        b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        b.fillStyle = hex;
        b.fillRect(0, 0, this.width, this.height);
        const light = lum(bg) > 128;
        const r = Math.hypot(this.width, this.height) / 2;
        const g1 = b.createRadialGradient(this.width * 0.5, this.height * 0.42, 0, this.width * 0.5, this.height * 0.5, r);
        g1.addColorStop(0, light ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.045)');
        g1.addColorStop(1, light ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.35)');
        b.fillStyle = g1;
        b.fillRect(0, 0, this.width, this.height);
        const g2 = b.createRadialGradient(this.width * 0.85, 0, 0, this.width * 0.85, 0, r * 0.9);
        g2.addColorStop(0, 'rgba(124,92,255,0.10)');
        g2.addColorStop(1, 'rgba(124,92,255,0)');
        b.fillStyle = g2;
        b.fillRect(0, 0, this.width, this.height);
      }
      this.backdrop = { key, canvas: cv };
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.backdrop.canvas, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private drawHub(c: CanvasRenderingContext2D, g: Game, s: Settings): void {
    const cp = g.checkpoint;
    if (!cp) return;
    const shake = cp.shakeUntil > g.t && !s.reduceMotion ? Math.sin(g.t * 0.6) * 4 : 0;
    c.beginPath();
    c.arc(cp.x + shake, cp.y, cp.radius, 0, Math.PI * 2);
    c.fillStyle = cp.touched ? 'rgba(80,200,120,0.35)' : 'rgba(230,80,80,0.30)';
    c.fill();
    c.lineWidth = 2;
    // the dash pattern (not only the colour) shows the state
    c.setLineDash(cp.touched ? [] : [4, 3]);
    c.strokeStyle = cp.touched ? 'rgba(80,200,120,0.95)' : 'rgba(230,80,80,0.95)';
    c.stroke();
    c.setLineDash([]);
  }

  private drawMarks(c: CanvasRenderingContext2D, g: Game, s: Settings, ink: RGB, life: number): void {
    for (const f of this.fx) {
      const a = 1 - (g.t - f.t) / life;
      if (f.kind === 'hit') {
        if (s.showHitTrace) {
          c.beginPath();
          c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          c.fillStyle = rgba(ink, 0.07 * a);
          c.fill();
          c.strokeStyle = rgba(ink, 0.35 * a);
          c.lineWidth = 1;
          c.stroke();
        }
        if (s.showReactionLabel && f.label) {
          c.fillStyle = rgba(ink, 0.85 * a);
          c.font = '11px system-ui, sans-serif';
          c.textAlign = 'center';
          c.fillText(f.label, f.x, f.y - f.r - 4);
        }
      } else if (f.kind === 'miss' && s.showMisses) {
        c.strokeStyle = `rgba(255,90,90,${0.9 * a})`;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(f.x - 4, f.y - 4); c.lineTo(f.x + 4, f.y + 4);
        c.moveTo(f.x + 4, f.y - 4); c.lineTo(f.x - 4, f.y + 4);
        c.stroke();
      } else if (f.kind === 'loss' && s.showLosses) {
        c.strokeStyle = `rgba(255,170,60,${0.85 * a})`;
        c.lineWidth = 2;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.arc(f.x, f.y, Math.max(6, f.r), 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }
  }

  private drawTargets(c: CanvasRenderingContext2D, g: Game, s: Settings): void {
    const tc = rgb(s.targetColor);
    const alpha = s.targetOpacity / 100;
    const marker = rgba(lum(tc) > 128 ? shade(tc, -120) : shade(tc, 120), Math.max(0.6, alpha));
    const live = g.targets.filter((t) => t.enabled);
    const glow = s.targetGlow / 100;
    if (glow > 0 && live.length <= 24) {
      for (const t of live) {
        const hr = t.r * 2.2 + 6;
        const halo = c.createRadialGradient(t.x, t.y, t.r * 0.6, t.x, t.y, hr);
        halo.addColorStop(0, rgba(tc, glow * alpha));
        halo.addColorStop(1, rgba(tc, 0));
        c.fillStyle = halo;
        c.beginPath();
        c.arc(t.x, t.y, hr, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (const t of live) {
      c.beginPath();
      c.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      if (t.tracked) {
        c.fillStyle = rgba(shade(tc, 70), alpha);
      } else if (s.targetShading && t.r > 3) {
        const gr = c.createRadialGradient(t.x - t.r * 0.35, t.y - t.r * 0.35, t.r * 0.1, t.x, t.y, t.r);
        gr.addColorStop(0, rgba(shade(tc, 90), alpha));
        gr.addColorStop(0.55, rgba(tc, alpha));
        gr.addColorStop(1, rgba(shade(tc, -70), alpha));
        c.fillStyle = gr;
      } else {
        c.fillStyle = rgba(tc, alpha);
      }
      c.fill();
      if (t.tracked) {
        // tracking state: a thick white ring, not just a colour change
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(255,255,255,0.95)';
        c.stroke();
      } else if (s.targetBorder) {
        c.lineWidth = 1.5;
        c.strokeStyle = s.targetBorderColor;
        c.stroke();
      }
      if (s.centerDot) {
        c.beginPath();
        c.arc(t.x, t.y, 1.5, 0, Math.PI * 2);
        c.fillStyle = marker;
        c.fill();
      }
      if (s.centerCrosshair && t.r > 6) {
        const o = 4;
        const len = (t.r - o) / 2;
        c.strokeStyle = marker;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(t.x - o, t.y); c.lineTo(t.x - o - len, t.y);
        c.moveTo(t.x + o, t.y); c.lineTo(t.x + o + len, t.y);
        c.moveTo(t.x, t.y - o); c.lineTo(t.x, t.y - o - len);
        c.moveTo(t.x, t.y + o); c.lineTo(t.x, t.y + o + len);
        c.stroke();
      }
    }
  }

  private drawClickPlaces(c: CanvasRenderingContext2D, g: Game, s: Settings, ink: RGB, life: number): void {
    if (!s.showHitPlace) return;
    for (const f of this.fx) {
      if (f.kind !== 'hit') continue;
      const a = 1 - (g.t - f.t) / life;
      c.beginPath();
      c.arc(f.mx, f.my, f.perfect ? 3.5 : 2.5, 0, Math.PI * 2);
      c.strokeStyle = f.perfect ? `rgba(255,220,60,${a})` : rgba(ink, 0.8 * a);
      c.lineWidth = f.perfect ? 2 : 1.5;
      c.stroke();
    }
  }

  private drawTrail(c: CanvasRenderingContext2D, s: Settings, ink: RGB): void {
    if (!s.showCursorTrail || s.reduceMotion || this.trail.length < 4) return;
    c.lineWidth = 2;
    for (let i = 2; i < this.trail.length; i += 2) {
      c.strokeStyle = rgba(ink, (0.4 * i) / this.trail.length);
      c.beginPath();
      c.moveTo(this.trail[i - 2]!, this.trail[i - 1]!);
      c.lineTo(this.trail[i]!, this.trail[i + 1]!);
      c.stroke();
    }
  }
}
