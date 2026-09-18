var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var shared = fs.readFileSync(path.join(root, "lib/public/modules/session-creation-cta.js"), "utf8");
var desktop = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
var mobile = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
var desktopCss = fs.readFileSync(path.join(root, "lib/public/css/sidebar.css"), "utf8");
var mobileCss = fs.readFileSync(path.join(root, "lib/public/css/mobile-nav.css"), "utf8");

test("desktop and mobile use the shared labeled session creation control", function () {
  assert.match(shared, /textContent = "Create session"/);
  assert.match(shared, /session-create-provider-label">AI provider/);
  assert.match(shared, /aria-expanded", "false"/);
  assert.doesNotMatch(shared, /aria-haspopup/);
  assert.match(desktop, /renderSessionCreationCta\(\{/);
  assert.match(mobile, /renderSessionCreationCta\(\{/);
  assert.doesNotMatch(desktop, /split-chevron/);
  assert.doesNotMatch(mobile, /mobile-session-new-chevron/);
});

test("provider menus state immediate creation and keep defaults separate", function () {
  assert.match(desktop, /isInstalled \? "Create with " : "Learn about "/);
  assert.match(mobile, /isInstalled \? "Create with " : "Learn about "/);
  assert.match(desktop, /className = "session-new-set-default"/);
  assert.match(mobile, /className = "mobile-vendor-set-default"/);
  assert.match(desktop, /anchorBtn\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(desktop, /anchor\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(mobile, /controls\.providerButton\.setAttribute\("aria-expanded", opening \? "true" : "false"\)/);
  assert.doesNotMatch(desktop, /role", "menu(?:item)?"/);
  assert.doesNotMatch(mobile, /role", "menu(?:item)?"/);
});

test("compact controls have bounded flex sizing for narrow desktop and mobile", function () {
  assert.match(desktopCss, /\.session-top-action-split\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(desktopCss, /\.session-top-action-split \.split-main\s*\{[^}]*flex:\s*1 1 110px[^}]*white-space:\s*nowrap/s);
  assert.match(desktopCss, /\.session-top-action-split \.split-provider\s*\{[^}]*flex:\s*1 1 104px[^}]*min-width:\s*104px/s);
  assert.match(desktopCss, /\.session-create-provider-name\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s);
  assert.match(mobileCss, /\.mobile-session-new-row \.mobile-session-new-provider\s*\{[^}]*flex:\s*0 1 132px[^}]*min-width:\s*104px/s);
  assert.match(mobileCss, /\.mobile-session-new-row\s*\{[^}]*display:\s*flex/s);
});
