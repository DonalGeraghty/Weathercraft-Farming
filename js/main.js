// ---- Ticker ----
// Owns the RAF loop, fixed-step accumulator, and visibility handling.
// Knows nothing about crops, dogs, or audio.

function createTicker(onTick) {
  const TARGET_FPS = 60;
  const FRAME_MIN_MS = 1000 / TARGET_FPS;
  const TARGET_RENDER_FPS = 24;
  const RENDER_MIN_MS = 1000 / TARGET_RENDER_FPS;
  const MAX_TICKS_PER_FRAME = 2;
  const MAX_ACCUMULATED_MS = FRAME_MIN_MS * MAX_TICKS_PER_FRAME;
  const MAX_DELTA_MS = 250;

  let rafId = 0;
  let running = false;
  let lastFrameTime = 0;
  let lastRenderTime = 0;
  let simAccumulator = 0;
  let pageHidden = document.hidden;

  function onVisibilityChange() {
    pageHidden = document.hidden;
    if (pageHidden) simAccumulator = 0;
  }

  function frame(now) {
    if (!running) return;

    const deltaMs = Math.min(now - lastFrameTime, MAX_DELTA_MS);
    if (deltaMs < FRAME_MIN_MS) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastFrameTime = now;

    if (!state.paused && !pageHidden) {
      simAccumulator = Math.min(simAccumulator + deltaMs, MAX_ACCUMULATED_MS);

      let ticks = 0;
      while (simAccumulator >= FRAME_MIN_MS && ticks < MAX_TICKS_PER_FRAME) {
        onTick(FRAME_MIN_MS);
        simAccumulator -= FRAME_MIN_MS;
        ticks++;
      }

      const renderElapsed = now - lastRenderTime;
      if ((hasDirtyTiles() || ticks > 0) && renderElapsed >= RENDER_MIN_MS) {
        renderFrame();
        lastRenderTime = now;
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastFrameTime = performance.now();
      lastRenderTime = lastFrameTime;
      simAccumulator = 0;
      document.addEventListener("visibilitychange", onVisibilityChange);
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },
  };
}

// ---- AudioManager ----
// Owns all audio elements and the BGM fade state machine.
// Reads user-intent from state (musicPlaying, musicVolumePercent) but
// never writes to state — keeps the boundary clean.

function createAudioManager() {
  // Internal state — no longer scattered across runtimeCtx and state.
  let bgm = null;
  let rooster = null;
  let swapCheckCooldownMs = 0;
  let lastAppliedVolume = -1;

  // Fade machine
  const FADE = { IDLE: "idle", OUT: "fadeOut", IN: "fadeIn" };
  let fadeState = FADE.IDLE;
  let fadeTimerMs = 0;

  function applyVolume(multiplier) {
    if (!bgm) return;
    const pct = Number(state.musicVolumePercent) || 0;
    const nextVolume = clamp01((pct / 100) * getBgmBase() * multiplier);
    if (Math.abs(nextVolume - lastAppliedVolume) >= 0.005) {
      bgm.volume = nextVolume;
      lastAppliedVolume = nextVolume;
    }
  }

  function checkSwap() {
    const wantNight  = isNighttime();
    const hasNight   = isNightBgmTrackSource(bgm.src);
    if (wantNight === hasNight || fadeState !== FADE.IDLE) return;

    if (wantNight) {
      // Sunset: crossfade out then in.
      fadeState    = FADE.OUT;
      fadeTimerMs  = 0;
    } else {
      // Sunrise: immediate snap — no crossfade intended.
      bgm.src = pickRandomBgmDayTrack();
      if (state.musicPlaying) bgm.play().catch(() => {});
    }
  }

  return {
    // Called once by GameRuntime.start() after the DOM is ready.
    init() {
      bgm     = document.getElementById("bgm");
      rooster = document.getElementById("rooster-sfx");
      if (bgm) {
        bgm.src = isNighttime() ? pickRandomBgmNightTrack() : pickRandomBgmDayTrack();
      }
    },

    update(dtMs) {
      if (!bgm) return;

      // Throttled swap check.
      swapCheckCooldownMs -= dtMs;
      if (swapCheckCooldownMs <= 0) {
        swapCheckCooldownMs = BGM_SWAP_CHECK_MS;
        checkSwap();
      }

      // Fade machine — three-state, linear.
      let fadeMultiplier = 1.0;

      if (fadeState === FADE.OUT) {
        fadeTimerMs += dtMs;
        fadeMultiplier = 1.0 - clamp01(fadeTimerMs / BGM_FADE_LIMIT_MS);
        if (fadeMultiplier <= 0) {
          bgm.src = isNighttime() ? pickRandomBgmNightTrack() : pickRandomBgmDayTrack();
          if (state.musicPlaying) bgm.play().catch(() => {});
          fadeState   = FADE.IN;
          fadeTimerMs = 0;
        }
      } else if (fadeState === FADE.IN) {
        fadeTimerMs += dtMs;
        fadeMultiplier = clamp01(fadeTimerMs / BGM_FADE_LIMIT_MS);
        if (fadeMultiplier >= 1.0) fadeState = FADE.IDLE;
      }

      applyVolume(fadeMultiplier);
    },

    // Called by processSunriseIfNeeded so it keeps control of rooster timing.
    playRooster() {
      if (rooster && bgm) {
        rooster.volume = clamp01(bgm.volume * 0.8);
        rooster.play().catch(() => {});
      }
    },

    // Expose bgm.volume read-only for the rooster volume calc in playRooster.
    getBgmVolume() {
      return bgm ? bgm.volume : 0;
    },
  };
}

// ---- Runtime context ----
// bgmElement, roosterElement, bgmSwapCheckCooldownMs, and
// lastAppliedBgmVolume are gone — AudioManager owns them now.

function createRuntimeContext() {
  return {
    audio: null,           // AudioManager instance
    ticker: null,          // Ticker instance
    slowUiCooldownMs: 0,
    appDisposers: [],
  };
}
let runtimeCtx = createRuntimeContext();

// ---- Tick ----
// processSunriseIfNeeded still calls runtimeCtx.audio.playRooster()
// directly; no other change to sunrise logic needed.

function tick(dtMs) {
  advanceGameClock(dtMs);
  updateSunriseTransition(dtMs);
  runtimeCtx.audio.update(dtMs);   // replaces updateBgmForTimeOfDay
  processSunriseIfNeeded();
  wrapDayIfNeeded();
  runCropSimulation(dtMs);
  updateHudOnCooldown();
  tickDog(dtMs);
}

// ---- Render pass ----
// Called once per display frame, after all logic ticks.
// Must only read state — never write to it.

function renderFrame() {
  renderAll();
  syncBodyNightClass();
  renderDog();
}

function syncBodyNightClass() {
  const wantNight = typeof isNighttime === "function" && isNighttime();
  document.body.classList.toggle("body--night", wantNight);
}

function advanceGameClock(dtMs) {
  state.dayElapsedMs += dtMs;
  runtimeCtx.slowUiCooldownMs -= dtMs;
}

function updateSunriseTransition(dtMs) {
  if (state.sunriseTransitionMsRemaining > 0) {
    state.sunriseTransitionMsRemaining -= dtMs;
    if (state.sunriseTransitionMsRemaining <= 0) {
      state.sunriseTransitionMsRemaining = 0;
      state.sunriseTransition = false;
      emitUiSync({ shop: true, weatherMachine: true });
    }
  }
}

function processSunriseIfNeeded() {
  if (state.roosterPlayedToday || state.dayElapsedMs < ROOSTER_THRESHOLD_MS) return;
  state.roosterPlayedToday = true;
  state.sunriseTransition = true;
  state.sunriseTransitionMsRemaining = SUNRISE_TRANSITION_MS;

  runtimeCtx.audio.playRooster();

  const prevWeather = state.weatherId;
  maybeChangeWeatherAtSunrise();
  applyWeatherMachineAtSunrise();
  emitUiSync({ weatherMachine: true });

  const nextWeather = state.weatherId;
  const isSwap = prevWeather !== nextWeather;

  // Apply wetness shift first so any newly-flooded/deserted tiles are visible
  // to applyTerrainSpread, which then propagates the muddy/arid neighbour conversion.
  if (nextWeather === "stormy") {
    applyWeatherWetnessShift(20, +1);
  } else if (nextWeather === "rainy") {
    applyWeatherWetnessShift(10, +1);
  } else if (nextWeather === "sunny") {
    applyWeatherWetnessShift(10, -1);
  } else if (nextWeather === "drought") {
    applyWeatherWetnessShift(20, -1);
  }
  // cloudy: no wetness change

  applyTerrainSpread();
  updateWaterAdjacency();
  enforceHazardPlantValidity();
  setWeatherTheme();
  emitUiSync({ shop: true, highlights: true });
}

function wrapDayIfNeeded() {
  if (state.dayElapsedMs >= MS_PER_DAY) {
    state.dayElapsedMs -= MS_PER_DAY;
    state.day += 1;
    state.roosterPlayedToday = false;
    resetDogMorningRoam();
  }
}

function runCropSimulation(dtMs) {
  growAllCrops(dtMs);
  updateRotAndBlack(dtMs);
}

function updateHudOnCooldown() {
  if (runtimeCtx.slowUiCooldownMs <= 0) {
    runtimeCtx.slowUiCooldownMs = HUD_UPDATE_COOLDOWN_MS;
    emitUiSync({ hud: true });
  }
}

// ---- Game initialisation ----

function initGame() {
  state.tiles = createInitialTiles();
  state.weatherId = weatherForDay();
  state.weatherMachineSelection = state.weatherId;
  buildGridDom();
  applyRandomFieldStart();
  bindUi();
  updateHud();
  setWeatherTheme();
  renderAll(true);
  updateHighlights();
  initDog();
}

// ---- Runtime module ----

const GameRuntime = (() => {
  let started = false;

  function registerDisposer(fn) {
    if (typeof fn === "function") runtimeCtx.appDisposers.push(fn);
  }

  function disposeDisposers() {
    while (runtimeCtx.appDisposers.length) {
      try { runtimeCtx.appDisposers.pop()(); } catch (_) {}
    }
  }

  function start() {
    if (started) return;
    started = true;
    runtimeCtx = createRuntimeContext();
    runtimeCtx.audio  = createAudioManager();
    runtimeCtx.audio.init();       // resolve DOM elements once, up front
    runtimeCtx.ticker = createTicker(tick);
    initGame();
    registerDisposer(() => runtimeCtx.ticker.stop());
    runtimeCtx.ticker.start();
  }

  function stop() {
    if (!started) return;
    started = false;
    runtimeCtx.ticker?.stop();
    disposeDisposers();
  }

  function restart() { stop(); start(); }
  function isStarted() { return started; }

  return { start, stop, restart, dispose: stop, isStarted, registerDisposer, disposeDisposers };
})();

window.WfGameRuntime = GameRuntime;
window.wfRegisterAppDisposer = (fn) => GameRuntime.registerDisposer(fn);
window.wfDisposeApp = () => GameRuntime.disposeDisposers();
window.GameRuntime = window.WfGameRuntime;
window.registerAppDisposer = window.wfRegisterAppDisposer;
window.disposeApp = window.wfDisposeApp;
GameRuntime.start();
