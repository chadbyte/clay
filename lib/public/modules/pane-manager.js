// pane-manager.js — orchestration layer for concurrent panes
//
// Creates/destroys panes, manages CSS Grid layout, handles pane focus.
// Each pane gets its own WS connection, module instances, and message processor.

import { iconHtml, refreshIcons } from './icons.js';
import { createRewindInstance } from './rewind.js';
import { createInputInstance } from './input.js';
import { createToolsInstance } from './tools.js';
import { createFileBrowserInstance } from './filebrowser.js';
import { createTerminalInstance } from './terminal.js';
import { createStickyNotesInstance } from './sticky-notes.js';
import { closeSidebar } from './sidebar.js';
import { createPaneRenderer } from './pane-renderer.js';

var paneLayoutEl = null;
var panes = new Map(); // paneId -> pane object
var focusedPaneId = null;
var paneIdCounter = 0;
var globalCtx = null;

// --- Init ---

export function initPaneManager(ctx) {
  globalCtx = ctx;
  paneLayoutEl = document.getElementById("pane-layout");

  // Bootstrap primary pane from existing DOM
  var primaryEl = paneLayoutEl.querySelector('.pane[data-pane-id="primary"]');
  if (primaryEl) {
    var pane = {
      id: "primary",
      el: primaryEl,
      isPrimary: true,
      sessionId: null,
      sessionTitle: "New Session",
      agentStatus: "idle",
      modules: null, // primary uses singleton delegates from app.js
      ws: null,       // primary shares app.js's WS
      processor: null, // primary uses app.js's processMessage
    };
    panes.set("primary", pane);
    focusedPaneId = "primary";

    // Add click handler for focus
    primaryEl.addEventListener("mousedown", function () {
      setFocusedPane("primary");
    });
  }

  // Keyboard shortcuts for pane management
  document.addEventListener("keydown", function (e) {
    // Ctrl+\ — split focused pane vertically
    if (e.key === "\\" && e.ctrlKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      splitPane("horizontal");
      return;
    }
    // Ctrl+Shift+\ — split focused pane horizontally
    if (e.key === "\\" && e.ctrlKey && e.shiftKey && !e.metaKey) {
      e.preventDefault();
      splitPane("vertical");
      return;
    }
    // Ctrl+W — close focused pane (if >1 pane)
    if (e.key === "w" && e.ctrlKey && !e.shiftKey && !e.metaKey) {
      if (panes.size > 1 && focusedPaneId) {
        e.preventDefault();
        destroyPane(focusedPaneId);
        return;
      }
    }
    // Ctrl+1/2/3/4 — focus pane by index
    if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
      var num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        var paneIds = Array.from(panes.keys());
        if (num <= paneIds.length) {
          e.preventDefault();
          setFocusedPane(paneIds[num - 1]);
        }
      }
    }
  });
}

// --- Create a new pane ---

