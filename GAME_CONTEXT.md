# GAME_CONTEXT.md — Weathercraft Farming

> **Purpose:** This file gives a fresh LLM instance complete working context for the Weathercraft Farming codebase. Read the entire file before writing any code.

---

## 1. Game Overview

**Weathercraft Farming** is a top-down, tile-based browser farming game (no framework, no bundler) where the player walks a farmer around a grid path, buys seeds from a shop tile, plants and harvests crops on a 12×12 inner field, and uses a weather machine to bias tomorrow's weather — all in real time. The core loop is: earn money by harvesting → spend on seeds → manage weather hazards (flooded/scorched tiles) and crop timing to maximize yield before crops rot.

### Feature-complete state (as of last commit)
- Tile grid rendering with dirty-flag diffing
- Farmer movement (WASD / arrow keys), hold-to-plant, hold-to-harvest
- 5 crop types with weather/terrain growth multipliers
- Two weather states (sun/rain), each adding hazard tiles at sunrise
- Weather machine (probabilistic weather influence via € spend)
- Sunrise transition locking UI during weather resolution
- Roaming farm dog with bark, morning walk, Web Audio synthesis
- Day/night BGM crossfade; rain/sun ambience tracks
- Save/load via CSV export+import (format version 4)
- Pause, music volume control

### Not yet implemented / known future work
- Mobile touch controls (no touch handlers exist)
- Multiple save slots (single CSV download/upload only)
- Multiplayer / leaderboard
- Any form of scoring beyond raw `state.moneyEur`
- Accessibility: keyboard focus trapping in panels is minimal

---

## 2. Architecture & Structure

### File layout

```
index.html              — HTML shell; all UI structure; loads scripts in order
css/
  styles.css            — All visual styling, CSS variables, tile/crop/HUD classes
  layout.css            — Flex/grid structural layout only
js/
  constants.js          — All magic numbers and crop/weather data definitions
  game-mechanics.js     — Pure logic: growth, hazards, adjacency, rot, weather math
  game-state.js         — Singleton `state` object + CSV export/import
  game-services.js      — GameServices pub/sub bus (on/emit) + emitUiSync/onUiSync/queueUiSync
  audio.js              — getBgmBase(), syncWeatherAmbience(), setWeatherTheme() + element caches
  game-ui.js            — DOM construction, rendering, keyboard input, HUD updates
  dog.js                — Dog AI, bark (Web Audio), DOM sync, CSS injection
  main.js               — Game loop (RAF), tick(), GameRuntime singleton
```

**All JS files are real, non-empty, and contain exactly what their name and description above implies.** `audio.js` is 64 lines; `game-services.js` is 53 lines. Both are loaded as separate `<script>` tags before `dog.js`. `dog.js` *uses* `GameServices` (imported from `game-services.js`) but does not define it.

### Script load order (matters — no module system)

`constants.js` → `game-mechanics.js` → `game-state.js` → `game-services.js` → `audio.js` → `game-ui.js` → `dog.js` → `main.js`

Every file uses globals from the files before it. There is **no bundler, no ES modules, no `import`/`export`**. All symbols are on `window`.

### Game loop wiring

```
GameRuntime.start()
  └─ initGame()              — builds DOM grid, binds UI, renders initial state
  └─ startLoop()             — returns a stop function; drives RAF loop
       └─ frame(now)
            ├─ tick(dtMs)    — called at fixed ~16.67ms steps (TARGET_FPS=60)
            │    ├─ advanceGameClock(dtMs)
            │    ├─ updateSunriseTransition(dtMs)
            │    ├─ updateBgmForTimeOfDay(dtMs)
            │    ├─ processSunriseIfNeeded()
            │    ├─ wrapDayIfNeeded()
            │    ├─ runCropSimulation(dtMs)   → growAllCrops + updateRotAndBlack
            │    ├─ updateHudOnCooldown()
            │    └─ tickDog(dtMs)
            └─ renderAll()   — only when dirty tiles exist, capped at 24 FPS
```

`tick()` runs simulation at up to `MAX_TICKS_PER_FRAME = 2` per frame to catch up, then caps with `MAX_ACCUMULATED_MS` to prevent spiral-of-death. Render and simulation are decoupled: simulation runs at 60 Hz, render at 24 Hz max.

