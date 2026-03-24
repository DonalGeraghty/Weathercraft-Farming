function initGame() {
  state.tiles = createInitialTiles();
  state.weatherId = weatherForDay();
  state.weatherMachineSelection = state.weatherId;
  buildGridDom();
  bindUi();
  updateHud();
  setWeatherTheme();
  renderAll(true);
  updateHighlights();
  updateWaterAdjacency();
  // ---- Dog ----
  initDog();
}

function createRuntimeContext() {
  return {
    bgmElement: null,
    roosterElement: null,
    bgmSwapCheckCooldownMs: 0,
    slowUiCooldownMs: 0,
    lastAppliedBgmVolume: -1,
    appDisposers: [],
  };
}
let runtimeCtx = createRuntimeContext();

function registerAppDisposer(disposeFn) {
  if (window.WfGameRuntime?.registerDisposer) {
    window.WfGameRuntime.registerDisposer(disposeFn);
    return;
  }
  // Fallback for very early calls before runtime is attached.
  if (typeof disposeFn === "function") runtimeCtx.appDisposers.push(disposeFn);
}

function disposeApp() {
  if (window.WfGameRuntime?.disposeDisposers) {
    window.WfGameRuntime.disposeDisposers();
    return;
  }
  while (runtimeCtx.appDisposers.length) {
    const disposeFn = runtimeCtx.appDisposers.pop();
    try {
      disposeFn();
    } catch (_) {}
  }
}

function isNightBgmTrackSourceMain(src) {
  return String(src || "").toLowerCase().includes("music-night-");
}

