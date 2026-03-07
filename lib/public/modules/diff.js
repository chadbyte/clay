// diff.js - Shared diff module with LCS-based line diffing
// Produces unified and split diff views similar to GitHub

/**
 * Compute LCS (Longest Common Subsequence) table for two arrays of lines.
 * Returns a 2D table where table[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a, b) {
  var m = a.length;
  var n = b.length;
  // Use flat array for performance
  var t = new Array((m + 1) * (n + 1));
  var w = n + 1;
  for (var i = 0; i <= m; i++) t[i * w] = 0;
  for (var j = 0; j <= n; j++) t[j] = 0;
  for (var i2 = 1; i2 <= m; i2++) {
    for (var j2 = 1; j2 <= n; j2++) {
      if (a[i2 - 1] === b[j2 - 1]) {
        t[i2 * w + j2] = t[(i2 - 1) * w + (j2 - 1)] + 1;
      } else {
        var up = t[(i2 - 1) * w + j2];
        var left = t[i2 * w + (j2 - 1)];
        t[i2 * w + j2] = up > left ? up : left;
      }
    }
  }
  return { data: t, width: w };
}

/**
 * Backtrack LCS table to produce a list of diff operations.
 * Each op: { type: "equal"|"remove"|"add", oldLine, newLine, text }
 */
function backtrack(a, b, table) {
  var ops = [];
  var t = table.data;
  var w = table.width;
  var i = a.length;
  var j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", oldLine: i, newLine: j, text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || t[(i) * w + (j - 1)] >= t[(i - 1) * w + j])) {
      ops.push({ type: "add", oldLine: null, newLine: j, text: b[j - 1] });
      j--;
    } else {
      ops.push({ type: "remove", oldLine: i, newLine: null, text: a[i - 1] });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

/**
 * Compute line-level diff between two strings.
 * Returns array of { type: "equal"|"remove"|"add", oldLine, newLine, text }
 */
export function diffLines(oldStr, newStr) {
  var a = oldStr ? oldStr.split("\n") : [];
  var b = newStr ? newStr.split("\n") : [];
  var table = lcsTable(a, b);
  return backtrack(a, b, table);
}

/**
 * Highlight all lines of a source string via hljs.
 * Returns an array of HTML strings, one per line.
 * Falls back to escaped text if hljs is unavailable or fails.
 */
function highlightLines(src, lang) {
  if (!lang || typeof hljs === "undefined" || !src) return null;
  try {
    var result = hljs.highlight(src, { language: lang });
    return result.value.split("\n");
  } catch (e) {
    return null;
  }
}

/**
 * Build a map from line number (1-based) to highlighted HTML.
 * oldMap[lineNum] = html, newMap[lineNum] = html
 */
function buildHighlightMaps(oldStr, newStr, lang) {
  if (!lang) return null;
  var oldHL = highlightLines(oldStr, lang);
  var newHL = highlightLines(newStr, lang);
  if (!oldHL && !newHL) return null;
  return { oldLines: oldHL, newLines: newHL };
}

/**
 * Set cell content: use highlighted HTML if available, otherwise plain text.
 */
function setCellContent(td, text, hlLines, lineNum) {
  if (hlLines && lineNum != null && lineNum > 0 && lineNum <= hlLines.length) {
    td.innerHTML = hlLines[lineNum - 1];
  } else {
    td.textContent = text;
  }
}

/**
 * Render a unified diff view (single column, +/- markers).
 * Optional lang parameter enables syntax highlighting.
 * Returns a DOM element.
 */
export function renderUnifiedDiff(oldStr, newStr, lang) {
  var ops = diffLines(oldStr, newStr);
  var hl = buildHighlightMaps(oldStr, newStr, lang);
  var container = document.createElement("div");
  container.className = "diff-unified" + (lang === "markdown" ? " diff-wrap" : "");

  var table = document.createElement("table");
  table.className = "diff-table";

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    var tr = document.createElement("tr");
    tr.className = "diff-row diff-row-" + op.type;

    // Old line number
    var tdOldLn = document.createElement("td");
    tdOldLn.className = "diff-ln diff-ln-old";
    tdOldLn.textContent = op.oldLine != null ? op.oldLine : "";

    // New line number
    var tdNewLn = document.createElement("td");
    tdNewLn.className = "diff-ln diff-ln-new";
    tdNewLn.textContent = op.newLine != null ? op.newLine : "";

    // Marker
    var tdMarker = document.createElement("td");
    tdMarker.className = "diff-marker";
    if (op.type === "remove") tdMarker.textContent = "-";
    else if (op.type === "add") tdMarker.textContent = "+";
    else tdMarker.textContent = " ";

    // Code (with optional highlighting)
    var tdCode = document.createElement("td");
    tdCode.className = "diff-code";
    if (hl) {
      var hlSrc = (op.type === "add") ? hl.newLines : hl.oldLines;
      var ln = (op.type === "add") ? op.newLine : op.oldLine;
      setCellContent(tdCode, op.text, hlSrc, ln);
    } else {
      tdCode.textContent = op.text;
    }

    tr.appendChild(tdOldLn);
    tr.appendChild(tdNewLn);
    tr.appendChild(tdMarker);
    tr.appendChild(tdCode);
    table.appendChild(tr);
  }

  container.appendChild(table);
  return container;
}

