const WORLD_SIZE = 14; // includes path ring
const FIELD_SIZE = 12; // inner farm
const MS_PER_DAY = 100_000; // 5 minutes real time = 1 in-game day

const CROPS = {
  carrot: {
    id: "carrot",
    name: "Carrot",
    color: "#ff8a3d",
    label: "C",
    daysToGrow: 6,
    weatherGrowthMultipliers: { sun: 1.35, rain: 0.7 },
    seedCost: 3,
    harvestValue: 8,
  },
  onion: {
    id: "onion",
    name: "Onion",
    color: "#f0d5ff",
    label: "O",
    daysToGrow: 8,
    weatherGrowthMultipliers: { sun: 1.0, rain: 1.0 },
    seedCost: 4,
    harvestValue: 10,
  },
  cabbage: {
    id: "cabbage",
    name: "Cabbage",
    color: "#7dff86",
    label: "B",
    daysToGrow: 10,
    weatherGrowthMultipliers: { sun: 0.7, rain: 1.35 },
    seedCost: 5,
    harvestValue: 13,
  },
  watercress: {
    id: "watercress",
    name: "Watercress",
    // Teal/green so it reads well vs waterlogged/scorched overlays.
    color: "#37e6d2",
    label: "W",
    daysToGrow: 10,
    weatherGrowthMultipliers: { sun: 1.0, rain: 1.0 },
    seedCost: 6,
    harvestValue: 16,
    // Extra growth when adjacent to waterlogged cells.
    adjacentWaterloggedGrowthMultiplier: 4.0,
  },
  cactusFruit: {
    id: "cactusFruit",
    name: "Cactus Fruit",
    color: "#f7a93c",
    label: "F",
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

const WEATHER_BASE_CHANGE_CHANCE = 0.5; // 50% at the start
const WEATHER_CHANGE_CHANCE_PER_EURO = 0.1; // +10% per € spent

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function cropStage(progress) {
  if (progress < 0.25) return "seed";
  if (progress < 1) return "sprout";
  return "grown";
}

function isField(x, y) {
  return x >= 1 && x <= 12 && y >= 1 && y <= 12;
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

function weightedChoice(items) {
  const sum = items.reduce((a, it) => a + it.weight, 0);
  let r = Math.random() * sum;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

const state = {
  day: 1,
  msIntoDay: 0,
  weatherId: "sun",
  weatherChangeChance: 0.5,
  weatherMachineSpendCommitted: 0,
  weatherMachineSelection: "sun",
  money: 1000,
  selectedSeedId: "carrot",
  inventory: {
    carrot: 3,
    onion: 0,
    cabbage: 0,
  },
  farmer: { x: 0, y: 0 }, // path tile
  tiles: [],
  paused: false,
};

const SEED_KEY_ORDER = ["carrot", "onion", "cabbage", "watercress", "cactusFruit"];

function createInitialTiles() {
  const tiles = [];
  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const kind = isField(x, y) ? "field" : "path";
      let crop = null;
      tiles.push({ kind, crop, waterlogged: false, scorched: false });
    }
  }
  return tiles;
}

function exportStateToCsv() {
  const lines = [];
  lines.push("HappyFarmCSV,1");
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
    ].join(","),
  );
  lines.push("x,y,waterlogged,scorched,cropId,progress");

  for (let y = 1; y <= FIELD_SIZE; y++) {
    for (let x = 1; x <= FIELD_SIZE; x++) {
      const tile = state.tiles[tileIndex(x, y)];
      const waterlogged = tile?.waterlogged ? "1" : "0";
      const scorched = tile?.scorched ? "1" : "0";
      const cropId = tile?.crop ? tile.crop.cropId : "";
      const progress = tile?.crop ? tile.crop.progress : "";
      lines.push([x, y, waterlogged, scorched, cropId, progress].join(","));
    }
  }

  return lines.join("\n");
}

function parseCsvLine(line) {
  // Simple CSV parsing for our controlled format (no quoted commas).
  return line.split(",").map((s) => s.trim());
}

