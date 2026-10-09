import { iconHtml, refreshIcons } from './icons.js';
import { hideNotes } from './sticky-notes.js';
import { hideMemory } from './mate-memory.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';

var getWs = null;
var filesEl = null;
var sidebarBtn = null;
var countBadge = null;
var visible = false;
var cachedFiles = [];

// Sidebar panels
var conversationsPanel = null;
var knowledgePanel = null;
var knowledgeBackBtn = null;
var knowledgeAddSidebarBtn = null;

// Viewer elements
var viewerEl = null;
var viewerNameEl = null;
var viewerContentEl = null;
var viewerEditBtn = null;
var viewerCloseBtn = null;

// Editor elements
var editorEl = null;
var activeNameEl = null;
var editorNameEl = null;
var editorContentEl = null;
var editorSaveBtn = null;
var editorDeleteBtn = null;
var editorPreviewEl = null;
var editorHighlightEl = null;
var editorHighlightPre = null;
var previewTimer = null;
var editorExtEl = null;
var nameGroupEl = null;

// State
var editingFile = null;
var editingCommon = false;
var editingOwnMateId = null;
var editingRevision = null;
var viewingContent = "";
var dirty = false;
var mode = "none"; // "none" | "viewer" | "editor"
var pendingEditMode = false;

export function initMateKnowledge(wsGetter) {
  getWs = wsGetter;
  filesEl = document.getElementById("mate-knowledge-files");
  sidebarBtn = document.getElementById("mate-knowledge-btn");
  countBadge = document.getElementById("mate-knowledge-count");

  // Sidebar panels
  conversationsPanel = document.getElementById("mate-sidebar-conversations");
  knowledgePanel = document.getElementById("mate-sidebar-knowledge");
  knowledgeBackBtn = document.getElementById("mate-knowledge-back-btn");
  knowledgeAddSidebarBtn = document.getElementById("mate-knowledge-add-sidebar-btn");

  // Viewer
  viewerEl = document.getElementById("mate-knowledge-viewer");
  viewerNameEl = document.getElementById("mate-knowledge-viewer-name");
  viewerContentEl = document.getElementById("mate-knowledge-viewer-content");
  viewerEditBtn = document.getElementById("mate-knowledge-viewer-edit-btn");
  viewerCloseBtn = document.getElementById("mate-knowledge-viewer-close-btn");

  // Editor
  editorEl = document.getElementById("mate-knowledge-editor");
  activeNameEl = document.getElementById("mate-knowledge-active-name");
  editorNameEl = document.getElementById("mate-knowledge-editor-name");
  editorContentEl = document.getElementById("mate-knowledge-editor-content");
  editorSaveBtn = document.getElementById("mate-knowledge-editor-save");
  editorDeleteBtn = document.getElementById("mate-knowledge-editor-delete");
  editorPreviewEl = document.getElementById("mate-knowledge-editor-preview");
  editorHighlightEl = document.getElementById("mate-knowledge-editor-highlight");
  editorHighlightPre = editorHighlightEl ? editorHighlightEl.parentElement : null;
  editorExtEl = document.getElementById("mate-knowledge-editor-ext");
  nameGroupEl = document.getElementById("mate-knowledge-name-group");

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (visible) { hideKnowledge(); } else { showKnowledge(); }
    });
  }

  if (knowledgeBackBtn) {
    knowledgeBackBtn.addEventListener("click", hideKnowledge);
  }

  // Viewer buttons
  if (viewerEditBtn) {
    viewerEditBtn.addEventListener("click", function () {
      switchToEditor();
    });
  }
  if (viewerCloseBtn) {
    viewerCloseBtn.addEventListener("click", function () {
      closePanel();
    });
  }

  // Editor close
  var closeBtn = document.getElementById("mate-knowledge-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closePanel();
    });
  }

  if (knowledgeAddSidebarBtn) {
    knowledgeAddSidebarBtn.addEventListener("click", function () {
      // New file goes straight to editor
      editingFile = null;
      editingCommon = false;
      editingRevision = null;
      viewingContent = "";
      openEditor(null, "");
    });
  }

  if (editorSaveBtn) editorSaveBtn.addEventListener("click", saveKnowledge);

  if (editorDeleteBtn) {
    editorDeleteBtn.addEventListener("click", function () {
      if (editingFile) {
        var ws = getWs ? getWs() : null;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "knowledge_delete", name: editingFile, expectedRevision: editingRevision }));
        }
        closePanel();
      }
    });
  }

  // Stop keyboard events from leaking
  var stopProp = function (e) {
    e.stopPropagation();
  };
  var editorKeydown = function (e) {
    e.stopPropagation();
    // Keep Cmd+Z / Cmd+Shift+Z inside the textarea only
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.stopImmediatePropagation();
    }
  };
  if (editorNameEl) {
    editorNameEl.addEventListener("keydown", stopProp);
    editorNameEl.addEventListener("keyup", stopProp);
    editorNameEl.addEventListener("keypress", stopProp);
  }
  if (editorContentEl) {
    editorContentEl.addEventListener("keydown", editorKeydown);
    editorContentEl.addEventListener("keyup", stopProp);
    editorContentEl.addEventListener("keypress", stopProp);
    editorContentEl.addEventListener("input", function () {
      dirty = true;
      if (editorSaveBtn) editorSaveBtn.disabled = false;
      updateHighlight();
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 150);
    });
    editorContentEl.addEventListener("scroll", syncHighlightScroll);
    initFormatPopover(editorContentEl);
  }

  // --- Mobile tab switching (Edit / Preview) ---
  var tabBar = document.querySelector(".mate-knowledge-tab-bar");
  if (tabBar) {
    var tabBtns = tabBar.querySelectorAll(".mate-knowledge-tab-btn");
    var editorPane = document.querySelector(".mate-knowledge-editor-pane");
    var previewPane = document.querySelector(".mate-knowledge-preview-pane");
    for (var ti = 0; ti < tabBtns.length; ti++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          for (var j = 0; j < tabBtns.length; j++) {
            tabBtns[j].classList.remove("active");
          }
          btn.classList.add("active");
          var tab = btn.dataset.tab;
          if (editorPane && previewPane) {
            if (tab === "edit") {
              editorPane.classList.add("mobile-active");
              previewPane.classList.remove("mobile-active");
            } else {
              editorPane.classList.remove("mobile-active");
              previewPane.classList.add("mobile-active");
              // Ensure preview is up to date
              if (typeof updatePreview === "function") updatePreview();
            }
          }
        });
      })(tabBtns[ti]);
    }
  }
}

