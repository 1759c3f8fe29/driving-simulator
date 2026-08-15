/**
 * SceneManager — Owns the Three.js scene graph and active camera.
 */

import * as THREE from 'three';

export class SceneManager {
  readonly scene: THREE.Scene;
  private activeCamera: THREE.PerspectiveCamera | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d6);
    this.scene.matrixWorldAutoUpdate = true;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.activeCamera = camera;
  }

  get camera(): THREE.PerspectiveCamera {
    if (!this.activeCamera) throw new Error('[SceneManager] no active camera');
    return this.activeCamera;
  }

  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }
}