function importStateFromCsv(csvText) {
  const lines = csvText
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 3) throw new Error("CSV is too short.");
  if (lines[0] !== "HappyFarmCSV,1") throw new Error("Unrecognized CSV format.");

  const meta = parseCsvLine(lines[1]);
  if (meta.length < 11) throw new Error("CSV meta row is invalid.");

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

  state.tiles = createInitialTiles();

  // tile rows follow the header at lines[2]
  for (let i = 3; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 5) continue;
    const x = Number(row[0]);
    const y = Number(row[1]);
    if (!isField(x, y)) continue;
    const waterlogged = row[2] === "1";

    // Support both:
    // - v1: x,y,waterlogged,cropId,progress
    // - v2: x,y,waterlogged,scorched,cropId,progress
    const hasScorchedCol = row.length >= 6;
    const scorched = hasScorchedCol ? row[3] === "1" : false;
    const cropId = hasScorchedCol ? row[4] : row[3];
    const progress = hasScorchedCol ? row[5] : row[4];

    const tile = state.tiles[tileIndex(x, y)];
    if (!tile) continue;

    tile.waterlogged = waterlogged;
    tile.scorched = scorched;

    // Waterlogged always kills any crop.
    if (waterlogged) {
      tile.crop = null;
      continue;
    }

    // Scorched kills all crops except cactus fruit.
    if (scorched && cropId !== "cactusFruit") {
      tile.crop = null;
      continue;
    }

    if (cropId && CROPS[cropId]) {
      tile.crop = { cropId, progress: progress === "" ? 0 : clamp01(Number(progress) || 0) };
    } else {
      tile.crop = null;
    }
  }

  // Ensure any loaded crops obey the hazard placement rules.
  enforceHazardPlantValidity();

  setWeatherTheme();
  updateWeatherMachineUi();
  updateHud();
  updateShopInfo();
  renderAll();
}

function weatherForDay(day) {
  return weightedChoice([
    { value: "sun", weight: 0.62 },
    { value: "rain", weight: 0.38 },
  ]);
}

function weatherIcon(weatherId) {
  if (weatherId === "rain") return "🌧️";
  return "☀️";
}

function maybeChangeWeatherAtMidnight() {
  if (Math.random() >= state.weatherChangeChance) return;
  // "Chance to change" means it can flip between sun and rain.
  state.weatherId = state.weatherId === "sun" ? "rain" : "sun";
}

function getEffectiveWeatherChangeChance() {
  // Chance to apply the weather machine's selected target weather.
  return clamp01(
    WEATHER_BASE_CHANGE_CHANCE + WEATHER_CHANGE_CHANCE_PER_EURO * (state.weatherMachineSpendCommitted ?? 0),
  );
}

function applyWeatherMachineAtMidnight() {
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
  // Spend is consumed at midnight.
  state.weatherMachineSpendCommitted = 0;
}

function setPaused(next) {
  state.paused = Boolean(next);
  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = state.paused ? "Resume" : "Pause";
}

function init() {
  state.tiles = createInitialTiles();
  state.weatherId = weatherForDay(state.day);
  state.weatherMachineSelection = state.weatherId;
  buildGridDom();
  bindUi();
  updateHud();
  setWeatherTheme();
  renderAll();
  startLoop();
}

function setWeatherTheme() {
  const wrap = document.querySelector(".gameWrap");
  if (!wrap) return;
  wrap.classList.toggle("weather--rain", state.weatherId === "rain");
  wrap.classList.toggle("weather--sun", state.weatherId !== "rain");
}

function fieldCount() {
  return FIELD_SIZE * FIELD_SIZE;
}

function isAdjacentToWaterlogged(x, y) {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const n of neighbors) {
    if (n.x < 0 || n.y < 0 || n.x >= WORLD_SIZE || n.y >= WORLD_SIZE) continue;
    if (!isField(n.x, n.y)) continue;
    const tile = state.tiles[tileIndex(n.x, n.y)];
    if (tile?.kind === "field" && tile.waterlogged) return true;
  }
  return false;
}

function enforceHazardPlantValidity() {
  for (let idx = 0; idx < state.tiles.length; idx++) {
    const tile = state.tiles[idx];
    if (tile.kind !== "field" || !tile.crop) continue;

    const x = idx % WORLD_SIZE;
    const y = Math.floor(idx / WORLD_SIZE);
    const cropId = tile.crop.cropId;

    // Regular crops should never exist on hazards (they would have been destroyed when hazards were created).
    if (cropId !== "cactusFruit" && cropId !== "watercress") {
      if (tile.waterlogged || tile.scorched) tile.crop = null;
      continue;
    }

    if (cropId === "cactusFruit") {
      if (!tile.scorched) tile.crop = null;
      continue;
    }

    // watercress rules:
    // - It can only exist if adjacent to waterlogged cells.
    // - It should not be on scorched or waterlogged cells.
    if (cropId === "watercress") {
      if (tile.waterlogged || tile.scorched) {
        tile.crop = null;
        continue;
      }
      if (!isAdjacentToWaterlogged(x, y)) tile.crop = null;
    }
  }
}

