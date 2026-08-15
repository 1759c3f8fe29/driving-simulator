/**
 * Tooltip — Hover tooltips with name, description, shortcut.
 */

export class Tooltip {
  private el: HTMLElement;
  private showTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    root.appendChild(this.el);
  }

  attach(target: HTMLElement, title: string, description: string, shortcut?: string): void {
    target.addEventListener('pointerenter', () => {
      this.showTimer = window.setTimeout(() => {
        this.el.innerHTML = `<div class="tt-title">${title}</div><div>${description}</div>${
          shortcut ? `<div class="tt-key">[${shortcut}]</div>` : ''
        }`;
        const rect = target.getBoundingClientRect();
        this.el.style.left = `${Math.min(rect.left, window.innerWidth - 250)}px`;
        this.el.style.top = `${rect.bottom + 8}px`;
        this.el.classList.add('visible');
      }, 450);
    });
    target.addEventListener('pointerleave', () => {
      if (this.showTimer) clearTimeout(this.showTimer);
      this.el.classList.remove('visible');
    });
  }
}
