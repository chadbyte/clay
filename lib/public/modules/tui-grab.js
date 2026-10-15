// tui-grab.js
//
// Old-BBS-style hover-and-click "grab" on top of a Claude TUI xterm.
// When the user moves the mouse over a chunk of assistant output, we
// figure out which assistant message it belongs to (by substring match
// against the on-disk JSONL transcript), draw a subtle overlay across
// the matching rows, and copy the *original* markdown to the clipboard
// on click — bypassing xterm's column-wrapped selection.
//
// Server pieces this talks to (see lib/tui-transcript-index.js and
// the tui_transcript_request / tui_transcript_state messages in
// lib/project-sessions.js):
//
//   c2s tui_transcript_request { id }
//        Asked once when attachTuiGrab() runs against a Claude TUI
//        session, so we have the index before the user starts moving
//        the mouse.
//
//   s2c tui_transcript_state { id, cliSessionId, messages: [...] }
//        Full replacement of the assistant index for one session.
//        Also pushed by the server when the JSONL file grows after a
//        new assistant turn.
//
// Codex sessions never receive a transcript_state (no JSONL), so the
// overlay stays disabled — selection copy still works normally.

import { store } from './store.js';

import { copyToClipboard, showToast } from './utils.js';
import { getWs } from './ws-ref.js';

// Minimum probe length. Short enough to fit between markdown
// decorations (a probe like "tui-grab.js" lives inside both sides:
// the matchKey wraps it in backticks, the rendered TUI strips them,
// but the 11-char content run is contiguous in both). Long enough
// to be reasonably unique across messages — at 14 chars random
// noise basically can't collide.
var MIN_MATCH_LEN = 14;

// Cap on the probe length per offset. We deliberately stay short so
// each probe lives inside one content run between decorations and
// won't fail just because matchKey has a backtick or "**" at its
// boundary. Multi-offset windowing covers the rest of the block.
var PROBE_LEN = 24;

// Debounce mousemove → match work. Same row hovered twice in a row
// short-circuits without re-computing, but this debounce also avoids
// burning CPU while the cursor flies across the terminal on its way
// to somewhere else.
var HOVER_DEBOUNCE_MS = 60;

// Per-localId cache so flipping between TUI sessions doesn't need a
// fresh round-trip. Replaced wholesale on every tui_transcript_state.
var indexBySession = Object.create(null);

var active = null;  // { xterm, containerEl, localId, overlayEl, hoverHandler, ... }

// One-time stylesheet injection. The overlay's entry animation lives
// in CSS (a fade-in + slight zoom-out with a quickly-fading glow,
// plus a diagonal "shine" band that sweeps once across the box) so
// the showOverlayForBlock path just toggles classes and the GPU
// does the rest.
var stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === "undefined" || !document.head) return;
  stylesInjected = true;
  var style = document.createElement("style");
  style.textContent = [
    "@keyframes tui-grab-enter {",
    "  0% { opacity: 0; transform: scale(1.035);",
    "       box-shadow: 0 0 18px 8px rgba(120,170,255,0.55), 0 0 4px 2px rgba(255,255,255,0.45) inset; }",
    "  55% { opacity: 1; transform: scale(1);",
    "        box-shadow: 0 0 18px 3px rgba(120,170,255,0.35), 0 0 0 0 rgba(255,255,255,0) inset; }",
    "  100% { box-shadow: 0 0 0 0 rgba(120,170,255,0); }",
    "}",
    ".tui-grab-overlay.tui-grab-entering {",
    "  animation: tui-grab-enter 480ms cubic-bezier(.18,.74,.34,1);",
    "  transform-origin: center;",
    "}",
    "@keyframes tui-grab-shine {",
    "  0%   { transform: translateX(-70%); opacity: 0; }",
    "  18%  { opacity: 0.6; }",
    "  100% { transform: translateX(170%); opacity: 0; }",
    "}",
    ".tui-grab-shine {",
    "  position: absolute; inset: 0; pointer-events: none; border-radius: inherit;",
    "  background: linear-gradient(105deg,",
    "    transparent 35%, rgba(200,225,255,0.55) 50%, transparent 65%);",
    "  animation: tui-grab-shine 650ms cubic-bezier(.18,.74,.34,1);",
    "  will-change: transform, opacity;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
}

