/**
 * Menus — Main menu, pause menu, credits. Keyboard-navigable.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { SaveManager } from '../save/SaveManager';
import { CONFIG } from '../core/Config';

export interface MenuAction {
  id: string;
  label: string;
  icon?: string;
  primary?: boolean;
  danger?: boolean;
}

export class Menus {
  private bus = EventBus.get();
  private audio = AudioManager.get();
  private save = SaveManager.get();
  private root: HTMLElement;
  private mainMenu!: HTMLElement;
  private pauseMenu!: HTMLElement;
  private credits!: HTMLElement;
  private focusIndex = 0;
  private activeButtons: HTMLButtonElement[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  onAction: ((id: string) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildMainMenu();
    this.buildPauseMenu();
    this.buildCredits();
  }

  private makeButton(action: MenuAction): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `btn ${action.primary ? 'primary' : ''} ${action.danger ? 'danger' : ''}`;
    btn.innerHTML = `${action.icon ? `<span>${action.icon}</span>` : ''}${action.label}`;
    btn.dataset.action = action.id;
    btn.addEventListener('click', () => {
      this.audio.uiClick();
      this.onAction?.(action.id);
    });
    btn.addEventListener('pointerenter', () => this.audio.uiHover());
    return btn;
  }

  private buildMainMenu(): void {
    this.mainMenu = document.createElement('div');
    this.mainMenu.id = 'main-menu';
    this.mainMenu.className = 'screen living';
    const hasSave = this.save.vehicle.odometerKm > 0 || this.save.vehicle.totalDriveTime > 10;
    const actions: MenuAction[] = [
      ...(hasSave ? [{ id: 'continue', label: 'Continue', icon: '▶️', primary: true }] : []),
      { id: 'play', label: 'Play', icon: '🏁', primary: !hasSave },
      { id: 'garage', label: 'Garage', icon: '🔧' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
      { id: 'controls', label: 'Controls', icon: '🎮' },
      { id: 'stats', label: 'Statistics', icon: '📊' },
      { id: 'achievements', label: 'Achievements', icon: '🏆' },
      { id: 'credits', label: 'Credits', icon: 'ℹ️' },
      { id: 'exit', label: 'Exit', icon: '🚪', danger: true },
    ];
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML =
      `<h1 class="game-logo game-logo--living">APEX DRIVE</h1>` +
      `<div class="game-subtitle">Open World Driving Simulator</div>` +
      `<div class="menu-divider"></div>`;
    for (const a of actions) panel.appendChild(this.makeButton(a));
    this.mainMenu.appendChild(panel);
    const pressHint = document.createElement('div');
    pressHint.className = 'menu-presshint';
    pressHint.textContent = 'Press Enter or Click to Drive';
    const primaryBtn = panel.querySelector<HTMLButtonElement>('.btn.primary');
    if (primaryBtn) {
      primaryBtn.after(pressHint);
    } else {
      panel.appendChild(pressHint);
    }
    const version = document.createElement('div');
    version.className = 'menu-version';
    version.textContent = 'v1.0.0';
    const preset = document.createElement('div');
    preset.className = 'menu-preset';
    preset.textContent = `Graphics: ${this.save.settings.graphics.preset}`;
    this.mainMenu.appendChild(version);
    this.mainMenu.appendChild(preset);
    this.root.appendChild(this.mainMenu);
  }

  private buildPauseMenu(): void {
    this.pauseMenu = document.createElement('div');
    this.pauseMenu.id = 'pause-menu';
    this.pauseMenu.className = 'screen screen-overlay';
    const actions: MenuAction[] = [
      { id: 'resume', label: 'Resume', icon: '▶️', primary: true },
      { id: 'restart', label: 'Restart Drive', icon: '🔄' },
      { id: 'garage', label: 'Garage', icon: '🔧' },
      { id: 'photo', label: 'Photo Mode', icon: '📷' },
      { id: 'replay', label: 'Replay', icon: '🎬' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
      { id: 'controls', label: 'Controls', icon: '🎮' },
      { id: 'stats', label: 'Statistics', icon: '📊' },
      { id: 'achievements', label: 'Achievements', icon: '🏆' },
      // 'Main Menu' is omitted when the game boots straight into driving —
      // there is no main menu to go back to.
      ...(CONFIG.boot.directToDriving
        ? []
        : [{ id: 'mainmenu' as const, label: 'Main Menu', icon: '🏠' }]),
      { id: 'exit', label: 'Exit Game', icon: '🚪', danger: true },
    ];
    const panel = document.createElement('div');
    panel.className = 'menu-panel panel';
    panel.innerHTML = `<div class="menu-title">Paused</div>`;
    for (const a of actions) panel.appendChild(this.makeButton(a));
    this.pauseMenu.appendChild(panel);
    this.root.appendChild(this.pauseMenu);
  }

  private buildCredits(): void {
    this.credits = document.createElement('div');
    this.credits.id = 'credits-screen';
    this.credits.className = 'screen screen-overlay';
    const panel = document.createElement('div');
    panel.className = 'menu-panel panel';
    panel.innerHTML = `
      <div class="menu-title">Credits</div>
      <div style="text-align:center;color:var(--text-dim);font-size:14px;line-height:2">
        <div><strong style="color:var(--text)">APEX DRIVE</strong></div>
        <div>Open World Driving Simulator</div>
        <div style="margin-top:14px">Engine — Three.js · Rapier Physics</div>
        <div>City — San Francisco model</div>
        <div>Vehicle — Koenigsegg Jesko</div>
        <div>Engine audio — giocosound (Freesound)</div>
        <div style="margin-top:14px">Built with TypeScript + WebGL</div>
      </div>
    `;
    panel.appendChild(this.makeButton({ id: 'back', label: 'Back', icon: '◀️' }));
    this.credits.appendChild(panel);
    this.root.appendChild(this.credits);
  }

  showMainMenu(): void {
    this.hideAll();
    this.mainMenu.querySelector('.menu-panel')?.classList.add('btn--enter');
    this.mainMenu.querySelectorAll<HTMLButtonElement>('.btn').forEach((btn, i) => {
      btn.style.transitionDelay = `${i * 60}ms`;
    });
    this.mainMenu.classList.add('visible');
    this.setupKeyboardNav(this.mainMenu);
  }

  showPause(): void {
    this.hideAll();
    this.pauseMenu.classList.add('visible');
    this.setupKeyboardNav(this.pauseMenu);
  }

  showCredits(): void {
    this.hideAll();
    this.credits.classList.add('visible');
    this.setupKeyboardNav(this.credits);
  }

  hideAll(): void {
    this.mainMenu.classList.remove('visible');
    this.pauseMenu.classList.remove('visible');
    this.credits.classList.remove('visible');
    this.teardownKeyboardNav();
  }

  /** Arrow-key / Enter navigation per accessibility spec. */
  private setupKeyboardNav(screen: HTMLElement): void {
    this.activeButtons = [...screen.querySelectorAll('.btn')] as HTMLButtonElement[];
    this.focusIndex = 0;
    this.updateFocus();
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        this.focusIndex = (this.focusIndex + 1) % this.activeButtons.length;
        this.audio.uiHover();
        this.updateFocus();
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        this.focusIndex = (this.focusIndex - 1 + this.activeButtons.length) % this.activeButtons.length;
        this.audio.uiHover();
        this.updateFocus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.activeButtons[this.focusIndex]?.click();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private teardownKeyboardNav(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  private updateFocus(): void {
    this.activeButtons.forEach((b, i) => b.classList.toggle('focused', i === this.focusIndex));
  }
}
