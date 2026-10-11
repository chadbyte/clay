var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var css = fs.readFileSync(path.join(root, "lib/public/css/sidebar.css"), "utf8");
var folderCss = fs.readFileSync(path.join(root, "lib/public/css/session-folders.css"), "utf8");
var source = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
var renderStart = source.indexOf("function renderSessionItem(s, options)");
var renderEnd = source.indexOf("function renderSplitGroupItem", renderStart);
var renderSource = source.slice(renderStart, renderEnd);

test("session rows separate title, native activity title, and row actions", function () {
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.doesNotMatch(renderSource, /vendorIcon|session-vendor-hover-icon/);
  assert.doesNotMatch(renderSource, /split-group-vendor/);
  assert.match(renderSource, /formatSessionActivity\(s\.lastActivity\)/);
  assert.match(renderSource, /titleEl\.title = activityTitle/);
  assert.doesNotMatch(renderSource, /age\.className = "session-item-age"/);
  assert.match(renderSource, /trailing\.className = "session-row-trailing"/);
  assert.ok(renderSource.indexOf("trailing.appendChild(actions)") >= 0);
  assert.doesNotMatch(folderCss, /session-vendor-hover-icon|mobile-vendor-hover-icon/);
  assert.doesNotMatch(css, /session-vendor-mark|split-group-vendor-actions/);
  assert.match(folderCss, /\.mobile-session-item:hover \.mobile-session-star/);
  assert.match(folderCss, /\.mobile-session-item:focus-within \.mobile-session-star/);
});

test("desktop and mobile Mate rows suppress provider marks without removing Worker identity", function () {
  var mobile = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
  var mobileStart = mobile.indexOf("function createMobileSessionItem(s, options)");
  var mobileEnd = mobile.indexOf("function createMobileDriverHierarchy", mobileStart);
  var mobileSource = mobile.slice(mobileStart, mobileEnd);
  assert.match(mobileSource, /mobileActions\.className = "mobile-session-actions"/);
  assert.doesNotMatch(mobileSource, /vendorIcon|mobile-vendor-hover-icon/);
  assert.match(renderSource, /if \(itemOptions\.worker\)[\s\S]*session-worker-generation/);
  assert.match(mobileSource, /if \(itemOptions\.worker\)[\s\S]*mobile-worker-generation/);
});

test("active sessions use a quiet tint without adding another left edge", function () {
  assert.match(css, /\.session-item\.active\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--link\) 7%, transparent\)/s);
  assert.doesNotMatch(css, /\.session-item\.active\s*\{[^}]*background:\s*var\(--sidebar-active\)/s);
  assert.doesNotMatch(css, /\.session-item\.active\s*\{[^}]*inset 2px 0 0/s);
  assert.match(css, /\.session-unread-badge\s*\{[^}]*background:\s*var\(--link\)/s);
});