// --- Mode switching ---

function closePanel() {
  if (viewerEl) viewerEl.classList.add("hidden");
  if (editorEl) editorEl.classList.add("hidden");
  editingFile = null;
  editingRevision = null;
  mode = "none";
  renderFileList();
}

function showViewer(fileName, content) {
  mode = "viewer";
  if (viewerEl) viewerEl.classList.remove("hidden");
  if (editorEl) editorEl.classList.add("hidden");

  if (viewerNameEl) viewerNameEl.textContent = fileName.replace(/\.(md|jsonl)$/, "");

  // Hide edit button for common files from other mates
  if (viewerEditBtn) {
    viewerEditBtn.style.display = editingCommon ? "none" : "";
  }

  if (viewerContentEl) {
    if (fileName.endsWith(".jsonl")) {
      viewerContentEl.innerHTML = buildJsonlTable(content);
    } else {
      viewerContentEl.innerHTML = renderMarkdown(content || "");
      highlightCodeBlocks(viewerContentEl);
    }
  }

  renderFileList();
}

function switchToEditor() {
  if (!editingFile || editingCommon) return;
  openEditor(editingFile, viewingContent);
}

function openEditor(fileName, content) {
  mode = "editor";
  dirty = false;
  if (viewerEl) viewerEl.classList.add("hidden");
  if (editorEl) editorEl.classList.remove("hidden");

  // Restore editor pane (may have been hidden by JSONL viewer)
  if (editorContentEl) editorContentEl.style.display = "";
  if (editorHighlightPre) editorHighlightPre.style.display = "";
  if (editorSaveBtn) editorSaveBtn.style.display = "";

  // Update active name / name input group
  if (fileName) {
    if (activeNameEl) { activeNameEl.textContent = fileName.replace(/\.md$/, ""); activeNameEl.classList.remove("hidden"); }
    if (nameGroupEl) nameGroupEl.classList.add("hidden");
  } else {
    if (activeNameEl) activeNameEl.classList.add("hidden");
    if (nameGroupEl) nameGroupEl.classList.remove("hidden");
    if (editorNameEl) editorNameEl.value = "";
  }

  if (editorContentEl) {
    editorContentEl.value = content || "";
    editorContentEl.placeholder = fileName ? "" : "Start writing...";
    editorContentEl.readOnly = false;
  }
  if (editorDeleteBtn) {
    editorDeleteBtn.style.display = fileName ? "" : "none";
  }
  if (editorSaveBtn) {
    editorSaveBtn.disabled = true;
  }

  updateHighlight();
  updatePreview();
  renderFileList();

  if (!fileName && editorNameEl) {
    editorNameEl.focus();
  } else if (editorContentEl) {
    editorContentEl.focus();
  }
}

