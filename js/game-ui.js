// ---- DOM caching for fast rendering ----
const TILE_COUNT = WORLD_SIZE * WORLD_SIZE;
let tileElements = [];
let cropElements = [];
let cropLabels = [];
let cropImageElements = [];
let cropBarFillElements = [];
let harvestReadyElements = [];
let farmerElement = null;
let lastFarmerIdx = null;
let lastHighlightedIdx = null;
let lastCropIdByIdx = new Array(TILE_COUNT).fill(null);
let lastCropStageByIdx = new Array(TILE_COUNT).fill(null);
let dirtyTileSet = new Set();

// HUD element cache
let hudDayElement, hudTimeElement, hudWeatherIconElement, hudWeatherValueElement, hudMoneyElement;
let lastHudDay, lastHudTime, lastHudWeatherId, lastHudIsNight, lastHudMoney;
let weatherMachineSunButtonElement, weatherMachineRainButtonElement, weatherMachineInfoElement;
let lastWeatherMachineInfoHtml = "";
let shopSeedInfoElement, inventoryGridElement, buySeedButtonElement, buySeed5ButtonElement, buySeed10ButtonElement, seedSelectElementCache;
let pauseButtonElement;
let inventoryItemElements = {};
let inventoryCountElements = {};
let lastInventoryCounts = {};
let lastSelectedSeedId = null;
const uiDisposers = [];

function addUiDisposer(disposeFn) {
  if (typeof disposeFn !== "function") return;
  uiDisposers.push(disposeFn);
  if (typeof wfRegisterAppDisposer === "function") {
    wfRegisterAppDisposer(disposeFn);
  }
}

function disposeUi() {
  while (uiDisposers.length) {
    const disposeFn = uiDisposers.pop();
    try {
      disposeFn();
    } catch (_) {}
  }
}
window.disposeUi = disposeUi;

function markTileDirty(idx) {
  if (idx < 0 || idx >= TILE_COUNT) return;
  dirtyTileSet.add(idx);
  const tile = state.tiles[idx];
  if (tile) tile.dirty = true;
}

function hasDirtyTiles() {
  return dirtyTileSet.size > 0;
}

function setPaused(next) {
  state.paused = Boolean(next);
  const pauseButton = pauseButtonElement || document.getElementById("pause-btn");
  if (pauseButton) pauseButton.textContent = state.paused ? "Resume" : "Pause";
}

