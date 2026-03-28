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


// ---- Initialisation ----

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

      // Farmhouse on tile (0,0) — top-left corner, player's home
      if (x === 0 && y === 0) {
        const farmhouseIcon = document.createElement("img");
        farmhouseIcon.src = "./assets/sprites/pixel-farmhouse.svg";
        farmhouseIcon.alt = "Farmhouse";
        farmhouseIcon.style.position = "absolute";
        farmhouseIcon.style.inset = "5%";
        farmhouseIcon.style.width = "90%";
        farmhouseIcon.style.height = "90%";
        farmhouseIcon.style.objectFit = "contain";
        farmhouseIcon.style.imageRendering = "pixelated";
        farmhouseIcon.style.filter = "drop-shadow(0 2px 3px rgba(0,0,0,0.4))";
        el.appendChild(farmhouseIcon);
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
