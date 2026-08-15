/**
 * Game — Top-level orchestrator. Owns the game loop and wires all managers.
 * Initialization follows the dependency order from AIGUIDE.
 */

import * as THREE from 'three';
import { CONFIG, clamp, isMobile } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { Clock } from '../core/Clock';
import { Renderer } from '../core/Renderer';
import { SceneManager } from '../core/SceneManager';
import { AssetLoader, AssetManifestEntry } from '../core/AssetLoader';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { SaveManager } from '../save/SaveManager';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { VehicleController } from '../vehicle/VehicleController';
import { VehicleVisual, CAR_TRIANGLE_BUDGET } from '../vehicle/VehicleVisual';
import { CameraManager } from '../camera/CameraManager';
import { Sky } from '../rendering/Sky';
import { WeatherManager, WeatherType } from '../rendering/WeatherManager';
import { WeatherScheduler } from '../rendering/WeatherScheduler';
import { PostProcessing } from '../rendering/PostProcessing';
import { CityLoader } from '../world/CityLoader';
import { GarageManager } from '../garage/GarageManager';
import { PhotoModeManager } from '../photo/PhotoModeManager';
import { ReplayManager } from '../replay/ReplayManager';
import { StatisticsManager } from '../stats/StatisticsManager';
import { AchievementManager } from '../stats/AchievementManager';
import { UIManager, UIAction } from '../ui/UIManager';
import { GameStateMachine } from './GameState';
import { PerformanceManager } from '../performance/PerformanceManager';
import { Traffic } from '../world/Traffic';
import { Minimap } from '../ui/Minimap';
import { Radio } from '../audio/Radio';
import { RadioPanel } from '../ui/RadioPanel';
import { SkidMarks } from '../rendering/SkidMarks';
import { TireSmoke } from '../rendering/TireSmoke';
import { CinematicOverlay } from '../ui/CinematicOverlay';
import { FXOverlay } from '../ui/FXOverlay';
import { DriveIntro } from '../cinematics/DriveIntro';
import { detectHardware, describeHardware, HardwareInfo } from '../performance/HardwareProfile';
import { BootProgress, decideBoot, BootDecision } from './BootFlow';
import { PERF_PANIC_EVENT } from '../performance/PerformanceManager';

/**
 * Runtime asset manifest. The city is NOT here: it is baked into
 * assets/city/ (147 streamed chunks + 512/1024px textures) and fetched on
 * demand by StreamingWorld. The original 8192x8192 city JPEGs were ~2.4 GB of
 * texture VRAM on load, which is what used to hard-crash low-end GPUs.
 */
const MANIFEST: AssetManifestEntry[] = [
  { key: 'car', url: 'assets/cars/jesko/source/Koenigsegg_OnePlus.fbx', type: 'model' },
  { key: 'engine_idle', url: 'assets/sound/401552__giocosound__sfx_car_engine_outside_idle.wav', type: 'audio' },
  { key: 'engine_start', url: 'assets/sound/401558__giocosound__sfx_car_engine_outside_start.wav', type: 'audio' },
];

export class Game {
  private bus = EventBus.get();
  private state = new GameStateMachine();
  private clock = new Clock();
  private renderer!: Renderer;
  private sceneMgr!: SceneManager;
  private loader!: AssetLoader;
  private physics!: PhysicsWorld;
  private save = SaveManager.get();
  private input = InputManager.get();
  private audio = AudioManager.get();
  private vehicle!: VehicleController;
  /** False until `VehicleController.create()` resolves; guards boot-time readers. */
  private vehicleReady = false;
  private vehicleVisual!: VehicleVisual;
  private cameraMgr!: CameraManager;
  private sky!: Sky;
  private weather!: WeatherManager;
  private weatherScheduler!: WeatherScheduler;
  private post!: PostProcessing;
  private perf!: PerformanceManager;
  private city!: CityLoader;
  private garage = new GarageManager();
  private photoMode = new PhotoModeManager();
  private replayMgr = new ReplayManager();
  private stats = StatisticsManager.get();
  private achievements = AchievementManager.get();
  private ui!: UIManager;
  private traffic!: Traffic;
  private minimap!: Minimap;
  private radio = new Radio();
  private radioPanel!: RadioPanel;
  private skidMarks!: SkidMarks;
  private tireSmoke!: TireSmoke;
  private cinematicOverlay!: CinematicOverlay;
  private fxOverlay!: FXOverlay;
  private driveIntro!: DriveIntro;
  private eulerTmp = new THREE.Euler();
  private hardware!: HardwareInfo;
  private boot!: BootDecision;
  private bootProgress!: BootProgress;
  /** Cached chunk-cell list handed to the minimap; rebuilt only when it changes. */
  private minimapChunks: { cx: number; cz: number }[] = [];
  private streamStatsTimer = 0;

