/**
 * AchievementsScreen — Achievement list with progress, categories, filter.
 */

import { AudioManager } from '../audio/AudioManager';
import { AchievementManager } from '../stats/AchievementManager';
import { StatisticsManager } from '../stats/StatisticsManager';

export class AchievementsScreen {
  private el: HTMLElement;
  private audio = AudioManager.get();
  private achievements = AchievementManager.get();
  private stats = StatisticsManager.get();
  private filter = '';
  private categoryFilter = 'all';
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'achievements-screen';
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

  private render(): void {
    this.el.innerHTML = '';
    const all = this.achievements.getAll();
    const completion = this.achievements.completion;
    const stats = this.stats.stats;

    const panel = document.createElement('div');
    panel.className = 'panel settings-panel';
    panel.innerHTML = `<div class="menu-title">Achievements</div>
      <div style="color:var(--text-dim);font-size:13px;margin-bottom:14px">${completion.unlocked} / ${completion.total} unlocked</div>`;

    // Search + category filter
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search…';
    search.value = this.filter;
    search.style.cssText = 'flex:1;min-width:140px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:9px 12px;color:var(--text);font-family:var(--font)';
    search.oninput = () => {
      this.filter = search.value.toLowerCase();
      this.render();
      const el2 = this.el.querySelector('input[type=search]') as HTMLInputElement;
      el2?.focus();
      el2?.setSelectionRange(el2.value.length, el2.value.length);
    };
    controls.appendChild(search);

    const categories = ['all', ...new Set(all.map((a) => a.category))];
    const catSeg = document.createElement('div');
    catSeg.className = 'seg-group';
    for (const cat of categories) {
      const b = document.createElement('button');
      b.className = `seg-btn ${this.categoryFilter === cat ? 'active' : ''}`;
      b.textContent = cat;
      b.onclick = () => {
        this.audio.uiClick();
        this.categoryFilter = cat;
        this.render();
      };
      catSeg.appendChild(b);
    }
    controls.appendChild(catSeg);
    panel.appendChild(controls);

    const list = document.createElement('div');
    list.className = 'ach-list';
    const filtered = all.filter((a) => {
      const matchSearch = !this.filter || a.name.toLowerCase().includes(this.filter) || a.description.toLowerCase().includes(this.filter);
      const matchCat = this.categoryFilter === 'all' || a.category === this.categoryFilter;
      return matchSearch && matchCat;
    });
    // Unlocked first, then by progress
    filtered.sort((a, b) => Number(b.unlocked) - Number(a.unlocked));

    for (const a of filtered) {
      const item = document.createElement('div');
      item.className = `ach-item ${a.unlocked ? 'unlocked' : 'locked'}`;
      const prog = a.progress(stats);
      const pct = Math.min(100, Math.round((prog.current / prog.target) * 100));
      const hidden = a.secret && !a.unlocked;
      item.innerHTML = `
        <div class="ach-icon">${hidden ? '❓' : a.icon}</div>
        <div style="flex:1">
          <div class="ach-name">${hidden ? '???' : a.name}</div>
          <div class="ach-desc">${hidden ? 'Secret achievement' : a.description}</div>
        </div>
        <div class="ach-progress">${a.unlocked ? '🏆 ' + new Date(a.unlockDate!).toLocaleDateString() : `${pct}%`}</div>
      `;
      list.appendChild(item);
    }
    panel.appendChild(list);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn small primary';
    closeBtn.style.cssText = 'margin-top:16px;align-self:flex-end';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      this.audio.uiBack();
      this.hide();
      this.onClose?.();
    };
    panel.appendChild(closeBtn);
    this.el.appendChild(panel);
  }
}