function clearActive() {
  if (!active) return;
  if (active.hoverHandler) {
    active.containerEl.removeEventListener("mousemove", active.hoverHandler);
    active.containerEl.removeEventListener("mouseleave", active.leaveHandler);
    active.containerEl.removeEventListener("click", active.clickHandler, true);
  }
  if (active.wheelHandler) {
    active.containerEl.removeEventListener("wheel", active.wheelHandler);
  }
  if (active.pageScrollHandler) {
    window.removeEventListener("scroll", active.pageScrollHandler, true);
  }
  if (active.scrollDisposable && typeof active.scrollDisposable.dispose === "function") {
    try { active.scrollDisposable.dispose(); } catch (e) {}
  }
  if (active.overlayEl && active.overlayEl.parentNode) {
    active.overlayEl.parentNode.removeChild(active.overlayEl);
  }
  if (active.debounceTimer) clearTimeout(active.debounceTimer);
  active = null;
}

// Build the overlay: a single rectangle covering the matched
// message's full buffer-row range, plus a floating "Click to grab"
// pill anchored to the top edge. The rect spans the terminal width
// — we don't try to trace each line's actual column extent. Treating
// the whole assistant block as one cell reads as "this is one
// thing" much better than a per-row outline, even though the right
// margin sits in empty cells.
function buildOverlay(containerEl) {
  ensureStyles();
  var overlay = document.createElement("div");
  overlay.className = "tui-grab-overlay";
  // overflow:hidden keeps the shine band clipped to the overlay's
  // rounded rect. box-shadow renders OUTSIDE the box so the entry
  // glow stays visible regardless.
  overlay.style.cssText =
    "position:absolute;left:0;right:0;pointer-events:none;display:none;" +
    "background:rgba(120,170,255,0.12);" +
    "border:1px solid rgba(120,170,255,0.55);" +
    "border-radius:4px;z-index:5;overflow:hidden;";
  var hint = document.createElement("div");
  hint.className = "tui-grab-hint";
  hint.textContent = "Click to grab";
  hint.style.cssText =
    "position:absolute;right:6px;top:-22px;font-size:11px;" +
    "padding:2px 8px;border-radius:10px;color:#fff;" +
    "background:rgba(40,80,160,0.85);" +
    "font-family:-apple-system,sans-serif;pointer-events:none;" +
    "white-space:nowrap;";
  overlay.appendChild(hint);
  containerEl.appendChild(overlay);
  return overlay;
}

// Cell metrics from the live xterm. Container coordinates only —
// works the same whether the renderer is WebGL or DOM. We re-measure
// on every match because font-size / resize can change cell height
// while a session is open.
function cellSize(xterm, containerEl) {
  var rect = containerEl.getBoundingClientRect();
  var cols = xterm.cols || 80;
  var rows = xterm.rows || 24;
  return {
    width: rect.width / cols,
    height: rect.height / rows,
    top: rect.top,
    left: rect.left,
  };
}


// Visual viewport row (0..rows-1) under the mouse, or -1 if outside
// the rendered grid.
function viewportRowAt(xterm, containerEl, clientY) {
  var dims = cellSize(xterm, containerEl);
  if (dims.height <= 0) return -1;
  var y = clientY - dims.top;
  if (y < 0) return -1;
  var row = Math.floor(y / dims.height);
  if (row < 0 || row >= xterm.rows) return -1;
  return row;
}

// Translate a viewport row into a buffer-absolute row (covers
// scrollback). xterm's buffer.active.viewportY is the buffer-row
// index of the top of the visible viewport.
function bufferRowFor(xterm, viewportRow) {
  var buf = xterm.buffer && xterm.buffer.active;
  if (!buf) return -1;
  return buf.viewportY + viewportRow;
}

function isBlankBufferRow(buf, row) {
  if (row < 0 || row >= buf.length) return true;
  var line = buf.getLine(row);
  if (!line) return true;
  var text = line.translateToString(true);
  return !text || /^\s*$/.test(text);
}

// Walk up/down from `row` while consecutive rows are non-blank. The
// returned [start, end] are both inclusive buffer-row indices that
// bound a single visual paragraph — the same chunk a human would
// double-click to "select all this."
function blockBounds(buf, row) {
  if (isBlankBufferRow(buf, row)) return null;
  var start = row;
  while (start > 0 && !isBlankBufferRow(buf, start - 1)) start--;
  var end = row;
  while (end < buf.length - 1 && !isBlankBufferRow(buf, end + 1)) end++;
  return { start: start, end: end };
}

