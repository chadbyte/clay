var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var browserModule = require("../lib/vendor-login-browser");

function authUrl(host, callback) {
  return "https://" + host + "/oauth/authorize?state=fixture&code_challenge=fixture&redirect_uri=" + encodeURIComponent(callback || "http://localhost:1455/auth/callback");
}

test("only provider OAuth URLs with local callbacks open the private browser", function () {
  assert.ok(browserModule.loginUrl(authUrl("auth.openai.com"), "codex"));
  assert.ok(browserModule.loginUrl(authUrl("claude.com"), "claude"));
  assert.ok(browserModule.loginUrl(authUrl("claude.ai"), "claude"));
  [authUrl("evil.example"), authUrl("auth.openai.com.evil.example"), authUrl("auth.openai.com", "https://evil.example/callback"),
    authUrl("auth.openai.com", "http://192.168.0.1/callback"), "https://auth.openai.com/", authUrl("claude.com")].forEach(function (url) {
    assert.strictEqual(browserModule.loginUrl(url, "codex"), null);
  });
});

test("the opener captures the exact URL privately and cleanup removes it", function () {
  var browser = browserModule.createLoginBrowser({ vendor: "claude", ws: {}, canAccess: function () { return true; }, sendTo: function () {} });
  try {
    var url = authUrl("claude.com");
    execFileSync(process.execPath, [path.resolve(__dirname, "../bin/login-browser-open.js"), url], { env: Object.assign({}, process.env, browser.env) });
    assert.strictEqual(fs.readFileSync(browser.env.CLAY_LOGIN_URL_FILE, "utf8"), url);
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(path.dirname(browser.env.CLAY_LOGIN_URL_FILE)).mode & 0o777, 0o700);
  } finally { browser.close(); }
  assert.strictEqual(fs.existsSync(browser.env.CLAY_LOGIN_URL_FILE), false);
});
