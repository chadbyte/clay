import { iconHtml, refreshIcons } from './icons.js';
import { closeSidebar } from './sidebar.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { copyToClipboard } from './utils.js';
import { getTerminalTheme } from './theme.js';
import { getTerminalFontFamily, getTerminalFontSize, onTerminalFontChange } from './terminal-prefs.js';
import { createKeyToolbar } from './terminal-toolbar.js';

var ctx;
var tabs = new Map(); // termId -> { id, title, exited, xterm, fitAddon, bodyEl }
var activeTabId = null;
var isOpen = false;
var keyToolbar = null;
var isTouchDevice = "ontouchstart" in window;
var viewportHandler = null;
var resizeObserver = null;

function disposeTab(tab) {
  if (tab._webglAddon) {
    try { tab._webglAddon.dispose(); } catch (e) {}
    tab._webglAddon = null;
  }
  if (tab.xterm) {
    tab.xterm.dispose();
    tab.xterm = null;
  }
  tab.fitAddon = null;
  if (tab.bodyEl && tab.bodyEl.parentNode) {
    tab.bodyEl.parentNode.removeChild(tab.bodyEl);
    tab.bodyEl = null;
  }
}
var termCtxMenu = null;

// --- Multi-line link provider ---
// xterm's WebLinksAddon only detects URLs on a single line.
// This provider reconstructs "logical lines" from wrapped buffer lines
// and detects URLs that span multiple rows.
function createMultiLineLinkProvider(xterm) {
  var URL_RE = /https?:\/\/[^\s'"\]>)}{]+/g;

  function getLogicalLine(buffer, y) {
    // Walk backward to find the start of the logical line
    var startY = y;
    while (startY > 0) {
      var line = buffer.getLine(startY);
      if (!line || !line.isWrapped) break;
      startY--;
    }

    // Walk forward to collect all wrapped continuation lines
    var endY = startY;
    var cols = xterm.cols;
    while (endY < buffer.length - 1) {
      var next = buffer.getLine(endY + 1);
      if (!next || !next.isWrapped) break;
      endY++;
    }

    // Build the full logical line text and track row boundaries
    var text = "";
    var rowOffsets = []; // { y, startOffset, length }
    for (var row = startY; row <= endY; row++) {
      var line = buffer.getLine(row);
      if (!line) break;
      var trimRight = (row === endY); // only trim trailing spaces on last row
      var rowText = line.translateToString(trimRight);
      rowOffsets.push({ y: row, startOffset: text.length, length: rowText.length });
      text += rowText;
    }

    return { text: text, startY: startY, endY: endY, rowOffsets: rowOffsets };
  }

  function offsetToBufferPos(rowOffsets, offset) {
    for (var i = 0; i < rowOffsets.length; i++) {
      var ro = rowOffsets[i];
      if (offset < ro.startOffset + ro.length) {
        return { x: offset - ro.startOffset + 1, y: ro.y + 1 }; // 1-based
      }
    }
    // Past end, clamp to last row
    var last = rowOffsets[rowOffsets.length - 1];
    return { x: last.length + 1, y: last.y + 1 };
  }

  return {
    provideLinks: function (y, callback) {
      var buffer = xterm.buffer.active;
      // y is 1-based in provideLinks
      var bufferY = y - 1;
      var logical = getLogicalLine(buffer, bufferY);

      // Only process if this logical line spans multiple rows
      if (logical.startY === logical.endY) {
        callback(undefined);
        return;
      }

      // Only trigger on the first row of the logical line to avoid duplicates
      if (bufferY !== logical.startY) {
        callback(undefined);
        return;
      }

      var links = [];
      var match;
      URL_RE.lastIndex = 0;
      while ((match = URL_RE.exec(logical.text)) !== null) {
        var urlStart = match.index;
        var urlEnd = match.index + match[0].length - 1;

        var startPos = offsetToBufferPos(logical.rowOffsets, urlStart);
        var endPos = offsetToBufferPos(logical.rowOffsets, urlEnd);

        // Only include if the URL actually spans multiple rows
        if (startPos.y !== endPos.y) {
          (function (url) {
            links.push({
              range: { start: startPos, end: endPos },
              text: url,
              activate: function () {
                window.open(url, "_blank", "noopener");
              },
            });
          })(match[0]);
        }
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
}

// --- Init ---
export function initTerminal(_ctx) {
  ctx = _ctx;
  registerRightWorkbench("terminal", closeTerminal);

  // Close panel button
  document.getElementById("terminal-close").addEventListener("click", function () {
    closeTerminal();
  });

  // Fullscreen toggle
  document.getElementById("terminal-fullscreen").addEventListener("click", function () {
    var isFs = ctx.terminalContainerEl.classList.toggle("panel-fullscreen");
    var icon = this.querySelector("[data-lucide]");
    if (icon) {
      icon.setAttribute("data-lucide", isFs ? "minimize-2" : "maximize-2");
      refreshIcons();
    }
    fitTerminal();
  });

  // Header toggle button
  var toggleBtn = document.getElementById("terminal-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      if (isOpen && !ctx.terminalContainerEl.classList.contains("hidden")) {
        closeTerminal();
      } else {
        openTerminal();
      }
    });
  }

  // Sidebar terminal button — toggles open/close. Second click (or the
  // Cmd+O hotkey on the same tile) dismisses the terminal panel.
  var sidebarTermBtn = document.getElementById("terminal-sidebar-btn");
  if (sidebarTermBtn) {
    sidebarTermBtn.addEventListener("click", function () {
      if (isOpen && !ctx.terminalContainerEl.classList.contains("hidden")) {
        closeTerminal();
      } else {
        closeSidebar();
        openTerminal();
      }
    });
  }

  // New tab button
  var newTabBtn = document.getElementById("terminal-new-tab");
  if (newTabBtn) {
    newTabBtn.addEventListener("click", function () {
      createNewTab();
    });
  }
}

// --- Open terminal panel ---
export function openTerminal() {
  var container = ctx.terminalContainerEl;

  // Hide file viewer if open (also unwatches)
  claimRightWorkbench("terminal");

  container.classList.remove("hidden");
  isOpen = true;

  // If no tabs exist, create one
  if (tabs.size === 0) {
    createNewTab();
    return; // createNewTab will handle the rest via term_created
  }

  // Attach to active tab (or first available)
  if (!activeTabId || !tabs.has(activeTabId)) {
    activeTabId = tabs.keys().next().value;
  }

  activateTab(activeTabId);

  // Mobile: close sidebar and hide tab bar
  if (window.innerWidth <= 768) {
    closeSidebar();
    var mTabBar = document.getElementById("mobile-tab-bar");
    if (mTabBar) mTabBar.classList.add("keyboard-hidden");
  }

  refreshIcons();
}

// --- Close terminal panel (hide, detach, but keep PTYs alive) ---
export function closeTerminal() {
  releaseRightWorkbench("terminal");
  var container = ctx.terminalContainerEl;
  container.classList.remove("panel-fullscreen");
  container.classList.add("hidden");
  // Reset fullscreen icon
  var fsIcon = document.querySelector("#terminal-fullscreen [data-lucide]");
  if (fsIcon) {
    fsIcon.setAttribute("data-lucide", "maximize-2");
    refreshIcons();
  }

  // Detach from active tab
  if (activeTabId && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_detach", id: activeTabId }));
  }

  cleanupListeners();

  // Hide toolbar
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar) toolbar.classList.add("hidden");
  if (keyToolbar) keyToolbar.reset();

  // Mobile: restore tab bar
  var mTabBar = document.getElementById("mobile-tab-bar");
  if (mTabBar) mTabBar.classList.remove("keyboard-hidden");

  isOpen = false;
}

