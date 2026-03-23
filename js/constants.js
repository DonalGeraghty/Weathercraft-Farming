const WORLD_SIZE = 14; // includes path ring
const FIELD_SIZE = 12; // inner farm
const MS_PER_DAY = 100_000; // 100 seconds (1.66 minutes) real time = 1 in-game day

const CROPS = {
  carrot: {
    id: "carrot",
    name: "Carrot",
    daysToGrow: 6,
    weatherGrowthMultipliers: { sun: 1.35, rain: 0.7 },
    seedCost: 3,
    harvestValue: 8,
  },
  onion: {
    id: "onion",
    name: "Onion",
    daysToGrow: 8,
    weatherGrowthMultipliers: { sun: 1.0, rain: 1.0 },
    seedCost: 4,
    harvestValue: 10,
  },
  cabbage: {
    id: "cabbage",
    name: "Cabbage",
    daysToGrow: 10,
    weatherGrowthMultipliers: { sun: 0.7, rain: 1.35 },
    seedCost: 5,
    harvestValue: 13,
  },
  watercress: {
    id: "watercress",
    name: "Watercress",
    daysToGrow: 10,
    weatherGrowthMultipliers: { sun: 1.0, rain: 1.0 },
    seedCost: 6,
    harvestValue: 16,
    // Extra growth when adjacent to waterlogged cells.
    adjacentWaterloggedGrowthMultiplier: 4.0,
  },
  cactusfruit: {
    id: "cactusfruit",
    name: "Cactus Fruit",
    daysToGrow: 10,
    weatherGrowthMultipliers: { sun: 1.0, rain: 1.0 },
    seedCost: 8,
    harvestValue: 22,
    // Extra growth when planted directly on scorched cells.
    scorchedGrowthMultiplier: 3.5,
  },
};

const WEATHER = {
  sun: { id: "sun", name: "Sun", growthMultiplier: 1.0 },
  rain: { id: "rain", name: "Rain", growthMultiplier: 1.35 },
};

// Weather machine: each € committed adds +1% chance to apply the selected weather at sunrise.
const WEATHER_CHANGE_CHANCE_PER_EURO = 0.01;

// The base volume multipliers of the background music.
const DAY_BGM_MIX = 0.8;
const NIGHT_BGM_MIX = 3.0; // Boosted because the night track is mastered quietly

// At each sunrise, sun/rain may flip on its own (in addition to the weather machine).
const NATURAL_WEATHER_FLIP_CHANCE = 0.2;

// Rain ambience loudness relative to the BGM volume slider (0–1 each).
const RAIN_SFX_MIX = 0.42;
const SUN_SFX_MIX = 3.0; // Boosted heavily because the raw audio file is very quiet

const SEED_KEY_ORDER = ["carrot", "onion", "cabbage", "watercress", "cactusfruit"];