/**
 * Render a split (side-by-side) diff view like GitHub.
 * Optional lang parameter enables syntax highlighting.
 * Returns a DOM element.
 */
export function renderSplitDiff(oldStr, newStr, lang) {
  var ops = diffLines(oldStr, newStr);
  var hl = buildHighlightMaps(oldStr, newStr, lang);
  var container = document.createElement("div");
  container.className = "diff-split-view" + (lang === "markdown" ? " diff-wrap" : "");

  var table = document.createElement("table");
  table.className = "diff-table diff-table-split";

  // Group consecutive removes and adds into change blocks
  var i = 0;
  while (i < ops.length) {
    var op = ops[i];

    if (op.type === "equal") {
      var tr = document.createElement("tr");
      tr.className = "diff-row diff-row-equal";
      appendSplitCells(tr, op.oldLine, op.text, op.newLine, op.text, hl);
      table.appendChild(tr);
      i++;
    } else {
      // Collect consecutive removes and adds
      var removes = [];
      var adds = [];
      while (i < ops.length && ops[i].type === "remove") {
        removes.push(ops[i]);
        i++;
      }
      while (i < ops.length && ops[i].type === "add") {
        adds.push(ops[i]);
        i++;
      }

      // Pair them up row by row
      var maxLen = Math.max(removes.length, adds.length);
      for (var k = 0; k < maxLen; k++) {
        var tr2 = document.createElement("tr");
        var rm = k < removes.length ? removes[k] : null;
        var ad = k < adds.length ? adds[k] : null;

        if (rm && ad) {
          tr2.className = "diff-row diff-row-change";
        } else if (rm) {
          tr2.className = "diff-row diff-row-remove";
        } else {
          tr2.className = "diff-row diff-row-add";
        }

        appendSplitCells(
          tr2,
          rm ? rm.oldLine : null,
          rm ? rm.text : "",
          ad ? ad.newLine : null,
          ad ? ad.text : "",
          hl
        );
        table.appendChild(tr2);
      }
    }
  }

  container.appendChild(table);
  return container;
}

/**
 * Render a pre-formatted patch/diff text (with @@, +, - markers) using table layout.
 * Parses hunk headers for line numbers. Optional lang for syntax highlighting.
 * Returns a DOM element.
 */
