function init() {
  state.tiles = createInitialTiles();
  state.weatherId = weatherForDay();
  state.weatherMachineSelection = state.weatherId;
  buildGridDom();
  bindUi();
  updateHud();
  setWeatherTheme();
  renderAll();
  updateHighlights();
  updateWaterAdjacency();
  startLoop();
}

let bgmElMain, roosterElMain, musicVolElMain;

function startLoop() {
  let lastFrameTime = performance.now();

  // Target 60 FPS for smoothness while capping CPU on high-refresh monitors.
  const TARGET_FPS = 60;
  const FRAME_MIN_TIME_MS = 1000 / TARGET_FPS;
  let simAccumulator = 0;

  function frame(now) {
    const deltaMs = now - lastFrameTime;

    // Skip frame if we are ahead of our TARGET_FPS interval.
    if (deltaMs < FRAME_MIN_TIME_MS) {
      requestAnimationFrame(frame);
      return;
    }

    lastFrameTime = now;

    if (!state.paused) {
      simAccumulator += deltaMs;
      
      let ticksPerformed = 0;
      // Fixed-step simulation: catch up if needed, but throttle to FRAME_MIN_TIME_MS steps.
      while (simAccumulator >= FRAME_MIN_TIME_MS) {
        tick(FRAME_MIN_TIME_MS);
        simAccumulator -= FRAME_MIN_TIME_MS;
        ticksPerformed++;
      }

      // Render the result.
      if (ticksPerformed > 0) {
        updateHud();
        renderAll();
      }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function tick(dtMs) {
  state.msIntoDay += dtMs;

  // Handle Sunrise Transition Countdown
  if (state.sunriseTransitionMsRemaining > 0) {
    state.sunriseTransitionMsRemaining -= dtMs;
    if (state.sunriseTransitionMsRemaining <= 0) {
      state.sunriseTransitionMsRemaining = 0;
      state.sunriseTransition = false;
      updateShopInfo(); // Re-enable shop buttons and update UI feedback
      updateWeatherMachineUi();
    }
  }

  if (!bgmElMain) bgmElMain = document.getElementById("bgm");
  const bgm = bgmElMain;
  if (bgm) {
    const wantNightSrc = isNighttime();
    const hasNightSrc = bgm.src.includes("Night");
    const FADE_LIMIT_MS = 5000;

    // Trigger fade array if a swap is needed and we are not currently transitioning
    if (wantNightSrc !== hasNightSrc && state.bgmFadeState === "idle") {
      if (wantNightSrc) {
        // Sunset: Crossfade
        state.bgmFadeState = "fadeOut";
        state.bgmFadeTimerMs = 0;
      } else {
        // Sunrise: Immediate snap (INTENDED: No crossfade during sunrise transition).
        bgm.src = "./assets/audio/Music%20-%20Day%2001.mp3";
        if (!bgm.paused) bgm.play().catch(() => {});
      }
    }

    // Process fading animation
    let fadeMultiplier = 1.0;
    if (state.bgmFadeState === "fadeOut") {
      state.bgmFadeTimerMs += dtMs;
      fadeMultiplier = 1.0 - clamp01(state.bgmFadeTimerMs / FADE_LIMIT_MS);
      if (fadeMultiplier <= 0) {
        bgm.src = wantNightSrc ? "./assets/audio/Music%20-%20Night%2001.mp3" : "./assets/audio/Music%20-%20Day%2001.mp3";
        state.bgmFadeState = "fadeIn";
        state.bgmFadeTimerMs = 0;
        if (!bgm.paused) bgm.play().catch(() => {});
      }
    } else if (state.bgmFadeState === "fadeIn") {
      state.bgmFadeTimerMs += dtMs;
      fadeMultiplier = clamp01(state.bgmFadeTimerMs / FADE_LIMIT_MS);
      if (fadeMultiplier >= 1.0) {
        state.bgmFadeState = "idle";
      }
    }

    if (!musicVolElMain) musicVolElMain = document.getElementById("musicVolume");
    const musicVolumeInput = musicVolElMain;
    const volumePercent = musicVolumeInput ? (Number(musicVolumeInput.value) || 0) : 10;
    bgm.volume = clamp01((volumePercent / 100) * getBgmBase() * fadeMultiplier);
  }

  // 7 AM: rooster crow + daily weather transitions.
  const roosterThreshold = (7 / 24) * MS_PER_DAY;
  if (!state.roosterPlayedToday && state.msIntoDay >= roosterThreshold) {
    state.roosterPlayedToday = true;
    state.sunriseTransition = true;
    state.sunriseTransitionMsRemaining = 2000;

    if (!roosterElMain) roosterElMain = document.getElementById("roosterSfx");
    const rooster = roosterElMain;
    if (rooster && bgm) {
      rooster.volume = clamp01(bgm.volume * 0.8);
      rooster.play().catch(() => {});
    }

    const prevWeather = state.weatherId;
    maybeChangeWeatherAtSunrise();
    applyWeatherMachineAtSunrise();
    updateWeatherMachineUi();

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
    updateShopInfo();
    updateHighlights();
    renderAll();
  }

  if (state.msIntoDay >= MS_PER_DAY) {
    state.msIntoDay -= MS_PER_DAY;
    state.day += 1;
    state.roosterPlayedToday = false;
  }

  growAllCrops(dtMs);
  updateRotAndBlack(dtMs);
}

init();


