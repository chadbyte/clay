import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, exportMarkdownAsPdf } from './markdown.js';
import { closeSidebar } from './sidebar.js';
import { closeTerminal } from './terminal.js';
import { renderUnifiedDiff, renderSplitDiff } from './diff.js';
import { initFileIcons, getFileIconSvg, getFolderIconSvg } from './fileicons.js';
import { copyMarkdownFormatting } from './rich-clipboard.js';
import { animateMarkdownChange, beginMarkdownPresentation, cancelMarkdownFollow, isFollowingMarkdown } from './markdown-live-edit.js';
import { store } from './store.js';
import { enterMarkdownSlides, exitMarkdownSlides, handleMarkdownSlideKey, syncMarkdownSlidesButton, toggleMarkdownSlideLevelMenu } from './markdown-slides.js';
import { initFileViewerTabs, openFileViewerTab, previewFileViewerTab, updateFileViewerTab, closeFileViewerTab, focusedFileViewerTab, clearFileViewerTabs } from './filebrowser-tabs.js';
import { closeIssues } from './issues.js';
import { initFileBrowserContextMenu, downloadProjectFile } from './filebrowser-context-menu.js';

var ctx;
var showDropHint = function () {};
var treeData = {};  // path -> { loaded, children }
var currentContent = null;  // last read file content for copy
var currentFilePath = null;  // path of the currently viewed file
var isRendered = false;      // markdown render toggle state
var currentIsMarkdown = false;
var currentIsSvg = false;
var historyVisible = false;
var currentHistoryEntries = [];
var pendingNavigate = null;  // { sessionLocalId, assistantUuid }
var selectedEntries = [];    // up to 2 selected for compare
var compareMode = false;
var inlineDiffActive = false;
var gitDiffCache = {};       // hash -> diff text
var pendingGitDiff = null;   // callback for pending git diff
var fileAtCache = {};        // hash -> file content
var pendingFileAt = null;    // callback for pending file-at
var FILE_RICH_PREVIEW_MAX_BYTES = 1024 * 1024;

export function initFileBrowser(_ctx) {
  ctx = _ctx;
  var mainPanels = document.getElementById("main-panels");
  if (mainPanels && ctx.fileViewerEl) mainPanels.appendChild(ctx.fileViewerEl);
  initFileViewerTabs({
    onFocus: function(path) {
      if (path !== currentFilePath) requestFileContent(path);
    },
    onEmpty: function() { teardownFileViewer(); },
  });

  // Load material file icons in background
  initFileIcons().then(function () {
    // Re-render tree if already loaded, so file icons appear
    if (treeData["."] && treeData["."].loaded) {
      renderTree();
    }
  });

  // --- Keyboard navigation ---
  // Arrow keys move a "keyboard focus" ring through visible tree items,
  // Enter activates (opens a file or toggles a folder), Left/Right
  // collapses/expands folders and ascends/descends into them. The tree
  // gets a tabindex so it can receive focus and keydown events.
  if (ctx.fileTreeEl) {
    initFileBrowserContextMenu(ctx.fileTreeEl);
    ctx.fileTreeEl.setAttribute('tabindex', '0');
    ctx.fileTreeEl.addEventListener('keydown', handleTreeKeyDown);
    // When the user clicks any tree row, promote it to keyboard focus
    // as well so subsequent arrow keys continue from that position.
    ctx.fileTreeEl.addEventListener('click', function (e) {
      var row = e.target && e.target.closest && e.target.closest('.file-tree-item');
      if (row) setKbFocus(row);
    });
  }

  // Search input <-> tree keyboard bridge:
  //   Enter in the search box drops focus back onto the tree and
  //   highlights the first visible result so the user can keep
  //   navigating with arrows. ArrowDown does the same for convenience.
  var searchInput = document.getElementById('fb-search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        focusFileTree();
        var items = getVisibleTreeItems();
        if (items.length) setKbFocus(items[0]);
      }
    });
  }

  // --- Drag-and-drop file paths into message input ---
  var inputEl = document.getElementById("input");
  var dropHintEl = null;
  var dropHintTimer = null;

  showDropHint = function () {
    if (!inputEl) return;
    if (!dropHintEl) {
      dropHintEl = document.createElement("div");
      dropHintEl.className = "fb-drop-hint";
      dropHintEl.textContent = "Drop here to insert file path";
      inputEl.parentElement.style.position = "relative";
      inputEl.parentElement.appendChild(dropHintEl);
    }
    dropHintEl.classList.add("visible");
    clearTimeout(dropHintTimer);
    // Auto-hide after drag ends without drop
    dropHintTimer = setTimeout(function () { hideDropHint(); }, 3000);
  }

  function hideDropHint() {
    clearTimeout(dropHintTimer);
    if (dropHintEl) dropHintEl.classList.remove("visible");
  }

  if (inputEl) {
    inputEl.addEventListener("dragover", function (e) {
      if (e.dataTransfer.types.indexOf("text/plain") !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        inputEl.classList.add("drop-target");
      }
    });
    inputEl.addEventListener("dragleave", function () {
      inputEl.classList.remove("drop-target");
    });
    inputEl.addEventListener("drop", function (e) {
      inputEl.classList.remove("drop-target");
      hideDropHint();
      var filePath = e.dataTransfer.getData("text/plain");
      if (!filePath) return;
      e.preventDefault();
      var cursorPos = inputEl.selectionStart || 0;
      var before = inputEl.value.substring(0, cursorPos);
      var after = inputEl.value.substring(cursorPos);
      var prefix = before.length > 0 && before[before.length - 1] !== " " && before[before.length - 1] !== "\n" ? " " : "";
      var suffix = after.length > 0 && after[0] !== " " && after[0] !== "\n" ? " " : "";
      inputEl.value = before + prefix + filePath + suffix + after;
      var newPos = cursorPos + prefix.length + filePath.length + suffix.length;
      inputEl.setSelectionRange(newPos, newPos);
      inputEl.focus();
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Hide hint when drag ends anywhere on the page
    document.addEventListener("dragend", function () {
      inputEl.classList.remove("drop-target");
      hideDropHint();
    });
  }

  // Close button
  document.getElementById("file-viewer-close").addEventListener("click", function () {
    closeFileViewerTab(focusedFileViewerTab());
  });

  // Full-viewport presentation toggle
  var fullscreenBtn = document.getElementById("file-viewer-fullscreen");
  fullscreenBtn.setAttribute("aria-pressed", "false");
  fullscreenBtn.addEventListener("click", function () {
    if (store.get('markdownSlidesActive')) exitMarkdownSlides();
    setFileViewerFullscreen(!store.get('fileViewerFullscreen'));
  });

  document.getElementById("file-viewer-slides").addEventListener("click", function () {
    if (store.get('markdownSlidesActive')) {
      exitMarkdownSlides();
      return;
    }
    var markdownEl = ensureRenderedMarkdown();
    if (enterMarkdownSlides(markdownEl, 0)) setFileViewerFullscreen(true);
  });

  document.getElementById("file-viewer-slide-level").addEventListener("click", function () {
    var markdownEl = markdownElementForActions();
    toggleMarkdownSlideLevelMenu(markdownEl);
  });

  // Copy button
  document.getElementById("file-viewer-copy").addEventListener("click", function () {
    if (currentContent) copyToClipboard(currentContent);
  });

  document.getElementById("file-viewer-copy-formatted").addEventListener("click", function () {
    if (!currentIsMarkdown) return;
    copyMarkdownFormatting(currentContent).catch(function (err) {
      console.error("Markdown formatting copy failed:", err);
    });
  });

  document.getElementById("file-viewer-download").addEventListener("click", function () {
    if (!currentFilePath) return;
    downloadProjectFile(currentFilePath);
  });

  // Markdown render toggle
  document.getElementById("file-viewer-render").addEventListener("click", function () {
    if (!currentContent || (!currentIsMarkdown && !currentIsSvg)) return;
    isRendered = !isRendered;
    if (currentIsSvg) {
      renderSvgBody();
      return;
    }
    if (!isRendered && isFollowingMarkdown(currentFilePath)) cancelMarkdownFollow();
    renderBody();
  });

  // PDF export button
  document.getElementById("file-viewer-pdf").addEventListener("click", function () {
    if (!currentIsMarkdown) return;
    var mdEl = ensureRenderedMarkdown();
    if (!mdEl) return;
    var btn = document.getElementById("file-viewer-pdf");
    btn.disabled = true;
    exportMarkdownAsPdf(mdEl, currentFilePath).then(function () {
      btn.disabled = false;
    }).catch(function (err) {
      btn.disabled = false;
      console.error("PDF export failed:", err);
    });
  });

  // History button
  document.getElementById("file-viewer-history").addEventListener("click", function () {
    if (currentHistoryEntries.length === 0) return;
    if (isFollowingMarkdown(currentFilePath)) cancelMarkdownFollow();
    historyVisible = !historyVisible;
    inlineDiffActive = false;
    compareMode = false;
    selectedEntries = [];
    ctx.fileViewerEl.classList.remove("file-viewer-wide");
    if (historyVisible) {
      renderHistoryPanel();
    } else {
      rerenderFileContent();
    }
  });

  // File viewer refresh button
  var viewerRefreshBtn = document.getElementById("file-viewer-refresh");
  if (viewerRefreshBtn) {
    viewerRefreshBtn.addEventListener("click", function () {
      if (!currentFilePath) return;
      viewerRefreshBtn.classList.add("spinning");
      setTimeout(function () { viewerRefreshBtn.classList.remove("spinning"); }, 500);
      // Refresh the content without kicking a rendered Markdown document back
      // to source mode. Automatic watcher refreshes use the same state path.
      pendingRefresh = true;
      requestFileContent(currentFilePath);
    });
  }

  // Refresh button
  var refreshBtn = document.getElementById("file-panel-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      refreshBtn.classList.add("spinning");
      setTimeout(function () { refreshBtn.classList.remove("spinning"); }, 500);
      refreshTree();
    });
  }

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (handleMarkdownSlideKey(e)) return;
    if (e.key === "Escape" && !ctx.fileViewerEl.classList.contains("hidden")) {
      if (store.get('fileViewerFullscreen')) {
        e.preventDefault();
        setFileViewerFullscreen(false);
        return;
      }
      closeFileViewer();
    }
  });

  // --- File search ---
  var fbSearchInput = document.getElementById("fb-search-input");
  var searchDebounce = null;

  if (fbSearchInput) {
    fbSearchInput.addEventListener("input", function () {
      var q = fbSearchInput.value.trim();
      if (searchDebounce) clearTimeout(searchDebounce);
      if (!q) {
        renderTree();
        restoreExpanded({});
        return;
      }
      searchDebounce = setTimeout(function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "fs_search", query: q }));
        }
      }, 200);
    });
    fbSearchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && fbSearchInput.value) {
        e.stopPropagation();
        fbSearchInput.value = "";
        renderTree();
        restoreExpanded({});
      }
    });
  }
}