### Non-obvious structural decisions

- **`audio.js` and `game-services.js` are real, standalone files loaded before `dog.js`.** `audio.js` owns `getBgmBase()`, `syncWeatherAmbience()`, `setWeatherTheme()`, and the four audio element caches (`bgmElementCache` etc.). `game-services.js` owns the `GameServices` IIFE (on/emit) and all UI-sync batching (`emitUiSync`, `onUiSync`, `queueUiSync`, `flushUiSync`). `dog.js` only *uses* `GameServices` (via `GameServices.on("farmer:moved", ...)`); it does not define it. Do not confuse authorship: editing the wrong file has no effect on the running code.
- **Dirty tile rendering:** `dirtyTileSet` (a `Set<number>`) tracks which tile indices need re-rendering. Tiles are only touched in the DOM when dirty. `markTileDirty(idx)` / `markTileDirtySafe(idx)` are the write paths; never update tile DOM directly without going through these.
- **Single farmer DOM element** is appended into whichever tile `<div>` the farmer is on — it is moved, not re-created.
- **`GameRuntime`** is an IIFE singleton exposed as `window.WfGameRuntime` (and aliased as `window.GameRuntime`). It supports `start()`, `stop()`, `restart()`. A disposer pattern (`registerAppDisposer`) lets all modules register cleanup callbacks for event listeners — critical for `restart()` not to leak.

---

## 3. Core Systems

### 3.1 Tile Grid

**What:** A flat array of 196 tile objects (`WORLD_SIZE × WORLD_SIZE = 14×14`). The outer ring (x=0, x=13, y=0, y=13) is `kind: "path"`; the inner 12×12 is `kind: "field"`. Path tiles are never plantable.

**Key variables:**
- `state.tiles: TileObject[]` — flat array, index via `tileIndex(x, y) = y * WORLD_SIZE + x`
- `WORLD_SIZE = 14`, `FIELD_SIZE = 12`
- `isField(x, y)` — returns `true` if `1 ≤ x ≤ 12 && 1 ≤ y ≤ 12`

**Tile object shape:**
```js
{
  kind: "field" | "path",
  crop: null | { cropId: string, progress: number }, // progress: 0–1
  flooded: boolean,
  scorched: boolean,
  blackMsRemaining: number,       // ms until black tile clears (blocks planting)
  readyRotMsRemaining: number,    // ms until ready crop rots away
  isAdjacentToWater: boolean,     // precomputed; updated by updateWaterAdjacency()
  dirty: boolean,                 // render flag; also tracked in dirtyTileSet
}
```

**Constraints:**
- A tile is **never both** `flooded` AND `scorched`. `reconcileExclusiveHazards()` enforces this; flooded wins.
- A black tile (`blackMsRemaining > 0`) cannot have a `crop`. Enforced in `updateRotAndBlack()` and `enforceHazardPlantValidity()`.
- Do not set `tile.dirty = true` directly in game-mechanics code — always call `markTileDirtySafe(idx)` so the render set is also updated.

### 3.2 Crop System

**What:** Crops grow in real time during daylight hours (7 AM–10 PM, 15 hours/day). Growth is fractional; `progress` goes 0→1. At `progress >= 1`, the harvest timer starts.

**Key functions (all in `game-mechanics.js`):**
- `growAllCrops(dtMs)` — inner loop over all field tiles, skips nighttime, applies multipliers
- `updateRotAndBlack(dtMs)` — counts down `readyRotMsRemaining` and `blackMsRemaining`
- `cropStage(progress)` — returns `"seed"` (<0.25), `"sprout"` (<1), `"grown"` (≥1)

**Growth formula per tick:**
```
growthThisTick = dtMs / MS_PER_GROWTH_DAY          // MS_PER_GROWTH_DAY = (15/24)*MS_PER_DAY
progressDelta  = (1/daysToGrow) × globalWeatherMult × cropWeatherMult × envMult × growthThisTick
```
- `globalWeatherMult` = `WEATHER[state.weatherId].growthMultiplier` (sun: 1.0, rain: 1.35)
- `cropWeatherMult` = `CROPS[cropId].weatherGrowthMultipliers[weatherId]` (varies per crop)
- `envMult` = adjacency bonus for watercress, or scorched bonus for cactusfruit (otherwise 1)