// --- Public API ---

export function showKnowledge() {
  visible = true;
  hideNotes();
  hideMemory();

  // Toggle sidebar panels: hide conversations, show knowledge file list
  if (conversationsPanel) conversationsPanel.classList.add("hidden");
  if (knowledgePanel) knowledgePanel.classList.remove("hidden");
  if (sidebarBtn) sidebarBtn.classList.add("active");

  // Don't show editor yet, only when a file is selected
  requestKnowledgeList();
}

export function hideKnowledge() {
  visible = false;

  // Toggle sidebar panels: show conversations, hide knowledge file list
  if (conversationsPanel) conversationsPanel.classList.remove("hidden");
  if (knowledgePanel) knowledgePanel.classList.add("hidden");
  if (sidebarBtn) sidebarBtn.classList.remove("active");

  // Hide everything and reset state
  closePanel();
  cachedFiles = [];

  // Reset badge
  if (countBadge) {
    countBadge.textContent = "";
    countBadge.classList.add("hidden");
  }
}

export function isKnowledgeVisible() {
  return visible;
}

export function requestKnowledgeList() {
  var ws = getWs ? getWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_list" }));
  }
}

export function renderKnowledgeList(files) {
  cachedFiles = files || [];

  // Update badge
  if (countBadge) {
    if (cachedFiles.length > 0) {
      countBadge.textContent = String(cachedFiles.length);
      countBadge.classList.remove("hidden");
    } else {
      countBadge.classList.add("hidden");
    }
  }

  renderFileList();
}

export function handleKnowledgeContent(msg) {
  editingCommon = !!msg.common;
  editingOwnMateId = msg.ownMateId || null;
  editingRevision = msg.revision || null;
  editingFile = msg.name || null;
  viewingContent = msg.content || "";

  // If triggered from three-dots Edit, go straight to editor
  if (pendingEditMode && !editingCommon) {
    pendingEditMode = false;
    openEditor(msg.name, viewingContent);
    return;
  }
  pendingEditMode = false;

  // Otherwise open in viewer mode first
  showViewer(msg.name, viewingContent);
}

export function handleKnowledgeMutation(msg) {
  if (msg.type === "knowledge_saved" && msg.name === editingFile) editingRevision = msg.revision || editingRevision;
}

// --- File list rendering ---

function renderFileList() {
  if (!filesEl) return;
  filesEl.innerHTML = "";

  var commonFiles = [];
  var myFiles = [];
  for (var i = 0; i < cachedFiles.length; i++) {
    if (cachedFiles[i].common) commonFiles.push(cachedFiles[i]);
    else myFiles.push(cachedFiles[i]);
  }

  if (cachedFiles.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mate-knowledge-empty";
    empty.textContent = "No knowledge files yet";
    filesEl.appendChild(empty);
  }

  if (commonFiles.length > 0) {
    var header = document.createElement("div");
    header.className = "mate-knowledge-section-header";
    header.textContent = "Common Knowledge";
    filesEl.appendChild(header);
    for (var c = 0; c < commonFiles.length; c++) {
      filesEl.appendChild(renderFileItem(commonFiles[c]));
    }
  }

  if (myFiles.length > 0) {
    if (commonFiles.length > 0) {
      var myHeader = document.createElement("div");
      myHeader.className = "mate-knowledge-section-header";
      myHeader.textContent = "My Knowledge";
      filesEl.appendChild(myHeader);
    }
    for (var m = 0; m < myFiles.length; m++) {
      filesEl.appendChild(renderFileItem(myFiles[m]));
    }
  }

  refreshIcons();
}