// --- Create new tab ---
function createNewTab() {
  if (!ctx.ws || !ctx.connected) return;

  // Get current terminal body dimensions for cols/rows
  var cols = 80;
  var rows = 24;
  if (activeTabId && tabs.has(activeTabId)) {
    var activeTab = tabs.get(activeTabId);
    if (activeTab.xterm) {
      cols = activeTab.xterm.cols || 80;
      rows = activeTab.xterm.rows || 24;
    }
  }

  ctx.ws.send(JSON.stringify({ type: "term_create", cols: cols, rows: rows }));
}

// --- Close a tab (kill PTY) ---
function closeTab(termId) {
  if (!ctx.ws || !ctx.connected) return;
  ctx.ws.send(JSON.stringify({ type: "term_close", id: termId }));
}

// --- Activate a tab (show xterm, attach) ---
function activateTab(termId) {
  var tab = tabs.get(termId);
  if (!tab) return;

  // Detach from old active
  if (activeTabId && activeTabId !== termId && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_detach", id: activeTabId }));
  }

  // Hide all tab bodies
  for (var t of tabs.values()) {
    if (t.bodyEl) t.bodyEl.style.display = "none";
  }

  activeTabId = termId;

  // Lazy-create xterm instance
  if (!tab.xterm) {
    createXtermForTab(tab);
  }

  // Show this tab's body
  if (tab.bodyEl) tab.bodyEl.style.display = "";

  // Attach to server
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_attach", id: termId }));
  }

  // Fit and focus
  setupListeners();
  fitTerminal();
  // Re-fit after layout settles (flex may not have computed final size yet)
  setTimeout(fitTerminal, 50);

  if (tab.xterm) {
    tab.xterm.focus();
  }

  // Show toolbar on touch devices
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar && isTouchDevice) {
    toolbar.classList.remove("hidden");
    if (!keyToolbar) {
      keyToolbar = createKeyToolbar({
        toolbar: toolbar,
        send: function (data) {
          if (activeTabId && ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "term_input", id: activeTabId, data: data }));
          }
        },
      });
    }
    if (tab.xterm) keyToolbar.bindXterm(tab.xterm);
  }

  // Mobile viewport handling. Desktop browsers also expose visualViewport,
  // but applying the full viewport height there makes this panel taller than
  // #main-panels. Because the desktop panel is vertically centered, its top
  // edge (including the header) is then clipped when the browser is resized.
  if (isTouchDevice && window.visualViewport && !viewportHandler) {
    viewportHandler = function () {
      ctx.terminalContainerEl.style.height = window.visualViewport.height + "px";
      fitTerminal();
    };
    window.visualViewport.addEventListener("resize", viewportHandler);
  }

  renderTabBar();
}

