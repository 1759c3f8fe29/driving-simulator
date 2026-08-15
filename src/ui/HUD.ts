/**
 * HUD — Driving heads-up display: speedometer, RPM, gear, fuel, damage,
 * warnings, camera indicator, clock, weather, FPS, trip odometer, cumulative
 * odometer, drive-time timer and speed-limit reminder.
 */

import { CONFIG, kmhToMph, clamp, formatTime } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { VehicleTelemetry } from '../vehicle/VehicleController';
import { SaveManager } from '../save/SaveManager';
import { AudioManager } from '../audio/AudioManager';

/** Persistence key for the module-level cumulative odometer. */
const ODOMETER_KEY = 'hud_odometer_v1';

/** Speed limit reminder (km/h). Set SPEED_LIMIT_ENABLED = false to disable. */
const SPEED_LIMIT_KMH = 50;
const SPEED_LIMIT_ENABLED = true;

/** Real-time gap (s) after which the per-frame dt is treated as a discontinuity
 *  (pause/resume, tab switch) and dropped from drive accounting. */
const DT_MAX = 0.5;

/** Seconds between cumulative odometer persistence writes while driving. */
const ODOMETER_PERSIST_INTERVAL = 5;

/** Kilometers to miles conversion (used for mph display). */
const KM_TO_MI = 0.621371;

/** Milliseconds the gear-change pop animation plays before resetting. */
const GEAR_POP_MS = 260;

/** Speed threshold (km/h, raw telemetry) above which the digital speedo gets the 'hot' glow. */
const HOT_SPEED_KMH = 180;

/** Health threshold below which the damage bar enters the critical blink state. */
const CRITICAL_HEALTH = 0.25;

/** RPM band below redline (rev/min) that triggers the redline glow. */
const REDLINE_BAND_RPM = 600;

/**
 * Read the persisted cumulative odometer. SaveManager's generic storage merges
 * object-shaped payloads, so the value is stored as `{ km }` but read with the
 * primitive fallback from the spec; both shapes are normalized here.
 */
function readOdometer(): number {
  const raw: unknown = SaveManager.get().readGeneric<unknown>(ODOMETER_KEY, 0);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const km = (raw as { km?: unknown }).km;
    if (typeof km === 'number' && Number.isFinite(km)) return km;
  }
  return 0;
}

/** Persist the cumulative odometer value. */
function writeOdometer(km: number): void {
  SaveManager.get().writeGeneric(ODOMETER_KEY, { km });
}

/** Module-level cumulative odometer — survives across HUD instances. */
let cumulativeKm = readOdometer();

export class HUD {
  private el: HTMLElement;
  private save = SaveManager.get();
  private bus = EventBus.get();
  private audio = AudioManager.get();

  private needle!: SVGLineElement;
  private rpmArc!: SVGCircleElement;
  private digital!: HTMLElement;
  private unit!: HTMLElement;
  private gearEl!: HTMLElement;
  private fuelFill!: HTMLElement;
  private healthFill!: HTMLElement;
  private damageFill!: HTMLElement;
  private warningsEl!: HTMLElement;
  private cameraEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private weatherEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private shiftFlash!: SVGCircleElement;
  private tripEl!: HTMLElement;
  private odoEl!: HTMLElement;
  private driveTimeEl!: HTMLElement;
  private speedLimitEl!: HTMLElement;
  private hudSpeedo!: HTMLElement;
  private damageLabelEl!: HTMLElement;

  // Drive accounting state. The trip readouts are *offsets* into the vehicle's
  // simulated odometer/drive-time, so a negative base means "not anchored yet".
  private tripKm = 0;
  private driveSec = 0;
  private tripBaseKm = -1;
  private driveBaseSec = -1;
  private lastOdoKm = -1;
  private lastTick = 0;
  private persistTimer = 0;

