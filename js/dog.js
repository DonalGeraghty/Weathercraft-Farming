// ---- Dog state and constants ----

//  dog.js  —  Roaming farm dog for Weathercraft Farming
//
//  Behaviour:
//   • Daytime  : wanders randomly around the farm, never reversing.
//   • Nighttime: walks straight home to tile (0,1), traversing any terrain.
//   • Barks    : when the dog steps onto the farmer's tile, OR when the
//                farmer steps onto the dog's tile (via farmer-move event).
//
//  Requires: constants.js, game-mechanics.js, game-state.js,
//            game-services.js to be loaded first.

// ---- Dog house position ----
const DOG_HOUSE_X = 0;
const DOG_HOUSE_Y = 1;

// ---- Timing constants ----
const DOG_STEP_INTERVAL_DAYTIME_MS   = 900;  // wander: ~1 step/sec
const DOG_STEP_INTERVAL_NIGHTTIME_MS = 600;  // hurrying home at night
const DOG_8AM_THRESHOLD_MS = (8 / 24) * MS_PER_DAY;

// Bark cooldown: don't bark again for this many ms.
const DOG_BARK_COOLDOWN_MS = 2500;

// ---- Sprite URLs ----
const DOG_SPRITE_SRC       = "./assets/sprites/pixel-dog.svg";
const DOG_HOUSE_SPRITE_SRC = "./assets/sprites/pixel-doghouse.svg";

//  Runtime state  (all mutable; reset fully on each initDog())
let _dogState = null;     // position, timers, facing
let _dogEl    = null;     // the moving dog <div>
let _dogHouseEl = null;   // static dog-house <img> on tile (0,1)
let _barkBubbleEl = null;
let _barkBubbleTimeout = 0;
let _lastDogTileIdx = -1;
let _farmerMoveDisposer = null; // unsubscribe handle for GameServices event

//  Web Audio  (lazy; no asset files needed)
let _barkAudioCtx = null;

const DOG_MORNING_GRID_MIN_X = 5;
const DOG_MORNING_GRID_MAX_X = 9;
const DOG_MORNING_GRID_MIN_Y = 5;
const DOG_MORNING_GRID_MAX_Y = 9;


// ---- Public entry points ----

function initDog() {
  // ---- Teardown any previous run ----
  if (_farmerMoveDisposer) {
    _farmerMoveDisposer();
    _farmerMoveDisposer = null;
  }
  if (_dogEl && _dogEl.parentNode)         _dogEl.parentNode.removeChild(_dogEl);
  if (_dogHouseEl && _dogHouseEl.parentNode) _dogHouseEl.parentNode.removeChild(_dogHouseEl);
  if (_barkBubbleEl) {
    clearTimeout(_barkBubbleTimeout);
    _barkBubbleEl = null;
  }
  _dogEl          = null;
  _dogHouseEl     = null;
  _lastDogTileIdx = -1;

  // ---- Fresh dog state ----
  _dogState = {
    x: DOG_HOUSE_X,
    y: DOG_HOUSE_Y,
    prevX: DOG_HOUSE_X,
    prevY: DOG_HOUSE_Y,
    stepTimerMs:    DOG_STEP_INTERVAL_DAYTIME_MS,
    barkCooldownMs: 0,
    morningDestX: null,
    morningDestY: null,
    morningRoamDone: state.dayElapsedMs >= DOG_8AM_THRESHOLD_MS,
  };

  // ---- Dog-house icon on tile (0,1) ----
  const houseTileEl = tileElements?.[tileIndex(DOG_HOUSE_X, DOG_HOUSE_Y)] ?? null;
  if (houseTileEl) {
    _dogHouseEl = document.createElement("img");
    _dogHouseEl.src = DOG_HOUSE_SPRITE_SRC;
    _dogHouseEl.alt = "Dog house";
    _dogHouseEl.className = "dog-house-icon";
    _dogHouseEl.style.cssText = [
      "position:absolute",
      "inset:5%",
      "width:90%",
      "height:90%",
      "object-fit:contain",
      "image-rendering:pixelated",
      "pointer-events:none",
      "z-index:2",
    ].join(";");
    houseTileEl.appendChild(_dogHouseEl);
  }

  // ---- Dog sprite ----
  _dogEl = document.createElement("div");
  _dogEl.className = "dog";
  _dogEl.style.cssText = [
    "position:absolute",
    "inset:0",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "pointer-events:none",
    "z-index:5",
  ].join(";");

  const img = document.createElement("img");
  img.src = DOG_SPRITE_SRC;
  img.alt = "Farm dog";
  img.className = "dog__img";
  img.style.cssText = [
    "width:80%",
    "height:80%",
    "object-fit:contain",
    "image-rendering:pixelated",
  ].join(";");
  _dogEl.appendChild(img);

  // GameServices.on() returns an unsubscribe fn we store for cleanup.
  _farmerMoveDisposer = GameServices.on(EVENT_FARMER_MOVED, _triggerBarkIfOnSameTile);
  if (typeof registerAppDisposer === "function") {
    registerAppDisposer(() => {
      if (_farmerMoveDisposer) { _farmerMoveDisposer(); _farmerMoveDisposer = null; }
    });
  }

  _syncDogDom();
}

