// Small canvas charts. Values are drawn as given (no smoothing); counters use steps; hovering or
// focusing shows exact values. Lower-is-better series mark their minimum as best.
import { h } from '../ui/dom';

export interface Series {
  label: string;
  points: { x: number; y: number }[];
  step?: boolean;
  color?: string;
  dots?: boolean;
}

export interface ChartOptions {
  title: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  lowerIsBetter?: boolean;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  height?: number;
  /** Optional horizontal reference line (e.g. an archived snapshot), always labelled. */
  reference?: { y: number; label: string };
}

const COLORS = ['#b48cff', '#7dd3fc', '#f0abfc', '#86efac', '#fcd34d'];

export function chart(o: ChartOptions): HTMLElement {
  const width = 520;
  const height = o.height ?? 200;
  const canvas = h('canvas', { width: width * 2, height: height * 2, class: 'chart-canvas', role: 'img' });
  canvas.style.width = '100%';
  canvas.style.maxWidth = `${width}px`;
  const pts = o.series.flatMap((s) => s.points);
  const tip = h('div', { class: 'chart-tip muted', 'aria-live': 'polite', text: pts.length ? 'Hover the chart for exact values.' : 'No data for this run.' });
  const desc = describe(o);
  canvas.setAttribute('aria-label', `${o.title}. ${desc}`);
  const box = h('figure', { class: 'chart' }, h('figcaption', { text: o.title }), canvas, tip);
  const ctx = (() => { try { return canvas.getContext('2d'); } catch { return null; } })();
  if (!ctx || !pts.length) return box;

  const fx = o.formatX ?? ((v: number) => v.toFixed(1));
  const pad = { l: 52, r: 12, t: 10, b: 30 };
  let x0 = Math.min(...pts.map((p) => p.x));
  let x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y), o.reference ? o.reference.y : Infinity);
  let y1 = Math.max(...pts.map((p) => p.y), o.reference ? o.reference.y : -Infinity);
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const ySpan = y1 - y0;
  y0 -= ySpan * 0.05;
  y1 += ySpan * 0.05;
  // label decimals follow the axis span so small ranges stay readable
  const yDigits = ySpan >= 50 ? 0 : ySpan >= 5 ? 1 : ySpan >= 0.5 ? 2 : 3;
  const fy = o.formatY ?? ((v: number) => v.toFixed(yDigits));
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b);

  const render = (hover: { x: number; y: number } | null) => {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--fg').trim() || '#e6e9ef';
    const muted = css.getPropertyValue('--muted').trim() || '#8b93a3';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = y0 + ((y1 - y0) * i) / 4;
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fy(v), pad.l - 4, y + 3);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const v = x0 + ((x1 - x0) * i) / 4;
      ctx.fillText(fx(v), X(v), height - pad.b + 14);
    }
    ctx.fillText(o.xLabel, (pad.l + width - pad.r) / 2, height - 3);
    ctx.save();
    ctx.translate(10, (pad.t + height - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(o.yLabel, 0, 0);
    ctx.restore();
    if (o.reference) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = muted;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(o.reference.y)); ctx.lineTo(width - pad.r, Y(o.reference.y)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.fillText(o.reference.label, pad.l + 4, Y(o.reference.y) - 4);
    }
    o.series.forEach((s, si) => {
      const col = s.color ?? COLORS[si % COLORS.length]!;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = X(p.x);
        const y = Y(p.y);
        if (i === 0) ctx.moveTo(x, y);
        else if (s.step) { ctx.lineTo(x, Y(s.points[i - 1]!.y)); ctx.lineTo(x, y); }
        else ctx.lineTo(x, y);
      });
      if (s.points.length > 1) ctx.stroke();
      if (s.dots || s.points.length < 60 || s.points.length === 1) for (const p of s.points) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2, 0, Math.PI * 2); ctx.fill(); }
    });
    if (hover) {
      ctx.strokeStyle = fg;
      ctx.beginPath(); ctx.arc(X(hover.x), Y(hover.y), 4, 0, Math.PI * 2); ctx.stroke();
    }
  };
  render(null);

  const nearest = (cx: number): { s: Series; p: { x: number; y: number } } | null => {
    let best: { s: Series; p: { x: number; y: number }; d: number } | null = null;
    for (const s of o.series) for (const p of s.points) {
      const d = Math.abs(X(p.x) - cx);
      if (!best || d < best.d) best = { s, p, d };
    }
    return best;
  };
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * width;
    const n = nearest(cx);
    if (!n) return;
    render(n.p);
    tip.textContent = `${n.s.label}: ${fy(n.p.y)} at ${o.xLabel.toLowerCase()} ${fx(n.p.x)}`;
  });
  canvas.addEventListener('mouseleave', () => render(null));
  return box;
}

/** Text alternative: count, min/max/avg per series and which end is better. */
function describe(o: ChartOptions): string {
  return o.series.map((s) => {
    const ys = s.points.map((p) => p.y);
    if (!ys.length) return `${s.label}: no data.`;
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    const best = o.lowerIsBetter ? Math.min(...ys) : Math.max(...ys);
    return `${s.label}: ${ys.length} points, min ${Math.min(...ys).toFixed(2)}, max ${Math.max(...ys).toFixed(2)}, average ${avg.toFixed(2)}, best ${best.toFixed(2)}${o.lowerIsBetter ? ' (lower is better)' : ''}.`;
  }).join(' ');
}
