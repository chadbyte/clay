// Attachment snapshots describe the previous PTY size, not the current pane.
export function hasTerminalViewport(tab) {
  var rect = tab && tab.bodyEl && tab.bodyEl.getBoundingClientRect();
  return !!(rect && rect.width > 0 && rect.height > 0);
}

export function applyTerminalSize(tab, message, active, refit) {
  if (!tab || !tab.xterm || !(message.cols > 0 && message.rows > 0)) return;
  if (message.initial === true && active) {
    if (hasTerminalViewport(tab)) refit();
    return;
  }
  tab.xterm.resize(message.cols, message.rows);
}
