/**
 * ResourceManager — Caches textures, models, audio buffers, materials.
 * Every asset exists only once in memory. Handles disposal.
 */

import * as THREE from 'three';

export class ResourceManager {
  private static instance: ResourceManager;
  private textures = new Map<string, THREE.Texture>();
  private audioBuffers = new Map<string, AudioBuffer>();
  private materials = new Map<string, THREE.Material>();
  private geometries = new Map<string, THREE.BufferGeometry>();

  private constructor() {}

  static get(): ResourceManager {
    if (!ResourceManager.instance) ResourceManager.instance = new ResourceManager();
    return ResourceManager.instance;
  }

  registerTexture(key: string, texture: THREE.Texture): THREE.Texture {
    const existing = this.textures.get(key);
    if (existing && existing !== texture) existing.dispose();
    this.textures.set(key, texture);
    return texture;
  }

  getTexture(key: string): THREE.Texture | undefined {
    return this.textures.get(key);
  }

  hasTexture(key: string): boolean {
    return this.textures.has(key);
  }

  registerAudio(key: string, buffer: AudioBuffer): AudioBuffer {
    this.audioBuffers.set(key, buffer);
    return buffer;
  }

  getAudio(key: string): AudioBuffer | undefined {
    return this.audioBuffers.get(key);
  }

  hasAudio(key: string): boolean {
    return this.audioBuffers.has(key);
  }

  registerMaterial(key: string, material: THREE.Material): THREE.Material {
    this.materials.set(key, material);
    return material;
  }

  getMaterial(key: string): THREE.Material | undefined {
    return this.materials.get(key);
  }

  registerGeometry(key: string, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geometries.set(key, geometry);
    return geometry;
  }

  getGeometry(key: string): THREE.BufferGeometry | undefined {
    return this.geometries.get(key);
  }

  /** Dispose a whole object graph (geometries, materials, textures). */
  disposeObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) this.disposeMaterial(m);
      }
    });
  }

  private disposeMaterial(material: THREE.Material): void {
    const mat = material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.normalMap?.dispose();
    mat.roughnessMap?.dispose();
    mat.metalnessMap?.dispose();
    mat.aoMap?.dispose();
    mat.emissiveMap?.dispose();
    material.dispose();
  }

  disposeAll(): void {
    for (const t of this.textures.values()) t.dispose();
    for (const m of this.materials.values()) this.disposeMaterial(m);
    for (const g of this.geometries.values()) g.dispose();
    this.textures.clear();
    this.materials.clear();
    this.geometries.clear();
    this.audioBuffers.clear();
  }
}