// Reconstruct the block's text. isWrapped tells us when a buffer row
// continues the previous logical line (xterm broke it for terminal
// width) — those joins should not introduce a newline. Plain row
// transitions become newlines.
function blockText(buf, bounds) {
  var parts = [];
  for (var r = bounds.start; r <= bounds.end; r++) {
    var line = buf.getLine(r);
    if (!line) continue;
    var seg = line.translateToString(true);
    if (line.isWrapped) {
      parts.push(seg);
    } else {
      if (parts.length > 0) parts.push("\n");
      parts.push(seg);
    }
  }
  return parts.join("");
}

// Claude Code TUI decorates assistant messages with bullets / continuation
// markers that don't exist in the JSONL source. Strip the common ones
// before whitespace collapse so the substring match against matchKey
// actually hits.
//
//   ⏺   = start-of-message bullet
//   ⎿   = tool-result indent marker
//   ❯ ► = compact prompt indicators some themes use
//   >   = stale chevron from older claude versions
var TUI_BULLET_RE = /[⏺⎿❯►•>]+\s*/g;

function normalizeForMatch(s) {
  return String(s || "")
    .replace(TUI_BULLET_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Look for ANY window of `text` that appears in `matchKey`. Walking
// the probe origin across the text in small steps lets us tolerate
// asymmetric prefixes (numbered list markers, leading bullets, etc.)
// that one side might keep and the other might strip. As soon as
// one window hits we know this is the right message.
var PROBE_STEP = 3;
function textContainedIn(matchKey, text, minLen) {
  if (!matchKey || !text || text.length < minLen) return false;
  var max = text.length - minLen;
  for (var offset = 0; offset <= max; offset += PROBE_STEP) {
    var probeLen = Math.min(PROBE_LEN, text.length - offset);
    if (probeLen < minLen) break;
    var probe = text.substring(offset, offset + probeLen);
    if (matchKey.indexOf(probe) !== -1) return true;
    // Also try a shorter window at this offset so we still hit when
    // the content run between markdown decorations is exactly minLen
    // long (e.g. a 14-char filename inside backticks).
    if (probeLen > minLen) {
      var shortProbe = text.substring(offset, offset + minLen);
      if (matchKey.indexOf(shortProbe) !== -1) return true;
    }
  }
  return false;
}

// Count how many distinct probe windows from `text` appear in
// `matchKey`. Used to score messages for findMatchingMessage so we
// prefer the message that overlaps the *most* with the hovered block,
// not just the first or last one to share a single coincidence.
function countProbeHits(matchKey, text, minLen) {
  if (!matchKey || !text || text.length < minLen) return 0;
  var hits = 0;
  var max = text.length - minLen;
  for (var offset = 0; offset <= max; offset += PROBE_STEP) {
    var probeLen = Math.min(PROBE_LEN, text.length - offset);
    if (probeLen < minLen) break;
    if (matchKey.indexOf(text.substring(offset, offset + probeLen)) !== -1) {
      hits++;
      continue;
    }
    if (probeLen > minLen
        && matchKey.indexOf(text.substring(offset, offset + minLen)) !== -1) {
      hits++;
    }
  }
  return hits;
}

// Pick the message that overlaps the most with the hovered block.
// Two assistant turns that share a short common phrase (a markdown
// example, a quoted line, etc.) would both register as "containing"
// the probe if we just used a boolean — and the wrong one might win
// on iteration order. Scoring by hit count keeps the right message
// even when there's incidental overlap. Ties go to the later message
// (later in the array = later in the JSONL = the user's most recent
// turn, which is usually what they're hovering over).
function findMatchingMessage(messages, normalized) {
  if (!messages || !normalized || normalized.length < MIN_MATCH_LEN) return null;
  var best = null;
  var bestScore = 0;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (!m || !m.matchKey) continue;
    var score = countProbeHits(m.matchKey, normalized, MIN_MATCH_LEN);
    if (score === 0) continue;
    if (score > bestScore || (score === bestScore && best)) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

// Claude Code TUI marks tool calls and tool results with very
// specific visual signatures that never appear inside an assistant
// text message in the JSONL. Detecting them lets us hard-stop the
// upward / downward expansion at the right place even when a tool
// result happens to quote text that's also in the assistant message
// (e.g. shared file paths, command names, code snippets).
//
//   ⏺ Bash(...)          tool call (bullet + CapitalName + paren)
//   ⎿  Output line       tool result connector
//   ───── ╭───╮ etc.     box-drawing decorations around tool output
//
// The check runs against the *raw* row text (before normalize strips
// the bullets), so the markers are still visible to the regexes.
function looksLikeToolBoundary(raw) {
  if (!raw) return false;
  // Only inspect the first line of the paragraph — the tool-call /
  // tool-result markers live there in real Claude Code output.
  // Scanning the whole block for the marker character would catch
  // assistant prose that literally describes the markers (e.g.
  // "tool detection is ⎿ plus ⏺ CapitalWord(, two patterns")
  // and stop expansion in the middle of such a message.
  var firstLine = raw.split("\n")[0];
  // Tool result connector: line begins with ⎿ (possibly indented).
  if (/^\s*⎿/.test(firstLine)) return true;
  // Tool call signature: optional ⏺ bullet, then CapitalWord(. Bash,
  // Edit, Read, Write, Grep, Glob, Task, WebSearch, WebFetch, …
  // all conform. The ^ anchor matters: prose like "I'll use
  // Bash(...) later" must NOT match.
  if (/^\s*[⏺●]?\s*[A-Z][A-Za-z]+\s*\(/.test(firstLine)) return true;
  // (Intentionally no box-drawing detector: assistant messages
  // sometimes contain ASCII diagrams with ┌─┐│ etc., and we don't
  // want to stop expansion in the middle of one.)
  return false;
}

// Does this single paragraph look like it's part of `message`? We
// reuse the multi-offset window probe so a paragraph that starts with
// a different decoration than the rest of the message still counts.
// Tool-call paragraphs return false unconditionally — even when they
// happen to share text with the assistant message, they aren't part
// of the JSONL assistant block we're highlighting.
var MIN_PARA_MATCH = 10;
function paragraphBelongsToMessage(buf, bounds, message) {
  if (!bounds || !message || !message.matchKey) return false;
  var raw = blockText(buf, bounds);
  if (looksLikeToolBoundary(raw)) return false;
  var text = normalizeForMatch(raw);
  if (!text) return false;
  if (text.length >= MIN_PARA_MATCH) {
    return textContainedIn(message.matchKey, text, MIN_PARA_MATCH);
  }
  // Very short paragraphs only count if they appear verbatim and have
  // at least a couple characters — otherwise "OK" would absorb the
  // world.
  return text.length >= 3 && message.matchKey.indexOf(text) !== -1;
}

// A "too short to match" paragraph — typically a markdown heading
// that TUI rendered without its ## (so "## 변경" comes through as
// just "변경", 2 chars). On its own we can't confidently say it
// belongs to the matched message, but if the paragraph BEYOND it
// also matches, the short one is clearly a heading inside the same
// assistant block and shouldn't break the highlight.
function isShortNeutralParagraph(buf, bounds) {
  if (!bounds) return false;
  var raw = blockText(buf, bounds);
  if (!raw || looksLikeToolBoundary(raw)) return false;
  var text = normalizeForMatch(raw);
  return text.length > 0 && text.length < 3;
}

// Markdown assistant messages routinely contain blank lines between
// paragraphs. blockBounds() only knows about visual paragraphs, so the
// initial bounds cover one paragraph at most. Expand it to every
// adjacent paragraph that's also a substring of the same matchKey, so
// the overlay covers the whole assistant message a human would call
// "one block."
function expandToMessageBounds(buf, initialBounds, message) {
  var start = initialBounds.start;
  var end = initialBounds.end;

  // Walk up across blank rows looking for prior paragraphs that
  // belong to the same message. A "neutral" short paragraph (e.g.
  // a heading rendered without its ##) doesn't stop us as long as
  // the paragraph BEYOND it also belongs — we then absorb the
  // short one too so the highlight doesn't have a hole in it.
  var cursor = start - 1;
  while (cursor >= 0) {
    while (cursor >= 0 && isBlankBufferRow(buf, cursor)) cursor--;
    if (cursor < 0) break;
    var prevBounds = blockBounds(buf, cursor);
    if (!prevBounds) break;
    if (paragraphBelongsToMessage(buf, prevBounds, message)) {
      start = prevBounds.start;
      cursor = prevBounds.start - 1;
      continue;
    }
    // Try to peek through a short neutral paragraph (heading / spacer).
    if (isShortNeutralParagraph(buf, prevBounds)) {
      var peekCursor = prevBounds.start - 1;
      while (peekCursor >= 0 && isBlankBufferRow(buf, peekCursor)) peekCursor--;
      if (peekCursor >= 0) {
        var peekPrev = blockBounds(buf, peekCursor);
        if (peekPrev && paragraphBelongsToMessage(buf, peekPrev, message)) {
          start = peekPrev.start;
          cursor = peekPrev.start - 1;
          continue;
        }
      }
    }
    break;
  }

  // Walk down with the same peek-through logic.
  cursor = end + 1;
  while (cursor < buf.length) {
    while (cursor < buf.length && isBlankBufferRow(buf, cursor)) cursor++;
    if (cursor >= buf.length) break;
    var nextBounds = blockBounds(buf, cursor);
    if (!nextBounds) break;
    if (paragraphBelongsToMessage(buf, nextBounds, message)) {
      end = nextBounds.end;
      cursor = nextBounds.end + 1;
      continue;
    }
    if (isShortNeutralParagraph(buf, nextBounds)) {
      var peekDown = nextBounds.end + 1;
      while (peekDown < buf.length && isBlankBufferRow(buf, peekDown)) peekDown++;
      if (peekDown < buf.length) {
        var peekNext = blockBounds(buf, peekDown);
        if (peekNext && paragraphBelongsToMessage(buf, peekNext, message)) {
          end = peekNext.end;
          cursor = peekNext.end + 1;
          continue;
        }
      }
    }
    break;
  }

  return { start: start, end: end };
}

function hideOverlay() {
  if (!active || !active.overlayEl) return;
  active.overlayEl.style.display = "none";
  active.currentMatch = null;
  active.currentBounds = null;
}

function playEntryAnimation(overlayEl) {
  if (!overlayEl) return;
  // Strip any previous shine band so it doesn't stack on a rapid
  // hover-out-then-hover-back-in cycle.
  var oldShine = overlayEl.querySelector(".tui-grab-shine");
  if (oldShine) oldShine.remove();
  // Restart the CSS keyframe animation by toggling the class off,
  // forcing a reflow, then on again. Just adding the class twice in
  // a row wouldn't restart the animation on the same element.
  overlayEl.classList.remove("tui-grab-entering");
  // Read offsetWidth to flush the style change.
  /* eslint-disable-next-line no-unused-expressions */
  void overlayEl.offsetWidth;
  overlayEl.classList.add("tui-grab-entering");
  // Light-sweep band on top, removed when the animation ends so it
  // doesn't sit around eating layer memory.
  var shine = document.createElement("div");
  shine.className = "tui-grab-shine";
  overlayEl.appendChild(shine);
  shine.addEventListener("animationend", function () {
    if (shine.parentNode) shine.parentNode.removeChild(shine);
  });
}

function showOverlayForBlock(bounds, match) {
  if (!active) return;
  var xterm = active.xterm;
  var containerEl = active.containerEl;
  var dims = cellSize(xterm, containerEl);
  if (dims.height <= 0) return;
  var buf = xterm.buffer && xterm.buffer.active;
  if (!buf) return;

  // Clip to the visible viewport. The overlay only paints over rows
  // that are currently rendered — anything scrolled out gets dropped
  // until it scrolls back into view.
  var vpStart = bounds.start - buf.viewportY;
  var vpEnd = bounds.end - buf.viewportY;
  if (vpEnd < 0 || vpStart >= xterm.rows) { hideOverlay(); return; }
  if (vpStart < 0) vpStart = 0;
  if (vpEnd >= xterm.rows) vpEnd = xterm.rows - 1;
  // Bleed the rect past the cell edges so the box wraps the top and
  // bottom rows' glyphs cleanly. The top side gets noticeably more
  // padding than the bottom because glyph ascenders ride high in
  // the cell and the visual line above the matched message tends
  // to be a blank gap — extra top air reads better than crowding
  // the first line. Both pads scale with cell height so the look
  // stays consistent across font sizes.
  var topPad = Math.max(6, Math.round(dims.height * 0.5));
  var botPad = Math.max(3, Math.round(dims.height * 0.25));
  var rawTop = vpStart * dims.height - topPad;
  var top = Math.max(-topPad, Math.round(rawTop));
  var height = Math.round((vpEnd - vpStart + 1) * dims.height + topPad + botPad);
  // Detect whether this is a fresh match (different message or first
  // show) versus a re-position triggered by scroll. Only the former
  // gets the entry animation — replaying the shine on every scroll
  // tick would be obnoxious.
  var isNewMatch = active.currentMatch !== match;
  var wasHidden = active.overlayEl.style.display === "none";
  active.overlayEl.style.top = top + "px";
  active.overlayEl.style.height = height + "px";
  active.overlayEl.style.display = "block";
  active.currentMatch = match;
  active.currentBounds = bounds;
  if (isNewMatch || wasHidden) {
    playEntryAnimation(active.overlayEl);
  }
}

// Scroll wipes the overlay. Tracking buffer rows through a scroll
// works, but the box visibly snaps to a new position and that reads
// as glitchy more than helpful. Hide and let the next mousemove
// re-evaluate against wherever the cursor sits on the new viewport
// — the entry animation makes the re-appearance feel intentional.
function onXtermScroll() {
  if (!active) return;
  hideOverlay();
  active.lastBufferRow = -1;
}

function runMatch(clientX, clientY) {
  if (!active) return;
  var xterm = active.xterm;
  var containerEl = active.containerEl;
  var idx = indexBySession[active.localId];
  if (!idx || !idx.length) { hideOverlay(); return; }
  var vRow = viewportRowAt(xterm, containerEl, clientY);
  if (vRow < 0) { hideOverlay(); return; }
  var bRow = bufferRowFor(xterm, vRow);
  if (bRow < 0) { hideOverlay(); return; }
  var buf = xterm.buffer && xterm.buffer.active;
  if (!buf) { hideOverlay(); return; }
  // Same row as last time — don't redo the work (the overlay is
  // already correct for this row).
  if (active.lastBufferRow === bRow && active.currentMatch) return;
  active.lastBufferRow = bRow;
  var bounds = blockBounds(buf, bRow);
  if (!bounds) { hideOverlay(); return; }
  var text = blockText(buf, bounds);
  // The hovered paragraph itself might be a tool call or result.
  // Even if its text accidentally shares a long substring with some
  // assistant message, that's not the right thing to highlight —
  // tool I/O isn't part of the JSONL assistant block.
  if (looksLikeToolBoundary(text)) { hideOverlay(); return; }
  var normalized = normalizeForMatch(text);
  if (normalized.length < MIN_MATCH_LEN) { hideOverlay(); return; }
  var match = findMatchingMessage(idx, normalized);
  if (!match) { hideOverlay(); return; }
  // Initial bounds only cover the visual paragraph under the cursor.
  // Pull in adjacent paragraphs that also belong to the matched
  // message so the overlay covers the whole assistant block.
  var expanded = expandToMessageBounds(buf, bounds, match);
  showOverlayForBlock(expanded, match);
}

function flashOverlay() {
  if (!active || !active.overlayEl) return;
  var el = active.overlayEl;
  var prevBg = el.style.background;
  var prevBorder = el.style.borderColor;
  el.style.background = "rgba(120,200,140,0.30)";
  el.style.borderColor = "rgba(80,180,110,0.7)";
  setTimeout(function () {
    if (!el) return;
    el.style.background = prevBg || "rgba(120,170,255,0.12)";
    el.style.borderColor = prevBorder || "rgba(120,170,255,0.55)";
  }, 220);
}

function onClick(e) {
  if (!active || !active.currentMatch) return;
  // Only consume the click when it lands inside the highlighted block.
  // Anything outside falls through to xterm's normal selection.
  var bounds = active.currentBounds;
  var buf = active.xterm.buffer && active.xterm.buffer.active;
  if (!bounds || !buf) return;
  var vRow = viewportRowAt(active.xterm, active.containerEl, e.clientY);
  if (vRow < 0) return;
  var bRow = bufferRowFor(active.xterm, vRow);
  if (bRow < bounds.start || bRow > bounds.end) return;
  e.preventDefault();
  e.stopPropagation();
  var match = active.currentMatch;
  copyToClipboard(match.text).then(function () {
    flashOverlay();
    showToast("Grabbed!", "success");
  }).catch(function () {
    showToast("Copy failed", "error");
  });
}

function requestTranscript(localId) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "tui_transcript_request", id: localId }));
  } catch (e) {}
}