function buildGridDom() {
  const gridEl = document.getElementById("grid");
  gridEl.innerHTML = "";

  tileElements = new Array(TILE_COUNT);
  cropElements = new Array(TILE_COUNT);
  cropLabels = new Array(TILE_COUNT);
  cropImageElements = new Array(TILE_COUNT);
  cropBarFillElements = new Array(TILE_COUNT);
  harvestReadyElements = new Array(TILE_COUNT);
  lastFarmerIdx = null;
  lastHighlightedIdx = null;
  lastCropIdByIdx = new Array(TILE_COUNT).fill(null);
  lastCropStageByIdx = new Array(TILE_COUNT).fill(null);
  dirtyTileSet = new Set();

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const idx = tileIndex(x, y);
      const tile = state.tiles[idx];

      const el = document.createElement("div");
      el.className = `tile ${tile.kind === "field" ? "tile--field" : "tile--path"}`;
      if (tile.kind === "field" && (x + y) % 2 === 0) el.classList.add("alt");
      
      if (tile.kind === "path") {
        let suffix = "";
        if (x === PATH_MIN_X && y === PATH_MIN_Y) suffix = "tl";
        else if (x === PATH_MAX_X && y === PATH_MIN_Y) suffix = "tr";
        else if (x === PATH_MIN_X && y === PATH_MAX_Y) suffix = "bl";
        else if (x === PATH_MAX_X && y === PATH_MAX_Y) suffix = "br";
        else if (x === PATH_MIN_X || x === PATH_MAX_X) suffix = "v";
        else suffix = "h";

        el.style.backgroundImage = `url('./assets/sprites/pixel-path-${suffix}.svg')`;
      }
      el.setAttribute("role", "gridcell");
      
      if (x === SHOP_TILE_X && y === SHOP_TILE_Y) {
        const shopIcon = document.createElement("img");
        shopIcon.src = "./assets/sprites/pixel-shop.svg";
        shopIcon.className = "shop-icon--map"; // Swaying animation
        shopIcon.style.position = "absolute";
        shopIcon.style.inset = "5%";
        shopIcon.style.width = "90%";
        shopIcon.style.height = "90%";
        shopIcon.style.objectFit = "cover";
        shopIcon.style.imageRendering = "pixelated";
        el.appendChild(shopIcon);
      }

      if (x === WEATHER_MACHINE_TILE_X && y === WEATHER_MACHINE_TILE_Y) {
        const weatherMachineIcon = document.createElement("img");
        weatherMachineIcon.src = "./assets/sprites/pixel-weather-machine.svg";
        weatherMachineIcon.className = "weather-machine-icon--map"; // Pulsing CSS animation
        weatherMachineIcon.style.position = "absolute";
        weatherMachineIcon.style.inset = "5%";
        weatherMachineIcon.style.width = "90%";
        weatherMachineIcon.style.height = "90%";
        weatherMachineIcon.style.objectFit = "cover";
        weatherMachineIcon.style.imageRendering = "pixelated";
        el.appendChild(weatherMachineIcon);
      }

      gridEl.appendChild(el);
      tileElements[idx] = el;

      if (tile.kind === "field") {
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
        progressBarFill.className = "crop__bar-fill";
        progressBarFill.style.width = "0%";
        bar.appendChild(progressBarFill);
        cropEl.appendChild(bar);

        el.appendChild(cropEl);

        // Pre-create harvest-ready indicator (hidden unless progress >= 1).
        const harvestEl = document.createElement("div");
        harvestEl.className = "harvest-ready";
        harvestEl.textContent = "!";
        harvestEl.title = "Ready to harvest (press E)";
        harvestEl.style.display = "none";
        el.appendChild(harvestEl);

        cropElements[idx] = cropEl;
        cropLabels[idx] = labelEl;
        cropImageElements[idx] = imgEl;
        cropBarFillElements[idx] = progressBarFill;
        harvestReadyElements[idx] = harvestEl;
      } else {
        // Path tiles don't need crop/harvest elements.
        cropElements[idx] = null;
        cropLabels[idx] = null;
        cropImageElements[idx] = null;
        cropBarFillElements[idx] = null;
        harvestReadyElements[idx] = null;
      }
    }
  }

  // Create a single farmer element; we move it between tiles on demand.
  farmerElement = document.createElement("div");
  farmerElement.className = "farmer";
  const farmerImg = document.createElement("img");
  farmerImg.className = "farmer__img";
  farmerImg.alt = "Pixel farmer";
  farmerImg.src = "./assets/sprites/pixel-farmer.svg";
  farmerElement.appendChild(farmerImg);
}

function bindUi() {
  const seedSelect = document.getElementById("seed-select");
  pauseButtonElement = document.getElementById("pause-btn");
  setupSeedSelectUi(seedSelect);
  const offUiSync = onUiSync((flags) => {
    if (flags?.hud) updateHud();
    if (flags?.shop) updateShopInfo();
    if (flags?.weatherMachine) updateWeatherMachineUi();
    if (flags?.highlights) updateHighlights();
  });
  addUiDisposer(offUiSync);

  function tryBuySelectedSeed(count = 1) {
    if (state.sunriseTransition) return;
    if (!isAtShopTile()) return;
    const crop = CROPS[state.selectedSeedId];
    if (!crop) return;
    if (count <= 0) return;
    const cost = crop.seedCost * count;
    if (state.moneyEur < cost) return;

    state.moneyEur -= cost;
    state.inventory[crop.id] = (state.inventory[crop.id] ?? 0) + count;
    emitUiSync({ hud: true, shop: true, weatherMachine: true });
  }

  setupSeedPurchaseUi(tryBuySelectedSeed);

  const pauseBtn = pauseButtonElement;
  if (pauseBtn) {
    const onPauseClick = () => setPaused(!state.paused);
    pauseBtn.addEventListener("click", onPauseClick);
    addUiDisposer(() => pauseBtn.removeEventListener("click", onPauseClick));
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
      emitUiSync({ shop: true, weatherMachine: true });
    }
  }

  function commitWeatherMachineSpend(amount) {
    if (amount <= 0) return;
    if (state.moneyEur < amount) return;

    state.moneyEur -= amount;
    state.weatherMachineSpendCommitted += amount;

    emitUiSync({ hud: true, shop: true, weatherMachine: true });
  }

  setupWeatherMachineUiHandlers(commitWeatherMachineSpend);
  setupKeyboardControls(seedSelect, tryBuySelectedSeed, () => {
    holdingPlant = true;
  }, () => {
    holdingHarvest = true;
  }, () => {
    holdingPlant = false;
  }, () => {
    holdingHarvest = false;
  }, doMove);

  emitUiSync({ shop: true, weatherMachine: true });
  setPaused(state.paused);

  // Cache frequently-updated UI elements once.
  weatherMachineSunButtonElement = document.getElementById("weather-machine-sun-btn");
  weatherMachineRainButtonElement = document.getElementById("weather-machine-rain-btn");
  weatherMachineInfoElement = document.getElementById("weather-machine-info");
  shopSeedInfoElement = document.getElementById("seed-info");
  inventoryGridElement = document.getElementById("inventory-grid");
  setupInventoryGridUi();
  setupSaveLoadControls();
  setupMusicControls();
  updateDayLengthHintUi();
}

