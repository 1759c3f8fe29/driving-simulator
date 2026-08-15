/**
 * PhotoModeManager — Free camera, filters, capture to gallery.
 */

import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';

export interface PhotoFilter {
  name: string;
  css: string;
}

export const PHOTO_FILTERS: PhotoFilter[] = [
  { name: 'None', css: 'none' },
  { name: 'Vivid', css: 'saturate(1.5) contrast(1.1)' },
  { name: 'Noir', css: 'grayscale(1) contrast(1.2)' },
  { name: 'Warm', css: 'sepia(0.35) saturate(1.2)' },
  { name: 'Cool', css: 'hue-rotate(15deg) saturate(1.1) brightness(1.05)' },
  { name: 'Retro', css: 'sepia(0.5) contrast(0.9) brightness(1.1)' },
  { name: 'Dramatic', css: 'contrast(1.4) brightness(0.9) saturate(1.2)' },
];

export interface PhotoSettings {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  bloom: number;
  fov: number;
  filter: number; // index into PHOTO_FILTERS
  grid: boolean;
}

export const DEFAULT_PHOTO_SETTINGS: PhotoSettings = {
  exposure: 1,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  bloom: 0.35,
  fov: 62,
  filter: 0,
  grid: false,
};

export interface SavedPhoto {
  id: string;
  date: string;
  dataUrl: string;
}

export class PhotoModeManager {
  private bus = EventBus.get();
  private save = SaveManager.get();
  active = false;
  settings: PhotoSettings = { ...DEFAULT_PHOTO_SETTINGS };

  enter(): void {
    this.active = true;
    this.settings = { ...DEFAULT_PHOTO_SETTINGS };
  }

  exit(): void {
    this.active = false;
  }

  updateSettings(partial: Partial<PhotoSettings>): void {
    Object.assign(this.settings, partial);
  }

  /** Capture the canvas as a JPEG data URL with the active CSS filter applied. */
  capture(canvas: HTMLCanvasElement): SavedPhoto | null {
    try {
      const filter = PHOTO_FILTERS[this.settings.filter];
      const s = this.settings;
      const combined = [
        filter.css !== 'none' ? filter.css : '',
        `brightness(${s.brightness * s.exposure})`,
        `contrast(${s.contrast})`,
        `saturate(${s.saturation})`,
      ].filter(Boolean).join(' ');

      let dataUrl: string;
      if (combined) {
        // Render through an offscreen canvas with ctx filter
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.filter = combined;
        ctx.drawImage(canvas, 0, 0);
        dataUrl = off.toDataURL('image/jpeg', 0.85);
      } else {
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      }

      const photo: SavedPhoto = {
        id: `photo_${Date.now()}`,
        date: new Date().toISOString(),
        dataUrl,
      };
      this.persist(photo);
      this.bus.emit(Events.PHOTO_TAKEN, { id: photo.id });
      this.bus.emit(Events.NOTIFY, { type: 'success', message: 'Photo saved', icon: 'camera' });
      return photo;
    } catch (err) {
      console.error('[PhotoMode] capture failed', err);
      this.bus.emit(Events.NOTIFY, { type: 'error', message: 'Photo capture failed', icon: 'error' });
      return null;
    }
  }

  private persist(photo: SavedPhoto): void {
    const photos = this.getPhotos();
    photos.unshift(photo);
    // Keep last 12 photos (localStorage limits)
    const trimmed = photos.slice(0, 12);
    // If too large, drop oldest until it fits
    while (trimmed.length > 1) {
      try {
        localStorage.setItem(CONFIG.save.photosKey, JSON.stringify(trimmed));
        return;
      } catch {
        trimmed.pop();
      }
    }
  }

  getPhotos(): SavedPhoto[] {
    return this.save.readGeneric<SavedPhoto[]>(CONFIG.save.photosKey, []);
  }

  deletePhoto(id: string): void {
    const photos = this.getPhotos().filter((p) => p.id !== id);
    this.save.writeGeneric(CONFIG.save.photosKey, photos);
  }
}
