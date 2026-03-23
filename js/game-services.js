const GameServices = (() => {
  const listenersByEvent = new Map();

  function on(eventName, handler) {
    if (!listenersByEvent.has(eventName)) {
      listenersByEvent.set(eventName, new Set());
    }
    const handlers = listenersByEvent.get(eventName);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) listenersByEvent.delete(eventName);
    };
  }

  function emit(eventName, payload) {
    const handlers = listenersByEvent.get(eventName);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  return { on, emit };
})();

function emitUiSync(flags = {}) {
  queueUiSync(flags);
}

function onUiSync(handler) {
  return GameServices.on("ui:sync", handler);
}

let queuedUiFlags = null;
let uiFlushRafId = 0;

function queueUiSync(flags = {}) {
  if (!queuedUiFlags) {
    queuedUiFlags = {};
  }
  Object.assign(queuedUiFlags, flags);
  if (uiFlushRafId) return;
  uiFlushRafId = requestAnimationFrame(flushUiSync);
}

function flushUiSync() {
  uiFlushRafId = 0;
  const flags = queuedUiFlags;
  queuedUiFlags = null;
  if (!flags) return;
  GameServices.emit("ui:sync", flags);
}
