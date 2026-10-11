var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var runtimeEnv = require("../lib/runtime-env");

test("runtime environment parses data assignments without executing shell syntax", function () {
  assert.deepStrictEqual(runtimeEnv.parseEnvrc("# comment\nexport TOKEN=shared\nNAME=\"two words\"\nSINGLE='literal value'"), {
    TOKEN: "shared",
    NAME: "two words",
    SINGLE: "literal value",
  });
  assert.match(runtimeEnv.validateEnvString("source .env"), /Unsupported syntax at line 1/);
  assert.match(runtimeEnv.validateEnvString("VALUE=before; command"), /Unsupported executable syntax/);
  assert.match(runtimeEnv.validateEnvString("BAD-KEY=value"), /Invalid variable name/);
  assert.match(runtimeEnv.validateEnvString("VALUE=\0"), /NUL bytes/);
  assert.deepStrictEqual(runtimeEnv.parseEnvrc('TOKEN="a;$(literal)|secret"'), { TOKEN: "a;$(literal)|secret" });
});

test("environment validation errors do not include secret values", function () {
  var error = runtimeEnv.validateEnvString("INVALID-KEY=top-secret-value");
  assert.ok(error);
  assert.ok(error.indexOf("top-secret-value") === -1);
});

test("environment settings UI states its process scope and timing", function () {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var projectSettings = fs.readFileSync(path.join(__dirname, "../lib/public/modules/project-settings.js"), "utf8");
  var serverSettings = fs.readFileSync(path.join(__dirname, "../lib/public/modules/server-settings-environment.js"), "utf8");
  assert.match(html, /newly created coding-agent processes/);
  assert.match(html, /active processes, terminals, the daemon, and the browser keep their current environment/);
  assert.ok(html.indexOf(".envrc</code> file exists") === -1);
  assert.match(projectSettings, /JSON\.stringify\(value == null \? "" : String\(value\)\)/);
  assert.match(projectSettings, /clearTimeout\(envStatusTimer\)/);
  assert.doesNotMatch(serverSettings, /autoSaveSharedEnv|sharedEnvStatusTimer/);
  assert.match(serverSettings, /Your draft is retained/);
});

test("runtime environment gives project values precedence without replacing Clay controls", function () {
  var resolved = runtimeEnv.resolveRuntimeEnv({
    baseEnv: { PATH: "/safe/bin", HOME: "/safe/home", CLAY_AUTH_TOKEN: "protected", FROM_BASE: "base", VALUE: "base" },
    sharedEnvrc: "VALUE=shared\nSHARED_ONLY=shared\nPATH=/unsafe\nCLAY_AUTH_TOKEN=leak",
    projectEnvrc: "VALUE=project\nPROJECT_ONLY=project\nHOME=/unsafe-home",
  });

  assert.strictEqual(resolved.VALUE, "project");
  assert.strictEqual(resolved.SHARED_ONLY, "shared");
  assert.strictEqual(resolved.PROJECT_ONLY, "project");
  assert.strictEqual(resolved.FROM_BASE, "base");
  assert.strictEqual(resolved.PATH, "/safe/bin");
  assert.strictEqual(resolved.HOME, "/safe/home");
  assert.strictEqual(resolved.CLAY_AUTH_TOKEN, "protected");
});

test("separate resolution calls do not leak another project or user environment", function () {
  var first = runtimeEnv.resolveRuntimeEnv({ baseEnv: { HOME: "/users/alice" }, sharedEnvrc: "SHARED=1", projectEnvrc: "PROJECT=alpha\nPRIVATE=alice" });
  var second = runtimeEnv.resolveRuntimeEnv({ baseEnv: { HOME: "/users/bob" }, sharedEnvrc: "SHARED=1", projectEnvrc: "PROJECT=beta" });

  assert.strictEqual(first.HOME, "/users/alice");
  assert.strictEqual(second.HOME, "/users/bob");
  assert.strictEqual(first.PROJECT, "alpha");
  assert.strictEqual(second.PROJECT, "beta");
  assert.strictEqual(second.PRIVATE, undefined);
});