export function renderPatchDiff(text, lang) {
  var lines = text.split("\n");

  // Reconstruct old and new source for highlighting
  var oldSrc = [];
  var newSrc = [];
  for (var p = 0; p < lines.length; p++) {
    var pl = lines[p];
    if (pl.startsWith("-") && !pl.startsWith("---")) {
      oldSrc.push(pl.substring(1));
    } else if (pl.startsWith("+") && !pl.startsWith("+++")) {
      newSrc.push(pl.substring(1));
    } else if (pl.startsWith(" ")) {
      oldSrc.push(pl.substring(1));
      newSrc.push(pl.substring(1));
    }
  }
  var oldHL = highlightLines(oldSrc.join("\n"), lang);
  var newHL = highlightLines(newSrc.join("\n"), lang);
  var oldHLIdx = 0;
  var newHLIdx = 0;

  var container = document.createElement("div");
  container.className = "diff-unified" + (lang === "markdown" ? " diff-wrap" : "");

  var table = document.createElement("table");
  table.className = "diff-table";

  var oldLn = 0;
  var newLn = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Skip file headers
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    // Skip "diff --git" lines
    if (line.startsWith("diff ")) continue;
    // Skip index lines
    if (line.startsWith("index ")) continue;

    // Hunk header: @@ -oldStart,oldLen +newStart,newLen @@
    var hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      oldLn = parseInt(hunkMatch[1], 10);
      newLn = parseInt(hunkMatch[2], 10);

      // Render hunk separator row
      var tr = document.createElement("tr");
      tr.className = "diff-row diff-row-hunk";
      var tdLn1 = document.createElement("td");
      tdLn1.className = "diff-ln";
      var tdLn2 = document.createElement("td");
      tdLn2.className = "diff-ln";
      var tdMarker = document.createElement("td");
      tdMarker.className = "diff-marker";
      var tdCode = document.createElement("td");
      tdCode.className = "diff-code diff-hunk-text";
      tdCode.textContent = line;
      tr.appendChild(tdLn1);
      tr.appendChild(tdLn2);
      tr.appendChild(tdMarker);
      tr.appendChild(tdCode);
      table.appendChild(tr);
      continue;
    }

    var tr2 = document.createElement("tr");
    var tdOldLn = document.createElement("td");
    tdOldLn.className = "diff-ln diff-ln-old";
    var tdNewLn = document.createElement("td");
    tdNewLn.className = "diff-ln diff-ln-new";
    var tdMark = document.createElement("td");
    tdMark.className = "diff-marker";
    var tdText = document.createElement("td");
    tdText.className = "diff-code";

    if (line.startsWith("-")) {
      tr2.className = "diff-row diff-row-remove";
      tdOldLn.textContent = oldLn;
      tdMark.textContent = "-";
      if (oldHL && oldHLIdx < oldHL.length) {
        tdText.innerHTML = oldHL[oldHLIdx];
      } else {
        tdText.textContent = line.substring(1);
      }
      oldHLIdx++;
      oldLn++;
    } else if (line.startsWith("+")) {
      tr2.className = "diff-row diff-row-add";
      tdNewLn.textContent = newLn;
      tdMark.textContent = "+";
      if (newHL && newHLIdx < newHL.length) {
        tdText.innerHTML = newHL[newHLIdx];
      } else {
        tdText.textContent = line.substring(1);
      }
      newHLIdx++;
      newLn++;
    } else if (line.startsWith(" ") || line === "") {
      tr2.className = "diff-row diff-row-equal";
      tdOldLn.textContent = oldLn;
      tdNewLn.textContent = newLn;
      tdMark.textContent = " ";
      if (oldHL && oldHLIdx < oldHL.length) {
        tdText.innerHTML = oldHL[oldHLIdx];
      } else {
        tdText.textContent = line.startsWith(" ") ? line.substring(1) : line;
      }
      oldHLIdx++;
      newHLIdx++;
      oldLn++;
      newLn++;
    } else {
      // Unknown line, just render as context
      tr2.className = "diff-row diff-row-equal";
      tdText.textContent = line;
    }

    tr2.appendChild(tdOldLn);
    tr2.appendChild(tdNewLn);
    tr2.appendChild(tdMark);
    tr2.appendChild(tdText);
    table.appendChild(tr2);
  }

  container.appendChild(table);
  return container;
}

function appendSplitCells(tr, oldLn, oldText, newLn, newText, hl) {
  // Left side
  var tdOldLn = document.createElement("td");
  tdOldLn.className = "diff-ln";
  tdOldLn.textContent = oldLn != null ? oldLn : "";

  var tdOldCode = document.createElement("td");
  tdOldCode.className = "diff-code diff-code-old";
  if (oldLn != null) {
    setCellContent(tdOldCode, oldText, hl ? hl.oldLines : null, oldLn);
  }

  // Right side
  var tdNewLn = document.createElement("td");
  tdNewLn.className = "diff-ln";
  tdNewLn.textContent = newLn != null ? newLn : "";

  var tdNewCode = document.createElement("td");
  tdNewCode.className = "diff-code diff-code-new";
  if (newLn != null) {
    setCellContent(tdNewCode, newText, hl ? hl.newLines : null, newLn);
  }

  tr.appendChild(tdOldLn);
  tr.appendChild(tdOldCode);
  tr.appendChild(tdNewLn);
  tr.appendChild(tdNewCode);
}