export function attachTuiGrab(xterm, containerEl, localId, opts) {
  if (!xterm || !containerEl || !localId) return;
  clearActive();
  // Vendors without TUI sessions have no transcript to match against.
  if (opts && opts.vendor) {
    var vendors = store.get('vendorInfo') || {};
    var info = vendors[opts.vendor];
    var supportsTui = info
      ? Array.isArray(info.sessionModes) && info.sessionModes.indexOf("tui") !== -1
      : false;
    if (!supportsTui) return;
  }

  var overlayEl = buildOverlay(containerEl);
  active = {
    xterm: xterm,
    containerEl: containerEl,
    localId: localId,
    overlayEl: overlayEl,
    debounceTimer: null,
    lastBufferRow: -1,
    currentMatch: null,
    currentBounds: null,
  };

  active.hoverHandler = function (e) {
    if (active.debounceTimer) clearTimeout(active.debounceTimer);
    var x = e.clientX, y = e.clientY;
    active.debounceTimer = setTimeout(function () { runMatch(x, y); }, HOVER_DEBOUNCE_MS);
  };
  active.leaveHandler = function () {
    if (active.debounceTimer) clearTimeout(active.debounceTimer);
    hideOverlay();
    active.lastBufferRow = -1;
  };
  active.clickHandler = onClick;

  containerEl.addEventListener("mousemove", active.hoverHandler);
  containerEl.addEventListener("mouseleave", active.leaveHandler);
  // Capture phase so we beat xterm's own click handler when the click
  // lands inside the highlighted block; outside the block we don't
  // call preventDefault, so xterm's selection behavior is preserved.
  containerEl.addEventListener("click", active.clickHandler, true);

  // Hide the overlay the moment the user scrolls in any way. The
  // matched message has moved relative to the viewport and chasing
  // it looks more like a glitch than a feature — let it vanish and
  // re-detect on the next mousemove.
  //
  // We listen on three different signals because none of them
  // cover every scroll path:
  //   - xterm.onScroll fires when the buffer's yDisp shifts. Good
  //     for programmatic scrolls and most wheel paths, but on macOS
  //     trackpad inertia it sometimes doesn't fire reliably for
  //     alternate-screen TUIs.
  //   - 'wheel' on the container captures any scroll gesture aimed
  //     at the terminal area regardless of who ends up scrolling.
  //   - 'scroll' on the surrounding page handles the case where the
  //     terminal itself isn't scrolling but its container is being
  //     scrolled within the chat layout.
  if (xterm && typeof xterm.onScroll === "function") {
    try { active.scrollDisposable = xterm.onScroll(onXtermScroll); }
    catch (e) { active.scrollDisposable = null; }
  }
  active.wheelHandler = onXtermScroll;
  containerEl.addEventListener("wheel", active.wheelHandler, { passive: true });
  active.pageScrollHandler = onXtermScroll;
  window.addEventListener("scroll", active.pageScrollHandler, { passive: true, capture: true });

  // If we already have a cached index for this session (came from a
  // prior request or a server-pushed update), don't refetch.
  if (!indexBySession[localId]) {
    requestTranscript(localId);
  }
}

export function detachTuiGrab() {
  clearActive();
}

// Called by app-messages when a tui_transcript_state arrives. Full
// replacement keyed by the session's localId.
export function handleTuiTranscriptState(msg) {
  if (!msg || !msg.id) return;
  indexBySession[msg.id] = Array.isArray(msg.messages) ? msg.messages : [];
  // If this update is for the currently active session, drop any
  // overlay state — the buffer row that used to map to a message may
  // not anymore (or vice versa). The next mousemove will recompute.
  if (active && active.localId === msg.id) {
    hideOverlay();
    active.lastBufferRow = -1;
  }
}

// Drop the cache entry for a session — call this when a session is
// deleted so we don't leak old indexes for sessions that no longer
// exist.
export function dropTuiTranscript(localId) {
  if (!localId) return;
  delete indexBySession[localId];
}