function isAtShopTile() {
  return state.farmer.x === SHOP_TILE_X && state.farmer.y === SHOP_TILE_Y;
}

function isAtWeatherMachineTile() {
  return state.farmer.x === WEATHER_MACHINE_TILE_X && state.farmer.y === WEATHER_MACHINE_TILE_Y;
}

function setupSeedSelectUi(seedSelect) {
  seedSelectElementCache = seedSelect;
  seedSelect.innerHTML = "";
  for (const crop of Object.values(CROPS)) {
    const seedOption = document.createElement("option");
    seedOption.value = crop.id;
    seedOption.textContent = `${crop.name} (€${crop.seedCost})`;
    seedSelect.appendChild(seedOption);
  }
  seedSelect.value = state.selectedSeedId;
  const onSeedChange = () => {
    state.selectedSeedId = seedSelect.value;
    emitUiSync({ shop: true, highlights: true });
  };
  seedSelect.addEventListener("change", onSeedChange);
  addUiDisposer(() => seedSelect.removeEventListener("change", onSeedChange));
}

function setupSeedPurchaseUi(tryBuySelectedSeed) {
  const buySeedBtn = document.getElementById("buy-seed-btn");
  const buySeed5Btn = document.getElementById("buy-seed-5-btn");
  const buySeed10Btn = document.getElementById("buy-seed-10-btn");
  if (buySeedBtn) {
    const onBuy1 = () => tryBuySelectedSeed(1);
    buySeedBtn.addEventListener("click", onBuy1);
    addUiDisposer(() => buySeedBtn.removeEventListener("click", onBuy1));
  }

  buySeedButtonElement = buySeedBtn;
  buySeed5ButtonElement = buySeed5Btn;
  buySeed10ButtonElement = buySeed10Btn;

  if (buySeed5Btn) {
    const onBuy5 = () => tryBuySelectedSeed(5);
    buySeed5Btn.addEventListener("click", onBuy5);
    addUiDisposer(() => buySeed5Btn.removeEventListener("click", onBuy5));
  }
  if (buySeed10Btn) {
    const onBuy10 = () => tryBuySelectedSeed(10);
    buySeed10Btn.addEventListener("click", onBuy10);
    addUiDisposer(() => buySeed10Btn.removeEventListener("click", onBuy10));
  }
}

function setupWeatherMachineUiHandlers(commitWeatherMachineSpend) {
  const sunBtn = document.getElementById("weather-machine-sun-btn");
  const rainBtn = document.getElementById("weather-machine-rain-btn");
  if (sunBtn) {
    const onSunClick = () => {
      if (state.sunriseTransition || !isAtWeatherMachineTile()) return;
      state.weatherMachineSelection = "sun";
      commitWeatherMachineSpend(WEATHER_SPEND_UNIT_EUR);
    };
    sunBtn.addEventListener("click", onSunClick);
    addUiDisposer(() => sunBtn.removeEventListener("click", onSunClick));
  }
  if (rainBtn) {
    const onRainClick = () => {
      if (state.sunriseTransition || !isAtWeatherMachineTile()) return;
      state.weatherMachineSelection = "rain";
      commitWeatherMachineSpend(WEATHER_SPEND_UNIT_EUR);
    };
    rainBtn.addEventListener("click", onRainClick);
    addUiDisposer(() => rainBtn.removeEventListener("click", onRainClick));
  }
}