export function createPane(opts) {
  opts = opts || {};
  var template = document.getElementById("pane-template");
  if (!template) return null;

  var paneId = "pane-" + (++paneIdCounter);
  var clone = template.content.cloneNode(true);
  var paneEl = clone.querySelector(".pane");
  paneEl.dataset.paneId = paneId;

  // Add pane header bar
  var headerBar = document.createElement("div");
  headerBar.className = "pane-header-bar";
  headerBar.innerHTML =
    '<span class="pane-header-status-dot"></span>' +
    '<span class="pane-header-title-text">' + (opts.sessionTitle || "New Session") + '</span>' +
    '<button class="pane-split-h-btn" title="Split right">' + iconHtml("columns") + '</button>' +
    '<button class="pane-split-v-btn" title="Split down">' + iconHtml("rows") + '</button>' +
    '<button class="pane-close-btn" title="Close pane">' + iconHtml("x") + '</button>';
  paneEl.insertBefore(headerBar, paneEl.firstChild);

  // Pane-scoped $ helper
  function $(cls) { return paneEl.querySelector(".pane-" + cls); }

  // Build ctx for per-pane modules
  var paneCtx = {
    $: $,
    paneEl: paneEl,
    get ws() { return pane ? pane.ws : null; },
    get connected() { return pane ? pane.connected : false; },
    get processing() { return pane && pane.renderer ? pane.renderer.processing : false; },
    get basePath() { return globalCtx.basePath; },
    messagesEl: $("messages"),
    inputEl: $("input"),
    sendBtn: $("send-btn"),
    slashMenu: $("slash-menu"),
    imagePreviewBar: $("image-preview-bar"),
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
    // Cross-module callbacks — wired after all instances created
    closeSidebar: function () { closeSidebar(); },
    addSystemMessage: null,
    addUserMessage: null,
    scrollToBottom: null,
    setActivity: null,
    addToMessages: null,
    finalizeAssistantBlock: null,
    stopUrgentBlink: function () { /* per-pane: no-op for now */ },
    showImageModal: globalCtx.showImageModal,
    openFile: null,
    closeFileViewer: null,
    setRewindMode: null,
    isRewindMode: null,
    slashCommands: function () { return globalCtx.slashCommands(); },
    messageUuidMap: function () { return []; },
    hideSuggestionChips: function () {},
    setSendBtnMode: function () {},
    toggleUsagePanel: function () {},
    toggleStatusPanel: function () {},
    toggleContextPanel: function () {},
    resetContextData: function () {},
    isDmMode: function () { return false; },
    getDmKey: function () { return null; },
    handleDmSend: function () {},
    get turnCounter() { return 0; },
    getContextPercent: function () { return 0; },
  };

  // Create per-pane module instances
  var rewind = createRewindInstance(paneCtx);
  var input = createInputInstance(paneCtx);

  // Wire rewind callbacks for input
  paneCtx.setRewindMode = rewind.setRewindMode;
  paneCtx.isRewindMode = rewind.isRewindMode;

  var fileBrowser = createFileBrowserInstance(paneCtx);
  paneCtx.openFile = fileBrowser.openFile;
  paneCtx.closeFileViewer = fileBrowser.closeFileViewer;

  var tools = createToolsInstance(paneCtx);
  var terminal = createTerminalInstance(paneCtx);
  var stickyNotes = createStickyNotesInstance(paneCtx);

  // Build rendererCtx for secondary pane
  var rendererCtx = {
    $: $,
    paneEl: paneEl,
    messagesEl: $("messages"),
    inputEl: $("input"),
    sendBtn: $("send-btn"),
    connectOverlay: $("connect-overlay"),
    newMsgBtn: $("new-msg-btn"),
    suggestionChipsEl: $("suggestion-chips"),
    get ws() { return pane.ws; },
    get connected() { return pane.connected; },
    modules: { tools: tools, rewind: rewind, fileBrowser: fileBrowser,
               terminal: terminal, stickyNotes: stickyNotes, input: input },
    // Secondary panes: no global icon-strip status dot
    getStatusDot: function() { return null; },
    // Rate limit / fast mode go in pane header bar for secondary panes
    getStatusArea: function() { return pane.headerBar; },
    setSendBtnMode: function(mode) {
      var sb = $("send-btn");
      if (!sb) return;
      if (mode === "stop") { sb.classList.add("stop"); sb.innerHTML = '<i data-lucide="square"></i>'; }
      else { sb.classList.remove("stop"); sb.innerHTML = '<i data-lucide="arrow-up"></i>'; }
      refreshIcons();
    },
    startVerbCycle: function() {},
    stopVerbCycle:  function() {},
    startUrgentBlink: function() { if (globalCtx.startUrgentBlink) globalCtx.startUrgentBlink(); },
    stopUrgentBlink:  function() { if (globalCtx.stopUrgentBlink)  globalCtx.stopUrgentBlink();  },
    showImageModal: globalCtx.showImageModal,
    showPasteModal: function(t){ if (globalCtx.showPasteModal) globalCtx.showPasteModal(t); },
    showConfirm: globalCtx.showConfirm,
    sendMessage: function(){ if (input.sendMessage) input.sendMessage(); },
    autoResize: function(){ if (input.autoResize) input.autoResize(); },
    enableMainInput: function(){ if (tools.enableMainInput) tools.enableMainInput(); },
    clearPendingImages: function(){ if (input.clearPendingImages) input.clearPendingImages(); },
    setRewindMode: rewind.setRewindMode,
    showRewindModal: function(m){ if (globalCtx.showRewindModal) globalCtx.showRewindModal(m); },
    clearPendingRewindUuid: function(){ if (rewind.clearPendingRewindUuid) rewind.clearPendingRewindUuid(); },
    addRewindButton: function(el){ if (rewind.addRewindButton) rewind.addRewindButton(el); },
    handleInputSync: function(t){ if (input.handleInputSync) input.handleInputSync(t); },
    // Search/navigate — secondary panes have no search timeline for now
    removeSearchTimeline:  function(){},
    getActiveSearchQuery:  function(){ return null; },
    buildSearchTimeline:   function(){},
    getPendingNavigate:    function(){ return null; },
    // Global UI — no-op for secondary panes
    hideHomeHub: function(){},
    closeSessionInfoPopover: function(){},
    updateRalphBars: function(){},
    updateLoopInputVisibility: function(){},
    updateLoopButton: function(){},
    showLoopBanner: function(){},
    updateLoopBanner: function(){},
    enterCraftingMode: function(){},
    handleRalphFilesStatus: function(){},
    handleLoopRegistryFiles: function(){},
    handleRalphFilesContent: function(){},
    // File system — delegate to per-pane fileBrowser instance
    handleFsList:          function(m){ if (fileBrowser.handleFsList)    fileBrowser.handleFsList(m);    },
    handleFsRead:          function(m){ if (fileBrowser.handleFsRead)    fileBrowser.handleFsRead(m);    },
    isProjectSettingsOpen: function(){ return false; },
    handleInstructionsRead:  function(){},
    handleInstructionsWrite: function(){},
    handleFileChanged: function(m){ if (fileBrowser.handleFileChanged) fileBrowser.handleFileChanged(m); },
    handleDirChanged:  function(m){ if (fileBrowser.handleDirChanged)  fileBrowser.handleDirChanged(m);  },
    handleFileHistory: function(m){ if (fileBrowser.handleFileHistory) fileBrowser.handleFileHistory(m); },
    handleGitDiff:     function(m){ if (fileBrowser.handleGitDiff)     fileBrowser.handleGitDiff(m);     },
    handleFileAt:      function(m){ if (fileBrowser.handleFileAt)      fileBrowser.handleFileAt(m);      },
    refreshIfOpen:     function(p){ if (fileBrowser.refreshIfOpen)     fileBrowser.refreshIfOpen(p);     },
    // Terminal — delegate to per-pane terminal instance
    handleTermList:    function(m){ if (terminal.handleTermList)    terminal.handleTermList(m);    },
    handleTermCreated: function(m){ if (terminal.handleTermCreated) terminal.handleTermCreated(m); },
    handleTermOutput:  function(m){ if (terminal.handleTermOutput)  terminal.handleTermOutput(m);  },
    handleTermExited:  function(m){ if (terminal.handleTermExited)  terminal.handleTermExited(m);  },
    handleTermClosed:  function(m){ if (terminal.handleTermClosed)  terminal.handleTermClosed(m);  },
    // Sticky notes — delegate to per-pane stickyNotes instance
    handleNotesList:   function(m){ if (stickyNotes.handleNotesList)   stickyNotes.handleNotesList(m);   },
    handleNoteCreated: function(m){ if (stickyNotes.handleNoteCreated) stickyNotes.handleNoteCreated(m); },
    handleNoteUpdated: function(m){ if (stickyNotes.handleNoteUpdated) stickyNotes.handleNoteUpdated(m); },
    handleNoteDeleted: function(m){ if (stickyNotes.handleNoteDeleted) stickyNotes.handleNoteDeleted(m); },
    // Notifications
    showDoneNotification: function(){ if (globalCtx.showDoneNotification) globalCtx.showDoneNotification(); },
    playDoneSound:        function(){ if (globalCtx.playDoneSound)        globalCtx.playDoneSound();        },
    isNotifAlertEnabled: function(){ return globalCtx.isNotifAlertEnabled ? globalCtx.isNotifAlertEnabled() : false; },
    isNotifSoundEnabled: function(){ return globalCtx.isNotifSoundEnabled ? globalCtx.isNotifSoundEnabled() : false; },
    // Phase 3D: pane header update on session_switched
    onSessionSwitched: function(sessionId, title) {
      pane.sessionId = sessionId;
      updatePaneHeader(paneId, title);
    },
  };

  // Append to layout
  paneLayoutEl.appendChild(paneEl);

  // Build pane object
  var pane = {
    id: paneId,
    el: paneEl,
    isPrimary: false,
    sessionId: opts.sessionId || null,
    sessionTitle: opts.sessionTitle || "New Session",
    agentStatus: "idle",
    connected: false,
    renderer: null,
    modules: {
      rewind: rewind,
      input: input,
      tools: tools,
      fileBrowser: fileBrowser,
      terminal: terminal,
      stickyNotes: stickyNotes,
    },
    ws: null,
    processor: null,
    ctx: paneCtx,
    headerBar: headerBar,
  };

  // Create renderer and wire paneCtx callbacks
  var renderer = createPaneRenderer(rendererCtx);
  pane.renderer = renderer;

  paneCtx.addSystemMessage    = function(t,e){ renderer.addSystemMessage(t,e); };
  paneCtx.addUserMessage      = function(t,i,p){ renderer.addUserMessage(t,i,p); };
  paneCtx.scrollToBottom      = function(){ renderer.scrollToBottom(); };
  paneCtx.setActivity         = function(t){ renderer.setActivity(t); };
  paneCtx.addToMessages       = function(el){ renderer.addToMessages(el); };
  paneCtx.finalizeAssistantBlock = function(){ renderer.finalizeAssistantBlock(); };
  paneCtx.messageUuidMap      = function(){ return renderer.messageUuidMap; };
  paneCtx.setSendBtnMode      = function(){};
  paneCtx.toggleUsagePanel    = function(){ renderer.toggleUsagePanel(); };
  paneCtx.toggleContextPanel  = function(){ renderer.toggleContextPanel(); };
  paneCtx.resetContextData    = function(){ renderer.resetContextData(); };
  paneCtx.hideSuggestionChips = function(){ renderer.hideSuggestionChips(); };
  paneCtx.getContextPercent   = function(){ return renderer.getContextPercent(); };
  Object.defineProperty(paneCtx, 'turnCounter', {
    get: function(){ return renderer.turnCounter; }, configurable: true
  });
  Object.defineProperty(paneCtx, 'processing', {
    get: function(){ return renderer.processing; }, configurable: true
  });

  panes.set(paneId, pane);

  // Set up pane header button handlers
  headerBar.querySelector(".pane-split-h-btn").addEventListener("click", function () {
    setFocusedPane(paneId);
    splitPane("horizontal");
  });
  headerBar.querySelector(".pane-split-v-btn").addEventListener("click", function () {
    setFocusedPane(paneId);
    splitPane("vertical");
  });
  headerBar.querySelector(".pane-close-btn").addEventListener("click", function () {
    destroyPane(paneId);
  });

  // Focus on click
  paneEl.addEventListener("mousedown", function () {
    setFocusedPane(paneId);
  });

  // Update layout
  updateGridLayout();
  refreshIcons();

  // Connect WS if a sessionId was provided
  if (opts.sessionId) {
    connectPane(pane, opts.sessionId);
  }

  return pane;
}

