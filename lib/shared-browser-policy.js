// Browser capabilities are deliberately narrower than a shell or a raw CDP connection.
function browserUrl(value) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Enter an HTTP or HTTPS address");
  var text = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  var url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP and HTTPS addresses without embedded credentials are supported");
  return url.href;
}
function visibleUrl(value) {
  try { var url = new URL(value); return url.origin === "null" ? "" : url.origin + url.pathname; } catch (e) { return ""; }
}
function validateAction(value) {
  var event = Object.assign({}, value);
  if (["navigate", "back", "forward", "reload", "move", "down", "up", "click", "text", "key", "wheel", "resize", "select"].indexOf(event.kind) < 0) throw new Error("Unsupported browser action");
  if (event.kind === "navigate") event.url = browserUrl(event.url);
  if (event.selector !== undefined && (typeof event.selector !== "string" || !event.selector || event.selector.length > 1000)) throw new Error("Invalid selector");
  if (["move", "down", "up", "click"].includes(event.kind) && !event.selector && (!Number.isFinite(event.x) || !Number.isFinite(event.y))) throw new Error("Pointer coordinates are required");
  if (["text", "select"].includes(event.kind) && (typeof event.text !== "string" || event.text.length > 4096)) throw new Error("Text must be at most 4096 characters");
  if (event.kind === "select" && !event.selector) throw new Error("Select requires a selector");
  if (event.kind === "wheel" && !Number.isFinite(event.deltaY)) throw new Error("Invalid scroll amount");
  if (event.kind === "resize" && (!Number.isFinite(event.width) || !Number.isFinite(event.height) || event.width < 320 || event.width > 1920 || event.height < 240 || event.height > 1200)) throw new Error("Viewport must be 320–1920 by 240–1200");
  if (event.kind === "key" && !/^(Tab|Shift\+Tab|Enter|Backspace|Delete|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|ControlOrMeta\+A)$/.test(event.key)) throw new Error("Unsupported key");
  return event;
}
module.exports = { browserUrl: browserUrl, visibleUrl: visibleUrl, validateAction: validateAction };
