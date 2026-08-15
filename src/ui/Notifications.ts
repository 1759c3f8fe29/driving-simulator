/**
 * Notifications — Stacked toast notifications, max 5 visible.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';

export interface NotificationPayload {
  type: 'info' | 'success' | 'warning' | 'danger' | 'error' | 'achievement';
  message: string;
  icon?: string;
  detail?: string;
  duration?: number;
}

const ICONS: Record<string, string> = {
  fuel: '⛽', damage: '💥', engine: '🔧', lights: '💡', camera: '📷',
  weather: '🌦️', achievement: '🏆', reset: '🔄', save: '💾', repair: '🛠️',
  paint: '🎨', replay: '🎬', info: 'ℹ️', error: '⚠️',
};

export class Notifications {
  private container: HTMLElement;
  private audio = AudioManager.get();
  private visible: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'notifications';
    root.appendChild(this.container);
    EventBus.get().on(Events.NOTIFY, (p: unknown) => this.show(p as NotificationPayload));
  }

  show(payload: NotificationPayload): void {
    const el = document.createElement('div');
    el.className = `notification ${payload.type}`;
    const icon = ICONS[payload.icon ?? ''] ?? (payload.type === 'achievement' ? '🏆' : ICONS.info);
    el.innerHTML = `<span>${icon}</span><div><div>${payload.message}</div>${
      payload.detail ? `<div style="font-size:11px;color:var(--text-dim)">${payload.detail}</div>` : ''
    }</div>`;
    this.container.appendChild(el);
    this.visible.push(el);

    if (payload.type === 'achievement') this.audio.uiAchievement();
    else if (payload.type === 'error' || payload.type === 'danger') this.audio.uiError();
    else if (payload.type === 'success') this.audio.uiSuccess();
    else this.audio.uiNotification();

    while (this.visible.length > 5) {
      const old = this.visible.shift();
      old?.remove();
    }

    const duration = payload.duration ?? (payload.type === 'achievement' ? 5000 : 3000);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        this.visible = this.visible.filter((v) => v !== el);
      }, 320);
    }, duration);
  }
}