function setupKeyboardControls(seedSelect, tryBuySelectedSeed, setHoldingPlant, setHoldingHarvest, clearHoldingPlant, clearHoldingHarvest, doMove) {
  const onKeyDown = (e) => {
    const key = e.key.toLowerCase();
    if (key === "p") {
      setPaused(!state.paused);
      return;
    }

    if (state.paused) return;

    const activeTag = (document.activeElement?.tagName ?? "").toLowerCase();
    const isTyping = ["input", "textarea", "select"].includes(activeTag);
    if (isTyping) return;

    if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright", " ", "e"].includes(key)) {
      e.preventDefault();
    }

    if (key === "w" || key === "arrowup") doMove(0, -1);
    if (key === "a" || key === "arrowleft") doMove(-1, 0);
    if (key === "s" || key === "arrowdown") doMove(0, 1);
    if (key === "d" || key === "arrowright") doMove(1, 0);

    if (key === " ") {
      setHoldingPlant();
      if (!e.repeat) tryPlantHere();
    }
    if (key === "e") {
      setHoldingHarvest();
      if (!e.repeat) tryHarvestHere();
    }

    if (/^[1-5]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const nextSeedId = SEED_KEY_ORDER[idx];
      if (nextSeedId) {
        state.selectedSeedId = nextSeedId;
        if (seedSelect) seedSelect.value = nextSeedId;
        emitUiSync({ shop: true, highlights: true });
      }
    }
    if (key === "b") tryBuySelectedSeed(1);
    if (key === "n") tryBuySelectedSeed(5);
    if (key === "m") tryBuySelectedSeed(10);
  };
  window.addEventListener("keydown", onKeyDown);
  addUiDisposer(() => window.removeEventListener("keydown", onKeyDown));

  const onKeyUp = (e) => {
    const key = e.key.toLowerCase();
    if (key === " ") clearHoldingPlant();
    if (key === "e") clearHoldingHarvest();
  };
  window.addEventListener("keyup", onKeyUp);
  addUiDisposer(() => window.removeEventListener("keyup", onKeyUp));
}

function setupInventoryGridUi() {
  if (!inventoryGridElement) return;
  inventoryGridElement.innerHTML = "";
  for (const cropId of SEED_KEY_ORDER) {
    const cropDef = CROPS[cropId];
    const itemEl = document.createElement("div");
    itemEl.className = "inventory-item";
    const onInventoryClick = () => {
      state.selectedSeedId = cropId;
      if (seedSelectElementCache) seedSelectElementCache.value = cropId;
      emitUiSync({ shop: true, highlights: true });
    };
    itemEl.addEventListener("click", onInventoryClick);
    addUiDisposer(() => itemEl.removeEventListener("click", onInventoryClick));

    const imgEl = document.createElement("img");
    imgEl.className = "inventory-item__img";
    imgEl.src = `./assets/sprites/pixel-${cropDef.id}-grown.svg`;
    imgEl.alt = cropDef.name;
    itemEl.appendChild(imgEl);

    const countEl = document.createElement("div");
    countEl.className = "inventory-item__count";
    itemEl.appendChild(countEl);

    inventoryGridElement.appendChild(itemEl);
    inventoryItemElements[cropId] = itemEl;
    inventoryCountElements[cropId] = countEl;
    lastInventoryCounts[cropId] = null;
  }
}

function setupSaveLoadControls() {
  const saveBtn = document.getElementById("save-csv-btn");
  const loadBtn = document.getElementById("load-csv-btn");
  const loadInput = document.getElementById("load-csv-input");
  const statusEl = document.getElementById("save-load-status");

  if (saveBtn) {
    const onSaveClick = () => {
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
    };
    saveBtn.addEventListener("click", onSaveClick);
    addUiDisposer(() => saveBtn.removeEventListener("click", onSaveClick));
  }

  if (loadBtn && loadInput) {
    const onLoadClick = () => {
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
          emitUiSync({ hud: true, shop: true, weatherMachine: true, highlights: true });
          if (statusEl) statusEl.textContent = "CSV loaded successfully.";
        } catch (err) {
          if (statusEl) statusEl.textContent = `Load failed: ${err?.message ?? err}`;
        }
      };
      reader.onerror = () => {
        if (statusEl) statusEl.textContent = "Load failed: file read error.";
      };
      reader.readAsText(file);
    };
    loadBtn.addEventListener("click", onLoadClick);
    addUiDisposer(() => loadBtn.removeEventListener("click", onLoadClick));
  }
}

