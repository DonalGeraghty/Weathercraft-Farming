let bgmElementCache = null;
let rainElementCache = null;
let sunAmbienceElementCache = null;
let gameWrapElementCache = null;

function isNightBgmTrackSource(src) {
  return String(src || "").toLowerCase().includes("music-night-");
}

function getBgmBase() {
  if (!bgmElementCache) bgmElementCache = document.getElementById("bgm");
  const bgm = bgmElementCache;
  if (bgm && bgm.src) {
    // Determine the base volume by asking what track is actually playing right now.
    // This prevents the 3.0x multiplier jumping in instantly at 10pm while the day music is still fading out.
    return isNightBgmTrackSource(bgm.src) ? NIGHT_BGM_MIX : DAY_BGM_MIX;
  }
  return (typeof isNighttime === 'function' && isNighttime()) ? NIGHT_BGM_MIX : DAY_BGM_MIX;
}

function syncWeatherAmbience() {
  if (!bgmElementCache) bgmElementCache = document.getElementById("bgm");
  if (!rainElementCache) rainElementCache = document.getElementById("rain-sfx");
  if (!sunAmbienceElementCache) sunAmbienceElementCache = document.getElementById("sunny-sfx");
  const bgm = bgmElementCache;
  const rain = rainElementCache;
  const sun = sunAmbienceElementCache;
  if (!rain || !sun || !bgm) return;

  const wantRain = state.weatherId === "rain";
  const wantSun = state.weatherId === "sun";
  const musicGoing = !bgm.paused && !bgm.muted && bgm.volume > 0;

  // Read the original master volume before the BGM reduction
  const base = getBgmBase();
  const masterVol = base > 0 ? bgm.volume / base : 0;

  // Set volumes independently
  rain.volume = clamp01(masterVol * RAIN_SFX_MIX);
  sun.volume = clamp01(masterVol * SUN_SFX_MIX);

  if (wantRain && musicGoing) {
    rain.play().catch(() => {});
  } else {
    rain.pause();
  }

  if (wantSun && musicGoing) {
    sun.play().catch(() => {});
  } else {
    if (!sun.paused) {
      sun.pause();
    }
  }
}

function setWeatherTheme() {
  if (!gameWrapElementCache) gameWrapElementCache = document.querySelector(".game-wrap");
  const wrap = gameWrapElementCache;
  if (!wrap) return;
  wrap.classList.toggle("weather--rain", state.weatherId === "rain");
  syncWeatherAmbience();
}

