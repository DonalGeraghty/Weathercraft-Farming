// ---- Render functions ----

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
  if (!el) return;

  const isBlack = tile.kind === "field" && tile.blackMsRemaining > 0;
  const terrain = tile.kind === "field" ? tile.terrain : null;
  if (!isBlack && terrain) {
    el.dataset.terrain = terrain;
  } else {
    delete el.dataset.terrain;
  }
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
    for (const idx of dirtyTileSet) {
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
