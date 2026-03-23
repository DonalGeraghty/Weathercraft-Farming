const state = {
  day: 1,
  dayElapsedMs: (9 / 24) * MS_PER_DAY,
  weatherId: "sun",
  weatherMachineSpendCommitted: 0,
  weatherMachineSelection: "sun",
  moneyEur: 100,
  selectedSeedId: "carrot",
  inventory: {
    carrot: 3,
    onion: 0,
    cabbage: 0,
    watercress: 0,
    cactusfruit: 0,
  },
  farmer: { x: 0, y: 0 }, // path tile
  tiles: [],
  paused: false,
  roosterPlayedToday: true,
  bgmFadeState: "idle",
  bgmFadeTimerMs: 0,
  musicVolumePercent: 10,
  sunriseTransition: false,
  sunriseTransitionMsRemaining: 0,
};

function createInitialTiles() {
  const tiles = [];
  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const kind = isField(x, y) ? "field" : "path";
      let crop = null;
      tiles.push({
        kind,
        crop,
        waterlogged: false,
        scorched: false,
        // Rot lifecycle:
        // - if a ready crop isn't harvested within 1 in-game day => crop disappears and tile turns black for 1 day
        blackMsRemaining: 0,
        readyRotMsRemaining: 0,
        isAdjacentToWater: false,
        dirty: true,
      });
    }
  }
  return tiles;
}

function exportStateToCsv() {
  const lines = [];
  lines.push("WeathercraftFarmingCSV,4");
  lines.push(
    [
      state.day,
      state.dayElapsedMs,
      state.weatherId,
      state.weatherMachineSelection,
      state.moneyEur,
      state.selectedSeedId,
      state.farmer.x,
      state.farmer.y,
      state.inventory.carrot ?? 0,
      state.inventory.onion ?? 0,
      state.inventory.cabbage ?? 0,
      state.inventory.watercress ?? 0,
      state.inventory.cactusfruit ?? 0,
      state.weatherMachineSpendCommitted ?? 0,
      state.paused ? 1 : 0,
    ].join(","),
  );
  lines.push("x,y,waterlogged,scorched,soilRecoveryDaysRemaining,harvestRotDaysRemaining,seedTypeId,growthProgress01");

  for (let y = 1; y <= FIELD_SIZE; y++) {
    for (let x = 1; x <= FIELD_SIZE; x++) {
      const tile = state.tiles[tileIndex(x, y)];
      const waterlogged = tile?.waterlogged ? "1" : "0";
      const scorched = tile?.scorched ? "1" : "0";
      const soilRecoveryDaysRemaining = tile?.blackMsRemaining > 0 ? tile.blackMsRemaining / MS_PER_DAY : 0;
      const harvestRotDaysRemaining = tile?.readyRotMsRemaining > 0 ? tile.readyRotMsRemaining / MS_PER_DAY : 0;
      const seedTypeId = tile?.crop ? tile.crop.cropId : "";
      const growthProgress01 = tile?.crop ? tile.crop.progress : "";
      lines.push([x, y, waterlogged, scorched, soilRecoveryDaysRemaining, harvestRotDaysRemaining, seedTypeId, growthProgress01].join(","));
    }
  }

  return lines.join("\n");
}

function parseCsvLine(line) {
  // Simple CSV parsing for our controlled format (no quoted commas).
  return line.split(",").map((csvField) => csvField.trim());
}

