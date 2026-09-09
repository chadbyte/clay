// Summarize only supplied text; a heading is preferable to a prose excerpt.
function plainText(text) {
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|>\s*)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ").trim();
}

export function thinkingSummary(text) {
  if (typeof text !== "string" || !text.trim()) return "Thinking";
  var lines = text.split("\n");
  var heading = "";
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*(?:#{1,6}\s+|\*\*|__)/.test(lines[i])) {
      var candidate = plainText(lines[i]);
      if (candidate) heading = candidate;
    }
  }
  var paragraphs = text.trim().split(/\n\s*\n/);
  var summary = heading || plainText(paragraphs[paragraphs.length - 1]);
  if (!heading) {
    var sentence = summary.match(/^.*?[.!?。！？](?:\s|$)/);
    if (sentence) summary = sentence[0].trim();
  }
  if (!summary) return "Thinking";
  return summary.length > 140 ? summary.slice(0, 139).trimEnd() + "…" : summary;
}