// --- Keyboard navigation helpers ---

var _kbFocused = null;

export function focusFileTree() {
  if (!ctx || !ctx.fileTreeEl) return;
  ctx.fileTreeEl.focus();
  if (!_kbFocused) {
    var first = ctx.fileTreeEl.querySelector('.file-tree-item');
    if (first) setKbFocus(first);
  }
}

function setKbFocus(el) {
  if (_kbFocused && _kbFocused !== el) _kbFocused.classList.remove('fb-kb-focus');
  _kbFocused = el || null;
  if (el) {
    el.classList.add('fb-kb-focus');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
}

function isDirRow(row) {
  // Folder rows carry the chevron; file rows use a spacer instead.
  return !!(row && row.querySelector && row.querySelector('.file-tree-chevron'));
}

function getVisibleTreeItems() {
  if (!ctx || !ctx.fileTreeEl) return [];
  var all = ctx.fileTreeEl.querySelectorAll('.file-tree-item');
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    // Skip anything nested inside a hidden .file-tree-children subtree.
    var hidden = false;
    var p = el.parentNode;
    while (p && p !== ctx.fileTreeEl) {
      if (p.classList && p.classList.contains('file-tree-children') && p.classList.contains('hidden')) {
        hidden = true;
        break;
      }
      p = p.parentNode;
    }
    if (!hidden) out.push(el);
  }
  return out;
}

function moveKbFocus(delta) {
  var items = getVisibleTreeItems();
  if (items.length === 0) return;
  var idx = _kbFocused ? items.indexOf(_kbFocused) : -1;
  if (idx === -1) {
    idx = delta > 0 ? 0 : items.length - 1;
  } else {
    idx = Math.max(0, Math.min(items.length - 1, idx + delta));
  }
  setKbFocus(items[idx]);
}

function kbExpandOrDescend() {
  if (!_kbFocused) return;
  if (!isDirRow(_kbFocused)) return;
  if (!_kbFocused.classList.contains('expanded')) {
    _kbFocused.click(); // triggers the existing expand handler
    return;
  }
  // Already expanded — move focus to first child.
  var children = _kbFocused.nextElementSibling;
  if (children && children.classList.contains('file-tree-children')) {
    var first = children.querySelector('.file-tree-item');
    if (first) setKbFocus(first);
  }
}

function kbCollapseOrAscend() {
  if (!_kbFocused) return;
  if (isDirRow(_kbFocused) && _kbFocused.classList.contains('expanded')) {
    _kbFocused.click(); // triggers existing collapse handler
    return;
  }
  // On a file or a collapsed folder — move focus to the parent folder.
  var container = _kbFocused.parentNode;
  if (container && container.classList && container.classList.contains('file-tree-children')) {
    var parentRow = container.previousElementSibling;
    if (parentRow && parentRow.classList && parentRow.classList.contains('file-tree-item')) {
      setKbFocus(parentRow);
    }
  }
}

function kbActivate() {
  if (!_kbFocused) return;
  if (!isDirRow(_kbFocused) && _kbFocused.dataset.path) {
    openFileViewerTab(_kbFocused.dataset.path);
  }
  _kbFocused.click();
}

function handleTreeKeyDown(e) {
  // Any arrow key with an empty tree (e.g. "No files found" for a
  // search query) hands focus back to the search input so the user
  // can fix the query without clicking.
  var isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp'
             || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  if (isArrow && getVisibleTreeItems().length === 0) {
    e.preventDefault();
    var emptySearch = document.getElementById('fb-search-input');
    if (emptySearch) {
      if (_kbFocused) _kbFocused.classList.remove('fb-kb-focus');
      _kbFocused = null;
      emptySearch.focus();
      try { emptySearch.select(); } catch (err) { /* ignore */ }
    }
    return;
  }

  if (e.key === 'ArrowDown') { e.preventDefault(); moveKbFocus(1); return; }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    // At the top of the visible tree, pressing Up hands focus to the
    // search box — a natural escape upward. Enter there brings focus
    // back to the tree (handled by the search input's keydown below).
    var items = getVisibleTreeItems();
    if (items.length && _kbFocused === items[0]) {
      var searchInput = document.getElementById('fb-search-input');
      if (searchInput) {
        if (_kbFocused) _kbFocused.classList.remove('fb-kb-focus');
        searchInput.focus();
        try { searchInput.select(); } catch (err) { /* ignore */ }
        return;
      }
    }
    moveKbFocus(-1);
    return;
  }
  if (e.key === 'ArrowRight'){ e.preventDefault(); kbExpandOrDescend(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); kbCollapseOrAscend(); return; }
  if (e.key === 'Enter')     { e.preventDefault(); kbActivate(); return; }
  if (e.key === 'Home')      { e.preventDefault(); var items3 = getVisibleTreeItems(); if (items3.length) setKbFocus(items3[0]); return; }
  if (e.key === 'End')       { e.preventDefault(); var items4 = getVisibleTreeItems(); if (items4.length) setKbFocus(items4[items4.length - 1]); return; }
}

// --- File watch helpers ---
function sendWatch(filePath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_watch", path: filePath }));
  }
}

function sendUnwatch() {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_unwatch" }));
  }
}

function markdownElementForActions() {
  var rendered = document.querySelector("#file-viewer-body .file-viewer-markdown");
  if (rendered) return rendered;
  if (!currentIsMarkdown || currentContent == null) return null;
  var preview = document.createElement("div");
  preview.className = "file-viewer-markdown";
  preview.innerHTML = renderMarkdown(currentContent);
  return preview;
}

function ensureRenderedMarkdown() {
  if (!currentIsMarkdown || currentContent == null) return null;
  if (!isRendered) {
    isRendered = true;
    renderBody();
  }
  return document.querySelector("#file-viewer-body .file-viewer-markdown");
}

export function closeFileViewer() {
  if (focusedFileViewerTab()) {
    closeFileViewerTab(focusedFileViewerTab());
    return;
  }
  teardownFileViewer();
}

function teardownFileViewer() {
  if (currentFilePath && isFollowingMarkdown(currentFilePath)) cancelMarkdownFollow();
  sendUnwatch();
  inlineDiffActive = false;
  exitMarkdownSlides();
  ctx.fileViewerEl.classList.remove("file-viewer-wide");
  setFileViewerFullscreen(false);
  ctx.fileViewerEl.classList.add("hidden");
}

export function setFileViewerFullscreen(enabled) {
  var isFullscreen = !!enabled;
  var viewer = ctx && ctx.fileViewerEl ? ctx.fileViewerEl : document.getElementById("file-viewer");
  var button = document.getElementById("file-viewer-fullscreen");
  if (viewer) viewer.classList.toggle("panel-fullscreen", isFullscreen);
  store.set({ fileViewerFullscreen: isFullscreen });
  if (!button) return;
  button.setAttribute("aria-pressed", isFullscreen ? "true" : "false");
  button.setAttribute("aria-label", isFullscreen ? "Exit presentation mode" : "Enter presentation mode");
  button.title = isFullscreen ? "Exit presentation mode (Esc)" : "Enter presentation mode";
  var icon = button.querySelector("[data-lucide]");
  if (icon) {
    icon.setAttribute("data-lucide", isFullscreen ? "minimize-2" : "maximize-2");
    refreshIcons();
  }
}

export function resetFileBrowser() {
  clearFileViewerTabs();
  teardownFileViewer();
  // Clear all cached state
  treeData = {};
  currentContent = null;
  currentFilePath = null;
  isRendered = false;
  currentIsMarkdown = false;
  currentIsSvg = false;
  historyVisible = false;
  currentHistoryEntries = [];
  pendingNavigate = null;
  selectedEntries = [];
  compareMode = false;
  inlineDiffActive = false;
  gitDiffCache = {};
  pendingGitDiff = null;
  fileAtCache = {};
  pendingFileAt = null;
  // Clear tree UI
  if (ctx && ctx.fileTreeEl) ctx.fileTreeEl.innerHTML = "";
  // Hide the file browser panel, show sessions panel
  var filesPanel = document.getElementById("sidebar-panel-files");
  var sessionsPanel = document.getElementById("sidebar-panel-sessions");
  var sessionsHeaderContent = document.getElementById("sessions-header-content");
  if (filesPanel) filesPanel.classList.add("hidden");
  if (sessionsPanel) sessionsPanel.classList.remove("hidden");
  if (sessionsHeaderContent) sessionsHeaderContent.classList.remove("hidden");
}

var pendingOpenMode = null; // { type: "diff", oldStr, newStr } or null
var pendingRenderedOpen = false;

