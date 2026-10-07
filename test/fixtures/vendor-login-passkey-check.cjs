// Run explicitly: verify remote passkey suppression in real Chrome without account credentials.
var assert = require("node:assert/strict");
var chromium = require("playwright").chromium;
var disableLoginPasskeys = require("../../lib/vendor-login-browser-passkeys").disableLoginPasskeys;

async function inspect(target) {
  return target.evaluate(async function () {
    var result = { available: typeof PublicKeyCredential !== "undefined" };
    for (var method of ["get", "create"]) {
      try {
        await navigator.credentials[method]({ publicKey: { challenge: new Uint8Array([1, 2, 3]) } });
        result[method] = "unexpected-success";
      } catch (error) { result[method] = error.name; }
    }
    return result;
  });
}

(async function () {
  var browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
  try {
    var context = await browser.newContext();
    await context.addInitScript(disableLoginPasskeys);
    await context.route("https://fixture.test/**", function (route) {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><script>window.initialPasskeyAvailable=typeof PublicKeyCredential!=="undefined";</script><button onclick="window.open(\'/popup\')">Popup</button><iframe src="/frame"></iframe>' });
    });
    // Avoid recursively nesting fixture frames.
    await context.route("https://fixture.test/frame", function (route) {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><p>Frame</p>' });
    });
    var page = await context.newPage();
    await page.goto("https://fixture.test/");
    assert.strictEqual(await page.evaluate(function () { return window.initialPasskeyAvailable; }), false);
    var expected = { available: false, get: "NotSupportedError", create: "NotSupportedError" };
    assert.deepEqual(await inspect(page), expected);
    assert.deepEqual(await inspect(page.frames()[1]), expected);
    var popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Popup" }).click();
    var popup = await popupPromise;
    await popup.waitForLoadState();
    assert.deepEqual(await inspect(popup), expected);
    await page.reload();
    assert.deepEqual(await inspect(page), expected);
    // Prove delegation preserves non-WebAuthn calls and never invokes native WebAuthn.
    var control = await browser.newPage();
    await control.route("https://fixture.test/**", function (route) { return route.fulfill({ contentType: "text/html", body: "<!doctype html>" }); });
    await control.goto("https://fixture.test/control");
    await control.evaluate(function () {
      window.nativeCredentialCalls = 0;
      CredentialsContainer.prototype.get = function () { window.nativeCredentialCalls++; return Promise.resolve("native-get"); };
      CredentialsContainer.prototype.create = function () { window.nativeCredentialCalls++; return Promise.resolve("native-create"); };
    });
    await control.evaluate(disableLoginPasskeys);
    assert.deepEqual(await inspect(control), expected);
    assert.deepEqual(await control.evaluate(async function () {
      return { get: await navigator.credentials.get({ password: true }),
        create: await navigator.credentials.create({ password: {} }), calls: window.nativeCredentialCalls };
    }), { get: "native-get", create: "native-create", calls: 2 });
    console.log("PASS: passkeys rejected before native calls in pages, frames, popups and reloads; other credential calls preserved");
  } finally { await browser.close(); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
