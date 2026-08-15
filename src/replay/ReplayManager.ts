/**
 * ReplayManager — Records vehicle transforms at fixed rate,
 * plays back with timeline controls, speed, camera follow.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';

export interface ReplayFrame {
  t: number;
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
  speed: number;
  rpm: number;
  gear: number;
}

export interface ReplayData {
  id: string;
  date: string;
  duration: number;
  frames: ReplayFrame[];
}

export type ReplayState = 'idle' | 'recording' | 'playing' | 'paused';

export class ReplayManager {
  private bus = EventBus.get();
  private save = SaveManager.get();
  state: ReplayState = 'idle';
  /** Rolling ring buffer — always records the last maxDuration seconds while driving. */
  private readonly capacity = CONFIG.replay.maxDuration * CONFIG.replay.sampleRate;
  private ring: ReplayFrame[] = [];
  private head = 0;
  private count = 0;
  private recordTime = 0;
  private sampleTimer = 0;
  private playbackTime = 0;
  playbackSpeed = 1;
  private currentReplay: ReplayData | null = null;

  startRecording(): void {
    this.ring = [];
    this.head = 0;
    this.count = 0;
    this.recordTime = 0;
    this.sampleTimer = 0;
    this.state = 'recording';
    this.bus.emit(Events.NOTIFY, { type: 'info', message: 'Recording started', icon: 'replay' });
  }

  stopRecording(): void {
    if (this.state !== 'recording') return;
    this.state = 'idle';
    this.bus.emit(Events.NOTIFY, { type: 'info', message: `Recording stopped (${this.recordTime.toFixed(1)}s)`, icon: 'replay' });
  }

  isRecording(): boolean {
    return this.state === 'recording';
  }

  recordFrame(position: THREE.Vector3, quaternion: THREE.Quaternion, speed: number, rpm: number, gear: number, dt: number): void {
    if (this.state !== 'recording') return;
    this.recordTime += dt;
    this.sampleTimer += dt;
    const interval = 1 / CONFIG.replay.sampleRate;
    if (this.sampleTimer >= interval) {
      this.sampleTimer -= interval;
      const frame: ReplayFrame = {
        t: this.recordTime,
        px: position.x, py: position.y, pz: position.z,
        qx: quaternion.x, qy: quaternion.y, qz: quaternion.z, qw: quaternion.w,
        speed, rpm, gear,
      };
      if (this.ring.length < this.capacity) {
        this.ring.push(frame);
      } else {
        this.ring[this.head] = frame; // overwrite oldest sample
        this.head = (this.head + 1) % this.capacity;
      }
      this.count = Math.min(this.count + 1, this.capacity);
    }
  }

  /** Frames in chronological order (oldest → newest) from the ring buffer. */
  getCurrentFrames(): ReplayFrame[] {
    if (this.count === 0) return [];
    const start = this.ring.length === this.capacity ? this.head : 0;
    const out: ReplayFrame[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.ring[(start + i) % this.ring.length]);
    return out;
  }

  /** Wall-clock duration of the current ring clip. */
  get currentDuration(): number {
    const frames = this.getCurrentFrames();
    if (frames.length < 2) return 0;
    return frames[frames.length - 1].t - frames[0].t;
  }

  hasRecording(): boolean {
    return this.count > 10;
  }

  saveRecording(): void {
    if (!this.hasRecording()) return;
    const raw = this.getCurrentFrames();
    const base = raw[0].t;
    const frames = raw.map((f) => ({ ...f, t: f.t - base })); // clip always starts at t=0
    const replay: ReplayData = {
      id: `replay_${Date.now()}`,
      date: new Date().toISOString(),
      duration: this.currentDuration,
      frames,
    };
    const replays = this.getSavedReplays();
    replays.unshift(replay);
    // Keep last 5 replays (storage limits)
    const trimmed = replays.slice(0, 5);
    try {
      this.save.writeGeneric(CONFIG.save.replaysKey, trimmed);
      this.bus.emit(Events.REPLAY_SAVED, { id: replay.id });
      this.bus.emit(Events.NOTIFY, { type: 'success', message: 'Replay saved', icon: 'replay' });
    } catch {
      this.bus.emit(Events.NOTIFY, { type: 'error', message: 'Replay too large to save', icon: 'error' });
    }
  }

  getSavedReplays(): ReplayData[] {
    return this.save.readGeneric<ReplayData[]>(CONFIG.save.replaysKey, []);
  }

  deleteReplay(id: string): void {
    const replays = this.getSavedReplays().filter((r) => r.id !== id);
    this.save.writeGeneric(CONFIG.save.replaysKey, replays);
  }

  play(replay?: ReplayData): void {
    const data = replay ?? (this.hasRecording()
      ? { id: 'current', date: '', duration: this.currentDuration, frames: this.getCurrentFrames() }
      : null);
    if (!data) return;
    this.currentReplay = data;
    this.playbackTime = 0;
    this.state = 'playing';
  }

  pause(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'playing';
  }

  stop(): void {
    this.state = 'idle';
    this.currentReplay = null;
  }

  seek(time: number): void {
    this.playbackTime = Math.max(0, Math.min(time, this.currentReplay?.duration ?? 0));
  }

  stepFrame(direction: 1 | -1): void {
    this.seek(this.playbackTime + direction / CONFIG.replay.sampleRate);
  }

  /** Get interpolated frame at current playback time. */
  update(dt: number): { position: THREE.Vector3; quaternion: THREE.Quaternion; speed: number; rpm: number } | null {
    if (this.state !== 'playing' || !this.currentReplay) return null;
    this.playbackTime += dt * this.playbackSpeed;
    if (this.playbackTime >= this.currentReplay.duration) {
      this.playbackTime = this.currentReplay.duration;
      this.state = 'paused';
    }
    return this.sampleAt(this.playbackTime);
  }

  sampleAt(time: number): { position: THREE.Vector3; quaternion: THREE.Quaternion; speed: number; rpm: number } | null {
    const frames = this.currentReplay?.frames;
    if (!frames || frames.length === 0) return null;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t < time) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const span = b.t - a.t;
    const f = span > 0 ? (time - a.t) / span : 0;
    const position = new THREE.Vector3(
      a.px + (b.px - a.px) * f,
      a.py + (b.py - a.py) * f,
      a.pz + (b.pz - a.pz) * f
    );
    const quaternion = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw)
      .slerp(new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw), f);
    return { position, quaternion, speed: a.speed, rpm: a.rpm };
  }

  get playback(): { time: number; duration: number; state: ReplayState; speed: number } {
    return {
      time: this.playbackTime,
      duration: this.currentReplay?.duration ?? 0,
      state: this.state,
      speed: this.playbackSpeed,
    };
  }
}
