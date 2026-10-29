// Procedural motor/prop audio (WebAudio). Every sound is synthesised from the simulated motor rpm,
// so it reacts exactly like the physics: punch-outs scream, prop-wash flutters, idle ticks over.

import type { Config } from '../../state/configSchema';
import type { QuadView } from '../sim/quad';

const POLE_PAIRS = 7; // typical 12N14P motor → electrical frequency = rpm/60 × 7

/** Electrical whine and blade-pass frequencies (Hz) for a normalised motor speed. */
export function motorFrequencies(speed: number, maxRpm: number, blades: number): { electrical: number; bladePass: number } {
  const rpm = Math.max(300, Math.abs(speed) * maxRpm);
  return { electrical: (rpm / 60) * POLE_PAIRS, bladePass: (rpm / 60) * blades };
}

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

interface Voice {
  whine: OscillatorNode;
  whineBp: BiquadFilterNode;
  whineGain: GainNode;
  blade: OscillatorNode;
  blade2: OscillatorNode;
  bladeGain: GainNode;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  distanceLp: BiquadFilterNode;
  voices: Voice[];
  propBp: BiquadFilterNode;
  propNoiseGain: GainNode;
  washGain: GainNode;
  windLp: BiquadFilterNode;
  windGain: GainNode;
  noise: AudioBuffer;
}

function buildGraph(ctx: AudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  const distanceLp = ctx.createBiquadFilter();
  distanceLp.type = 'lowpass';
  distanceLp.frequency.value = 18000;
  master.connect(distanceLp).connect(comp).connect(ctx.destination);

  const noise = noiseBuffer(ctx);
  const noiseSrc = () => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  };

  // Per-motor tonal voices.
  const voices = [0, 1, 2, 3].map((i): Voice => {
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    const whineBp = ctx.createBiquadFilter();
    whineBp.type = 'bandpass';
    whineBp.Q.value = 2.5;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineBp).connect(whineGain).connect(master);

    const blade = ctx.createOscillator();
    blade.type = 'triangle';
    const blade2 = ctx.createOscillator();
    blade2.type = 'sine';
    const bladeGain = ctx.createGain();
    bladeGain.gain.value = 0;
    const blade2Gain = ctx.createGain();
    blade2Gain.gain.value = 0.35;
    blade.connect(bladeGain);
    blade2.connect(blade2Gain).connect(bladeGain);
    bladeGain.connect(master);
    const detune = (i - 1.5) * 7; // slight beating between motors
    whine.detune.value = detune;
    blade.detune.value = detune;
    whine.start();
    blade.start();
    blade2.start();
    return { whine, whineBp, whineGain, blade, blade2, bladeGain };
  });

  // Broadband prop noise (band-passed around blade-pass frequency).
  const propBp = ctx.createBiquadFilter();
  propBp.type = 'bandpass';
  propBp.Q.value = 0.7;
  const propNoiseGain = ctx.createGain();
  propNoiseGain.gain.value = 0;
  noiseSrc().connect(propBp).connect(propNoiseGain).connect(master);

  // Prop-wash flutter: low noise amplitude-modulated by an LFO.
  const washLp = ctx.createBiquadFilter();
  washLp.type = 'lowpass';
  washLp.frequency.value = 700;
  const washGain = ctx.createGain();
  washGain.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 17;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain).connect(washGain.gain);
  lfo.start();
  noiseSrc().connect(washLp).connect(washGain).connect(master);

  // Wind / airspeed rush.
  const windLp = ctx.createBiquadFilter();
  windLp.type = 'lowpass';
  windLp.frequency.value = 400;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  noiseSrc().connect(windLp).connect(windGain).connect(master);

  return { ctx, master, distanceLp, voices, propBp, propNoiseGain, washGain, windLp, windGain, noise };
}

export class MotorAudio {
  config: Config;
  private graph: Graph | null = null;
  private lastImpactAt = 0;
  private readonly start = () => this.ensureStarted();

