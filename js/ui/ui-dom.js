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
let buildingInteriorElement = null;


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

  // Building interior overlay element (cached on first use).
  buildingInteriorElement = document.getElementById("building-interior");

  // Create a single farmer element; we move it between tiles on demand.
  farmerElement = document.createElement("div");
  farmerElement.className = "farmer";
  const farmerImg = document.createElement("img");
  farmerImg.className = "farmer__img";
  farmerImg.alt = "Pixel farmer";
  farmerImg.src = "./assets/sprites/pixel-farmer.svg";
  farmerElement.appendChild(farmerImg);
}


// ---- Building interior overlay ----

const ROOM_SIZE   = 9;
const ROOM_DOOR_X = Math.floor(ROOM_SIZE / 2);  // 4 — centre of bottom row
const ROOM_DOOR_Y = ROOM_SIZE - 1;               // 8

const FLOOR_SPRITES = [
  "pixel-floor-interior.svg",
  "pixel-floor-interior-2.svg",
  "pixel-floor-interior-3.svg",
  "pixel-floor-interior-4.svg",
  "pixel-floor-interior-5.svg",
  "pixel-floor-interior-6.svg",
];

// Deterministic sprite selection so the floor looks the same every visit.
function floorSpriteForTile(x, y, buildingId) {
  if (buildingId === "farmhouse") return FLOOR_SPRITES[0];
  return FLOOR_SPRITES[((x * 5 + y * 3) ^ (x + y * 7)) % FLOOR_SPRITES.length];
}

function isRoomWall(x, y) {
  const onBorder = x === 0 || x === ROOM_SIZE - 1 || y === 0 || y === ROOM_SIZE - 1;
  return onBorder && !(x === ROOM_DOOR_X && y === ROOM_DOOR_Y);
}

function isAtRoomExit() {
  return roomFarmerX === ROOM_DOOR_X && roomFarmerY === ROOM_DOOR_Y;
}

let roomTileElements = [];   // flat array [y * ROOM_SIZE + x], length 81
let roomFarmerX = ROOM_DOOR_X;
let roomFarmerY = ROOM_DOOR_Y - 1;
let roomFarmerTileIdx = -1;

function showBuildingInterior(building) {
  if (!buildingInteriorElement) return;

  const nameEl = document.getElementById("building-interior-name");
  const contentEl = document.getElementById("building-interior-content");
  if (nameEl) nameEl.textContent = building.name;

  if (contentEl) {
    contentEl.innerHTML = "";
    contentEl.appendChild(buildRoomGrid(building.id));
  }

  // Hide farmer on the playfield while inside a building
  if (farmerElement) farmerElement.hidden = true;

  // Start farmer on the entry/exit square
  roomFarmerX = ROOM_DOOR_X;
  roomFarmerY = ROOM_DOOR_Y;
  roomFarmerTileIdx = -1;
  placeRoomFarmer();

  buildingInteriorElement.hidden = false;
}

function hideBuildingInterior() {
  if (!buildingInteriorElement) return;
  buildingInteriorElement.hidden = true;
  // Restore farmer on the playfield
  if (farmerElement) farmerElement.hidden = false;
}

function isBuildingInteriorVisible() {
  return buildingInteriorElement ? !buildingInteriorElement.hidden : false;
}

function buildRoomGrid(buildingId) {
  const grid = document.createElement("div");
  grid.className = "interior-room";
  roomTileElements = [];

  for (let y = 0; y < ROOM_SIZE; y++) {
    for (let x = 0; x < ROOM_SIZE; x++) {
      const tile = document.createElement("div");
      if (isRoomWall(x, y)) {
        tile.className = "interior-room__tile interior-room__tile--wall";
      } else {
        tile.className = "interior-room__tile interior-room__tile--floor";
        tile.style.backgroundImage = `url('./assets/sprites/${floorSpriteForTile(x, y, buildingId)}')`;
      }
      grid.appendChild(tile);
      roomTileElements.push(tile);
    }
  }

  return grid;
}

function placeRoomFarmer() {
  // Remove farmer image from previous tile
  if (roomFarmerTileIdx >= 0 && roomTileElements[roomFarmerTileIdx]) {
    const prev = roomTileElements[roomFarmerTileIdx].querySelector(".interior-farmer");
    if (prev) prev.remove();
  }

  const idx = roomFarmerY * ROOM_SIZE + roomFarmerX;
  roomFarmerTileIdx = idx;
  const tile = roomTileElements[idx];
  if (!tile) return;

  const img = document.createElement("img");
  img.src = "./assets/sprites/pixel-farmer.svg";
  img.className = "interior-farmer";
  img.alt = "Farmer";
  tile.appendChild(img);
}

function tryMoveInRoom(dx, dy) {
  const nx = roomFarmerX + dx;
  const ny = roomFarmerY + dy;
  if (nx < 0 || nx >= ROOM_SIZE || ny < 0 || ny >= ROOM_SIZE) return;
  if (isRoomWall(nx, ny)) return;
  roomFarmerX = nx;
  roomFarmerY = ny;
  placeRoomFarmer();
  if (isAtRoomExit()) hideBuildingInterior();
}
