/**
 * Config — Central game configuration. No hardcoded values elsewhere.
 */

export const CONFIG = {
  renderer: {
    maxPixelRatio: 2,
    mobileMaxPixelRatio: 1.5,
    toneMappingExposure: 1.0,
    shadowMapSize: 2048,
  },
  physics: {
    gravity: -9.81,
    fixedTimestep: 1 / 120,
    maxSubSteps: 4,
  },
  vehicle: {
    mass: 1450, // kg
    engineInertia: 0.15,
    idleRPM: 850,
    maxRPM: 8200,
    redline: 7800,
    peakTorqueRPM: 5200,
    peakTorque: 660, // Nm
    engineBraking: 0.35,
    throttleResponse: 4.5, // 1/s smoothing
    gearRatios: [-3.2, 0, 3.10, 2.18, 1.72, 1.38, 1.12, 0.94], // R, N, 1..6
    finalDrive: 3.42,
    shiftUpRPM: 7400,
    shiftDownRPM: 2400,
    shiftTime: 0.28, // s
    clutchEngageTime: 0.18,
    wheelRadius: 0.335, // m
    maxSteerAngle: 0.62, // rad
    steerSpeed: 3.2,
    steerReturnSpeed: 5.0,
    brakeTorque: 5200, // Nm per wheel (front bias applied)
    handbrakeTorque: 6800,
    fuelCapacity: 70, // liters
    fuelConsumptionIdle: 0.00035, // L/s
    fuelConsumptionRate: 0.0000115, // L/s per (rpm*throttle) normalized
    suspensionRest: 0.42,
    suspensionTravel: 0.22,
    suspensionStiffness: 42000,
    suspensionDamping: 4600,
    suspensionCompressionDamping: 3800,
    tireGripBase: 1.55,
    tireGripWet: 0.72,
    tireGripSnow: 0.5,
    dragCoefficient: 0.34,
    frontalArea: 2.1,
    airDensity: 1.225,
    rollingResistance: 12.5,
    downforce: 2.8,
    // The baked city does not cover chunk 0,0 — the grid runs cx/cz -10..5 with
    // a ragged coastline, and the origin falls in open water. This spot is the
    // centre of chunk (-1,-4): flat (1.5 m spread over a 20 m cross), low
    // triangle density (a street, not a rooftop), and ringed by loaded chunks
    // out to the keep radius so streaming has somewhere to stream. Y is a
    // starting height only — CityLoader.findSpawnPoint raycasts the real ground.
    spawnPosition: { x: -62.5, y: 4.0, z: -437.5 },
  },
  camera: {
    chaseDistance: 6.4,
    chaseHeight: 2.1,
    chaseLookAhead: 2.2,
    chaseStiffness: 5.2,
    fov: 62,
    cockpitFov: 68,
  },
  weather: {
    transitionDuration: 45, // seconds
    dayLengthSeconds: 600, // full 24h cycle
    startTimeOfDay: 10.5, // hours
  },
  audio: {
    masterVolume: 0.9,
    engineVolume: 0.85,
    effectsVolume: 0.9,
    uiVolume: 0.7,
    ambienceVolume: 0.6,
  },
  save: {
    key: 'apexdrive_save_v1',
    settingsKey: 'apexdrive_settings_v1',
    statsKey: 'apexdrive_stats_v1',
    achievementsKey: 'apexdrive_achievements_v1',
    photosKey: 'apexdrive_photos_v1',
    replaysKey: 'apexdrive_replays_v1',
    autosaveInterval: 15, // seconds
  },
  replay: {
    sampleRate: 20, // Hz
    maxDuration: 120, // seconds (ring-buffer length, rolling)
    autoRecord: true, // record every drive session into the rolling ring
    minSaveDuration: 10, // seconds of driving before a session is worth persisting
  },
  weatherScheduler: {
    enabled: true,
    minInterval: 45, // seconds — no change before this
    maxInterval: 150, // seconds — forced upper bound (adds jitter)
    transitionSeconds: 30, // transition duration passed to setWeather()
  },
  photo: {
    freeCamera: {
      moveSpeed: 12, // units/s
      fastMultiplier: 3, // Shift
      slowMultiplier: 0.3, // Ctrl
    },
  },
  cinematics: {
    driveIntro: true, // play the swoop on Play/Continue
    introDuration: 4.2, // total seconds (fade-in -> swoop -> land -> handoff)
    fadeToBlack: 0.45, // phase A
    swoopDuration: 2.4, // phase B+C
    handoffDuration: 0.65, // phase D (remaining time holds the title)
    skipOnAnyInput: true,
    menuOrbit: { enabled: true, distance: 9, height: 4, speed: 0.08, pitch: 0.28 },
    filmGrain: { amount: 0.035, highQualityOnly: true },
    vignetteBase: 0.35,
    damagePulse: { strength: 0.7, decay: 2.5 },
  },
  hud: {
    speedoMaxKmh: 320,
    rpmGaugeMax: 9000,
  },
  world: {
    // The SanFrancisco FBX ships at ~7.5 world units across (smaller than the
    // car). Scale it to a ~1875 m district so the ambient-prop grid, camera
    // distances and physics all line up.
    cityScale: 250,
    cityYOffset: 0,
  },
  streaming: {
    enabled: true,
    chunkSize: 125, // world metres per chunk edge (must match city-manifest.json)
    loadRadius: 3, // chunks: begin loading within this ring
    keepRadius: 5, // chunks: unload once further than this
    colliderRadius: 2, // chunks: build physics colliders only this close
    lod1Radius: 2, // chunks: beyond this ring use the decimated LOD
    maxLoadsPerFrame: 1,
    maxUnloadsPerFrame: 2,
    budgetMsPerFrame: 4,
    maxConcurrentFetches: 3,
    warmupRadius: 2, // chunks fully resident before the first frame is shown
    textureRes: { near: 1024, far: 512 },
    lowEndTextureRes: { near: 512, far: 256 },
  },
  boot: {
    directToDriving: true, // skip the main menu entirely
    skipIntro: true, // no cinematic swoop on low-end hardware
  },
};

export type GameConfig = typeof CONFIG;

export const isMobile = (): boolean =>
  /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential damping. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const msToKmh = (ms: number): number => ms * 3.6;
export const kmhToMph = (kmh: number): number => kmh * 0.621371;

export const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