function setupMusicControls() {
  const bgm = document.getElementById("bgm");
  const musicPlayBtn = document.getElementById("music-play-btn");
  const musicPauseBtn = document.getElementById("music-pause-btn");
  const musicVolumeInput = document.getElementById("music-volume");
  const musicVolumeValue = document.getElementById("music-volume-value");

  if (bgm && musicPlayBtn && musicPauseBtn && musicVolumeInput && musicVolumeValue) {
    const setUiPlaying = (isPlaying) => {
      musicPlayBtn.disabled = isPlaying;
      musicPauseBtn.disabled = !isPlaying;
    };

    const syncVolumeUi = () => {
      const volumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
      if (musicVolumeValue.textContent !== `${volumePercent}%`) musicVolumeValue.textContent = `${volumePercent}%`;
    };

    syncVolumeUi();
    const initialVolumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
    state.musicVolumePercent = initialVolumePercent;
    bgm.volume = clamp01((initialVolumePercent / 100) * getBgmBase());
    bgm.muted = false;
    setUiPlaying(false);
    musicPauseBtn.disabled = true;

    bgm.play().catch(() => {});

    const onMusicPlayClick = async () => {
      try {
        await bgm.play();
      } catch {
        // Autoplay / interaction restrictions can prevent play; UI stays in paused state.
      }
    };
    musicPlayBtn.addEventListener("click", onMusicPlayClick);
    addUiDisposer(() => musicPlayBtn.removeEventListener("click", onMusicPlayClick));

    const onMusicPauseClick = () => {
      bgm.pause();
    };
    musicPauseBtn.addEventListener("click", onMusicPauseClick);
    addUiDisposer(() => musicPauseBtn.removeEventListener("click", onMusicPauseClick));

    const onMusicVolumeInput = () => {
      syncVolumeUi();
      const volumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
      state.musicVolumePercent = volumePercent;
      bgm.volume = clamp01((volumePercent / 100) * getBgmBase());
      bgm.muted = bgm.volume <= 0;
    };
    musicVolumeInput.addEventListener("input", onMusicVolumeInput);
    addUiDisposer(() => musicVolumeInput.removeEventListener("input", onMusicVolumeInput));

    const onBgmPlay = () => {
      setUiPlaying(true);
      syncWeatherAmbience();
    };
    const onBgmPause = () => {
      setUiPlaying(false);
      syncWeatherAmbience();
    };
    const onBgmVolumeChange = () => {
      syncVolumeUi();
      syncWeatherAmbience();
    };
    bgm.addEventListener("play", onBgmPlay);
    bgm.addEventListener("pause", onBgmPause);
    bgm.addEventListener("volumechange", onBgmVolumeChange);
    addUiDisposer(() => bgm.removeEventListener("play", onBgmPlay));
    addUiDisposer(() => bgm.removeEventListener("pause", onBgmPause));
    addUiDisposer(() => bgm.removeEventListener("volumechange", onBgmVolumeChange));
  }
}

function updateDayLengthHintUi() {
  const minutesPerDay = (MS_PER_DAY / 60000).toFixed(1);
  const hintEl = document.getElementById("day-length-minutes");
  if (hintEl) {
    hintEl.textContent = minutesPerDay;
  }
}

