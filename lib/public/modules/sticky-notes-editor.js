// Sticky-note text editing: the WYSIWYG format toolbar and the contenteditable
// surface behind it.
//
// Split out of sticky-notes.js to keep every module under the size limit. It
// owns the toolbar element and nothing else, and depends only on the leaf
// helpers, so it never has to reach back into the canvas.

import { refreshIcons, iconHtml } from './icons.js';
import { extractMarkdown, renderMiniMarkdown } from './sticky-note-markdown.js';
import { enhanceClayLogLinks } from './clay-log-links.js';
import { debouncedTextUpdate, syncTitle, getNoteUiState, setNoteUiState, subscribeNoteUiState } from './sticky-notes-shared.js';

import { mutateChecklist } from './sticky-notes-state.js';

var formatToolbarEl = null;

// --- Text edit (contenteditable) ---

// --- Format toolbar (WYSIWYG) ---

var FORMAT_BUTTONS = [
  { label: "B", title: "Bold", cls: "sn-fmt-bold", command: "bold" },
  { label: "I", title: "Italic", cls: "sn-fmt-italic", command: "italic" },
  { label: "S", title: "Strikethrough", cls: "sn-fmt-strike", command: "strikethrough" },
  { label: "code-2", title: "Code", cls: "sn-fmt-code", command: "code", isIcon: true },
];

// The canvas asks this before deciding an outside click should dismiss the
// toolbar, so the element itself stays private to this module.
export function isFormatToolbarOpen() {
  return !!formatToolbarEl;
}
export function closeFormatToolbar() {
  if (formatToolbarEl) {
    formatToolbarEl.remove();
    formatToolbarEl = null;
  }
}

function applyFormat(command, rendered) {
  if (command === "code") {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var ancestor = range.commonAncestorContainer;
    var codeParent = (ancestor.nodeType === 3 ? ancestor.parentElement : ancestor);
    if (codeParent && codeParent.closest && codeParent.closest("code")) {
      // Unwrap: replace <code> with its text content
      var codeEl = codeParent.closest("code");
      var textNode = document.createTextNode(codeEl.textContent);
      codeEl.parentNode.replaceChild(textNode, codeEl);
      var newRange = document.createRange();
      newRange.selectNodeContents(textNode);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      // Wrap selection in <code>
      var code = document.createElement("code");
      try { range.surroundContents(code); } catch (e) {
        var frag = range.extractContents();
        code.appendChild(frag);
        range.insertNode(code);
      }
    }
  } else {
    document.execCommand(command, false, null);
  }
  // Trigger sync
  rendered.dispatchEvent(new Event("input", { bubbles: true }));
}

function showFormatToolbar(rendered) {
  closeFormatToolbar();

  var sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  if (!sel.toString().trim()) return;

  var range = sel.getRangeAt(0);
  // When dragging outside the note, commonAncestorContainer may be a parent
  // of rendered. Clamp the range to the rendered element so the toolbar shows.
  if (!rendered.contains(range.commonAncestorContainer)) {
    try {
      var clampedRange = range.cloneRange();
      if (range.startContainer === rendered || rendered.contains(range.startContainer)) {
        clampedRange.selectNodeContents(rendered);
        clampedRange.setStart(range.startContainer, range.startOffset);
      } else if (range.endContainer === rendered || rendered.contains(range.endContainer)) {
        clampedRange.selectNodeContents(rendered);
        clampedRange.setEnd(range.endContainer, range.endOffset);
      } else {
        return;
      }
      range = clampedRange;
    } catch (e) {
      return;
    }
  }

  var toolbar = document.createElement("div");
  toolbar.className = "sn-format-toolbar";

  for (var i = 0; i < FORMAT_BUTTONS.length; i++) {
    (function (cfg) {
      var btn = document.createElement("button");
      btn.className = "sn-fmt-btn " + cfg.cls;
      btn.title = cfg.title;
      btn.innerHTML = cfg.isIcon ? iconHtml(cfg.label) : cfg.label;
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyFormat(cfg.command, rendered);
        setTimeout(function () {
          var s = window.getSelection();
          if (s && !s.isCollapsed) {
            showFormatToolbar(rendered);
          } else {
            closeFormatToolbar();
          }
        }, 0);
      });
      toolbar.appendChild(btn);
    })(FORMAT_BUTTONS[i]);
  }

  refreshIcons();
  document.body.appendChild(toolbar);
  formatToolbarEl = toolbar;
  positionToolbarAtRange(toolbar, range);
}

function positionToolbarAtRange(toolbar, range) {
  var rect = range.getBoundingClientRect();
  var toolbarX = rect.left + rect.width / 2;
  var toolbarY = rect.top - 4;

  toolbar.style.left = toolbarX + "px";
  toolbar.style.top = toolbarY + "px";

  requestAnimationFrame(function () {
    var tw = toolbar.offsetWidth;
    var th = toolbar.offsetHeight;
    var x = Math.max(8, Math.min(toolbarX - tw / 2, window.innerWidth - tw - 8));
    var y = Math.max(8, toolbarY - th);
    toolbar.style.left = x + "px";
    toolbar.style.top = y + "px";
  });
}

