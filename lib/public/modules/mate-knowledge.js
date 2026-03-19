import { iconHtml, refreshIcons } from './icons.js';
import { hideNotes } from './sticky-notes.js';

var getMateWs = null;
var containerEl = null;
var gridEl = null;
var closeBtn = null;
var sidebarBtn = null;
var countBadge = null;
var visible = false;
var cachedFiles = [];

// Editor elements
var editorEl = null;
var editorNameEl = null;
var editorContentEl = null;
var editorSaveBtn = null;
var editorDeleteBtn = null;
var editorCloseBtn = null;
var editorBackdrop = null;
var editingFile = null;

export function initMateKnowledge(mateWsGetter) {
  getMateWs = mateWsGetter;
  containerEl = document.getElementById("mate-knowledge-container");
  gridEl = document.getElementById("mate-knowledge-grid");
  closeBtn = document.getElementById("mate-knowledge-close-btn");
  sidebarBtn = document.getElementById("mate-knowledge-btn");
  countBadge = document.getElementById("mate-knowledge-count");

  editorEl = document.getElementById("mate-knowledge-editor");
  editorNameEl = document.getElementById("mate-knowledge-editor-name");
  editorContentEl = document.getElementById("mate-knowledge-editor-content");
  editorSaveBtn = document.getElementById("mate-knowledge-editor-save");
  editorDeleteBtn = document.getElementById("mate-knowledge-editor-delete");
  editorCloseBtn = document.getElementById("mate-knowledge-editor-close");
  editorBackdrop = editorEl ? editorEl.querySelector(".mate-knowledge-editor-backdrop") : null;

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (visible) {
        hideKnowledge();
      } else {
        showKnowledge();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", hideKnowledge);
  }

  if (editorSaveBtn) {
    editorSaveBtn.addEventListener("click", saveKnowledge);
  }

  if (editorDeleteBtn) {
    editorDeleteBtn.addEventListener("click", function () {
      if (editingFile) {
        var ws = getMateWs ? getMateWs() : null;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "knowledge_delete", name: editingFile }));
        }
        closeEditor();
      }
    });
  }

  if (editorCloseBtn) {
    editorCloseBtn.addEventListener("click", closeEditor);
  }

  if (editorBackdrop) {
    editorBackdrop.addEventListener("click", closeEditor);
  }

  // Stop keyboard events from leaking
  var stopProp = function (e) { e.stopPropagation(); };
  if (editorNameEl) {
    editorNameEl.addEventListener("keydown", stopProp);
    editorNameEl.addEventListener("keyup", stopProp);
    editorNameEl.addEventListener("keypress", stopProp);
  }
  if (editorContentEl) {
    editorContentEl.addEventListener("keydown", stopProp);
    editorContentEl.addEventListener("keyup", stopProp);
    editorContentEl.addEventListener("keypress", stopProp);
  }
}

export function showKnowledge() {
  visible = true;
  hideNotes();
  if (containerEl) containerEl.classList.remove("hidden");
  if (sidebarBtn) sidebarBtn.classList.add("active");
  requestKnowledgeList();
}

export function hideKnowledge() {
  visible = false;
  if (containerEl) containerEl.classList.add("hidden");
  if (sidebarBtn) sidebarBtn.classList.remove("active");
}

export function isKnowledgeVisible() {
  return visible;
}

export function requestKnowledgeList() {
  var ws = getMateWs ? getMateWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_list" }));
  }
}

export function renderKnowledgeList(files) {
  cachedFiles = files || [];

  // Update badges
  if (countBadge) {
    if (cachedFiles.length > 0) {
      countBadge.textContent = String(cachedFiles.length);
      countBadge.classList.remove("hidden");
    } else {
      countBadge.classList.add("hidden");
    }
  }
  var headerCount = document.getElementById("mate-knowledge-header-count");
  if (headerCount) {
    headerCount.textContent = cachedFiles.length > 0 ? cachedFiles.length + " files" : "";
  }

  if (!gridEl) return;
  gridEl.innerHTML = "";

  // Add tile (always first)
  var addTile = document.createElement("div");
  addTile.className = "mate-knowledge-tile mate-knowledge-tile-add";
  addTile.innerHTML = '<span class="mate-knowledge-add-icon">' + iconHtml("plus") + '</span><span class="mate-knowledge-add-label">Add Knowledge</span>';
  addTile.addEventListener("click", function () { openEditor(null); });
  gridEl.appendChild(addTile);

  for (var i = 0; i < cachedFiles.length; i++) {
    gridEl.appendChild(renderTile(cachedFiles[i]));
  }
  refreshIcons();
}

function renderTile(file) {
  var tile = document.createElement("div");
  tile.className = "mate-knowledge-tile";

  var title = document.createElement("div");
  title.className = "mate-knowledge-tile-title";
  title.textContent = file.name.replace(/\.md$/, "");
  tile.appendChild(title);

  var preview = document.createElement("div");
  preview.className = "mate-knowledge-tile-preview";
  // Preview will be populated if we have content cached; for now show size
  var sizeKb = file.size > 1024 ? (file.size / 1024).toFixed(1) + " KB" : file.size + " bytes";
  preview.textContent = sizeKb;
  tile.appendChild(preview);

  tile.addEventListener("click", (function (name) {
    return function () {
      var ws = getMateWs ? getMateWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "knowledge_read", name: name }));
      }
    };
  })(file.name));

  return tile;
}

export function handleKnowledgeContent(msg) {
  openEditor(msg.name, msg.content || "");
}

function openEditor(fileName, content) {
  if (!editorEl) return;
  editingFile = fileName || null;
  if (editorNameEl) {
    editorNameEl.value = fileName ? fileName.replace(/\.md$/, "") : "";
    editorNameEl.readOnly = !!fileName;
  }
  if (editorContentEl) {
    editorContentEl.value = content || "";
  }
  if (editorDeleteBtn) {
    editorDeleteBtn.style.display = fileName ? "" : "none";
  }
  editorEl.classList.remove("hidden");
  if (!fileName && editorNameEl) {
    editorNameEl.focus();
  } else if (editorContentEl) {
    editorContentEl.focus();
  }
}

function closeEditor() {
  if (editorEl) editorEl.classList.add("hidden");
  editingFile = null;
}

function saveKnowledge() {
  if (!editorNameEl || !editorContentEl) return;
  var name = editorNameEl.value.trim();
  var content = editorContentEl.value;
  if (!name) {
    editorNameEl.style.outline = "2px solid var(--error, #ff5555)";
    setTimeout(function () { editorNameEl.style.outline = ""; }, 1500);
    return;
  }
  if (!name.endsWith(".md")) name += ".md";
  var ws = getMateWs ? getMateWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_save", name: name, content: content }));
  }
  closeEditor();
}