// --- Create xterm.js instance for a tab ---
function createXtermForTab(tab) {
  if (typeof Terminal === "undefined") return;

  var xterm = new Terminal({
    cursorBlink: true,
    fontSize: getTerminalFontSize(),
    fontFamily: getTerminalFontFamily(),
    theme: getTerminalTheme(),
  });

  var fitAddon = null;
  if (typeof FitAddon !== "undefined") {
    fitAddon = new FitAddon.FitAddon();
    xterm.loadAddon(fitAddon);
  }

  // Web links addon: make URLs clickable (single-line)
  if (typeof WebLinksAddon !== "undefined") {
    xterm.loadAddon(new WebLinksAddon.WebLinksAddon());
  }

  // Custom multi-line link provider: detect URLs that wrap across lines
  xterm.registerLinkProvider(createMultiLineLinkProvider(xterm));

  // Create a container div for this tab's terminal
  var bodyEl = document.createElement("div");
  bodyEl.className = "terminal-tab-body";
  ctx.terminalBodyEl.appendChild(bodyEl);

  xterm.open(bodyEl);

  // WebGL addon: pixel-perfect rendering (eliminates gaps in block characters)
  // Must be loaded after xterm.open() so the rendering context is available.
  if (typeof WebglAddon !== "undefined") {
    try {
      var webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(function () {
        webgl.dispose();
        tab._webglAddon = null;
      });
      xterm.loadAddon(webgl);
      tab._webglAddon = webgl;
    } catch (e) {
      // WebGL not available, fall back to DOM renderer
    }
  }

  // Route input to server
  xterm.onData(function (data) {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "term_input", id: tab.id, data: data }));
    }
  });

  // Cmd/Ctrl+C copy and Cmd/Ctrl+V paste: intercept before xterm swallows the event
  xterm.attachCustomKeyEventHandler(function (e) {
    if (e.type !== "keydown") return true;
    // Cmd/Ctrl+C: copy selection if any, otherwise send SIGINT
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      var sel = xterm.getSelection();
      if (sel) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(sel).catch(function () {});
        }
        return false; // prevent xterm from handling
      }
      // No selection on macOS Cmd+C: do nothing (not SIGINT)
      if (e.metaKey) return false;
    }
    // Cmd/Ctrl+V: let browser handle paste event
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      return false; // let browser fire paste event
    }
    return true;
  });

  // Handle paste via browser paste event (works for Cmd+V, Ctrl+V, right-click paste)
  bodyEl.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text) {
      e.preventDefault();
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "term_input", id: tab.id, data: text }));
      }
    }
  });

  // Right-click context menu
  bodyEl.addEventListener("contextmenu", function (e) {
    showTermCtxMenu(e, tab);
  });

  tab.xterm = xterm;
  tab.fitAddon = fitAddon;
  tab.bodyEl = bodyEl;
}

