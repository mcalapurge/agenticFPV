// Procedural motor/prop audio (WebAudio). Every sound is synthesised from the simulated motor rpm,
// so it reacts exactly like the physics: punch-outs scream, prop-wash flutters, idle ticks over.

const POLE_PAIRS = 7; // typical 12N14P motor → electrical frequency = rpm/60 × 7

function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class MotorAudio {
  constructor(config) {
    this.config = config;
    this.ctx = null;
    this.started = false;
    const start = () => this.start();
    for (const ev of ['pointerdown', 'keydown', 'gamepadconnected']) window.addEventListener(ev, start, { once: false });
  }

  start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.distanceLp = ctx.createBiquadFilter();
    this.distanceLp.type = 'lowpass';
    this.distanceLp.frequency.value = 18000;
    this.master.connect(this.distanceLp).connect(comp).connect(ctx.destination);

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
    this.voices = [0, 1, 2, 3].map((i) => {
      const whine = ctx.createOscillator();
      whine.type = 'sawtooth';
      const whineBp = ctx.createBiquadFilter();
      whineBp.type = 'bandpass';
      whineBp.Q.value = 2.5;
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      whine.connect(whineBp).connect(whineGain).connect(this.master);

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
      bladeGain.connect(this.master);
      const detune = (i - 1.5) * 7;
      whine.detune.value = detune;
      blade.detune.value = detune;
      whine.start();
      blade.start();
      blade2.start();
      return { whine, whineBp, whineGain, blade, blade2, bladeGain };
    });

    // Broadband prop noise (band-passed around blade-pass frequency).
    this.propNoise = noiseSrc();
    this.propBp = ctx.createBiquadFilter();
    this.propBp.type = 'bandpass';
    this.propBp.Q.value = 0.7;
    this.propNoiseGain = ctx.createGain();
    this.propNoiseGain.gain.value = 0;
    this.propNoise.connect(this.propBp).connect(this.propNoiseGain).connect(this.master);

    // Prop-wash flutter: low noise amplitude-modulated by an LFO.
    this.washNoise = noiseSrc();
    const washLp = ctx.createBiquadFilter();
    washLp.type = 'lowpass';
    washLp.frequency.value = 700;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(this.washGain.gain);
    lfo.start();
    this.washNoise.connect(washLp).connect(this.washGain).connect(this.master);

    // Wind / airspeed rush.
    this.windNoise = noiseSrc();
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windLp.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windNoise.connect(this.windLp).connect(this.windGain).connect(this.master);

    this.noise = noise;
    this.lastImpactAt = 0;
  }

  impact(speed) {
    if (!this.started || !this.config.audio.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastImpactAt < 0.08) return;
    this.lastImpactAt = now;
    const v = Math.min(1, speed / 10) * this.config.audio.volume;
    // crack
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(bp).connect(g).connect(this.distanceLp);
    src.start(now, Math.random());
    src.stop(now + 0.2);
    // thump
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.15);
    const og = ctx.createGain();
    og.gain.setValueAtTime(v * 0.8, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o.connect(og).connect(this.distanceLp);
    o.start(now);
    o.stop(now + 0.22);
  }

  /**
   * @param {{motorSpeed:number[], propwashLevel:number, vel:{length():number}}} quad
   * @param {number} listenerDistance metres between "ears" and quad (0 in FPV)
   * @param {boolean} paused
   */
  update(quad, listenerDistance, paused, blades = 3) {
    if (!this.started) return;
    const a = this.config.audio;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tc = 0.025;
    const on = a.enabled && !paused;
    const distGain = 1 / (1 + listenerDistance * 0.12);
    this.master.gain.setTargetAtTime(on ? a.volume * distGain : 0, t, 0.05);
    this.distanceLp.frequency.setTargetAtTime(Math.max(1200, 18000 / (1 + listenerDistance * 0.08)), t, 0.1);
    const maxRpm = this.config.physics.maxRpm;
    let avg = 0;
    this.voices.forEach((v, i) => {
      const s = Math.abs(quad.motorSpeed[i]);
      avg += s / 4;
      const rpm = Math.max(300, s * maxRpm);
      const fe = (rpm / 60) * POLE_PAIRS;
      const fb = (rpm / 60) * blades;
      v.whine.frequency.setTargetAtTime(fe, t, tc);
      v.whineBp.frequency.setTargetAtTime(Math.min(fe * 1.5, ctx.sampleRate * 0.45), t, tc);
      v.blade.frequency.setTargetAtTime(fb, t, tc);
      v.blade2.frequency.setTargetAtTime(fb * 2, t, tc);
      const level = s < 0.01 ? 0 : Math.pow(s, 1.3);
      v.whineGain.gain.setTargetAtTime(level * 0.05 * a.motorVolume, t, tc);
      v.bladeGain.gain.setTargetAtTime(level * 0.09 * a.motorVolume, t, tc);
    });
    const bladeFreq = ((Math.max(0.05, avg) * maxRpm) / 60) * blades;
    this.propBp.frequency.setTargetAtTime(Math.min(bladeFreq * 1.2, ctx.sampleRate * 0.45), t, tc);
    this.propNoiseGain.gain.setTargetAtTime(Math.pow(avg, 1.6) * 0.5 * a.motorVolume, t, tc);
    this.washGain.gain.setTargetAtTime(quad.propwashLevel * 0.6 * a.motorVolume, t, 0.05);
    const speed = quad.vel.length();
    this.windGain.gain.setTargetAtTime(Math.min(0.5, speed * speed * 0.00035) * a.windVolume, t, 0.1);
    this.windLp.frequency.setTargetAtTime(300 + speed * 40, t, 0.1);
  }
}
