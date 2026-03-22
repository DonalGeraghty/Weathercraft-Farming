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
  startLoop();
}

function startLoop() {
  let lastFrameTime = performance.now();

  // Fixed-rate simulation + throttled rendering to reduce CPU.
  // The game state changes slowly (day ~= 5 real minutes), so 15-20 FPS is enough.
  const LOOP_INTERVAL_MS = 50; // ~20 ticks + renders/sec
  let simAccumulator = 0;
  let lastRenderTime = 0;

  function frame(now) {
    const deltaMs = now - lastFrameTime;
    lastFrameTime = now;

    if (!state.paused) {
      simAccumulator += deltaMs;
      // Cap simulation work: if the tab was backgrounded, catch up in fixed steps.
      while (simAccumulator >= LOOP_INTERVAL_MS) {
        tick(LOOP_INTERVAL_MS);
        simAccumulator -= LOOP_INTERVAL_MS;
      }

      if (now - lastRenderTime >= LOOP_INTERVAL_MS) {
        lastRenderTime = now;
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

  const bgm = document.getElementById("bgm");
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
        // Sunrise: Immediate snap
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

    const musicVolumeInput = document.getElementById("musicVolume");
    const volumePercent = musicVolumeInput ? (Number(musicVolumeInput.value) || 0) : 10;
    bgm.volume = clamp01((volumePercent / 100) * getBgmBase() * fadeMultiplier);
  }

  // 7 AM: rooster crow + daily weather transitions.
  const roosterThreshold = (7 / 24) * MS_PER_DAY;
  if (!state.roosterPlayedToday && state.msIntoDay >= roosterThreshold) {
    state.roosterPlayedToday = true;
    const rooster = document.getElementById("roosterSfx");
    if (rooster && bgm) {
      rooster.volume = clamp01(bgm.volume * 0.8);
      rooster.play().catch(() => {});
    }

    const prevWeather = state.weatherId;
    applyWeatherMachineAtSunrise();
    // Only apply the natural weather flip if the machine didn't already change it.
    if (state.weatherId === prevWeather) {
      maybeChangeWeatherAtSunrise();
    }
    updateWeatherMachineUi();

    const nextWeather = state.weatherId;
    const isSwap = prevWeather !== nextWeather;

    if (nextWeather === "rain") {
      addWaterloggedCells(isSwap ? 3 : 5);
    } else {
      addScorchedCells(isSwap ? 3 : 5);
    }

    enforceHazardPlantValidity();
    setWeatherTheme();
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


