// ---- Event binding and setup ----

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

  const skipTo7amBtn = document.getElementById("skip-to-7am-btn");
  if (skipTo7amBtn) {
    const onSkipTo7am = () => {
      state.roosterPlayedToday = false;
      state.dayElapsedMs = ROOSTER_THRESHOLD_MS;
      processSunriseIfNeeded();
      emitUiSync({ hud: true });
    };
    skipTo7amBtn.addEventListener("click", onSkipTo7am);
    addUiDisposer(() => skipTo7amBtn.removeEventListener("click", onSkipTo7am));
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
      const building = getBuildingAtFarmer();
      if (building) showBuildingInterior(building);
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
  for (const id of Object.keys(WEATHER)) {
    weatherMachineButtonElements[id] = document.getElementById(`weather-machine-${id}-btn`);
  }
  weatherMachineInfoElement = document.getElementById("weather-machine-info");
  shopSeedInfoElement = document.getElementById("seed-info");
  inventoryGridElement = document.getElementById("inventory-grid");
  setupInventoryGridUi();
  setupSaveLoadControls();
  setupMusicControls();
  updateDayLengthHintUi();
}


// ---- Setup sub-functions ----

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
  for (const id of Object.keys(WEATHER)) {
    const btn = document.getElementById(`weather-machine-${id}-btn`);
    if (btn) {
      const weatherId = id;
      const onBtnClick = () => {
        if (state.sunriseTransition || !isAtWeatherMachineTile()) return;
        state.weatherMachineSelection = weatherId;
        commitWeatherMachineSpend(WEATHER_SPEND_UNIT_EUR);
      };
      btn.addEventListener("click", onBtnClick);
      addUiDisposer(() => btn.removeEventListener("click", onBtnClick));
    }
  }
}

function setupKeyboardControls(seedSelect, tryBuySelectedSeed, setHoldingPlant, setHoldingHarvest, clearHoldingPlant, clearHoldingHarvest, doMove) {
  const onKeyDown = (e) => {
    const key = e.key.toLowerCase();
    if (key === "p") {
      setPaused(!state.paused);
      return;
    }

    // Building interior navigation (works even while paused).
    if (key === "f" || key === "escape") {
      if (isBuildingInteriorVisible()) {
        // F only exits when standing on the door tile; Escape always exits.
        if (key === "escape" || isAtRoomExit()) {
          hideBuildingInterior();
        }
        return;
      }
      if (key === "f" && !state.paused) {
        const building = getBuildingAtFarmer();
        if (building) {
          showBuildingInterior(building);
          return;
        }
      }
      return;
    }

    if (state.paused) return;

    // Route movement into the room when inside a building
    if (isBuildingInteriorVisible()) {
      if (["w", "arrowup", "a", "arrowleft", "s", "arrowdown", "d", "arrowright"].includes(key)) {
        e.preventDefault();
        if (key === "w" || key === "arrowup")    tryMoveInRoom(0, -1);
        if (key === "a" || key === "arrowleft")  tryMoveInRoom(-1, 0);
        if (key === "s" || key === "arrowdown")  tryMoveInRoom(0,  1);
        if (key === "d" || key === "arrowright") tryMoveInRoom(1,  0);
      }
      return; // block all other input while inside
    }

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

    // Attempt autoplay; state.musicPlaying stays true — if the browser blocks it,
    // the play button is available for the user to start manually.
    bgm.play().catch(() => {});

    const onMusicPlayClick = async () => {
      state.musicPlaying = true;
      try {
        await bgm.play();
      } catch {
        // Interaction restrictions can prevent play; flag stays true so the next
        // src swap or ambience sync will attempt play() again.
      }
    };
    musicPlayBtn.addEventListener("click", onMusicPlayClick);
    addUiDisposer(() => musicPlayBtn.removeEventListener("click", onMusicPlayClick));

    const onMusicPauseClick = () => {
      state.musicPlaying = false;
      bgm.pause();
      syncWeatherAmbience();
    };
    musicPauseBtn.addEventListener("click", onMusicPauseClick);
    addUiDisposer(() => musicPauseBtn.removeEventListener("click", onMusicPauseClick));

    const onMusicVolumeInput = () => {
      syncVolumeUi();
      const volumePercent = Math.max(0, Math.min(100, Number(musicVolumeInput.value) || 0));
      state.musicVolumePercent = volumePercent;
      bgm.volume = clamp01((volumePercent / 100) * getBgmBase());
      bgm.muted = bgm.volume <= 0;
      // syncWeatherAmbience recomputes ambience volumes from state.musicVolumePercent directly,
      // so no need to call it here — the volumechange event below covers it.
    };
    musicVolumeInput.addEventListener("input", onMusicVolumeInput);
    addUiDisposer(() => musicVolumeInput.removeEventListener("input", onMusicVolumeInput));

    const onBgmPlay = () => {
      setUiPlaying(true);
      syncWeatherAmbience();
    };
    const onBgmPause = () => {
      setUiPlaying(false);
      // Do not call syncWeatherAmbience here: a browser-triggered pause (e.g. from src
      // assignment) must not silence ambience when state.musicPlaying is still true.
      // Ambience is controlled by state.musicPlaying, not by bgm.paused.
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