**Rot lifecycle:**
1. Crop reaches `progress >= 1` → `readyRotMsRemaining` is set to `MS_PER_DAY` (one full in-game day)
2. If not harvested → crop is destroyed, tile becomes black (`blackMsRemaining = MS_PER_DAY`)
3. Black tile clears → normal empty field tile

**Crop definitions (all in `constants.js`, do not duplicate inline):**

| cropId       | daysToGrow | seedCost | harvestValue | Special rule |
|--------------|-----------|----------|--------------|--------------|
| carrot       | 6         | €3       | €8           | sun ×1.35, rain ×0.7 |
| onion        | 8         | €4       | €10          | neutral |
| cabbage      | 10        | €5       | €13          | sun ×0.7, rain ×1.35 |
| watercress   | 10        | €6       | €16          | must be adjacent to flooded; grows ×4 when adjacent |
| cactusfruit  | 10        | €8       | €22          | must be ON scorched tile; grows ×3.5 on scorched |

**Planting rules (in `tryPlantHere()`):**
- Tile must be `kind: "field"`, empty, not black, not flooded
- `cactusfruit` → tile MUST be scorched
- `watercress` → tile must NOT be scorched/flooded; must be adjacent to flooded
- All others → tile must NOT be scorched

**DO NOT CHANGE:** The `enforceHazardPlantValidity()` function is called after every save-load and after every sunrise — it is the canonical source of truth for crop validity. Changing planting rules requires updating both `tryPlantHere()` AND `enforceHazardPlantValidity()`.

### 3.3 Weather & Hazard System

**What:** Weather is either `"sun"` or `"rain"`. At every sunrise, 3–5 tiles are randomly converted to the matching hazard (flooded for rain, scorched for sun). Hazards can be influenced (not set directly) by the weather machine.

**Key functions:**
- `maybeChangeWeatherAtSunrise()` — 20% chance to flip weather naturally (`NATURAL_WEATHER_FLIP_CHANCE`)
- `applyWeatherMachineAtSunrise()` — applies committed spend as a probability; resets `weatherMachineSpendCommitted` to 0
- `addHazardCells(type, count)` — shuffles eligible tiles, applies hazard, clears opposite hazard within 2 tiles
- `addFloodedCells(n)` / `addScorchedCells(n)` — wrappers; called with 3 (if weather swapped) or 5 (if same)
- `updateWaterAdjacency()` — must be called after ANY flooded change to keep `isAdjacentToWater` accurate
- `setWeatherTheme()` (in `dog.js` physically) — toggles `.weather--rain` on `.game-wrap`, triggers ambience sync

**Weather machine:**
- Player stands on `WEATHER_MACHINE_TILE_X=13, WEATHER_MACHINE_TILE_Y=13` (bottom-right path tile)
- Each button click commits `WEATHER_SPEND_UNIT_EUR = €10` toward tomorrow's weather
- Chance = `WEATHER_CHANGE_CHANCE_PER_EURO × weatherMachineSpendCommitted` (max 100%)
- Spend is consumed at sunrise regardless of outcome

**Sunrise sequence (in `processSunriseIfNeeded()`):**
1. Rooster plays, sunrise transition locks UI (2s)
2. Natural weather flip check
3. Weather machine spend applied
4. Hazard cells added based on final weather
5. `updateWaterAdjacency()` called
6. `enforceHazardPlantValidity()` called (may kill crops)
7. UI unlocked after `SUNRISE_TRANSITION_MS = 2000ms`

### 3.4 Rendering System

**What:** Pre-built DOM elements per tile stored in parallel arrays. Only dirty tiles are re-rendered. Rendering and simulation are on separate frame budgets.

**Key arrays (all module-scope in `game-ui.js`):**
- `tileElements[idx]` — the tile `<div>`
- `cropElements[idx]` — the `.crop` wrapper div (shown/hidden)
- `cropImageElements[idx]` — the `<img>` inside the crop div
- `cropBarFillElements[idx]` — the `.crop__bar-fill` div (width=progress%)
- `harvestReadyElements[idx]` — the `!` harvest indicator div
- `dirtyTileSet` — `Set<number>` of indices needing render

