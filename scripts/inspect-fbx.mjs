/**
 * inspect-fbx.mjs — one-off tool: parse a binary FBX (v7400) and report its
 * object structure (Geometry count, per-geometry vertex counts, Model count).
 * NOT part of the game. Robust: bails to node boundary on unknown property type.
 *
 * Usage: node scripts/inspect-fbx.mjs <file.fbx>
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node inspect-fbx.mjs <file.fbx>');
  process.exit(1);
}
const buf = readFileSync(file);
let off = 27; // 23-byte magic + u32 version (7400)

const u32 = () => {
  const v = buf.readUInt32LE(off);
  off += 4;
  return v;
};

// Skip one property; returns false if the type byte is unknown (caller bails).
function skipProperty() {
  const type = String.fromCharCode(buf[off]);
  switch (type) {
    case 'Y': off += 3; return true;
    case 'C': off += 2; return true;
    case 'I': case 'F': off += 5; return true;
    case 'D': case 'L': off += 9; return true;
    case 'S': { off += 1; const n = u32(); off += n; return true; }
    case 'R': { off += 1; const n = u32(); off += n; return true; }
    case 'f': case 'i': { off += 1; const n = u32(); off += 4 * n; return true; }
    case 'd': case 'l': { off += 1; const n = u32(); off += 8 * n; return true; }
    case 'b': { off += 1; const n = u32(); off += n; return true; }
    default: return false;
  }
}

function readNode() {
  const endOffset = u32();
  const numProps = u32();
  const propListLen = u32();
  const nameLen = buf[off++];
  const name = buf.toString('utf8', off, off + nameLen);
  off += nameLen;
  let vertCount = 0;
  for (let i = 0; i < numProps; i++) {
    const before = off;
    const ok = skipProperty();
    if (!ok) {
      // Unknown type — cannot recover; abandon this node.
      off = endOffset;
      return { name, vertCount, abandoned: true, children: [] };
    }
    // Capture the d-array length for a Vertices property.
    if (name === 'Vertices' && buf[before] === 100 /* 'd' */) {
      vertCount = buf.readUInt32LE(before + 1);
    }
  }
  const children = [];
  while (off < endOffset) {
    if (buf.length - off < 13) break;
    children.push(readNode());
  }
  off = Math.max(off, endOffset);
  return { name, vertCount, children };
}

const roots = [];
while (off < buf.length - 13) roots.push(readNode());

const geometries = [];
const models = [];
const connections = [];
function walk(n) {
  for (const c of n.children) {
    if (c.name === 'Geometry') geometries.push(c);
    else if (c.name === 'Model') models.push(c);
    else if (c.name === 'Connection') connections.push(c);
    walk(c);
  }
}
walk({ children: roots });

const sizes = geometries.map((g) => g.vertCount).sort((a, b) => b - a);
const totalVerts = sizes.reduce((s, v) => s + v, 0);
const nonEmpty = sizes.filter((s) => s > 0);
console.log('=== FBX:', file, '===');
console.log('bytes:', buf.length, ' top-level nodes:', roots.length);
console.log('Geometry objects:', geometries.length);
console.log('Model objects:', models.length);
console.log('Connection objects:', connections.length);
console.log('total vertices (sum of Vertices d-arrays):', totalVerts.toLocaleString());
console.log('non-empty geometries:', nonEmpty.length);
console.log('largest 15 by vertex count:', sizes.slice(0, 15).join(', '));
console.log(
  '>100k:', sizes.filter((s) => s > 100000).length,
  ' 10k..100k:', sizes.filter((s) => s > 10000 && s <= 100000).length,
  ' 1k..10k:', sizes.filter((s) => s > 1000 && s <= 10000).length,
  ' 100..1k:', sizes.filter((s) => s > 100 && s <= 1000).length,
  ' <100:', sizes.filter((s) => s > 0 && s <= 100).length
);