function renderFileItem(file) {
  var item = document.createElement("div");
  item.className = "mate-knowledge-file-item";
  if (editingFile === file.name && editingCommon === !!file.common) item.classList.add("active");

  var icon = document.createElement("span");
  icon.className = "mate-knowledge-file-icon";
  icon.innerHTML = iconHtml(file.name.endsWith(".jsonl") ? "database" : "file-text");
  item.appendChild(icon);

  var name = document.createElement("span");
  name.className = "mate-knowledge-file-name";
  var isJsonl = file.name.endsWith(".jsonl");
  var displayName = file.name.replace(/\.(md|jsonl)$/, "");
  if (file.common && file.ownerName) {
    displayName += " (" + file.ownerName + ")";
  }
  name.textContent = displayName;
  item.appendChild(name);

  if (isJsonl) {
    var badge = document.createElement("span");
    badge.className = "mate-knowledge-file-badge";
    badge.textContent = "data";
    item.appendChild(badge);
  }

  if (file.common) {
    var commonBadge = document.createElement("span");
    commonBadge.className = "mate-knowledge-file-badge common";
    commonBadge.textContent = "common";
    item.appendChild(commonBadge);
  } else if (file.promoted) {
    var promotedBadge = document.createElement("span");
    promotedBadge.className = "mate-knowledge-file-badge promoted";
    promotedBadge.textContent = "common";
    item.appendChild(promotedBadge);
  }

  // Three-dots menu (only for own files, not common files from other mates)
  if (!file.common) {
    var dotsBtn = document.createElement("button");
    dotsBtn.className = "mate-knowledge-dots-btn";
    dotsBtn.innerHTML = iconHtml("ellipsis");
    dotsBtn.addEventListener("click", (function (f, btn) {
      return function (e) {
        e.stopPropagation();
        showFileMenu(f, btn);
      };
    })(file, dotsBtn));
    item.appendChild(dotsBtn);
  }

  item.addEventListener("click", (function (f) {
    return function () {
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        var msg = { type: "knowledge_read", name: f.name };
        if (f.common) {
          msg.common = true;
          msg.ownMateId = f.ownMateId;
        }
        ws.send(JSON.stringify(msg));
      }
    };
  })(file));

  return item;
}

// --- JSONL table builder ---

