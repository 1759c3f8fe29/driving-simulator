/**
 * AssetLoader — Centralized loading of FBX models, textures, audio.
 * Promise-based with progress events, error events, and retry logic.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { EventBus, Events } from './EventBus';
import { ResourceManager } from './ResourceManager';

export interface LoadProgress {
  asset: string;
  loaded: number;
  total: number;
  percent: number;
}

export interface AssetManifestEntry {
  key: string;
  url: string;
  type: 'model' | 'texture' | 'audio';
}

export class AssetLoader {
  private fbxLoader = new FBXLoader();
  private textureLoader = new THREE.TextureLoader();
  private bus = EventBus.get();
  private resources = ResourceManager.get();
  private models = new Map<string, THREE.Group>();
  private loadedCount = 0;
  private totalCount = 0;

  async loadManifest(manifest: AssetManifestEntry[], audioContext: AudioContext): Promise<void> {
    this.totalCount = manifest.length;
    this.loadedCount = 0;

    for (const entry of manifest) {
      await this.loadWithRetry(entry, audioContext, 3);
      this.loadedCount++;
      this.emitProgress(entry.key);
    }
    this.bus.emit(Events.LOAD_COMPLETE);
  }

  private emitProgress(asset: string): void {
    this.bus.emit<LoadProgress>(Events.LOAD_PROGRESS, {
      asset,
      loaded: this.loadedCount,
      total: this.totalCount,
      percent: Math.round((this.loadedCount / this.totalCount) * 100),
    });
  }

  private async loadWithRetry(
    entry: AssetManifestEntry,
    audioContext: AudioContext,
    retries: number
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await this.load(entry, audioContext);
        return;
      } catch (err) {
        lastError = err;
        console.warn(`[AssetLoader] retry ${attempt + 1}/${retries} for ${entry.url}`, err);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    this.bus.emit(Events.LOAD_ERROR, { asset: entry.key, error: lastError });
    throw lastError instanceof Error ? lastError : new Error(`Failed to load ${entry.url}`);
  }

  private async load(entry: AssetManifestEntry, audioContext: AudioContext): Promise<void> {
    switch (entry.type) {
      case 'model': {
        const group = await this.fbxLoader.loadAsync(entry.url);
        this.models.set(entry.key, group);
        break;
      }
      case 'texture': {
        if (this.resources.hasTexture(entry.key)) break;
        const tex = await this.textureLoader.loadAsync(entry.url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this.resources.registerTexture(entry.key, tex);
        break;
      }
      case 'audio': {
        if (this.resources.hasAudio(entry.key)) break;
        const res = await fetch(entry.url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.url}`);
        const raw = await res.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(raw);
        this.resources.registerAudio(entry.key, buffer);
        break;
      }
    }
  }

  getModel(key: string): THREE.Group {
    const model = this.models.get(key);
    if (!model) throw new Error(`[AssetLoader] model "${key}" not loaded`);
    return model;
  }

  hasModel(key: string): boolean {
    return this.models.has(key);
  }

  dispose(): void {
    this.models.clear();
  }
}