//  Morning destination — picks a random tile in the 5×5 centre

function _pickMorningDestination() {
  // Collect valid (non-hazard) tiles from the centre 5×5 and pick one at random.
  const candidates = [];
  for (let y = DOG_MORNING_GRID_MIN_Y; y <= DOG_MORNING_GRID_MAX_Y; y++) {
    for (let x = DOG_MORNING_GRID_MIN_X; x <= DOG_MORNING_GRID_MAX_X; x++) {
      if (_isValidDogTile(x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return; // all hazards — stay put
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  _dogState.morningDestX = pick.x;
  _dogState.morningDestY = pick.y;
}

// Reset called at midnight so the walk triggers again the next day.

function resetDogMorningRoam() {
  if (!_dogState) return;
  _dogState.morningRoamDone = false;
  _dogState.morningDestX = null;
  _dogState.morningDestY = null;
}

//  Main tick  (called from main.js tick())

function tickDog(dtMs) {
  if (!_dogState || state.paused) return;

  // Trigger the morning walk to the centre grid once per day at 8am.
  if (!isNighttime() && !_dogState.morningRoamDone && state.dayElapsedMs >= DOG_8AM_THRESHOLD_MS) {
    _dogState.morningRoamDone = true;
    _pickMorningDestination();
  }

  _dogState.stepTimerMs    -= dtMs;
  _dogState.barkCooldownMs  = Math.max(0, _dogState.barkCooldownMs - dtMs);

  if (_dogState.stepTimerMs > 0) return;

  const night = isNighttime();
  _dogState.stepTimerMs = night
    ? DOG_STEP_INTERVAL_NIGHTTIME_MS
    : DOG_STEP_INTERVAL_DAYTIME_MS;

  if (night) {
    _dogStepTowardHome();
  } else {
    _dogWander();
  }

  _triggerBarkIfOnSameTile(); // bark if dog stepped onto farmer's tile
}

//  Render pass — move dog element into the correct tile (called from renderFrame)

function renderDog() {
  _syncDogDom();
}

//  Movement — wander
//  If a morning destination is set, walk toward it instead.

// ---- Movement helpers ----

function _dogWander() {
  // If we have a morning destination, walk toward it.
  if (_dogState.morningDestX !== null) {
    if (_dogState.x === _dogState.morningDestX && _dogState.y === _dogState.morningDestY) {
      // Arrived — clear destination and resume normal wander.
      _dogState.morningDestX = null;
      _dogState.morningDestY = null;
    } else {
      _dogStepToward(_dogState.morningDestX, _dogState.morningDestY, false);
      return;
    }
  }

  const reverseDx = _dogState.x - _dogState.prevX;
  const reverseDy = _dogState.y - _dogState.prevY;

  const allDirs = [
    { dx:  1, dy:  0 },
    { dx: -1, dy:  0 },
    { dx:  0, dy:  1 },
    { dx:  0, dy: -1 },
  ];

  // Preferred: everything except the reverse direction.
  const preferred = allDirs.filter(
    ({ dx, dy }) => !(dx === reverseDx && dy === reverseDy)
  );

  // Try preferred (shuffled) first; only fall back to reverse if truly boxed in.
  const ordered = [..._shuffleDirs(preferred), { dx: reverseDx, dy: reverseDy }];

  for (const { dx, dy } of ordered) {
    const nx = _dogState.x + dx;
    const ny = _dogState.y + dy;
    if (_isValidDogTile(nx, ny)) {
      _dogState.prevX = _dogState.x;
      _dogState.prevY = _dogState.y;
      _dogState.x = nx;
      _dogState.y = ny;
      return;
    }
  }
  // Completely boxed in — stay put.
}

//  Movement — shared step-toward helper
//  traverseAny: if true, skips terrain validity check (used for going home)

function _dogStepToward(destX, destY, traverseAny) {
  const distX = Math.abs(destX - _dogState.x);
  const distY = Math.abs(destY - _dogState.y);
  const dx = Math.sign(destX - _dogState.x);
  const dy = Math.sign(destY - _dogState.y);

  let moveX = 0, moveY = 0;
  if (distX === 0) {
    moveY = dy;
  } else if (distY === 0) {
    moveX = dx;
  } else if (distX > distY) {
    moveX = dx;
  } else if (distY > distX) {
    moveY = dy;
  } else {
    if (Math.random() < 0.5) moveX = dx; else moveY = dy;
  }

  const nx = _dogState.x + moveX;
  const ny = _dogState.y + moveY;

  if (traverseAny || _isValidDogTile(nx, ny)) {
    _dogState.prevX = _dogState.x;
    _dogState.prevY = _dogState.y;
    _dogState.x = nx;
    _dogState.y = ny;
  }
}

//  Movement — go home

function _dogStepTowardHome() {
  if (_dogState.x === DOG_HOUSE_X && _dogState.y === DOG_HOUSE_Y) return;
  _dogStepToward(DOG_HOUSE_X, DOG_HOUSE_Y, true);
}

//  Helpers

function _isValidDogTile(x, y) {
  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return false;
  const tile = state.tiles[tileIndex(x, y)];
  if (!tile) return false;
  // Avoid hazardous field tiles while wandering (daytime only).
  if (tile.kind === "field" && (tile.waterlogged || tile.scorched || tile.blackMsRemaining > 0)) return false;
  return true;
}


function _shuffleDirs(arr) {
  const a = arr.slice(); // never mutate the caller's array
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

//  Bark bubble

// ---- Bark helpers ----

function _triggerBarkIfOnSameTile() {
  if (!_dogState) return;
  if (_dogState.barkCooldownMs > 0) return;
  if (typeof isBuildingInteriorVisible === "function" && isBuildingInteriorVisible()) return;
  if (_dogState.x === state.farmer.x && _dogState.y === state.farmer.y) {
    _dogState.barkCooldownMs = DOG_BARK_COOLDOWN_MS;
    _playBark();
    _showBarkBubble();
  }
}

//  Initialise (or re-initialise) all dog DOM & state

function _playBark() {
  try {
    if (!_barkAudioCtx) {
      _barkAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = _barkAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;

    function makeYap(freq, startTime, duration, gain) {
      const osc      = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, startTime + duration);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    }

    makeYap(480, now,        0.12, 0.28);
    makeYap(520, now + 0.18, 0.10, 0.22);
  } catch (_) {
    // AudioContext unavailable — silently ignore.
  }
}

//  Bark trigger  (shared by dog-step and farmer-move paths)

// ---- DOM helpers ----

function _showBarkBubble() {
  if (!_dogEl) return;
  if (!_barkBubbleEl) {
    _barkBubbleEl = document.createElement("div");
    _barkBubbleEl.textContent = "Woof!";
    _barkBubbleEl.style.cssText = [
      "position:absolute",
      "bottom:100%",
      "left:50%",
      "transform:translateX(-50%)",
      "background:#fffde7",
      "border:1.5px solid #bda832",
      "border-radius:6px",
      "padding:1px 4px",
      "font-size:9px",
      "font-weight:bold",
      "white-space:nowrap",
      "pointer-events:none",
      "z-index:20",
      "color:#4a3800",
      "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
    ].join(";");
    _dogEl.appendChild(_barkBubbleEl);
  }
  _barkBubbleEl.style.display = "";
  clearTimeout(_barkBubbleTimeout);
  _barkBubbleTimeout = setTimeout(() => {
    if (_barkBubbleEl) _barkBubbleEl.style.display = "none";
  }, 1400);
}

//  DOM sync — move dog element into the correct tile

function _syncDogDom() {
  if (!_dogEl || !_dogState) return;
  const idx = tileIndex(_dogState.x, _dogState.y);
  if (idx === _lastDogTileIdx) return;
  const tileEl = tileElements?.[idx] ?? null;
  if (!tileEl) return;
  tileEl.appendChild(_dogEl);
  _lastDogTileIdx = idx;
}

//  CSS (injected once; id guard survives restarts)

(function injectDogCss() {
  if (document.getElementById("dog-styles")) return;
  const style = document.createElement("style");
  style.id = "dog-styles";
  style.textContent = `
    .dog__img {
      animation: dog-bounce 0.55s ease-in-out infinite alternate;
      transform-origin: bottom center;
      filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35));
    }
    @keyframes dog-bounce {
      from { transform: translateY(0px)  scaleX(1);    }
      to   { transform: translateY(-2px) scaleX(1.04); }
    }
    .dog-house-icon {
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4));
    }
  `;
  document.head.appendChild(style);
})();
