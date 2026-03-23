function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function cropStage(progress) {
  if (progress < 0.25) return "seed";
  if (progress < 1) return "sprout";
  return "grown";
}

function isField(x, y) {
  return x >= 1 && x <= FIELD_SIZE && y >= 1 && y <= FIELD_SIZE;
}

function tileIndex(x, y) {
  return y * WORLD_SIZE + x;
}

function formatTimeOfDay(msIntoDay) {
  const totalMinutes = Math.floor((msIntoDay / MS_PER_DAY) * 24 * 60);
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
  const totalMinutes = Math.floor((state.msIntoDay / MS_PER_DAY) * 24 * 60);
  const h24 = Math.floor(totalMinutes / 60) % 24;
  return h24 >= 22 || h24 < 7;
}

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

function isAdjacentToWaterlogged(x, y) {
  // Avoid allocations in a hot path: check 4 neighbors directly.
  let nx = x + 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && tile.waterlogged) return true;
  }

  nx = x - 1;
  if (nx >= 0 && nx < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(nx, y)];
    if (tile?.kind === "field" && tile.waterlogged) return true;
  }

  let ny = y + 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && tile.waterlogged) return true;
  }

  ny = y - 1;
  if (ny >= 0 && ny < WORLD_SIZE) {
    const tile = state.tiles[tileIndex(x, ny)];
    if (tile?.kind === "field" && tile.waterlogged) return true;
  }

  return false;
}

function updateWaterAdjacency() {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field") continue;
    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);
    tile.isAdjacentToWater = isAdjacentToWaterlogged(x, y);
  }
}

/** A field tile may be waterlogged or scorched, never both; waterlogged wins if a save had both. */
function reconcileExclusiveHazards(tile) {
  if (!tile || tile.kind !== "field") return;
  // A tile may only ever be one hazard type; waterlogged takes priority.
  if (tile.waterlogged) {
    if (tile.scorched) {
      tile.scorched = false;
      tile.dirty = true;
    }
  } else if (tile.scorched) {
    if (tile.waterlogged) {
      tile.waterlogged = false;
      tile.dirty = true;
    }
  }
}

function enforceHazardPlantValidity() {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field" || !tile.crop) continue;

    if (tile.blackMsRemaining > 0) {
      if (tile.crop) {
        tile.crop = null;
        tile.readyRotMsRemaining = 0;
        tile.dirty = true;
      }
      continue;
    }

    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);
    const cropId = tile.crop.cropId;

    // Regular crops should never exist on hazards (they would have been destroyed when hazards were created).
    if (cropId !== "cactusfruit" && cropId !== "watercress") {
      if (tile.waterlogged || tile.scorched) {
        tile.crop = null;
        tile.readyRotMsRemaining = 0;
        tile.dirty = true;
      }
      continue;
    }

    if (cropId === "cactusfruit") {
      if (!tile.scorched) {
        tile.crop = null;
        tile.readyRotMsRemaining = 0;
        tile.dirty = true;
      }
      continue;
    }

    // watercress rules:
    // - It can only exist if adjacent to waterlogged cells.
    // - It should not be on scorched or waterlogged cells.
    // (cropId === "watercress" is always true here — the only remaining possibility)
    if (tile.waterlogged || tile.scorched) {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      tile.dirty = true;
      continue;
    }
    if (!isAdjacentToWaterlogged(x, y)) {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      tile.dirty = true;
    }
  }
}

// (Helpers removed: 7AM weather hazard decay disabled)

/**
 * Shared helper: applies `type` hazard ("waterlogged" | "scorched") to `addCount`
 * randomly-chosen eligible field tiles, clearing the opposite hazard on nearby tiles.
 */
function addHazardCells(type, addCount) {
  if (addCount <= 0) return;
  const opposite = type === "waterlogged" ? "scorched" : "waterlogged";

  const candidates = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (tile[type]) continue;       // already this hazard
    candidates.push(i);
  }

  shuffleArrayInPlace(candidates);

  for (const idx of candidates.slice(0, addCount)) {
    const tile = state.tiles[idx];
    tile[type] = true;
    tile[opposite] = false;
    tile.crop = null;              // destroys any vegetables
    tile.readyRotMsRemaining = 0;  // prevents rotting after being destroyed
    tile.blackMsRemaining = 0;     // hazards overwrite rot
    tile.dirty = true;

    // Revert the opposite hazard within 2 tiles of the new cell.
    const centerX = idx % WORLD_SIZE;
    const centerY = Math.floor(idx / WORLD_SIZE);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const neighborX = centerX + dx;
        const neighborY = centerY + dy;
        if (!isField(neighborX, neighborY)) continue;
        const nT = state.tiles[tileIndex(neighborX, neighborY)];
        if (nT[opposite]) {
          nT[opposite] = false;
          nT.dirty = true;
        }
      }
    }
  }
}

function addWaterloggedCells(addCount) { addHazardCells("waterlogged", addCount); }
function addScorchedCells(addCount)    { addHazardCells("scorched",    addCount); }

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

    // Environment effects (waterlogged adjacency / scorched on-tile).
    let envMult = 1;
    if (cropDef.adjacentWaterloggedGrowthMultiplier) {
      if (tile.isAdjacentToWater) {
        envMult *= cropDef.adjacentWaterloggedGrowthMultiplier;
      }
    }
    if (cropDef.scorchedGrowthMultiplier) {
      if (tile.scorched) envMult *= cropDef.scorchedGrowthMultiplier;
    }

    const oldProgress = tile.crop.progress;
    const oldStage = cropStage(oldProgress);
    const oldPercent = Math.floor(oldProgress * 100);

    const dProgress = growthPerDay * globalMultiplier * cropWeatherMult * envMult * growthThisTick;
    const newProgress = clamp01(oldProgress + dProgress);
    tile.crop.progress = newProgress;

    const newStage = cropStage(newProgress);
    const newPercent = Math.floor(newProgress * 100);

    if (newStage !== oldStage || newPercent !== oldPercent) {
      tile.dirty = true;
    }
  }
}

function updateRotAndBlack(dtMs) {
  for (const tile of state.tiles) {
    if (tile.kind !== "field") continue;

    // Black tiles count down and block planting.
    if (tile.blackMsRemaining > 0) {
      const oldVal = tile.blackMsRemaining;
      tile.blackMsRemaining -= dtMs;
      if (tile.blackMsRemaining < 0) tile.blackMsRemaining = 0;
      if (tile.blackMsRemaining === 0 && oldVal > 0) tile.dirty = true;

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
      tile.dirty = true;
    }
  }
}

