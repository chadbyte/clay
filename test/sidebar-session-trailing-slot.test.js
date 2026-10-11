var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");

function loadPlaywright() {
  try { return require("playwright"); } catch (error) { return null; }
}

test("desktop session actions overlay without reserving title width", async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip("Playwright is not installed"); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip("Chromium is not available: " + error.message); return; }
  t.after(async function () { await browser.close(); });

  var page = await browser.newPage({ viewport: { width: 280, height: 180 } });
  await page.setContent('<div class="session-item" data-session-id="1">' +
    '<span class="session-item-text">A deliberately long session title that truncates</span>' +
    '<span class="session-row-trailing">' +
    '<span class="session-row-actions">' +
        '<button class="session-folder-star-btn is-favorite" aria-label="Remove from Favorites">★</button>' +
        '<button class="session-close-btn" aria-label="Delete session">×</button>' +
      '</span>' +
    '</span>' +
  '</div>');
  await page.addStyleTag({ path: path.join(__dirname, "../lib/public/css/sidebar.css") });
  await page.addStyleTag({ path: path.join(__dirname, "../lib/public/css/session-folders.css") });
  await page.mouse.move(279, 179);
  await page.waitForTimeout(180);

  var resting = await page.evaluate(function () {
    var row = document.querySelector(".session-item");
    var slot = row.querySelector(".session-row-trailing");
    var age = row.querySelector(".session-item-age");
    var actions = row.querySelector(".session-row-actions");
    return {
      titleWidth: row.querySelector(".session-item-text").getBoundingClientRect().width,
      actionWidth: actions.getBoundingClientRect().width,
      agePresent: !!age,
      titleAttr: row.querySelector(".session-item-text").getAttribute("title"),
      starOpacity: getComputedStyle(row.querySelector(".session-folder-star-btn")).opacity,
      closeOpacity: getComputedStyle(row.querySelector(".session-close-btn")).opacity,
    };
  });
  assert.equal(resting.agePresent, false);
  assert.equal(resting.titleAttr, null);
  assert.equal(resting.starOpacity, "0");
  assert.equal(resting.closeOpacity, "0");
  var reservedTitleWidth = await page.evaluate(function () {
    var row = document.querySelector(".session-item");
    var trailing = row.querySelector(".session-row-trailing");
    var title = row.querySelector(".session-item-text");
    var originalWidth = trailing.style.width;
    var originalFlex = trailing.style.flex;
    var actions = trailing.querySelector(".session-row-actions");
    var originalActionsPosition = actions.style.position;
    trailing.style.position = "static";
    trailing.style.width = "auto";
    trailing.style.flex = "0 0 auto";
    actions.style.position = "static";
    var width = title.getBoundingClientRect().width;
    trailing.style.position = "";
    trailing.style.width = originalWidth;
    trailing.style.flex = originalFlex;
    actions.style.position = originalActionsPosition;
    return width;
  });
  assert.ok(resting.titleWidth > reservedTitleWidth + 1);

  await page.locator(".session-item").hover();
  await page.waitForTimeout(180);
  var hover = await page.evaluate(function () {
    var row = document.querySelector(".session-item");
    return {
      titleWidth: row.querySelector(".session-item-text").getBoundingClientRect().width,
      agePresent: !!row.querySelector(".session-item-age"),
      titleAttr: row.querySelector(".session-item-text").getAttribute("title"),
      starOpacity: getComputedStyle(row.querySelector(".session-folder-star-btn")).opacity,
      closeOpacity: getComputedStyle(row.querySelector(".session-close-btn")).opacity,
    };
  });
  assert.equal(hover.agePresent, false);
  assert.equal(hover.titleAttr, null);
  assert.ok(Number(hover.starOpacity) > 0);
  assert.ok(Number(hover.closeOpacity) > 0);
  assert.ok(Math.abs(hover.titleWidth - resting.titleWidth) < 0.5);

  await page.mouse.move(0, 0);
  await page.locator(".session-folder-star-btn").focus();
  await page.waitForTimeout(180);
  var focus = await page.evaluate(function () {
    var row = document.querySelector(".session-item");
    return {
      titleWidth: row.querySelector(".session-item-text").getBoundingClientRect().width,
      agePresent: !!row.querySelector(".session-item-age"),
      starOpacity: getComputedStyle(row.querySelector(".session-folder-star-btn")).opacity,
    };
  });
  assert.equal(focus.agePresent, false);
  assert.ok(Number(focus.starOpacity) > 0);
  assert.ok(Math.abs(focus.titleWidth - resting.titleWidth) < 0.5);

  await page.emulateMedia({ reducedMotion: "reduce" });
  var transitions = await page.evaluate(function () {
    var row = document.querySelector(".session-item");
    return [".session-folder-star-btn", ".session-close-btn"].map(function (selector) {
      return getComputedStyle(row.querySelector(selector)).transitionDuration;
    });
  });
  assert.deepEqual(transitions, ["0s", "0s"]);
});