// Rebuild a tab's WebGL glyph atlas, then force a full redraw.
//
// The WebGL renderer caches rasterized glyphs in a texture atlas keyed on
// the font (family + cell metrics). When the font changes or cell size
// shifts on resize, the atlas keeps glyphs rasterized from the old state,
// so text renders garbled until a full repaint rebuilds it. That repaint
// is exactly what "select all" triggers, which is why selecting everything
// appears to "fix" the corruption. clearTextureAtlas() forces the rebuild
// so glyphs re-rasterize at the new font/metrics immediately. Deferred one
// frame so any preceding fit() has settled. No-op on tabs that fell back to
// the DOM renderer. Mirrors the resize handler in session-tui-view.js.
function rebuildTabGlyphAtlas(tab) {
  if (!tab) return;
  requestAnimationFrame(function () {
    if (tab._webglAddon && typeof tab._webglAddon.clearTextureAtlas === "function") {
      try { tab._webglAddon.clearTextureAtlas(); } catch (e) {}
    }
    if (tab.xterm) {
      try { tab.xterm.refresh(0, tab.xterm.rows - 1); } catch (e) {}
    }
  });
}

// --- Fit active terminal ---
var fitRafId = null;

function fitTerminal() {
  if (fitRafId) cancelAnimationFrame(fitRafId);
  fitRafId = requestAnimationFrame(function () {
    fitRafId = null;
    if (!activeTabId) return;
    var tab = tabs.get(activeTabId);
    if (!tab || !tab.fitAddon || !tab.xterm) return;

    try {
      tab.fitAddon.fit();
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({
          type: "term_resize",
          id: activeTabId,
          cols: tab.xterm.cols,
          rows: tab.xterm.rows,
        }));
      }
    } catch (e) {}
    // Cell metrics shift on resize; rebuild the WebGL glyph atlas so glyphs
    // don't render against stale cell dimensions.
    rebuildTabGlyphAtlas(tab);
  });
}

// --- Setup/cleanup resize listeners ---
function setupListeners() {
  cleanupListeners();

  window.addEventListener("resize", fitTerminal);

  if (typeof ResizeObserver !== "undefined" && ctx.terminalBodyEl) {
    resizeObserver = new ResizeObserver(function () {
      fitTerminal();
    });
    resizeObserver.observe(ctx.terminalBodyEl);
  }
}