function clearWaterloggedCells() {
  for (const tile of state.tiles) {
    if (tile.kind !== "field") continue;
    tile.waterlogged = false;
  }
}

function clearScorchedCells() {
  for (const tile of state.tiles) {
    if (tile.kind !== "field") continue;
    tile.scorched = false;
  }
}

function addWaterloggedCellsForRain() {
  // Weather controls how often the land becomes waterlogged.
  const addCount = 5;
  addWaterloggedCells(addCount);
}

function removeHalfWaterloggedCells() {
  const waterloggedIdxs = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (!tile.waterlogged) continue;
    waterloggedIdxs.push(i);
  }

  const removeCount = Math.floor(waterloggedIdxs.length * 0.5);
  if (removeCount <= 0) return;

  for (let i = waterloggedIdxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = waterloggedIdxs[i];
    waterloggedIdxs[i] = waterloggedIdxs[j];
    waterloggedIdxs[j] = tmp;
  }

  const toRemove = waterloggedIdxs.slice(0, removeCount);
  for (const idx of toRemove) state.tiles[idx].waterlogged = false;
}

function removeHalfScorchedCells() {
  const scorchedIdxs = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (!tile.scorched) continue;
    scorchedIdxs.push(i);
  }

  const removeCount = Math.floor(scorchedIdxs.length * 0.5);
  if (removeCount <= 0) return;

  for (let i = scorchedIdxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = scorchedIdxs[i];
    scorchedIdxs[i] = scorchedIdxs[j];
    scorchedIdxs[j] = tmp;
  }

  const toRemove = scorchedIdxs.slice(0, removeCount);
  for (const idx of toRemove) state.tiles[idx].scorched = false;
}

function addScorchedCellsForSun() {
  // Weather controls how often the land becomes scorched.
  const addCount = 5;
  addScorchedCells(addCount);
}

function addWaterloggedCells(addCount) {
  if (addCount <= 0) return;

  const candidates = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (tile.waterlogged) continue;
    candidates.push(i);
  }

  // Fisher-Yates shuffle.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  const toApply = candidates.slice(0, addCount);
  for (const idx of toApply) {
    const tile = state.tiles[idx];
    tile.waterlogged = true;
    tile.crop = null; // destroys any vegetables
  }
}

function addScorchedCells(addCount) {
  if (addCount <= 0) return;

  const candidates = [];
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (tile.kind !== "field") continue;
    if (tile.scorched) continue;
    candidates.push(i);
  }

  // Fisher-Yates shuffle.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  const toApply = candidates.slice(0, addCount);
  for (const idx of toApply) {
    const tile = state.tiles[idx];
    tile.scorched = true;
    tile.crop = null; // destroys any vegetables
  }
}

function buildGridDom() {
  const gridEl = document.getElementById("grid");
  gridEl.innerHTML = "";

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const idx = tileIndex(x, y);
      const tile = state.tiles[idx];

      const el = document.createElement("div");
      el.className = `tile ${tile.kind === "field" ? "tile--field" : "tile--path"}`;
      if (tile.kind === "field" && (x + y) % 2 === 0) el.classList.add("alt");
      el.dataset.x = String(x);
      el.dataset.y = String(y);
      el.dataset.idx = String(idx);
      el.setAttribute("role", "gridcell");
      gridEl.appendChild(el);
    }
  }
}

