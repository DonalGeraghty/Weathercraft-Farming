x# Weathercraft Farming (prototype)

Top-down browser farming game prototype in plain HTML/CSS/JavaScript.

## Run

- Open `index.html` in your browser (double-click), or
- Serve the folder with any static server.

## Controls

- `WASD`: move the farmer around the outer path
- `Space`: plant on the highlighted adjacent field tile (uses a seed)
- `E`: harvest the highlighted adjacent tile (only if fully grown)

## Notes

- The farm is a 12×12 field inside a 14×14 world; the outer ring is the pathway.
- Time: 1 minute = 1 in-game day.
- Weather (Sun/Rain) changes daily and multiplies growth.
- Crops and weather are data-driven in `game.js` so you can add more later.

