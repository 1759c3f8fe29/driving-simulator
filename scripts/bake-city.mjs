/**
 * bake-city.mjs — OFFLINE asset baker. Not part of the game runtime.
 *
 * Converts assets/sanfranscisco/city/ (a 25 MB FBX + seven 8192x8192 JPEGs,
 * ~2.4 GB of texture VRAM when loaded whole) into a streamable form:
 *
 *   assets/city/city-manifest.json   grid + per-chunk index
 *   assets/city/chunks/c_<cx>_<cz>.bin        LOD0 geometry
 *   assets/city/chunks/c_<cx>_<cz>.lod1.bin   decimated geometry
 *   assets/city/tex/near/part-<n>.jpg          1024x1024
 *   assets/city/tex/far/part-<n>.jpg           512x512
 *
 * The FBX ships at ~7.5 world units across (smaller than the player car) and
 * Z-up; the source object matrices rotate it to Y-up. We apply matrixWorld and
 * CONFIG.world.cityScale so baked coordinates are final world metres.
 *
 * Chunk .bin layout (little-endian):
 *   0..3            magic 'CHK1'
 *   4..7            headerLen (u32)
 *   8..8+headerLen  UTF-8 JSON header (see writeChunk below)
 *   payload         4-byte aligned typed arrays at the header's byte offsets
 *
 * Usage: node --max-old-space-size=4096 scripts/bake-city.mjs [--force]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// FBXLoader instantiates THREE.TextureLoader for linked textures, which needs a
// DOM. We only read geometry, so hand it inert stand-ins.
globalThis.document = {
  createElementNS: () => ({ set src(_v) {}, addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({ getContext: () => null, style: {} }),
};
globalThis.self = globalThis;

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const sharp = (await import('sharp')).default;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets/sanfranscisco/city');
const OUT_DIR = join(ROOT, 'assets/city');
const FBX = join(SRC_DIR, 'SanFrancisco_City.fbx');

// Must match CONFIG.world.cityScale / CONFIG.streaming.chunkSize.
const CITY_SCALE = 250;
const CHUNK_SIZE = 125;
const PART_COUNT = 7;
const NEAR_RES = 1024;
const FAR_RES = 512;
const TEX_QUALITY = 82;

// LOD1 keeps the largest triangles until this fraction of source area is kept.
const LOD1_AREA_KEEP = 0.82;
const LOD1_MAX_TRI_FRACTION = 0.4;

const force = process.argv.includes('--force');

function log(...a) {
  console.log('[bake-city]', ...a);
}

// ---------------------------------------------------------------- textures ---

async function bakeTextures() {
  const nearDir = join(OUT_DIR, 'tex/near');
  const farDir = join(OUT_DIR, 'tex/far');
  mkdirSync(nearDir, { recursive: true });
  mkdirSync(farDir, { recursive: true });

  const parts = [];
  for (let i = 0; i < PART_COUNT; i++) {
    const src = join(SRC_DIR, `SanFrancisco_Part-${i}.jpg`);
    if (!existsSync(src)) throw new Error(`missing source texture ${src}`);
    const nearRel = `tex/near/part-${i}.jpg`;
    const farRel = `tex/far/part-${i}.jpg`;
    const nearAbs = join(OUT_DIR, nearRel);
    const farAbs = join(OUT_DIR, farRel);

    if (force || !existsSync(nearAbs)) {
      await sharp(src, { limitInputPixels: 400e6 })
        .resize(NEAR_RES, NEAR_RES, { fit: 'fill', kernel: 'lanczos3' })
        .jpeg({ quality: TEX_QUALITY, mozjpeg: true })
        .toFile(nearAbs);
    }
    if (force || !existsSync(farAbs)) {
      await sharp(src, { limitInputPixels: 400e6 })
        .resize(FAR_RES, FAR_RES, { fit: 'fill', kernel: 'lanczos3' })
        .jpeg({ quality: TEX_QUALITY, mozjpeg: true })
        .toFile(farAbs);
    }
    const nb = statSync(nearAbs).size;
    const fb = statSync(farAbs).size;
    log(`part-${i}: near ${(nb / 1024).toFixed(0)}KB  far ${(fb / 1024).toFixed(0)}KB`);
    parts.push({ index: i, near: nearRel, far: farRel });
  }
  return parts;
}

// ---------------------------------------------------------------- geometry ---

/** Load the FBX and return world-space, city-scaled triangle soup per part. */
function loadParts() {
  const buf = readFileSync(FBX);
  const group = new FBXLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    ''
  );
  group.scale.multiplyScalar(CITY_SCALE);
  group.updateMatrixWorld(true);

  const out = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const m = /part[-_ ]?(\d)/i.exec(o.name) ?? /part[-_ ]?(\d)/i.exec(o.material?.name ?? '');
    const part = m ? Number(m[1]) : 0;

    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;

    const count = pos.count;
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const U = new Float32Array(count * 2);

    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      P[i * 3] = v.x;
      P[i * 3 + 1] = v.y;
      P[i * 3 + 2] = v.z;
      if (nor) {
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        N[i * 3] = n.x;
        N[i * 3 + 1] = n.y;
        N[i * 3 + 2] = n.z;
      }
      if (uv) {
        U[i * 2] = uv.getX(i);
        U[i * 2 + 1] = uv.getY(i);
      }
    }
    out.push({ part, name: o.name, P, N, U, tris: count / 3, hasNormal: !!nor, hasUv: !!uv });
    log(`loaded ${o.name} -> part ${part}, ${(count / 3).toLocaleString()} tris`);
  });
  return out;
}