function bindUi() {
  const seedSelect = document.getElementById("seedSelect");
  seedSelect.innerHTML = "";
  for (const crop of Object.values(CROPS)) {
    const opt = document.createElement("option");
    opt.value = crop.id;
    opt.textContent = `${crop.name} (€${crop.seedCost})`;
    seedSelect.appendChild(opt);
  }
  seedSelect.value = state.selectedSeedId;
  seedSelect.addEventListener("change", () => {
    state.selectedSeedId = seedSelect.value;
    updateShopInfo();
    updateHighlights();
  });

  function tryBuySelectedSeed(count = 1) {
    const crop = CROPS[state.selectedSeedId];
    if (!crop) return;
    if (count <= 0) return;
    const cost = crop.seedCost * count;
    if (state.money < cost) return;

    state.money -= cost;
    state.inventory[crop.id] = (state.inventory[crop.id] ?? 0) + count;
    updateHud();
    updateShopInfo();
    updateWeatherMachineUi();
  }

  document.getElementById("buySeedBtn").addEventListener("click", () => {
    tryBuySelectedSeed(1);
  });

  document.getElementById("weatherMachineSunBtn").addEventListener("click", () => {
    state.weatherMachineSelection = "sun";
    updateWeatherMachineUi();
  });
  document.getElementById("weatherMachineRainBtn").addEventListener("click", () => {
    state.weatherMachineSelection = "rain";
    updateWeatherMachineUi();
  });

  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => setPaused(!state.paused));
  }

  const weatherSpendInput = document.getElementById("weatherMachineSpendInput");
  const weatherSpendBtn = document.getElementById("weatherMachineSpendBtn");
  if (weatherSpendInput && weatherSpendBtn) {
    weatherSpendBtn.addEventListener("click", () => {
      const amt = Math.max(0, Math.floor(Number(weatherSpendInput.value) || 0));
      if (amt <= 0) return;
      if (state.money < amt) return;
      state.money -= amt;
      state.weatherMachineSpendCommitted += amt;
      weatherSpendInput.value = "0";
      updateHud();
      updateWeatherMachineUi();
    });
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "p") {
      setPaused(!state.paused);
      return;
    }

    if (state.paused) return;

    if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright", " ", "e"].includes(key)) {
      e.preventDefault();
    }

    if (key === "w" || key === "arrowup") tryMove(0, -1);
    if (key === "a" || key === "arrowleft") tryMove(-1, 0);
    if (key === "s" || key === "arrowdown") tryMove(0, 1);
    if (key === "d" || key === "arrowright") tryMove(1, 0);
    if (key === " ") tryPlantHere();
    if (key === "e") tryHarvestHere();

    // Keyboard-only shop controls:
    // 1-5 selects seed; B buys one seed.
    if (/^[1-5]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const nextSeedId = SEED_KEY_ORDER[idx];
      if (nextSeedId) {
        state.selectedSeedId = nextSeedId;
        if (seedSelect) seedSelect.value = nextSeedId;
        updateShopInfo();
        updateHighlights();
      }
    }
    if (key === "b") {
      // Optional: Shift+B buys 5 if possible.
      const count = e.shiftKey ? 5 : 1;
      tryBuySelectedSeed(count);
    }
  });

  updateShopInfo();
  updateWeatherMachineUi();
  setPaused(state.paused);

  const saveBtn = document.getElementById("saveCsvBtn");
  const loadBtn = document.getElementById("loadCsvBtn");
  const loadInput = document.getElementById("loadCsvInput");
  const statusEl = document.getElementById("saveLoadStatus");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const csv = exportStateToCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `HappyFarm_state_day${state.day}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (statusEl) statusEl.textContent = "Saved CSV downloaded.";
    });
  }

  if (loadBtn && loadInput) {
    loadBtn.addEventListener("click", () => {
      const file = loadInput.files?.[0];
      if (!file) {
        if (statusEl) statusEl.textContent = "Select a CSV file first.";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? "");
          importStateFromCsv(text);
          if (statusEl) statusEl.textContent = "CSV loaded successfully.";
        } catch (err) {
          if (statusEl) statusEl.textContent = `Load failed: ${err?.message ?? err}`;
        }
      };
      reader.onerror = () => {
        if (statusEl) statusEl.textContent = "Load failed: file read error.";
      };
      reader.readAsText(file);
    });
  }
}

function updateWeatherMachineUi() {
  const sunBtn = document.getElementById("weatherMachineSunBtn");
  const rainBtn = document.getElementById("weatherMachineRainBtn");
  if (sunBtn) sunBtn.classList.toggle("btn--active", state.weatherMachineSelection === "sun");
  if (rainBtn) rainBtn.classList.toggle("btn--active", state.weatherMachineSelection === "rain");

  const info = document.getElementById("weatherMachineInfo");
  if (info) {
    const chance = Math.round(getEffectiveWeatherChangeChance() * 100);
    const spent = state.weatherMachineSpendCommitted ?? 0;
    info.textContent = `Tomorrow: ${weatherIcon(state.weatherMachineSelection)} ${WEATHER[state.weatherMachineSelection]?.name ?? state.weatherMachineSelection} · Change chance: ${chance}% (spent €${spent})`;
  }
}

function updateShopInfo() {
  const crop = CROPS[state.selectedSeedId];
  const invCount = state.inventory[state.selectedSeedId] ?? 0;
  const seedInfo = document.getElementById("seedInfo");
  const sunMult = crop?.weatherGrowthMultipliers?.sun ?? 1;
  const rainMult = crop?.weatherGrowthMultipliers?.rain ?? 1;
  const waterAdjMult = crop?.adjacentWaterloggedGrowthMultiplier ?? null;
  const scorchedMult = crop?.scorchedGrowthMultiplier ?? null;
  seedInfo.textContent = crop
    ? [
        `Have ${invCount}.`,
        `Harvest €${crop.harvestValue}.`,
        `Grows in ${crop.daysToGrow} days.`,
        `Sun x${sunMult.toFixed(2)}, Rain x${rainMult.toFixed(2)}.`,
        waterAdjMult ? `Adjacent waterlogged: x${waterAdjMult.toFixed(2)}.` : "",
        scorchedMult ? `On scorched soil: x${scorchedMult.toFixed(2)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const invParts = [];
  for (const c of Object.values(CROPS)) {
    invParts.push(`${c.name}: ${state.inventory[c.id] ?? 0}`);
  }
  document.getElementById("inventoryValue").textContent = invParts.join(" · ");

  const btn = document.getElementById("buySeedBtn");
  btn.disabled = !crop || state.money < crop.seedCost;
}

