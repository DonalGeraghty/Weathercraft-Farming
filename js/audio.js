let bgmElementCache = null;
let rainElementCache = null;
let sunAmbienceElementCache = null;
let gameWrapElementCache = null;

function isNightBgmTrackSource(src) {
  const s = String(src || "").toLowerCase();
  return s.includes("midnight-orchard-swing");
}

function pickRandomBgmDayTrack() {
  return BGM_DAY_TRACKS[Math.floor(Math.random() * BGM_DAY_TRACKS.length)];
}

function pickRandomBgmNightTrack() {
  return BGM_NIGHT_TRACKS[Math.floor(Math.random() * BGM_NIGHT_TRACKS.length)];
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

  const wantRain = state.weatherId === "rainy" || state.weatherId === "stormy";
  const wantSun = state.weatherId === "sunny" || state.weatherId === "drought";
  // Use state.musicPlaying (explicit user intent) rather than bgm.paused.
  // bgm.paused can be true for transient browser reasons (e.g. src assignment)
  // even when the user has not asked to stop music.
  const musicGoing = state.musicPlaying && !bgm.muted;

  // Derive ambience volumes directly from the user's volume setting, not from
  // bgm.volume (which is mid-transition during fades and gives wrong results).
  const masterVol = clamp01((state.musicVolumePercent || 0) / 100);
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
  for (const id of Object.keys(WEATHER)) {
    wrap.classList.toggle(`weather--${id}`, state.weatherId === id);
  }
  syncWeatherAmbience();
}