function buildJsonlTable(content) {
  var lines = content.trim().split("\n").filter(function (l) { return l.trim(); });
  if (lines.length === 0) {
    return "<p style=\"opacity:0.5\">No data entries yet</p>";
  }
  var rows = [];
  var allKeys = [];
  var keySet = {};
  for (var i = 0; i < lines.length; i++) {
    try {
      var obj = JSON.parse(lines[i]);
      rows.push(obj);
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        if (!keySet[keys[k]]) { keySet[keys[k]] = true; allKeys.push(keys[k]); }
      }
    } catch (e) { /* skip malformed lines */ }
  }
  var html = "<table class=\"mate-knowledge-jsonl-table\"><thead><tr>";
  for (var c = 0; c < allKeys.length; c++) {
    html += "<th>" + escapeHtml(allKeys[c]) + "</th>";
  }
  html += "</tr></thead><tbody>";
  for (var r = 0; r < rows.length; r++) {
    html += "<tr>";
    for (var c2 = 0; c2 < allKeys.length; c2++) {
      var val = rows[r][allKeys[c2]];
      var cell = val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
      html += "<td>" + escapeHtml(cell) + "</td>";
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Editor helpers ---

function updateHighlight() {
  if (!editorHighlightEl || !editorContentEl) return;
  var text = editorContentEl.value + "\n";
  // Reset completely: hljs skips elements it already processed
  editorHighlightEl.className = "language-markdown";
  editorHighlightEl.removeAttribute("data-highlighted");
  editorHighlightEl.textContent = text;
  if (window.hljs) {
    window.hljs.highlightElement(editorHighlightEl);
  }
}

function syncHighlightScroll() {
  if (!editorHighlightPre || !editorContentEl) return;
  editorHighlightPre.scrollTop = editorContentEl.scrollTop;
  editorHighlightPre.scrollLeft = editorContentEl.scrollLeft;
}

function updatePreview() {
  if (!editorPreviewEl || !editorContentEl) return;
  var text = editorContentEl.value;
  if (!text.trim()) {
    editorPreviewEl.innerHTML = "";
    return;
  }
  editorPreviewEl.innerHTML = renderMarkdown(text);
  highlightCodeBlocks(editorPreviewEl);
}

function saveKnowledge() {
  if (!editorNameEl || !editorContentEl) return;
  var name = (editingFile || editorNameEl.value.trim().replace(/\.md$/i, "") + ".md");
  var content = editorContentEl.value;
  if (!name || name === ".md") {
    editorNameEl.style.outline = "2px solid var(--error, #ff5555)";
    setTimeout(function () { editorNameEl.style.outline = ""; }, 1500);
    return;
  }
  var ws = getWs ? getWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_save", name: name, content: content, expectedRevision: editingRevision }));
  }
  editingFile = name;
  viewingContent = content;
  dirty = false;
  if (editorSaveBtn) editorSaveBtn.disabled = true;
  if (activeNameEl) { activeNameEl.textContent = name.replace(/\.md$/, ""); activeNameEl.classList.remove("hidden"); }
  if (nameGroupEl) nameGroupEl.classList.add("hidden");
  if (editorDeleteBtn) editorDeleteBtn.style.display = "";
}

// --- Format Popover ---

var formatPopover = null;
var popoverHideTimer = null;

var FORMAT_ACTIONS = [
  { icon: "bold", label: "Bold", wrap: ["**", "**"] },
  { icon: "italic", label: "Italic", wrap: ["*", "*"] },
  { icon: "strikethrough", label: "Strikethrough", wrap: ["~~", "~~"] },
  { icon: "code", label: "Code", wrap: ["`", "`"] },
  { icon: "link", label: "Link", wrap: ["[", "](url)"] },
  { icon: "heading-1", label: "Heading", prefix: "# " },
  { icon: "list", label: "List", prefix: "- " },
  { icon: "quote", label: "Quote", prefix: "> " },
];

function initFormatPopover(textarea) {
  // Create popover element
  formatPopover = document.createElement("div");
  formatPopover.className = "mate-format-popover";
  formatPopover.style.display = "none";

  for (var i = 0; i < FORMAT_ACTIONS.length; i++) {
    var action = FORMAT_ACTIONS[i];
    var btn = document.createElement("button");
    btn.className = "mate-format-btn";
    btn.title = action.label;
    btn.innerHTML = iconHtml(action.icon);
    btn.dataset.index = String(i);
    btn.addEventListener("mousedown", function (e) {
      e.preventDefault(); // prevent textarea blur
      var idx = parseInt(this.dataset.index);
      applyFormat(textarea, FORMAT_ACTIONS[idx]);
    });
    formatPopover.appendChild(btn);
  }

  document.body.appendChild(formatPopover);
  refreshIcons(formatPopover);

  textarea.addEventListener("mouseup", function () {
    setTimeout(function () { checkSelection(textarea); }, 10);
  });
  textarea.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") {
      checkSelection(textarea);
    }
  });

  textarea.addEventListener("blur", function () {
    popoverHideTimer = setTimeout(hidePopover, 150);
  });
  textarea.addEventListener("focus", function () {
    if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
  });

  document.addEventListener("scroll", hidePopover, true);
}

function checkSelection(textarea) {
  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  if (start === end || !formatPopover) {
    hidePopover();
    return;
  }
  showPopover(textarea);
}

function showPopover(textarea) {
  if (!formatPopover) return;

  // Position above the textarea selection
  // We approximate position using a mirror div technique
  var rect = textarea.getBoundingClientRect();
  var lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
  var paddingTop = parseInt(getComputedStyle(textarea).paddingTop) || 0;
  var paddingLeft = parseInt(getComputedStyle(textarea).paddingLeft) || 0;
  var fontSize = parseInt(getComputedStyle(textarea).fontSize) || 13;

  // Get text before selection to calculate approximate position
  var text = textarea.value;
  var start = textarea.selectionStart;
  var textBefore = text.substring(0, start);
  var lines = textBefore.split("\n");
  var currentLine = lines.length - 1;
  var charInLine = lines[lines.length - 1].length;

  // Approximate character width (monospace)
  var charWidth = fontSize * 0.6;

  var scrollTop = textarea.scrollTop;
  var x = rect.left + paddingLeft + (charWidth * Math.min(charInLine, 40));
  var y = rect.top + paddingTop + (currentLine * lineHeight) - scrollTop - 8;

  // Clamp to viewport
  var popoverWidth = 280;
  if (x + popoverWidth / 2 > window.innerWidth) x = window.innerWidth - popoverWidth / 2 - 8;
  if (x - popoverWidth / 2 < 8) x = popoverWidth / 2 + 8;
  if (y < 40) y = rect.top + paddingTop + ((currentLine + 1) * lineHeight) - scrollTop + 28;

  formatPopover.style.display = "flex";
  formatPopover.style.left = x + "px";
  formatPopover.style.top = y + "px";
}