**Key functions:**
- `buildGridDom()` — creates all tile and crop DOM elements; called once on init
- `renderTile(idx, force)` — re-renders one tile; reads from `dirtyTileSet`, updates CSS classes and crop img src only when `cropId` or `stage` changes (guarded by `lastCropIdByIdx` / `lastCropStageByIdx`)
- `renderAll(force)` — renders all dirty tiles; force=true on init/import
- `markTileDirty(idx)` — adds to `dirtyTileSet`, sets `tile.dirty = true`
- `hasDirtyTiles()` — checked in the RAF loop to skip renders when nothing changed

**Tile CSS classes:**
- `.tile--field` / `.tile--path` — set at build time, never change
- `.tile--flooded`, `.tile--scorched`, `.tile--black` — toggled per renderTile
- `.tile--highlight` — toggled by `updateHighlights()` on the farmer's current field tile

**Sprite URL pattern:** `./assets/sprites/pixel-{cropId}-{stage}.svg` where stage is `seed | sprout | grown`

**DO NOT:** Store any render state outside these arrays. Do not call `renderTile()` outside `renderAll()` except for the immediate-feedback calls in `tryPlantHere()` and `tryHarvestHere()`.

### 3.5 HUD & UI Sync

**What:** HUD and panels update via a batched pub/sub to avoid redundant DOM writes on the same frame.

**Pattern:**
```js
emitUiSync({ hud: true, shop: true, weatherMachine: true, highlights: true })
// → queued via rAF → flushUiSync() → GameServices.emit("ui:sync", flags) → bindUi listener
```

**Flags:** `hud`, `shop`, `weatherMachine`, `highlights` — each maps to one update function. Always use `emitUiSync()` to trigger UI updates, never call `updateHud()` etc. directly from simulation code (they can be called directly from init/import paths where immediate sync is required).

**HUD element caches** (module-scope in `game-ui.js`, lazy-populated on first `updateHud()` call):
`hudDayElement`, `hudTimeElement`, `hudWeatherIconElement`, `hudWeatherValueElement`, `hudMoneyElement`

**Last-value guards:** All HUD update functions compare against `lastHud*` variables before writing `textContent`/`innerHTML` to avoid spurious reflows.

### 3.6 Dog System

**What:** An animated farm dog that wanders the grid, goes home at night, barks when co-located with the farmer, and uses Web Audio API for its bark sound (no audio file dependency).

**Key state:** `_dogState` — `{ x, y, prevX, prevY, stepTimerMs, barkCooldownMs, isHome, morningDestX, morningDestY, morningRoamDone }`

**Key functions (all in `dog.js`):**
- `initDog()` — tears down previous DOM/listeners, creates fresh dog + doghouse DOM on `tileElements`
- `tickDog(dtMs)` — called from `tick()`; handles step timer, wander vs. go-home logic
- `resetDogMorningRoam()` — called from `wrapDayIfNeeded()` at midnight
- `_dogWander()` — never reverses direction; walks toward morning destination if set
- `_dogStepTowardHome()` — traverses any tile type (ignores hazards for pathfinding)
- `_isValidDogTile(x, y)` — used for daytime wander; avoids flooded/scorched/black tiles
- `_triggerBarkIfOnSameTile()` — shared bark trigger; also fires via `GameServices.on("farmer:moved")`
- `_playBark()` — Web Audio sawtooth synthesizer; no audio file needed

**Dog house:** Permanently on tile `(0, 1)` (`DOG_HOUSE_X=0, DOG_HOUSE_Y=1`).

### 3.7 Audio System

**What:** Three looping HTML `<audio>` elements (`bgm`, `rain-sfx`, `sunny-sfx`) plus a one-shot rooster. Volume is derived from the user's slider × a track-specific base multiplier.

**Key functions (in `audio.js`):**
- `getBgmBase()` — returns `DAY_BGM_MIX (0.8)` or `NIGHT_BGM_MIX (3.0)` based on current src (not time of day, to handle mid-fade correctness)
- `syncWeatherAmbience()` — plays/pauses rain-sfx and sunny-sfx based on `state.weatherId`; volumes derived from master volume
- `setWeatherTheme()` — toggles `.weather--rain` CSS class on `.game-wrap`, then calls `syncWeatherAmbience()`
- BGM crossfade via `state.bgmFadeState`: `"idle" | "fadeOut" | "fadeIn"`, timed by `state.bgmFadeTimerMs`