function importStateFromCsv(csvText) {
  const lines = csvText
    .replace(/\r/g, "")
    .split("\n")
    .map((rawLine) => rawLine.trim())
    .filter(Boolean);

  if (lines.length < 3) throw new Error("CSV is too short.");
  const csvVersion = lines[0];
  if (
    csvVersion !== "WeathercraftFarmingCSV,1" &&
    csvVersion !== "WeathercraftFarmingCSV,2" &&
    csvVersion !== "WeathercraftFarmingCSV,3" &&
    csvVersion !== "WeathercraftFarmingCSV,4"
  ) {
    throw new Error("Unrecognized CSV format.");
  }

  const meta = parseCsvLine(lines[1]);
  const legacyV1 = csvVersion === "WeathercraftFarmingCSV,1";
  const legacyV2 = csvVersion === "WeathercraftFarmingCSV,2";
  if (legacyV1 && meta.length < 11) throw new Error("CSV meta row is invalid.");
  if (legacyV2 && meta.length < 13) throw new Error("CSV meta row is invalid.");
  if ((csvVersion === "WeathercraftFarmingCSV,3" || csvVersion === "WeathercraftFarmingCSV,4") && meta.length < 15) {
    throw new Error("CSV meta row is invalid.");
  }

  const [
    day,
    dayElapsedMsRaw,
    weatherId,
    weatherMachineSelection,
    moneyEur,
    selectedSeedId,
    farmerX,
    farmerY,
    invCarrot,
    invOnion,
    invCabbage,
    invWatercress,
    invCactusfruit,
    metaWeatherSpend,
    metaPaused,
  ] = meta;

  state.day = Number(day) || 1;
  state.dayElapsedMs = Number(dayElapsedMsRaw) || 0;
  state.weatherId = weatherId === "rain" ? "rain" : "sun";
  state.weatherMachineSelection = weatherMachineSelection === "rain" ? "rain" : "sun";
  state.moneyEur = Number(moneyEur) || 0;
  state.selectedSeedId = selectedSeedId && CROPS[selectedSeedId] ? selectedSeedId : "carrot";
  state.farmer.x = Number(farmerX) || 0;
  state.farmer.y = Number(farmerY) || 0;
  state.inventory.carrot = Number(invCarrot) || 0;
  state.inventory.onion = Number(invOnion) || 0;
  state.inventory.cabbage = Number(invCabbage) || 0;
  state.inventory.watercress = legacyV1 ? 0 : Number(invWatercress) || 0;
  state.inventory.cactusfruit = legacyV1 ? 0 : Number(invCactusfruit) || 0;
  state.weatherMachineSpendCommitted =
    (csvVersion === "WeathercraftFarmingCSV,3" || csvVersion === "WeathercraftFarmingCSV,4")
      ? Math.max(0, Number(metaWeatherSpend) || 0)
      : 0;
  state.paused =
    (csvVersion === "WeathercraftFarmingCSV,3" || csvVersion === "WeathercraftFarmingCSV,4")
      && (metaPaused === "1" || metaPaused === "true");

  state.tiles = createInitialTiles();

  // tile rows follow the header at lines[2]
  for (let i = 3; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 5) continue;
    const x = Number(row[0]);
    const y = Number(row[1]);
    if (!isField(x, y)) continue;
    const waterlogged = row[2] === "1";
    let scorched = false;
    let soilRecoveryDaysRemaining = 0;
    let harvestRotDaysRemaining = 0;
    let seedTypeId = "";
    let growthProgress01 = "";

    // Supported formats:
    // - v1: x,y,waterlogged,cropId,progress
    // - v2: x,y,waterlogged,scorched,cropId,progress
    // - v3: x,y,waterlogged,scorched,blackDaysRemaining,rotDaysRemaining,cropId,progress
    // - v4: x,y,waterlogged,scorched,soilRecoveryDaysRemaining,harvestRotDaysRemaining,seedTypeId,growthProgress01
    if (row.length >= 8) {
      scorched = row[3] === "1";
      soilRecoveryDaysRemaining = Number(row[4]) || 0;
      harvestRotDaysRemaining = Number(row[5]) || 0;
      seedTypeId = row[6];
      growthProgress01 = row[7];
    } else if (row.length >= 6) {
      scorched = row[3] === "1";
      seedTypeId = row[4];
      growthProgress01 = row[5];
    } else {
      scorched = false;
      seedTypeId = row[3];
      growthProgress01 = row[4];
    }

    const tile = state.tiles[tileIndex(x, y)];
    if (!tile) continue;

    tile.waterlogged = waterlogged;
    tile.scorched = scorched;
    tile.blackMsRemaining = soilRecoveryDaysRemaining > 0 ? soilRecoveryDaysRemaining * MS_PER_DAY : 0;
    tile.readyRotMsRemaining = harvestRotDaysRemaining > 0 ? harvestRotDaysRemaining * MS_PER_DAY : 0;

    // Hazards overwrite rot (waterlogged/scorched remove black/ready timers).
    if (waterlogged || scorched) {
      tile.blackMsRemaining = 0;
      tile.readyRotMsRemaining = 0;
    }

    // If the tile is black, it must be empty (and rotting timer should be cleared).
    if (tile.blackMsRemaining > 0) {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      continue;
    }

    // Waterlogged always kills any crop.
    if (waterlogged) {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      continue;
    }

    // Scorched kills all crops except cactus fruit.
    if (scorched && seedTypeId !== "cactusfruit") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      continue;
    }

    if (seedTypeId && CROPS[seedTypeId]) {
      tile.crop = {
        cropId: seedTypeId,
        progress: growthProgress01 === "" ? 0 : clamp01(Number(growthProgress01) || 0),
      };
    } else {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
    }
  }

  for (let idx = 0; idx < state.tiles.length; idx++) {
    reconcileExclusiveHazards(state.tiles[idx], idx);
  }

  // Ensure any loaded crops obey the hazard placement rules.
  enforceHazardPlantValidity();

  state.roosterPlayedToday = state.dayElapsedMs >= (7 / 24) * MS_PER_DAY;

  setWeatherTheme();
  updateWaterAdjacency();
  updateWeatherMachineUi();
  updateHud();
  updateShopInfo();
  setPaused(state.paused);
  const seedSelectEl = document.getElementById("seed-select");
  if (seedSelectEl) seedSelectEl.value = state.selectedSeedId;
  renderAll(true);
  updateHighlights();
}