function updateWeatherMachineUi() {
  if (!weatherMachineSunButtonElement) weatherMachineSunButtonElement = document.getElementById("weather-machine-sun-btn");
  if (!weatherMachineRainButtonElement) weatherMachineRainButtonElement = document.getElementById("weather-machine-rain-btn");
  if (!weatherMachineInfoElement) weatherMachineInfoElement = document.getElementById("weather-machine-info");
  const isAtMachine = isAtWeatherMachineTile();
  const isEnabled = isAtMachine && !state.sunriseTransition;

  if (weatherMachineSunButtonElement) {
    weatherMachineSunButtonElement.classList.toggle("btn--active", state.weatherMachineSelection === "sun");
    weatherMachineSunButtonElement.disabled = !isEnabled;
  }
  if (weatherMachineRainButtonElement) {
    weatherMachineRainButtonElement.classList.toggle("btn--active", state.weatherMachineSelection === "rain");
    weatherMachineRainButtonElement.disabled = !isEnabled;
  }

  if (weatherMachineInfoElement) {
    const chance = Math.round(getEffectiveWeatherChangeChance() * 100);
    const spent = state.weatherMachineSpendCommitted ?? 0;
    const weatherDef = WEATHER[state.weatherMachineSelection];
    const weatherName = weatherDef?.name ?? state.weatherMachineSelection;
    const weatherCssClass = state.weatherMachineSelection === "sun" ? "text--sun" : (state.weatherMachineSelection === "rain" ? "text--rain" : "");
    let infoHtml = `Tomorrow: ${weatherIcon(state.weatherMachineSelection)} <span class="${weatherCssClass}">${weatherName}</span> · Change chance: ${chance}% (spent €${spent})`;

    if (!isAtMachine) {
      infoHtml = `<span style="color:var(--danger);font-weight:bold;">Stand on Machine (bottom-right) to use</span><br/>${infoHtml}`;
    }
    if (lastWeatherMachineInfoHtml !== infoHtml) {
      weatherMachineInfoElement.innerHTML = infoHtml;
      lastWeatherMachineInfoHtml = infoHtml;
    }
  }
}

function updateShopInfo() {
  const crop = CROPS[state.selectedSeedId];
  if (!shopSeedInfoElement) shopSeedInfoElement = document.getElementById("seed-info");
  if (!buySeedButtonElement) buySeedButtonElement = document.getElementById("buy-seed-btn");
  if (!buySeed5ButtonElement) buySeed5ButtonElement = document.getElementById("buy-seed-5-btn");
  if (!buySeed10ButtonElement) buySeed10ButtonElement = document.getElementById("buy-seed-10-btn");
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
  for (const cropId of SEED_KEY_ORDER) {
    const itemEl = inventoryItemElements[cropId];
    const countEl = inventoryCountElements[cropId];
    if (itemEl) itemEl.classList.toggle("inventory-item--selected", cropId === state.selectedSeedId);
    const nextCount = state.inventory[cropId] ?? 0;
    if (countEl && lastInventoryCounts[cropId] !== nextCount) {
      countEl.textContent = String(nextCount);
      lastInventoryCounts[cropId] = nextCount;
    }
  }

  const isAtShop = isAtShopTile();
  const seedInfoText = !isAtShop
    ? `<span style="color:var(--danger);font-weight:bold;">Stand on Shop tile (top-right) to buy</span><br/>${infoText}`
    : infoText;
  if (shopSeedInfoElement) {
    if (isAtShop) {
      if (shopSeedInfoElement.textContent !== seedInfoText) shopSeedInfoElement.textContent = seedInfoText;
    } else if (shopSeedInfoElement.innerHTML !== seedInfoText) {
      shopSeedInfoElement.innerHTML = seedInfoText;
    }
  }

  if (buySeedButtonElement) buySeedButtonElement.disabled = state.sunriseTransition || !crop || !isAtShop || state.moneyEur < crop.seedCost * 1;
  if (buySeed5ButtonElement) buySeed5ButtonElement.disabled = state.sunriseTransition || !crop || !isAtShop || state.moneyEur < crop.seedCost * 5;
  if (buySeed10ButtonElement) buySeed10ButtonElement.disabled = state.sunriseTransition || !crop || !isAtShop || state.moneyEur < crop.seedCost * 10;
  lastSelectedSeedId = state.selectedSeedId;
}

