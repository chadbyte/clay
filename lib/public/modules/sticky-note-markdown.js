// Markdown helpers for sticky-note titles, handoff bodies, and checklists.

export function getTitle(text) {
  if (!text) return "";
  var idx = text.indexOf("\n");
  return idx === -1 ? text : text.substring(0, idx);
}

function checklistFence(line) {
  var match = line.match(/^\s*(\x60{3,}|~{3,})/);
  return match ? match[1].charAt(0) : null;
}

export function getChecklistItems(text) {
  var lines = (text || "").split("\n").slice(1);
  var items = [];
  var fence = null;
  var occurrences = Object.create(null);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var nextFence = checklistFence(line);
    if (nextFence) {
      fence = fence === nextFence ? null : (fence || nextFence);
      continue;
    }
    if (fence || !line.trim() || /^\s*#{1,6}\s/.test(line)) continue;
    var occurrence = occurrences[line] || 0;
    occurrences[line] = occurrence + 1;
    items.push({ index: i, text: line, key: line + "\u0000" + occurrence });
  }
  return items;
}

function formatInline(text, preserveChecks) {
  var escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(preserveChecks ? /(?!x)x^/ : /^(?:-\s*)?\[[xX]\]/gm, '<span class="sn-check checked" role="checkbox" aria-checked="true" tabindex="0" contenteditable="false">✓</span>')
    .replace(preserveChecks ? /(?!x)x^/ : /^(?:-\s*)?\[ \]/gm, '<span class="sn-check" role="checkbox" aria-checked="false" tabindex="0" contenteditable="false">☐</span>')
    .replace(/\n/g, "<br>");
}

export function renderMiniMarkdown(text, options) {
  if (!text) return "";
  options = options || {};
  var lines = text.split("\n");
  var title = lines[0];
  var body = lines.slice(1).join("\n");
  var html = '<div class="sn-title">' + formatInline(title, options.checklistMode) + "</div>";
  if (body.trim()) {
    if (options.checklistMode) {
      var checklistLines = body.split("\n");
      var checklistHtml = [];
      var inCode = false;
      var fenceChar = null;
      var occurrences = Object.create(null);
      for (var i = 0; i < checklistLines.length; i++) {
        var line = checklistLines[i];
        var lineFence = checklistFence(line);
        if (lineFence) {
          fenceChar = fenceChar === lineFence ? null : (fenceChar || lineFence);
          inCode = !!fenceChar;
          checklistHtml.push(formatInline(line, true));
          if (i < checklistLines.length - 1) checklistHtml.push("<br>");
          continue;
        }
        var task = !inCode && line.trim() && !/^\s*#{1,6}\s/.test(line);
        if (task) {
          var markerMatch = line.match(/^\s*(?:[-*+]\s+)?\[([ xX])\]\s*(.*)$/);
          var checked = markerMatch ? markerMatch[1].toLowerCase() === "x" : false;
          var content = markerMatch ? markerMatch[2] : line;
          var occurrence = occurrences[line] || 0;
          occurrences[line] = occurrence + 1;
          var checklistKey = line + "\u0000" + occurrence;
          var stored = options.checklistState && options.checklistState[checklistKey];
          if (stored === undefined && Array.isArray(options.checklistState)) stored = options.checklistState[i];
          if (stored !== undefined) {
            checked = stored === true;
          }
          checklistHtml.push('<span class="sn-check' + (checked ? ' checked' : '') + '" data-checklist-index="' + i + '" data-checklist-key="' + encodeURIComponent(checklistKey) + '" role="checkbox" aria-checked="' + (checked ? 'true' : 'false') + '" tabindex="0" contenteditable="false">' + (checked ? "✓" : "☐") + "</span>" + formatInline(content));
        } else {
          checklistHtml.push(formatInline(line, !!inCode));
        }
        if (i < checklistLines.length - 1) checklistHtml.push("<br>");
      }
      html += checklistHtml.join("");
    } else {
      html += formatInline(body);
    }
  }
  return html;
}

function childrenToMarkdown(element) {
  var result = "";
  for (var i = 0; i < element.childNodes.length; i++) {
    result += nodeToMarkdown(element.childNodes[i]);
  }
  return result;
}

function nodeToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return "";

  var tag = node.tagName;
  var inner = childrenToMarkdown(node);
  switch (tag) {
    case "STRONG": case "B": return "**" + inner + "**";
    case "EM": case "I": return "*" + inner + "*";
    case "DEL": case "S": case "STRIKE": return "~~" + inner + "~~";
    case "CODE": return "`" + inner + "`";
    case "BR": return "\n";
    case "DIV":
      if (node.classList.contains("sn-title")) return inner;
      if (node.classList.contains("sn-placeholder")) return "";
      return "\n" + inner;
    case "P": return "\n" + inner;
    case "A": return node.getAttribute("href") || inner;
    case "BUTTON":
      if (node.dataset && node.dataset.issueRef) return "`" + node.dataset.issueRef + "`";
      if (node.classList.contains("clayos-log-link") && node.dataset && node.dataset.logRef) {
        return "`" + node.dataset.logRef + "`";
      }
      return inner;
    case "SPAN":
      if (node.classList.contains("sn-check")) {
        return node.classList.contains("checked") ? "- [x]" : "- [ ]";
      }
      if (node.classList.contains("sn-placeholder")) return "";
      return inner;
    default: return inner;
  }
}

export function extractMarkdown(rendered) {
  var titleEl = rendered.querySelector(".sn-title");
  if (titleEl) {
    var titleMarkdown = childrenToMarkdown(titleEl);
    var rest = "";
    var afterTitle = false;
    for (var i = 0; i < rendered.childNodes.length; i++) {
      var child = rendered.childNodes[i];
      if (child === titleEl) {
        afterTitle = true;
        continue;
      }
      if (afterTitle) rest += nodeToMarkdown(child);
    }
    if (rest && rest.charAt(0) === "\n") rest = rest.substring(1);
    return titleMarkdown + (rest ? "\n" + rest : "");
  }
  return childrenToMarkdown(rendered).replace(/^\n+/, "");
}