// --- Destroy a pane ---

export function destroyPane(paneId) {
  var pane = panes.get(paneId);
  if (!pane) return;

  // Don't destroy the last pane
  if (panes.size <= 1) return;

  // Close WS
  if (pane.ws) {
    pane.ws.onclose = null;
    pane.ws.close();
    pane.ws = null;
  }

  // Cleanup module instances
  if (pane.modules) {
    if (pane.modules.terminal) pane.modules.terminal.resetTerminals();
    // Timers and observers cleaned up by GC when closures are released
  }

  // Remove DOM
  if (pane.el && pane.el.parentNode) {
    pane.el.parentNode.removeChild(pane.el);
  }

  panes.delete(paneId);

  // If focused pane was destroyed, focus the first remaining
  if (focusedPaneId === paneId) {
    var first = panes.keys().next().value;
    setFocusedPane(first);
  }

  updateGridLayout();
}

// --- Connect pane WebSocket ---

export function connectPane(pane, sessionId) {
  if (pane.isPrimary) return; // primary pane uses app.js WS

  if (pane.ws) {
    pane.ws.onclose = null;
    pane.ws.close();
    pane.ws = null;
  }

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var paneWs = new WebSocket(protocol + "//" + location.host + globalCtx.wsPath);
  pane.ws = paneWs;

  var reconnectTimer = null;
  var reconnectDelay = 1000;

  paneWs.onopen = function() {
    pane.connected = true;
    if (pane.renderer) pane.renderer.setStatus("connected");
    reconnectDelay = 1000;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sessionId) {
      paneWs.send(JSON.stringify({ type: "switch_session", id: sessionId }));
    }
  };

  paneWs.onmessage = function(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch(e) { return; }
    if (pane.renderer) pane.renderer.processPaneMessage(msg);
  };

  paneWs.onclose = function() {
    pane.connected = false;
    if (pane.renderer) pane.renderer.setStatus("disconnected");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(function() {
        reconnectTimer = null;
        connectPane(pane, pane.sessionId);
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    }
  };

  paneWs.onerror = function() {};
}

