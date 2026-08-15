/**
 * Radio — WebAudio-synthesized in-car radio with four distinct stations.
 * No audio asset files: every station is generated procedurally with the
 * WebAudio API. The AudioContext is created lazily on first power-on and
 * resumed from a user gesture. Per-station oscillator/filter state is kept
 * alive and swapped by the bus gain, so only the active station is audible;
 * everything mutes instantly when the radio is off or volume is zero. Speed
 * subtly modulates tempo and filters for each station.
 */

const LOOKAHEAD = 0.16; // seconds of audio scheduled ahead of playback
const STEPS_PER_BEAT = 4; // 16th-note step grid
const RING = 1024; // step-counter modulus (keeps indices small)

interface Station {
  readonly name: string;
  start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void;
  setBusGain(ctx: AudioContext, gain: number): void;
  schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void;
  modulate(ctx: AudioContext, speedKmh: number): void;
  bpmFor(speedKmh: number): number;
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function makeNoiseSrc(ctx: AudioContext, buffer: AudioBuffer, filter: BiquadFilterNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(filter);
  src.start();
  return src;
}

abstract class BaseStation implements Station {
  readonly name: string;
  protected out!: GainNode;

  constructor(name: string) {
    this.name = name;
  }

  setBusGain(ctx: AudioContext, gain: number): void {
    this.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
  }

  abstract start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void;
  abstract schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void;
  abstract modulate(ctx: AudioContext, speedKmh: number): void;
  abstract bpmFor(speedKmh: number): number;
}

/** Station 1/4 — driving bass line with four-on-the-floor kick and offbeat hats. */
class DrivingBassStation extends BaseStation {
  private bassOsc!: OscillatorNode;
  private bassFilter!: BiquadFilterNode;
  private bassEnv!: GainNode;
  private kickOsc!: OscillatorNode;
  private kickEnv!: GainNode;
  private hatFilter!: BiquadFilterNode;
  private hatEnv!: GainNode;

  private readonly patternLen = 32;
  private readonly bassLine = [
    55.0, 0, 0, 55.0, 0, 0, 65.41, 0,
    55.0, 0, 0, 73.42, 0, 0, 82.41, 0,
    87.31, 0, 0, 87.31, 0, 0, 98.0, 0,
    87.31, 0, 0, 98.0, 0, 0, 110.0, 0,
  ];

  start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void {
    this.out = ctx.createGain();
    this.out.connect(output);

    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = 'sawtooth';
    this.bassOsc.frequency.value = 55;
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.frequency.value = 650;
    this.bassFilter.Q.value = 7;
    this.bassEnv = ctx.createGain();
    this.bassEnv.gain.value = 0;
    this.bassOsc.connect(this.bassFilter).connect(this.bassEnv).connect(this.out);
    this.bassOsc.start();

    this.kickOsc = ctx.createOscillator();
    this.kickOsc.type = 'sine';
    this.kickOsc.frequency.value = 60;
    this.kickEnv = ctx.createGain();
    this.kickEnv.gain.value = 0;
    this.kickOsc.connect(this.kickEnv).connect(this.out);
    this.kickOsc.start();

    this.hatFilter = ctx.createBiquadFilter();
    this.hatFilter.type = 'highpass';
    this.hatFilter.frequency.value = 8000;
    this.hatEnv = ctx.createGain();
    this.hatEnv.gain.value = 0;
    const hatSrc = makeNoiseSrc(ctx, noise, this.hatFilter);
    hatSrc.connect(this.hatEnv);
    this.hatEnv.connect(this.out);
  }

  schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void {
    void ctx;
    const s = step % this.patternLen;
    const beat = s % STEPS_PER_BEAT;
    if (beat === 0) {
      this.kickOsc.frequency.setValueAtTime(150, time);
      this.kickOsc.frequency.exponentialRampToValueAtTime(42, time + 0.08);
      this.kickEnv.gain.cancelScheduledValues(time);
      this.kickEnv.gain.setValueAtTime(0, time);
      this.kickEnv.gain.linearRampToValueAtTime(0.85, time + 0.003);
      this.kickEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    } else if (beat === 2) {
      this.hatEnv.gain.cancelScheduledValues(time);
      this.hatEnv.gain.setValueAtTime(0, time);
      this.hatEnv.gain.linearRampToValueAtTime(0.2, time + 0.002);
      this.hatEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    }
    const freq = this.bassLine[s];
    if (freq > 0) {
      const len = Math.min(stepDur * 3, 0.42);
      this.bassOsc.frequency.setValueAtTime(freq, time);
      this.bassEnv.gain.cancelScheduledValues(time);
      this.bassEnv.gain.setValueAtTime(0, time);
      this.bassEnv.gain.linearRampToValueAtTime(0.55, time + 0.006);
      this.bassEnv.gain.exponentialRampToValueAtTime(0.001, time + len);
    }
  }

  modulate(ctx: AudioContext, speedKmh: number): void {
    this.bassFilter.frequency.setTargetAtTime(600 + clampN(speedKmh, 0, 260) * 3, ctx.currentTime, 0.15);
  }

  bpmFor(speedKmh: number): number {
    return 126 + clampN(speedKmh / 260, 0, 1) * 22;
  }
}

/** Station 2/4 — synth arpeggio over a moving chord pad with echo. */
class SynthArpStation extends BaseStation {
  private arpOsc1!: OscillatorNode;
  private arpOsc2!: OscillatorNode;
  private arpFilter!: BiquadFilterNode;
  private arpEnv!: GainNode;
  private padOsc1!: OscillatorNode;
  private padOsc2!: OscillatorNode;
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private delayNode!: DelayNode;
  private delayFeedback!: GainNode;
  private delayWet!: GainNode;

  private readonly chords = [
    [220.0, 261.63, 329.63, 440.0], // Am
    [174.61, 220.0, 261.63, 349.23], // F
    [196.0, 261.63, 329.63, 392.0], // C
    [196.0, 246.94, 293.66, 392.0], // G
  ];
  private readonly arpIdx = [0, 1, 2, 3, 2, 1, 3, 0, 1, 2, 0, 3, 2, 1, 3, 2];

  start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void {
    void noise;
    this.out = ctx.createGain();
    this.out.connect(output);

    this.arpOsc1 = ctx.createOscillator();
    this.arpOsc1.type = 'sawtooth';
    this.arpOsc2 = ctx.createOscillator();
    this.arpOsc2.type = 'sawtooth';
    this.arpOsc2.detune.value = 8;
    this.arpFilter = ctx.createBiquadFilter();
    this.arpFilter.type = 'lowpass';
    this.arpFilter.frequency.value = 1200;
    this.arpFilter.Q.value = 3;
    this.arpEnv = ctx.createGain();
    this.arpEnv.gain.value = 0;
    this.arpOsc1.connect(this.arpFilter);
    this.arpOsc2.connect(this.arpFilter);
    this.arpFilter.connect(this.arpEnv);
    this.arpEnv.connect(this.out);
    this.arpOsc1.start();
    this.arpOsc2.start();

    this.padOsc1 = ctx.createOscillator();
    this.padOsc1.type = 'triangle';
    this.padOsc2 = ctx.createOscillator();
    this.padOsc2.type = 'triangle';
    this.padOsc2.detune.value = -6;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 520;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.045;
    this.padOsc1.connect(this.padFilter);
    this.padOsc2.connect(this.padFilter);
    this.padFilter.connect(this.padGain).connect(this.out);
    this.padOsc1.start();
    this.padOsc2.start();

    this.delayNode = ctx.createDelay(1.0);
    this.delayNode.delayTime.value = 0.28;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.32;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0.35;
    this.delayNode.connect(this.delayFeedback).connect(this.delayNode);
    this.delayNode.connect(this.delayWet).connect(this.out);
    this.arpEnv.connect(this.delayNode);
  }

  schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void {
    void ctx;
    const bar = Math.floor(step / 16) % this.chords.length;
    if (step % 16 === 0) {
      const c = this.chords[bar];
      this.padOsc1.frequency.setValueAtTime(c[0], time);
      this.padOsc2.frequency.setValueAtTime(c[2], time);
    }
    const noteIdx = this.arpIdx[step % 16];
    const freq = this.chords[bar][noteIdx];
    const len = Math.min(stepDur * 2.5, 0.3);
    this.arpOsc1.frequency.setValueAtTime(freq, time);
    this.arpOsc2.frequency.setValueAtTime(freq, time);
    this.arpEnv.gain.cancelScheduledValues(time);
    this.arpEnv.gain.setValueAtTime(0, time);
    this.arpEnv.gain.linearRampToValueAtTime(0.3, time + 0.005);
    this.arpEnv.gain.exponentialRampToValueAtTime(0.001, time + len);
  }