function updateHud() {
  if (!hudDayElement) {
    hudDayElement = document.getElementById("day-value");
    hudTimeElement = document.getElementById("time-value");
    hudWeatherIconElement = document.getElementById("weather-icon");
    hudWeatherValueElement = document.getElementById("weather-value");
    hudMoneyElement = document.getElementById("money-value");
  }

  if (lastHudDay !== state.day) {
    hudDayElement.textContent = String(state.day);
    lastHudDay = state.day;
  }

  const timeStr = formatTimeOfDay(state.dayElapsedMs);
  if (lastHudTime !== timeStr) {
    hudTimeElement.textContent = timeStr;
    lastHudTime = timeStr;
  }
  
  const isNight = isNighttime();
  if (lastHudWeatherId !== state.weatherId || lastHudIsNight !== isNight) {
    if (isNight) {
      hudWeatherValueElement.innerHTML = `<span class="text--night">Night</span>`;
      if (hudWeatherIconElement) hudWeatherIconElement.textContent = "🌙";
    } else {
      const weatherDef = WEATHER[state.weatherId];
      const weatherName = weatherDef?.name ?? state.weatherId;
      const weatherCssClass = state.weatherId === "sun" ? "text--sun" : (state.weatherId === "rain" ? "text--rain" : "");
      hudWeatherValueElement.innerHTML = `<span class="${weatherCssClass}">${weatherName}</span>`;
      if (hudWeatherIconElement) hudWeatherIconElement.textContent = weatherIcon(state.weatherId);
    }
    lastHudWeatherId = state.weatherId;
    lastHudIsNight = isNight;
  }

  if (lastHudMoney !== state.moneyEur) {
    hudMoneyElement.textContent = String(state.moneyEur);
    lastHudMoney = state.moneyEur;
  }
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
  markTileDirty(tileIndex(x, y));

  emitUiSync({ shop: true, highlights: true });
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  renderTile(idx);
}

function tryHarvestHere() {
  const tile = state.tiles[tileIndex(state.farmer.x, state.farmer.y)];
  if (!tile || tile.kind !== "field" || !tile.crop) return;

  const cropDef = CROPS[tile.crop.cropId];
  if (!cropDef) return;
  if (tile.crop.progress < 1) return;

  state.moneyEur += cropDef.harvestValue;
  tile.crop = null;
  tile.readyRotMsRemaining = 0;
  tile.blackMsRemaining = 0;
  markTileDirty(tileIndex(state.farmer.x, state.farmer.y));
  emitUiSync({ hud: true, shop: true, highlights: true });
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  renderTile(idx);
}

function syncFarmerDom() {
  if (!farmerElement) return;
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  if (idx === lastFarmerIdx) return;
  const el = tileElements[idx];
  if (!el) return;
  el.appendChild(farmerElement);
  lastFarmerIdx = idx;
}

function renderTile(idx, force = false) {
  const tile = state.tiles[idx];
  if (!tile) return;
  if (!force && !dirtyTileSet.has(idx)) return;
  dirtyTileSet.delete(idx);
  tile.dirty = false;

  const el = tileElements[idx];
  if (!tile || !el) return;

  const isBlack = tile.kind === "field" && tile.blackMsRemaining > 0;
  el.classList.toggle("tile--waterlogged", tile.kind === "field" && tile.waterlogged && !isBlack);
  el.classList.toggle("tile--scorched", tile.kind === "field" && tile.scorched && !isBlack);
  el.classList.toggle("tile--black", isBlack);

  const cropEl = cropElements[idx];
  const labelEl = cropLabels[idx];
  const fillEl = cropBarFillElements[idx];
  const harvestEl = harvestReadyElements[idx];
  if (!cropEl || !labelEl || !fillEl || !harvestEl) return;

  if (tile.kind === "field" && tile.crop && !isBlack) {
    const cropId = tile.crop.cropId;
    const cropDef = CROPS[cropId];
    const progress = tile.crop.progress;
    const stage = cropStage(progress);

    cropEl.dataset.stage = stage;
    cropEl.dataset.crop = cropId;

    const imgEl = cropImageElements[idx];
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
  if (force) {
    for (let i = 0; i < state.tiles.length; i++) {
      renderTile(i, true);
    }
  } else {
    const dirtyList = Array.from(dirtyTileSet);
    for (const idx of dirtyList) {
      renderTile(idx, false);
    }
  }
  syncFarmerDom();
}

function updateHighlights() {
  const idx = tileIndex(state.farmer.x, state.farmer.y);
  const tile = state.tiles[idx];

  if (!tile || tile.kind !== "field") {
    if (lastHighlightedIdx != null) tileElements[lastHighlightedIdx]?.classList.remove("tile--highlight");
    lastHighlightedIdx = null;
    return;
  }

  if (lastHighlightedIdx === idx) return;
  if (lastHighlightedIdx != null) tileElements[lastHighlightedIdx]?.classList.remove("tile--highlight");
  tileElements[idx]?.classList.add("tile--highlight");
  lastHighlightedIdx = idx;
}