function cleanupListeners() {
  window.removeEventListener("resize", fitTerminal);

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if (viewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener("resize", viewportHandler);
    viewportHandler = null;
  }
  ctx.terminalContainerEl.style.height = "";
}

// --- Render tab bar ---
function renderTabBar() {
  var tabsEl = document.getElementById("terminal-tabs");
  if (!tabsEl) return;

  tabsEl.innerHTML = "";

  for (var tab of tabs.values()) {
    (function (t) {
      var el = document.createElement("div");
      el.className = "terminal-tab";
      if (t.id === activeTabId) el.classList.add("active");
      if (t.exited) el.classList.add("exited");

      var label = document.createElement("span");
      label.className = "terminal-tab-label";
      label.textContent = t.title;
      el.appendChild(label);

      // Double-click label to rename
      label.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        startRenameTab(t, label);
      });

      var moreBtn = document.createElement("button");
      moreBtn.className = "terminal-tab-more";
      moreBtn.innerHTML = '<i data-lucide="ellipsis" style="width:12px;height:12px"></i>';
      moreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        showTabContextMenu(e, t, label);
      });
      el.appendChild(moreBtn);

      el.addEventListener("click", function () {
        if (t.id !== activeTabId) {
          activateTab(t.id);
        }
      });

      tabsEl.appendChild(el);
    })(tab);
  }

  updateTerminalBadge();
  refreshIcons();
}

// --- Tab context menu (three-dot) ---
function showTabContextMenu(e, tab, labelEl) {
  var existing = document.querySelector(".terminal-tab-ctx");
  if (existing) existing.remove();

  var menu = document.createElement("div");
  menu.className = "terminal-tab-ctx";

  var renameItem = document.createElement("button");
  renameItem.className = "terminal-tab-ctx-item";
  renameItem.innerHTML = '<i data-lucide="pencil" style="width:13px;height:13px"></i> Rename';
  renameItem.addEventListener("click", function () {
    menu.remove();
    startRenameTab(tab, labelEl);
  });
  menu.appendChild(renameItem);

  var closeItem = document.createElement("button");
  closeItem.className = "terminal-tab-ctx-item terminal-tab-ctx-danger";
  closeItem.innerHTML = '<i data-lucide="trash-2" style="width:13px;height:13px"></i> Close';
  closeItem.addEventListener("click", function () {
    menu.remove();
    closeTab(tab.id);
  });
  menu.appendChild(closeItem);

  document.body.appendChild(menu);
  refreshIcons();

  // Position near the button
  var rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = rect.left + "px";

  // Dismiss on outside click
  function dismiss(ev) {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("mousedown", dismiss, true);
    }
  }
  setTimeout(function () {
    document.addEventListener("mousedown", dismiss, true);
  }, 0);
}

// --- Rename tab inline ---
function startRenameTab(tab, labelEl) {
  var input = document.createElement("input");
  input.className = "terminal-tab-rename";
  input.value = tab.title;
  input.maxLength = 50;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== tab.title) {
      tab.title = newTitle;
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "term_rename", id: tab.id, title: newTitle }));
      }
    }
    renderTabBar();
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { input.blur(); }
    if (e.key === "Escape") {
      input.value = tab.title; // revert
      input.blur();
    }
    e.stopPropagation();
  });
}

// --- Update terminal count badge ---
function updateTerminalBadge() {
  var countEl = document.getElementById("terminal-count");
  var sidebarCountEl = document.getElementById("terminal-sidebar-count");

  var count = 0;
  for (var t of tabs.values()) {
    if (!t.exited) count++;
  }

  if (countEl) {
    if (count > 0) {
      countEl.textContent = count;
      countEl.classList.remove("hidden");
    } else {
      countEl.classList.add("hidden");
    }
  }

  if (sidebarCountEl) {
    if (count > 0) {
      sidebarCountEl.textContent = count;
      sidebarCountEl.classList.remove("hidden");
    } else {
      sidebarCountEl.classList.add("hidden");
    }
  }

  var mobileCountEl = document.getElementById("mobile-terminal-count");
  if (mobileCountEl) {
    if (count > 0) {
      mobileCountEl.textContent = count;
      mobileCountEl.classList.remove("hidden");
    } else {
      mobileCountEl.classList.add("hidden");
    }
  }
}

