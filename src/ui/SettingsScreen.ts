/**
 * SettingsScreen — Tabbed settings: Graphics, Audio, Controls, Gameplay,
 * Accessibility, Interface, About. Applies live, persists automatically.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { SaveManager, SettingsData, DEFAULT_SETTINGS } from '../save/SaveManager';
import { isMobile } from '../core/Config';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'accessibility' | 'interface' | 'about';

export class SettingsScreen {
  private el: HTMLElement;
  private body!: HTMLElement;
  private bus = EventBus.get();
  private audio = AudioManager.get();
  private save = SaveManager.get();
  private activeTab: Tab = 'graphics';
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'settings-screen';
    this.el.className = 'screen screen-overlay';
    root.appendChild(this.el);
  }

  private tabs: Array<{ id: Tab; label: string }> = [
    { id: 'graphics', label: 'Graphics' },
    { id: 'audio', label: 'Audio' },
    { id: 'controls', label: 'Controls' },
    { id: 'gameplay', label: 'Gameplay' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'interface', label: 'Interface' },
    { id: 'about', label: 'About' },
  ];

  show(): void {
    this.render();
    this.el.classList.add('visible');
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  get isVisible(): boolean {
    return this.el.classList.contains('visible');
  }

  private render(): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel settings-panel';
    panel.innerHTML = `<div class="menu-title">Settings</div>`;

    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    for (const t of this.tabs) {
      const btn = document.createElement('button');
      btn.className = `settings-tab ${t.id === this.activeTab ? 'active' : ''}`;
      btn.textContent = t.label;
      btn.onclick = () => {
        this.audio.uiClick();
        this.activeTab = t.id;
        this.render();
      };
      tabs.appendChild(btn);
    }
    panel.appendChild(tabs);

    this.body = document.createElement('div');
    this.body.className = 'settings-body';
    panel.appendChild(this.body);
    this.renderTab();

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px';
    const resetBtn = this.mkBtn('Restore Defaults', () => {
      this.save.settings = structuredClone(DEFAULT_SETTINGS);
      this.save.saveSettings();
      location.reload();
    });
    const closeBtn = this.mkBtn('Close', () => {
      this.audio.uiBack();
      this.hide();
      this.onClose?.();
    }, true);
    footer.appendChild(resetBtn);
    footer.appendChild(closeBtn);
    panel.appendChild(footer);

    this.el.appendChild(panel);
  }

  private mkBtn(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `btn small ${primary ? 'primary' : ''}`;
    btn.textContent = label;
    btn.onclick = () => {
      this.audio.uiClick();
      onClick();
    };
    return btn;
  }

  private row(label: string, desc: string, control: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'setting-row';
    const left = document.createElement('div');
    left.innerHTML = `<div class="setting-label">${label}</div><div class="setting-desc">${desc}</div>`;
    const right = document.createElement('div');
    right.className = 'setting-control';
    right.appendChild(control);
    row.appendChild(left);
    row.appendChild(right);
    this.body.appendChild(row);
  }

  private slider(value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '10px';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const val = document.createElement('span');
    val.className = 'range-value';
    val.textContent = fmt(value);
    input.oninput = () => {
      const v = parseFloat(input.value);
      val.textContent = fmt(v);
      onChange(v);
      this.apply();
    };
    wrap.appendChild(input);
    wrap.appendChild(val);
    return wrap;
  }

  private toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `toggle ${value ? 'on' : ''}`;
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(value));
    btn.onclick = () => {
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
      this.audio.uiClick();
      onChange(on);
      this.apply();
    };
    return btn;
  }

  private segments<T extends string>(options: T[], value: T, onChange: (v: T) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'seg-group';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = `seg-btn ${opt === value ? 'active' : ''}`;
      btn.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      btn.onclick = () => {
        wrap.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.uiClick();
        onChange(opt);
        this.apply();
      };
      wrap.appendChild(btn);
    }
    return wrap;
  }

  private apply(): void {
    this.save.saveSettings();
    this.audio.applyVolumes();
    this.bus.emit(Events.SETTINGS_APPLIED, this.save.settings);
  }

  private renderTab(): void {
    this.body.innerHTML = '';
    const s = this.save.settings;
    switch (this.activeTab) {
      case 'graphics': this.renderGraphics(s); break;
      case 'audio': this.renderAudio(s); break;
      case 'controls': this.renderControls(); break;
      case 'gameplay': this.renderGameplay(s); break;
      case 'accessibility': this.renderAccessibility(s); break;
      case 'interface': this.renderInterface(s); break;
      case 'about': this.renderAbout(); break;
    }
  }

  private renderGraphics(s: SettingsData): void {
    this.row('Preset', 'Overall quality preset', this.segments(['low', 'medium', 'high', 'ultra'] as const, s.graphics.preset as 'low', (v) => {
      s.graphics.preset = v;
      const g = s.graphics;
      if (v === 'low') { g.bloom = false; g.ssao = false; g.shadows = false; g.shadowQuality = 512; g.renderScale = 0.75; }
      if (v === 'medium') { g.bloom = true; g.ssao = false; g.shadows = true; g.shadowQuality = 1024; g.renderScale = 0.85; }
      if (v === 'high') { g.bloom = true; g.ssao = false; g.shadows = true; g.shadowQuality = 2048; g.renderScale = 1; }
      if (v === 'ultra') { g.bloom = true; g.ssao = true; g.shadows = true; g.shadowQuality = 4096; g.renderScale = 1; }
    }));
    this.row('Render Scale', 'Internal resolution multiplier', this.slider(s.graphics.renderScale, 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.graphics.renderScale = v)));
    this.row('Shadow Quality', 'Shadow map resolution', this.segments(['512', '1024', '2048', '4096'] as const, String(s.graphics.shadowQuality) as '512', (v) => (s.graphics.shadowQuality = parseInt(v))));
    this.row('Shadows', 'Dynamic shadows', this.toggle(s.graphics.shadows, (v) => (s.graphics.shadows = v)));
    this.row('Bloom', 'HDR glow effect', this.toggle(s.graphics.bloom, (v) => (s.graphics.bloom = v)));
    this.row('Ambient Occlusion', 'SSAO contact shadows', this.toggle(s.graphics.ssao, (v) => (s.graphics.ssao = v)));
    this.row('Motion Blur', 'Velocity-based blur', this.toggle(s.graphics.motionBlur, (v) => (s.graphics.motionBlur = v)));
    this.row('FPS Limit', 'Frame rate cap', this.segments(['30', '60', '120', '144'] as const, String(s.graphics.fpsLimit) as '60', (v) => (s.graphics.fpsLimit = parseInt(v))));
    // VSync removed: three r166 has no renderer vsync control; frame pacing is browser-RAF bound.
  }

  private renderAudio(s: SettingsData): void {
    this.row('Master Volume', 'All audio', this.slider(s.audio.master, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.audio.master = v)));
    this.row('Engine', 'Engine sounds', this.slider(s.audio.engine, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.audio.engine = v)));
    this.row('Effects', 'Collisions, skids, horn', this.slider(s.audio.effects, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.audio.effects = v)));
    this.row('Interface', 'UI sounds', this.slider(s.audio.ui, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.audio.ui = v)));
    this.row('Ambience', 'Wind, rain, weather', this.slider(s.audio.ambience, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => (s.audio.ambience = v)));
    this.row('Mute All', 'Silence everything', this.toggle(s.audio.muted, (v) => (s.audio.muted = v)));
  }

  private renderControls(): void {
    const controls: Array<[string, string]> = [
      ['Accelerate', 'W / ↑'], ['Brake / Reverse', 'S / ↓'], ['Steer Left', 'A / ←'], ['Steer Right', 'D / →'],
      ['Handbrake', 'Space'], ['Gear Up', 'E'], ['Gear Down', 'Q'], ['Change Camera', 'C'],
      ['Headlights', 'L'], ['Horn', 'H'], ['Engine Start/Stop', 'I'], ['Indicators', 'Z / X'],
      ['Hazards', 'V'], ['Photo Mode', 'P'], ['Reset Vehicle', 'R'], ['Pause', 'Esc'],
    ];
    for (const [action, key] of controls) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      row.innerHTML = `<div class="setting-label">${action}</div><div class="range-value" style="min-width:80px">${key}</div>`;
      this.body.appendChild(row);
    }
  }

  private renderGameplay(s: SettingsData): void {
    this.row('Transmission', 'Automatic or manual gearbox', this.segments(['automatic', 'manual'] as const, s.gameplay.transmission, (v) => (s.gameplay.transmission = v)));
    this.row('Units', 'Speed display units', this.segments(['kmh', 'mph'] as const, s.gameplay.units, (v) => (s.gameplay.units = v)));
    this.row('Fuel Consumption', 'Engine consumes fuel', this.toggle(s.gameplay.fuelConsumption, (v) => (s.gameplay.fuelConsumption = v)));
    this.row('Vehicle Damage', 'Collisions cause damage', this.toggle(s.gameplay.damageEnabled, (v) => (s.gameplay.damageEnabled = v)));
  }

  private renderAccessibility(s: SettingsData): void {
    this.row('UI Scale', 'Interface size', this.slider(s.accessibility.uiScale, 0.8, 1.6, 0.1, (v) => `${Math.round(v * 100)}%`, (v) => (s.accessibility.uiScale = v)));
    this.row('HUD Scale', 'Heads-up display size', this.slider(s.accessibility.hudScale, 0.8, 1.6, 0.1, (v) => `${Math.round(v * 100)}%`, (v) => (s.accessibility.hudScale = v)));
    this.row('Large Text', 'Bigger fonts everywhere', this.toggle(s.accessibility.largeText, (v) => (s.accessibility.largeText = v)));
    this.row('High Contrast', 'Stronger contrast', this.toggle(s.accessibility.highContrast, (v) => (s.accessibility.highContrast = v)));
    this.row('Reduced Motion', 'Minimize animations', this.toggle(s.accessibility.reducedMotion, (v) => (s.accessibility.reducedMotion = v)));
    this.row('Color Blind Mode', 'Color vision assistance', this.segments(['none', 'protanopia', 'deuteranopia', 'tritanopia'] as const, s.accessibility.colorBlind, (v) => (s.accessibility.colorBlind = v)));
  }

  private renderInterface(s: SettingsData): void {
    this.row('Show HUD', 'Driving display', this.toggle(s.interface.showHUD, (v) => (s.interface.showHUD = v)));
    this.row('Show FPS', 'Frame rate counter', this.toggle(s.interface.showFPS, (v) => (s.interface.showFPS = v)));
    this.row('Show Clock', 'In-game time', this.toggle(s.interface.showClock, (v) => (s.interface.showClock = v)));
    this.row('Notifications', 'Toast messages', this.toggle(s.interface.notifications, (v) => (s.interface.notifications = v)));
    // Defensive cast: 'showControls' lives on the persisted settings object but is
    // not part of the SettingsData interface, which is defined in SaveManager (not editable).
    const iface = s.interface as { showControls?: boolean };
    this.row('On-Screen Controls', 'Steering wheel, pedals and button deck', this.toggle(
      iface.showControls ?? isMobile(),
      (v) => { iface.showControls = v; }
    ));
  }

  private renderAbout(): void {
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;color:var(--text-dim);font-size:14px;line-height:2;padding:20px';
    div.innerHTML = `
      <div style="font-size:22px;font-weight:700;color:var(--text)">APEX DRIVE</div>
      <div>Version 1.0.0</div>
      <div style="margin-top:12px">Three.js ${'·'} Rapier Physics · TypeScript · WebGL</div>
      <div>Single-player open world driving simulator</div>
    `;
    this.body.appendChild(div);
  }
}