function updateHud() {
  document.getElementById("dayValue").textContent = String(state.day);
  document.getElementById("timeValue").textContent = formatTimeOfDay(state.msIntoDay);
  document.getElementById("weatherValue").textContent = WEATHER[state.weatherId]?.name ?? state.weatherId;
  const iconEl = document.getElementById("weatherIcon");
  if (iconEl) iconEl.textContent = weatherIcon(state.weatherId);
  const chanceEl = document.getElementById("weatherChanceValue");
  if (chanceEl) chanceEl.textContent = `${Math.round(getEffectiveWeatherChangeChance() * 100)}%`;
  document.getElementById("moneyValue").textContent = String(state.money);
  updateShopInfo();
}

function startLoop() {
  let last = performance.now();
  function frame(now) {
    const dt = now - last;
    last = now;
    if (!state.paused) tick(dt);
    else renderAll();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function tick(dtMs) {
  state.msIntoDay += dtMs;
  if (state.msIntoDay >= MS_PER_DAY) {
    state.msIntoDay -= MS_PER_DAY;
    state.day += 1;
    const prevWeather = state.weatherId;
    applyWeatherMachineAtMidnight();

    const nextWeather = state.weatherId;
    const isSwap = prevWeather !== nextWeather;

    if (nextWeather === "rain") {
      if (isSwap) {
        // Sunny -> rainy: 3 new waterlogged, and 2 scorched.
        addWaterloggedCells(3);
        addScorchedCells(2);
      } else {
        // Regular rainy day: only 5 new waterlogged.
        addWaterloggedCellsForRain();
      }
      // Only shrink scorched on regular rainy days.
      if (!isSwap) removeHalfScorchedCells();
    } else {
      if (isSwap) {
        // Rainy -> sunny: 3 new scorched, and 2 waterlogged.
        addScorchedCells(3);
        addWaterloggedCells(2);
      } else {
        // Regular sunny day: only 5 new scorched.
        addScorchedCellsForSun();
      }
      // Only shrink waterlogged on regular sunny days.
      if (!isSwap) removeHalfWaterloggedCells();
    }

    // Hazards may have changed what crops are allowed to exist.
    enforceHazardPlantValidity();

    setWeatherTheme();

    growAllCrops(1);
  } else {
    growAllCrops(dtMs / MS_PER_DAY);
  }

  updateHud();
  renderAll();
}

function growAllCrops(dayFraction) {
  const w = WEATHER[state.weatherId] ?? WEATHER.sun;
  const globalMultiplier = w.growthMultiplier;

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
      if (isAdjacentToWaterlogged(x, y)) {
        envMult *= cropDef.adjacentWaterloggedGrowthMultiplier;
      }
    }
    if (cropDef.scorchedGrowthMultiplier) {
      if (tile.scorched) envMult *= cropDef.scorchedGrowthMultiplier;
    }

    const dProgress = growthPerDay * globalMultiplier * cropWeatherMult * envMult * dayFraction;
    tile.crop.progress = clamp01(tile.crop.progress + dProgress);
  }
}