export function setupTextEdit(textarea, rendered, noteId, mdBtn, checklistBtn, noteData) {
  var noteEl = textarea.closest(".sticky-note");
  var mdMode = false;
  var disposed = false;
  var ui = getNoteUiState(noteId, noteData);
  var checklistMode = ui.checklistMode === true;
  var checklistState = ui.checklistState || {};
  var renderedDirty = false;
  var sourceText = ui.text !== undefined ? ui.text : textarea.value;
  textarea.value = sourceText;

  function renderChecklist() {
    var active = document.activeElement;
    var focusKey = active && rendered.contains(active) && active.dataset ? active.dataset.checklistKey : undefined;
    rendered.innerHTML = renderMiniMarkdown(sourceText, { checklistMode: checklistMode, checklistState: checklistState });
    if (sourceText.trim()) enhanceClayLogLinks(rendered);
    rendered.classList.toggle("is-empty", !sourceText.trim());
    rendered.contentEditable = checklistMode ? "false" : "true";
    if (focusKey !== undefined) {
      var checks = rendered.querySelectorAll("[data-checklist-key]");
      for (var i = 0; i < checks.length; i++) {
        if (checks[i].dataset.checklistKey === focusKey) { checks[i].focus({ preventScroll: true }); break; }
      }
    }
  }

  function saveRenderedMarkdown() {
    if (checklistMode) return;
    renderedDirty = true;
    sourceText = extractMarkdown(rendered);
    textarea.value = sourceText;
    setNoteUiState(noteId, { text: sourceText, draft: true });
    debouncedTextUpdate(noteId, sourceText);
    syncTitle(noteEl, sourceText);
    rendered.classList.toggle("is-empty", !sourceText.trim());
  }

  function toggleChecklistItem(check) {
    if (checklistMode && check.dataset.checklistIndex !== undefined) {
      var index = parseInt(check.dataset.checklistIndex, 10);
      var checked = !check.classList.contains("checked");
      mutateChecklist(noteId, { checklistIndex: index, checklistKey: check.dataset.checklistKey || "", checklistSource: sourceText, checklistChecked: checked });
      return;
    }
    var normalChecked = !check.classList.contains("checked");
    check.classList.toggle("checked", normalChecked);
    check.textContent = normalChecked ? "✓" : "☐";
    check.setAttribute("aria-checked", normalChecked ? "true" : "false");
    saveRenderedMarkdown();
  }

  var unsubscribeUiState = subscribeNoteUiState(function (all) {
    var next = all[noteId];
    if (!next) return;
    var changed = next.checklistMode !== checklistMode ||
      (next.text !== undefined && next.text !== sourceText) ||
      JSON.stringify(next.checklistState || {}) !== JSON.stringify(checklistState || {});
    checklistMode = next.checklistMode === true;
    checklistState = next.checklistState || {};
    if (next.text !== undefined && next.text !== sourceText) {
      sourceText = next.text;
      textarea.value = sourceText;
    }
    checklistBtn.classList.toggle("active", checklistMode);
    checklistBtn.title = checklistMode ? "Show markdown" : "Show checklist";
    checklistBtn.setAttribute("aria-label", checklistBtn.title);
    checklistBtn.setAttribute("aria-pressed", checklistMode ? "true" : "false");
    var status = noteEl.querySelector(".sticky-note-save-status");
    if (status) status.textContent = next.error || (next.pending && next.pending.length ? "Saving…" : "");
    if (changed && !mdMode) { renderChecklist(); syncTitle(noteEl, sourceText); }
  });
  noteEl._stickyNoteDispose = function () {
    disposed = true;
    closeFormatToolbar();
    unsubscribeUiState();
  };

  checklistBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    mutateChecklist(noteId, { checklistMode: !checklistMode });
  });

  mdBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    mdMode = !mdMode;
    if (mdMode) {
      textarea.value = sourceText;
      textarea.style.display = "";
      rendered.style.display = "none";
      mdBtn.classList.add("active");
      textarea.focus();
    } else {
      sourceText = textarea.value;
      if (getNoteUiState(noteId).draft) debouncedTextUpdate(noteId, sourceText);
      syncTitle(noteEl, sourceText);
      renderChecklist();
      textarea.style.display = "none";
      rendered.style.display = "";
      mdBtn.classList.remove("active");
      rendered.focus();
    }
  });

  rendered.addEventListener("input", saveRenderedMarkdown);
  rendered.addEventListener("click", function (e) {
    var check = e.target.closest && e.target.closest(".sn-check");
    if (!check || !rendered.contains(check)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleChecklistItem(check);
  });

  rendered.addEventListener("blur", function (e) {
    if (checklistMode || !renderedDirty) return;
    renderedDirty = false;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".sn-format-toolbar")) return;
    closeFormatToolbar();
    var md = extractMarkdown(rendered);
    sourceText = md;
    textarea.value = md;
    setNoteUiState(noteId, { text: sourceText, draft: true });
    renderChecklist();
  });

  // Show format toolbar when selecting text
  rendered.addEventListener("mouseup", function (e) {
    if (e.target.tagName === "A") return;
    setTimeout(function () {
      if (disposed) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        showFormatToolbar(rendered);
      } else {
        closeFormatToolbar();
      }
    }, 10);
  });

  // Keyboard selection
  rendered.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        showFormatToolbar(rendered);
      } else {
        closeFormatToolbar();
      }
    }
  });

  // Insert <br> on Enter instead of <div>
  rendered.addEventListener("keydown", function (e) {
    if (e.target.classList && e.target.classList.contains("sn-check") &&
        (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggleChecklistItem(e.target);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
    }
  });

  // Paste as plain text to avoid importing HTML formatting
  rendered.addEventListener("paste", function (e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  // Prevent drag when clicking body
  rendered.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });

  // Sync textarea edits when in MD mode
  textarea.addEventListener("input", function () {
    if (!mdMode) return;
    sourceText = textarea.value;
    setNoteUiState(noteId, { text: sourceText, draft: true });
    debouncedTextUpdate(noteId, sourceText);
    syncTitle(noteEl, sourceText);
  });

  textarea.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });
}
