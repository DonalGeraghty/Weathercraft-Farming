# Weathercraft Farming (prototype)

Top-down browser farming game in plain HTML/CSS/JavaScript — no build step, no dependencies. Grow crops, manage weather hazards, and harvest before your fields rot.

## Run

- Open `index.html` in your browser (double-click), or
- Serve the folder with any static server (e.g. `npx serve .`)

---

## Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` / Arrow keys | Move farmer |
| `Space` | Plant selected seed on current tile |
| `E` | Harvest fully-grown crop on current tile |
| Hold `Space` while moving | Plant automatically as you walk |
| Hold `E` while moving | Harvest automatically as you walk |
| `1` `2` `3` `4` `5` | Select seed (Carrot / Onion / Cabbage / Watercress / Cactus Fruit) |
| `B` | Buy 1 seed |
| `N` | Buy 5 seeds |
| `M` | Buy 10 seeds |
| `P` | Pause / Resume |

---

## How to Play

### Starting out
You begin with **€100** and **3 carrots** in your inventory. The farmer starts at the top-left corner of the path ring.

### Core loop

1. **Buy seeds** — walk to the **Shop tile** (top-right corner of the path ring) and press `B`, `N`, or `M`, or click the buy buttons in the right panel. You must be standing on the Shop tile to purchase.
2. **Plant** — walk onto any inner field tile and press `Space`. The selected seed is planted and deducted from your inventory. Hold `Space` and move to plant across multiple tiles quickly.
3. **Watch crops grow** — crops grow automatically in real time during daylight hours. A progress bar and three visual stages (seed → sprout → grown) show how far along each crop is.
4. **Harvest before they rot** — when a crop is fully grown, a `!` indicator appears. Press `E` to harvest; the sell value is added to your money instantly. **If you leave a ready crop for a full in-game day without harvesting, it rots**: the crop disappears and the tile turns black, blocking replanting for another full day.
5. **Manage weather** — walk to the **Weather Machine** (bottom-right corner) and spend € to increase the probability that your chosen weather applies tomorrow. Weather affects how fast each crop type grows and where new hazard tiles appear.

### Winning
There is no win condition — the goal is to accumulate money efficiently by choosing the right crops for the current (and predicted) weather and harvesting before tiles rot or are destroyed by hazards.

---

## World Layout

```
(0,0)                               (13,0)
 +------------------------------------+
 | Farmhouse    <- path ring ->  Shop |  <- Shop tile (top-right)
 |                                    |
 |    +----------------------------+  |
 |    |                            |  |
 |    |       12 x 12 field        |  |
 |    |                            |  |
 |    +----------------------------+  |
 |                                    |
 | Dog house    <- path ring ->  Mach |  <- Weather Machine (bottom-right)
 +------------------------------------+
(0,13)                              (13,13)
```

- The **outer ring** is the walkable path (14×14 total world).
- The **inner 12×12** is the plantable field.
- The farmer can only plant and harvest on inner field tiles.
- The **Shop** and **Weather Machine** are path tiles — you interact with them by standing on them.

---

## Time & Day Cycle

| Phase | In-game time | What happens |
|-------|-------------|--------------|
| Night | 10 PM – 7 AM | Crops stop growing; dog heads home; night BGM plays |
| Sunrise | 7 AM | Rooster crows; weather resolves; hazard tiles placed; day BGM resumes |
| Day | 7 AM – 10 PM | Crops grow; dog roams; shop and weather machine active |

- **1 in-game day = 100 seconds** of real time (~1 min 40 sec).
- Crops grow only during the **15 daylight hours** (7 AM–10 PM). "Days to grow" in the crop table refers to calendar days at neutral weather.
- The sunrise event fires once per day at 7 AM and is the only moment weather and hazards change. A brief transition locks the shop and weather machine while it resolves.

---

## Crops

| Seed | Cost | Sell | Days* | Placement | Weather bonus |
|------|------|------|-------|-----------|---------------|
| Carrot | €3 | €8 | 6 | Any normal field tile | Sun x1.35 · Rain x0.70 |
| Onion | €4 | €10 | 8 | Any normal field tile | Neutral (x1.0 both) |
| Cabbage | €5 | €13 | 10 | Any normal field tile | Sun x0.70 · Rain x1.35 |
| Watercress | €6 | €16 | 10 | Dry tile **adjacent** to a waterlogged tile | Neutral; grows x4 when adjacent to waterlogged |
| Cactus Fruit | €8 | €22 | 10 | **On** a scorched tile only | Neutral; grows x3.5 on scorched soil |

\* Days to grow at neutral weather (no weather multiplier, no environment bonus).

**Global rain bonus:** Rain applies a x1.35 growth multiplier to all crops on top of per-crop weather multipliers. Sun applies x1.0 globally.

**Rough profit per day guide (neutral weather):**

| Crop | Profit | Days | Approx €/day |
|------|--------|------|--------------|
| Carrot | €5 | 6 | 0.83 |
| Onion | €6 | 8 | 0.75 |
| Cabbage | €8 | 10 | 0.80 |
| Watercress | €10 | ~2.5 (with x4 bonus) | ~4.0 with bonus |
| Cactus Fruit | €14 | ~2.9 (with x3.5 bonus) | ~4.9 with bonus |

Watercress and Cactus Fruit are high-risk, high-reward: they require specific hazard tiles to be plantable at all, but grow dramatically faster when conditions are met.

---

## Weather & Hazards

### How weather works

- On any given day, weather is either **Sun** (62% base chance) or **Rain** (38% base chance).
- At each sunrise there is a **20% chance** weather flips naturally to the other type.
- The **Weather Machine** lets you spend € to add probability on top: every €10 committed adds +10% chance that your selected weather applies tomorrow, up to 100%.
- Weather machine spend is consumed at sunrise regardless of outcome.

