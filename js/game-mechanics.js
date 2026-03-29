// ---- Generic utilities ----

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function shuffleArrayInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  return items;
}

// ---- Grid primitives ----

function isField(x, y) {
  return x >= 1 && x <= FIELD_SIZE && y >= 1 && y <= FIELD_SIZE;
}

function tileIndex(x, y) {
  return y * WORLD_SIZE + x;
}

// ---- Crop primitives ----

function cropStage(progress) {
  if (progress < 0.25) return "seed";
  if (progress < 1) return "sprout";
  return "grown";
}

// ---- Clock ----

function formatTimeOfDay(dayElapsedMs) {
  const totalMinutes = Math.floor((dayElapsedMs / MS_PER_DAY) * 24 * 60);
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12} ${suffix}`;
}

/** 
 * Returns true if the clock is between 10 PM and 7 AM.
 * This is a 9-hour window, leaving 15 hours of daylight for growing crops.
 */
function isNighttime() {
  const totalMinutes = Math.floor((state.dayElapsedMs / MS_PER_DAY) * 24 * 60);
  const h24 = Math.floor(totalMinutes / 60) % 24;
  return h24 >= 22 || h24 < 7;
}

// ---- Weather ----

function weightedChoice(items) {
  const totalWeight = items.reduce((acc, item) => acc + item.weight, 0);
  let remaining = Math.random() * totalWeight;
  for (const item of items) {
    remaining -= item.weight;
    if (remaining <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function weatherForDay() {
  return weightedChoice([
    { value: "stormy",  weight: 0.2 },
    { value: "rainy",   weight: 0.2 },
    { value: "cloudy",  weight: 0.2 },
    { value: "sunny",   weight: 0.2 },
    { value: "drought", weight: 0.2 },
  ]);
}

function weatherIcon(weatherId) {
  return WEATHER[weatherId]?.icon ?? "☀️";
}

function maybeChangeWeatherAtSunrise() {
  const idx = WEATHER_PROGRESSION.indexOf(state.weatherId);
  const isExtreme = idx === 0 || idx === WEATHER_PROGRESSION.length - 1;
  const roll = Math.random();
  if (isExtreme) {
    // 33% stay, 66% move one step inward
    if (roll >= 1 / 3) {
      state.weatherId = WEATHER_PROGRESSION[idx === 0 ? 1 : idx - 1];
    }
  } else {
    // 33% decrease (toward stormy), 33% stay, 33% increase (toward drought)
    if (roll < 1 / 3) {
      state.weatherId = WEATHER_PROGRESSION[idx - 1];
    } else if (roll >= 2 / 3) {
      state.weatherId = WEATHER_PROGRESSION[idx + 1];
    }
  }
}

function getEffectiveWeatherChangeChance() {
  return clamp01(WEATHER_CHANGE_CHANCE_PER_EURO * (state.weatherMachineSpendCommitted ?? 0));
}

function applyWeatherMachineAtSunrise() {
  const target = state.weatherMachineSelection;
  if (target === state.weatherId) {
    // Nothing to do; still consume the committed spend for UI consistency.
    state.weatherMachineSpendCommitted = 0;
    return;
  }

  const chance = getEffectiveWeatherChangeChance();
  if (Math.random() < chance) {
    state.weatherId = target;
  }
  // Spend is consumed at sunrise.
  state.weatherMachineSpendCommitted = 0;
}

// ---- Tile and hazard mechanics ----

function isAdjacentToWetTerrain(x, y) {
  // Checks for wet neighbors (muddy or flooded) — used for watercress planting rules.
  // Avoid allocations in a hot path: check 4 neighbors directly.
  let nx = x + 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && TERRAIN[tile.terrain]?.wetness >= 3) return true;
  }

  nx = x - 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && TERRAIN[tile.terrain]?.wetness >= 3) return true;
  }

  let ny = y + 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && TERRAIN[tile.terrain]?.wetness >= 3) return true;
  }

  ny = y - 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && TERRAIN[tile.terrain]?.wetness >= 3) return true;
  }

  return false;
}

function updateWaterAdjacency() {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field") continue;
    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);
    // isAdjacentToWater is true when a neighbor is muddy or flooded.
    tile.isAdjacentToWater = isAdjacentToWetTerrain(x, y);
  }
}

function markTileDirtySafe(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  tile.dirty = true;
  if (typeof markTileDirty === "function") markTileDirty(idx);
}

function enforceHazardPlantValidity() {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field" || !tile.crop) continue;

    if (tile.blackMsRemaining > 0) {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      markTileDirtySafe(idx);
      continue;
    }

    const terrain = tile.terrain;
    const cropId = tile.crop.cropId;

    // Desert and flooded kill everything.
    if (terrain === "desert" || terrain === "flooded") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      markTileDirtySafe(idx);
      continue;
    }

    // Arid kills everything except cactusfruit.
    if (terrain === "arid" && cropId !== "cactusfruit") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      markTileDirtySafe(idx);
      continue;
    }

    // Muddy kills cactusfruit.
    if (terrain === "muddy" && cropId === "cactusfruit") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      markTileDirtySafe(idx);
      continue;
    }

    // Cactusfruit can only grow on arid soil.
    if (cropId === "cactusfruit" && terrain !== "arid") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      markTileDirtySafe(idx);
      continue;
    }

    // Watercress: can grow on muddy directly, or on grassy if adjacent to a wet tile.
    if (cropId === "watercress") {
      const x = idx % WORLD_SIZE;
      const y = Math.floor(idx / WORLD_SIZE);
      if (TERRAIN[terrain]?.wetness < 3 && !isAdjacentToWetTerrain(x, y)) {
        tile.crop = null;
        tile.readyRotMsRemaining = 0;
        markTileDirtySafe(idx);
      }
    }
  }
}

/**
 * Sets `addCount` randomly-chosen eligible field tiles to the given terrain type.
 * The "opposite" terrain group (wet vs dry) is cleared within 2 tiles of each new cell.
 */
function addTerrainCells(terrain, addCount) {
  if (addCount <= 0) return;

  const candidates = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (tile.terrain === terrain) continue; // already this terrain
    candidates.push(i);
  }

  shuffleArrayInPlace(candidates);

  for (const idx of candidates.slice(0, addCount)) {
    const tile = state.tiles[idx];
    tile.terrain = terrain;
    tile.crop = null;              // destroys any crop
    tile.readyRotMsRemaining = 0;
    tile.blackMsRemaining = 0;
    markTileDirtySafe(idx);
  }
}

// Shifts the wetness of `count` random field tiles by `direction` (+1 or -1).
// Tiles already at the limit in that direction (flooded when +1, desert when -1) are skipped.
function applyWeatherWetnessShift(count, direction) {
  const skipTerrain = direction > 0 ? "flooded" : "desert";
  const candidates = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (tile.terrain === skipTerrain) continue;
    candidates.push(i);
  }

  shuffleArrayInPlace(candidates);

  for (const idx of candidates.slice(0, count)) {
    const tile = state.tiles[idx];
    const newWetness = TERRAIN[tile.terrain].wetness + direction;
    tile.terrain = TERRAIN_BY_WETNESS[newWetness];
    tile.blackMsRemaining = 0;
    markTileDirtySafe(idx);
  }
}

/**
 * Terrain spread rules applied each sunrise, based on current weather:
 *
 * Stormy/Rainy:
 *   1. Repeatedly convert any non-flooded tile with 3+ flooded neighbours to flooded
 *      until no more conversions occur.
 *   2. Any non-flooded tile adjacent to a flooded tile becomes muddy.
 *
 * Sunny/Drought:
 *   1. Repeatedly convert any non-desert tile with 3+ desert neighbours to desert
 *      until no more conversions occur.
 *   2. Any non-desert tile adjacent to a desert tile becomes arid.
 *
 * Cloudy: no spread.
 *
 * Crop clearing after terrain changes is handled by enforceHazardPlantValidity(),
 * which is called by the sunrise sequence immediately after this function.
 */
function applyTerrainSpread() {
  const weather = state.weatherId;
  if (weather === "cloudy") return;

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function countNeighbors(idx, terrainId) {
    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);
    let n = 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (isField(nx, ny) && state.tiles[tileIndex(nx, ny)].terrain === terrainId) n++;
    }
    return n;
  }

  // Phase 1: batch-convert tiles with 3+ hazard neighbours, repeat until stable.
  function spreadHazard(hazardTerrain) {
    let anyConverted = true;
    while (anyConverted) {
      anyConverted = false;
      const batch = [];
      for (let idx = 0; idx < state.tiles.length; idx++) {
        const tile = state.tiles[idx];
        if (tile.kind !== "field" || tile.terrain === hazardTerrain) continue;
        if (countNeighbors(idx, hazardTerrain) >= 3) batch.push(idx);
      }
      for (const idx of batch) {
        state.tiles[idx].terrain = hazardTerrain;
        markTileDirtySafe(idx);
        anyConverted = true;
      }
    }
  }

  if (weather === "stormy" || weather === "rainy") {
    spreadHazard("flooded");
    // Phase 2: tiles adjacent to flooded shift +1 wetness (capped at muddy; flooded is phase 1).
    const toWetter = [];
    for (let idx = 0; idx < state.tiles.length; idx++) {
      const tile = state.tiles[idx];
      if (tile.kind !== "field" || tile.terrain === "flooded") continue;
      if (countNeighbors(idx, "flooded") >= 1) toWetter.push(idx);
    }
    for (const idx of toWetter) {
      const w = TERRAIN[state.tiles[idx].terrain].wetness;
      state.tiles[idx].terrain = TERRAIN_BY_WETNESS[Math.min(w + 1, 3)];
      markTileDirtySafe(idx);
    }
  } else if (weather === "sunny" || weather === "drought") {
    spreadHazard("desert");
    // Phase 2: tiles adjacent to desert shift -1 wetness (capped at arid; desert is phase 1).
    const toDrier = [];
    for (let idx = 0; idx < state.tiles.length; idx++) {
      const tile = state.tiles[idx];
      if (tile.kind !== "field" || tile.terrain === "desert") continue;
      if (countNeighbors(idx, "desert") >= 1) toDrier.push(idx);
    }
    for (const idx of toDrier) {
      const w = TERRAIN[state.tiles[idx].terrain].wetness;
      state.tiles[idx].terrain = TERRAIN_BY_WETNESS[Math.max(w - 1, 1)];
      markTileDirtySafe(idx);
    }
  }
}

/**
 * Randomises the inner field for a new game: hazard tiles matching current weather,
 * then a light scatter of valid crops (progress capped for variety).
 * Must run after state.weatherId is set and before the grid DOM is built.
 */
function applyRandomFieldStart() {
  addTerrainCells("arid",        10);
  addTerrainCells("desert",      10);
  addTerrainCells("muddy",       10);
  addTerrainCells("flooded", 10);
  updateWaterAdjacency();

  const indices = [];
  for (let y = 1; y <= FIELD_SIZE; y++) {
    for (let x = 1; x <= FIELD_SIZE; x++) {
      indices.push(tileIndex(x, y));
    }
  }
  shuffleArrayInPlace(indices);

  for (const idx of indices) {
    const tile = state.tiles[idx];
    if (tile.crop) continue;
    if (tile.blackMsRemaining > 0) continue;
    if (Math.random() >= INITIAL_FIELD_CROP_FILL_CHANCE) continue;

    const progress = Math.random() * INITIAL_FIELD_MAX_PROGRESS;

    if (tile.terrain === "flooded" || tile.terrain === "desert") continue;

    if (tile.terrain === "arid") {
      if (Math.random() < INITIAL_FIELD_SCORCHED_CACTUS_CHANCE) {
        tile.crop = { cropId: "cactusfruit", progress };
        tile.readyRotMsRemaining = 0;
      }
      continue;
    }

    if (tile.isAdjacentToWater && Math.random() < INITIAL_FIELD_WATERCRESS_BIAS) {
      tile.crop = { cropId: "watercress", progress };
    } else {
      const basic = ["carrot", "onion", "cabbage"];
      const cropId = basic[Math.floor(Math.random() * basic.length)];
      tile.crop = { cropId, progress };
    }
    tile.readyRotMsRemaining = 0;
  }

  enforceHazardPlantValidity();
}

// ---- Crop simulation ----

function growAllCrops(dtMs) {
  if (isNighttime()) return;

  // A "growth day" is defined as the 15 hours of daylight (7 AM to 10 PM).
  // This ensures that 'daysToGrow' in constants.js refers to calendar days.
  const MS_PER_GROWTH_DAY = (15 / 24) * MS_PER_DAY;
  const growthThisTick = dtMs / MS_PER_GROWTH_DAY;

  const weatherDef = WEATHER[state.weatherId] ?? WEATHER.sunny;
  const globalMultiplier = weatherDef.growthMultiplier;

  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field" || !tile.crop) continue;
    const cropDef = CROPS[tile.crop.cropId];
    if (!cropDef) continue;

    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);

    const daysToGrow = cropDef.daysToGrow > 0 ? cropDef.daysToGrow : 10;
    const growthPerDay = 1 / daysToGrow;
    const cropWeatherMult = cropDef.weatherGrowthMultipliers?.[state.weatherId] ?? 1;

    // Environment effects (wet adjacency / arid on-tile).
    let envMult = 1;
    if (cropDef.adjacentFloodedGrowthMultiplier) {
      if (tile.isAdjacentToWater) {
        envMult *= cropDef.adjacentFloodedGrowthMultiplier;
      }
    }
    if (cropDef.aridGrowthMultiplier) {
      if (tile.terrain === "arid") envMult *= cropDef.aridGrowthMultiplier;
    }

    const oldProgress = tile.crop.progress;
    const oldStage = cropStage(oldProgress);
    const oldPercent = Math.floor(oldProgress * 100);

    const progressDelta = growthPerDay * globalMultiplier * cropWeatherMult * envMult * growthThisTick;
    const newProgress = clamp01(oldProgress + progressDelta);
    tile.crop.progress = newProgress;

    const newStage = cropStage(newProgress);
    const newPercent = Math.floor(newProgress * 100);

    if (newStage !== oldStage || newPercent !== oldPercent) {
      markTileDirtySafe(idx);
    }
  }
}

function updateRotAndBlack(dtMs) {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field") continue;

    // Black tiles count down and block planting.
    if (tile.blackMsRemaining > 0) {
      const oldVal = tile.blackMsRemaining;
      tile.blackMsRemaining -= dtMs;
      if (tile.blackMsRemaining < 0) tile.blackMsRemaining = 0;
      if (tile.blackMsRemaining === 0 && oldVal > 0) markTileDirtySafe(idx);

      // If a tile is black, it should never contain a crop.
      if (tile.crop) {
        tile.crop = null;
        tile.readyRotMsRemaining = 0;
        // already set dirty above
      }
      continue;
    }

    // If there is no crop, there's no rotting timer.
    if (!tile.crop) {
      tile.readyRotMsRemaining = 0;
      continue;
    }

    const isReady = tile.crop.progress >= 1;
    if (!isReady) {
      tile.readyRotMsRemaining = 0;
      continue;
    }

    // When a crop becomes ready, start the timer but don't decrement on the same update.
    if (tile.readyRotMsRemaining <= 0) {
      tile.readyRotMsRemaining = MS_PER_DAY;
      continue;
    }

    tile.readyRotMsRemaining -= dtMs;
    if (tile.readyRotMsRemaining <= 0) {
      // Rot: crop disappears and the tile becomes black for 1 in-game day.
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      tile.blackMsRemaining = MS_PER_DAY;
      markTileDirtySafe(idx);
    }
  }
}
