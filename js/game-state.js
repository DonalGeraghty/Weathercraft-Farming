const state = {
  day: 1,
  msIntoDay: (9 / 24) * MS_PER_DAY,
  weatherId: "sun",
  weatherMachineSpendCommitted: 0,
  weatherMachineSelection: "sun",
  money: 100,
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
  lines.push("WeathercraftFarmingCSV,3");
  lines.push(
    [
      state.day,
      state.msIntoDay,
      state.weatherId,
      state.weatherMachineSelection,
      state.money,
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
  lines.push("x,y,waterlogged,scorched,blackDaysRemaining,rotDaysRemaining,cropId,progress");

  for (let y = 1; y <= FIELD_SIZE; y++) {
    for (let x = 1; x <= FIELD_SIZE; x++) {
      const tile = state.tiles[tileIndex(x, y)];
      const waterlogged = tile?.waterlogged ? "1" : "0";
      const scorched = tile?.scorched ? "1" : "0";
      const blackDaysRemaining = tile?.blackMsRemaining > 0 ? tile.blackMsRemaining / MS_PER_DAY : 0;
      const rotDaysRemaining = tile?.readyRotMsRemaining > 0 ? tile.readyRotMsRemaining / MS_PER_DAY : 0;
      const cropId = tile?.crop ? tile.crop.cropId : "";
      const progress = tile?.crop ? tile.crop.progress : "";
      lines.push([x, y, waterlogged, scorched, blackDaysRemaining, rotDaysRemaining, cropId, progress].join(","));
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
    csvVersion !== "WeathercraftFarmingCSV,3"
  ) {
    throw new Error("Unrecognized CSV format.");
  }

  const meta = parseCsvLine(lines[1]);
  const legacyV1 = csvVersion === "WeathercraftFarmingCSV,1";
  const legacyV2 = csvVersion === "WeathercraftFarmingCSV,2";
  if (legacyV1 && meta.length < 11) throw new Error("CSV meta row is invalid.");
  if (legacyV2 && meta.length < 13) throw new Error("CSV meta row is invalid.");
  if (csvVersion === "WeathercraftFarmingCSV,3" && meta.length < 15) throw new Error("CSV meta row is invalid.");

  const [
    day,
    msIntoDayRaw,
    weatherId,
    weatherMachineSelection,
    money,
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
  state.msIntoDay = Number(msIntoDayRaw) || 0;
  state.weatherId = weatherId === "rain" ? "rain" : "sun";
  state.weatherMachineSelection = weatherMachineSelection === "rain" ? "rain" : "sun";
  state.money = Number(money) || 0;
  state.selectedSeedId = selectedSeedId && CROPS[selectedSeedId] ? selectedSeedId : "carrot";
  state.farmer.x = Number(farmerX) || 0;
  state.farmer.y = Number(farmerY) || 0;
  state.inventory.carrot = Number(invCarrot) || 0;
  state.inventory.onion = Number(invOnion) || 0;
  state.inventory.cabbage = Number(invCabbage) || 0;
  state.inventory.watercress = legacyV1 ? 0 : Number(invWatercress) || 0;
  state.inventory.cactusfruit = legacyV1 ? 0 : Number(invCactusfruit) || 0;
  state.weatherMachineSpendCommitted =
    csvVersion === "WeathercraftFarmingCSV,3" ? Math.max(0, Number(metaWeatherSpend) || 0) : 0;
  state.paused =
    csvVersion === "WeathercraftFarmingCSV,3" && (metaPaused === "1" || metaPaused === "true");

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
    let blackDaysRemaining = 0;
    let rotDaysRemaining = 0;
    let cropId = "";
    let progress = "";

    // Supported formats:
    // - v1: x,y,waterlogged,cropId,progress
    // - v2: x,y,waterlogged,scorched,cropId,progress
    // - v3: x,y,waterlogged,scorched,blackDaysRemaining,rotDaysRemaining,cropId,progress
    if (row.length >= 8) {
      scorched = row[3] === "1";
      blackDaysRemaining = Number(row[4]) || 0;
      rotDaysRemaining = Number(row[5]) || 0;
      cropId = row[6];
      progress = row[7];
    } else if (row.length >= 6) {
      scorched = row[3] === "1";
      cropId = row[4];
      progress = row[5];
    } else {
      scorched = false;
      cropId = row[3];
      progress = row[4];
    }

    const tile = state.tiles[tileIndex(x, y)];
    if (!tile) continue;

    tile.waterlogged = waterlogged;
    tile.scorched = scorched;
    tile.blackMsRemaining = blackDaysRemaining > 0 ? blackDaysRemaining * MS_PER_DAY : 0;
    tile.readyRotMsRemaining = rotDaysRemaining > 0 ? rotDaysRemaining * MS_PER_DAY : 0;

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
    if (scorched && cropId !== "cactusfruit") {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
      continue;
    }

    if (cropId && CROPS[cropId]) {
      tile.crop = { cropId, progress: progress === "" ? 0 : clamp01(Number(progress) || 0) };
    } else {
      tile.crop = null;
      tile.readyRotMsRemaining = 0;
    }
  }

  for (const tile of state.tiles) {
    reconcileExclusiveHazards(tile);
  }

  // Ensure any loaded crops obey the hazard placement rules.
  enforceHazardPlantValidity();

  state.roosterPlayedToday = state.msIntoDay >= (7 / 24) * MS_PER_DAY;

  setWeatherTheme();
  updateWaterAdjacency();
  updateWeatherMachineUi();
  updateHud();
  updateShopInfo();
  setPaused(state.paused);
  const seedSelectEl = document.getElementById("seedSelect");
  if (seedSelectEl) seedSelectEl.value = state.selectedSeedId;
  renderAll();
  updateHighlights();
}

