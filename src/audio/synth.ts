// Original synthesised sounds (WebAudio oscillators and noise). No audio files are shipped.
export type Sound = 'hit' | 'perfect' | 'miss' | 'loss' | 'damage' | 'countdown' | 'start' | 'end' | 'last-ten' | 'hub' | 'blocked' | 'cancel';

class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.6;
  muted = false;
  private focused = true;

  /** Create/resume the audio context. Call from a user gesture (click / key). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.apply();
      }
      if (this.ctx.state === 'suspended' && this.focused && !this.muted) void this.ctx.resume();
    } catch {
      this.ctx = null; // audio unavailable: the app works silently
    }
  }

  setFocus(focused: boolean): void {
    this.focused = focused;
    if (!this.ctx) return;
    if (!focused) void this.ctx.suspend();
    else if (!this.muted) void this.ctx.resume();
  }

  configure(volume: number, muted: boolean): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    this.apply();
  }

  private apply(): void {
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime);
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, lowpass: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = ((s / 0x7fffffff) * 2 - 1) * (1 - i / n);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  play(s: Sound): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    switch (s) {
      case 'hit': this.tone(880, 0.07, 'triangle', 0.5, 1320); break;
      case 'perfect': this.tone(988, 0.06, 'triangle', 0.5, 1480); this.tone(1480, 0.08, 'sine', 0.35, undefined, 0.05); break;
      case 'damage': this.tone(520, 0.05, 'square', 0.15, 600); break;
      case 'miss': this.noise(0.08, 0.35, 900); break;
      case 'loss': this.tone(330, 0.18, 'sawtooth', 0.18, 160); break;
      case 'countdown': this.tone(660, 0.09, 'sine', 0.4); break;
      case 'last-ten': this.tone(740, 0.05, 'sine', 0.25); break;
      case 'start': this.tone(990, 0.16, 'sine', 0.45, 1320); break;
      case 'end': this.tone(660, 0.12, 'sine', 0.4); this.tone(990, 0.22, 'sine', 0.4, undefined, 0.12); break;
      case 'hub': this.tone(1200, 0.03, 'sine', 0.2); break;
      case 'blocked': this.tone(200, 0.09, 'square', 0.18, 150); break;
      case 'cancel': this.tone(440, 0.15, 'sine', 0.3, 220); break;
    }
  }
}

export const synth = new Synth();