// --- Handle server messages ---

export function handleTermList(msg) {
  // TUI session terminals are owned by session-tui-view.js and must not
  // appear in the bottom terminal panel. Filter them out before any tab
  // bookkeeping so the panel never tries to render or auto-attach them.
  var serverTerminals = (msg.terminals || []).filter(function (t) {
    return t && t.kind !== "tui-session";
  });
  var serverIds = new Set();

  // Add/update tabs from server list
  for (var i = 0; i < serverTerminals.length; i++) {
    var st = serverTerminals[i];
    serverIds.add(st.id);

    if (tabs.has(st.id)) {
      var existing = tabs.get(st.id);
      existing.title = st.title;
      existing.exited = st.exited;
    } else {
      tabs.set(st.id, {
        id: st.id,
        title: st.title,
        exited: st.exited,
        xterm: null,
        fitAddon: null,
        bodyEl: null,
      });
    }
  }

  // Remove tabs no longer on server
  for (var id of tabs.keys()) {
    if (!serverIds.has(id)) {
      var removed = tabs.get(id);
      disposeTab(removed);
      tabs.delete(id);
    }
  }

  // If active tab was removed, switch to first available
  if (activeTabId && !tabs.has(activeTabId)) {
    activeTabId = null;
  }

  renderTabBar();

  // If panel is open and we have tabs, re-attach
  if (isOpen && tabs.size > 0) {
    if (!activeTabId) {
      activeTabId = tabs.keys().next().value;
    }
    activateTab(activeTabId);
  }

  // If panel is open and all tabs are gone, close panel
  if (isOpen && tabs.size === 0) {
    closeTerminal();
  }
}

export function handleTermCreated(msg) {
  // Switch to the newly created tab
  if (msg.id && tabs.has(msg.id)) {
    activateTab(msg.id);
  }
}

export function handleTermOutput(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab && tab.xterm && msg.data) {
    tab.xterm.write(msg.data);
  }
}

export function handleTermResized(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab && tab.xterm && msg.cols > 0 && msg.rows > 0) {
    tab.xterm.resize(msg.cols, msg.rows);
  }
}

export function handleTermExited(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab) {
    tab.exited = true;
    if (tab.xterm) {
      tab.xterm.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
    }
    renderTabBar();
  }
}

export function handleTermClosed(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab) {
    disposeTab(tab);
    tabs.delete(msg.id);

    if (activeTabId === msg.id) {
      activeTabId = null;
      if (tabs.size > 0) {
        activeTabId = tabs.keys().next().value;
        activateTab(activeTabId);
      }
    }

    renderTabBar();

    // Close panel if no tabs left
    if (isOpen && tabs.size === 0) {
      closeTerminal();
    }
  }
}

// --- Reset on reconnect ---
export function resetTerminals() {
  // Dispose all xterm instances (server state survives, client re-syncs via term_list)
  for (var tab of tabs.values()) {
    disposeTab(tab);
  }
  tabs.clear();
  activeTabId = null;
  cleanupListeners();
  renderTabBar();
}

export function sendTerminalCommand(command) {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_input", id: activeTabId, data: command }));
  }
}

export function setTerminalTheme(xtermTheme) {
  for (var tab of tabs.values()) {
    if (tab.xterm) {
      tab.xterm.options.theme = xtermTheme;
    }
  }
}

