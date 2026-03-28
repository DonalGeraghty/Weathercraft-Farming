// ---- Player actions ----

function tryMove(dx, dy) {
  const nx = state.farmer.x + dx;
  const ny = state.farmer.y + dy;
  if (nx < 0 || ny < 0 || nx >= WORLD_SIZE || ny >= WORLD_SIZE) return;

  state.farmer.x = nx;
  state.farmer.y = ny;
  updateHighlights();
  syncFarmerDom();
  // Notify listeners (e.g. dog bark check) that the farmer has moved.
  GameServices.emit(EVENT_FARMER_MOVED, { x: nx, y: ny });
}

function tryPlantHere() {
  const cropId = state.selectedSeedId;
  const seedCount = state.inventory[cropId] ?? 0;
  if (seedCount <= 0) return;

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
  state.inventory[cropId] = seedCount - 1;
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