function hidePopover() {
  if (formatPopover) formatPopover.style.display = "none";
}

function applyFormat(textarea, action) {
  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  var selected = textarea.value.substring(start, end);

  var replacement;

  if (action.wrap) {
    replacement = action.wrap[0] + selected + action.wrap[1];
  } else if (action.prefix) {
    var lines = selected.split("\n");
    replacement = lines.map(function (line) { return action.prefix + line; }).join("\n");
  }

  // Use execCommand to preserve native undo/redo stack
  textarea.focus();
  textarea.setSelectionRange(start, end);
  document.execCommand("insertText", false, replacement);

  hidePopover();
}

// --- File context menu (three-dots popover) ---

var fileMenuEl = null;
var fileMenuHideTimer = null;

function showFileMenu(file, anchorBtn) {
  hideFileMenu();

  fileMenuEl = document.createElement("div");
  fileMenuEl.className = "mate-knowledge-file-menu";

  // Edit
  var editItem = document.createElement("button");
  editItem.className = "mate-knowledge-file-menu-item";
  editItem.innerHTML = iconHtml("pencil") + "<span>Edit</span>";
  editItem.addEventListener("click", function (e) {
    e.stopPropagation();
    hideFileMenu();
    // Request file content, then open editor directly
    editingCommon = false;
    editingFile = file.name;
    var ws = getWs ? getWs() : null;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "knowledge_read", name: file.name }));
      // Override handleKnowledgeContent to go straight to editor
      pendingEditMode = true;
    }
  });
  fileMenuEl.appendChild(editItem);

  // Promote / Depromote
  if (!file.promoted) {
    var promoteItem = document.createElement("button");
    promoteItem.className = "mate-knowledge-file-menu-item";
    promoteItem.innerHTML = iconHtml("share-2") + "<span>Share to all mates</span>";
    promoteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "knowledge_promote", name: file.name }));
      }
      hideFileMenu();
    });
    fileMenuEl.appendChild(promoteItem);
  } else {
    var depromoteItem = document.createElement("button");
    depromoteItem.className = "mate-knowledge-file-menu-item";
    depromoteItem.innerHTML = iconHtml("x-circle") + "<span>Unshare</span>";
    depromoteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "knowledge_depromote", name: file.name }));
      }
      hideFileMenu();
    });
    fileMenuEl.appendChild(depromoteItem);
  }

  // Delete (disabled if promoted, must unshare first)
  var deleteItem = document.createElement("button");
  deleteItem.className = "mate-knowledge-file-menu-item menu-item-danger";
  if (file.promoted) {
    deleteItem.innerHTML = iconHtml("trash-2") + "<span>Unshare before deleting</span>";
    deleteItem.disabled = true;
    deleteItem.style.opacity = "0.4";
    deleteItem.style.cursor = "default";
  } else {
    deleteItem.innerHTML = iconHtml("trash-2") + "<span>Delete</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "knowledge_delete", name: file.name, expectedRevision: file.revision || null }));
      }
      hideFileMenu();
      if (editingFile === file.name) closePanel();
    });
  }
  fileMenuEl.appendChild(deleteItem);

  // Position below the anchor button
  document.body.appendChild(fileMenuEl);
  refreshIcons(fileMenuEl);

  var btnRect = anchorBtn.getBoundingClientRect();
  var menuWidth = fileMenuEl.offsetWidth || 160;
  var left = btnRect.right - menuWidth;
  var top = btnRect.bottom + 4;

  // Keep within viewport
  if (left < 8) left = 8;
  if (top + fileMenuEl.offsetHeight > window.innerHeight - 8) {
    top = btnRect.top - fileMenuEl.offsetHeight - 4;
  }

  fileMenuEl.style.left = left + "px";
  fileMenuEl.style.top = top + "px";

  // Close on outside click (delayed to avoid immediate close)
  setTimeout(function () {
    document.addEventListener("click", onFileMenuOutsideClick, true);
  }, 0);
}

function hideFileMenu() {
  if (fileMenuEl) {
    fileMenuEl.remove();
    fileMenuEl = null;
  }
  document.removeEventListener("click", onFileMenuOutsideClick, true);
  if (fileMenuHideTimer) {
    clearTimeout(fileMenuHideTimer);
    fileMenuHideTimer = null;
  }
}

function onFileMenuOutsideClick(e) {
  if (fileMenuEl && !fileMenuEl.contains(e.target)) {
    hideFileMenu();
  }
}