// Live font update: applies family/size to every open shell terminal
// and refits each (cell dimensions change with font size, so cols/rows
// shift too). Hooked via onTerminalFontChange below.
function applyFontToAllTabs(family, size) {
  for (var tab of tabs.values()) {
    if (!tab.xterm) continue;
    try {
      if (family) tab.xterm.options.fontFamily = family;
      if (size) tab.xterm.options.fontSize = size;
      if (tab.fitAddon) tab.fitAddon.fit();
      // A font-size change shifts cell metrics, so fit() recomputes
      // cols/rows. Notify the PTY of the new size - otherwise the running
      // program keeps drawing to the old dimensions and the output looks
      // corrupted. (Font-family-only changes leave cols/rows unchanged,
      // making this a harmless no-op.) Mirrors fitTerminal()'s resize msg.
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({
          type: "term_resize",
          id: tab.id,
          cols: tab.xterm.cols,
          rows: tab.xterm.rows,
        }));
      }
    } catch (e) {}
    // Changing the font invalidates the WebGL glyph atlas; rebuild it so
    // the new font renders cleanly instead of stale, garbled cached glyphs.
    rebuildTabGlyphAtlas(tab);
  }
}
onTerminalFontChange(applyFontToAllTabs);

// --- Terminal context menu ---
function closeTermCtxMenu() {
  if (termCtxMenu) {
    termCtxMenu.remove();
    termCtxMenu = null;
  }
}

function showTermCtxMenu(e, tab) {
  e.preventDefault();
  e.stopPropagation();
  closeTermCtxMenu();

  var menu = document.createElement("div");
  menu.className = "term-ctx-menu";

  // Copy selection
  var sel = tab.xterm ? tab.xterm.getSelection() : "";
  if (sel) {
    var copySelItem = document.createElement("button");
    copySelItem.className = "term-ctx-item";
    copySelItem.innerHTML = iconHtml("copy") + " <span>Copy</span>";
    copySelItem.addEventListener("click", function (ev) {
      ev.stopPropagation();
      closeTermCtxMenu();
      if (sel) copyToClipboard(sel);
    });
    menu.appendChild(copySelItem);
  }

  // Copy entire console
  var copyItem = document.createElement("button");
  copyItem.className = "term-ctx-item";
  copyItem.innerHTML = iconHtml("clipboard-copy") + " <span>Copy Console</span>";
  copyItem.addEventListener("click", function (ev) {
    ev.stopPropagation();
    closeTermCtxMenu();
    if (!tab.xterm) return;
    tab.xterm.selectAll();
    var text = tab.xterm.getSelection();
    tab.xterm.clearSelection();
    if (text) copyToClipboard(text);
  });
  menu.appendChild(copyItem);

  // Paste
  var pasteItem = document.createElement("button");
  pasteItem.className = "term-ctx-item";
  pasteItem.innerHTML = iconHtml("clipboard-paste") + " <span>Paste</span>";
  pasteItem.addEventListener("click", function (ev) {
    ev.stopPropagation();
    closeTermCtxMenu();
    if (!tab.xterm) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (text && ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "term_input", id: tab.id, data: text }));
        }
      }).catch(function () { /* permission denied or not available */ });
    }
  });
  menu.appendChild(pasteItem);

  // Clear
  var clearItem = document.createElement("button");
  clearItem.className = "term-ctx-item";
  clearItem.innerHTML = iconHtml("trash-2") + " <span>Clear Console</span>";
  clearItem.addEventListener("click", function (ev) {
    ev.stopPropagation();
    closeTermCtxMenu();
    if (!tab.xterm) return;
    tab.xterm.clear();
  });
  menu.appendChild(clearItem);

  // Position at mouse cursor
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  document.body.appendChild(menu);

  // Clamp to viewport
  var rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 4) + "px";
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 4) + "px";
  }

  termCtxMenu = menu;
  refreshIcons();

  // Close on outside click (next tick to avoid immediate trigger)
  setTimeout(function () {
    document.addEventListener("click", closeTermCtxMenu, { once: true });
  }, 0);
}
