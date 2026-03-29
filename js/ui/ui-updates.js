// ---- Update functions ----

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
      const weatherCssClass = weatherDef?.cssClass ?? "";
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

function updateShopInfo() {
  const crop = CROPS[state.selectedSeedId];
  if (!shopSeedInfoElement) shopSeedInfoElement = document.getElementById("seed-info");
  if (!buySeedButtonElement) buySeedButtonElement = document.getElementById("buy-seed-btn");
  if (!buySeed5ButtonElement) buySeed5ButtonElement = document.getElementById("buy-seed-5-btn");
  if (!buySeed10ButtonElement) buySeed10ButtonElement = document.getElementById("buy-seed-10-btn");
  const waterAdjMult = crop?.adjacentFloodedGrowthMultiplier ?? null;
  const aridMult = crop?.aridGrowthMultiplier ?? null;
  const weatherMultStr = crop
    ? Object.values(WEATHER).map(w => `${w.name} x${(crop.weatherGrowthMultipliers?.[w.id] ?? 1).toFixed(2)}`).join(", ")
    : "";
  const infoText = crop
    ? [
        `Harvest €${crop.harvestValue}.`,
        `Grows in ${crop.daysToGrow} days.`,
        weatherMultStr + ".",
        waterAdjMult ? `Adjacent wet tile: x${waterAdjMult.toFixed(2)}.` : "",
        aridMult ? `On arid soil: x${aridMult.toFixed(2)}.` : "",
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
}

function updateWeatherMachineUi() {
  for (const id of Object.keys(WEATHER)) {
    if (!weatherMachineButtonElements[id]) {
      weatherMachineButtonElements[id] = document.getElementById(`weather-machine-${id}-btn`);
    }
  }
  if (!weatherMachineInfoElement) weatherMachineInfoElement = document.getElementById("weather-machine-info");
  const isAtMachine = isAtWeatherMachineTile();
  const isEnabled = isAtMachine && !state.sunriseTransition;

  for (const id of Object.keys(WEATHER)) {
    const btn = weatherMachineButtonElements[id];
    if (btn) {
      btn.classList.toggle("btn--active", state.weatherMachineSelection === id);
      btn.disabled = !isEnabled;
    }
  }

  if (weatherMachineInfoElement) {
    const chance = Math.round(getEffectiveWeatherChangeChance() * 100);
    const spent = state.weatherMachineSpendCommitted ?? 0;
    const weatherDef = WEATHER[state.weatherMachineSelection];
    const weatherName = weatherDef?.name ?? state.weatherMachineSelection;
    const weatherCssClass = weatherDef?.cssClass ?? "";
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

function updateDayLengthHintUi() {
  const minutesPerDay = (MS_PER_DAY / 60000).toFixed(1);
  const hintEl = document.getElementById("day-length-minutes");
  if (hintEl) {
    hintEl.textContent = minutesPerDay;
  }
}
