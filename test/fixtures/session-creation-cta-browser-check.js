var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var sessionName = "clay-cta-check-" + process.pid;
var serverPath = path.join(__dirname, "session-creation-cta-server.js");
var outputDir = process.argv[2] || path.join(os.tmpdir(), "clay-session-cta-browser");
var server = null;

function browser(args, capture) {
  var command = ["agent-browser", "--session", sessionName].concat(args);
  var output = childProcess.execFileSync("npx", command, {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "ignore", "inherit"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function evaluate(expression) {
  var value = JSON.parse(browser(["eval", expression], true));
  if (typeof value === "string" && (/^[\[{]/).test(value)) return JSON.parse(value);
  return value;
}

function waitForServer(child) {
  return new Promise(function (resolve, reject) {
    var buffer = "";
    function onData(chunk) {
      buffer += chunk.toString();
      var newline = buffer.indexOf("\n");
      if (newline === -1) return;
      child.stdout.off("data", onData);
      resolve(buffer.slice(0, newline).trim());
    }
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", function (code) {
      if (code !== null && code !== 0) reject(new Error("Fixture server exited with " + code));
    });
  });
}

function pngDimensions(file) {
  var data = fs.readFileSync(file);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function openAt(url, width, height) {
  browser(["set", "viewport", String(width), String(height)], false);
  browser(["open", url], false);
  browser(["wait", "500"], false);
  assert.equal(evaluate("!!document.querySelector('.session-create-primary')"), true);
  var viewport = evaluate("JSON.stringify({width:window.innerWidth,height:window.innerHeight})");
  assert.deepEqual(viewport, { width: width, height: height });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  server = childProcess.spawn(process.execPath, [serverPath], { stdio: ["ignore", "pipe", "inherit"] });
  var url = await waitForServer(server);
  try {
    openAt(url, 1280, 800);
    var desktopProvider = evaluate("JSON.stringify((function(){var row=document.querySelector('.fixture-sidebar .session-create-cta');var button=row.querySelector('.session-create-provider');var primary=row.querySelector('.session-create-primary');var buttons=row.querySelectorAll('button');return {text:button.textContent.trim(),label:button.getAttribute('aria-label'),title:button.title,primary:primary.textContent.trim(),chevron:!!button.querySelector('.session-create-provider-chevron'),domOrder:buttons[0]===primary && buttons[1]===button,primaryLeft:primary.getBoundingClientRect().left,providerRight:button.getBoundingClientRect().right,providerIcon:!!primary.querySelector('.session-create-provider-icon')};})())");
    assert.equal(desktopProvider.text, "");
    assert.match(desktopProvider.label, /Switch AI provider \(current: Codex\)/);
    assert.match(desktopProvider.title, /current: Codex/);
    assert.equal(desktopProvider.primary, "Create new Codex session");
    assert.equal(desktopProvider.chevron, true);
    assert.equal(desktopProvider.domOrder, true);
    assert.equal(desktopProvider.providerIcon, true);
    assert.equal(desktopProvider.primaryLeft < desktopProvider.providerRight, true);
    evaluate("document.querySelector('.fixture-sidebar .session-create-primary').focus();true");
    browser(["press", "Tab"], false);
    assert.equal(evaluate("document.activeElement===document.querySelector('.fixture-sidebar .session-create-provider')"), true);
    var desktopMain = evaluate("window.fixtureMessages.splice(0);document.querySelector('.fixture-sidebar .session-create-primary').click();JSON.stringify(window.fixtureMessages)");
    assert.deepEqual(desktopMain, [{ type: "new_session", vendor: "codex" }]);
    evaluate("document.querySelector('.fixture-sidebar .session-create-provider').focus();document.querySelector('.fixture-sidebar .session-create-provider').click();true");
    browser(["wait", "100"], false);
    var desktopDisclosure = evaluate("JSON.stringify({messages:window.fixtureMessages,expanded:document.querySelector('.fixture-sidebar .session-create-provider').getAttribute('aria-expanded'),active:document.activeElement.textContent.trim()})");
    assert.equal(desktopDisclosure.messages.length, 1);
    assert.equal(desktopDisclosure.expanded, "true");
    assert.match(desktopDisclosure.active, /^Create with Claude Code/);
    browser(["press", "Escape"], false);
    var desktopEscape = evaluate("JSON.stringify({expanded:document.querySelector('.fixture-sidebar .session-create-provider').getAttribute('aria-expanded'),focused:document.activeElement===document.querySelector('.fixture-sidebar .session-create-provider')})");
    assert.deepEqual(desktopEscape, { expanded: "false", focused: true });
    evaluate("document.querySelector('.fixture-sidebar .session-create-provider').click();document.querySelector('.session-new-vendor').click();true");
    assert.deepEqual(evaluate("JSON.stringify(window.fixtureMessages)"), [
      { type: "new_session", vendor: "codex" },
      { type: "new_session", vendor: "claude" },
    ]);

    openAt(url, 1280, 800);
    evaluate("document.querySelector('.fixture-sidebar .session-create-provider').click();document.querySelector('.session-new-set-default').click();true");
    var defaultMessages = evaluate("JSON.stringify(window.fixtureMessages)");
    assert.equal(defaultMessages.length, 1);
    assert.equal(defaultMessages[0].type, "default_vendor_set");
    assert.equal(defaultMessages[0].vendor, "claude");
    var desktop240 = evaluate("JSON.stringify((function(){var side=document.querySelector('.fixture-sidebar');var row=side.querySelector('.session-create-cta');var main=side.querySelector('.session-create-primary');var range=document.createRange();range.selectNodeContents(main.querySelector('span'));var lineHeight=parseFloat(getComputedStyle(main).lineHeight);return {fits:side.scrollWidth<=side.clientWidth,rowFits:row.scrollWidth<=row.clientWidth,mainFits:main.scrollWidth<=main.clientWidth,whiteSpace:getComputedStyle(main).whiteSpace,mainHeight:Math.round(main.getBoundingClientRect().height),textHeight:range.getBoundingClientRect().height,textLines:Math.round(range.getBoundingClientRect().height/lineHeight)};})())");
    assert.equal(desktop240.fits, true);
    assert.equal(desktop240.rowFits, true);
    assert.equal(desktop240.mainFits, true);
    assert.equal(desktop240.whiteSpace, "normal");
    assert.equal(desktop240.textLines, 1);
    assert.ok(desktop240.textHeight <= desktop240.mainHeight);
    var desktop192 = evaluate("document.querySelector('.fixture-page').style.gridTemplateColumns='192px minmax(0,1fr)';JSON.stringify((function(){var side=document.querySelector('.fixture-sidebar');var row=side.querySelector('.session-create-cta');var main=side.querySelector('.session-create-primary');var provider=side.querySelector('.session-create-provider');return {fits:side.scrollWidth<=side.clientWidth,rowFits:row.scrollWidth<=row.clientWidth,mainFits:main.scrollWidth<=main.clientWidth,stacked:provider.getBoundingClientRect().top>main.getBoundingClientRect().top,mainHeight:Math.round(main.getBoundingClientRect().height),mainWidth:Math.round(main.getBoundingClientRect().width),providerWidth:Math.round(provider.getBoundingClientRect().width)};})())");
    assert.equal(desktop192.fits, true);
    assert.equal(desktop192.rowFits, true);
    assert.equal(desktop192.mainFits, true);
    assert.equal(desktop192.stacked, false);
    assert.ok(desktop192.mainHeight >= 34);
    openAt(url + "?vendor=antigravity", 192, 800);
    var longVendor = evaluate("JSON.stringify((function(){var side=document.querySelector('.fixture-sidebar');var main=side.querySelector('.session-create-primary');var provider=side.querySelector('.session-create-provider');var range=document.createRange();range.selectNodeContents(main.querySelector('span'));return {text:main.textContent.trim(),fits:side.scrollWidth<=side.clientWidth,rowFits:main.parentElement.scrollWidth<=main.parentElement.clientWidth,readable:range.getBoundingClientRect().height<=main.clientHeight,providerRight:provider.getBoundingClientRect().right,mainRight:main.getBoundingClientRect().right};})())");
    assert.equal(longVendor.text, "Create new Antigravity session");
    assert.equal(longVendor.fits, true);
    assert.equal(longVendor.rowFits, true);
    assert.equal(longVendor.readable, true);
    assert.ok(longVendor.mainRight <= longVendor.providerRight);
    openAt(url, 1280, 800);
    evaluate("document.querySelector('.fixture-page').style.gridTemplateColumns='240px minmax(0,1fr)';document.documentElement.classList.remove('light-theme');true");
    var desktopDark = path.join(outputDir, "desktop-1280x800-dark.png");
    browser(["screenshot", "body", desktopDark], false);
    evaluate("document.documentElement.classList.add('light-theme');true");
    var desktopLight = path.join(outputDir, "desktop-1280x800-light.png");
    browser(["screenshot", "body", desktopLight], false);
    assert.deepEqual(pngDimensions(desktopDark), { width: 1280, height: 800 });
    assert.deepEqual(pngDimensions(desktopLight), { width: 1280, height: 800 });

    openAt(url, 390, 844);
    var mobileMain = evaluate("window.fixtureMessages.splice(0);document.querySelector('#mobile-fixture .session-create-primary').click();JSON.stringify(window.fixtureMessages)");
    assert.deepEqual(mobileMain, [{ type: "new_session", vendor: "codex" }]);
    evaluate("document.querySelector('#mobile-fixture .session-create-provider').focus();document.querySelector('#mobile-fixture .session-create-provider').click();true");
    browser(["wait", "100"], false);
    var mobileDisclosure = evaluate("JSON.stringify({messages:window.fixtureMessages,expanded:document.querySelector('#mobile-fixture .session-create-provider').getAttribute('aria-expanded'),fits:document.getElementById('mobile-actions').scrollWidth<=document.getElementById('mobile-actions').clientWidth})");
    assert.equal(mobileDisclosure.messages.length, 1);
    assert.equal(mobileDisclosure.expanded, "true");
    assert.equal(mobileDisclosure.fits, true);
    browser(["press", "Escape"], false);
    var mobileEscape = evaluate("JSON.stringify({expanded:document.querySelector('#mobile-fixture .session-create-provider').getAttribute('aria-expanded'),focused:document.activeElement===document.querySelector('#mobile-fixture .session-create-provider')})");
    assert.deepEqual(mobileEscape, { expanded: "false", focused: true });
    evaluate("document.querySelector('#mobile-fixture .session-create-provider').click();document.querySelector('#mobile-session-provider-menu .mobile-session-new-vendor').click();true");
    assert.deepEqual(evaluate("JSON.stringify(window.fixtureMessages)"), [
      { type: "new_session", vendor: "codex" },
      { type: "new_session", vendor: "claude" },
    ]);
    openAt(url, 390, 844);
    evaluate("document.querySelector('#mobile-fixture .session-create-provider').click();document.querySelector('#mobile-session-provider-menu .mobile-vendor-set-default').click();true");
    var mobileDefault = evaluate("JSON.stringify(window.fixtureMessages)");
    assert.equal(mobileDefault.length, 1);
    assert.equal(mobileDefault[0].type, "default_vendor_set");
    assert.equal(mobileDefault[0].vendor, "claude");
    browser(["press", "Escape"], false);
    evaluate("document.documentElement.classList.remove('light-theme');true");
    var mobileDark = path.join(outputDir, "mobile-390x844-dark.png");
    browser(["screenshot", "body", mobileDark], false);
    evaluate("document.documentElement.classList.add('light-theme');true");
    var mobileLight = path.join(outputDir, "mobile-390x844-light.png");
    browser(["screenshot", "body", mobileLight], false);
    assert.deepEqual(pngDimensions(mobileDark), { width: 390, height: 844 });
    assert.deepEqual(pngDimensions(mobileLight), { width: 390, height: 844 });

    process.stdout.write(JSON.stringify({
      desktop: { viewport: "1280x800", minimumSidebar: 192, payloads: "passed", focus: "passed", overflow: "passed" },
      mobile: { viewport: "390x844", payloads: "passed", focus: "passed", overflow: "passed" },
      screenshots: [desktopDark, desktopLight, mobileDark, mobileLight],
    }) + "\n");
  } finally {
    try { browser(["close"], false); } catch (error) {}
    if (server && server.exitCode === null) server.kill("SIGTERM");
  }
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
});
