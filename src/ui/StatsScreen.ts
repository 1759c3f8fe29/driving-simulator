/**
 * StatsScreen — Statistics display with categories and session history.
 */

import { AudioManager } from '../audio/AudioManager';
import { StatisticsManager } from '../stats/StatisticsManager';
import { formatTime } from '../core/Config';

export class StatsScreen {
  private el: HTMLElement;
  private audio = AudioManager.get();
  private stats = StatisticsManager.get();
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'stats-screen';
    this.el.className = 'screen screen-overlay';
    root.appendChild(this.el);
  }

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

  private card(value: string, label: string): HTMLElement {
    const c = document.createElement('div');
    c.className = 'stat-card';
    c.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
    return c;
  }

  private render(): void {
    const s = this.stats.stats;
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel settings-panel';
    panel.innerHTML = `<div class="menu-title">Statistics</div>`;

    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    grid.append(
      this.card(`${s.totalDistanceKm.toFixed(1)} km`, 'Total Distance'),
      this.card(formatTime(s.totalDriveTimeSec), 'Drive Time'),
      this.card(`${Math.round(s.topSpeedKmh)} km/h`, 'Top Speed'),
      this.card(String(s.trips), 'Trips'),
      this.card(String(s.engineStarts), 'Engine Starts'),
      this.card(String(Math.round(s.maxRPM)), 'Max RPM'),
      this.card(`${s.fuelConsumedL.toFixed(1)} L`, 'Fuel Consumed'),
      this.card(String(s.refuelCount), 'Refuels'),
      this.card(String(s.collisionCount), 'Collisions'),
      this.card(String(s.repairCount), 'Repairs'),
      this.card(`${Math.round(s.longestDriftM)} m`, 'Longest Drift'),
      this.card(`${Math.round(s.totalDriftM)} m`, 'Total Drift'),
      this.card(String(s.garageVisits), 'Garage Visits'),
      this.card(String(s.paintChanges), 'Paint Changes'),
      this.card(String(s.photosTaken), 'Photos Taken'),
      this.card(String(s.replaysSaved), 'Replays Saved'),
    );
    panel.appendChild(grid);

    if (s.sessions.length > 0) {
      const histTitle = document.createElement('div');
      histTitle.className = 'setting-label';
      histTitle.style.marginTop = '16px';
      histTitle.textContent = 'Recent Sessions';
      panel.appendChild(histTitle);
      const list = document.createElement('div');
      list.style.cssText = 'max-height:180px;overflow-y:auto';
      for (const sess of s.sessions.slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'garage-info-row';
        row.innerHTML = `<span>${new Date(sess.date).toLocaleDateString()} ${new Date(sess.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>${sess.distanceKm.toFixed(1)} km · ${Math.round(sess.topSpeed)} km/h · ${formatTime(sess.durationSec)}</span>`;
        list.appendChild(row);
      }
      panel.appendChild(list);
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn small danger';
    resetBtn.textContent = 'Reset Statistics';
    resetBtn.onclick = () => {
      this.audio.uiBack();
      this.stats.reset();
      this.render();
    };
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn small primary';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      this.audio.uiBack();
      this.hide();
      this.onClose?.();
    };
    footer.append(resetBtn, closeBtn);
    panel.appendChild(footer);
    this.el.appendChild(panel);
  }
}