export function openFile(filePath, opts) {
  if (!filePath) return;
  closeIssues();
  if (followedFileChanged(filePath) || (opts && opts.diff && isFollowingMarkdown(filePath))) {
    cancelMarkdownFollow();
  }
  pendingRenderedOpen = !!(opts && opts.rendered);
  openFileViewerTab(filePath);
  if (opts && opts.diff) {
    pendingOpenMode = { type: "diff", oldStr: opts.diff.oldStr, newStr: opts.diff.newStr };
  } else {
    pendingOpenMode = null;
  }
  requestFileContent(filePath);
}

export function openWorkingTreeDiff(diff) {
  if (!diff || !diff.path) return;
  closeIssues();
  openFileViewerTab(diff.path);
  pendingRenderedOpen = false;
  pendingOpenMode = diff.binary ? null : {
    type: "diff",
    oldStr: diff.oldContent || "",
    newStr: diff.newContent || "",
    review: diff.review || null,
  };
  showFileContent({
    path: diff.path,
    content: diff.newContent || "",
    size: (diff.newContent || "").length,
    binary: !!diff.binary,
  });
}

export function presentMarkdownEdit(msg) {
  if (!msg || !beginMarkdownPresentation(msg.path)) return;
  openFileViewerTab(msg.path, { content: msg.content });
  pendingOpenMode = null;
  pendingRenderedOpen = true;
  pendingRefresh = false;
  showFileContent({
    path: msg.path,
    content: typeof msg.content === "string" ? msg.content : "",
    size: msg.size || 0,
  });
}

function followedFileChanged(filePath) {
  return currentFilePath && isFollowingMarkdown(currentFilePath) && !isFollowingMarkdown(filePath);
}

function renderBody(previousMarkdown, requestedSlideIndex) {
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");
  var pdfBtn = document.getElementById("file-viewer-pdf");
  var formattedCopyBtn = document.getElementById("file-viewer-copy-formatted");
  var resumeSlides = store.get('markdownSlidesActive') || typeof requestedSlideIndex === "number";
  var resumeSlideIndex = typeof requestedSlideIndex === "number" ? requestedSlideIndex : (store.get('markdownSlideIndex') || 0);
  if (store.get('markdownSlidesActive')) exitMarkdownSlides();

  if (isRendered) {
    bodyEl.innerHTML = '<div class="file-viewer-markdown">' + renderMarkdown(currentContent) + '</div>';
    // Rewrite relative image src to use /api/file endpoint
    var fileDir = currentFilePath ? currentFilePath.replace(/[^/]*$/, "") : "";
    var imgs = bodyEl.querySelectorAll(".file-viewer-markdown img");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute("src");
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:") && !src.startsWith("api/file")) {
        var resolvedPath = fileDir + src;
        imgs[i].src = "api/file?path=" + encodeURIComponent(resolvedPath);
      }
    }
    var markdownEl = bodyEl.querySelector(".file-viewer-markdown");
    if (previousMarkdown != null && isFollowingMarkdown(currentFilePath)) {
      animateMarkdownChange(markdownEl, previousMarkdown, currentContent, renderMarkdown);
    }
    highlightCodeBlocks(bodyEl);
    renderMermaidBlocks(bodyEl);
    var slideCount = syncMarkdownSlidesButton(markdownEl);
    if (resumeSlides && slideCount > 0) enterMarkdownSlides(markdownEl, resumeSlideIndex);
    renderBtn.classList.add("active");
    renderBtn.title = "Show raw";
    pdfBtn.classList.remove("hidden");
    formattedCopyBtn.classList.remove("hidden");
  } else {
    var pre = document.createElement("pre");
    var code = document.createElement("code");
    code.className = "language-markdown";
    code.textContent = currentContent;
    pre.appendChild(code);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(pre);
    if (typeof hljs !== "undefined") {
      hljs.highlightElement(code);
    }
    renderBtn.classList.remove("active");
    renderBtn.title = "Render markdown";
    pdfBtn.classList.remove("hidden");
    formattedCopyBtn.classList.remove("hidden");
    syncMarkdownSlidesButton(markdownElementForActions());
  }
  refreshIcons();
}

export function loadRootDirectory() {
  if (treeData["."] && treeData["."].loaded) return;
  requestDirectory(".");
}

export function refreshTree() {
  // Collect currently expanded directory paths
  var expandedDirs = ["."];
  var expandedEls = ctx.fileTreeEl.querySelectorAll(".file-tree-item.expanded");
  for (var i = 0; i < expandedEls.length; i++) {
    var childEl = expandedEls[i].nextElementSibling;
    if (childEl && childEl.dataset.parentPath) {
      expandedDirs.push(childEl.dataset.parentPath);
    }
  }
  // Clear cache for expanded dirs and re-request them
  for (var j = 0; j < expandedDirs.length; j++) {
    delete treeData[expandedDirs[j]];
    requestDirectory(expandedDirs[j]);
  }
}

function requestDirectory(dirPath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_list", path: dirPath }));
  }
}

function requestFileContent(filePath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_read", path: filePath }));
  }
}

var pendingRefresh = false;

export function refreshIfOpen(filePath) {
  if (!currentFilePath || ctx.fileViewerEl.classList.contains("hidden")) return;
  // Don't refresh while history panel or inline diff is showing
  if (historyVisible || inlineDiffActive) return;
  // Compare by suffix — tool paths are absolute, currentFilePath is relative
  if (filePath === currentFilePath || filePath.endsWith("/" + currentFilePath)) {
    pendingRefresh = true;
    requestFileContent(currentFilePath);
  }
}

// --- WS handlers ---

export function handleFsSearch(msg) {
  var entries = msg.entries || [];
  var query = (msg.query || "").trim().toLowerCase();
  if (!query) return;

  ctx.fileTreeEl.innerHTML = "";

  if (entries.length === 0) {
    ctx.fileTreeEl.innerHTML = '<div class="fb-search-empty">No files found</div>';
    return;
  }

  // Build a tree structure from flat search results
  var tree = {};
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var parts = entry.path.split("/");
    var node = tree;
    for (var j = 0; j < parts.length; j++) {
      if (!node[parts[j]]) node[parts[j]] = {};
      if (j === parts.length - 1) {
        node[parts[j]]._entry = entry;
      } else {
        node = node[parts[j]];
      }
    }
  }

  renderFilteredTree(ctx.fileTreeEl, tree, 0, query);
  refreshIcons();
}

function renderFilteredTree(container, tree, depth, query) {
  var keys = Object.keys(tree);
  var dirs = [];
  var files = [];
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === "_entry") continue;
    var node = tree[keys[i]];
    var entry = node._entry;
    if (entry && entry.type === "file") {
      files.push(keys[i]);
    } else {
      dirs.push(keys[i]);
    }
  }
  dirs.sort(function (a, b) {
    var aH = a.charAt(0) === ".";
    var bH = b.charAt(0) === ".";
    if (aH !== bH) return aH ? 1 : -1;
    return a.localeCompare(b);
  });
  files.sort(function (a, b) {
    var aH = a.charAt(0) === ".";
    var bH = b.charAt(0) === ".";
    if (aH !== bH) return aH ? 1 : -1;
    return a.localeCompare(b);
  });

  var allKeys = dirs.concat(files);
  for (var k = 0; k < allKeys.length; k++) {
    var name = allKeys[k];
    var node = tree[name];
    var entry = node._entry;
    var isDir = !entry || entry.type === "dir";

    var row = document.createElement("div");
    row.className = "file-tree-item" + (isDir ? " expanded" : "");
    row.dataset.entryType = isDir ? "dir" : "file";
    row.style.paddingLeft = (8 + depth * 16) + "px";
    if (entry) {
      row.draggable = true;
      row.dataset.path = entry.path;
      row.addEventListener("dragstart", function (e) {
        var cwd = ctx.cwd || "";
        var rel = this.dataset.path;
        var abs = cwd ? cwd.replace(/\/$/, "") + "/" + rel : rel;
        e.dataTransfer.setData("text/plain", abs);
        e.dataTransfer.effectAllowed = "copy";
      });
    }

    var nameHtml = highlightMatch(name, query);

    if (isDir) {
      row.innerHTML =
        '<span class="file-tree-chevron">' + iconHtml("chevron-right") + '</span>' +
        '<span class="file-tree-icon file-tree-folder-icon"></span>' +
        '<span class="file-tree-name">' + nameHtml + '</span>';

      (function (iconEl, n) {
        getFolderIconSvg(n, true, function (svg) { iconEl.innerHTML = svg; });
      })(row.querySelector(".file-tree-folder-icon"), name);

      var childContainer = document.createElement("div");
      childContainer.className = "file-tree-children";

      // Toggle expand/collapse on click
      (function (rowEl, childEl, folderName) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          var isExpanded = rowEl.classList.contains("expanded");
          rowEl.classList.toggle("expanded");
          childEl.classList.toggle("hidden", isExpanded);
          var folderIconEl = rowEl.querySelector(".file-tree-folder-icon");
          if (folderIconEl) {
            getFolderIconSvg(folderName, !isExpanded, function (svg) { folderIconEl.innerHTML = svg; });
          }
        });
      })(row, childContainer, name);

      container.appendChild(row);
      container.appendChild(childContainer);
      renderFilteredTree(childContainer, node, depth + 1, query);
    } else {
      row.innerHTML =
        '<span class="file-tree-spacer"></span>' +
        '<span class="file-tree-icon">' + getFileIconSvg(name) + '</span>' +
        '<span class="file-tree-name">' + nameHtml + '</span>';

      (function (filePath, rowEl) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          if (followedFileChanged(filePath)) cancelMarkdownFollow();
          var prev = ctx.fileTreeEl.querySelector(".file-tree-item.active");
          if (prev) prev.classList.remove("active");
          rowEl.classList.add("active");
          previewFileViewerTab(filePath);
          requestFileContent(filePath);
          if (window.innerWidth <= 768) closeSidebar();
        });
        rowEl.addEventListener("dblclick", function (e) {
          e.stopPropagation();
          openFileViewerTab(filePath);
        });
      })(entry.path, row);

      container.appendChild(row);
    }
  }
}

