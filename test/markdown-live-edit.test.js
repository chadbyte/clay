var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

async function loadModule() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/markdown-live-edit.js"), "utf8");
  var url = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  return import(url);
}

test("Markdown live edit recognizes Markdown paths from single and multi-file tools", async function () {
  var liveEdit = await loadModule();
  assert.strictEqual(liveEdit.markdownPathFromToolInput({ file_path: "/work/guide.md" }), "/work/guide.md");
  assert.strictEqual(liveEdit.markdownPathFromToolInput({ file_path: "/work/app.js" }), null);
  assert.strictEqual(liveEdit.markdownPathFromToolInput({
    file_paths: ["/work/app.js", "/work/notes.mdx", "/work/readme.md"],
  }), "/work/notes.mdx");
  assert.strictEqual(liveEdit.markdownPathFromToolInput(null), null);
});

test("Markdown block diff keeps stable blocks and exposes replacements", async function () {
  var liveEdit = await loadModule();
  var matches = liveEdit.diffBlockSignatures(
    ["<h1>Title</h1>", "<p>Old copy</p>", "<p>Stable</p>"],
    ["<h1>Title</h1>", "<p>New copy</p>", "<p>Stable</p>"]
  );
  assert.deepStrictEqual(matches, [
    { oldIndex: 0, newIndex: 0 },
    { oldIndex: 2, newIndex: 2 },
  ]);
});

test("change tour gives every changed block a readable stop", async function () {
  var liveEdit = await loadModule();
  assert.strictEqual(liveEdit.changeTourDelay(""), 850);
  assert.ok(liveEdit.changeTourDelay("A substantial changed paragraph ".repeat(20)) > 850);
  assert.strictEqual(liveEdit.changeTourDelay("x".repeat(1000)), 1800);
});

test("message routing opens Markdown only from the explicit MCP presentation event", function () {
  var messages = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var liveEdit = fs.readFileSync(path.join(__dirname, "../lib/public/modules/markdown-live-edit.js"), "utf8");
  assert.match(messages, /case "markdown_edit_present":/);
  assert.match(messages, /presentMarkdownEdit\(msg\)/);
  assert.match(browser, /beginMarkdownPresentation\(msg\.path\)/);
  assert.match(messages, /!store\.get\('replayingHistory'\)/);
  assert.match(browser, /animateMarkdownChange\(markdownEl, previousMarkdown, currentContent, renderMarkdown\)/);
  assert.match(messages, /finishMarkdownTurn\(\)/);
  assert.doesNotMatch(liveEdit, /parseMarkdownEditIntent|cuePattern|turnIntent/);
});

test("file viewer presentation mode fills the shared workbench region and escapes before closing", function () {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");

  assert.match(browser, /setFileViewerFullscreen\(!store\.get\('fileViewerFullscreen'\)\)/);
  assert.match(browser, /if \(store\.get\('fileViewerFullscreen'\)\)[\s\S]*setFileViewerFullscreen\(false\);[\s\S]*return;[\s\S]*closeFileViewer\(\);/);
  var rule = css.match(/#file-viewer\.panel-fullscreen\s*\{([^}]*)\}/s)[1];
  assert.doesNotMatch(rule, /position:\s*fixed|inset:|z-index:/);
  assert.match(rule, /width:\s*100%[^}]*height:\s*100%/s);
  assert.match(css, /#file-viewer\.panel-fullscreen \.file-viewer-markdown\s*\{[^}]*width:\s*min\(100%, 1040px\)[^}]*margin:\s*0 auto/s);
});

test("Markdown H1 headings become navigable presentation slides", function () {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var slides = fs.readFileSync(path.join(__dirname, "../lib/public/modules/markdown-slides.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");

  assert.ok(html.includes('id="file-viewer-slides"'));
  assert.ok(html.includes('data-lucide="presentation"'));
  assert.match(slides, /tagName = "H" \+ normalizedLevel\(level\)/);
  assert.match(slides, /"ArrowRight"[^\n]*"ArrowDown"[^\n]*"PageDown"/);
  assert.match(slides, /aria-roledescription", "slide"/);
  assert.match(browser, /if \(enterMarkdownSlides\(markdownEl, 0\)\) setFileViewerFullscreen\(true\)/);
  assert.match(css, /\.markdown-slide\.active\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.markdown-slide > \*\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(css, /\.markdown-slide > \.mermaid-diagram\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.markdown-slide-controls\s*\{[^}]*position:\s*absolute/s);
});

test("slide breaks support selectable H1 through H3 levels with H2 auto-detection", function () {
  var slides = fs.readFileSync(path.join(__dirname, "../lib/public/modules/markdown-slides.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");

  assert.match(html, /id="file-viewer-slide-level"[^>]*aria-haspopup="menu"/);
  assert.match(slides, /parsed >= 1 && parsed <= 3/);
  assert.match(slides, /counts\[1\] === 1 && counts\[2\] > 1\) return 2/);
  assert.match(slides, /markdown-slide-level-option/);
  assert.match(slides, /markdown-slide-cover/);
  assert.match(slides, /headingTag = "H" \+ level/);
  assert.match(slides, /markdownSlidePreferredLevel/);
});

test("Markdown actions are available before rendered preview is enabled", function () {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");

  assert.match(browser, /function markdownElementForActions\(\)/);
  assert.match(browser, /preview\.innerHTML = renderMarkdown\(currentContent\)/);
  assert.match(browser, /function ensureRenderedMarkdown\(\)[\s\S]*isRendered = true;[\s\S]*renderBody\(\)/);
  assert.match(browser, /renderBtn\.title = "Render markdown";[\s\S]*pdfBtn\.classList\.remove\("hidden"\);[\s\S]*formattedCopyBtn\.classList\.remove\("hidden"\);[\s\S]*syncMarkdownSlidesButton\(markdownElementForActions\(\)\)/);
});
