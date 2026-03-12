import { copyToClipboard, escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { getMermaidThemeVars } from './theme.js';

// Initialize markdown parser
marked.use({ gfm: true, breaks: false });

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: getMermaidThemeVars()
});

export function updateMermaidTheme(vars) {
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: vars
  });
}

var mermaidIdCounter = 0;

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

/**
 * Parse Unicode emojis inside an element into Twemoji SVG images.
 * Used only for UI chrome (icon strip, emoji picker, title bar) where
 * img-based rendering is needed for sizing/drop-shadow effects.
 * Chat area uses the Twemoji COLR font instead (no DOM manipulation).
 */
var twemojiOpts = { folder: "svg", ext: ".svg", base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/" };
export function parseEmojis(el) {
  if (typeof twemoji === "undefined" || !el) return;
  twemoji.parse(el, twemojiOpts);
}

var langAliases = { jsonl: "json", dotenv: "bash" };

export function highlightCodeBlocks(el) {
  el.querySelectorAll("pre code:not(.hljs):not(.language-mermaid)").forEach(function (block) {
    var cls = Array.from(block.classList).find(function (c) { return c.startsWith("language-"); });
    if (cls) {
      var lang = cls.replace("language-", "");
      if (langAliases[lang]) {
        block.classList.remove(cls);
        block.classList.add("language-" + langAliases[lang]);
      }
    }
    hljs.highlightElement(block);
  });
  el.querySelectorAll("pre:not(.has-copy-btn):not([data-mermaid-processed])").forEach(function (pre) {
    // Skip non-content code blocks (tool details, diffs, etc.)
    if (!pre.querySelector("code")) return;
    pre.classList.add("has-copy-btn");
    pre.style.position = "relative";
    var btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.title = "Copy";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      copyToClipboard(text).then(function () {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

export function renderMermaidBlocks(el) {
  var blocks = el.querySelectorAll("pre code.language-mermaid");
  blocks.forEach(function (codeEl) {
    var pre = codeEl.parentElement;
    if (!pre || pre.dataset.mermaidProcessed) return;
    pre.dataset.mermaidProcessed = "true";

    var source = codeEl.textContent;
    if (!source || !source.trim()) return;

    var id = "mermaid-" + (++mermaidIdCounter);
    var container = document.createElement("div");
    container.className = "mermaid-diagram";

    try {
      mermaid.render(id, source.trim()).then(function (result) {
        container.innerHTML = result.svg;
        container.addEventListener("click", function () {
          showMermaidModal(container.innerHTML);
        });
        if (pre.parentNode) pre.parentNode.replaceChild(container, pre);
      }).catch(function (err) {
        pre.classList.add("mermaid-error");
        var errHint = document.createElement("div");
        errHint.className = "mermaid-error-hint";
        errHint.textContent = "Diagram render failed";
        if (pre.parentNode) pre.parentNode.insertBefore(errHint, pre.nextSibling);
        var errDiv = document.getElementById("d" + id);
        if (errDiv) errDiv.remove();
      });
    } catch (err) {
      pre.classList.add("mermaid-error");
    }
  });
}

export function showMermaidModal(svgHtml) {
  var modal = document.getElementById("mermaid-modal");
  var body = document.getElementById("mermaid-modal-body");
  if (!modal || !body) return;
  body.innerHTML = svgHtml;
  modal.classList.remove("hidden");
  refreshIcons();

  var dlBtn = document.getElementById("mermaid-download-btn");
  dlBtn.onclick = function () {
    downloadMermaidPng(body.querySelector("svg"));
  };
}

export function closeMermaidModal() {
  var modal = document.getElementById("mermaid-modal");
  if (modal) modal.classList.add("hidden");
}

export function downloadMermaidPng(svgEl) {
  if (!svgEl) return;
  var svgClone = svgEl.cloneNode(true);
  // Ensure dimensions
  var bbox = svgEl.getBoundingClientRect();
  var scale = 2; // 2x for retina quality
  var w = bbox.width * scale;
  var h = bbox.height * scale;
  svgClone.setAttribute("width", w);
  svgClone.setAttribute("height", h);

  var serializer = new XMLSerializer();
  var svgStr = serializer.serializeToString(svgClone);
  var svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  var url = URL.createObjectURL(svgBlob);

  var img = new Image();
  img.onload = function () {
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    // Dark background
    ctx.fillStyle = "#1E1D1A";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    canvas.toBlob(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diagram.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };
  img.src = url;
}

// --- PDF Export ---

export function svgToPngDataUrl(svgEl) {
  return new Promise(function (resolve, reject) {
    var svgClone = svgEl.cloneNode(true);
    var bbox = svgEl.getBoundingClientRect();
    var scale = 2;
    var w = Math.max(bbox.width, 1) * scale;
    var h = Math.max(bbox.height, 1) * scale;
    svgClone.setAttribute("width", w);
    svgClone.setAttribute("height", h);

    var serializer = new XMLSerializer();
    var svgStr = serializer.serializeToString(svgClone);
    var svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(svgBlob);

    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error("SVG image load failed"));
    };
    img.src = url;
  });
}

export function exportMarkdownAsPdf(markdownEl, filename) {
  // Open popup synchronously during click event to satisfy browser popup policies
  var popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) {
    alert("PDF export blocked: please allow popups for this site.");
    return Promise.resolve();
  }

  popup.document.write("<!DOCTYPE html><html><head><title>Preparing PDF\u2026</title></head><body><p style=\"font-family:sans-serif;padding:32px;color:#555\">Preparing PDF, please wait\u2026</p></body></html>");
  popup.document.close();

  // Collect all mermaid diagrams and their SVGs
  var diagrams = markdownEl.querySelectorAll(".mermaid-diagram");
  var svgEls = [];
  for (var i = 0; i < diagrams.length; i++) {
    svgEls.push(diagrams[i].querySelector("svg"));
  }

  var pngPromises = [];
  for (var j = 0; j < svgEls.length; j++) {
    if (svgEls[j]) {
      pngPromises.push(svgToPngDataUrl(svgEls[j]));
    } else {
      pngPromises.push(Promise.resolve(null));
    }
  }

  return Promise.all(pngPromises).then(function (dataUrls) {
    // Deep-clone the markdown container
    var clone = markdownEl.cloneNode(true);

    // Remove copy buttons
    var copyBtns = clone.querySelectorAll(".code-copy-btn");
    for (var k = 0; k < copyBtns.length; k++) {
      copyBtns[k].remove();
    }

    // Replace mermaid diagram divs with <img> elements
    var clonedDiagrams = clone.querySelectorAll(".mermaid-diagram");
    for (var m = 0; m < clonedDiagrams.length; m++) {
      if (dataUrls[m]) {
        var imgEl = document.createElement("img");
        imgEl.src = dataUrls[m];
        imgEl.className = "pdf-mermaid-img";
        clonedDiagrams[m].parentNode.replaceChild(imgEl, clonedDiagrams[m]);
      } else {
        var errEl = document.createElement("p");
        errEl.textContent = "[Diagram could not be rendered]";
        clonedDiagrams[m].parentNode.replaceChild(errEl, clonedDiagrams[m]);
      }
    }

    // Make relative image src absolute so popup can load them
    var cloneImgs = clone.querySelectorAll("img:not(.pdf-mermaid-img)");
    for (var n = 0; n < cloneImgs.length; n++) {
      var src = cloneImgs[n].getAttribute("src");
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        cloneImgs[n].src = window.location.origin + "/" + src.replace(/^\//, "");
      }
    }

    var contentHtml = clone.innerHTML;
    var title = (filename || "document").replace(/.*\//, "");

    popup.document.open();
    popup.document.write(buildPrintHtml(title, contentHtml));
    popup.document.close();

    popup.onload = function () {
      // Wait for web fonts (Pretendard, Roboto Mono) before printing
      popup.document.fonts.ready.then(function () {
        popup.focus();
        popup.print();
        if (typeof popup.onafterprint !== "undefined") {
          popup.onafterprint = function () { popup.close(); };
        } else {
          setTimeout(function () { popup.close(); }, 1000);
        }
      });
    };
  }).catch(function (err) {
    popup.close();
    throw err;
  });
}

function buildPrintHtml(title, contentHtml) {
  return "<!DOCTYPE html>\n" +
    "<html lang=\"ko\"><head>\n" +
    "<meta charset=\"UTF-8\">\n" +
    "<title>" + escapeHtml(title) + "</title>\n" +
    "<link rel=\"preconnect\" href=\"https://cdn.jsdelivr.net\">\n" +
    "<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css\">\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
    "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;0,500;1,400&display=swap\">\n" +
    "<style>\n" + getPrintCss() + "\n</style>\n" +
    "</head><body>\n" +
    "<div class=\"file-viewer-markdown\">" + contentHtml + "</div>\n" +
    "</body></html>";
}

function getPrintCss() {
  return [
    /* MS Word defaults: 2.54cm (1in) margins, 11pt, 115% line-height, 8pt after para */
    "@page { margin: 2.54cm; }",
    "*, *::before, *::after { box-sizing: border-box; }",
    "body {",
    "  font-family: 'Pretendard', 'Pretendard Variable', system-ui, -apple-system, sans-serif;",
    "  font-size: 11pt;",
    "  line-height: 1.15;",
    "  color: #37352f;",
    "  background: #fff;",
    "  margin: 0;",
    "  padding: 0;",
    "}",
    ".file-viewer-markdown { padding: 0; max-width: 100%; }",
    /* Headings — Notion style: black/near-black, bold, size hierarchy only */
    ".file-viewer-markdown h1 { font-size: 16pt; font-weight: 700; color: #1a1a1a; margin: 14pt 0 4pt; line-height: 1.25; page-break-after: avoid; break-after: avoid; }",
    ".file-viewer-markdown h2 { font-size: 13pt; font-weight: 700; color: #1a1a1a; margin: 12pt 0 3pt; line-height: 1.25; page-break-after: avoid; break-after: avoid; }",
    ".file-viewer-markdown h3 { font-size: 11pt; font-weight: 600; color: #1a1a1a; margin: 10pt 0 2pt; line-height: 1.25; page-break-after: avoid; break-after: avoid; }",
    ".file-viewer-markdown h4, .file-viewer-markdown h5, .file-viewer-markdown h6 { font-size: 11pt; font-weight: 600; color: #37352f; margin: 8pt 0 2pt; line-height: 1.25; page-break-after: avoid; break-after: avoid; }",
    /* Paragraphs & links — 8pt after (Word standard spacing) */
    ".file-viewer-markdown p { margin: 0 0 8pt; orphans: 3; widows: 3; }",
    ".file-viewer-markdown a { color: #37352f; text-decoration: underline; text-underline-offset: 2px; }",
    /* Lists */
    ".file-viewer-markdown ul, .file-viewer-markdown ol { padding-left: 36pt; margin: 0 0 8pt; }",
    ".file-viewer-markdown li { margin: 0 0 2pt; }",
    /* Inline code — Roboto Mono, Notion-style subtle red on light bg */
    ".file-viewer-markdown code { font-family: 'Roboto Mono', 'Courier New', monospace; font-size: 9pt; background: #f0eeec; padding: 1px 5px; border-radius: 3px; color: #eb5757; }",
    /* Code blocks — Roboto Mono, Notion warm gray */
    ".file-viewer-markdown pre { background: #f7f6f3; border: 1px solid #e8e7e3; border-radius: 4px; padding: 10pt 12pt; margin: 0 0 8pt; page-break-inside: avoid; break-inside: avoid; font-size: 9pt; line-height: 1.5; overflow-x: auto; }",
    ".file-viewer-markdown pre code { background: none; padding: 0; font-size: inherit; color: #37352f; border-radius: 0; }",
    /* Blockquote — Notion gray left bar, no italic */
    ".file-viewer-markdown blockquote { border-left: 3px solid #c7c5c2; padding-left: 10pt; margin: 0 0 8pt; color: #6b6860; font-style: normal; }",
    /* Tables — minimal, clean */
    ".file-viewer-markdown table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; page-break-inside: avoid; break-inside: avoid; font-size: 10pt; }",
    ".file-viewer-markdown th, .file-viewer-markdown td { border: 1px solid #e0dfdc; padding: 5pt 9pt; text-align: left; }",
    ".file-viewer-markdown th { background: #f7f6f3; font-weight: 600; color: #37352f; }",
    /* HR */
    ".file-viewer-markdown hr { border: none; border-top: 1px solid #e0dfdc; margin: 12pt 0; }",
    /* Images */
    ".file-viewer-markdown img, .pdf-mermaid-img { max-width: 100%; height: auto; display: block; margin: 8pt 0; page-break-inside: avoid; break-inside: avoid; }",
    /* hljs syntax colors — GitHub Light palette, no CSS vars */
    ".hljs { color: #24292e; background: transparent; }",
    ".hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }",
    ".hljs-keyword, .hljs-selector-tag, .hljs-operator { color: #d73a49; font-weight: 600; }",
    ".hljs-string, .hljs-doctag { color: #032f62; }",
    ".hljs-number, .hljs-literal, .hljs-boolean { color: #005cc5; }",
    ".hljs-title, .hljs-title.function_, .hljs-section { color: #6f42c1; }",
    ".hljs-variable, .hljs-template-variable, .hljs-params { color: #e36209; }",
    ".hljs-type, .hljs-title.class_, .hljs-title.class_.inherited__ { color: #6f42c1; }",
    ".hljs-built_in { color: #005cc5; }",
    ".hljs-tag, .hljs-name { color: #22863a; }",
    ".hljs-attr, .hljs-attribute { color: #005cc5; }",
    ".hljs-regexp, .hljs-link { color: #032f62; }",
    ".hljs-meta, .hljs-meta .hljs-keyword { color: #6a737d; }",
    ".hljs-symbol, .hljs-bullet { color: #e36209; }",
    ".hljs-addition { color: #22863a; background: #f0fff4; }",
    ".hljs-deletion { color: #b31d28; background: #ffeef0; }",
    ".hljs-emphasis { font-style: italic; }",
    ".hljs-strong { font-weight: 700; }",
    ".hljs-punctuation { color: #555; }",
    ".hljs-property { color: #005cc5; }",
    "@media print {",
    "  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
    "}"
  ].join("\n");
}