**Sunrise audio rule:** Day→Night is a crossfade; Night→Day is an immediate src swap (no crossfade). This is intentional.

### 3.8 Save/Load (CSV)

**What:** State is exported as a versioned CSV and re-imported from file. Format version is currently `WeathercraftFarmingCSV,4`.

**Functions (in `game-state.js`):**
- `exportStateToCsv()` — encodes full state to CSV string
- `importStateFromCsv(csvText)` — parses CSV, mutates `state`, calls `createInitialTiles()`, then re-runs several init functions
- `parseCsvLine(line)` — simple split on comma (no quoted-comma support)

**CSV structure:**
```
WeathercraftFarmingCSV,4
{day},{dayElapsedMs},{weatherId},{weatherMachineSelection},{moneyEur},{selectedSeedId},{farmerX},{farmerY},{invCarrot},{invOnion},{invCabbage},{invWatercress},{invCactusfruit},{weatherMachineSpendCommitted},{paused}
x,y,flooded,scorched,soilRecoveryDaysRemaining,harvestRotDaysRemaining,seedTypeId,growthProgress01
... (one row per field tile, 144 rows)
```

**Backward compatibility:** v1, v2, v3 CSVs are supported. Adding new state fields requires bumping the version and adding a conditional parse path. Do not remove old version branches.

**After `importStateFromCsv()`**, the following must always be called (already done internally):
`reconcileExclusiveHazards()`, `enforceHazardPlantValidity()`, `updateWaterAdjacency()`, `setWeatherTheme()`, `updateWeatherMachineUi()`, `updateHud()`, `updateShopInfo()`, `setPaused()`, `renderAll(true)`, `updateHighlights()`

---

## 4. Coding Conventions

### Naming
- **Functions:** `camelCase`, verbs: `tryPlantHere()`, `growAllCrops()`, `emitUiSync()`
- **Constants:** `UPPER_SNAKE_CASE` for scalar constants; `PascalCase` for object constants (`CROPS`, `WEATHER`)
- **Private (dog.js) prefixes:** `_dogState`, `_dogEl`, `_playBark()`, `_dogWander()` — underscore prefix means module-internal
- **DOM element caches:** suffix `Element` or `ElementCache`; e.g., `hudDayElement`, `bgmElementCache`
- **State flags:** plain booleans on `state` — `state.paused`, `state.roosterPlayedToday`, `state.sunriseTransition`
- **Timer fields:** suffix `Ms` for milliseconds — `state.dayElapsedMs`, `tile.blackMsRemaining`, `bgmFadeTimerMs`
- **Multipliers:** suffix `Multiplier` or `Mult` — `cropWeatherMult`, `envMult`, `globalMultiplier`

### State management
- All game simulation state lives in the **singleton `state` object** (defined in `game-state.js`)
- All DOM caches live as **module-scope variables** in `game-ui.js` and `dog.js`
- Audio runtime state (`bgmFadeState`, `bgmFadeTimerMs`, `musicVolumePercent`) lives in `state` as properties, but **none of these are serialized in the CSV export** — they reset on every page load. `state.paused` IS exported. Do not assume that being on `state` implies CSV persistence.
- Non-serialized runtime state (RAF handle, audio element refs) lives in `runtimeCtx` (in `main.js`)

### Entity patterns
- **Tiles** are plain objects in `state.tiles[]`, never class instances
- **Crops** are inline objects on `tile.crop`: `{ cropId: string, progress: number }` or `null`
- **Crop definitions** are in `CROPS` constant — never mutated at runtime
- **Events** use `GameServices.on(name, handler)` returning an unsubscribe function; always store and call it in cleanup

### Disposer pattern
Every `addEventListener` registered in `bindUi()` or `dog.js` is paired with a `addUiDisposer(removeEventListener)` or `registerAppDisposer()` call. This is mandatory — `GameRuntime.restart()` relies on it.

---

## 5. Known Issues & Constraints

