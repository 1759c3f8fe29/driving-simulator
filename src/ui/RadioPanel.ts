/**
 * RadioPanel — Compact in-car radio UI: power toggle, station list, prev/next,
 * and a volume slider. Drives the Radio's per-frame update from its own
 * requestAnimationFrame loop, which runs only while the panel is visible or
 * the radio is powered on. Injects its own scoped <style>.
 */

import { Radio } from '../audio/Radio';

const STATION_NAMES = ['Drive Bass', 'Synth Arp', 'Lofi Beats', 'News Talk'];

let styleInjected = false;

function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .radio-panel {
      position: fixed; left: 16px; bottom: 16px; z-index: 40;
      width: 240px;
      background: var(--bg-panel);
      backdrop-filter: var(--blur);
      -webkit-backdrop-filter: var(--blur);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 12px 14px;
      font-family: var(--font);
      color: var(--text);
      display: none;
      user-select: none;
    }
    .radio-panel.visible { display: block; }
    .radio-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .radio-power {
      width: 34px; height: 34px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.06);
      color: var(--text-dim);
      font-size: 16px; cursor: pointer; line-height: 1;
    }
    .radio-power.on {
      background: var(--accent); color: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 14px var(--accent-glow);
    }
    .radio-title { flex: 1; font-weight: 700; letter-spacing: 2px; font-size: 13px; }
    .radio-station-idx { color: var(--text-dim); font-weight: 400; font-size: 12px; }
    .radio-nav { display: flex; gap: 6px; }
    .radio-nav button {
      width: 30px; height: 30px; border-radius: var(--radius-sm);
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06); color: var(--text);
      cursor: pointer; font-size: 12px; line-height: 1;
    }
    .radio-nav button:hover { background: rgba(255,255,255,0.12); }
    .radio-station-name {
      font-size: 14px; font-weight: 600; color: var(--accent);
      text-align: center; letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .radio-stations { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
    .radio-station {
      padding: 6px 4px; border-radius: var(--radius-sm);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: var(--text-dim); font-size: 11px; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .radio-station:hover { color: var(--text); }
    .radio-station.active {
      color: var(--text); border-color: var(--accent);
      background: var(--accent-glow);
    }
    .radio-vol { display: flex; align-items: center; gap: 8px; }
    .radio-vol-label { font-size: 10px; letter-spacing: 1px; color: var(--text-dim); }
    .radio-slider { flex: 1; accent-color: var(--accent); height: 18px; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

export class RadioPanel {
  private container: HTMLElement;
  private radio: Radio;
  private root!: HTMLElement;
  private powerBtn!: HTMLButtonElement;
  private stationName!: HTMLElement;
  private stationIdx!: HTMLElement;
  private slider!: HTMLInputElement;
  private stationRows: HTMLButtonElement[] = [];

  private visible = false;
  private rafId = 0;
  private lastT = 0;
  private speedKmh = 0;

  constructor(container: HTMLElement, radio: Radio) {
    this.container = container;
    this.radio = radio;
    injectStyle();
    this.build();
    this.slider.value = String(radio.volume);
    this.refresh();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.classList.add('visible');
    this.syncLoop();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('visible');
    this.syncLoop();
  }

  /** Feed current vehicle speed so the radio can modulate tempo/filters. */
  setSpeed(kmh: number): void {
    this.speedKmh = kmh;
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.className = 'radio-panel';
    this.root.innerHTML = `
      <div class="radio-head">
        <button class="radio-power" title="Radio power">⏻</button>
        <div class="radio-title">RADIO <span class="radio-station-idx">1/4</span></div>
        <div class="radio-nav">
          <button class="radio-prev" title="Previous station">◀</button>
          <button class="radio-next" title="Next station">▶</button>
        </div>
      </div>
      <div class="radio-station-name">—</div>
      <div class="radio-stations">
        <button class="radio-station" data-i="0">Drive Bass</button>
        <button class="radio-station" data-i="1">Synth Arp</button>
        <button class="radio-station" data-i="2">Lofi Beats</button>
        <button class="radio-station" data-i="3">News Talk</button>
      </div>
      <div class="radio-vol">
        <span class="radio-vol-label">VOL</span>
        <input type="range" class="radio-slider" min="0" max="1" step="0.01" value="0.7">
      </div>
    `;
    this.container.appendChild(this.root);

    this.powerBtn = this.root.querySelector('.radio-power')!;
    this.stationName = this.root.querySelector('.radio-station-name')!;
    this.stationIdx = this.root.querySelector('.radio-station-idx')!;
    this.slider = this.root.querySelector('.radio-slider')!;
    this.stationRows = [...this.root.querySelectorAll('.radio-station')] as HTMLButtonElement[];

    this.powerBtn.addEventListener('click', () => {
      this.radio.togglePower();
      this.syncLoop();
      this.refresh();
    });

    this.root.querySelector('.radio-prev')!.addEventListener('click', () => {
      this.radio.prevStation();
      this.refresh();
    });
    this.root.querySelector('.radio-next')!.addEventListener('click', () => {
      this.radio.nextStation();
      this.refresh();
    });

    this.slider.addEventListener('input', () => {
      this.radio.setVolume(parseFloat(this.slider.value));
    });

    for (const row of this.stationRows) {
      row.addEventListener('click', () => {
        const target = Number(row.dataset.i);
        const count = this.radio.stationCount;
        const steps = (target - this.radio.station + count) % count;
        for (let i = 0; i < steps; i++) this.radio.nextStation();
        this.refresh();
      });
    }
  }

  private tick = (now: number): void => {
    if (!this.visible && !this.radio.on) {
      this.rafId = 0;
      return;
    }
    const dt = this.lastT === 0 ? 0.016 : Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    this.radio.update(dt, this.speedKmh);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private syncLoop(): void {
    const want = this.visible || this.radio.on;
    if (want && this.rafId === 0) {
      this.lastT = 0;
      this.rafId = requestAnimationFrame(this.tick);
    } else if (!want && this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private refresh(): void {
    this.powerBtn.classList.toggle('on', this.radio.on);
    const idx = this.radio.station;
    this.stationIdx.textContent = `${idx + 1}/${this.radio.stationCount}`;
    this.stationName.textContent = STATION_NAMES[idx] ?? '—';
    this.stationRows.forEach((r, i) => r.classList.toggle('active', i === idx));
  }
}