/** Triangle area from three flat-array vertex indices. */
function triArea(P, a, b, c) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az;
  const vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Bucket every triangle into a chunk by its centroid, then per (chunk, part)
 * build a deduplicated indexed mesh. Returns Map<"cx,cz", chunk>.
 */
function chunkify(parts) {
  const chunks = new Map();
  const key = (cx, cz) => `${cx},${cz}`;

  for (const src of parts) {
    const { P, N, U, part } = src;
    const triCount = P.length / 9;
    for (let t = 0; t < triCount; t++) {
      const i0 = t * 9, i1 = i0 + 3, i2 = i0 + 6;
      const cxw = (P[i0] + P[i1] + P[i2]) / 3;
      const czw = (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3;
      const cx = Math.floor(cxw / CHUNK_SIZE);
      const cz = Math.floor(czw / CHUNK_SIZE);

      const k = key(cx, cz);
      let chunk = chunks.get(k);
      if (!chunk) {
        chunk = { cx, cz, sections: new Map(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        chunks.set(k, chunk);
      }
      let sec = chunk.sections.get(part);
      if (!sec) {
        sec = { part, pos: [], nor: [], uv: [], idx: [], dedup: new Map(), area: [] };
        chunk.sections.set(part, sec);
      }

      const tri = [i0, i1, i2];
      for (const base of tri) {
        const vi = base / 3;
        // Quantize to 1mm for dedup so shared corners collapse.
        const dk = `${Math.round(P[base] * 1000)},${Math.round(P[base + 1] * 1000)},${Math.round(P[base + 2] * 1000)},${Math.round(U[vi * 2] * 4096)},${Math.round(U[vi * 2 + 1] * 4096)}`;
        let ref = sec.dedup.get(dk);
        if (ref === undefined) {
          ref = sec.pos.length / 3;
          sec.dedup.set(dk, ref);
          sec.pos.push(P[base], P[base + 1], P[base + 2]);
          sec.nor.push(N[base], N[base + 1], N[base + 2]);
          sec.uv.push(U[vi * 2], U[vi * 2 + 1]);
        }
        sec.idx.push(ref);
        for (let a = 0; a < 3; a++) {
          const val = P[base + a];
          if (val < chunk.min[a]) chunk.min[a] = val;
          if (val > chunk.max[a]) chunk.max[a] = val;
        }
      }
      sec.area.push(triArea(P, i0, i1, i2));
    }
  }
  for (const chunk of chunks.values()) {
    for (const sec of chunk.sections.values()) sec.dedup = null;
  }
  return chunks;
}

/**
 * Build a decimated index list: keep the largest triangles until either the
 * area or triangle-count budget is hit. Preserves silhouette far better than
 * uniform stride sampling, and never touches the vertex buffer.
 */
function decimate(sec) {
  const triCount = sec.idx.length / 3;
  if (triCount <= 32) return sec.idx;
  const order = new Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;
  order.sort((a, b) => sec.area[b] - sec.area[a]);

  let totalArea = 0;
  for (const a of sec.area) totalArea += a;
  const areaBudget = totalArea * LOD1_AREA_KEEP;
  const triBudget = Math.max(32, Math.floor(triCount * LOD1_MAX_TRI_FRACTION));

  const keep = [];
  let acc = 0;
  for (const t of order) {
    if (keep.length >= triBudget) break;
    keep.push(t);
    acc += sec.area[t];
    if (acc >= areaBudget) break;
  }
  keep.sort((a, b) => a - b);
  const out = new Array(keep.length * 3);
  for (let i = 0; i < keep.length; i++) {
    const t = keep[i] * 3;
    out[i * 3] = sec.idx[t];
    out[i * 3 + 1] = sec.idx[t + 1];
    out[i * 3 + 2] = sec.idx[t + 2];
  }
  return out;
}

// ------------------------------------------------------------------ writing --

const align4 = (n) => (n + 3) & ~3;

/**
 * Serialize one chunk. `indexFor(sec)` selects LOD0 vs LOD1 indices. Vertices
 * are compacted to only those the chosen index list references, so an LOD1 file
 * carries no vertex the decimated mesh never draws.
 */
function writeChunk(chunk, file, indexFor) {
  const sections = [];
  const blobs = [];
  let off = 0;

  for (const sec of chunk.sections.values()) {
    const srcIdx = indexFor(sec);
    if (srcIdx.length < 3) continue;

    // Compact: build a dense vertex set over the referenced indices only.
    const remap = new Map();
    const posArr = [];
    const norArr = [];
    const uvArr = [];
    const idx = new Array(srcIdx.length);
    for (let i = 0; i < srcIdx.length; i++) {
      const src = srcIdx[i];
      let dst = remap.get(src);
      if (dst === undefined) {
        dst = posArr.length / 3;
        remap.set(src, dst);
        posArr.push(sec.pos[src * 3], sec.pos[src * 3 + 1], sec.pos[src * 3 + 2]);
        norArr.push(sec.nor[src * 3], sec.nor[src * 3 + 1], sec.nor[src * 3 + 2]);
        uvArr.push(sec.uv[src * 2], sec.uv[src * 2 + 1]);
      }
      idx[i] = dst;
    }
    const verts = posArr.length / 3;

    const pos = new Float32Array(posArr);
    const nor = new Float32Array(norArr);
    const uv = new Float32Array(uvArr);
    const ind = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);

    const entry = { part: sec.part, verts, indices: idx.length, indexBytes: verts > 65535 ? 4 : 2 };
    for (const [name, arr] of [['pos', pos], ['nor', nor], ['uv', uv], ['idx', ind]]) {
      off = align4(off);
      entry[name] = { off, len: arr.byteLength };
      blobs.push({ off, arr });
      off += arr.byteLength;
    }
    sections.push(entry);
  }
  if (!sections.length) return null;

  const header = JSON.stringify({
    cx: chunk.cx,
    cz: chunk.cz,
    min: chunk.min.map((v) => +v.toFixed(3)),
    max: chunk.max.map((v) => +v.toFixed(3)),
    sections,
  });
  const headerBuf = Buffer.from(header, 'utf8');
  const headerLen = align4(headerBuf.byteLength);
  const payloadStart = 8 + headerLen;

  const out = Buffer.alloc(payloadStart + off);
  out.write('CHK1', 0, 'ascii');
  out.writeUInt32LE(headerLen, 4);
  headerBuf.copy(out, 8);
  for (const { off: o, arr } of blobs) {
    Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(out, payloadStart + o);
  }
  writeFileSync(file, out);
  return { bytes: out.byteLength, tris: sections.reduce((s, x) => s + x.indices / 3, 0) };
}

// --------------------------------------------------------------------- main --

async function main() {
  if (!existsSync(FBX)) throw new Error(`missing ${FBX}`);
  mkdirSync(join(OUT_DIR, 'chunks'), { recursive: true });
  if (force) rmSync(join(OUT_DIR, 'chunks'), { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, 'chunks'), { recursive: true });

  log('baking textures...');
  const parts = await bakeTextures();

  log('loading FBX...');
  const srcParts = loadParts();
  const srcTris = srcParts.reduce((s, p) => s + p.tris, 0);
  log(`source: ${srcParts.length} meshes, ${srcTris.toLocaleString()} tris`);

  log('chunking...');
  const chunks = chunkify(srcParts);
  log(`${chunks.size} chunks at ${CHUNK_SIZE}m`);

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const grid = { minCx: Infinity, maxCx: -Infinity, minCz: Infinity, maxCz: -Infinity };
  const entries = [];
  let totalBytes = 0;
  let totalLod1 = 0;
  let keptTris = 0;
  let lod1Tris = 0;

  for (const chunk of [...chunks.values()].sort((a, b) => a.cx - b.cx || a.cz - b.cz)) {
    const stem = `c_${chunk.cx}_${chunk.cz}`;
    const lod0Rel = `chunks/${stem}.bin`;
    const lod1Rel = `chunks/${stem}.lod1.bin`;

    const r0 = writeChunk(chunk, join(OUT_DIR, lod0Rel), (s) => s.idx);
    if (!r0) continue;
    const r1 = writeChunk(chunk, join(OUT_DIR, lod1Rel), (s) => decimate(s));

    for (let a = 0; a < 3; a++) {
      if (chunk.min[a] < bounds.min[a]) bounds.min[a] = chunk.min[a];
      if (chunk.max[a] > bounds.max[a]) bounds.max[a] = chunk.max[a];
    }
    grid.minCx = Math.min(grid.minCx, chunk.cx);
    grid.maxCx = Math.max(grid.maxCx, chunk.cx);
    grid.minCz = Math.min(grid.minCz, chunk.cz);
    grid.maxCz = Math.max(grid.maxCz, chunk.cz);

    totalBytes += r0.bytes;
    totalLod1 += r1 ? r1.bytes : 0;
    keptTris += r0.tris;
    lod1Tris += r1 ? r1.tris : 0;

    entries.push({
      cx: chunk.cx,
      cz: chunk.cz,
      file: lod0Rel,
      lod1: r1 ? lod1Rel : null,
      bytes: r0.bytes,
      lod1Bytes: r1 ? r1.bytes : 0,
      tris: r0.tris,
      lod1Tris: r1 ? r1.tris : 0,
      min: chunk.min.map((v) => +v.toFixed(3)),
      max: chunk.max.map((v) => +v.toFixed(3)),
      parts: [...chunk.sections.keys()].sort((a, b) => a - b),
    });
  }

  const manifest = {
    version: 1,
    source: 'assets/sanfranscisco/city/SanFrancisco_City.fbx',
    scale: CITY_SCALE,
    chunkSize: CHUNK_SIZE,
    grid,
    bounds: { min: bounds.min.map((v) => +v.toFixed(3)), max: bounds.max.map((v) => +v.toFixed(3)) },
    textureRes: { near: NEAR_RES, far: FAR_RES },
    parts,
    chunks: entries,
  };
  writeFileSync(join(OUT_DIR, 'city-manifest.json'), JSON.stringify(manifest, null, 1));

  const size = [0, 1, 2].map((a) => (bounds.max[a] - bounds.min[a]).toFixed(0));
  log('');
  log(`world size:      ${size.join(' x ')} m`);
  log(`grid:            cx ${grid.minCx}..${grid.maxCx}, cz ${grid.minCz}..${grid.maxCz}`);
  log(`chunks written:  ${entries.length}`);
  log(`LOD0 total:      ${(totalBytes / 1048576).toFixed(1)} MB, ${keptTris.toLocaleString()} tris`);
  log(`LOD1 total:      ${(totalLod1 / 1048576).toFixed(1)} MB, ${lod1Tris.toLocaleString()} tris`);
  log(`avg chunk:       ${(totalBytes / entries.length / 1024).toFixed(0)} KB`);
  log('done -> assets/city/');
}

await main();