  constructor(config: Config) {
    this.config = config;
    // Browsers only allow audio after a user gesture.
    for (const ev of ['pointerdown', 'keydown', 'gamepadconnected'] as const) window.addEventListener(ev, this.start);
  }

  get started(): boolean {
    return this.graph !== null;
  }

  get state(): AudioContextState | 'uninitialised' {
    return this.graph?.ctx.state ?? 'uninitialised';
  }

  dispose(): void {
    for (const ev of ['pointerdown', 'keydown', 'gamepadconnected'] as const) window.removeEventListener(ev, this.start);
    void this.graph?.ctx.close();
    this.graph = null;
  }

  ensureStarted(): void {
    if (this.graph) {
      if (this.graph.ctx.state === 'suspended') void this.graph.ctx.resume();
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    this.graph = buildGraph(new AudioContext());
  }

  impact(speed: number): void {
    const g = this.graph;
    if (!g || !this.config.audio.enabled) return;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    if (now - this.lastImpactAt < 0.08) return;
    this.lastImpactAt = now;
    const v = Math.min(1, speed / 10) * this.config.audio.volume;
    // crack
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 1500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, v * 0.9), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(bp).connect(gain).connect(g.distanceLp);
    src.start(now, Math.random());
    src.stop(now + 0.2);
    // thump
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.15);
    const og = ctx.createGain();
    og.gain.setValueAtTime(Math.max(0.001, v * 0.8), now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o.connect(og).connect(g.distanceLp);
    o.start(now);
    o.stop(now + 0.22);
  }

  /**
   * @param listenerDistance metres between "ears" and quad (0 in FPV)
   */
  update(quad: QuadView, listenerDistance: number, paused: boolean, blades = 3): void {
    const g = this.graph;
    if (!g) return;
    const a = this.config.audio;
    const t = g.ctx.currentTime;
    const nyquistSafe = g.ctx.sampleRate * 0.45;
    const tc = 0.025;
    const on = a.enabled && !paused;
    g.master.gain.setTargetAtTime(on ? a.volume / (1 + listenerDistance * 0.12) : 0, t, 0.05);
    g.distanceLp.frequency.setTargetAtTime(Math.max(1200, 18000 / (1 + listenerDistance * 0.08)), t, 0.1);
    const maxRpm = this.config.physics.maxRpm;
    let avg = 0;
    g.voices.forEach((v, i) => {
      const s = Math.abs(quad.motorSpeed[i]);
      avg += s / 4;
      const f = motorFrequencies(s, maxRpm, blades);
      v.whine.frequency.setTargetAtTime(f.electrical, t, tc);
      v.whineBp.frequency.setTargetAtTime(Math.min(f.electrical * 1.5, nyquistSafe), t, tc);
      v.blade.frequency.setTargetAtTime(f.bladePass, t, tc);
      v.blade2.frequency.setTargetAtTime(f.bladePass * 2, t, tc);
      const level = s < 0.01 ? 0 : Math.pow(s, 1.3);
      v.whineGain.gain.setTargetAtTime(level * 0.05 * a.motorVolume, t, tc);
      v.bladeGain.gain.setTargetAtTime(level * 0.09 * a.motorVolume, t, tc);
    });
    const bladeFreq = motorFrequencies(Math.max(0.05, avg), maxRpm, blades).bladePass;
    g.propBp.frequency.setTargetAtTime(Math.min(bladeFreq * 1.2, nyquistSafe), t, tc);
    g.propNoiseGain.gain.setTargetAtTime(Math.pow(avg, 1.6) * 0.5 * a.motorVolume, t, tc);
    g.washGain.gain.setTargetAtTime(quad.propwashLevel * 0.6 * a.motorVolume, t, 0.05);
    const speed = quad.vel.length();
    g.windGain.gain.setTargetAtTime(Math.min(0.5, speed * speed * 0.00035) * a.windVolume, t, 0.1);
    g.windLp.frequency.setTargetAtTime(300 + speed * 40, t, 0.1);
  }
}