  private paused = false;
  private lastFrameTime = 0;
  private fpsLimitAccumulator = 0;
  private achievementTimer = 0;
  private canvas: HTMLCanvasElement;

  constructor() {
    const canvas = document.getElementById('game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas#game-canvas missing');
    this.canvas = canvas;
  }

  async start(): Promise<void> {
    // Core
    this.renderer = new Renderer(this.canvas);
    this.sceneMgr = new SceneManager();
    this.cameraMgr = new CameraManager(window.innerWidth / window.innerHeight);
    this.sceneMgr.setCamera(this.cameraMgr.camera);
    this.physics = await PhysicsWorld.get();
    this.loader = new AssetLoader();

    // Hardware profile FIRST: on an integrated/low-VRAM GPU we pick the low-end
    // path before anything heavy is allocated, rather than thrashing into it.
    this.hardware = detectHardware(this.renderer.instance);
    console.info('[Game]', describeHardware(this.hardware));
    this.boot = decideBoot({ lowEnd: this.hardware.lowEnd, hasSave: this.stats.stats.trips > 0 });
    console.info('[Game] boot:', this.boot.reason);

    // Performance manager — adaptive quality + F10 debug overlay
    this.perf = new PerformanceManager(this.renderer.instance, () => ({
      bodies: this.physics.world.bodies.len(),
      colliders: this.physics.world.colliders.len(),
    }));
    if (this.boot.lowEnd) this.perf.startLowEnd();

    // UI (loading screen visible immediately)
    this.ui = new UIManager(document.getElementById('ui-root')!, this.garage, this.photoMode, this.replayMgr);
    this.ui.onAction = (a) => this.handleUIAction(a);

    // Open-world expansion UIs — minimap lives inside the HUD, radio is a panel
    this.minimap = new Minimap(document.getElementById('hud')!);
    this.radioPanel = new RadioPanel(document.getElementById('ui-root')!, this.radio);
    this.ui.mobile.onRadio = () => this.radioPanel.show();
    this.ui.mobile.onMap = () => {
      if (this.minimap.isVisible) this.minimap.hide();
      else this.minimap.show();
    };

    // AAA post-loading experience: full-screen cinematic overlay + driving-feel FX
    // layers, and the drive-start director. The overlay container is revealed once;
    // its letterbox/title/fade children stay hidden until DriveIntro animates them.
    this.cinematicOverlay = new CinematicOverlay(document.getElementById('ui-root')!);
    this.fxOverlay = new FXOverlay(document.getElementById('ui-root')!);
    this.driveIntro = new DriveIntro({
      overlay: this.cinematicOverlay,
      cameraMgr: this.cameraMgr,
      audio: this.audio,
    });
    this.cinematicOverlay.show();

    // Audio needs a user gesture; unlock on first interaction
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // Boot progress drives the loading screen through weighted phases so the bar
    // reflects real work (chunk streaming is 45% of it) instead of file counts.
    this.bootProgress = new BootProgress((percent, label) => {
      this.ui.loading.setProgress(percent);
      this.ui.loading.setPhase(label);
    });
    this.bootProgress.complete('init');

    // Load assets (car model + engine audio; the city streams separately).
    this.bootProgress.begin('assets');
    try {
      await this.loader.loadManifest(MANIFEST, this.audio.context);
    } catch (err) {
      console.error('[Game] asset load failed', err);
      await this.ui.dialogs.alert('Loading Error', 'Some assets failed to load. Check your connection and reload.');
    }

    // World — radius-streamed city. Only the chunks around the spawn point are
    // resident when this resolves; the rest stream in as the car drives.
    this.bootProgress.complete('assets');
    this.bootProgress.begin('manifest');
    this.city = new CityLoader();
    // NOTE: do NOT call city.setLowEnd(true) here. The low-end mode drops the
    // 1024² near textures (the *whole point* of the bake is that they are the
    // low-end-appropriate resolution, ~22 MB total) and no-ops ensureNear(), so
    // the streamed city loses its identity and renders as featureless planes.
    // Radius streaming (3/5/2/2 from CONFIG.streaming) is already the laptop
    // strategy — geometry shedding, not texture shedding.
    this.city.onBootProgress = (phase, done, total) => {
      if (phase === 'textures') {
        this.bootProgress.advance('textures', total > 0 ? done / total : 1);
      } else {
        this.bootProgress.advance('chunks', total > 0 ? done / total : 1);
        this.ui.loading.setDetail(`Streaming city ${done}/${total} chunks`);
      }
    };
    await this.city.load(this.loader, this.physics);
    this.bootProgress.complete('chunks');
    this.sceneMgr.add(this.city.group);

    // Feed streaming stats into the F10 overlay.
    this.perf.setStreamingStatsProvider(() => {
      const s = this.city.getStreamingStats();
      return {
        loaded: s.loaded,
        pending: s.pending,
        colliders: s.colliders,
        tris: s.tris,
        lod0: s.lod0,
        lod1: s.lod1,
      };
    });

    // ...and the drivetrain/contact numbers, so the overlay can distinguish "no
    // input" from "no ground under the wheels" — the HUD's rpm gauge cannot,
    // because Engine derives rpm from wheel speed. Registered lazily: F10 can be
    // pressed during boot, and `this.vehicle` does not exist yet.
    this.perf.setVehicleStatsProvider(() => {
      const t = this.vehicleReady ? this.vehicle.getTelemetry() : null;
      return {
        speedKmh: t?.speedKmh ?? 0,
        gear: t?.gear ?? '-',
        rpm: t?.rpm ?? 0,
        throttle: t?.throttle ?? 0,
        grounded: t?.groundedWheels ?? 0,
        y: t?.position.y ?? 0,
        tripKm: t?.odometerKm ?? 0,
        driveSec: t?.driveTimeSec ?? 0,
      };
    });

    // Environment
    this.bootProgress.begin('physics');
    this.sky = new Sky(this.sceneMgr.scene);
    this.weather = new WeatherManager(this.sceneMgr.scene, this.sky);
    this.weatherScheduler = new WeatherScheduler(this.weather);
    this.post = new PostProcessing(this.renderer.instance, this.sceneMgr.scene, this.cameraMgr.camera);
    this.applyGraphicsSettings();
    this.bootProgress.complete('physics');

    // Vehicle
    this.bootProgress.begin('vehicle');
    const spawn = this.city.findSpawnPoint(this.physics);
    CONFIG.vehicle.spawnPosition.x = spawn.x;
    CONFIG.vehicle.spawnPosition.y = spawn.y;
    CONFIG.vehicle.spawnPosition.z = spawn.z;
    this.vehicle = await VehicleController.create();
    this.vehicleReady = true;
    this.garage.attachVehicle(this.vehicle); // pushes persisted garage upgrades into physics
    // The car model is ~703k triangles — about half of everything drawn per
    // frame, against ~23k for the whole resident streamed city. Cap it at load
    // time by hardware tier; `high` passes 0 and keeps the model untouched.
    this.vehicleVisual = await VehicleVisual.create(
      this.loader,
      'car',
      CAR_TRIANGLE_BUDGET[this.hardware.tier]
    );
    this.sceneMgr.add(this.vehicleVisual.root);
    this.bootProgress.complete('vehicle');

    // Open-world expansion: AI traffic + skid marks + tire smoke
    this.traffic = new Traffic(this.sceneMgr.scene, this.physics);
    this.skidMarks = new SkidMarks(this.sceneMgr.scene);
    this.tireSmoke = new TireSmoke(this.sceneMgr.scene);
    if (this.boot.lowEnd) {
      // Traffic is physics + draw calls we cannot afford next to streaming.
      this.traffic.setMaxActive(4);
      this.minimap.setEnabled(false);
    }

    // Minimap works in real world coordinates now that the city is a ~1876 m
    // district; without the baked bounds it would pin the player in a corner.
    const bounds = this.city.getWorldBounds();
    if (bounds) this.minimap.setWorldBounds(bounds.min, bounds.max);

    // Wire events
    this.wireEvents();

    // Resize
    this.renderer.onResize((w, h) => {
      this.cameraMgr.resize(w / h);
      this.post.resize(w, h);
    });

    // Start
    this.save.startAutosave();
    this.bus.on('save:autosave-tick', () => {
      if (this.state.is('driving')) {
        this.vehicle.persist();
        this.stats.persist();
      }
    });

    this.bootProgress.finish();
    this.ui.loading.hide();

    if (this.boot.directToDriving) {
      // No menu: the player asked to land in the car with controls live.
      this.startDriving();
    } else {
      this.state.transition('menu');
      this.ui.showScreen('menu');
      if (CONFIG.cinematics.menuOrbit.enabled) {
        this.cameraMgr.setMenuOrbit(true);
        this.cameraMgr.setMode('orbit');
      }
    }
    this.clock.start();
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private wireEvents(): void {
    this.bus.on('input:pause:down', () => {
      if (this.ui.dialogs.isOpen) return;
      if (this.driveIntro.isActive) {
        this.driveIntro.skip(); // Esc during the drive-start swoop skips the cinematic
        return;
      }
      if (this.state.is('driving')) this.pauseGame();
      else if (this.state.is('paused')) this.resumeGame();
      else if (this.state.is('settings', 'stats', 'achievements', 'controls', 'credits', 'photo', 'replay', 'garage')) this.handleUIAction('back');
    });
    this.bus.on('input:photoMode:down', () => {
      if (this.state.is('driving')) this.enterPhotoMode();
      else if (this.state.is('photo')) this.exitPhotoMode();
    });
    this.bus.on('input:horn:down', () => this.audio.playHorn());
    this.bus.on('input:doorToggle:down', () => {
      const toggled = this.vehicleVisual.toggleDoor();
      this.ui.notifications.show({
        type: toggled ? 'info' : 'warning',
        message: toggled
          ? (this.vehicleVisual.doorOpenState ? 'Driver door opened' : 'Driver door closed')
          : 'No animated doors on this vehicle',
        icon: 'door',
      });
    });
    this.bus.on(Events.COLLISION, (e: unknown) => {
      const ev = e as { impulse: number };
      const intensity = Math.min(1, ev.impulse / 100000);
      this.audio.playCollision(intensity);
      this.cameraMgr.addShake(intensity * 0.8);
      this.fxOverlay.pulseDamage(intensity);
      this.post.pulseVignette(intensity * 0.5);
    });
    this.bus.on(Events.ENGINE_STARTED, () => this.audio.startEngine());
    this.bus.on(Events.ENGINE_STOPPED, () => this.audio.stopEngine());
    this.bus.on('weather:lightning', (e: unknown) => {
      this.audio.playThunder((e as { delay: number }).delay);
    });
    this.bus.on(Events.SETTINGS_APPLIED, () => {
      this.applyGraphicsSettings();
      this.vehicle.setTransmissionMode(this.save.settings.gameplay.transmission);
    });
    this.bus.on('performance:level', () => {
      this.applyGraphicsSettings();
    });
    // Panic watchdog tripped: three 250ms+ frames in a 2s window. Shed geometry
    // and draw calls, but NOT textures — dropping the 1024² near textures
    // (setLowEnd) is what made the city render as featureless planes. The
    // radius shed here keeps fewer chunks resident instead.
    this.bus.on(PERF_PANIC_EVENT, () => {
      console.warn('[Game] performance panic — shedding geometry footprint');
      this.city.shedRadius();
      this.traffic.setEnabled(false);
      this.minimap.setEnabled(false);
      this.post.setFilmGrain(false);
      this.post.setMotionBlur(false);
      this.applyGraphicsSettings();
      this.ui.notifications.show({
        type: 'warning',
        message: 'Low performance detected — graphics reduced',
        icon: 'settings',
      });
    });
    this.bus.on(Events.ACHIEVEMENT_UNLOCKED, () => {
      // already notified via Notifications
    });
    this.ui.photo.onCapture = () => {
      this.renderer.instance.render(this.sceneMgr.scene, this.cameraMgr.camera);
      this.photoMode.capture(this.canvas);
    };
    this.ui.photo.onSettingsChanged = () => {
      const s = this.photoMode.settings;
      this.post.setBloom(true, s.bloom);
      this.cameraMgr.camera.fov = s.fov;
      this.cameraMgr.camera.updateProjectionMatrix();
      this.renderer.setExposure(s.exposure);
    };
  }

  private applyGraphicsSettings(): void {
    const g = this.save.settings.graphics;
    // Adaptive quality (PerformanceManager) gates user toggles further down the stack.
    const q = this.perf.getQualityConfig();
    this.post.setBloom(g.bloom && q.bloom);
    this.post.setSSAO(g.ssao && !isMobile() && q.ssao); // SSAO is GPU-heavy; skip on mobile
    this.post.setMotionBlur(g.motionBlur && q.motionBlur);
    // Film grain follows adaptive quality (off at low / lowest quality levels).
    const grainEnabled = CONFIG.cinematics.filmGrain.highQualityOnly
      ? this.perf.levelIndex <= 1
      : true;
    this.post.setFilmGrain(grainEnabled);
    this.post.setAntialiasing(true);
    // Adaptive quality can veto the whole composer chain and shadows: at the
    // worst level the second scene traversal a shadow map costs, and the
    // full-screen quad per composer pass, are the most expensive things left.
    this.post.setEnabled(q.postFx);
    const shadows = g.shadows && q.shadows;
    this.renderer.instance.shadowMap.enabled = shadows;
    this.sky.setShadowQuality(shadows ? g.shadowQuality : 256);
    const scale = g.renderScale * q.renderScale;
    // Cap the display ratio first, *then* scale it. Writing this as
    // `min(devicePixelRatio, cap * scale)` — as it was — makes the render scale a
    // no-op on every ordinary 1x laptop panel: min(1, 2 * 0.5) is still 1, so
    // dropping to the worst quality level shrank nothing at all on exactly the
    // hardware the level exists for.
    const ratioCap = isMobile() ? CONFIG.renderer.mobileMaxPixelRatio : CONFIG.renderer.maxPixelRatio;
    const ratio = Math.min(window.devicePixelRatio, ratioCap) * scale;
    // Below ~0.6 the frame is mush and the low-poly city's baked textures stop
    // being readable — the city's identity lives in those textures, so a floor
    // that lets them blur away is a floor that erases the world.
    this.renderer.instance.setPixelRatio(Math.max(0.6, ratio));
    // The composer caches the pixel ratio it was built with, so without this the
    // scale change only shrinks the canvas and every pass keeps full-res targets.
    this.post.syncPixelRatio(this.renderer.instance);
  }

  // ---------- State transitions ----------

  private handleUIAction(action: UIAction): void {
    switch (action) {
      case 'play':
      case 'continue':
        this.startDriving();
        break;
      case 'resume':
        this.resumeGame();
        break;
      case 'restart':
        this.vehicle.respawnAtStart();
        this.resumeGame();
        break;
      case 'garage':
        this.enterGarage();
        break;
      case 'photo':
        this.enterPhotoMode();
        break;
      case 'replay':
        this.enterReplay();
        break;
      case 'settings':
        this.state.transition('settings');
        this.ui.showScreen('settings');
        break;
      case 'controls':
        this.state.transition('settings');
        this.ui.showScreen('settings');
        break;
      case 'stats':
        this.state.transition('stats');
        this.ui.showScreen('stats');
        break;
      case 'achievements':
        this.state.transition('achievements');
        this.ui.showScreen('achievements');
        break;
      case 'credits':
        this.state.transition('credits');
        this.ui.showScreen('credits');
        break;
      case 'mainmenu':
        this.exitToMenu();
        break;
      case 'exit':
        void this.ui.dialogs.confirm('Exit Game', 'Close the game? Your progress is saved.').then((yes) => {
          if (yes) {
            this.finalizeReplay();
            this.vehicle.persist();
            this.stats.endSession();
            window.close();
            this.ui.notifications.show({ type: 'info', message: 'Progress saved. You can close this tab.' });
          }
        });
        break;
      case 'back':
        this.goBack();
        break;
    }
  }

  private goBack(): void {
    const from = this.state.state;
    if (from === 'garage') this.exitGarage();
    else if (from === 'photo') this.exitPhotoMode();
    else if (from === 'replay') this.exitReplay();
    else if (from === 'settings' || from === 'stats' || from === 'achievements' || from === 'credits' || from === 'controls') {
      const target = this.state.last === 'paused' ? 'paused' : this.state.last === 'driving' ? 'paused' : 'menu';
      if (this.state.last === 'driving' || this.state.last === 'paused') {
        this.state.transition('paused');
        this.ui.showScreen('paused');
      } else {
        this.state.transition('menu');
        this.ui.showScreen('menu');
      }
      void target;
    } else if (from === 'driving') {
      this.pauseGame();
    } else if (from === 'paused') {
      this.resumeGame();
    }
  }

  /** Re-arm the replay ring buffer whenever driving becomes active. */
  private ensureReplayRecording(): void {
    if (CONFIG.replay.autoRecord && !this.replayMgr.isRecording()) this.replayMgr.startRecording();
  }

  /** Stop the ring and persist the current drive's clip (only at session end). */
  private finalizeReplay(): void {
    if (this.replayMgr.isRecording()) this.replayMgr.stopRecording();
    if (this.replayMgr.getCurrentFrames().length / CONFIG.replay.sampleRate >= CONFIG.replay.minSaveDuration) {
      this.replayMgr.saveRecording();
    }
  }

  private startDriving(): void {
    this.state.transition('driving');
    this.ui.showScreen('driving');
    this.paused = false;
    this.weatherScheduler.reset();
    if (!this.audio.isUnlocked) this.audio.unlock();

    // AAA cinematic drive-start: the swoop plays before control is handed over,
    // so input + replay recording stay gated until the intro completes (or is
    // skipped). BootFlow suppresses it entirely on low-end hardware.
    if (this.boot.playIntro) {
      this.cameraMgr.setMenuOrbit(false);
      this.ui.mobile.hide(); // deck stays hidden while the camera swoops in
      const t = this.vehicle.getTelemetry();
      this.driveIntro.start(t.position, t.quaternion, () => this.completeDriveHandoff());
    } else {
      this.completeDriveHandoff();
    }
  }

  /** Runs when the drive-start cinematic finishes or is skipped. */
  private completeDriveHandoff(): void {
    this.cameraMgr.setMenuOrbit(false);
    this.cameraMgr.setMode('chase');
    this.input.setEnabled(true);
    this.ensureReplayRecording();
    if (this.vehicle.engine.running) this.audio.startEngine();
    this.stats.stats.trips++;
    this.ui.mobile.show(); // deck slides in as control is handed over
  }

  private pauseGame(): void {
    this.paused = true;
    this.state.transition('paused');
    this.ui.showScreen('paused');
    this.input.setEnabled(false);
    this.bus.emit(Events.PAUSE);
    this.vehicle.persist();
    this.stats.persist();
  }

  private resumeGame(): void {
    this.paused = false;
    this.state.transition('driving');
    this.ui.showScreen('driving');
    this.input.setEnabled(true);
    this.ensureReplayRecording();
    this.bus.emit(Events.RESUME);
  }

  private enterGarage(): void {
    this.paused = true;
    this.input.setEnabled(false);
    this.vehicle.persist();
    this.garage.enter(this.vehicle, this.vehicleVisual);
    this.state.transition('garage');
    this.ui.showScreen('garage');
    this.cameraMgr.setMenuOrbit(false); // garage uses its own faster orbit preset
    this.cameraMgr.setMode('orbit');
  }

  private exitGarage(): void {
    this.garage.exit();
    this.paused = false;
    this.input.setEnabled(true);
    this.cameraMgr.setMode('chase');
    this.ensureReplayRecording();
    // Return to pause menu if we came from there, else drive
    if (this.state.last === 'paused') {
      this.state.transition('paused');
      this.ui.showScreen('paused');
    } else {
      this.state.transition('driving');
      this.ui.showScreen('driving');
    }
  }

  private enterPhotoMode(): void {
    this.paused = true;
    this.input.setEnabled(false);
    this.input.setFreeCameraEnabled(true);
    this.photoMode.enter();
    this.cameraMgr.setMode('free');
    this.cameraMgr.setFreeCameraTarget(this.vehicle.getTelemetry().position);
    this.state.transition('photo');
    this.ui.showScreen('photo');
  }

  private exitPhotoMode(): void {
    this.photoMode.exit();
    this.renderer.setExposure(this.save.settings.graphics ? 1 : 1);
    this.applyGraphicsSettings();
    this.cameraMgr.setMode('chase');
    this.paused = false;
    this.input.setEnabled(true);
    this.input.setFreeCameraEnabled(false);
    this.ensureReplayRecording();
    this.state.transition('driving');
    this.ui.showScreen('driving');
  }

  private enterReplay(): void {
    this.paused = true;
    this.input.setEnabled(false);
    if (this.replayMgr.hasRecording()) {
      this.replayMgr.play();
    } else {
      this.ui.notifications.show({ type: 'info', message: 'No recording yet — drive to record automatically', icon: 'replay' });
    }
    this.state.transition('replay');
    this.ui.showScreen('replay');
  }

  private exitReplay(): void {
    this.replayMgr.stop();
    this.paused = false;
    this.input.setEnabled(true);
    this.ensureReplayRecording(); // re-arm: replayMgr.stop() left us idle
    this.state.transition('driving');
    this.ui.showScreen('driving');
  }

  private exitToMenu(): void {
    this.finalizeReplay();
    this.vehicle.persist();
    this.stats.endSession();
    this.paused = true;
    this.input.setEnabled(false);
    this.state.transition('menu');
    this.ui.showScreen('menu');
    // Back to the living-menu turntable backdrop.
    if (CONFIG.cinematics.menuOrbit.enabled) {
      this.cameraMgr.setMenuOrbit(true);
      this.cameraMgr.setMode('orbit');
    }
  }

  // ---------- Main loop ----------

  private loop = (): void => {
    requestAnimationFrame(this.loop);

    // FPS limiter
    const fpsLimit = this.save.settings.graphics.fpsLimit;
    const now = performance.now();
    const minFrame = 1000 / fpsLimit;
    this.fpsLimitAccumulator += now - this.lastFrameTime;
    if (this.fpsLimitAccumulator < minFrame * 0.95) return;
    this.lastFrameTime = now;
    this.fpsLimitAccumulator = 0;

    const dt = this.clock.tick();
    if (dt === 0) return;

    const driving = this.state.is('driving');
    const inReplay = this.state.is('replay');

    // Fixed-step physics
    if (!this.paused && driving) {
      this.clock.clampAccumulator();
      while (this.clock.consumeFixedStep()) {
        this.vehicle.fixedUpdate(this.clock.fixedDelta);
        this.physics.step();
      }
    }

    // Telemetry & visuals
    const telemetry = this.vehicle.getTelemetry();
    if (driving && !this.paused) {
      const t = this.vehicle.updateTelemetry();
      this.vehicleVisual.update(t, dt);
      this.replayMgr.recordFrame(t.position, t.quaternion, t.speedKmh, t.rpm, t.gearIndex, dt);
      this.stats.feed(t.speedKmh, t.rpm, t.throttle, t.brake, t.drifting, dt);
      this.vehicle.currentGrip = this.weather.gripMultiplier;
      this.city.setWetness(this.weather.wetness);
      // Fell through an unloaded chunk: put the car back rather than let it
      // tumble to the safety floor forever.
      if (t.position.y < this.city.voidY) {
        this.vehicle.respawnAtStart();
        this.ui.notifications.show({
          type: 'warning',
          message: 'Recovered — you drove off the loaded world',
          icon: 'respawn',
        });
      }
      this.audio.updateEngine(t.rpm, t.throttle, t.engineRunning);
      this.audio.updateSkid(t.slip, t.speedKmh);
      this.weatherScheduler.update(dt);

      // Open-world expansion systems
      this.input.pollGamepad(); // no-ops unless a pad is connected
      // Stream city chunks around the car BEFORE traffic and raycasts run, so
      // they see this frame's colliders rather than last frame's.
      this.city.update(t.position, dt);
      this.traffic.update(dt, t.position);
      this.skidMarks.update(t, dt);
      this.tireSmoke.update(t, dt);
      this.radioPanel.setSpeed(t.speedKmh);
      this.minimap.update(t.position, this.eulerTmp.setFromQuaternion(t.quaternion, 'YXZ').y);
      // Refresh the minimap's streamed-chunk shading a few times a second — the
      // resident set only changes when the car crosses a 125 m cell boundary.
      this.streamStatsTimer += dt;
      if (this.streamStatsTimer > 0.5) {
        this.streamStatsTimer = 0;
        const n = this.city.collectLoadedCells(this.minimapChunks);
        this.minimap.setLoadedChunks(
          n === this.minimapChunks.length ? this.minimapChunks : this.minimapChunks.slice(0, n)
        );
      }
      // Driving-feel FX: damage edge + speed lines, and a motion-blur ramp at speed.
      this.fxOverlay.setDamageRatio(1 - t.health);
      this.fxOverlay.setSpeedRatio(clamp(t.speedKmh / 280, 0, 1));
      if (this.save.settings.graphics.motionBlur && this.perf.getQualityConfig().motionBlur) {
        this.post.setMotionBlur(true, clamp(t.speedKmh / 280, 0, 1));
      }
      this.ui.mobile.update(dt); // steering-wheel smoothing
    }

    // Replay playback
    if (inReplay) {
      const frame = this.replayMgr.update(dt);
      if (frame) {
        this.vehicleVisual.root.position.copy(frame.position);
        this.vehicleVisual.root.quaternion.copy(frame.quaternion);
      }
      this.ui.updateReplay();
    }

    // Environment always animates (menus have live background)
    const followPos = telemetry.position;
    this.weather.update(dt, followPos);
    const skyState = this.sky.update(dt, followPos, this.weather.sunDimming);
    this.audio.updateAmbience(telemetry.speedKmh, this.weather.windSpeed, this.weather.wetness, dt);

    // Lightning exposure boost
    const baseExposure = this.photoMode.active ? this.photoMode.settings.exposure : 1;
    this.renderer.setExposure(baseExposure + this.weather.lightningBoost);

    // Camera
    // Cinematic drive-start director (also eases the overlay's fade/letterbox).
    if (this.driveIntro.isActive) this.driveIntro.update(dt);
    this.cinematicOverlay.update(dt);

    if (this.garage.active) {
      this.garage.update(dt);
      this.vehicleVisual.root.rotation.y = this.garage.platformAngle;
      this.cameraMgr.update(telemetry, dt);
    } else if (inReplay) {
      const frame = this.replayMgr.sampleAt(this.replayMgr.playback.time);
      if (frame) {
        this.cameraMgr.update(
          { ...telemetry, position: frame.position, quaternion: frame.quaternion },
          dt
        );
      }
    } else {
      if (this.state.is('photo')) {
        const move = this.input.getFreeCameraMove();
        if (move) this.cameraMgr.updateFreeCamera(move, dt);
      }
      this.cameraMgr.update(telemetry, dt);
    }

    // Cockpit gauge cluster only while actively driving in cockpit view
    this.vehicleVisual.setCockpitVisible(this.state.is('driving') && this.cameraMgr.mode === 'cockpit');

    // HUD
    if (this.state.is('driving')) {
      this.ui.updateHUD(telemetry, skyState.timeOfDay, this.weather.label, this.clock.fps);
    }

    // Achievements (checked 2x per second)
    this.achievementTimer += dt;
    if (this.achievementTimer > 0.5) {
      this.achievementTimer = 0;
      this.achievements.evaluate(this.stats.stats);
    }

    // Performance monitoring (adaptive quality + F10 debug overlay). The raw
    // delta is passed alongside the simulation delta so the stall watchdog sees
    // real frame durations rather than the clamped ones.
    this.perf.update(this.clock.fps, dt, this.clock.rawDelta);
    if (this.perf.isOverlayVisible()) {
      this.perf.refreshStats();
      this.perf.renderOverlay();
    }

    // Render
    this.post.render(this.renderer.instance, this.sceneMgr.scene, this.cameraMgr.camera, dt);
  };
}
