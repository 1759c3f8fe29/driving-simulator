/**
 * UIManager — Owns every UI screen. Gameplay systems never touch UI directly;
 * they emit events and UIManager routes them.
 */

import { EventBus, Events } from '../core/EventBus';
import { LoadingScreen } from './LoadingScreen';
import { Menus } from './Menus';
import { HUD } from './HUD';
import { Notifications } from './Notifications';
import { Dialogs } from './Dialogs';
import { Tooltip } from './Tooltip';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { AchievementsScreen } from './AchievementsScreen';
import { GarageUI } from './GarageUI';
import { PhotoModeUI } from './PhotoModeUI';
import { ReplayUI } from './ReplayUI';
import { MobileControls } from './MobileControls';
import { GarageManager } from '../garage/GarageManager';
import { PhotoModeManager } from '../photo/PhotoModeManager';
import { ReplayManager } from '../replay/ReplayManager';
import { SaveManager } from '../save/SaveManager';
import { VehicleTelemetry } from '../vehicle/VehicleController';

export type UIAction =
  | 'play' | 'continue' | 'resume' | 'restart' | 'garage' | 'settings' | 'controls'
  | 'stats' | 'achievements' | 'credits' | 'exit' | 'mainmenu' | 'photo' | 'replay' | 'back';

export class UIManager {
  readonly loading: LoadingScreen;
  readonly menus: Menus;
  readonly hud: HUD;
  readonly notifications: Notifications;
  readonly dialogs: Dialogs;
  readonly tooltip: Tooltip;
  readonly settings: SettingsScreen;
  readonly stats: StatsScreen;
  readonly achievements: AchievementsScreen;
  readonly garage: GarageUI;
  readonly photo: PhotoModeUI;
  readonly replay: ReplayUI;
  readonly mobile: MobileControls;
  private saveIndicator: HTMLElement;
  private save = SaveManager.get();
  private bus = EventBus.get();

  onAction: ((action: UIAction) => void) | null = null;

  constructor(
    root: HTMLElement,
    garageManager: GarageManager,
    photoManager: PhotoModeManager,
    replayManager: ReplayManager
  ) {
    this.loading = new LoadingScreen(root);
    this.notifications = new Notifications(root);
    this.dialogs = new Dialogs(root);
    this.tooltip = new Tooltip(root);
    this.menus = new Menus(root);
    this.hud = new HUD(root);
    this.settings = new SettingsScreen(root);
    this.stats = new StatsScreen(root);
    this.achievements = new AchievementsScreen(root);
    this.garage = new GarageUI(root, garageManager);
    this.photo = new PhotoModeUI(root, photoManager);
    this.replay = new ReplayUI(root, replayManager);
    this.mobile = new MobileControls(root);

    this.saveIndicator = document.createElement('div');
    this.saveIndicator.className = 'save-indicator';
    this.saveIndicator.textContent = '✓ Saved';
    root.appendChild(this.saveIndicator);

    this.wire();
    this.applyAccessibility();
    this.bus.on(Events.SETTINGS_APPLIED, () => this.applyAccessibility());
    this.bus.on(Events.SAVE_COMPLETE, () => this.flashSaveIndicator());
  }

  private wire(): void {
    this.menus.onAction = (id) => this.onAction?.(id as UIAction);
    this.hud.onPause = () => this.onAction?.('back');
    this.hud.onCameraNext = () => this.bus.emit('input:cameraNext:down');
    this.hud.onSettings = () => this.onAction?.('settings');
    this.settings.onClose = () => this.onAction?.('back');
    this.stats.onClose = () => this.onAction?.('back');
    this.achievements.onClose = () => this.onAction?.('back');
    this.garage.onExit = () => this.onAction?.('back');
    this.photo.onExit = () => this.onAction?.('back');
    this.replay.onExit = () => this.onAction?.('back');
    this.mobile.onPause = () => this.onAction?.('back');
    this.mobile.onCamera = () => this.bus.emit('input:cameraNext:down');
  }

  private applyAccessibility(): void {
    const a = this.save.settings.accessibility;
    document.body.classList.toggle('large-text', a.largeText);
    document.body.classList.toggle('high-contrast', a.highContrast);
    document.body.classList.toggle('reduced-motion', a.reducedMotion);
    document.documentElement.style.setProperty('--ui-scale', String(a.uiScale));
    document.documentElement.style.setProperty('--hud-scale', String(a.hudScale));
    // Color-blind simulation filter (CSS has no color-matrix filter, so we use
    // an SVG feColorMatrix referenced by url()). Applies to the whole page.
    if (a.colorBlind && a.colorBlind !== 'none') {
      this.ensureColorFilterSvg();
      document.documentElement.style.filter = `url(#cb-${a.colorBlind})`;
    } else {
      document.documentElement.style.filter = '';
    }
  }

  /** Reference matrices for common color-vision deficiencies. */
  private static COLOR_FILTER_MATRICES: Record<string, string> = {
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
    tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
  };

  private ensureColorFilterSvg(): void {
    if (document.getElementById('cb-color-filters')) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.id = 'cb-color-filters';
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    const defs = document.createElementNS(svgNS, 'defs');
    for (const [key, values] of Object.entries(UIManager.COLOR_FILTER_MATRICES)) {
      const filter = document.createElementNS(svgNS, 'filter');
      filter.id = `cb-${key}`;
      const fe = document.createElementNS(svgNS, 'feColorMatrix');
      fe.setAttribute('type', 'matrix');
      fe.setAttribute('values', values);
      filter.appendChild(fe);
      defs.appendChild(filter);
    }
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  private flashSaveIndicator(): void {
    this.saveIndicator.classList.add('visible');
    setTimeout(() => this.saveIndicator.classList.remove('visible'), 1600);
  }

  /** Route state changes to visible screens. */
  showScreen(state: string): void {
    this.menus.hideAll();
    this.hud.hide();
    this.settings.hide();
    this.stats.hide();
    this.achievements.hide();
    this.garage.hide();
    this.photo.hide();
    this.replay.hide();
    this.mobile.hide();

    switch (state) {
      case 'menu':
        this.menus.showMainMenu();
        break;
      case 'driving':
        if (this.save.settings.interface.showHUD) this.hud.show();
        this.mobile.show(); // self-gates on the showControls setting; works on desktop + touch
        break;
      case 'paused':
        this.menus.showPause();
        break;
      case 'garage':
        this.garage.show();
        break;
      case 'photo':
        this.photo.show();
        break;
      case 'replay':
        this.replay.show();
        break;
      case 'settings':
        this.settings.show();
        break;
      case 'stats':
        this.stats.show();
        break;
      case 'achievements':
        this.achievements.show();
        break;
      case 'credits':
        this.menus.showCredits();
        break;
    }
  }

  updateHUD(telemetry: VehicleTelemetry, timeOfDay: number, weatherLabel: string, fps: number): void {
    this.hud.update(telemetry, timeOfDay, weatherLabel, fps);
    this.garage.setTelemetry(telemetry);
  }

  updateReplay(): void {
    this.replay.update();
  }
}
