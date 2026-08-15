/**
 * AudioManager — WebAudio-based engine synth, cached samples,
 * 3D positional audio, volume buses, fades. No duplicate playback.
 */

import { CONFIG, clamp, damp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { ResourceManager } from '../core/ResourceManager';
import { SaveManager } from '../save/SaveManager';

export class AudioManager {
  private static instance: AudioManager;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private effectsBus!: GainNode;
  private uiBus!: GainNode;
  private ambienceBus!: GainNode;
  private resources = ResourceManager.get();
  private save = SaveManager.get();
  private bus = EventBus.get();

  // Engine synth nodes
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineSample: AudioBufferSourceNode | null = null;
  private engineSampleGain: GainNode | null = null;
  private engineRunning = false;

  // Wind / ambience
  private windNoise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;

  private skidGain: GainNode | null = null;
  private skidSource: AudioBufferSourceNode | null = null;

  private currentRPM = 800;
  private currentThrottle = 0;
  private currentSpeed = 0;
  private unlocked = false;

  private constructor() {}

  static get(): AudioManager {
    if (!AudioManager.instance) AudioManager.instance = new AudioManager();
    return AudioManager.instance;
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    this.ensureContext();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    this.unlocked = true;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.engineBus = this.ctx.createGain();
      this.effectsBus = this.ctx.createGain();
      this.uiBus = this.ctx.createGain();
      this.ambienceBus = this.ctx.createGain();
      for (const b of [this.engineBus, this.effectsBus, this.uiBus, this.ambienceBus]) b.connect(this.master);
      this.applyVolumes();
      this.buildWind();
      this.buildRain();
      this.buildSkid();
    }
    return this.ctx;
  }

  get context(): AudioContext {
    return this.ensureContext();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.save.settings.audio;
    const mute = s.muted ? 0 : 1;
    this.master.gain.value = s.master * mute;
    this.engineBus.gain.value = s.engine;
    this.effectsBus.gain.value = s.effects;
    this.uiBus.gain.value = s.ui;
    this.ambienceBus.gain.value = s.ambience;
  }

  // ---------- Engine ----------

  startEngine(): void {
    const ctx = this.ensureContext();
    if (this.engineRunning) return;
    this.engineRunning = true;

    // Play starter sample if available
    const startBuffer = this.resources.getAudio('engine_start');
    if (startBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = startBuffer;
      const g = ctx.createGain();
      g.gain.value = 0.7;
      src.connect(g).connect(this.engineBus);
      src.start();
    }

    // Idle sample loop (real recorded engine)
    const idleBuffer = this.resources.getAudio('engine_idle');
    if (idleBuffer) {
      this.engineSample = ctx.createBufferSource();
      this.engineSample.buffer = idleBuffer;
      this.engineSample.loop = true;
      this.engineSampleGain = ctx.createGain();
      this.engineSampleGain.gain.value = 0;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 900;
      this.engineSample.connect(this.engineFilter).connect(this.engineSampleGain).connect(this.engineBus);
      this.engineSample.start();
    }

    // Synth layer for RPM richness
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const synthFilter = ctx.createBiquadFilter();
    synthFilter.type = 'lowpass';
    synthFilter.frequency.value = 700;
    this.engineOsc1.connect(synthFilter);
    this.engineOsc2.connect(synthFilter);
    synthFilter.connect(this.engineGain).connect(this.engineBus);
    this.engineOsc1.start();
    this.engineOsc2.start();
  }

  stopEngine(): void {
    if (!this.engineRunning) return;
    this.engineRunning = false;
    const t = this.ctx?.currentTime ?? 0;
    this.engineGain?.gain.setTargetAtTime(0, t, 0.15);
    this.engineSampleGain?.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      try {
        this.engineOsc1?.stop();
        this.engineOsc2?.stop();
        this.engineSample?.stop();
      } catch { /* already stopped */ }
      this.engineOsc1 = null;
      this.engineOsc2 = null;
      this.engineSample = null;
    }, 600);
  }

  updateEngine(rpm: number, throttle: number, running: boolean): void {
    this.currentRPM = rpm;
    this.currentThrottle = throttle;
    if (!this.ctx || !this.engineRunning || !running) return;
    const t = this.ctx.currentTime;
    const rpmN = clamp((rpm - CONFIG.vehicle.idleRPM) / (CONFIG.vehicle.maxRPM - CONFIG.vehicle.idleRPM), 0, 1);

    // Sample layer: pitch follows RPM
    if (this.engineSample && this.engineSampleGain) {
      this.engineSample.playbackRate.setTargetAtTime(0.55 + rpmN * 1.9, t, 0.08);
      this.engineSampleGain.gain.setTargetAtTime(0.35 + throttle * 0.5, t, 0.1);
      this.engineFilter?.frequency.setTargetAtTime(700 + rpmN * 3800 + throttle * 1500, t, 0.1);
    }
    // Synth layer
    if (this.engineOsc1 && this.engineOsc2 && this.engineGain) {
      const baseFreq = 28 + rpmN * 165;
      this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.05);
      this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5 + 2, t, 0.05);
      this.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.16 + rpmN * 0.06, t, 0.08);
    }
  }

  // ---------- Wind / Rain / Skid ----------

  private makeNoiseBuffer(duration = 2): AudioBuffer {
    const ctx = this.ensureContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private buildWind(): void {
    const ctx = this.ensureContext();
    this.windSource(ctx);
  }

  private windSource(ctx: AudioContext): void {
    this.windNoise = ctx.createBufferSource();
    this.windNoise.buffer = this.makeNoiseBuffer(3);
    this.windNoise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windNoise.connect(this.windFilter).connect(this.windGain).connect(this.ambienceBus);
    this.windNoise.start();
  }

  private buildRain(): void {
    const ctx = this.ensureContext();
    this.rainSource = ctx.createBufferSource();
    this.rainSource.buffer = this.makeNoiseBuffer(2);
    this.rainSource.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainSource.connect(filter).connect(this.rainGain).connect(this.ambienceBus);
    this.rainSource.start();
  }

  private buildSkid(): void {
    const ctx = this.ensureContext();
    this.skidSource = ctx.createBufferSource();
    this.skidSource.buffer = this.makeNoiseBuffer(2);
    this.skidSource.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 2.5;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSource.connect(filter).connect(this.skidGain).connect(this.effectsBus);
    this.skidSource.start();
  }

  updateAmbience(speedKmh: number, windSpeed: number, rainIntensity: number, dt: number): void {
    if (!this.ctx) return;
    this.currentSpeed = speedKmh;
    const t = this.ctx.currentTime;
    const windTarget = clamp(speedKmh / 240, 0, 1) * 0.5 + clamp(windSpeed / 25, 0, 1) * 0.2;
    this.windGain?.gain.setTargetAtTime(windTarget, t, 0.3);
    this.windFilter?.frequency.setTargetAtTime(200 + speedKmh * 4, t, 0.3);
    this.rainGain?.gain.setTargetAtTime(rainIntensity * 0.4, t, 0.5);
    void dt;
  }

  updateSkid(slip: number, speedKmh: number): void {
    if (!this.ctx || !this.skidGain) return;
    const target = slip > 0.5 && speedKmh > 15 ? clamp((slip - 0.5) * 0.5, 0, 0.35) : 0;
    this.skidGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  // ---------- One-shots ----------

  playCollision(intensity: number): void {
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 + intensity * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(clamp(intensity, 0.1, 0.9), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(filter).connect(g).connect(this.effectsBus);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  playHorn(): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 370;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 466;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime + 0.35, 0.08);
    osc.connect(g);
    osc2.connect(g);
    g.connect(this.effectsBus);
    osc.start();
    osc2.start();
    osc.stop(ctx.currentTime + 0.7);
    osc2.stop(ctx.currentTime + 0.7);
  }

  playThunder(delay: number): void {
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 120;
    const g = ctx.createGain();
    const start = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.8, start + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, start + 2.4);
    src.connect(filter).connect(g).connect(this.ambienceBus);
    src.start(start);
    src.stop(start + 2.6);
  }

  // ---------- Cinematic intro (synthesized, no assets needed) ----------

  /**
   * One-shot synthesized tone with an opening lowpass sweep and exponential decay.
   * The filter cuts on at ~freq*4 and opens to ~endFreq*2 for a revving character.
   */
  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    bus: AudioNode | null,
  ): void {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq * 2), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(filter);
    filter.connect(g);
    g.connect(bus ?? this.effectsBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Cinematic intro sting — rising engine rev layers plus a filtered whoosh (~1.8s). */
  playIntroSting(): void {
    this.ensureContext();
    if (!this.ctx) return;
    this.tone(90, 320, 1.6, 'sawtooth', 0.28, this.effectsBus);
    this.tone(180, 480, 1.5, 'square', 0.10, this.effectsBus);
    this.playWhoosh();
  }

  /** Bandpass-noise swell — a filtered whoosh for the intro sting. */
  playWhoosh(): void {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.effectsBus);
    src.start(t);
    src.stop(t + 0.95);
  }

  // ---------- UI sounds (synthesized, no assets needed) ----------

  private uiTone(freq: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(this.uiBus);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  uiHover(): void { if (this.unlocked) this.uiTone(1400, 0.05, 0.06); }
  uiClick(): void { if (this.unlocked) this.uiTone(880, 0.09, 0.14, 'triangle'); }
  uiBack(): void { if (this.unlocked) this.uiTone(520, 0.1, 0.12, 'triangle'); }
  uiSuccess(): void {
    if (!this.unlocked) return;
    this.uiTone(660, 0.12, 0.14);
    setTimeout(() => this.uiTone(990, 0.18, 0.14), 90);
  }
  uiError(): void { if (this.unlocked) this.uiTone(220, 0.25, 0.16, 'sawtooth'); }
  uiNotification(): void { if (this.unlocked) this.uiTone(1180, 0.12, 0.1); }
  uiAchievement(): void {
    if (!this.unlocked) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.uiTone(f, 0.22, 0.13), i * 110));
  }
  uiCameraShutter(): void {
    if (!this.unlocked) return;
    this.uiTone(2000, 0.03, 0.2, 'square');
    setTimeout(() => this.uiTone(1200, 0.05, 0.15, 'square'), 40);
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }
}
