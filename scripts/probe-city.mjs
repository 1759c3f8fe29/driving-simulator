/**
 * probe-city.mjs — one-off diagnostic: parse the city FBX with three's own
 * FBXLoader (in Node) and report the real mesh granularity + bounds, which
 * decides whether radius streaming can chunk per-mesh or must re-split.
 *
 * Usage: node scripts/probe-city.mjs [path-to.fbx]
 */

import { readFileSync } from 'node:fs';

// Minimal DOM shim: FBXLoader constructs THREE.TextureLoader for embedded/linked
// textures, which needs document.createElementNS. We only care about geometry,
// so hand back inert stand-ins.
globalThis.document = {
  createElementNS: () => ({
    set src(_v) {},
    addEventListener() {},
    removeEventListener() {},
  }),
  createElement: () => ({ getContext: () => null, style: {} }),
};
globalThis.self = globalThis;
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:stub';
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const file = process.argv[2] || 'assets/sanfranscisco/city/SanFrancisco_City.fbx';
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new FBXLoader();
const group = loader.parse(ab, '');

const meshes = [];
group.traverse((o) => {
  if (o.isMesh) meshes.push(o);
});

console.log('=== FBX:', file, '===');
console.log('meshes:', meshes.length);

const rows = meshes.map((m) => {
  const g = m.geometry;
  const pos = g.getAttribute('position');
  const n = pos ? pos.count : 0;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const size = bb ? bb.getSize(new THREE.Vector3()) : new THREE.Vector3();
  const ctr = bb ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return {
    name: m.name,
    verts: n,
    groups: g.groups ? g.groups.length : 0,
    mats: mats.filter(Boolean).map((x) => x.name || '(unnamed)'),
    size: [size.x, size.y, size.z].map((v) => Math.round(v)),
    ctr: [ctr.x, ctr.y, ctr.z].map((v) => Math.round(v)),
    attrs: Object.keys(g.attributes),
  };
});

rows.sort((a, b) => b.verts - a.verts);
let total = 0;
for (const r of rows) total += r.verts;
console.log('total vertices:', total.toLocaleString());
console.log('');
for (const r of rows.slice(0, 40)) {
  console.log(
    `${String(r.verts).padStart(9)}  grp=${String(r.groups).padStart(2)}  size=${r.size.join('x')}  ctr=${r.ctr.join(',')}  attrs=[${r.attrs.join(',')}]  "${r.name}"  mats=${r.mats.join('|')}`
  );
}
if (rows.length > 40) console.log(`... ${rows.length - 40} more meshes`);

// Whole-model bounds (world space after matrix application).
group.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(group);
const s = box.getSize(new THREE.Vector3());
console.log('');
console.log('world bounds min:', box.min.toArray().map((v) => Math.round(v)).join(','));
console.log('world bounds max:', box.max.toArray().map((v) => Math.round(v)).join(','));
console.log('precise min:', box.min.toArray().map((v) => +v.toFixed(3)).join(','));
console.log('precise max:', box.max.toArray().map((v) => +v.toFixed(3)).join(','));
for (const m of meshes) {
  console.log(`  ${m.name}: objScale=${m.scale.toArray().join(',')} objPos=${m.position.toArray().map((v) => +v.toFixed(2)).join(',')}`);
}
console.log('world size:', s.toArray().map((v) => Math.round(v)).join(' x '));
console.log('root scale:', group.scale.toArray().join(','));
