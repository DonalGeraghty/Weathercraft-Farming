(function() {
    const overlay = document.createElement('div');
    overlay.id = 'perf-overlay';
    overlay.style.position = 'fixed';
    overlay.style.bottom = '10px';
    overlay.style.right = '10px';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.color = '#00ff00';
    overlay.style.padding = '12px';
    overlay.style.fontFamily = "'Pixelify Sans', monospace";
    overlay.style.zIndex = '10000';
    overlay.style.pointerEvents = 'none';
    overlay.style.borderRadius = '8px';
    overlay.style.fontSize = '14px';
    overlay.style.lineHeight = '1.5';
    overlay.style.border = '1px solid #00ff00';
    overlay.style.boxShadow = '0 0 10px rgba(0,255,0,0.3)';
    overlay.style.display = 'none'; // Hidden by default
    document.body.appendChild(overlay);

    let lastTickTime = 0;
    let lastRenderTime = 0;
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let fps = 0;
    let visible = false;

    // Track ACTUAL DOM updates
    let domUpdates = 0;
    const originalRenderTile = window.renderTile;
    if (typeof originalRenderTile === 'function') {
        window.renderTile = function(idx, force) {
            const tile = state.tiles[idx];
            if (force || (tile && tile.dirty)) {
                domUpdates++;
            }
            return originalRenderTile.apply(this, arguments);
        };
    }

    const originalTick = window.tick;
    if (typeof originalTick === 'function') {
        window.tick = function() {
            const start = performance.now();
            originalTick.apply(this, arguments);
            lastTickTime = performance.now() - start;
        };
    }

    const originalRenderAll = window.renderAll;
    if (typeof originalRenderAll === 'function') {
        window.renderAll = function() {
            const start = performance.now();
            const prevUpdates = domUpdates;
            domUpdates = 0; 
            originalRenderAll.apply(this, arguments);
            const updatesThisFrame = domUpdates;
            domUpdates = updatesThisFrame; // Restore for display
            lastRenderTime = performance.now() - start;
        };
    }

    window.addEventListener('keydown', (e) => {
        if (e.shiftKey && e.key.toLowerCase() === 'p') {
            visible = !visible;
            overlay.style.display = visible ? 'block' : 'none';
            console.log("Performance Monitor: " + (visible ? "ON" : "OFF"));
        }
    });

    function updateOverlay() {
        if (visible) {
            const now = performance.now();
            frameCount++;
            if (now - lastFpsUpdate > 1000) {
                fps = frameCount;
                frameCount = 0;
                lastFpsUpdate = now;
            }

            const activeCrops = state.tiles.filter(t => t.crop).length;
            const blackTiles = state.tiles.filter(t => t.blackMsRemaining > 0).length;
            const hazards = state.tiles.filter(t => t.waterlogged || t.scorched).length;

            overlay.innerHTML = `
                <div style="color:#fff; border-bottom:1px solid #555; margin-bottom:5px; padding-bottom:2px;"><b>PERFORMANCE MONITOR</b></div>
                FPS: <span style="color:#fff">${fps}</span><br>
                Tick Logic: <span style="color:#fff">${lastTickTime.toFixed(3)}ms</span><br>
                DOM Render: <span style="color:#fff">${lastRenderTime.toFixed(3)}ms</span><br>
                Tile Updates: <span style="color:#fff">${domUpdates} / ${state.tiles.length}</span><br>
                <div style="margin-top:5px; border-top:1px solid #555; padding-top:2px;">
                    Crops: ${activeCrops} | Black: ${blackTiles}<br>
                    Hazards: ${hazards}<br>
                    Time: ${formatTimeOfDay(state.msIntoDay)}
                </div>
                <div style="font-size:10px; color:#aaa; margin-top:5px;">Press Shift+P to Toggle</div>
            `;
        }
        requestAnimationFrame(updateOverlay);
    }

    updateOverlay();
    console.log("Performance Test Script Loaded. Press Shift+P to toggle overlay.");
})();