### Hard constraints
- **No bundler, no modules, no npm.** Must run by opening `index.html` directly (file:// protocol) or via any static server. All JS is global.
- **Single HTML page.** All UI is defined in `index.html`. Do not split into multiple pages.
- **No external libraries.** No React, no jQuery, no game engines. Pure DOM + Web Audio API.
- **Target browsers:** Modern desktop Chrome/Firefox/Safari (no IE11 compatibility required). `AudioContext`, `requestAnimationFrame`, `Set`, `Map`, arrow functions are freely used.

### Known issues / deferred bugs
- **`js/audio.js` and `js/game-services.js` are real, fully functional files** — they are not empty and not stubs. During initial analysis of the codebase, the content of these files was incorrectly read as part of `dog.js` due to the way the files were concatenated in the read stream. Always edit audio functions in `audio.js` and the pub/sub bus in `game-services.js` directly.
- **No mobile support.** No touch event handlers exist anywhere. Touch on the grid does nothing.
- **README is stale.** It says "1 minute = 1 in-game day"; the actual value is `MS_PER_DAY = 100_000ms` (100 seconds ≈ 1.67 minutes). Always trust `constants.js`, not the README.
- **`state.musicVolumePercent` is not saved to CSV** — music volume resets to the slider's HTML default (10%) on load. Intentional or an oversight; do not "fix" this without explicit instruction.
- **Dog wander can get stuck** in all-hazard areas briefly; the fallback reversal path handles this but can look twitchy.
- **Weather machine spend is not capped** in the UI — a player can keep clicking to accumulate beyond 100% chance (clamped in `getEffectiveWeatherChangeChance()` but the display shows raw spend).

### Performance-sensitive areas
- `growAllCrops(dtMs)` — runs every tick, loops all 196 tiles. Do not add allocations (no `Array.map`, no object spread) inside the inner loop. The existing code uses direct property access and avoids array creation intentionally.
- `updateWaterAdjacency()` — loops all tiles and checks 4 neighbors. Only call when flooded tiles actually change (after `addHazardCells`, after import).
- `renderTile()` — guarded by `lastCropIdByIdx` / `lastCropStageByIdx` to avoid img src thrashing. Do not remove these guards.
- `dirtyTileSet` — use `Set` operations; do not convert to array until iteration in `renderAll`.

---

## 6. How to Work on This Codebase

### What to preserve (never change without explicit instruction)
- The `state` object property names — they are serialized in CSV
- CSV format version number and backward-compat parse paths
- The `GameRuntime` / `WfGameRuntime` API surface and the disposer pattern
- `tileIndex(x, y)` formula — used in every subsystem
- The tile rendering pipeline: dirty flag → `dirtyTileSet` → `renderTile()` → DOM
- Load order of `<script>` tags in `index.html`

### Safe to refactor
- Internal helper functions within a single file (extracting sub-functions, renaming local variables)
- CSS classes and styling (as long as JS class toggles in `renderTile()` match)
- Adding new crops by adding entries to `CROPS` in `constants.js` and SVG assets — no JS changes needed beyond `SEED_KEY_ORDER` if you want keyboard shortcuts
- Adding new constants to `constants.js`
- Extending `state` with new non-serialized fields (mark clearly as "not saved")

### Output format expectations
- **When modifying an existing file:** Provide the complete new file content. Do not use diffs or snippets unless the change is a single well-isolated function addition/replacement.
- **When adding a new file:** Provide the full file. Update `index.html` `<script>` tags in the correct load position.
- **Do not merge `audio.js` or `game-services.js` into `dog.js`.** They are correctly separated. `dog.js` ends with the CSS injection IIFE and nothing more.
- **Always include a brief comment** explaining non-obvious logic, consistent with the existing commenting style (full sentences, no JSDoc).

### Before writing any code, verify:
1. Is the logic purely simulation? → Put it in `game-mechanics.js`
2. Does it need DOM access or render state? → Put it in `game-ui.js`
3. Does it define crop/weather/timing data? → Put it in `constants.js`
4. Does it need to run on every tick? → Add a call inside `tick()` in `main.js`
5. Does it mutate `state`? → Ensure the change is reflected in `exportStateToCsv()` if it should persist across saves