function tryMove(dx, dy) {
  const nx = state.farmer.x + dx;
  const ny = state.farmer.y + dy;
  if (nx < 0 || ny < 0 || nx >= WORLD_SIZE || ny >= WORLD_SIZE) return;

  state.farmer.x = nx;
  state.farmer.y = ny;
  updateHighlights();
}

function tryPlantHere() {
  const cropId = state.selectedSeedId;
  const have = state.inventory[cropId] ?? 0;
  if (have <= 0) return;

  const tile = state.tiles[tileIndex(state.farmer.x, state.farmer.y)];
  if (!tile || tile.kind !== "field") return;

  // Only plant if empty or already harvested (no crop).
  if (tile.crop) return;

  const x = state.farmer.x;
  const y = state.farmer.y;

  // Waterlogged tiles are never plantable.
  if (tile.waterlogged) return;

  if (cropId === "cactusFruit") {
    // Cactus fruit can ONLY be placed on scorched earth.
    if (!tile.scorched) return;
  } else if (cropId === "watercress") {
    // Watercress can ONLY be placed adjacent to waterlogged cells.
    // It also cannot be planted on scorched/waterlogged tiles.
    if (tile.scorched) return;
    if (!isAdjacentToWaterlogged(x, y)) return;
  } else {
    // Regular crops cannot be planted on scorched earth.
    if (tile.scorched) return;
  }

  tile.crop = { cropId, progress: 0 };
  state.inventory[cropId] = have - 1;

  updateHud();
  updateHighlights();
}

function tryHarvestHere() {
  const tile = state.tiles[tileIndex(state.farmer.x, state.farmer.y)];
  if (!tile || tile.kind !== "field" || !tile.crop) return;

  const cropDef = CROPS[tile.crop.cropId];
  if (!cropDef) return;
  if (tile.crop.progress < 1) return;

  state.money += cropDef.harvestValue;
  tile.crop = null;
  updateHud();
  updateShopInfo();
  updateHighlights();
}

function renderAll() {
  const gridEl = document.getElementById("grid");
  const children = gridEl.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const x = Number(el.dataset.x);
    const y = Number(el.dataset.y);
    const tile = state.tiles[i];

    // Update dynamic styling.
    el.classList.toggle("tile--waterlogged", tile.kind === "field" && tile.waterlogged);
    el.classList.toggle("tile--scorched", tile.kind === "field" && tile.scorched);

    el.innerHTML = "";
    if (tile.kind === "field" && tile.crop) {
      const cropDef = CROPS[tile.crop.cropId];
      const progress = tile.crop.progress;
      const stage = cropStage(progress);
      const isHarvestReady = progress >= 1;

      const cropEl = document.createElement("div");
      cropEl.className = "crop";
      cropEl.dataset.stage = stage;
      cropEl.style.background = `linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0.16)), ${cropDef?.color ?? "rgba(255,255,255,0.12)"}`;

      const labelEl = document.createElement("div");
      labelEl.className = "crop__label";
      labelEl.textContent = cropDef?.label ?? "?";
      cropEl.appendChild(labelEl);

      const bar = document.createElement("div");
      bar.className = "crop__bar";
      const fill = document.createElement("div");
      fill.className = "crop__barFill";
      fill.style.width = `${Math.floor(clamp01(progress) * 100)}%`;
      bar.appendChild(fill);
      cropEl.appendChild(bar);

      el.appendChild(cropEl);

      if (isHarvestReady) {
        const ready = document.createElement("div");
        ready.className = "harvestReady";
        ready.textContent = "!";
        ready.title = "Ready to harvest (press E)";
        el.appendChild(ready);
      }
    }

    if (state.farmer.x === x && state.farmer.y === y) {
      const f = document.createElement("div");
      f.className = "farmer";
      f.textContent = "🧑‍🌾";
      el.appendChild(f);
    }
  }

  updateHighlights();
}

function updateHighlights() {
  const gridEl = document.getElementById("grid");
  const children = gridEl.children;
  for (let i = 0; i < children.length; i++) {
    children[i].classList.remove("tile--highlight");
  }

  const idx = tileIndex(state.farmer.x, state.farmer.y);
  const el = children[idx];
  if (!el) return;
  const tile = state.tiles[idx];
  if (!tile) return;
  if (tile.kind !== "field") return;
  el.classList.add("tile--highlight");
}

init();