// --- Query panes by session ---

export function getSessionPanes(sessionId) {
  var result = [];
  for (var p of panes.values()) {
    if (p.sessionId === sessionId) result.push(p.id);
  }
  return result;
}

// --- Split focused pane ---

export function splitPane(direction) {
  if (panes.size >= 4) return; // max 4 panes

  // Can't split on mobile
  if (window.innerWidth <= 768) return;

  var newPane = createPane({
    sessionTitle: "New Session",
  });

  if (newPane) {
    setFocusedPane(newPane.id);
  }

  return newPane;
}

// --- Focus management ---

export function setFocusedPane(paneId) {
  if (!panes.has(paneId)) return;

  // Remove focus from all
  for (var p of panes.values()) {
    p.el.classList.remove("pane-focused");
  }

  // Set focused
  focusedPaneId = paneId;
  var pane = panes.get(paneId);
  if (pane) {
    pane.el.classList.add("pane-focused");
    var inputEl = pane.el.querySelector(".pane-input");
    if (inputEl && !("ontouchstart" in window)) {
      inputEl.focus();
    }
  }
}

export function getFocusedPaneId() {
  return focusedPaneId;
}

export function getFocusedPane() {
  return panes.get(focusedPaneId) || null;
}

// --- Grid layout ---

function updateGridLayout() {
  var count = panes.size;
  // Remove all layout classes
  paneLayoutEl.classList.remove("pane-layout-1", "pane-layout-2h", "pane-layout-2v", "pane-layout-4");

  if (count <= 1) {
    paneLayoutEl.classList.add("pane-layout-1");
  } else if (count === 2) {
    paneLayoutEl.classList.add("pane-layout-2h");
  } else {
    paneLayoutEl.classList.add("pane-layout-4");
  }

  setupResizeHandles();
}

