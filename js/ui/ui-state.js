// ---- Tile dirty tracking ----

let dirtyTileSet = new Set();

function markTileDirty(idx) {
  if (idx < 0 || idx >= TILE_COUNT) return;
  dirtyTileSet.add(idx);
  const tile = state.tiles[idx];
  if (tile) tile.dirty = true;
}

function hasDirtyTiles() {
  return dirtyTileSet.size > 0;
}


// ---- Location queries ----

function isAtShopTile() {
  return state.farmer.x === SHOP_TILE_X && state.farmer.y === SHOP_TILE_Y;
}

function isAtWeatherMachineTile() {
  return state.farmer.x === WEATHER_MACHINE_TILE_X && state.farmer.y === WEATHER_MACHINE_TILE_Y;
}


// ---- State helpers ----

function setPaused(next) {
  state.paused = Boolean(next);
  const pauseButton = pauseButtonElement || document.getElementById("pause-btn");
  if (pauseButton) pauseButton.textContent = state.paused ? "Resume" : "Pause";
}
