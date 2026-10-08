var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

function loadPlaywright() {
  try { return require("playwright"); } catch (e) { return null; }
}

test("Home no-project overlay owns focus and restores covered workspace semantics exactly", async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip("Playwright is not installed"); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (e) { t.skip("Chromium is not available: " + e.message); return; }
  t.after(function () { return browser.close(); });
  var page = await browser.newPage();
  await page.setContent('<aside id="home-sidebar"><button id="home-sidebar-new">New Chat</button><button id="home-sidebar-debate">Debates</button><button id="home-tools-btn">Capsules</button><button id="home-nav-projects">Projects</button><div class="home-mate-list-row"><span id="mate-label">Mate</span></div></aside>' +
    '<section id="home-project-empty"><h1 id="home-project-empty-title" tabindex="-1">Start a new project</h1></section>' +
    '<div id="home-conversation-region"><button id="covered-action">Send</button></div>' +
    '<div id="home-dock-backdrop"></div><div id="home-dock-divider" inert aria-hidden="false"><button>Resize</button></div>' +
    '<section id="home-tool-workbench" aria-hidden="false"><button id="tool-action">Run</button></section>');
  var moduleSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-project-empty-access.js"), "utf8");
  moduleSource = moduleSource.replace(/export function /g, "function ") +
    '\nwindow.homeProjectEmptyAccess = { setCoverage: setHomeProjectEmptyCoverage, bindDismissal: bindHomeProjectEmptyDismissal };';
  await page.addScriptTag({ content: moduleSource });

  var covered = await page.evaluate(function () {
    var access = window.homeProjectEmptyAccess;
    var dismissed = 0;
    access.bindDismissal(document.getElementById("home-sidebar"), function () { dismissed++; });
    document.getElementById("covered-action").focus();
    access.setCoverage(document, true);
    document.getElementById("home-project-empty-title").focus();
    document.getElementById("covered-action").focus();
    document.getElementById("mate-label").click();
    document.getElementById("home-nav-projects").click();
    return {
      active: document.activeElement.id,
      conversationInert: document.getElementById("home-conversation-region").inert,
      conversationHidden: document.getElementById("home-conversation-region").getAttribute("aria-hidden"),
      toolInert: document.getElementById("home-tool-workbench").inert,
      toolHidden: document.getElementById("home-tool-workbench").getAttribute("aria-hidden"),
      dismissed: dismissed,
    };
  });
  assert.deepEqual(covered, {
    active: "home-project-empty-title",
    conversationInert: true,
    conversationHidden: "true",
    toolInert: true,
    toolHidden: "true",
    dismissed: 1,
  });

  var restored = await page.evaluate(function () {
    window.homeProjectEmptyAccess.setCoverage(document, false);
    document.getElementById("covered-action").focus();
    return {
      active: document.activeElement.id,
      conversationInert: document.getElementById("home-conversation-region").inert,
      conversationHasInert: document.getElementById("home-conversation-region").hasAttribute("inert"),
      conversationHidden: document.getElementById("home-conversation-region").getAttribute("aria-hidden"),
      dividerInert: document.getElementById("home-dock-divider").inert,
      dividerHasInert: document.getElementById("home-dock-divider").hasAttribute("inert"),
      dividerHidden: document.getElementById("home-dock-divider").getAttribute("aria-hidden"),
      toolInert: document.getElementById("home-tool-workbench").inert,
      toolHidden: document.getElementById("home-tool-workbench").getAttribute("aria-hidden"),
    };
  });
  assert.deepEqual(restored, {
    active: "covered-action",
    conversationInert: false,
    conversationHasInert: false,
    conversationHidden: null,
    dividerInert: true,
    dividerHasInert: true,
    dividerHidden: "false",
    toolInert: false,
    toolHidden: "false",
  });
});
