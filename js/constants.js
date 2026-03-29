// ---- World & grid ----

const WORLD_SIZE = 14; // includes path ring
const FIELD_SIZE = 12; // inner farm
const PATH_MIN_X = 0;
const PATH_MIN_Y = 0;
const PATH_MAX_X = WORLD_SIZE - 1;
const PATH_MAX_Y = WORLD_SIZE - 1;
const SHOP_TILE_X = WORLD_SIZE - 1;
const SHOP_TILE_Y = 0;
const WEATHER_MACHINE_TILE_X = WORLD_SIZE - 1;
const WEATHER_MACHINE_TILE_Y = WORLD_SIZE - 1;

// ---- Time ----

const MS_PER_DAY = 100_000; // 100 seconds (1.66 minutes) real time = 1 in-game day
const ROOSTER_THRESHOLD_MS = (7 / 24) * MS_PER_DAY;
const NIGHT_START_MS = (22 / 24) * MS_PER_DAY;
const SUNRISE_TRANSITION_MS = 2000;

// ---- Crops & weather ----

const CROPS = {
  carrot: {
    id: "carrot",
    name: "Carrot",
    daysToGrow: 6,
    weatherGrowthMultipliers: { stormy: 0.5, rainy: 0.7, cloudy: 1.0, sunny: 1.35, drought: 0.9 },
    seedCost: 3,
    harvestValue: 8,
  },
  onion: {
    id: "onion",
    name: "Onion",
    daysToGrow: 8,
    weatherGrowthMultipliers: { stormy: 0.9, rainy: 1.1, cloudy: 1.1, sunny: 0.9, drought: 0.8 },
    seedCost: 4,
    harvestValue: 10,
  },
  cabbage: {
    id: "cabbage",
    name: "Cabbage",
    daysToGrow: 10,
    weatherGrowthMultipliers: { stormy: 1.2, rainy: 1.35, cloudy: 1.1, sunny: 0.7, drought: 0.5 },
    seedCost: 5,
    harvestValue: 13,
  },
  watercress: {
    id: "watercress",
    name: "Watercress",
    daysToGrow: 10,
    weatherGrowthMultipliers: { stormy: 1.0, rainy: 1.0, cloudy: 1.0, sunny: 1.0, drought: 1.0 },
    seedCost: 6,
    harvestValue: 16,
    // Extra growth when adjacent to flooded cells.
    adjacentFloodedGrowthMultiplier: 4.0,
  },
  cactusfruit: {
    id: "cactusfruit",
    name: "Cactus Fruit",
    daysToGrow: 10,
    weatherGrowthMultipliers: { stormy: 0.5, rainy: 0.7, cloudy: 0.9, sunny: 1.2, drought: 1.4 },
    seedCost: 8,
    harvestValue: 22,
    // Extra growth when planted directly on arid soil.
    aridGrowthMultiplier: 3.5,
  },
};

const TERRAIN = {
  desert:  { id: "desert",  wetness: 0 },
  arid:    { id: "arid",    wetness: 1 },
  grassy:  { id: "grassy",  wetness: 2 },
  muddy:   { id: "muddy",   wetness: 3 },
  flooded: { id: "flooded", wetness: 4 },
};

// Indexed by wetness value (0–4): gives the terrain id at that wetness level.
const TERRAIN_BY_WETNESS = ["desert", "arid", "grassy", "muddy", "flooded"];

const WEATHER = {
  // growthMultiplier is currently flat 1.0 across all weather — per-weather scaling may be revisited.
  stormy:  { id: "stormy",  name: "Stormy",  growthMultiplier: 1.0, icon: "⛈️",  cssClass: "text--stormy"  },
  rainy:   { id: "rainy",   name: "Rainy",   growthMultiplier: 1.0, icon: "🌧️",  cssClass: "text--rainy"   },
  cloudy:  { id: "cloudy",  name: "Cloudy",  growthMultiplier: 1.0, icon: "☁️",  cssClass: "text--cloudy"  },
  sunny:   { id: "sunny",   name: "Sunny",   growthMultiplier: 1.0, icon: "☀️",  cssClass: "text--sunny"   },
  drought: { id: "drought", name: "Drought", growthMultiplier: 1.0, icon: "🔥",  cssClass: "text--drought" },
};

// Weather transitions at sunrise follow this progression (adjacent steps only).
const WEATHER_PROGRESSION = ["stormy", "rainy", "cloudy", "sunny", "drought"];

// Weather machine: each € committed adds +1% chance to apply the selected weather at sunrise.
const WEATHER_CHANGE_CHANCE_PER_EURO = 0.01;
const WEATHER_SPEND_UNIT_EUR = 10;

// ---- Audio ----

// Base volume multipliers for background music.
const DAY_BGM_MIX = 0.8;
const NIGHT_BGM_MIX = 3.0; // Boosted because the night track is mastered quietly

// Day/night BGM: one track chosen at random when entering that period (see audio.js).
const BGM_DAY_TRACKS = [
  "./assets/audio/music-cozy-field-sunrise-01.mp3",
  "./assets/audio/music-cozy-field-sunrise-02.mp3",
];
const BGM_NIGHT_TRACKS = [
  "./assets/audio/music-midnight-orchard-swing-01.mp3",
  "./assets/audio/music-midnight-orchard-swing-02.mp3",
  "./assets/audio/music-night-01.mp3",
];

// Rain/sun ambience loudness relative to the BGM volume slider (0–1 each).
const RAIN_SFX_MIX = 0.42;
const SUN_SFX_MIX = 3.0; // Boosted heavily because the raw audio file is very quiet

const BGM_SWAP_CHECK_MS = 250;
const BGM_FADE_LIMIT_MS = 5000;

// ---- UI ----

const SEED_KEY_ORDER = ["carrot", "onion", "cabbage", "watercress", "cactusfruit"];
const HUD_UPDATE_COOLDOWN_MS = 150;

// ---- Events ----

const EVENT_FARMER_MOVED = "farmer:moved";

// ---- Buildings ----

const FARMHOUSE_TILE_X = 0;
const FARMHOUSE_TILE_Y = 0;

const BUILDINGS = [
  { id: "farmhouse", name: "Farmhouse", tileX: FARMHOUSE_TILE_X, tileY: FARMHOUSE_TILE_Y },
];

// ---- Initial field generation ----
// See applyRandomFieldStart in game-mechanics.js.

const INITIAL_FIELD_HAZARD_MIN = 3;
const INITIAL_FIELD_HAZARD_MAX = 5;
// Per eligible field tile: chance to spawn a crop where rules allow (0–1).
const INITIAL_FIELD_CROP_FILL_CHANCE = 0.14;
// Avoid starting many tiles at fully grown so rot timers do not all align.
const INITIAL_FIELD_MAX_PROGRESS = 0.92;
// On scorched tiles, chance to plant cactus fruit instead of leaving empty.
const INITIAL_FIELD_SCORCHED_CACTUS_CHANCE = 0.55;
// When adjacent to flooded tiles, bias toward watercress vs basic crops.
const INITIAL_FIELD_WATERCRESS_BIAS = 0.45;