  // Feedback-class state, so per-frame toggling only touches the DOM on change.
  private lastGear = NaN;
  private gearPopTimer: number | null = null;
  private redlineState = false;
  private hotState = false;
  private criticalState = false;

  onPause: (() => void) | null = null;
  onCameraNext: (() => void) | null = null;
  onSettings: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = this.template();
    root.appendChild(this.el);
    this.bind();
    this.bus.on(Events.CAMERA_CHANGED, (p: unknown) => {
      this.cameraEl.textContent = (p as { label: string }).label;
    });
    // A new drive only begins when entering 'driving' from the menu (resumes
    // and garage/photo/replay returns continue the same trip).
    this.bus.on(Events.STATE_CHANGE, (p: unknown) => {
      const { from, to } = p as { from: string; to: string };
      if (to === 'driving' && from === 'menu') this.resetTrip();
      if (from === 'driving' && to !== 'driving') this.persistOdometer();
    });
  }

  private template(): string {
    const max = CONFIG.hud.speedoMaxKmh;
    const ticks: string[] = [];
    for (let v = 0; v <= max; v += 20) {
      const angle = -210 + (v / max) * 240;
      const rad = (angle * Math.PI) / 180;
      const major = v % 40 === 0;
      const r1 = major ? 82 : 88;
      const x1 = 110 + Math.sin(rad) * r1;
      const y1 = 110 - Math.cos(rad) * r1;
      const x2 = 110 + Math.sin(rad) * 96;
      const y2 = 110 - Math.cos(rad) * 96;
      ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${major ? '#fff' : 'rgba(255,255,255,0.4)'}" stroke-width="${major ? 2 : 1}"/>`);
      if (major) {
        const tx = 110 + Math.sin(rad) * 68;
        const ty = 110 - Math.cos(rad) * 68;
        ticks.push(`<text x="${tx}" y="${ty + 4}" fill="#9aa5b5" font-size="11" font-family="monospace" text-anchor="middle">${v}</text>`);
      }
    }
    return `
      <div class="hud-top-left">
        <div class="hud-chip hud-clock">--:--</div>
        <div class="hud-chip hud-weather">Clear</div>
        <div class="hud-chip hud-speed-limit hidden">50</div>
        <div class="hud-chip hud-fps hidden">60 FPS</div>
      </div>
      <div class="hud-top-right">
        <button class="btn icon-btn hud-btn-pause" title="Pause (Esc)">⏸</button>
        <button class="btn icon-btn hud-btn-camera" title="Camera (C)">📷</button>
        <button class="btn icon-btn hud-btn-settings" title="Settings">⚙️</button>
      </div>
      <div class="hud-warnings"></div>
      <div class="hud-speedo">
        <svg viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="104" fill="rgba(10,14,22,0.72)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
          ${ticks.join('')}
          <circle class="rpm-arc" cx="110" cy="110" r="100" fill="none" stroke="#2e9bff" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="527" stroke-dashoffset="527"
            transform="rotate(150 110 110)" opacity="0.9"/>
          <circle class="shift-flash" cx="110" cy="110" r="100" fill="none" stroke="#ff4757" stroke-width="6"
            stroke-dasharray="527" stroke-dashoffset="527" transform="rotate(150 110 110)" opacity="0"/>
          <line class="needle" x1="110" y1="110" x2="110" y2="26" stroke="#ff4757" stroke-width="3" stroke-linecap="round"
            transform="rotate(-210 110 110)" style="transition:none"/>
          <circle cx="110" cy="110" r="8" fill="#1a2230" stroke="#2e9bff" stroke-width="2"/>
        </svg>
        <div class="speedo-gear">1</div>
        <div class="speedo-digital">0</div>
        <div class="speedo-unit">km/h</div>
      </div>
      <div class="hud-bars">
        <div class="hud-bar-row hud-stat-row"><span class="hud-bar-label">Trip</span><span class="hud-stat-value hud-trip">0.0 km</span></div>
        <div class="hud-bar-row hud-stat-row"><span class="hud-bar-label">Odo</span><span class="hud-stat-value hud-odo">0 km</span></div>
        <div class="hud-bar-row hud-stat-row"><span class="hud-bar-label">Time</span><span class="hud-stat-value hud-dtime">00:00</span></div>
        <div class="hud-bar-sep"></div>
        <div class="hud-bar-row"><span class="hud-bar-label">Fuel</span><div class="hud-bar-track"><div class="hud-bar-fill fuel" style="width:100%"></div></div></div>
        <div class="hud-bar-row"><span class="hud-bar-label">Health</span><div class="hud-bar-track"><div class="hud-bar-fill health" style="width:100%"></div></div></div>
        <div class="hud-bar-row"><span class="hud-bar-label">Damage</span><div class="hud-bar-track"><div class="hud-bar-fill damage" style="width:0%"></div></div></div>
      </div>
      <div class="hud-camera-indicator">Third Person</div>
    `;
  }

  private bind(): void {
    this.needle = this.el.querySelector('.needle')!;
    this.rpmArc = this.el.querySelector('.rpm-arc')!;
    this.shiftFlash = this.el.querySelector('.shift-flash')!;
    this.digital = this.el.querySelector('.speedo-digital')!;
    this.unit = this.el.querySelector('.speedo-unit')!;
    this.gearEl = this.el.querySelector('.speedo-gear')!;
    this.fuelFill = this.el.querySelector('.hud-bar-fill.fuel')!;
    this.healthFill = this.el.querySelector('.hud-bar-fill.health')!;
    this.damageFill = this.el.querySelector('.hud-bar-fill.damage')!;
    // Damage row's label — sibling of the track that holds the damage fill.
    this.damageLabelEl = this.damageFill.parentElement!.parentElement!.querySelector('.hud-bar-label')!;
    this.hudSpeedo = this.el.querySelector('.hud-speedo')!;
    this.warningsEl = this.el.querySelector('.hud-warnings')!;
    this.cameraEl = this.el.querySelector('.hud-camera-indicator')!;
    this.clockEl = this.el.querySelector('.hud-clock')!;
    this.weatherEl = this.el.querySelector('.hud-weather')!;
    this.fpsEl = this.el.querySelector('.hud-fps')!;
    this.tripEl = this.el.querySelector('.hud-trip')!;
    this.odoEl = this.el.querySelector('.hud-odo')!;
    this.driveTimeEl = this.el.querySelector('.hud-dtime')!;
    this.speedLimitEl = this.el.querySelector('.hud-speed-limit')!;

    const hook = (sel: string, fn: (() => void) | null) => {
      const btn = this.el.querySelector(sel) as HTMLButtonElement;
      btn?.addEventListener('click', () => {
        this.audio.uiClick();
        fn?.();
      });
      btn?.addEventListener('pointerenter', () => this.audio.uiHover());
    };
    hook('.hud-btn-pause', () => this.onPause?.());
    hook('.hud-btn-camera', () => this.onCameraNext?.());
    hook('.hud-btn-settings', () => this.onSettings?.());
  }

  show(): void {
    this.el.classList.add('visible');
    this.lastTick = 0; // avoid a dt jump from the first frame after showing
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  /** Reset the trip odometer and drive-time timer (new drive). */
  resetTrip(): void {
    this.tripKm = 0;
    this.driveSec = 0;
    // Re-anchor on the next update() against whatever the vehicle reports then.
    this.tripBaseKm = -1;
    this.driveBaseSec = -1;
    this.lastTick = 0;
    this.persistTimer = 0;
  }

  /** Write the cumulative odometer to persistent storage. */
  private persistOdometer(): void {
    writeOdometer(cumulativeKm);
  }

  update(t: VehicleTelemetry, timeOfDay: number, weatherLabel: string, fps: number): void {
    const units = this.save.settings.gameplay.units;
    const speed = units === 'mph' ? kmhToMph(t.speedKmh) : t.speedKmh;
    const max = units === 'mph' ? CONFIG.hud.speedoMaxKmh * 0.621371 : CONFIG.hud.speedoMaxKmh;

    // Wall-clock reference for the odometer persistence throttle. The drive
    // readouts no longer integrate a render delta (see below), so this is the
    // only thing left that needs real time.
    const now = performance.now();

    // Needle
    const angle = -210 + clamp(speed / max, 0, 1) * 240;
    this.needle.setAttribute('transform', `rotate(${angle} 110 110)`);
    this.digital.textContent = String(Math.round(speed));
    this.unit.textContent = units === 'mph' ? 'mph' : 'km/h';
    this.gearEl.textContent = t.gear;

    // Gear-change pop: retrigger on every gear change, restarting the timer so
    // rapid shifts don't cut the animation short. The first frame only records
    // the baseline gear, so the HUD doesn't pop on mount/show.
    if (t.gearIndex !== this.lastGear) {
      if (Number.isFinite(this.lastGear)) {
        this.gearEl.classList.add('gear-pop');
        if (this.gearPopTimer !== null) window.clearTimeout(this.gearPopTimer);
        this.gearPopTimer = window.setTimeout(() => {
          this.gearEl.classList.remove('gear-pop');
        }, GEAR_POP_MS);
      }
      this.lastGear = t.gearIndex;
    }

    // High-speed glow on the digital readout (raw km/h, unit-independent).
    const hot = t.speedKmh > HOT_SPEED_KMH;
    if (hot !== this.hotState) {
      this.hotState = hot;
      this.digital.classList.toggle('hot', hot);
    }

    // RPM arc (527 = circumference portion for 240°)
    const rpmN = clamp(t.rpm / CONFIG.hud.rpmGaugeMax, 0, 1);
    this.rpmArc.setAttribute('stroke-dashoffset', String(527 - rpmN * 527));
    const nearRedline = t.rpm > CONFIG.vehicle.redline - REDLINE_BAND_RPM;
    this.rpmArc.setAttribute('stroke', nearRedline ? '#ff4757' : '#2e9bff');
    this.shiftFlash.setAttribute('opacity', nearRedline && Math.floor(now / 150) % 2 === 0 ? '0.8' : '0');
    // Redline glow over the whole speedo cluster.
    if (nearRedline !== this.redlineState) {
      this.redlineState = nearRedline;
      this.hudSpeedo.classList.toggle('redline', nearRedline);
    }

    // Bars
    this.fuelFill.style.width = `${t.fuelPercent * 100}%`;
    this.healthFill.style.width = `${t.health * 100}%`;
    const dmg = 1 - t.health;
    this.damageFill.style.width = `${dmg * 100}%`;
    // Critical-damage blink on the damage bar and its label.
    const critical = (t.health ?? 1) < CRITICAL_HEALTH;
    if (critical !== this.criticalState) {
      this.criticalState = critical;
      this.damageFill.classList.toggle('critical', critical);
      this.damageLabelEl.classList.toggle('critical', critical);
    }

    // Warnings
    const warnings: string[] = [];
    if (t.fuelPercent < 0.12) warnings.push('<span class="hud-warning" style="color:var(--warning)" title="Low fuel">⛽</span>');
    if (t.fuelPercent <= 0) warnings.push('<span class="hud-warning" style="color:var(--danger)" title="Fuel empty">⛽</span>');
    if (t.damage.engine > 0.5) warnings.push('<span class="hud-warning" style="color:var(--danger)" title="Engine damage">🔧</span>');
    if (t.handbrake) warnings.push('<span class="hud-warning" style="color:var(--warning)" title="Handbrake">🅿️</span>');
    if (t.headlights) warnings.push(`<span style="color:${t.highBeam ? '#7cc4ff' : 'var(--text-dim)'}" title="Headlights">💡</span>`);
    if (t.indicatorLeft || t.hazards) warnings.push('<span class="hud-warning" style="color:var(--success)">◀</span>');
    if (t.indicatorRight || t.hazards) warnings.push('<span class="hud-warning" style="color:var(--success)">▶</span>');
    const wHtml = warnings.join('');
    if (this.warningsEl.innerHTML !== wHtml) this.warningsEl.innerHTML = wHtml;

    // Clock / weather / fps
    const hh = Math.floor(timeOfDay);
    const mm = Math.floor((timeOfDay - hh) * 60);
    this.clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.weatherEl.textContent = weatherLabel;
    this.fpsEl.textContent = `${fps} FPS`;
    this.fpsEl.classList.toggle('hidden', !this.save.settings.interface.showFPS);
    this.clockEl.parentElement!.style.display = this.save.settings.interface.showClock ? '' : 'none';

    // Trip odometer / cumulative odometer / drive-time timer.
    //
    // All three are read from the vehicle's own simulated counters rather than
    // integrated here against a render delta. `fixedUpdate` accumulates distance
    // and moving time per physics step, so these advance in lockstep with the
    // simulation even when the renderer is running at a few FPS and one frame
    // covers less simulated time than it took to draw.
    const baseKm = t.odometerKm;
    if (this.tripBaseKm < 0) this.tripBaseKm = baseKm;
    // A respawn/load can move the counter backwards; re-anchor instead of
    // reporting a negative trip.
    if (baseKm < this.tripBaseKm) this.tripBaseKm = baseKm;
    this.tripKm = baseKm - this.tripBaseKm;

    if (this.driveBaseSec < 0) this.driveBaseSec = t.driveTimeSec;
    if (t.driveTimeSec < this.driveBaseSec) this.driveBaseSec = t.driveTimeSec;
    this.driveSec = t.driveTimeSec - this.driveBaseSec;

    // The cumulative odometer tracks the same simulated distance, advanced by
    // the delta since the last frame so it survives across HUD instances.
    if (this.lastOdoKm >= 0 && baseKm > this.lastOdoKm) cumulativeKm += baseKm - this.lastOdoKm;
    this.lastOdoKm = baseKm;

    // Real seconds since the last frame, with pause/tab-switch gaps dropped.
    let persistDt = this.lastTick > 0 ? (now - this.lastTick) / 1000 : 0;
    this.lastTick = now;
    if (persistDt <= 0 || persistDt > DT_MAX) persistDt = 0;

    this.persistTimer += persistDt;
    if (this.persistTimer >= ODOMETER_PERSIST_INTERVAL) {
      this.persistTimer = 0;
      this.persistOdometer();
    }

    const distMult = units === 'mph' ? KM_TO_MI : 1;
    const distUnit = units === 'mph' ? 'mi' : 'km';
    const tripText = `${(this.tripKm * distMult).toFixed(1)} ${distUnit}`;
    if (this.tripEl.textContent !== tripText) this.tripEl.textContent = tripText;
    const odoText = `${Math.round(cumulativeKm * distMult)} ${distUnit}`;
    if (this.odoEl.textContent !== odoText) this.odoEl.textContent = odoText;
    const timeText = formatTime(this.driveSec);
    if (this.driveTimeEl.textContent !== timeText) this.driveTimeEl.textContent = timeText;

    // Speed limit reminder chip (value shown in the active unit)
    const overLimit = SPEED_LIMIT_ENABLED && t.speedKmh > SPEED_LIMIT_KMH;
    this.speedLimitEl.classList.toggle('hidden', !overLimit);
    if (overLimit) {
      const limitText = String(Math.round(units === 'mph' ? SPEED_LIMIT_KMH * KM_TO_MI : SPEED_LIMIT_KMH));
      if (this.speedLimitEl.textContent !== limitText) this.speedLimitEl.textContent = limitText;
    }
  }
}
