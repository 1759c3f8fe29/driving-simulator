/**
 * GarageUI — Garage panels: info, paint, repair, fuel, upgrades, camera controls.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { GarageManager, GaragePanel, UpgradeTrack, UPGRADE_MAX_LEVEL, UPGRADE_LABELS } from '../garage/GarageManager';
import { VehicleTelemetry } from '../vehicle/VehicleController';
import { formatTime } from '../core/Config';

const PRESET_COLORS = [
  '#c8102e', '#1a1a1e', '#f5f5f7', '#0b3d91', '#ffd100', '#0e7a3d',
  '#ff6b00', '#6a0dad', '#00b4d8', '#8b0000', '#2f4f4f', '#c0c0c0',
];

export class GarageUI {
  private el: HTMLElement;
  private bus = EventBus.get();
  private audio = AudioManager.get();
  private garage: GarageManager;
  private panel: GaragePanel = 'info';
  private bodyEl: HTMLElement | null = null;
  private telemetry: VehicleTelemetry | null = null;
  onExit: (() => void) | null = null;

  constructor(root: HTMLElement, garage: GarageManager) {
    this.garage = garage;
    this.el = document.createElement('div');
    this.el.id = 'garage-ui';
    this.el.className = 'screen';
    root.appendChild(this.el);
  }

  show(): void {
    this.el.classList.add('visible');
    this.render();
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  setTelemetry(t: VehicleTelemetry): void {
    this.telemetry = t;
    if (this.panel === 'info' && this.el.classList.contains('visible')) this.renderBody();
  }

  private render(): void {
    this.el.innerHTML = '';

    const exitBtn = document.createElement('button');
    exitBtn.className = 'btn small garage-exit';
    exitBtn.innerHTML = '◀️ Exit Garage';
    exitBtn.onclick = () => {
      this.audio.uiBack();
      this.onExit?.();
    };
    this.el.appendChild(exitBtn);

    const side = document.createElement('div');
    side.className = 'garage-side panel';

    const title = document.createElement('div');
    title.className = 'menu-title';
    title.style.fontSize = '20px';
    title.textContent = 'Garage';
    side.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'garage-tabs';
    const tabDefs: Array<{ id: GaragePanel; label: string }> = [
      { id: 'info', label: 'Info' },
      { id: 'paint', label: 'Paint' },
      { id: 'repair', label: 'Repair' },
      { id: 'fuel', label: 'Fuel' },
      { id: 'upgrades', label: 'Upgrades' },
    ];
    for (const t of tabDefs) {
      const btn = document.createElement('button');
      btn.className = `settings-tab ${t.id === this.panel ? 'active' : ''}`;
      btn.textContent = t.label;
      btn.onclick = () => {
        this.audio.uiClick();
        this.panel = t.id;
        this.garage.setPanel(t.id);
        this.render();
      };
      tabs.appendChild(btn);
    }
    side.appendChild(tabs);

    this.bodyEl = document.createElement('div');
    side.appendChild(this.bodyEl);
    this.el.appendChild(side);
    this.renderBody();

    // Camera controls
    const camBtns = document.createElement('div');
    camBtns.className = 'garage-cam-btns';
    const mkCam = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = label;
      b.onclick = () => {
        this.audio.uiClick();
        fn();
      };
      camBtns.appendChild(b);
    };
    mkCam('⟲ Rotate', () => this.garage.toggleAutoRotate());
    mkCam('◀ Left', () => this.garage.rotatePlatform(0.5));
    mkCam('Right ▶', () => this.garage.rotatePlatform(-0.5));
    mkCam('Reset View', () => this.garage.resetPlatform());
    this.el.appendChild(camBtns);
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '';
    switch (this.panel) {
      case 'info': this.renderInfo(); break;
      case 'paint': this.renderPaint(); break;
      case 'repair': this.renderRepair(); break;
      case 'fuel': this.renderFuel(); break;
      case 'upgrades': this.renderUpgrades(); break;
      default: break;
    }
  }

  private infoRow(label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'garage-info-row';
    row.innerHTML = `<span>${label}</span><span>${value}</span>`;
    this.bodyEl!.appendChild(row);
  }

  private renderInfo(): void {
    const t = this.telemetry;
    this.infoRow('Vehicle', 'Koenigsegg Jesko');
    this.infoRow('Fuel', t ? `${Math.round(t.fuelPercent * 100)}% (${t.fuelLiters.toFixed(1)} L)` : '—');
    this.infoRow('Health', t ? `${Math.round(t.health * 100)}%` : '—');
    this.infoRow('Engine', t ? `${Math.round((1 - t.damage.engine) * 100)}%` : '—');
    this.infoRow('Suspension', t ? `${Math.round((1 - t.damage.suspension) * 100)}%` : '—');
    this.infoRow('Body', t ? `${Math.round((1 - t.damage.body) * 100)}%` : '—');
    this.infoRow('Odometer', t ? `${t.fuelRangeKm.toFixed(0)} km range` : '—');
    this.infoRow('Drive Time', formatTime(this.garage['vehicle' as never] ? (this.garage as unknown as { vehicle: { totalDriveTime: number } }).vehicle.totalDriveTime : 0));
  }

  private renderPaint(): void {
    const paint = this.garage.getPaint();
    const label = document.createElement('div');
    label.className = 'setting-label';
    label.textContent = 'Body Color';
    this.bodyEl!.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'color-grid';
    for (const color of PRESET_COLORS) {
      const sw = document.createElement('div');
      sw.className = `color-swatch ${paint.color === color ? 'active' : ''}`;
      sw.style.background = color;
      sw.onclick = () => {
        this.audio.uiClick();
        this.garage.applyPaint({ ...paint, color });
        this.renderBody();
      };
      grid.appendChild(sw);
    }
    this.bodyEl!.appendChild(grid);

    // Custom color picker
    const pickerRow = document.createElement('div');
    pickerRow.className = 'setting-row';
    pickerRow.innerHTML = `<div class="setting-label">Custom Color</div>`;
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = paint.color;
    picker.style.cssText = 'width:52px;height:32px;border:none;border-radius:6px;cursor:pointer;background:none';
    picker.oninput = () => this.garage.applyPaint({ ...paint, color: picker.value });
    pickerRow.appendChild(picker);
    this.bodyEl!.appendChild(pickerRow);

    // Paint type
    const typeRow = document.createElement('div');
    typeRow.className = 'setting-row';
    typeRow.innerHTML = `<div class="setting-label">Finish</div>`;
    const seg = document.createElement('div');
    seg.className = 'seg-group';
    for (const type of ['gloss', 'matte', 'metallic'] as const) {
      const b = document.createElement('button');
      b.className = `seg-btn ${paint.type === type ? 'active' : ''}`;
      b.textContent = type;
      b.onclick = () => {
        this.audio.uiClick();
        this.garage.applyPaint({ ...paint, type });
        this.renderBody();
      };
      seg.appendChild(b);
    }
    typeRow.appendChild(seg);
    this.bodyEl!.appendChild(typeRow);

    // Window tint
    const tintRow = document.createElement('div');
    tintRow.className = 'setting-row';
    tintRow.innerHTML = `<div class="setting-label">Window Tint</div>`;
    const tintSeg = document.createElement('div');
    tintSeg.className = 'seg-group';
    for (const level of [0, 0.2, 0.4, 0.6, 0.8]) {
      const b = document.createElement('button');
      b.className = `seg-btn ${Math.abs(this.garage.getWindowTint() - level) < 0.05 ? 'active' : ''}`;
      b.textContent = `${level * 100}%`;
      b.onclick = () => {
        this.audio.uiClick();
        this.garage.applyWindowTint(level);
        this.renderBody();
      };
      tintSeg.appendChild(b);
    }
    tintRow.appendChild(tintSeg);
    this.bodyEl!.appendChild(tintRow);

    // Rim color
    const rimRow = document.createElement('div');
    rimRow.className = 'setting-row';
    rimRow.innerHTML = `<div class="setting-label">Rim Color</div>`;
    const rimPicker = document.createElement('input');
    rimPicker.type = 'color';
    rimPicker.value = this.garage.getRimColor();
    rimPicker.style.cssText = 'width:52px;height:32px;border:none;border-radius:6px;cursor:pointer;background:none';
    rimPicker.oninput = () => this.garage.applyRimColor(rimPicker.value);
    rimRow.appendChild(rimPicker);
    this.bodyEl!.appendChild(rimRow);
  }

  private renderRepair(): void {
    const t = this.telemetry;
    const items: Array<{ label: string; key: 'engine' | 'suspension' | 'wheels' | 'body'; value: number }> = [
      { label: 'Engine', key: 'engine', value: t ? 1 - t.damage.engine : 1 },
      { label: 'Suspension', key: 'suspension', value: t ? 1 - t.damage.suspension : 1 },
      { label: 'Wheels', key: 'wheels', value: t ? 1 - t.damage.wheels : 1 },
      { label: 'Body', key: 'body', value: t ? 1 - t.damage.body : 1 },
    ];
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      row.innerHTML = `<div><div class="setting-label">${item.label}</div><div class="setting-desc">${Math.round(item.value * 100)}% condition</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Repair';
      btn.disabled = item.value >= 0.999;
      btn.onclick = () => {
        this.audio.uiSuccess();
        this.garage.repair(item.key);
        this.renderBody();
      };
      row.appendChild(btn);
      this.bodyEl!.appendChild(row);
    }
    const allBtn = document.createElement('button');
    allBtn.className = 'btn primary small';
    allBtn.style.marginTop = '12px';
    allBtn.style.width = '100%';
    allBtn.textContent = 'Repair All';
    allBtn.onclick = () => {
      this.audio.uiSuccess();
      this.garage.repair('all');
      this.renderBody();
    };
    this.bodyEl!.appendChild(allBtn);
  }

  private renderFuel(): void {
    const t = this.telemetry;
    const pct = t ? t.fuelPercent : 0;
    const info = document.createElement('div');
    info.style.cssText = 'text-align:center;margin-bottom:16px';
    info.innerHTML = `<div style="font-family:var(--mono);font-size:34px;color:var(--accent)">${Math.round(pct * 100)}%</div>
      <div class="setting-desc">${t?.fuelLiters.toFixed(1) ?? '0'} liters · ~${t?.fuelRangeKm.toFixed(0) ?? '0'} km range</div>`;
    this.bodyEl!.appendChild(info);

    for (const amount of [0.25, 0.5, 0.75, 1] as const) {
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.style.width = '100%';
      btn.textContent = `Refuel to ${amount * 100}%`;
      btn.disabled = pct >= amount;
      btn.onclick = () => {
        this.audio.uiSuccess();
        this.garage.refuel(amount);
        this.renderBody();
      };
      this.bodyEl!.appendChild(btn);
    }
  }

  private renderUpgrades(): void {
    const upgrades = this.garage.getUpgrades();
    const tracks: Array<{ key: UpgradeTrack; label: string; desc: string }> = [
      { key: 'engine', label: 'Engine', desc: 'Peak torque' },
      { key: 'brakes', label: 'Brakes', desc: 'Brake & handbrake torque' },
      { key: 'tires', label: 'Tires', desc: 'Tire grip' },
    ];
    const intro = document.createElement('div');
    intro.className = 'setting-desc';
    intro.style.marginBottom = '12px';
    intro.textContent = `Upgrade levels persist and apply immediately. Max level ${UPGRADE_MAX_LEVEL}.`;
    this.bodyEl!.appendChild(intro);

    for (const track of tracks) {
      const level = upgrades[track.key];
      const row = document.createElement('div');
      row.className = 'upgrade-row';

      const head = document.createElement('div');
      head.className = 'upgrade-head';
      const name = document.createElement('div');
      name.className = 'setting-label';
      name.textContent = UPGRADE_LABELS[track.key];
      const desc = document.createElement('div');
      desc.className = 'setting-desc';
      desc.textContent = track.desc;
      head.appendChild(name);
      head.appendChild(desc);
      row.appendChild(head);

      const pips = document.createElement('div');
      pips.className = 'upgrade-pips';
      for (let i = 0; i <= UPGRADE_MAX_LEVEL; i++) {
        const pip = document.createElement('span');
        pip.className = `upgrade-pip ${i < level ? 'filled' : ''}`;
        pips.appendChild(pip);
      }
      row.appendChild(pips);

      const plus = document.createElement('button');
      plus.className = 'btn small upgrade-plus';
      plus.textContent = '+';
      plus.disabled = level >= UPGRADE_MAX_LEVEL;
      plus.onclick = () => {
        this.audio.uiSuccess();
        this.garage.applyUpgrade(track.key);
        this.renderBody();
      };
      row.appendChild(plus);

      this.bodyEl!.appendChild(row);
    }
  }
}