function highlightMatch(text, query) {
  var lower = text.toLowerCase();
  var idx = lower.indexOf(query);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) +
    '<mark>' + escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' +
    escapeHtml(text.substring(idx + query.length));
}

export function handleFsList(msg) {
  var dirPath = msg.path || ".";
  treeData[dirPath] = { loaded: true, children: msg.entries || [] };

  if (msg.error) {
    if (dirPath === ".") {
      ctx.fileTreeEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
    } else {
      var errEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
      if (errEl) {
        errEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
      }
    }
    return;
  }

  // Root level
  if (dirPath === ".") {
    // Preserve expanded state across re-render
    var expandedSet = {};
    var expandedEls = ctx.fileTreeEl.querySelectorAll(".file-tree-item.expanded");
    for (var ei = 0; ei < expandedEls.length; ei++) {
      var sib = expandedEls[ei].nextElementSibling;
      if (sib && sib.dataset.parentPath) expandedSet[sib.dataset.parentPath] = true;
    }
    renderTree();
    restoreExpanded(expandedSet);
    return;
  }

  // Sub-directory: re-render its child container
  var childEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
  if (childEl) {
    childEl.innerHTML = "";
    var depth = dirPath.split("/").length;
    renderEntries(childEl, treeData[dirPath].children, depth);
    refreshIcons();
  }
}

export function handleDirChanged(msg) {
  var dirPath = msg.path || ".";
  var oldData = treeData[dirPath];
  treeData[dirPath] = { loaded: true, children: msg.entries || [] };

  // Only re-render if the entries actually changed
  if (oldData && oldData.loaded) {
    var oldKeys = (oldData.children || []).map(function (e) { return e.name + ":" + e.type; }).sort().join(",");
    var newKeys = (msg.entries || []).map(function (e) { return e.name + ":" + e.type; }).sort().join(",");
    if (oldKeys === newKeys) return;
  }

  // Collect expanded directories before re-render
  var expandedSet = {};
  var expandedEls = ctx.fileTreeEl.querySelectorAll(".file-tree-item.expanded");
  for (var i = 0; i < expandedEls.length; i++) {
    var sib = expandedEls[i].nextElementSibling;
    if (sib && sib.dataset.parentPath) expandedSet[sib.dataset.parentPath] = true;
  }

  if (dirPath === ".") {
    renderTree();
    // Restore expanded state
    restoreExpanded(expandedSet);
  } else {
    var childEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
    if (childEl && !childEl.classList.contains("hidden")) {
      childEl.innerHTML = "";
      var depth = dirPath.split("/").length;
      renderEntries(childEl, treeData[dirPath].children, depth);
      refreshIcons();
    }
  }
}

function restoreExpanded(expandedSet) {
  var containers = ctx.fileTreeEl.querySelectorAll(".file-tree-children");
  for (var i = 0; i < containers.length; i++) {
    var p = containers[i].dataset.parentPath;
    if (p && expandedSet[p] && treeData[p] && treeData[p].loaded) {
      containers[i].classList.remove("hidden");
      var row = containers[i].previousElementSibling;
      if (row) row.classList.add("expanded");
      containers[i].innerHTML = "";
      var depth = p.split("/").length;
      renderEntries(containers[i], treeData[p].children, depth);
    }
  }
  // Restore active file highlight
  if (currentFilePath && !ctx.fileViewerEl.classList.contains("hidden")) {
    var items = ctx.fileTreeEl.querySelectorAll(".file-tree-item");
    for (var j = 0; j < items.length; j++) {
      var nameEl = items[j].querySelector(".file-tree-name");
      if (nameEl && nameEl.textContent === currentFilePath.split("/").pop()) {
        items[j].classList.add("active");
        break;
      }
    }
  }
  refreshIcons();
}

export function handleFsRead(msg) {
  showFileContent(msg);
}

// --- Tree rendering ---

function renderTree() {
  var root = treeData["."];
  if (!root || !root.children || root.children.length === 0) {
    ctx.fileTreeEl.innerHTML = '<div class="file-tree-empty">No files</div>';
    return;
  }
  ctx.fileTreeEl.innerHTML = "";
  renderEntries(ctx.fileTreeEl, root.children, 0);
  refreshIcons();
}

function sortEntries(entries) {
  return entries.slice().sort(function (a, b) {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    var aH = a.name.charAt(0) === ".";
    var bH = b.name.charAt(0) === ".";
    if (aH !== bH) return aH ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function renderEntries(container, entries, depth) {
  var sorted = sortEntries(entries);

  for (var i = 0; i < sorted.length; i++) {
    var entry = sorted[i];
    var row = document.createElement("div");
    row.className = "file-tree-item";
    row.dataset.entryType = entry.type;
    row.style.paddingLeft = (8 + depth * 16) + "px";

    row.draggable = true;
    row.dataset.path = entry.path;
    row.addEventListener("dragstart", function (e) {
      var cwd = ctx.cwd || "";
      var rel = this.dataset.path;
      var abs = cwd ? cwd.replace(/\/$/, "") + "/" + rel : rel;
      e.dataTransfer.setData("text/plain", abs);
      e.dataTransfer.effectAllowed = "copy";
      showDropHint();
    });

    if (entry.type === "dir") {
      row.innerHTML =
        '<span class="file-tree-chevron">' + iconHtml("chevron-right") + '</span>' +
        '<span class="file-tree-icon file-tree-folder-icon"></span>' +
        '<span class="file-tree-name">' + escapeHtml(entry.name) + '</span>';

      // Async-load folder icon SVG
      (function (iconEl, name) {
        getFolderIconSvg(name, false, function (svg) {
          iconEl.innerHTML = svg;
        });
      })(row.querySelector(".file-tree-folder-icon"), entry.name);

      var childContainer = document.createElement("div");
      childContainer.className = "file-tree-children hidden";
      childContainer.dataset.parentPath = entry.path;

      (function (dirPath, childEl, rowEl, folderName) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          var isExpanded = rowEl.classList.contains("expanded");
          if (isExpanded) {
            rowEl.classList.remove("expanded");
            childEl.classList.add("hidden");
          } else {
            rowEl.classList.add("expanded");
            childEl.classList.remove("hidden");
            if (!treeData[dirPath] || !treeData[dirPath].loaded) {
              childEl.innerHTML = '<div class="file-tree-loading">Loading...</div>';
              requestDirectory(dirPath);
            } else {
              childEl.innerHTML = "";
              var d = dirPath.split("/").length;
              renderEntries(childEl, treeData[dirPath].children, d);
              refreshIcons();
            }
          }
          // Swap folder icon open/closed
          var folderIconEl = rowEl.querySelector(".file-tree-folder-icon");
          if (folderIconEl) {
            getFolderIconSvg(folderName, !isExpanded, function (svg) {
              folderIconEl.innerHTML = svg;
            });
          }
        });
      })(entry.path, childContainer, row, entry.name);

      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      var fileSvg = getFileIconSvg(entry.name);
      row.innerHTML =
        '<span class="file-tree-spacer"></span>' +
        '<span class="file-tree-icon">' + fileSvg + '</span>' +
        '<span class="file-tree-name">' + escapeHtml(entry.name) + '</span>';

      (function (filePath, rowEl) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          if (followedFileChanged(filePath)) cancelMarkdownFollow();
          // Mark active
          var prev = ctx.fileTreeEl.querySelector(".file-tree-item.active");
          if (prev) prev.classList.remove("active");
          rowEl.classList.add("active");
          previewFileViewerTab(filePath);
          requestFileContent(filePath);
          // Mobile: close sidebar
          if (window.innerWidth <= 768) {
            closeSidebar();
          }
        });
        rowEl.addEventListener("dblclick", function (e) {
          e.stopPropagation();
          openFileViewerTab(filePath);
        });
      })(entry.path, row);

      container.appendChild(row);
    }
  }
}


// --- File viewer ---