function startLoop() {
  let rafId = 0;
  let running = true;
  let lastFrameTime = performance.now();
  let lastRenderTime = lastFrameTime;
  let pageHidden = document.hidden;

  // Target 60 FPS for smoothness while capping CPU on high-refresh monitors.
  const TARGET_FPS = 60;
  const FRAME_MIN_TIME_MS = 1000 / TARGET_FPS;
  const TARGET_RENDER_FPS = 24;
  const RENDER_MIN_TIME_MS = 1000 / TARGET_RENDER_FPS;
  const MAX_TICKS_PER_FRAME = 2;
  const MAX_ACCUMULATED_MS = FRAME_MIN_TIME_MS * MAX_TICKS_PER_FRAME;
  const MAX_DELTA_MS = 250;
  let simAccumulator = 0;

  const onVisibilityChange = () => {
    pageHidden = document.hidden;
    if (pageHidden) {
      // Drop pending catch-up work while hidden to reduce background CPU spikes.
      simAccumulator = 0;
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  registerAppDisposer(() => document.removeEventListener("visibilitychange", onVisibilityChange));

  function frame(now) {
    if (!running) return;
    const rawDeltaMs = now - lastFrameTime;
    const deltaMs = Math.min(rawDeltaMs, MAX_DELTA_MS);

    // Skip frame if we are ahead of our TARGET_FPS interval.
    if (deltaMs < FRAME_MIN_TIME_MS) {
      rafId = requestAnimationFrame(frame);
      return;
    }

    lastFrameTime = now;

    if (!state.paused && !pageHidden) {
      simAccumulator += deltaMs;
      // Prevent "spiral of death" where a long frame causes many expensive catch-up ticks.
      simAccumulator = Math.min(simAccumulator, MAX_ACCUMULATED_MS);
      
      let ticksPerformed = 0;
      // Fixed-step simulation: catch up if needed, but throttle to FRAME_MIN_TIME_MS steps.
      while (simAccumulator >= FRAME_MIN_TIME_MS && ticksPerformed < MAX_TICKS_PER_FRAME) {
        tick(FRAME_MIN_TIME_MS);
        simAccumulator -= FRAME_MIN_TIME_MS;
        ticksPerformed++;
      }

      // Render only when needed and at a lower frequency than simulation.
      const shouldRender = hasDirtyTiles() || ticksPerformed > 0;
      const renderElapsed = now - lastRenderTime;
      if (shouldRender && renderElapsed >= RENDER_MIN_TIME_MS) {
        renderAll();
        lastRenderTime = now;
      }
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  return () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };
}

function tick(dtMs) {
  advanceGameClock(dtMs);
  updateSunriseTransition(dtMs);
  updateBgmForTimeOfDay(dtMs);
  processSunriseIfNeeded();
  wrapDayIfNeeded();
  runCropSimulation(dtMs);
  updateHudOnCooldown();
  // ---- Dog ----
  tickDog(dtMs);
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
      // Re-enable shop and weather machine controls at transition end.
      emitUiSync({ shop: true, weatherMachine: true });
    }
  }
}

function updateBgmForTimeOfDay(dtMs) {
  if (!runtimeCtx.bgmElement) runtimeCtx.bgmElement = document.getElementById("bgm");
  const bgm = runtimeCtx.bgmElement;
  if (!bgm) return;

  // Throttle BGM source checks; this transition logic does not need per-frame precision.
  runtimeCtx.bgmSwapCheckCooldownMs -= dtMs;
  if (runtimeCtx.bgmSwapCheckCooldownMs <= 0) {
    runtimeCtx.bgmSwapCheckCooldownMs = BGM_SWAP_CHECK_MS;
    const wantNightSrc = isNighttime();
    const hasNightSrc = isNightBgmTrackSourceMain(bgm.src);
    // Trigger fade array if a swap is needed and we are not currently transitioning
    if (wantNightSrc !== hasNightSrc && state.bgmFadeState === "idle") {
      if (wantNightSrc) {
        // Sunset: Crossfade
        state.bgmFadeState = "fadeOut";
        state.bgmFadeTimerMs = 0;
      } else {
        // Sunrise: Immediate snap (INTENDED: No crossfade during sunrise transition).
        bgm.src = "./assets/audio/music-day-01.mp3";
        if (!bgm.paused) bgm.play().catch(() => {});
      }
    }
  }

  // Process fading animation
  let fadeMultiplier = 1.0;
  if (state.bgmFadeState === "fadeOut") {
    state.bgmFadeTimerMs += dtMs;
    fadeMultiplier = 1.0 - clamp01(state.bgmFadeTimerMs / BGM_FADE_LIMIT_MS);
    if (fadeMultiplier <= 0) {
      const wantNightSrc = isNighttime();
      bgm.src = wantNightSrc ? "./assets/audio/music-night-01.mp3" : "./assets/audio/music-day-01.mp3";
      state.bgmFadeState = "fadeIn";
      state.bgmFadeTimerMs = 0;
      if (!bgm.paused) bgm.play().catch(() => {});
    }
  } else if (state.bgmFadeState === "fadeIn") {
    state.bgmFadeTimerMs += dtMs;
    fadeMultiplier = clamp01(state.bgmFadeTimerMs / BGM_FADE_LIMIT_MS);
    if (fadeMultiplier >= 1.0) {
      state.bgmFadeState = "idle";
    }
  }

  const volumePercent = Number(state.musicVolumePercent) || 0;
  const nextBgmVolume = clamp01((volumePercent / 100) * getBgmBase() * fadeMultiplier);
  // Avoid spamming volume writes/events when value is effectively unchanged.
  if (Math.abs(nextBgmVolume - runtimeCtx.lastAppliedBgmVolume) >= 0.005) {
    bgm.volume = nextBgmVolume;
    runtimeCtx.lastAppliedBgmVolume = nextBgmVolume;
  }
}

function processSunriseIfNeeded() {
  if (state.roosterPlayedToday || state.dayElapsedMs < ROOSTER_THRESHOLD_MS) return;
  state.roosterPlayedToday = true;
  state.sunriseTransition = true;
  state.sunriseTransitionMsRemaining = SUNRISE_TRANSITION_MS;

  if (!runtimeCtx.roosterElement) runtimeCtx.roosterElement = document.getElementById("rooster-sfx");
  const rooster = runtimeCtx.roosterElement;
  const bgm = runtimeCtx.bgmElement;
  if (rooster && bgm) {
    rooster.volume = clamp01(bgm.volume * 0.8);
    rooster.play().catch(() => {});
  }

  const prevWeather = state.weatherId;
  maybeChangeWeatherAtSunrise();
  applyWeatherMachineAtSunrise();
  emitUiSync({ weatherMachine: true });

  const nextWeather = state.weatherId;
  const isSwap = prevWeather !== nextWeather;

  if (nextWeather === "rain") {
    addWaterloggedCells(isSwap ? 3 : 5);
  } else {
    addScorchedCells(isSwap ? 3 : 5);
  }

  updateWaterAdjacency();

  enforceHazardPlantValidity();
  setWeatherTheme();
  emitUiSync({ shop: true, highlights: true });
  renderAll();
}

function wrapDayIfNeeded() {
  if (state.dayElapsedMs >= MS_PER_DAY) {
    state.dayElapsedMs -= MS_PER_DAY;
    state.day += 1;
    state.roosterPlayedToday = false;
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

const GameRuntime = (() => {
  let started = false;
  let stopLoop = null;
  function registerDisposer(disposeFn) {
    if (typeof disposeFn === "function") runtimeCtx.appDisposers.push(disposeFn);
  }

  function disposeDisposers() {
    while (runtimeCtx.appDisposers.length) {
      const disposeFn = runtimeCtx.appDisposers.pop();
      try {
        disposeFn();
      } catch (_) {}
    }
  }

  function start() {
    if (started) return;
    started = true;
    runtimeCtx = createRuntimeContext();
    initGame();
    stopLoop = startLoop();
  }

  function stop() {
    if (!started) return;
    started = false;
    if (typeof stopLoop === "function") {
      stopLoop();
      stopLoop = null;
    }
    disposeDisposers();
  }

  function restart() {
    stop();
    start();
  }

  function isStarted() {
    return started;
  }

  return { start, stop, restart, dispose: stop, isStarted, registerDisposer, disposeDisposers };
})();

window.WfGameRuntime = GameRuntime;
window.wfRegisterAppDisposer = (disposeFn) => GameRuntime.registerDisposer(disposeFn);
window.wfDisposeApp = () => GameRuntime.disposeDisposers();
// Backward-compat aliases for existing integrations.
window.GameRuntime = window.WfGameRuntime;
window.registerAppDisposer = window.wfRegisterAppDisposer;
window.disposeApp = window.wfDisposeApp;
GameRuntime.start();
