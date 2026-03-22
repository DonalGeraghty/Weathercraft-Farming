// ---- DOM caching for fast rendering ----
const TILE_COUNT = WORLD_SIZE * WORLD_SIZE;
let tileEls = [];
let cropEls = [];
let cropLabels = [];
let cropImgs = [];
let cropBarFills = [];
let harvestReadyEls = [];
let farmerEl = null;
let lastFarmerIdx = null;
let lastHighlightedIdx = null;
let lastCropIdByIdx = new Array(TILE_COUNT).fill(null);
let lastCropStageByIdx = new Array(TILE_COUNT).fill(null);

function setPaused(next) {
  state.paused = Boolean(next);
  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = state.paused ? "Resume" : "Pause";
}

function buildGridDom() {
  const gridEl = document.getElementById("grid");
  gridEl.innerHTML = "";

  tileEls = new Array(TILE_COUNT);
  cropEls = new Array(TILE_COUNT);
  cropLabels = new Array(TILE_COUNT);
  cropImgs = new Array(TILE_COUNT);
  cropBarFills = new Array(TILE_COUNT);
  harvestReadyEls = new Array(TILE_COUNT);
  lastFarmerIdx = null;
  lastHighlightedIdx = null;
  lastCropIdByIdx = new Array(TILE_COUNT).fill(null);
  lastCropStageByIdx = new Array(TILE_COUNT).fill(null);

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const idx = tileIndex(x, y);
      const tile = state.tiles[idx];

      const el = document.createElement("div");
      el.className = `tile ${tile.kind === "field" ? "tile--field" : "tile--path"}`;
      if (tile.kind === "field" && (x + y) % 2 === 0) el.classList.add("alt");
      el.setAttribute("role", "gridcell");
      
      if (x === 13 && y === 0) {
        const shopIcon = document.createElement("img");
        shopIcon.src = "./assets/sprites/pixel-shop.svg";
        shopIcon.style.position = "absolute";
        shopIcon.style.inset = "5%";
        shopIcon.style.width = "90%";
        shopIcon.style.height = "90%";
        shopIcon.style.objectFit = "cover";
        shopIcon.style.imageRendering = "pixelated";
        el.appendChild(shopIcon);
      }

      gridEl.appendChild(el);

      tileEls[idx] = el;

      // Pre-create crop UI (hidden unless the tile has a valid crop to show).
      const cropEl = document.createElement("div");
      cropEl.className = "crop";
      cropEl.style.display = "none";

      const imgEl = document.createElement("img");
      imgEl.className = "crop__img";
      imgEl.alt = "Crop";
      cropEl.appendChild(imgEl);

      const labelEl = document.createElement("div");
      labelEl.className = "crop__label";
      labelEl.textContent = "";
      cropEl.appendChild(labelEl);

      const bar = document.createElement("div");
      bar.className = "crop__bar";
      const progressBarFill = document.createElement("div");
      progressBarFill.className = "crop__barFill";
      progressBarFill.style.width = "0%";
      bar.appendChild(progressBarFill);
      cropEl.appendChild(bar);

      el.appendChild(cropEl);

      // Pre-create harvest-ready indicator (hidden unless progress >= 1).
      const harvestEl = document.createElement("div");
      harvestEl.className = "harvestReady";
      harvestEl.textContent = "!";
      harvestEl.title = "Ready to harvest (press E)";
      harvestEl.style.display = "none";
      el.appendChild(harvestEl);

      cropEls[idx] = cropEl;
      cropLabels[idx] = labelEl;
      cropImgs[idx] = imgEl;
      cropBarFills[idx] = progressBarFill;
      harvestReadyEls[idx] = harvestEl;
    }
  }

  // Create a single farmer element; we move it between tiles on demand.
  farmerEl = document.createElement("div");
  farmerEl.className = "farmer";
  const farmerImg = document.createElement("img");
  farmerImg.className = "farmer__img";
  farmerImg.alt = "Pixel farmer";
  farmerImg.src = "./assets/sprites/pixel-farmer.svg";
  farmerEl.appendChild(farmerImg);
}