function showFileContent(msg) {
  if (!updateFileViewerTab(msg.path, { content: msg.content })) return;
  var pathEl = document.getElementById("file-viewer-path");
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");
  var copyBtn = document.getElementById("file-viewer-copy");
  var previousContent = currentContent;
  var previousPath = currentFilePath;
  var previousWasMarkdown = currentIsMarkdown;
  var lightweightPreview = false;
  var refreshSlideIndex = pendingRefresh && store.get('markdownSlidesActive')
    ? store.get('markdownSlideIndex') || 0
    : null;

  exitMarkdownSlides();

  renderFileBreadcrumb(pathEl, msg.path);
  var keepRenderState = pendingRefresh && msg.path === currentFilePath;
  var prevRendered = isRendered;
  pendingRefresh = false;
  currentContent = null;
  currentFilePath = msg.path;
  currentIsMarkdown = false;
  currentIsSvg = false;
  if (!keepRenderState) isRendered = false;
  var requestedExt = msg.path.split(".").pop().toLowerCase();
  if (pendingRenderedOpen && (requestedExt === "md" || requestedExt === "mdx")) {
    currentIsMarkdown = true;
    isRendered = true;
  }
  renderBtn.classList.add("hidden");
  renderBtn.classList.remove("active");
  document.getElementById("file-viewer-pdf").classList.add("hidden");
  document.getElementById("file-viewer-copy-formatted").classList.add("hidden");
  document.getElementById("file-viewer-slides").classList.add("hidden");

  if (msg.error) {
    bodyEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
  } else if (msg.binary) {
    if (msg.imageUrl) {
      bodyEl.innerHTML = '<div class="file-viewer-image"><img src="' + escapeHtml(msg.imageUrl) + '" alt="' + escapeHtml(msg.path) + '"></div>';
    } else {
      bodyEl.innerHTML = '<div class="file-viewer-binary">Binary file (' + formatSize(msg.size) + ')</div>';
    }
  } else {
    currentContent = msg.content;
    var ext = requestedExt;
    lightweightPreview = (msg.size || 0) > FILE_RICH_PREVIEW_MAX_BYTES;
    currentIsMarkdown = !lightweightPreview && (ext === "md" || ext === "mdx");
    currentIsSvg = !lightweightPreview && ext === "svg";
    if (lightweightPreview) isRendered = false;
    if (pendingRenderedOpen && currentIsMarkdown) isRendered = true;

    if (currentIsMarkdown || currentIsSvg) {
      renderBtn.classList.remove("hidden");
      renderBtn.title = currentIsSvg ? "Show SVG source" : "Render markdown";
      copyBtn.title = currentIsSvg ? "Copy SVG source" : "Copy Markdown source";
    } else {
      copyBtn.title = "Copy contents";
    }

    // Markdown starts as source; SVG starts as a safe image preview.
    if (lightweightPreview) {
      renderLargeTextFile(bodyEl, msg.content, msg.size);
    } else if (currentIsMarkdown) {
      var transitionFrom = keepRenderState && prevRendered && previousWasMarkdown &&
        isFollowingMarkdown(msg.path) && pathsReferToSameFile(previousPath, msg.path)
        ? (previousContent == null ? "" : previousContent)
        : null;
      renderBody(transitionFrom, refreshSlideIndex);
    } else if (currentIsSvg) {
      if (!keepRenderState) isRendered = true;
      renderSvgBody();
    } else {
      renderCodeWithLineNumbers(bodyEl, msg.content, ext);
    }
  }

  closeTerminal();
  ctx.fileViewerEl.classList.remove("hidden");
  sendWatch(msg.path);
  refreshIcons();

  // If opened with a diff request, show full-file split diff in wide mode
  if (pendingOpenMode && lightweightPreview) {
    pendingOpenMode = null;
  } else if (pendingOpenMode && pendingOpenMode.type === "diff" && currentContent != null) {
    var diffOpts = pendingOpenMode;
    pendingOpenMode = null;
    historyVisible = false;
    compareMode = false;
    selectedEntries = [];
    currentHistoryEntries = [];
    gitDiffCache = {};
    fileAtCache = {};
    var historyBtn2 = document.getElementById("file-viewer-history");
    historyBtn2.classList.add("hidden");
    historyBtn2.classList.remove("active");
    requestFileHistory(msg.path);
    showInlineDiff(diffOpts.oldStr, diffOpts.newStr, diffOpts.review);
    pendingRenderedOpen = false;
    return;
  }
  pendingOpenMode = null;
  pendingRenderedOpen = false;

  // Request edit history for this file (skip on auto-refresh)
  if (!keepRenderState) {
    historyVisible = false;
    compareMode = false;
    selectedEntries = [];
    currentHistoryEntries = [];
    gitDiffCache = {};
    fileAtCache = {};
    var historyBtn = document.getElementById("file-viewer-history");
    historyBtn.classList.add("hidden");
    historyBtn.classList.remove("active");
    requestFileHistory(msg.path);
  }
}

function renderSvgBody() {
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");
  if (!bodyEl || !currentFilePath || currentContent == null) return;
  if (!isRendered) {
    renderCodeWithLineNumbers(bodyEl, currentContent, "svg");
    renderBtn.classList.remove("active");
    renderBtn.title = "Show SVG preview";
    return;
  }
  bodyEl.innerHTML = "";
  var preview = document.createElement("div");
  preview.className = "file-viewer-svg-preview";
  var image = document.createElement("img");
  image.src = "api/file?path=" + encodeURIComponent(currentFilePath);
  image.alt = currentFilePath;
  image.draggable = false;
  preview.appendChild(image);
  bodyEl.appendChild(preview);
  renderBtn.classList.add("active");
  renderBtn.title = "Show SVG source";
}

function renderFileBreadcrumb(root, path) {
  root.innerHTML = "";
  root.title = path;
  var parts = String(path || "").replace(/\\/g, "/").split("/").filter(function(part) { return part; });
  for (var i = 0; i < parts.length; i++) {
    if (i > 0) {
      var separator = document.createElement("span");
      separator.className = "file-viewer-path-separator";
      separator.textContent = "›";
      root.appendChild(separator);
    }
    var segment = document.createElement("span");
    segment.className = "file-viewer-path-segment" + (i === parts.length - 1 ? " current" : "");
    segment.textContent = parts[i];
    root.appendChild(segment);
  }
}

