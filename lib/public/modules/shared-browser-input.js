import { store } from './store.js';
import { sendBrowserInput } from './shared-browser.js';

function writable() {
  var browser = store.get('sharedBrowser');
  return browser && browser.control === "user" && !browser.handoff && browser.phase === "live" && store.get('connected');
}
function ui(patch) { store.set({ sharedBrowserUi: Object.assign({}, store.get('sharedBrowserUi'), patch) }); }
export function clearBrowserInput() {
  var current = store.get('sharedBrowserUi') || {};
  clearTimeout(current.moveTimer);
  ui({ moveTimer: null, move: null, pointer: null, composing: false });
}
export function bindBrowserInput(canvas, keyboard) {
  function point(event) {
    var box = canvas.getBoundingClientRect();
    var scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    var x = (event.clientX - box.left - (box.width - canvas.width * scale) / 2) / scale;
    var y = (event.clientY - box.top - (box.height - canvas.height * scale) / 2) / scale;
    return { x: Math.max(0, Math.min(canvas.width - 1, x)), y: Math.max(0, Math.min(canvas.height - 1, y)) };
  }
  function flush() {
    var current = store.get('sharedBrowserUi') || {};
    clearTimeout(current.moveTimer);
    var move = current.move;
    ui({ move: null, moveTimer: null });
    if (move && writable()) sendBrowserInput(Object.assign({ kind: "move" }, move));
  }
  canvas.addEventListener("pointermove", function (event) {
    if (!writable()) return;
    var current = store.get('sharedBrowserUi') || {};
    ui({ move: point(event), moveTimer: current.moveTimer || setTimeout(flush, 40) });
  });
  canvas.addEventListener("pointerdown", function (event) {
    if (!writable() || event.button !== 0) return;
    event.preventDefault(); flush();
    canvas.setPointerCapture(event.pointerId);
    ui({ pointer: event.pointerId });
    keyboard.focus({ preventScroll: true });
    sendBrowserInput(Object.assign({ kind: "down" }, point(event)));
  });
  function release(event) {
    var current = store.get('sharedBrowserUi') || {};
    if (current.pointer !== event.pointerId) return;
    flush(); ui({ pointer: null });
    if (writable()) sendBrowserInput(Object.assign({ kind: "up" }, point(event)));
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("wheel", function (event) {
    if (!writable()) return;
    event.preventDefault(); sendBrowserInput({ kind: "wheel", deltaY: event.deltaY });
  }, { passive: false });
  canvas.addEventListener("focus", function () { if (writable()) keyboard.focus({ preventScroll: true }); });
  keyboard.addEventListener("compositionstart", function () { ui({ composing: true }); });
  keyboard.addEventListener("compositionend", function () { ui({ composing: false }); if (writable() && keyboard.value) sendBrowserInput({ kind: "text", text: keyboard.value }); keyboard.value = ""; });
  keyboard.addEventListener("input", function () {
    if ((store.get('sharedBrowserUi') || {}).composing) return;
    if (writable() && keyboard.value) sendBrowserInput({ kind: "text", text: keyboard.value });
    keyboard.value = "";
  });
  keyboard.addEventListener("keydown", function (event) {
    if (!writable() || event.isComposing) return;
    var key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "a") key = "ControlOrMeta+A";
    else if (key === "Tab" && event.shiftKey) key = "Shift+Tab";
    if (/^(Tab|Shift\+Tab|Enter|Backspace|Delete|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|ControlOrMeta\+A)$/.test(key)) {
      event.preventDefault(); sendBrowserInput({ kind: "key", key: key });
    }
  });
}