### Hazard tiles

Each sunrise, **3–5 field tiles** are converted to the active weather's hazard. Fewer tiles are placed (3) if the weather swapped that morning; more (5) if the same weather continues.

| Weather | Hazard | Effect on crops |
|---------|--------|-----------------|
| Sun | Scorched (orange) | Destroys all crops **except** Cactus Fruit; Cactus Fruit can only be planted here |
| Rain | Waterlogged (blue) | Destroys all crops; Watercress is also destroyed if its own tile becomes waterlogged (it survives only on adjacent dry tiles) |

Waterlogged and scorched are mutually exclusive on any single tile — if both would apply, waterlogged takes priority. When a new hazard is placed, the opposite hazard is cleared within 2 tiles of it.

### Strategy tips

- **Carrots** are best in sun-heavy runs; avoid them during sustained rain.
- **Cabbage** is the mirror — good in rain, punished in sun.
- **Onion** is the safe, weather-neutral choice when you can't predict conditions.
- **Watercress** is strong in rain spells: more waterlogged tiles means more valid planting spots and faster growth. Position them around the edges of flooded areas.
- **Cactus Fruit** is strong in sun spells: more scorched tiles means more planting spots and faster growth.
- Use the Weather Machine to extend favorable streaks rather than force a single flip — it's probabilistic, not guaranteed.

---

## Rot & Soil Recovery

| Tile state | Cause | Duration | Can plant? |
|-----------|-------|----------|-----------|
| Normal | — | — | Yes |
| Waterlogged | Rain hazard at sunrise | Persists until a sun sunrise removes it | No |
| Scorched | Sun hazard at sunrise | Persists until a rain sunrise removes it | Only Cactus Fruit |
| Black | Crop rotted unharvested | 1 full in-game day (100 sec) | No |

When a fully-grown crop is left unharvested for **one full in-game day**, it rots: the crop is lost and the tile turns black. Black tiles recover after one more full day. Miss the harvest window and a tile can be locked out for **two full days**.

---

## The Dog

A farm dog roams the field and does not affect gameplay, but will **bark** when you walk onto its tile or it walks onto yours (sound is synthesized via Web Audio — no audio file required).

- **Daytime:** wanders freely, never reversing direction. At 8 AM each day it first walks to a random spot in the centre of the field before resuming normal wandering.
- **Nighttime:** hurries straight home to the dog house (top-left of the path ring).
- Avoids waterlogged, scorched, and black tiles while wandering, but will cross any terrain to get home at night.

---

## Audio

| Track | When it plays |
|-------|--------------|
| Day BGM (looping) | 7 AM – 10 PM |
| Night BGM (looping) | 10 PM – 7 AM; crossfades in at dusk, snaps immediately at dawn |
| Rain ambience (looping) | Weather is Rain and BGM is playing |
| Sun ambience (looping) | Weather is Sun and BGM is playing |
| Rooster (one-shot) | Once per day at 7 AM |
| Dog bark (synthesized) | When farmer and dog share a tile; 2.5 sec cooldown |

Music volume is adjustable via the slider in the left panel. Ambience tracks scale proportionally with the master volume.

---

## Save / Load

Game state can be saved and restored as a CSV file via the **Save / Load** panel on the left.

- **Save:** downloads a `.csv` file named `WeathercraftFarming_state_day{N}.csv`.
- **Load:** select a previously saved `.csv` and click Upload. The entire game state is replaced immediately.

The save file includes: day number, time of day, current weather, money, inventory counts, farmer position, weather machine selection and committed spend, pause state, and the full tile grid (crop type, growth progress, waterlogged/scorched flags, rot timers, soil recovery timers).

Saves from older format versions (v1–v3) are supported and will be imported correctly.

---

## Code Structure

All logic is in plain JavaScript files loaded in order via `<script>` tags — no bundler, no npm, no imports required.

| File | Contents |
|------|----------|
| `js/constants.js` | All magic numbers: grid sizes, timing, crop definitions, weather definitions |
| `js/game-mechanics.js` | Pure simulation: growth, rot, hazard placement, adjacency helpers, weather math |
| `js/game-state.js` | Singleton `state` object; CSV export (`exportStateToCsv`) and import (`importStateFromCsv`) |
| `js/game-services.js` | Pub/sub event bus (`GameServices.on` / `.emit`); batched UI-sync (`emitUiSync`) |
| `js/audio.js` | BGM base volume, weather ambience sync, day/night theme switching |
| `js/game-ui.js` | DOM grid construction, dirty-tile rendering, keyboard input, HUD, shop UI |
| `js/dog.js` | Roaming dog AI, pathfinding, Web Audio bark synthesis, CSS animation injection |
| `js/main.js` | RAF game loop, fixed-timestep `tick()`, `GameRuntime` singleton (start/stop/restart) |

### Extending the game

**Adding a crop:** Add an entry to `CROPS` in `constants.js`, add the crop ID to `SEED_KEY_ORDER` (for a number-key shortcut), and add three SVG sprites to `assets/sprites/`: `pixel-{id}-seed.svg`, `pixel-{id}-sprout.svg`, `pixel-{id}-grown.svg`. No other JS changes are required for a weather-neutral crop with standard placement rules.

**Adding a weather type:** The weather system currently supports exactly two states (`"sun"` / `"rain"`). Extending to a third would require changes to `constants.js`, `game-mechanics.js` (hazard logic), `game-ui.js` (HUD display), and `game-state.js` (CSV import/export).