function pathsReferToSameFile(left, right) {
  if (!left || !right) return false;
  var a = String(left).replace(/\\/g, "/");
  var b = String(right).replace(/\\/g, "/");
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

export function handleFileChanged(msg) {
  if (!msg.path || msg.path !== currentFilePath) return;
  if (ctx.fileViewerEl.classList.contains("hidden")) return;
  if (historyVisible || inlineDiffActive) return;
  if (msg.content === currentContent) return;

  var bodyEl = document.getElementById("file-viewer-body");
  var scrollPos = bodyEl ? bodyEl.scrollTop : 0;
  pendingRefresh = true;
  showFileContent(msg);
  if (bodyEl) bodyEl.scrollTop = scrollPos;
}

function showInlineDiff(oldStr, newStr, review) {
  var bodyEl = document.getElementById("file-viewer-body");
  inlineDiffActive = true;
  ctx.fileViewerEl.classList.add("file-viewer-wide");

  if (!currentContent) return;

  // Reconstruct full "before" file by replacing new_string with old_string
  var fileBefore = currentContent;
  var fileAfter = currentContent;
  if (newStr && oldStr != null) {
    var pos = currentContent.indexOf(newStr);
    if (pos >= 0) {
      fileBefore = currentContent.substring(0, pos) + oldStr + currentContent.substring(pos + newStr.length);
    }
  }

  var diffLang = currentLang();
  var viewMode = "split";

  function render() {
    bodyEl.innerHTML = "";

    // Top bar
    var topBar = document.createElement("div");
    topBar.className = "file-history-view-bar";

    var backBtn = document.createElement("button");
    backBtn.className = "file-history-compare-back";
    backBtn.textContent = "Back to file";
    backBtn.addEventListener("click", function () {
      inlineDiffActive = false;
      ctx.fileViewerEl.classList.remove("file-viewer-wide");
      rerenderFileContent();
    });
    topBar.appendChild(backBtn);

    if (review) {
      var reviewNav = document.createElement("div");
      reviewNav.className = "git-diff-review-nav";
      var reviewCount = document.createElement("span");
      reviewCount.textContent = (review.index + 1) + " of " + review.total;
      reviewNav.appendChild(reviewCount);
      var previousBtn = document.createElement("button");
      previousBtn.type = "button";
      previousBtn.textContent = "\u2190";
      previousBtn.title = "Previous changed file";
      previousBtn.disabled = !review.previous;
      if (review.previous) previousBtn.addEventListener("click", review.previous);
      reviewNav.appendChild(previousBtn);
      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.textContent = "\u2192";
      nextBtn.title = "Next changed file";
      nextBtn.disabled = !review.next;
      if (review.next) nextBtn.addEventListener("click", review.next);
      reviewNav.appendChild(nextBtn);
      if (review.askAgent) {
        var askBtn = document.createElement("button");
        askBtn.type = "button";
        askBtn.className = "git-diff-ask-agent";
        askBtn.innerHTML = iconHtml("sparkles") + "<span>Review with Agent</span>";
        askBtn.setAttribute("data-tip", "Start a new agent session to review this file's current Git changes");
        askBtn.setAttribute("aria-label", "Review this file's Git changes with an agent");
        askBtn.addEventListener("click", review.askAgent);
        reviewNav.appendChild(askBtn);
        refreshIcons(askBtn);
      }
      topBar.appendChild(reviewNav);
    }

    var toggleWrap = document.createElement("div");
    toggleWrap.className = "file-history-view-toggle";

    var splitBtn = document.createElement("button");
    splitBtn.className = "file-history-toggle-btn" + (viewMode === "split" ? " active" : "");
    splitBtn.textContent = "Split";
    splitBtn.addEventListener("click", function () {
      viewMode = "split";
      render();
    });

    var unifiedBtn = document.createElement("button");
    unifiedBtn.className = "file-history-toggle-btn" + (viewMode === "unified" ? " active" : "");
    unifiedBtn.textContent = "Unified";
    unifiedBtn.addEventListener("click", function () {
      viewMode = "unified";
      render();
    });

    var sourceBtn = document.createElement("button");
    sourceBtn.className = "file-history-toggle-btn" + (viewMode === "source" ? " active" : "");
    sourceBtn.textContent = "Source";
    sourceBtn.addEventListener("click", function () {
      viewMode = "source";
      render();
    });

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    toggleWrap.appendChild(sourceBtn);
    topBar.appendChild(toggleWrap);
    bodyEl.appendChild(topBar);

    if (viewMode === "source") {
      ctx.fileViewerEl.classList.remove("file-viewer-wide");
      var sourceWrap = document.createElement("div");
      sourceWrap.className = "file-history-diff-full";
      var ext = currentFilePath ? currentFilePath.split(".").pop().toLowerCase() : "";
      var lang = mapExtToLanguage(ext);
      var pre = document.createElement("pre");
      pre.className = "file-viewer-code-content";
      var codeEl = document.createElement("code");
      if (lang) codeEl.className = "language-" + lang;
      codeEl.textContent = fileAfter;
      pre.appendChild(codeEl);
      sourceWrap.appendChild(pre);
      bodyEl.appendChild(sourceWrap);
      if (typeof hljs !== "undefined" && lang) {
        hljs.highlightElement(codeEl);
      }
    } else {
      ctx.fileViewerEl.classList.add("file-viewer-wide");

      // Full-file diff
      var diffWrap = document.createElement("div");
      diffWrap.className = "file-history-diff-full";

      if (viewMode === "split") {
        diffWrap.appendChild(renderSplitDiff(fileBefore, fileAfter, diffLang));
      } else {
        diffWrap.appendChild(renderUnifiedDiff(fileBefore, fileAfter, diffLang));
      }

      bodyEl.appendChild(diffWrap);

      // Scroll to first changed row
      requestAnimationFrame(function () {
        var firstChange = diffWrap.querySelector(".diff-row-change, .diff-row-add, .diff-row-remove");
        if (firstChange) {
          firstChange.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }

  render();
}

function mapExtToLanguage(ext) {
  var map = {
    js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    css: "css", html: "xml", xml: "xml", json: "json", yaml: "yaml",
    yml: "yaml", md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    cs: "csharp", swift: "swift", kt: "kotlin", vue: "xml", svelte: "xml"
  };
  return map[ext] || null;
}

function currentLang() {
  if (!currentFilePath) return null;
  var ext = currentFilePath.split(".").pop().toLowerCase();
  return mapExtToLanguage(ext);
}

function renderCodeWithLineNumbers(bodyEl, content, ext) {
  var lang = mapExtToLanguage(ext);
  var lines = content.split("\n");
  var lineCount = lines.length;

  var viewer = document.createElement("div");
  viewer.className = "file-viewer-code";

  var gutter = document.createElement("pre");
  gutter.className = "file-viewer-gutter";
  var nums = [];
  for (var i = 1; i <= lineCount; i++) nums.push(i);
  gutter.textContent = nums.join("\n");

  var codeWrap = document.createElement("pre");
  codeWrap.className = "file-viewer-code-content";
  var codeEl = document.createElement("code");
  if (lang) codeEl.className = "language-" + lang;
  codeEl.textContent = content;
  codeWrap.appendChild(codeEl);

  viewer.appendChild(gutter);
  viewer.appendChild(codeWrap);

  bodyEl.innerHTML = "";
  bodyEl.appendChild(viewer);

  if (typeof hljs !== "undefined" && lang) {
    hljs.highlightElement(codeEl);
  }
}

function renderLargeTextFile(bodyEl, content, size) {
  var viewer = document.createElement("div");
  viewer.className = "file-viewer-large-text";

  var notice = document.createElement("div");
  notice.className = "file-viewer-large-notice";
  notice.innerHTML = iconHtml("file-text") +
    "<span>Large file (" + formatSize(size || 0) + ") — showing plain text for performance</span>";

  var codeWrap = document.createElement("pre");
  var codeEl = document.createElement("code");
  codeEl.textContent = content;
  codeWrap.appendChild(codeEl);

  viewer.appendChild(notice);
  viewer.appendChild(codeWrap);
  bodyEl.innerHTML = "";
  bodyEl.appendChild(viewer);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// --- File edit history ---

function requestFileHistory(filePath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_file_history", path: filePath }));
  }
}

function requestGitDiff(hash, hash2) {
  if (ctx.ws && ctx.connected) {
    var msg = { type: "fs_git_diff", path: currentFilePath, hash: hash };
    if (hash2) msg.hash2 = hash2;
    ctx.ws.send(JSON.stringify(msg));
  }
}

export function handleFileHistory(msg) {
  currentHistoryEntries = msg.entries || [];
  var historyBtn = document.getElementById("file-viewer-history");

  if (currentHistoryEntries.length > 0 && currentContent !== null) {
    historyBtn.classList.remove("hidden");
  } else {
    historyBtn.classList.add("hidden");
    historyVisible = false;
  }

  if (historyVisible && !compareMode) {
    renderHistoryPanel();
  }
}

export function handleGitDiff(msg) {
  if (msg.hash && msg.diff !== undefined) {
    var key = msg.hash2 ? msg.hash + ".." + msg.hash2 : msg.hash;
    gitDiffCache[key] = msg.diff;
  }
  if (pendingGitDiff) {
    var cb = pendingGitDiff;
    pendingGitDiff = null;
    cb(msg);
  }
}

function requestFileAt(hash) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_file_at", path: currentFilePath, hash: hash }));
  }
}

export function handleFileAt(msg) {
  if (msg.hash && msg.content !== undefined) {
    fileAtCache[msg.hash] = msg.content;
  }
  if (pendingFileAt) {
    var cb = pendingFileAt;
    pendingFileAt = null;
    cb(msg);
  }
}

function rerenderFileContent() {
  var historyBtn = document.getElementById("file-viewer-history");
  historyBtn.classList.remove("active");

  if (!currentContent || !currentFilePath) return;
  var bodyEl = document.getElementById("file-viewer-body");
  var ext = currentFilePath.split(".").pop().toLowerCase();

  if (currentIsMarkdown) {
    renderBody();
  } else if (currentIsSvg) {
    renderSvgBody();
  } else {
    renderCodeWithLineNumbers(bodyEl, currentContent, ext);
  }
  refreshIcons();
}

function isEntrySelected(entry) {
  for (var i = 0; i < selectedEntries.length; i++) {
    if (selectedEntries[i] === entry) return i + 1;
  }
  return 0;
}

function toggleSelect(entry) {
  var idx = -1;
  for (var i = 0; i < selectedEntries.length; i++) {
    if (selectedEntries[i] === entry) { idx = i; break; }
  }
  if (idx >= 0) {
    selectedEntries.splice(idx, 1);
  } else {
    if (selectedEntries.length >= 2) selectedEntries.shift();
    selectedEntries.push(entry);
  }
  var bodyEl = document.getElementById("file-viewer-body");
  var scrollPos = bodyEl ? bodyEl.scrollTop : 0;
  renderHistoryPanel();
  if (bodyEl) {
    if (selectedEntries.length === 2) {
      // Both slots filled: scroll compare bar into view
      requestAnimationFrame(function () {
        var compareBtn = bodyEl.querySelector(".file-history-compare-btn");
        if (compareBtn) {
          compareBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    } else {
      // Restore scroll position
      bodyEl.scrollTop = scrollPos;
    }
  }
}

function renderHistoryPanel() {
  var bodyEl = document.getElementById("file-viewer-body");
  var historyBtn = document.getElementById("file-viewer-history");
  historyBtn.classList.add("active");

  bodyEl.innerHTML = "";

  var panel = document.createElement("div");
  panel.className = "file-history-panel";

  // Header
  var header = document.createElement("div");
  header.className = "file-history-header";

  var headerTitle = document.createElement("span");
  headerTitle.textContent = "History (" + currentHistoryEntries.length + ")";
  header.appendChild(headerTitle);

  panel.appendChild(header);

  // Compare bar
  var compareBar = document.createElement("div");
  compareBar.className = "file-history-compare-bar-slots";

  var compareLabel = document.createElement("span");
  compareLabel.className = "compare-bar-label";
  compareLabel.innerHTML = iconHtml("arrow-left-right") + " Compare";
  compareBar.appendChild(compareLabel);

  var slotsRow = document.createElement("div");
  slotsRow.className = "compare-slots-row";

  var slotA = document.createElement("div");
  slotA.className = "file-history-compare-slot";
  if (selectedEntries.length >= 1) {
    slotA.classList.add("filled");
    slotA.innerHTML = '<span class="compare-slot-num">A</span><span class="compare-slot-text"></span><button class="compare-slot-clear">\u00d7</button>';
    slotA.querySelector(".compare-slot-text").textContent = shortEntryLabel(selectedEntries[0]);
    slotA.querySelector(".compare-slot-clear").addEventListener("click", function () {
      selectedEntries.splice(0, 1);
      renderHistoryPanel();
    });
  } else {
    slotA.innerHTML = '<span class="compare-slot-num">A</span><span class="compare-slot-placeholder">Select entry below</span>';
  }

  var arrowSpan = document.createElement("span");
  arrowSpan.className = "compare-slot-arrow";
  arrowSpan.innerHTML = iconHtml("arrow-right");

  var slotB = document.createElement("div");
  slotB.className = "file-history-compare-slot";
  if (selectedEntries.length >= 2) {
    slotB.classList.add("filled");
    slotB.innerHTML = '<span class="compare-slot-num">B</span><span class="compare-slot-text"></span><button class="compare-slot-clear">\u00d7</button>';
    slotB.querySelector(".compare-slot-text").textContent = shortEntryLabel(selectedEntries[1]);
    slotB.querySelector(".compare-slot-clear").addEventListener("click", function () {
      selectedEntries.splice(1, 1);
      renderHistoryPanel();
    });
  } else {
    slotB.innerHTML = '<span class="compare-slot-num">B</span><span class="compare-slot-placeholder">Select entry below</span>';
  }

  slotsRow.appendChild(slotA);
  slotsRow.appendChild(arrowSpan);
  slotsRow.appendChild(slotB);

  if (selectedEntries.length === 2) {
    var compareBtn = document.createElement("button");
    compareBtn.className = "file-history-compare-btn";
    compareBtn.innerHTML = iconHtml("arrow-left-right") + " Compare";
    compareBtn.addEventListener("click", function () {
      compareMode = true;
      renderCompareView();
    });
    slotsRow.appendChild(compareBtn);
  }

  compareBar.appendChild(slotsRow);
  panel.appendChild(compareBar);

  var list = document.createElement("div");
  list.className = "file-history-list";

  for (var i = 0; i < currentHistoryEntries.length; i++) {
    var item = currentHistoryEntries[i];
    var entry = document.createElement("div");
    entry.className = "file-history-entry";
    if (item.source === "git") entry.classList.add("git-entry");

    var selNum = isEntrySelected(item);
    if (selNum) {
      entry.classList.add("selected");
      entry.dataset.selectNum = selNum;
    }

    // Header row
    var entryHeader = document.createElement("div");
    entryHeader.className = "file-history-entry-header";

    var titleSpan = document.createElement("span");
    titleSpan.className = "file-history-title";

    if (item.source === "git") {
      titleSpan.textContent = item.message || "No message";
    } else {
      // Use assistant's pre-edit reasoning as title (explains what Claude is doing)
      titleSpan.textContent = item.assistantSnippet || item.toolName + " " + (currentFilePath || "").split("/").pop();
    }
    entryHeader.appendChild(titleSpan);

    var badge = document.createElement("span");
    badge.className = "file-history-badge";
    if (item.source === "git") {
      badge.classList.add("badge-commit");
      badge.textContent = "Git Commit";
    } else {
      badge.textContent = item.toolName === "Write" ? "Claude Write" : "Claude Edit";
    }
    entryHeader.appendChild(badge);

    entry.appendChild(entryHeader);

    // Subtitle: code-based summary for Edit entries
    if (item.source === "session" && item.toolName === "Edit" && (item.old_string || item.new_string)) {
      var codeSummary = editCodeSummary(item.old_string || "", item.new_string || "");
      if (codeSummary) {
        var subtitleEl = document.createElement("div");
        subtitleEl.className = "file-history-code-subtitle";
        subtitleEl.textContent = codeSummary;
        entry.appendChild(subtitleEl);
      }
    }

    // Meta line
    if (item.source === "git") {
      var sub = document.createElement("div");
      sub.className = "file-history-meta";
      sub.textContent = item.hash.substring(0, 7) + " by " + (item.author || "unknown") + formatTimeAgo(item.timestamp);
      entry.appendChild(sub);
    } else {
      var sessionMeta = document.createElement("div");
      sessionMeta.className = "file-history-meta";
      var shortSession = (item.sessionTitle || "Untitled");
      if (shortSession.length > 20) shortSession = shortSession.substring(0, 20) + "...";
      sessionMeta.textContent = shortSession;
      entry.appendChild(sessionMeta);
    }

    // Diff preview for session edits (inline unified)
    if (item.source === "session") {
      var diffContainer = document.createElement("div");
      diffContainer.className = "file-history-diff diff-compact";

      if (item.toolName === "Edit" && (item.old_string || item.new_string)) {
        var unifiedEl = renderUnifiedDiff(item.old_string || "", item.new_string || "", currentLang());
        diffContainer.appendChild(unifiedEl);
      } else {
        var writeBadge = document.createElement("div");
        writeBadge.className = "file-history-write-badge";
        writeBadge.textContent = "Full file write";
        diffContainer.appendChild(writeBadge);
      }
      entry.appendChild(diffContainer);
    }

    // Action buttons row
    var actions = document.createElement("div");
    actions.className = "file-history-actions";

    // View diff / View file button (both git and session)
    (function (itemData) {
      var hasEditDiff = itemData.source === "session" && itemData.toolName === "Edit" && (itemData.old_string || itemData.new_string);
      var viewBtn = document.createElement("button");
      viewBtn.className = "file-history-action-btn";
      viewBtn.textContent = hasEditDiff ? "View diff" : "View file";
      viewBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        viewEntryFile(itemData);
      });
      actions.appendChild(viewBtn);

      // Navigate to conversation link (session only)
      if (itemData.source === "session" && itemData.assistantUuid && itemData.sessionLocalId) {
        var navBtn = document.createElement("button");
        navBtn.className = "file-history-action-btn file-history-nav-btn";
        navBtn.textContent = "Go to chat";
        navBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          navigateToEdit(itemData);
        });
        actions.appendChild(navBtn);
      }
    })(item);

    entry.appendChild(actions);

    // Click handler: always toggle selection
    (function (itemData, entryEl) {
      entryEl.addEventListener("click", function () {
        toggleSelect(itemData);
      });
    })(item, entry);

    list.appendChild(entry);
  }

  panel.appendChild(list);
  bodyEl.appendChild(panel);
  refreshIcons();
}

function renderCompareView() {
  var bodyEl = document.getElementById("file-viewer-body");
  bodyEl.innerHTML = "";
  ctx.fileViewerEl.classList.add("file-viewer-wide");

  var wrapper = document.createElement("div");
  wrapper.className = "file-history-compare-view";

  // Back button
  var backBar = document.createElement("div");
  backBar.className = "file-history-compare-bar";

  var backBtn = document.createElement("button");
  backBtn.className = "file-history-compare-back";
  backBtn.textContent = "Back to timeline";
  backBtn.addEventListener("click", function () {
    compareMode = false;
    ctx.fileViewerEl.classList.remove("file-viewer-wide");
    renderHistoryPanel();
  });
  backBar.appendChild(backBtn);
  wrapper.appendChild(backBar);

  var a = selectedEntries[0];
  var b = selectedEntries[1];

  // Loading state while fetching
  var loadingEl = document.createElement("div");
  loadingEl.className = "file-history-write-badge";
  loadingEl.textContent = "Loading...";
  wrapper.appendChild(loadingEl);
  bodyEl.appendChild(wrapper);

  // A = "before" state of entry A, B = "after" state of entry B
  resolveEntryContentBefore(a, function (contentA) {
    resolveEntryContent(b, function (contentB) {
      loadingEl.remove();
      renderCompareDiff(wrapper, a, contentA, b, contentB);
    });
  });
}

function resolveEntryContent(entry, cb) {
  if (entry.source === "git") {
    if (fileAtCache[entry.hash] !== undefined) {
      cb(fileAtCache[entry.hash]);
      return;
    }
    pendingFileAt = function () {
      cb(fileAtCache[entry.hash] || "");
    };
    requestFileAt(entry.hash);
    return;
  }
  // Session edit: reconstruct full file with the edit applied
  if (entry.toolName === "Edit" && entry.new_string != null && currentContent) {
    var pos = currentContent.indexOf(entry.new_string);
    if (pos >= 0 && entry.old_string != null) {
      // Return full file with new_string in place (current state contains it)
      cb(currentContent);
    } else {
      cb(currentContent || "");
    }
    return;
  }
  // Write or fallback: use current file content (best approximation)
  cb(currentContent || "");
}

// Reconstruct the full file as it was BEFORE this edit was applied
function resolveEntryContentBefore(entry, cb) {
  if (entry.source === "git") {
    // For git, get the parent commit's version
    resolveEntryContent(entry, cb);
    return;
  }
  if (entry.toolName === "Edit" && entry.new_string != null && entry.old_string != null && currentContent) {
    var pos = currentContent.indexOf(entry.new_string);
    if (pos >= 0) {
      cb(currentContent.substring(0, pos) + entry.old_string + currentContent.substring(pos + entry.new_string.length));
      return;
    }
  }
  cb(currentContent || "");
}

function renderCompareDiff(container, a, contentA, b, contentB) {
  var viewMode = "split";

  function render() {
    // Remove previous diff content (keep back bar)
    var old = container.querySelector(".file-history-compare-content");
    if (old) old.remove();

    var content = document.createElement("div");
    content.className = "file-history-compare-content";

    // Label bar with toggle
    var labelBar = document.createElement("div");
    labelBar.className = "file-history-view-bar";

    var labelText = document.createElement("span");
    labelText.className = "file-history-split-label";
    labelText.style.flex = "1";
    labelText.textContent = describeEntry(a) + "  vs  " + describeEntry(b);
    labelBar.appendChild(labelText);

    var toggleWrap = document.createElement("div");
    toggleWrap.className = "file-history-view-toggle";

    var splitBtn = document.createElement("button");
    splitBtn.className = "file-history-toggle-btn" + (viewMode === "split" ? " active" : "");
    splitBtn.textContent = "Split";
    splitBtn.addEventListener("click", function () {
      viewMode = "split";
      render();
    });

    var unifiedBtn = document.createElement("button");
    unifiedBtn.className = "file-history-toggle-btn" + (viewMode === "unified" ? " active" : "");
    unifiedBtn.textContent = "Unified";
    unifiedBtn.addEventListener("click", function () {
      viewMode = "unified";
      render();
    });

    var sourceBtn = document.createElement("button");
    sourceBtn.className = "file-history-toggle-btn" + (viewMode === "source" ? " active" : "");
    sourceBtn.textContent = "Source";
    sourceBtn.addEventListener("click", function () {
      viewMode = "source";
      render();
    });

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    toggleWrap.appendChild(sourceBtn);
    labelBar.appendChild(toggleWrap);
    content.appendChild(labelBar);

    var diffLang = currentLang();

    if (viewMode === "source") {
      ctx.fileViewerEl.classList.remove("file-viewer-wide");
      var sourceWrap = document.createElement("div");
      sourceWrap.className = "file-history-diff-full";
      var ext = currentFilePath ? currentFilePath.split(".").pop().toLowerCase() : "";
      var lang = mapExtToLanguage(ext);
      var pre = document.createElement("pre");
      pre.className = "file-viewer-code-content";
      var codeEl = document.createElement("code");
      if (lang) codeEl.className = "language-" + lang;
      codeEl.textContent = contentB;
      pre.appendChild(codeEl);
      sourceWrap.appendChild(pre);
      content.appendChild(sourceWrap);
      container.appendChild(content);
      if (typeof hljs !== "undefined" && lang) {
        hljs.highlightElement(codeEl);
      }
    } else {
      ctx.fileViewerEl.classList.add("file-viewer-wide");

      // Diff content
      var diffWrap = document.createElement("div");
      diffWrap.className = "file-history-diff-full";

      if (viewMode === "split") {
        diffWrap.appendChild(renderSplitDiff(contentA, contentB, diffLang));
      } else {
        diffWrap.appendChild(renderUnifiedDiff(contentA, contentB, diffLang));
      }

      content.appendChild(diffWrap);
      container.appendChild(content);

      // Scroll to first change
      requestAnimationFrame(function () {
        var firstChange = diffWrap.querySelector(".diff-row-change, .diff-row-add, .diff-row-remove");
        if (firstChange) {
          firstChange.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }

  render();
}

function editCodeSummary(oldStr, newStr) {
  // Find the first meaningful added or changed line to use as a subtitle
  var oldLines = oldStr ? oldStr.split("\n") : [];
  var newLines = newStr ? newStr.split("\n") : [];
  var oldSet = {};
  for (var i = 0; i < oldLines.length; i++) {
    var trimmed = oldLines[i].trim();
    if (trimmed) oldSet[trimmed] = true;
  }
  // Find first new line not in old
  for (var j = 0; j < newLines.length; j++) {
    var line = newLines[j].trim();
    if (line && !oldSet[line] && line.length > 2) {
      if (line.length > 80) line = line.substring(0, 80) + "...";
      return "+ " + line;
    }
  }
  // Fallback: find first removed line
  var newSet = {};
  for (var k = 0; k < newLines.length; k++) {
    var t = newLines[k].trim();
    if (t) newSet[t] = true;
  }
  for (var l = 0; l < oldLines.length; l++) {
    var oLine = oldLines[l].trim();
    if (oLine && !newSet[oLine] && oLine.length > 2) {
      if (oLine.length > 80) oLine = oLine.substring(0, 80) + "...";
      return "- " + oLine;
    }
  }
  return null;
}

function describeEntry(entry) {
  if (entry.source === "git") return entry.hash.substring(0, 7) + " " + (entry.message || "").substring(0, 40);
  return (entry.sessionTitle || "Untitled") + " (" + (entry.toolName || "Edit") + ")";
}

function shortEntryLabel(entry) {
  if (entry.source === "git") {
    var msg = (entry.message || "").substring(0, 24);
    if ((entry.message || "").length > 24) msg += "...";
    return entry.hash.substring(0, 7) + " " + msg;
  }
  return (entry.assistantSnippet || entry.toolName || "Edit").substring(0, 30);
}

function formatTimeAgo(ts) {
  if (!ts) return "";
  var diff = Date.now() - ts;
  if (diff < 60000) return ", just now";
  if (diff < 3600000) return ", " + Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return ", " + Math.floor(diff / 3600000) + "h ago";
  var d = new Date(ts);
  return ", " + d.toLocaleDateString();
}


function viewEntryFile(entry) {
  var viewerEl = ctx.fileViewerEl;
  var bodyEl = document.getElementById("file-viewer-body");
  bodyEl.innerHTML = '<div class="file-history-write-badge">Loading...</div>';

  // Widen the viewer for diff
  viewerEl.classList.add("file-viewer-wide");

  // For session edits with old/new, show diff. For git or Write, show file content.
  var hasEditDiff = entry.source === "session" && entry.toolName === "Edit" && (entry.old_string || entry.new_string);

  if (hasEditDiff) {
    renderViewFileDiff(entry);
  } else {
    resolveEntryContent(entry, function (content) {
      renderViewFileContent(entry, content);
    });
  }
}

function renderViewFileDiff(entry) {
  var bodyEl = document.getElementById("file-viewer-body");

  // Reconstruct full before/after files
  var oldStr = entry.old_string || "";
  var newStr = entry.new_string || "";
  var fileAfter = currentContent || "";
  var fileBefore = fileAfter;
  if (newStr) {
    var pos = fileAfter.indexOf(newStr);
    if (pos >= 0) {
      fileBefore = fileAfter.substring(0, pos) + oldStr + fileAfter.substring(pos + newStr.length);
    }
  }

  var diffLang = currentLang();
  var viewMode = "split";

  function render() {
    bodyEl.innerHTML = "";

    // Top bar: back + toggle
    var topBar = document.createElement("div");
    topBar.className = "file-history-view-bar";

    var backBtn = document.createElement("button");
    backBtn.className = "file-history-compare-back";
    backBtn.textContent = "Back to timeline";
    backBtn.addEventListener("click", function () {
      ctx.fileViewerEl.classList.remove("file-viewer-wide");
      renderHistoryPanel();
    });
    topBar.appendChild(backBtn);

    var toggleWrap = document.createElement("div");
    toggleWrap.className = "file-history-view-toggle";

    var splitBtn = document.createElement("button");
    splitBtn.className = "file-history-toggle-btn" + (viewMode === "split" ? " active" : "");
    splitBtn.textContent = "Split";
    splitBtn.addEventListener("click", function () {
      viewMode = "split";
      render();
    });

    var unifiedBtn = document.createElement("button");
    unifiedBtn.className = "file-history-toggle-btn" + (viewMode === "unified" ? " active" : "");
    unifiedBtn.textContent = "Unified";
    unifiedBtn.addEventListener("click", function () {
      viewMode = "unified";
      render();
    });

    var sourceBtn = document.createElement("button");
    sourceBtn.className = "file-history-toggle-btn" + (viewMode === "source" ? " active" : "");
    sourceBtn.textContent = "Source";
    sourceBtn.addEventListener("click", function () {
      viewMode = "source";
      render();
    });

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    toggleWrap.appendChild(sourceBtn);
    topBar.appendChild(toggleWrap);
    bodyEl.appendChild(topBar);

    // Label
    var label = document.createElement("div");
    label.className = "file-history-split-label";
    label.textContent = describeEntry(entry);
    bodyEl.appendChild(label);

    if (viewMode === "source") {
      ctx.fileViewerEl.classList.remove("file-viewer-wide");
      var sourceWrap = document.createElement("div");
      sourceWrap.className = "file-history-diff-full";
      var ext = currentFilePath ? currentFilePath.split(".").pop().toLowerCase() : "";
      var lang = mapExtToLanguage(ext);
      var pre = document.createElement("pre");
      pre.className = "file-viewer-code-content";
      var codeEl = document.createElement("code");
      if (lang) codeEl.className = "language-" + lang;
      codeEl.textContent = fileAfter;
      pre.appendChild(codeEl);
      sourceWrap.appendChild(pre);
      bodyEl.appendChild(sourceWrap);
      if (typeof hljs !== "undefined" && lang) {
        hljs.highlightElement(codeEl);
      }
    } else {
      ctx.fileViewerEl.classList.add("file-viewer-wide");

      var diffWrap = document.createElement("div");
      diffWrap.className = "file-history-diff-full";

      if (viewMode === "split") {
        diffWrap.appendChild(renderSplitDiff(fileBefore, fileAfter, diffLang));
      } else {
        diffWrap.appendChild(renderUnifiedDiff(fileBefore, fileAfter, diffLang));
      }

      bodyEl.appendChild(diffWrap);

      // Scroll to first change
      requestAnimationFrame(function () {
        var firstChange = diffWrap.querySelector(".diff-row-change, .diff-row-add, .diff-row-remove");
        if (firstChange) {
          firstChange.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }

  render();
}

function renderViewFileContent(entry, content) {
  var bodyEl = document.getElementById("file-viewer-body");
  bodyEl.innerHTML = "";

  // Back bar
  var topBar = document.createElement("div");
  topBar.className = "file-history-view-bar";
  var backBtn = document.createElement("button");
  backBtn.className = "file-history-compare-back";
  backBtn.textContent = "Back to timeline";
  backBtn.addEventListener("click", function () {
    ctx.fileViewerEl.classList.remove("file-viewer-wide");
    renderHistoryPanel();
  });
  topBar.appendChild(backBtn);
  bodyEl.appendChild(topBar);

  // Label
  var label = document.createElement("div");
  label.className = "file-history-split-label";
  label.textContent = describeEntry(entry);
  bodyEl.appendChild(label);

  // Code with line numbers
  var codeContainer = document.createElement("div");
  codeContainer.className = "file-history-split-code";
  codeContainer.style.flex = "1";
  codeContainer.style.overflow = "hidden";
  var ext = (currentFilePath || "").split(".").pop().toLowerCase();
  renderCodeWithLineNumbers(codeContainer, content, ext);
  bodyEl.appendChild(codeContainer);
}

function navigateToEdit(edit) {
  // If already in the same session, scroll directly without replaying history
  if (ctx.activeSessionId === edit.sessionLocalId) {
    scrollToToolElement(edit.toolId, edit.assistantUuid);
    if (window.innerWidth <= 768) closeFileViewer();
    return;
  }

  pendingNavigate = {
    sessionLocalId: edit.sessionLocalId,
    assistantUuid: edit.assistantUuid,
    toolId: edit.toolId,
  };

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "switch_session", id: edit.sessionLocalId }));
  }

  // Close file viewer on mobile
  if (window.innerWidth <= 768) {
    closeFileViewer();
  }
}

function scrollToToolElement(toolId, assistantUuid) {
  requestAnimationFrame(function () {
    var target = toolId ? ctx.messagesEl.querySelector('[data-tool-id="' + toolId + '"]') : null;
    if (!target && assistantUuid) {
      target = ctx.messagesEl.querySelector('[data-uuid="' + assistantUuid + '"]');
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("message-blink");
      setTimeout(function () { target.classList.remove("message-blink"); }, 2000);
    }
  });
}

export function getPendingNavigate() {
  var nav = pendingNavigate;
  pendingNavigate = null;
  return nav;
}
