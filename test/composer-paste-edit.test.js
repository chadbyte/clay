var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var inputSource = fs.readFileSync(path.join(root, "lib/public/modules/input.js"), "utf8");
var modalSource = fs.readFileSync(path.join(root, "lib/public/modules/paste-modal.js"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var miscSource = fs.readFileSync(path.join(root, "lib/public/modules/app-misc.js"), "utf8");
var cardsSource = fs.readFileSync(path.join(root, "lib/public/modules/app-message-cards.js"), "utf8");
var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var css = fs.readFileSync(path.join(root, "lib/public/css/input.css"), "utf8");

test("composer paste chips open the shared dialog in editable mode", function () {
  assert.match(inputSource, /import \{ showPasteModal \} from '\.\/paste-modal\.js';/);
  assert.match(inputSource, /showPasteModal\(pendingPastes\[idx\]\.text, sessionCallback\(function \(text\)/);
  assert.match(inputSource, /pendingPastes\[idx\] = \{ text: text, preview: pastePreview\(text\) \}/);
  assert.match(inputSource, /openBtn\.setAttribute\("aria-label", "Edit pasted content"\)/);
  assert.match(inputSource, /openBtn\.addEventListener\("click", function \(\) \{\s*editPendingPaste\(idx\)/s);
});

test("editing a paste does not trigger the global long-paste capture", function () {
  assert.match(inputSource, /target\.closest\("[^"]*#paste-modal[^"]*"\)/);
});

test("paste dialog keeps history read-only and exposes explicit composer save controls", function () {
  assert.match(modalSource, /var editing = typeof onSave === "function"/);
  assert.match(modalSource, /editing \? "Edit pasted content" : "Pasted content"/);
  assert.match(modalSource, /callback\(value\)/);
  assert.match(modalSource, /event\.key === "Escape"/);
  assert.match(html, /id="paste-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /<textarea[^>]*id="paste-modal-editor"/);
  assert.match(html, /id="paste-modal-save"[^>]*>Save changes<\/button>/);
  assert.match(css, /\.paste-modal-editor,\s*\.paste-modal-footer \{ display: none; \}/);
  assert.match(css, /\.paste-modal-editing \.paste-modal-editor \{/);
});

test("all paste surfaces use one modal implementation without native dialogs", function () {
  assert.match(cardsSource, /from '\.\/paste-modal\.js'/);
  assert.match(appSource, /from '\.\/modules\/paste-modal\.js'/);
  assert.match(miscSource, /initPasteModal\(\)/);
  assert.doesNotMatch([inputSource, modalSource, appSource, miscSource, cardsSource].join("\n"), /\b(?:alert|confirm|prompt)\s*\(/);
});