function bindUi() {
  const seedSelect = document.getElementById("seedSelect");
  seedSelect.innerHTML = "";
  for (const crop of Object.values(CROPS)) {
    const seedOption = document.createElement("option");
    seedOption.value = crop.id;
    seedOption.textContent = `${crop.name} (€${crop.seedCost})`;
    seedSelect.appendChild(seedOption);
  }
  seedSelect.value = state.selectedSeedId;
  seedSelect.addEventListener("change", () => {
    state.selectedSeedId = seedSelect.value;
    updateShopInfo();
    updateHighlights();
  });

  function tryBuySelectedSeed(count = 1) {
    if (state.sunriseTransition) return;
    if (state.farmer.x !== 13 || state.farmer.y !== 0) return;
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

  const buySeed5Btn = document.getElementById("buySeed5Btn");
  const buySeed10Btn = document.getElementById("buySeed10Btn");
  if (buySeed5Btn) buySeed5Btn.addEventListener("click", () => tryBuySelectedSeed(5));
  if (buySeed10Btn) buySeed10Btn.addEventListener("click", () => tryBuySelectedSeed(10));

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

  // Allow holding Space/E to plant/harvest continuously while moving.
  let holdingPlant = false; // Space
  let holdingHarvest = false; // E

  function maybeHarvestAndPlant() {
    // Harvest first so a newly-cleared tile can be planted immediately.
    if (holdingHarvest) tryHarvestHere();
    if (holdingPlant) tryPlantHere();
  }

  function doMove(dx, dy) {
    const prevX = state.farmer.x;
    const prevY = state.farmer.y;
    tryMove(dx, dy);
    if (state.farmer.x !== prevX || state.farmer.y !== prevY) {
      maybeHarvestAndPlant();
      updateShopInfo();
    }
  }

  const weatherSpendInput = document.getElementById("weatherMachineSpendInput");
  const weatherSpendBtn = document.getElementById("weatherMachineSpendBtn");
  const WEATHER_SPEND_UNIT_EUR = 10; // each 10€ => 10% chance

  function commitWeatherMachineSpend(amt) {
    if (!weatherSpendInput || !weatherSpendBtn) return;

    // Force spending to occur in 10€ increments.
    const raw = Math.max(0, Number(amt) || 0);
    const amount = Math.floor(raw / WEATHER_SPEND_UNIT_EUR) * WEATHER_SPEND_UNIT_EUR;
    if (amount <= 0) return;
    if (state.money < amount) return;

    state.money -= amount;
    state.weatherMachineSpendCommitted += amount;

    weatherSpendInput.value = "0";
    updateHud();
    updateShopInfo();
    updateWeatherMachineUi();
  }

  if (weatherSpendInput && weatherSpendBtn) {
    weatherSpendBtn.addEventListener("click", () => {
      commitWeatherMachineSpend(weatherSpendInput.value);
    });
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "p") {
      setPaused(!state.paused);
      return;
    }

    if (state.paused) return;

    const activeTag = (document.activeElement?.tagName ?? "").toLowerCase();
    const isTyping = ["input", "textarea", "select"].includes(activeTag);

    // Block all game actions while the user is typing in a form field.
    if (isTyping) return;

    if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright", " ", "e"].includes(key)) {
      e.preventDefault();
    }

    if (key === "w" || key === "arrowup") doMove(0, -1);
    if (key === "a" || key === "arrowleft") doMove(-1, 0);
    if (key === "s" || key === "arrowdown") doMove(0, 1);
    if (key === "d" || key === "arrowright") doMove(1, 0);

    if (key === " ") {
      holdingPlant = true;
      if (!e.repeat) tryPlantHere();
    }
    if (key === "e") {
      holdingHarvest = true;
      if (!e.repeat) tryHarvestHere();
    }

    // Shop hotkeys.
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
    if (key === "b") tryBuySelectedSeed(1);
    if (key === "n") tryBuySelectedSeed(5);
    if (key === "m") tryBuySelectedSeed(10);
  });

  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (key === " ") holdingPlant = false;
    if (key === "e") holdingHarvest = false;
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

      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = `WeathercraftFarming_state_day${state.day}.csv`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
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

  // ---- Background music controls ----
  const bgm = document.getElementById("bgm");
  const musicPlayBtn = document.getElementById("musicPlayBtn");
  const musicPauseBtn = document.getElementById("musicPauseBtn");
  const musicVolumeInput = document.getElementById("musicVolume");
  const musicVolumeValue = document.getElementById("musicVolumeValue");

  if (bgm && musicPlayBtn && musicPauseBtn && musicVolumeInput && musicVolumeValue) {
    const setUiPlaying = (isPlaying) => {
      musicPlayBtn.disabled = isPlaying;
      musicPauseBtn.disabled = !isPlaying;
    };

    const syncVolumeUi = () => {
      const volumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
      if (musicVolumeValue.textContent !== `${volumePercent}%`) musicVolumeValue.textContent = `${volumePercent}%`;
    };

    // Apply initial slider volume and attempt autoplay (may still be blocked by browser policy).
    syncVolumeUi();
    const initialVolumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
    bgm.volume = clamp01((initialVolumePercent / 100) * getBgmBase());
    bgm.muted = false;
    setUiPlaying(false);
    musicPauseBtn.disabled = true;

    // Try to start music immediately on load.
    bgm.play().catch(() => {
      // Autoplay may be blocked until user gesture; UI stays in paused state.
    });

    musicPlayBtn.addEventListener("click", async () => {
      try {
        await bgm.play();
      } catch {
        // Autoplay / interaction restrictions can prevent play; UI stays in paused state.
      }
    });

    musicPauseBtn.addEventListener("click", () => {
      bgm.pause();
    });

    musicVolumeInput.addEventListener("input", () => {
      syncVolumeUi();
      const volumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
      bgm.volume = clamp01((volumePercent / 100) * getBgmBase());
      bgm.muted = bgm.volume <= 0;
    });

    bgm.addEventListener("play", () => {
      setUiPlaying(true);
      syncWeatherAmbience();
    });
    bgm.addEventListener("pause", () => {
      setUiPlaying(false);
      syncWeatherAmbience();
    });
    bgm.addEventListener("volumechange", () => {
      syncVolumeUi();
      syncWeatherAmbience();
    });
  }

  // Update the hint to reflect the actual minutes per day based on constants.
  const minutesPerDay = (MS_PER_DAY / 60000).toFixed(1);
  const hintEl = document.getElementById("dayLengthMinutes");
  if (hintEl) {
    hintEl.textContent = minutesPerDay;
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
    const weatherDef = WEATHER[state.weatherMachineSelection];
    const weatherName = weatherDef?.name ?? state.weatherMachineSelection;
    const weatherCssClass = state.weatherMachineSelection === "sun" ? "text--sun" : (state.weatherMachineSelection === "rain" ? "text--rain" : "");
    info.innerHTML = `Tomorrow: ${weatherIcon(state.weatherMachineSelection)} <span class="${weatherCssClass}">${weatherName}</span> · Change chance: ${chance}% (spent €${spent})`;
  }
}