  modulate(ctx: AudioContext, speedKmh: number): void {
    this.arpFilter.frequency.setTargetAtTime(900 + clampN(speedKmh, 0, 260) * 4, ctx.currentTime, 0.15);
  }

  bpmFor(speedKmh: number): number {
    return 108 + clampN(speedKmh / 260, 0, 1) * 16;
  }
}

/** Station 3/4 — boom-bap lo-fi beat with tremolo pad and vinyl crackle. */
class LofiBeatStation extends BaseStation {
  private kickOsc!: OscillatorNode;
  private kickEnv!: GainNode;
  private snareFilter!: BiquadFilterNode;
  private snareEnv!: GainNode;
  private hatFilter!: BiquadFilterNode;
  private hatEnv!: GainNode;
  private padOsc1!: OscillatorNode;
  private padOsc2!: OscillatorNode;
  private padOsc3!: OscillatorNode;
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private lfo!: OscillatorNode;
  private lfoDepth!: GainNode;
  private crackleFilter!: BiquadFilterNode;
  private crackleGain!: GainNode;

  private readonly patternLen = 16;
  private readonly padChord = [220.0, 261.63, 329.63];

  start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void {
    this.out = ctx.createGain();
    this.out.connect(output);

    this.kickOsc = ctx.createOscillator();
    this.kickOsc.type = 'sine';
    this.kickOsc.frequency.value = 60;
    this.kickEnv = ctx.createGain();
    this.kickEnv.gain.value = 0;
    this.kickOsc.connect(this.kickEnv).connect(this.out);
    this.kickOsc.start();

    this.snareFilter = ctx.createBiquadFilter();
    this.snareFilter.type = 'bandpass';
    this.snareFilter.frequency.value = 1800;
    this.snareFilter.Q.value = 0.8;
    this.snareEnv = ctx.createGain();
    this.snareEnv.gain.value = 0;
    const snareSrc = makeNoiseSrc(ctx, noise, this.snareFilter);
    snareSrc.connect(this.snareEnv);
    this.snareEnv.connect(this.out);

    this.hatFilter = ctx.createBiquadFilter();
    this.hatFilter.type = 'highpass';
    this.hatFilter.frequency.value = 7500;
    this.hatEnv = ctx.createGain();
    this.hatEnv.gain.value = 0;
    const hatSrc = makeNoiseSrc(ctx, noise, this.hatFilter);
    hatSrc.connect(this.hatEnv);
    this.hatEnv.connect(this.out);

    this.padOsc1 = ctx.createOscillator();
    this.padOsc1.type = 'triangle';
    this.padOsc1.frequency.value = this.padChord[0];
    this.padOsc2 = ctx.createOscillator();
    this.padOsc2.type = 'triangle';
    this.padOsc2.frequency.value = this.padChord[1];
    this.padOsc2.detune.value = 5;
    this.padOsc3 = ctx.createOscillator();
    this.padOsc3.type = 'triangle';
    this.padOsc3.frequency.value = this.padChord[2];
    this.padOsc3.detune.value = -4;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 420;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.05;
    this.padOsc1.connect(this.padFilter);
    this.padOsc2.connect(this.padFilter);
    this.padOsc3.connect(this.padFilter);
    this.padFilter.connect(this.padGain).connect(this.out);
    this.padOsc1.start();
    this.padOsc2.start();
    this.padOsc3.start();

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 0.35;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 140;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.padFilter.frequency);
    this.lfo.start();

    this.crackleFilter = ctx.createBiquadFilter();
    this.crackleFilter.type = 'highpass';
    this.crackleFilter.frequency.value = 6000;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0.006;
    const crackleSrc = makeNoiseSrc(ctx, noise, this.crackleFilter);
    crackleSrc.connect(this.crackleGain);
    this.crackleGain.connect(this.out);
  }

  schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void {
    void ctx;
    void stepDur;
    const s = step % this.patternLen;
    if (s % 8 === 0) {
      this.kickOsc.frequency.setValueAtTime(160, time);
      this.kickOsc.frequency.exponentialRampToValueAtTime(42, time + 0.1);
      this.kickEnv.gain.cancelScheduledValues(time);
      this.kickEnv.gain.setValueAtTime(0, time);
      this.kickEnv.gain.linearRampToValueAtTime(1.0, time + 0.004);
      this.kickEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    } else if (s % 8 === 4) {
      this.snareEnv.gain.cancelScheduledValues(time);
      this.snareEnv.gain.setValueAtTime(0, time);
      this.snareEnv.gain.linearRampToValueAtTime(0.8, time + 0.004);
      this.snareEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    }
    if (s % 4 === 2) {
      this.hatEnv.gain.cancelScheduledValues(time);
      this.hatEnv.gain.setValueAtTime(0, time);
      this.hatEnv.gain.linearRampToValueAtTime(0.18, time + 0.002);
      this.hatEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    } else if (s % 2 === 1) {
      this.hatEnv.gain.cancelScheduledValues(time);
      this.hatEnv.gain.setValueAtTime(0, time);
      this.hatEnv.gain.linearRampToValueAtTime(0.07, time + 0.002);
      this.hatEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    }
  }

  modulate(ctx: AudioContext, speedKmh: number): void {
    this.padFilter.frequency.setTargetAtTime(340 + clampN(speedKmh, 0, 260) * 1.5, ctx.currentTime, 0.2);
  }

  bpmFor(speedKmh: number): number {
    return 84 + clampN(speedKmh / 260, 0, 1) * 10;
  }
}

/** Station 4/4 — news talk: bandpass-filtered noise in speech-like syllables with a pulse. */
class NewsTalkStation extends BaseStation {
  private speechFilter!: BiquadFilterNode;
  private speechEnv!: GainNode;
  private pulseOsc!: OscillatorNode;
  private pulseEnv!: GainNode;
  private rngState = 1;
  private speedShift = 0;

  private readonly patternLen = 16;
  private readonly vowel = [200, 420, 700, 1000, 1500, 2200];

  start(ctx: AudioContext, output: GainNode, noise: AudioBuffer): void {
    this.out = ctx.createGain();
    this.out.connect(output);

    this.speechFilter = ctx.createBiquadFilter();
    this.speechFilter.type = 'bandpass';
    this.speechFilter.frequency.value = 700;
    this.speechFilter.Q.value = 3.2;
    this.speechEnv = ctx.createGain();
    this.speechEnv.gain.value = 0;
    const src = makeNoiseSrc(ctx, noise, this.speechFilter);
    src.connect(this.speechEnv);
    this.speechEnv.connect(this.out);

    this.pulseOsc = ctx.createOscillator();
    this.pulseOsc.type = 'sine';
    this.pulseOsc.frequency.value = 120;
    this.pulseEnv = ctx.createGain();
    this.pulseEnv.gain.value = 0;
    this.pulseOsc.connect(this.pulseEnv).connect(this.out);
    this.pulseOsc.start();
  }

  schedule(ctx: AudioContext, time: number, step: number, stepDur: number): void {
    void ctx;
    void stepDur;
    const s = step % this.patternLen;
    if (s === 0) {
      this.pulseOsc.frequency.setValueAtTime(130, time);
      this.pulseEnv.gain.cancelScheduledValues(time);
      this.pulseEnv.gain.setValueAtTime(0, time);
      this.pulseEnv.gain.linearRampToValueAtTime(0.32, time + 0.01);
      this.pulseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    }
    if (this.rand() < 0.82) {
      const len = 0.09 + this.rand() * 0.06;
      const shift = this.speedShift;
      const f0 = this.vowel[Math.floor(this.rand() * this.vowel.length)] + shift;
      const f1 = this.vowel[Math.floor(this.rand() * this.vowel.length)] + shift;
      this.speechFilter.frequency.cancelScheduledValues(time);
      this.speechFilter.frequency.setValueAtTime(Math.max(80, f0), time);
      this.speechFilter.frequency.exponentialRampToValueAtTime(Math.max(80, f1), time + len);
      const amp = 0.28 + this.rand() * 0.5;
      this.speechEnv.gain.cancelScheduledValues(time);
      this.speechEnv.gain.setValueAtTime(0, time);
      this.speechEnv.gain.linearRampToValueAtTime(amp, time + 0.012);
      this.speechEnv.gain.exponentialRampToValueAtTime(0.001, time + len + 0.02);
    }
  }

