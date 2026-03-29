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
    { value: "sun", weight: 0.62 },
    { value: "rain", weight: 0.38 },
  ]);
}

function weatherIcon(weatherId) {
  if (weatherId === "rain") return "🌧️";
  return "☀️";
}

function maybeChangeWeatherAtSunrise() {
  if (Math.random() >= NATURAL_WEATHER_FLIP_CHANCE) return;
  state.weatherId = state.weatherId === "sun" ? "rain" : "sun";
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

function isAdjacentToWaterlogged(x, y) {
  // Checks for wet neighbors (muddy or flooded) — used for watercress planting rules.
  // Avoid allocations in a hot path: check 4 neighbors directly.
  let nx = x + 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && (tile.terrain === "flooded" || tile.terrain === "muddy")) return true;
  }

  nx = x - 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && (tile.terrain === "flooded" || tile.terrain === "muddy")) return true;
  }

  let ny = y + 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && (tile.terrain === "flooded" || tile.terrain === "muddy")) return true;
  }

  ny = y - 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && (tile.terrain === "flooded" || tile.terrain === "muddy")) return true;
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
    tile.isAdjacentToWater = isAdjacentToWaterlogged(x, y);
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
      if (terrain !== "muddy" && !isAdjacentToWaterlogged(x, y)) {
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

function addWaterloggedCells(addCount) { addTerrainCells("flooded", addCount); }
function addScorchedCells(addCount)    { addTerrainCells("arid",        addCount); }

/**
 * Terrain spread rules applied each sunrise:
 * - A grassy tile with 3+ neighbours sharing the same terrain becomes that terrain.
 * - Any tile with 3+ desert neighbours becomes desert.
 * - Any tile with 3+ flooded neighbours becomes flooded.
 * Desert/flooded spread takes priority over the grassy-spread rule.
 * Changes are collected first so one pass cannot cascade into the next.
 */
function applyTerrainSpread() {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const changes = []; // { idx, terrain }

  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field") continue;

    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);

    // Count the terrain of the (up to 4) field neighbours.
    const counts = {};
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!isField(nx, ny)) continue;
      const t = state.tiles[tileIndex(nx, ny)].terrain;
      counts[t] = (counts[t] || 0) + 1;
    }

    const cur = tile.terrain;

    // Hazard spread (any tile): 3+ desert or flooded neighbours convert the tile.
    if (cur !== "desert" && (counts["desert"] || 0) >= 3) {
      changes.push({ idx, terrain: "desert" });
      continue;
    }
    if (cur !== "flooded" && (counts["flooded"] || 0) >= 3) {
      changes.push({ idx, terrain: "flooded" });
      continue;
    }

    // Grassy spread: a grassy tile converts to whichever terrain has 3+ neighbours.
    if (cur === "grassy") {
      for (const [terrain, count] of Object.entries(counts)) {
        if (count >= 3) {
          changes.push({ idx, terrain });
          break;
        }
      }
    }
  }

  for (const { idx, terrain } of changes) {
    const tile = state.tiles[idx];
    tile.terrain = terrain;
    tile.crop = null;
    tile.readyRotMsRemaining = 0;
    tile.blackMsRemaining = 0;
    markTileDirtySafe(idx);
  }
}

/**
 * Randomises the inner field for a new game: hazard tiles matching current weather,
 * then a light scatter of valid crops (progress capped for variety).
 * Must run after state.weatherId is set and before the grid DOM is built.
 */
function applyRandomFieldStart() {
  // TEST: spawn 10 tiles of each terrain type at game start
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

  const weatherDef = WEATHER[state.weatherId] ?? WEATHER.sun;
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
    if (cropDef.adjacentWaterloggedGrowthMultiplier) {
      if (tile.isAdjacentToWater) {
        envMult *= cropDef.adjacentWaterloggedGrowthMultiplier;
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