function updateShopInfo() {
  const crop = CROPS[state.selectedSeedId];
  const seedInfo = document.getElementById("seedInfo");
  const sunMult = crop?.weatherGrowthMultipliers?.sun ?? 1;
  const rainMult = crop?.weatherGrowthMultipliers?.rain ?? 1;
  const waterAdjMult = crop?.adjacentWaterloggedGrowthMultiplier ?? null;
  const scorchedMult = crop?.scorchedGrowthMultiplier ?? null;
  const infoText = crop
    ? [
        `Harvest €${crop.harvestValue}.`,
        `Grows in ${crop.daysToGrow} days.`,
        `Sun x${sunMult.toFixed(2)}, Rain x${rainMult.toFixed(2)}.`,
        waterAdjMult ? `Adjacent waterlogged: x${waterAdjMult.toFixed(2)}.` : "",
        scorchedMult ? `On scorched soil: x${scorchedMult.toFixed(2)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  seedInfo.textContent = infoText;

  const inventoryGrid = document.getElementById("inventoryGrid");
  if (inventoryGrid) {
    inventoryGrid.innerHTML = "";
    for (const cropId of SEED_KEY_ORDER) {
      const cropDef = CROPS[cropId];
      const itemEl = document.createElement("div");
      itemEl.className = "inventoryItem";
      if (cropId === state.selectedSeedId) {
        itemEl.classList.add("inventoryItem--selected");
      }
      
      itemEl.addEventListener("click", () => {
        state.selectedSeedId = cropId;
        const seedSelect = document.getElementById("seedSelect");
        if (seedSelect) seedSelect.value = cropId;
        updateShopInfo();
        updateHighlights();
      });

      const imgEl = document.createElement("img");
      imgEl.className = "inventoryItem__img";
      imgEl.src = `./assets/sprites/pixel-${cropDef.id}-grown.svg`;
      imgEl.alt = cropDef.name;
      itemEl.appendChild(imgEl);

      const countEl = document.createElement("div");
      countEl.className = "inventoryItem__count";
      countEl.textContent = state.inventory[cropDef.id] ?? 0;
      itemEl.appendChild(countEl);

      inventoryGrid.appendChild(itemEl);
    }
  }

  const btn = document.getElementById("buySeedBtn");
  const btn5 = document.getElementById("buySeed5Btn");
  const btn10 = document.getElementById("buySeed10Btn");
  const isAtShop = state.farmer.x === 13 && state.farmer.y === 0;

  if (btn) btn.disabled = state.sunriseTransition || !crop || !isAtShop || state.money < crop.seedCost * 1;
  if (btn5) btn5.disabled = state.sunriseTransition || !crop || !isAtShop || state.money < crop.seedCost * 5;
  if (btn10) btn10.disabled = state.sunriseTransition || !crop || !isAtShop || state.money < crop.seedCost * 10;

  if (!isAtShop && seedInfo) {
    seedInfo.innerHTML = `<span style="color:var(--danger);font-weight:bold;">Stand on Shop tile (top-right) to buy</span><br/>${infoText}`;
  }
}

function updateHud() {
  document.getElementById("dayValue").textContent = String(state.day);
  document.getElementById("timeValue").textContent = formatTimeOfDay(state.msIntoDay);
  
  const iconEl = document.getElementById("weatherIcon");
  if (isNighttime()) {
    const valEl = document.getElementById("weatherValue");
    valEl.innerHTML = `<span class="text--night">Night</span>`;
    if (iconEl) iconEl.textContent = "🌙";
  } else {
    const weatherDef = WEATHER[state.weatherId];
    const weatherName = weatherDef?.name ?? state.weatherId;
    const weatherCssClass = state.weatherId === "sun" ? "text--sun" : (state.weatherId === "rain" ? "text--rain" : "");
    const weatherValueEl = document.getElementById("weatherValue");
    weatherValueEl.innerHTML = `<span class="${weatherCssClass}">${weatherName}</span>`;
    if (iconEl) iconEl.textContent = weatherIcon(state.weatherId);
  }

  document.getElementById("moneyValue").textContent = String(state.money);
}

function tryMove(dx, dy) {
  const nx = state.farmer.x + dx;
  const ny = state.farmer.y + dy;
  if (nx < 0 || ny < 0 || nx >= WORLD_SIZE || ny >= WORLD_SIZE) return;

  state.farmer.x = nx;
  state.farmer.y = ny;
  updateHighlights();
  syncFarmerDom();
}

function tryPlantHere() {
  const cropId = state.selectedSeedId;
  const have = state.inventory[cropId] ?? 0;
  if (have <= 0) return;

  const tile = state.tiles[tileIndex(state.farmer.x, state.farmer.y)];
  if (!tile || tile.kind !== "field") return;

  // Rotted tiles are black for 1 in-game day: can't plant.
  if (tile.blackMsRemaining > 0) return;

  // Only plant if empty or already harvested (no crop).
  if (tile.crop) return;

  const x = state.farmer.x;
  const y = state.farmer.y;

  // Waterlogged tiles are never plantable.
  if (tile.waterlogged) return;

  if (cropId === "cactusfruit") {
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
  tile.dirty = true;

  updateShopInfo();
  updateHighlights();
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  renderTile(idx);
}

function tryHarvestHere() {
  const tile = state.tiles[tileIndex(state.farmer.x, state.farmer.y)];
  if (!tile || tile.kind !== "field" || !tile.crop) return;

  const cropDef = CROPS[tile.crop.cropId];
  if (!cropDef) return;
  if (tile.crop.progress < 1) return;

  state.money += cropDef.harvestValue;
  tile.crop = null;
  tile.readyRotMsRemaining = 0;
  tile.blackMsRemaining = 0;
  tile.dirty = true;
  updateHud();
  updateShopInfo();
  updateHighlights();
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  renderTile(idx);
}

function syncFarmerDom() {
  if (!farmerEl) return;
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  if (idx === lastFarmerIdx) return;
  const el = tileEls[idx];
  if (!el) return;
  el.appendChild(farmerEl);
  lastFarmerIdx = idx;
}

function renderTile(idx, force = false) {
  const tile = state.tiles[idx];
  if (!tile) return;
  if (!force && !tile.dirty) return;
  tile.dirty = false;

  const el = tileEls[idx];
  if (!tile || !el) return;

  const isBlack = tile.kind === "field" && tile.blackMsRemaining > 0;
  el.classList.toggle("tile--waterlogged", tile.kind === "field" && tile.waterlogged && !isBlack);
  el.classList.toggle("tile--scorched", tile.kind === "field" && tile.scorched && !isBlack);
  el.classList.toggle("tile--black", isBlack);

  const cropEl = cropEls[idx];
  const labelEl = cropLabels[idx];
  const fillEl = cropBarFills[idx];
  const harvestEl = harvestReadyEls[idx];
  if (!cropEl || !labelEl || !fillEl || !harvestEl) return;

  if (tile.kind === "field" && tile.crop && !isBlack) {
    const cropId = tile.crop.cropId;
    const cropDef = CROPS[cropId];
    const progress = tile.crop.progress;
    const stage = cropStage(progress);

    cropEl.dataset.stage = stage;
    cropEl.dataset.crop = cropId;

    const imgEl = cropImgs[idx];
    if (lastCropIdByIdx[idx] !== cropId || lastCropStageByIdx[idx] !== stage) {
      labelEl.textContent = cropDef?.name ?? "?"; // kept for accessibility/fallback
      cropEl.style.background = "transparent";
      if (imgEl) {
        imgEl.src = `./assets/sprites/pixel-${cropId}-${stage}.svg`;
        imgEl.alt = `${cropDef?.name ?? cropId} (${stage})`;
      }
      lastCropIdByIdx[idx] = cropId;
      lastCropStageByIdx[idx] = stage;
    }

    fillEl.style.width = `${Math.floor(clamp01(progress) * 100)}%`;
    cropEl.style.display = "";

    harvestEl.style.display = progress >= 1 ? "" : "none";
  } else {
    cropEl.style.display = "none";
    harvestEl.style.display = "none";
  }
}

function renderAll(force = false) {
  for (let i = 0; i < state.tiles.length; i++) {
    renderTile(i, force);
  }
  syncFarmerDom();
}

function updateHighlights() {
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  const tile = state.tiles[idx];

  if (!tile || tile.kind !== "field") {
    if (lastHighlightedIdx != null) tileEls[lastHighlightedIdx]?.classList.remove("tile--highlight");
    lastHighlightedIdx = null;
    return;
  }

  if (lastHighlightedIdx === idx) return;
  if (lastHighlightedIdx != null) tileEls[lastHighlightedIdx]?.classList.remove("tile--highlight");
  tileEls[idx]?.classList.add("tile--highlight");
  lastHighlightedIdx = idx;
}


