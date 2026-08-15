/**
 * probe-extents.mjs — one-off: report raw vertex extents of a mesh-bearing FBX
 * so world-space units (and therefore streaming chunk size) can be chosen.
 */

import { readFileSync } from 'node:fs';

globalThis.document = {
  createElementNS: () => ({ set src(_v) {}, addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({ getContext: () => null, style: {} }),
};
globalThis.self = globalThis;

const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const file = process.argv[2] || 'assets/sanfranscisco/city/SanFrancisco_City.fbx';
const buf = readFileSync(file);
const group = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');

const gmin = [Infinity, Infinity, Infinity];
const gmax = [-Infinity, -Infinity, -Infinity];
group.traverse((o) => {
  if (!o.isMesh) return;
  const p = o.geometry.attributes.position.array;
  const lmin = [Infinity, Infinity, Infinity];
  const lmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < lmin[k]) lmin[k] = v;
      if (v > lmax[k]) lmax[k] = v;
      if (v < gmin[k]) gmin[k] = v;
      if (v > gmax[k]) gmax[k] = v;
    }
  }
  console.log(
    `${o.name}: verts=${p.length / 3} min=${lmin.map((v) => +v.toFixed(1)).join(',')} max=${lmax.map((v) => +v.toFixed(1)).join(',')} size=${[0, 1, 2].map((k) => +(lmax[k] - lmin[k]).toFixed(1)).join('x')}`
  );
});
console.log('');
console.log('ALL min:', gmin.map((v) => +v.toFixed(1)).join(','));
console.log('ALL max:', gmax.map((v) => +v.toFixed(1)).join(','));
console.log('ALL size:', [0, 1, 2].map((k) => +(gmax[k] - gmin[k]).toFixed(1)).join(' x '));