  modulate(ctx: AudioContext, speedKmh: number): void {
    void ctx;
    this.speedShift = clampN(speedKmh, 0, 260) * 0.4;
  }

  bpmFor(speedKmh: number): number {
    return 104 + clampN(speedKmh / 260, 0, 1) * 22;
  }

  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
}

export class Radio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private stations: Station[] = [];
  private activeIndex = 0;
  private powerOn = false;
  private vol = 0.7;
  private step = 0;
  private nextStepTime = 0;

  constructor() {
    this.stations = [
      new DrivingBassStation('Drive Bass'),
      new SynthArpStation('Synth Arp'),
      new LofiBeatStation('Lofi Beats'),
      new NewsTalkStation('News Talk'),
    ];
  }

  get on(): boolean {
    return this.powerOn;
  }

  get volume(): number {
    return this.vol;
  }

  get station(): number {
    return this.activeIndex;
  }

  get stationCount(): number {
    return this.stations.length;
  }

  togglePower(): void {
    this.powerOn = !this.powerOn;
    if (this.powerOn) {
      const ctx = this.ensureContext();
      void ctx.resume().catch(() => undefined);
      this.step = 0;
      this.nextStepTime = ctx.currentTime + 0.08;
    }
    this.applyGain();
    this.applyStationGains();
  }

  nextStation(): void {
    this.setStation((this.activeIndex + 1) % this.stations.length);
  }

  prevStation(): void {
    this.setStation((this.activeIndex - 1 + this.stations.length) % this.stations.length);
  }

  setVolume(v: number): void {
    this.vol = clampN(v, 0, 1);
    this.applyGain();
  }

  /** Per-frame driver; pass the panel rAF dt and current vehicle speed. */
  update(dt: number, speedKmh: number): void {
    if (!this.powerOn || !this.ctx) return;
    if (this.ctx.state !== 'running') return;
    if (this.vol <= 0.0001) return;

    const active = this.stations[this.activeIndex];
    const stepDur = 60 / active.bpmFor(speedKmh) / STEPS_PER_BEAT;
    active.modulate(this.ctx, speedKmh);

    const now = this.ctx.currentTime;
    if (dt > 0.5 || this.nextStepTime < now - LOOKAHEAD) {
      this.nextStepTime = now + 0.06;
    }
    while (this.nextStepTime < now + LOOKAHEAD) {
      active.schedule(this.ctx, this.nextStepTime, this.step, stepDur);
      this.step = (this.step + 1) % RING;
      this.nextStepTime += stepDur;
    }
  }

  private setStation(index: number): void {
    this.activeIndex = index;
    if (this.ctx) {
      this.step = 0;
      this.nextStepTime = this.ctx.currentTime + 0.06;
      this.applyStationGains();
      this.blip();
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.makeContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.connect(this.master);
      this.noiseBuffer = this.makeNoiseBuffer();
      for (const s of this.stations) s.start(this.ctx, this.bus, this.noiseBuffer);
    }
    return this.ctx;
  }

  private makeContext(): AudioContext {
    const w = window as unknown as {
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext ?? AudioContext;
    return new Ctor();
  }

  private makeNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private applyGain(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this.powerOn || this.vol <= 0.0001) {
      this.master.gain.setValueAtTime(0, t);
    } else {
      this.master.gain.setTargetAtTime(this.vol, t, 0.025);
    }
  }

  private applyStationGains(): void {
    if (!this.ctx) return;
    this.stations.forEach((s, i) => {
      s.setBusGain(this.ctx!, this.powerOn && i === this.activeIndex ? 1 : 0);
    });
  }

  private blip(): void {
    const ctx = this.ctx;
    if (!ctx || !this.powerOn || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 620;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}
