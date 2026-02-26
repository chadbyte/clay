import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { closeSidebar } from './sidebar.js';
import { renderUnifiedDiff, renderSplitDiff } from './diff.js';
import { initFileIcons, getFileIconSvg, getFolderIconSvg } from './fileicons.js';

var ctx;
var treeData = {};  // path -> { loaded, children }
var currentContent = null;  // last read file content for copy
var currentFilePath = null;  // path of the currently viewed file
var isRendered = false;      // markdown render toggle state
var currentIsMarkdown = false;
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

export function initFileBrowser(_ctx) {
  ctx = _ctx;

  // Load material file icons in background
  initFileIcons().then(function () {
    // Re-render tree if already loaded, so file icons appear
    if (treeData["."] && treeData["."].loaded) {
      renderTree();
    }
  });

  // Close button
  document.getElementById("file-viewer-close").addEventListener("click", function () {
    closeFileViewer();
  });

  // Copy button
  document.getElementById("file-viewer-copy").addEventListener("click", function () {
    if (currentContent) copyToClipboard(currentContent);
  });

  // Markdown render toggle
  document.getElementById("file-viewer-render").addEventListener("click", function () {
    if (!currentContent || !currentIsMarkdown) return;
    isRendered = !isRendered;
    renderBody();
  });

  // History button
  document.getElementById("file-viewer-history").addEventListener("click", function () {
    if (currentHistoryEntries.length === 0) return;
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
    if (e.key === "Escape" && !ctx.fileViewerEl.classList.contains("hidden")) {
      closeFileViewer();
    }
  });
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

export function closeFileViewer() {
  sendUnwatch();
  inlineDiffActive = false;
  ctx.fileViewerEl.classList.remove("file-viewer-wide");
  ctx.fileViewerEl.classList.add("hidden");
}

var pendingOpenMode = null; // { type: "diff", oldStr, newStr } or null

export function openFile(filePath, opts) {
  if (!filePath) return;
  if (opts && opts.diff) {
    pendingOpenMode = { type: "diff", oldStr: opts.diff.oldStr, newStr: opts.diff.newStr };
  } else {
    pendingOpenMode = null;
  }
  requestFileContent(filePath);
}

function renderBody() {
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");

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
    highlightCodeBlocks(bodyEl);
    renderMermaidBlocks(bodyEl);
    renderBtn.classList.add("active");
    renderBtn.title = "Show raw";
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

export function handleFsList(msg) {
  var dirPath = msg.path || ".";
  treeData[dirPath] = { loaded: true, children: msg.entries || [] };

  if (msg.error) {
    var errEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
    if (errEl) {
      errEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
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
    row.style.paddingLeft = (8 + depth * 16) + "px";

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
          // Mark active
          var prev = ctx.fileTreeEl.querySelector(".file-tree-item.active");
          if (prev) prev.classList.remove("active");
          rowEl.classList.add("active");
          requestFileContent(filePath);
          // Mobile: close sidebar
          if (window.innerWidth <= 768) {
            closeSidebar();
          }
        });
      })(entry.path, row);

      container.appendChild(row);
    }
  }
}


// --- File viewer ---

function showFileContent(msg) {
  var pathEl = document.getElementById("file-viewer-path");
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");

  pathEl.textContent = msg.path;
  var keepRenderState = pendingRefresh && msg.path === currentFilePath;
  var prevRendered = isRendered;
  pendingRefresh = false;
  currentContent = null;
  currentFilePath = msg.path;
  currentIsMarkdown = false;
  if (!keepRenderState) isRendered = false;
  renderBtn.classList.add("hidden");
  renderBtn.classList.remove("active");

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
    var ext = msg.path.split(".").pop().toLowerCase();
    currentIsMarkdown = (ext === "md" || ext === "mdx");

    if (currentIsMarkdown) {
      renderBtn.classList.remove("hidden");
      renderBtn.title = "Render markdown";
    }

    // Show raw by default, use renderBody for markdown toggle
    if (currentIsMarkdown) {
      renderBody();
    } else {
      renderCodeWithLineNumbers(bodyEl, msg.content, ext);
    }
  }

  ctx.fileViewerEl.classList.remove("hidden");
  sendWatch(msg.path);
  refreshIcons();

  // If opened with a diff request, show full-file split diff in wide mode
  if (pendingOpenMode && pendingOpenMode.type === "diff" && currentContent != null) {
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
    showInlineDiff(diffOpts.oldStr, diffOpts.newStr);
    return;
  }
  pendingOpenMode = null;

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

function showInlineDiff(oldStr, newStr) {
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

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    topBar.appendChild(toggleWrap);
    bodyEl.appendChild(topBar);

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

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    labelBar.appendChild(toggleWrap);
    content.appendChild(labelBar);

    // Diff content
    var diffWrap = document.createElement("div");
    diffWrap.className = "file-history-diff-full";

    var diffLang = currentLang();
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

    toggleWrap.appendChild(splitBtn);
    toggleWrap.appendChild(unifiedBtn);
    topBar.appendChild(toggleWrap);
    bodyEl.appendChild(topBar);

    // Label
    var label = document.createElement("div");
    label.className = "file-history-split-label";
    label.textContent = describeEntry(entry);
    bodyEl.appendChild(label);

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
