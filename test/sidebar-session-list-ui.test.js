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

test("volatile session frames patch the sidebar in place instead of rebuilding it", function () {
  var listStart = source.indexOf("export function renderSessionList(sessions)");
  var listEnd = source.indexOf("// --- Search results ---", listStart);
  assert.ok(listStart >= 0 && listEnd > listStart);
  var listSource = source.slice(listStart, listEnd);

  // The volatile short-circuit must run before the DOM is cleared: a rebuild
  // drops the hovered row's :hover, flashing the row action icons whenever any
  // session is streaming.
  var structureCheck = listSource.indexOf("structure === lastStructureFingerprint");
  var domClear = listSource.indexOf('getSessionListEl().innerHTML = ""');
  assert.ok(structureCheck >= 0, "renderSessionList compares the structural fingerprint");
  assert.ok(domClear > structureCheck, "the structural check happens before the rebuild");
  assert.match(listSource, /applyVolatileSessionUpdates\(sessions\);\s*\n\s*lastRenderFingerprint = incoming;\s*\n\s*return;/);
  assert.match(listSource, /lastStructureFingerprint = sessionStructureFingerprint\(cachedSessions\);/);

  // The structural fingerprint ignores exactly the volatile fields but keeps
  // the relative activity order so a reordering frame still rebuilds.
  var fpStart = source.indexOf("function sessionStructureFingerprint(sessions)");
  var fpEnd = source.indexOf("function applyVolatileSessionUpdates", fpStart);
  assert.ok(fpStart >= 0 && fpEnd > fpStart);
  var fpSource = source.slice(fpStart, fpEnd);
  assert.match(fpSource, /delete copy\.lastActivity;/);
  assert.match(fpSource, /delete copy\.unread;/);
  assert.match(fpSource, /\(b\.lastActivity \|\| 0\) - \(a\.lastActivity \|\| 0\)/);

  // In-place updates reuse the existing live badge path and refresh tooltips.
  var applyStart = source.indexOf("function applyVolatileSessionUpdates(sessions)");
  var applyEnd = source.indexOf("export function renderSessionList", applyStart);
  var applySource = source.slice(applyStart, applyEnd);
  assert.match(applySource, /updateSessionBadge\(s\.id, s\.unread \|\| 0\)/);
  assert.match(applySource, /formatSessionActivity\(s\.lastActivity\)/);
});

test("an unchanged split_groups broadcast does not rebuild the session list", function () {
  var boundary = fs.readFileSync(path.join(root, "lib/public/modules/split-session-boundary.js"), "utf8");
  var applyStart = boundary.indexOf("export function applyProjectSplitGroups(groups)");
  assert.ok(applyStart >= 0);
  var applySource = boundary.slice(applyStart);
  assert.match(applySource, /JSON\.stringify\(store\.get\('splitGroups'\) \|\| \[\]\) === JSON\.stringify\(next\)\) return false;/);
  assert.match(applySource, /return true;/);

  var messages = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.match(messages, /if \(applyProjectSplitGroups\(msg\.groups \|\| \[\]\)\) \{\s*\n\s*renderSessionList\(null\);/);
});
