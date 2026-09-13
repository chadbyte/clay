// Markdown helpers for sticky-note titles, handoff bodies, and checklists.

export function getTitle(text) {
  if (!text) return "";
  var idx = text.indexOf("\n");
  return idx === -1 ? text : text.substring(0, idx);
}

function formatInline(text) {
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
    .replace(/^(?:-\s*)?\[[xX]\]/gm, '<span class="sn-check checked" role="checkbox" aria-checked="true" tabindex="0" contenteditable="false">✓</span>')
    .replace(/^(?:-\s*)?\[ \]/gm, '<span class="sn-check" role="checkbox" aria-checked="false" tabindex="0" contenteditable="false">☐</span>')
    .replace(/\n/g, "<br>");
}

export function renderMiniMarkdown(text) {
  if (!text) return "";
  var lines = text.split("\n");
  var title = lines[0];
  var body = lines.slice(1).join("\n");
  var html = '<div class="sn-title">' + formatInline(title) + "</div>";
  if (body.trim()) html += formatInline(body);
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
