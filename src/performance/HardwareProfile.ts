/**
 * HardwareProfile — One-shot GPU/CPU capability probe run before heavy loading.
 *
 * The streaming city has to decide its texture budget on the very first frame:
 * on a 1536 MB integrated GPU, discovering we are too slow by watching the
 * frame timer means we have already allocated the VRAM that kills the machine.
 * So we sniff the unmasked WebGL renderer string, core count, device memory
 * hint and max texture size once at boot, classify the machine into a tier,
 * and record a human-readable reason for every rule that fired.
 *
 * Every probe is defensive: privacy modes hide WEBGL_debug_renderer_info,
 * headless/software contexts throw on odd parameters, and some embedders
 * return junk. Anything unexpected degrades to `tier: 'medium'` rather than
 * breaking boot — this module must never throw.
 */

import * as THREE from 'three';

export interface HardwareInfo {
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL, or '' when unavailable. */
  renderer: string;
  /** WEBGL_debug_renderer_info UNMASKED_VENDOR_WEBGL, or '' when unavailable. */
  vendor: string;
  maxTextureSize: number;
  cores: number;
  /** navigator.deviceMemory in GB; 0 means the browser did not tell us. */
  deviceMemoryGb: number;
  softwareRasterized: boolean;
  integrated: boolean;
  lowEnd: boolean;
  tier: 'low' | 'medium' | 'high';
  reasons: string[];
}

/** Integrated / mobile / software GPU families — none of these have headroom. */
const INTEGRATED_RE = /intel|hd graphics|uhd|iris|mali|adreno|apple gpu|llvmpipe|swiftshader|softpipe/i;

/** Pure-CPU rasterizers. The trailing 软 catches localized Chinese builds. */
const SOFTWARE_RE = /llvmpipe|swiftshader|softpipe|软/i;

/**
 * Sandy Bridge / Ivy Bridge / Haswell era Intel HD (HD 2000-4600). This is the
 * exact class of machine that crashed on the unbaked 8K textures.
 */
const OLD_INTEL_RE = /hd graphics (2|3|4)\d{3}/i;

/** Below this, the baked 1024px near textures are already at the limit. */
const SMALL_TEXTURE_LIMIT = 4096;

/** navigator.deviceMemory is not in lib.dom; narrow it here instead of `any`. */
interface MemoryNavigator {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/** Runs `fn`, returning `fallback` if it throws or yields a non-finite value. */
function safeNumber(fn: () => unknown, fallback: number): number {
  try {
    const value = fn();
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Runs `fn`, returning '' if it throws or yields anything but a string. */
function safeString(fn: () => unknown): string {
  try {
    const value = fn();
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/** Reads the unmasked vendor/renderer pair; both '' when the extension is absent. */
function readDebugStrings(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  vendor: string;
  renderer: string;
} {
  // getExtension itself can throw on lost/hostile contexts, so guard the lookup.
  let ext: WEBGL_debug_renderer_info | null = null;
  try {
    ext = gl.getExtension('WEBGL_debug_renderer_info');
  } catch {
    ext = null;
  }
  if (!ext) return { vendor: '', renderer: '' };
  const info = ext;
  return {
    vendor: safeString(() => gl.getParameter(info.UNMASKED_VENDOR_WEBGL)),
    renderer: safeString(() => gl.getParameter(info.UNMASKED_RENDERER_WEBGL)),
  };
}

/**
 * Probes the machine behind `renderer` once. Cheap enough to call at boot and
 * safe to call before any assets load. Never throws.
 */
export function detectHardware(renderer: THREE.WebGLRenderer): HardwareInfo {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    gl = renderer.getContext();
  } catch {
    gl = null;
  }

  const nav: MemoryNavigator =
    typeof navigator === 'undefined' ? {} : (navigator as unknown as MemoryNavigator);

  // Bind to a const so the null-narrowing survives into the closures below.
  const ctx = gl;
  const strings = ctx ? readDebugStrings(ctx) : { vendor: '', renderer: '' };
  const rendererName = strings.renderer;
  const vendorName = strings.vendor;

  // 4096 is the WebGL1 floor every conformant implementation guarantees; using
  // it as the fallback keeps an unreadable context out of the "low" bucket by
  // itself while still being honest about what we can assume.
  const maxTextureSize = ctx
    ? safeNumber(() => ctx.getParameter(ctx.MAX_TEXTURE_SIZE), 4096)
    : 4096;
  const cores = safeNumber(() => nav.hardwareConcurrency, 2);
  const deviceMemoryGb = safeNumber(() => nav.deviceMemory, 0);

  const softwareRasterized = SOFTWARE_RE.test(rendererName);
  const integrated = INTEGRATED_RE.test(rendererName);

  const reasons: string[] = [];
  if (softwareRasterized) reasons.push('software rasterizer (no GPU acceleration)');
  if (cores <= 4 && integrated) reasons.push(`integrated GPU with only ${cores} logical cores`);
  if (maxTextureSize <= SMALL_TEXTURE_LIMIT) reasons.push(`max texture size ${maxTextureSize}px`);
  if (deviceMemoryGb > 0 && deviceMemoryGb <= 4) reasons.push(`${deviceMemoryGb} GB device memory`);
  if (OLD_INTEL_RE.test(rendererName)) reasons.push('pre-Skylake Intel HD Graphics');

  const lowEnd = reasons.length > 0;
  const tier: HardwareInfo['tier'] = lowEnd ? 'low' : !integrated && cores >= 8 ? 'high' : 'medium';

  if (!rendererName) {
    // Not a low-end signal on its own (privacy modes mask this on fast machines
    // too), but worth surfacing so the integrator knows the probe was blind.
    reasons.push('renderer string unavailable (masked or no context)');
  }

  return {
    renderer: rendererName,
    vendor: vendorName,
    maxTextureSize,
    cores,
    deviceMemoryGb,
    softwareRasterized,
    integrated,
    lowEnd,
    tier,
    reasons,
  };
}

/** Single-line summary for console logging at boot. */
export function describeHardware(info: HardwareInfo): string {
  const gpu = info.renderer || 'unknown GPU';
  const vendor = info.vendor ? ` [${info.vendor}]` : '';
  const mem = info.deviceMemoryGb > 0 ? `${info.deviceMemoryGb}GB` : 'mem?';
  const flags = [
    info.integrated ? 'integrated' : 'discrete',
    info.softwareRasterized ? 'software' : 'hw',
    info.lowEnd ? 'lowEnd' : 'ok',
  ].join('/');
  const why = info.reasons.length > 0 ? ` — ${info.reasons.join('; ')}` : '';
  return `[hw] ${gpu}${vendor} | ${info.cores} cores | ${mem} | maxTex ${info.maxTextureSize} | tier ${info.tier} (${flags})${why}`;
}
