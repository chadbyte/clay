var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Clay Studio ships a branded light and dark theme pair", function() {
  var light = JSON.parse(read("lib/themes/clay-light.json"));
  var dark = JSON.parse(read("lib/themes/clay-dark.json"));

  assert.strictEqual(light.name, "Clay Studio Light");
  assert.strictEqual(light.variant, "light");
  assert.strictEqual(light.base09.toLowerCase(), "5857fc");
  assert.strictEqual(light.accent2.toLowerCase(), "07e5a3");
  assert.strictEqual(light.link.toLowerCase(), "4948b8");

  assert.strictEqual(dark.name, "Clay Studio Dark");
  assert.strictEqual(dark.variant, "dark");
  assert.strictEqual(dark.accent2.toLowerCase(), "07e5a3");
  assert.strictEqual(dark.link.toLowerCase(), "7f7ec8");
});

test("Clay Studio themes are the default system-mode pair", function() {
  var source = read("lib/public/modules/theme.js");

  assert.match(source, /DEFAULT_DARK_THEME_ID = "clay-dark"/);
  assert.match(source, /DEFAULT_LIGHT_THEME_ID = "clay-light"/);
  assert.match(source, /loadThemes\(\)\.then\(loadAppearance\)/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
  assert.match(source, /pinFirst\(darkIds, DEFAULT_DARK_THEME_ID\)/);
  assert.match(source, /pinFirst\(lightIds, DEFAULT_LIGHT_THEME_ID\)/);
});

test("the default terminal and session TUI palette remains Clay Studio Dark", function() {
  var source = read("lib/public/modules/theme.js");
  var terminalCss = read("lib/public/css/filebrowser.css");
  var tuiCss = read("lib/public/css/tui-attention.css");

  assert.match(source, /getTerminalTheme\(\)[\s\S]*getTheme\(DEFAULT_DARK_THEME_ID\)/);
  assert.match(source, /var termTheme = getTerminalTheme\(\)/);
  assert.match(terminalCss, /#terminal-body[\s\S]*background: #141412/);
  assert.match(terminalCss, /\.term-toolbar[\s\S]*background: var\(--bg-alt\)/);
  assert.doesNotMatch(terminalCss, /#terminal-container,\s*\.terminal-tab-ctx/);
  assert.match(tuiCss, /\.tui-modal[\s\S]*background: var\(--bg\)/);
});

test("theme selection lives in Appearance settings", function() {
  var index = read("lib/public/index.html");
  var themeSource = read("lib/public/modules/theme.js");
  var settingsSource = read("lib/public/modules/user-settings.js");

  assert.doesNotMatch(index, /id="user-theme-toggle-btn"/);
  assert.match(index, /data-section="us-appearance"[\s\S]*id="us-theme-picker"/);
  assert.match(themeSource, /export function mountThemePicker\(container\)/);
  assert.match(settingsSource, /initPersonalAppearance\(\)/);
});

test("initial app and auth surfaces use the Clay Studio palettes", function() {
  var css = read("lib/public/css/base.css");
  var messagesCss = read("lib/public/css/messages.css");
  var index = read("lib/public/index.html");
  var pages = read("lib/pages.js");

  assert.match(css, /--bg: #171715/);
  assert.match(css, /:root\.light-theme/);
  assert.match(css, /--accent: #5857fc/);
  assert.match(index, /name="theme-color" content="#171715"/);
  assert.match(pages, /themes", "clay-light\.json"/);
  assert.match(pages, /themes", "clay-dark\.json"/);
  assert.match(pages, /prefers-color-scheme:dark/);
  assert.match(messagesCss, /\.md-content a \{[\s\S]*color: var\(--link\)/);
  assert.match(messagesCss, /\.md-content a:hover \{[\s\S]*color: var\(--link-hover\)/);
});