function initDragHandle(handle, direction) {
  handle.addEventListener("mousedown", function(e) {
    e.preventDefault();
    handle.classList.add("active");
    var startX = e.clientX;
    var startY = e.clientY;
    var startCols = paneLayoutEl.style.gridTemplateColumns;
    var startRows = paneLayoutEl.style.gridTemplateRows;
    var totalW = paneLayoutEl.offsetWidth;
    var totalH = paneLayoutEl.offsetHeight;

    function onMove(ev) {
      if (direction === "horizontal") {
        var dx = ev.clientX - startX;
        // Parse current first-column fraction or default to 50%
        var currentPct = 50;
        if (startCols) {
          var m = startCols.match(/^([\d.]+)%/);
          if (m) currentPct = parseFloat(m[1]);
        }
        var newPct = currentPct + (dx / totalW) * 100;
        newPct = Math.max(15, Math.min(85, newPct));
        paneLayoutEl.style.gridTemplateColumns = newPct + "% 1fr";
        startX = ev.clientX;
        startCols = paneLayoutEl.style.gridTemplateColumns;
      } else {
        var dy = ev.clientY - startY;
        var currentRowPct = 50;
        if (startRows) {
          var rm = startRows.match(/^([\d.]+)%/);
          if (rm) currentRowPct = parseFloat(rm[1]);
        }
        var newRowPct = currentRowPct + (dy / totalH) * 100;
        newRowPct = Math.max(15, Math.min(85, newRowPct));
        paneLayoutEl.style.gridTemplateRows = newRowPct + "% 1fr";
        startY = ev.clientY;
        startRows = paneLayoutEl.style.gridTemplateRows;
      }
    }

    function onUp() {
      handle.classList.remove("active");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function setupResizeHandles() {
  // Remove existing resize handles
  var existing = paneLayoutEl.querySelectorAll(".pane-resize-handle");
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].parentNode) existing[i].parentNode.removeChild(existing[i]);
  }

  var paneArr = Array.from(panes.values());
  var count = paneArr.length;

  if (count === 2) {
    // Single vertical handle on the right edge of the first pane
    var firstPane = paneArr[0];
    var handle = document.createElement("div");
    handle.className = "pane-resize-handle pane-resize-handle-h";
    firstPane.el.appendChild(handle);
    initDragHandle(handle, "horizontal");
  } else if (count >= 4) {
    // Vertical handle on right edge of top-left pane, horizontal on bottom edge of top-left
    var topLeft = paneArr[0];
    var hHandle = document.createElement("div");
    hHandle.className = "pane-resize-handle pane-resize-handle-h";
    topLeft.el.appendChild(hHandle);
    initDragHandle(hHandle, "horizontal");

    var vHandle = document.createElement("div");
    vHandle.className = "pane-resize-handle pane-resize-handle-v";
    topLeft.el.appendChild(vHandle);
    initDragHandle(vHandle, "vertical");
  }
}

export function applyGridLayout(layoutClass) {
  paneLayoutEl.classList.remove("pane-layout-1", "pane-layout-2h", "pane-layout-2v", "pane-layout-4");
  paneLayoutEl.classList.add(layoutClass);
}

// --- Query ---

export function getPanes() {
  return panes;
}

export function getPaneCount() {
  return panes.size;
}

export function getAttentionPanes() {
  var result = [];
  for (var p of panes.values()) {
    if (p.agentStatus === "waiting_permission" || p.agentStatus === "waiting_input") {
      result.push(p);
    }
  }
  return result;
}

// --- Update pane header ---

export function updatePaneHeader(paneId, title, status) {
  var pane = panes.get(paneId);
  if (!pane || !pane.headerBar) return;

  if (title !== undefined) {
    pane.sessionTitle = title;
    var titleEl = pane.headerBar.querySelector(".pane-header-title-text");
    if (titleEl) titleEl.textContent = title;
  }

  if (status !== undefined) {
    pane.agentStatus = status;
    var dot = pane.headerBar.querySelector(".pane-header-status-dot");
    if (dot) {
      dot.className = "pane-header-status-dot";
      if (status !== "idle") dot.classList.add(status);
    }
  }
}
