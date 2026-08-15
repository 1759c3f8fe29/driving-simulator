/**
 * ChunkFormat — zero-copy reader for the baked 'CHK1' chunk container.
 * Layout (little-endian): magic 'CHK1' | u32 headerLen | UTF-8 JSON header
 * (NUL-padded to 4 bytes) | payload. Every array offset in the header is
 * relative to the payload start and 4-byte aligned, so attribute data is handed
 * out as typed-array views over the fetched ArrayBuffer with no copying — the
 * target GPU/CPU budget cannot afford a second copy of 45 MB of geometry.
 */

const MAGIC = 0x314b4843; // 'CHK1' read as little-endian u32
const FLOAT_BYTES = 4;

interface ChunkRange {
  off: number;
  len: number;
}

interface ChunkHeaderSection {
  part: number;
  verts: number;
  indices: number;
  indexBytes: number;
  pos: ChunkRange;
  nor: ChunkRange;
  uv: ChunkRange;
  idx: ChunkRange;
}

interface ChunkHeader {
  cx: number;
  cz: number;
  min: [number, number, number];
  max: [number, number, number];
  sections: ChunkHeaderSection[];
}

export interface ChunkSectionData {
  part: number;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array | Uint32Array;
}

export interface ChunkData {
  cx: number;
  cz: number;
  min: [number, number, number];
  max: [number, number, number];
  sections: ChunkSectionData[];
}

const decoder = new TextDecoder();

/** Bounds/alignment/divisibility guard shared by every attribute range. */
function checkRange(
  what: string,
  range: ChunkRange,
  base: number,
  elementBytes: number,
  bufferBytes: number
): number {
  if (!range || !Number.isFinite(range.off) || !Number.isFinite(range.len) || range.off < 0 || range.len < 0) {
    throw new Error(`ChunkFormat: ${what} has an invalid range`);
  }
  const start = base + range.off;
  if (start + range.len > bufferBytes) {
    throw new Error(
      `ChunkFormat: ${what} range ${start}..${start + range.len} exceeds buffer of ${bufferBytes} bytes`
    );
  }
  if (range.len % elementBytes !== 0) {
    throw new Error(`ChunkFormat: ${what} length ${range.len} is not a multiple of ${elementBytes}`);
  }
  if (start % elementBytes !== 0) {
    throw new Error(`ChunkFormat: ${what} offset ${start} is not ${elementBytes}-byte aligned`);
  }
  return start;
}

/**
 * Parse a chunk .bin into typed-array views. Throws a descriptive Error on any
 * malformed or out-of-range field; callers treat a throw as "drop this chunk".
 */
export function parseChunkBinary(buffer: ArrayBuffer): ChunkData {
  const bufferBytes = buffer.byteLength;
  if (bufferBytes < 8) {
    throw new Error(`ChunkFormat: buffer of ${bufferBytes} bytes is too small to hold a header`);
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('ChunkFormat: bad magic, expected \'CHK1\'');
  }
  const headerLen = view.getUint32(4, true);
  const payloadStart = 8 + headerLen;
  if (payloadStart > bufferBytes) {
    throw new Error(`ChunkFormat: headerLen ${headerLen} exceeds buffer of ${bufferBytes} bytes`);
  }

  // The header is NUL-padded to a 4-byte boundary; JSON.parse rejects the pad.
  let jsonEnd = payloadStart;
  while (jsonEnd > 8 && view.getUint8(jsonEnd - 1) === 0) jsonEnd--;
  const header = JSON.parse(decoder.decode(new Uint8Array(buffer, 8, jsonEnd - 8))) as ChunkHeader;
  if (!Array.isArray(header.sections)) {
    throw new Error('ChunkFormat: header has no sections array');
  }

  const sections: ChunkSectionData[] = [];
  for (let i = 0; i < header.sections.length; i++) {
    const s = header.sections[i];
    const label = `chunk ${header.cx},${header.cz} section ${i}`;
    const indexBytes = s.indexBytes;
    if (indexBytes !== 2 && indexBytes !== 4) {
      throw new Error(`ChunkFormat: ${label} has unsupported indexBytes ${indexBytes}`);
    }

    const posStart = checkRange(`${label} pos`, s.pos, payloadStart, FLOAT_BYTES, bufferBytes);
    const norStart = checkRange(`${label} nor`, s.nor, payloadStart, FLOAT_BYTES, bufferBytes);
    const uvStart = checkRange(`${label} uv`, s.uv, payloadStart, FLOAT_BYTES, bufferBytes);
    const idxStart = checkRange(`${label} idx`, s.idx, payloadStart, indexBytes, bufferBytes);

    const position = new Float32Array(buffer, posStart, s.pos.len / FLOAT_BYTES);
    const normal = new Float32Array(buffer, norStart, s.nor.len / FLOAT_BYTES);
    const uv = new Float32Array(buffer, uvStart, s.uv.len / FLOAT_BYTES);
    const indexCount = s.idx.len / indexBytes;
    const index =
      indexBytes === 2
        ? new Uint16Array(buffer, idxStart, indexCount)
        : new Uint32Array(buffer, idxStart, indexCount);

    if (position.length !== normal.length || position.length / 3 !== uv.length / 2) {
      throw new Error(
        `ChunkFormat: ${label} attribute counts disagree (pos ${position.length}, nor ${normal.length}, uv ${uv.length})`
      );
    }

    sections.push({ part: s.part, position, normal, uv, index });
  }

  return { cx: header.cx, cz: header.cz, min: header.min, max: header.max, sections };
}

/** Triangle count across all sections — used by the streaming stats overlay. */
export function chunkDataTriangles(data: ChunkData): number {
  let tris = 0;
  for (let i = 0; i < data.sections.length; i++) {
    tris += data.sections[i].index.length / 3;
  }
  return tris;
}
