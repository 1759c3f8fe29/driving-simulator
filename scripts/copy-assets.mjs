/**
 * copy-assets — Production packaging for runtime-loaded assets.
 *
 * The game MANIFEST (src/app/Game.ts) loads assets via runtime URLs like
 * 'assets/...' and there is no public/ directory, so `vite build` produces a
 * dist with no assets (404s on any static host). This script mirrors the
 * assets/ tree into dist/ after each build. Runs automatically via the
 * "postbuild" npm hook.
 *
 * EXCLUDE holds directories the runtime never fetches. The city is served from
 * the baked assets/city/ tree (1024²/512² textures + CHK1 chunks), so shipping
 * the 332 MB assets/sanfranscisco/ originals alongside it would triple dist for
 * files no code path can legally load — CityTextures.urlFor() throws on any
 * path containing "sanfranscisco".
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets');
const out = join(root, 'dist', 'assets');

/** Top-level paths under assets/ that are build-time-only inputs. */
const EXCLUDE = ['sanfranscisco'];

if (!existsSync(src)) {
  console.warn('[copy-assets] no assets/ directory to copy, skipping');
  process.exit(0);
}

mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (from) => {
    const rel = relative(src, from);
    if (!rel) return true;
    const top = rel.split(sep)[0];
    return !EXCLUDE.includes(top);
  },
});
console.log(`[copy-assets] copied ${src} -> ${out} (excluded: ${EXCLUDE.join(', ')})`);

