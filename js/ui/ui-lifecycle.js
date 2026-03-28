// ---- Lifecycle ----

const uiDisposers = [];

function addUiDisposer(disposeFn) {
  if (typeof disposeFn !== "function") return;
  uiDisposers.push(disposeFn);
  if (typeof wfRegisterAppDisposer === "function") {
    wfRegisterAppDisposer(disposeFn);
  }
}

function disposeUi() {
  while (uiDisposers.length) {
    const disposeFn = uiDisposers.pop();
    try {
      disposeFn();
    } catch (_) {}
  }
}
window.disposeUi = disposeUi;
