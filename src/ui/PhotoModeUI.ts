/**
 * PhotoModeUI — Photo controls: filters, exposure, FOV, grid, gallery.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { PhotoModeManager, PHOTO_FILTERS } from '../photo/PhotoModeManager';

export class PhotoModeUI {
  private el: HTMLElement;
  private bus = EventBus.get();
  private audio = AudioManager.get();
  private photo: PhotoModeManager;
  private gridOverlay!: HTMLElement;
  onCapture: (() => void) | null = null;
  onExit: (() => void) | null = null;
  onSettingsChanged: (() => void) | null = null;

  constructor(root: HTMLElement, photo: PhotoModeManager) {
    this.photo = photo;
    this.el = document.createElement('div');
    this.el.id = 'photo-ui';
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

  private render(): void {
    this.el.innerHTML = '';
    const s = this.photo.settings;

    this.gridOverlay = document.createElement('div');
    this.gridOverlay.className = `photo-grid-overlay ${s.grid ? 'visible' : ''}`;
    this.el.appendChild(this.gridOverlay);

    const controls = document.createElement('div');
    controls.className = 'photo-controls panel';
    controls.innerHTML = `<div class="menu-title" style="font-size:18px">Photo Mode</div>`;

    const addSlider = (label: string, value: number, min: number, max: number, step: number, key: 'exposure' | 'brightness' | 'contrast' | 'saturation' | 'bloom' | 'fov') => {
      const row = document.createElement('div');
      row.className = 'setting-row';
      row.innerHTML = `<div class="setting-label">${label}</div>`;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const val = document.createElement('span');
      val.className = 'range-value';
      val.textContent = value.toFixed(2);
      input.oninput = () => {
        const v = parseFloat(input.value);
        val.textContent = v.toFixed(2);
        this.photo.updateSettings({ [key]: v });
        this.onSettingsChanged?.();
      };
      wrap.appendChild(input);
      wrap.appendChild(val);
      row.appendChild(wrap);
      controls.appendChild(row);
    };

    addSlider('Exposure', s.exposure, 0.3, 2.5, 0.05, 'exposure');
    addSlider('Brightness', s.brightness, 0.5, 1.8, 0.05, 'brightness');
    addSlider('Contrast', s.contrast, 0.5, 1.8, 0.05, 'contrast');
    addSlider('Saturation', s.saturation, 0, 2.5, 0.05, 'saturation');
    addSlider('Bloom', s.bloom, 0, 1.2, 0.05, 'bloom');
    addSlider('Field of View', s.fov, 30, 110, 1, 'fov');

    // Filters
    const filterLabel = document.createElement('div');
    filterLabel.className = 'setting-label';
    filterLabel.style.marginTop = '10px';
    filterLabel.textContent = 'Filter';
    controls.appendChild(filterLabel);
    const filterWrap = document.createElement('div');
    filterWrap.className = 'seg-group';
    filterWrap.style.flexWrap = 'wrap';
    PHOTO_FILTERS.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = `seg-btn ${s.filter === i ? 'active' : ''}`;
      b.textContent = f.name;
      b.onclick = () => {
        this.audio.uiClick();
        this.photo.updateSettings({ filter: i });
        filterWrap.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.onSettingsChanged?.();
      };
      filterWrap.appendChild(b);
    });
    controls.appendChild(filterWrap);

    // Grid toggle
    const gridRow = document.createElement('div');
    gridRow.className = 'setting-row';
    gridRow.innerHTML = `<div class="setting-label">Rule of Thirds Grid</div>`;
    const gridToggle = document.createElement('button');
    gridToggle.className = `toggle ${s.grid ? 'on' : ''}`;
    gridToggle.onclick = () => {
      const on = !gridToggle.classList.contains('on');
      gridToggle.classList.toggle('on', on);
      this.audio.uiClick();
      this.photo.updateSettings({ grid: on });
      this.gridOverlay.classList.toggle('visible', on);
    };
    gridRow.appendChild(gridToggle);
    controls.appendChild(gridRow);

    this.el.appendChild(controls);

    // Bottom bar
    const bottom = document.createElement('div');
    bottom.className = 'photo-bottom';
    const mkBtn = (label: string, primary: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.className = `btn small ${primary ? 'primary' : ''}`;
      b.innerHTML = label;
      b.onclick = fn;
      bottom.appendChild(b);
    };
    mkBtn('📷 Capture', true, () => {
      this.audio.uiCameraShutter();
      this.onCapture?.();
    });
    mkBtn('🖼️ Gallery', false, () => {
      this.audio.uiClick();
      this.showGallery();
    });
    mkBtn('◀️ Exit', false, () => {
      this.audio.uiBack();
      this.onExit?.();
    });
    this.el.appendChild(bottom);
  }

  private showGallery(): void {
    const photos = this.photo.getPhotos();
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop visible';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.cssText = 'width:min(720px,94vw);max-height:84vh;display:flex;flex-direction:column';
    panel.innerHTML = `<div class="menu-title" style="font-size:18px">Gallery (${photos.length})</div>`;
    if (photos.length === 0) {
      panel.innerHTML += `<div style="color:var(--text-dim);text-align:center;padding:30px">No photos yet. Capture your first shot!</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      for (const p of photos) {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `<img src="${p.dataUrl}" alt="photo" loading="lazy"/><button class="del" title="Delete">✕</button>`;
        item.querySelector('.del')!.addEventListener('click', (e) => {
          e.stopPropagation();
          this.photo.deletePhoto(p.id);
          item.remove();
          this.audio.uiBack();
        });
        item.onclick = () => {
          const win = window.open();
          win?.document.write(`<img src="${p.dataUrl}" style="max-width:100%"/>`);
        };
        grid.appendChild(item);
      }
      panel.appendChild(grid);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn small';
    closeBtn.style.marginTop = '14px';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      this.audio.uiBack();
      backdrop.remove();
    };
    panel.appendChild(closeBtn);
    backdrop.appendChild(panel);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) backdrop.remove();
    };
    this.el.appendChild(backdrop);
  }
}
