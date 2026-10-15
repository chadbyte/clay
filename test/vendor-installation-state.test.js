var test = require("node:test");
var assert = require("node:assert");
var { createSDKBridge } = require("../lib/sdk-bridge");
var createSessionManager = require("../lib/sessions").createSessionManager;
var { buildInitialModelInfo } = require("../lib/project-connection");

test("new project publishes installed vendors before adapter warmup completes", async function () {
  var finishWarmup;
  var warmupResult = new Promise(function (resolve) {
    finishWarmup = resolve;
  });
  var adapter = {
    vendor: "claude",
    init: function () { return warmupResult; },
  };
  var sent = [];
  var sm = {
    availableModels: [],
    modelsByVendor: {},
    sessions: new Map(),
    setSlashCommandsForVendor: function () {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "new-project",
    sessionManager: sm,
    send: function (msg) { sent.push(msg); },
    adapter: adapter,
    adapters: { claude: adapter },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(sm, "installedVendors"), false);

  var pendingWarmup = bridge.warmup(null);

  assert.ok(Array.isArray(sm.installedVendors));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, "model_info");
  assert.deepStrictEqual(sent[0].installedVendors, sm.installedVendors);

  finishWarmup({
    models: [],
    defaultModel: "",
    skills: [],
    slashCommands: [],
    capabilities: {},
  });
  await pendingWarmup;
});

test("project connection includes vendor state when the model is empty", function () {
  var msg = buildInitialModelInfo({
    availableVendors: ["claude", "codex", "kiro"],
    installedVendors: ["claude", "codex", "kiro"],
  }, "claude", "", []);

  assert.strictEqual(msg.type, "model_info");
  assert.strictEqual(msg.model, "");
  assert.deepStrictEqual(msg.installedVendors, ["claude", "codex", "kiro"]);
  assert.deepStrictEqual(msg.availableVendors, ["claude", "codex", "kiro"]);
});

test("cold project availability discovery runs before warmup without initializing an adapter", function () {
  var initCalls = 0;
  var adapter = { vendor: "claude", init: function () { initCalls++; return Promise.resolve({ models: [] }); } };
  var sm = createSessionManager({ cwd: process.cwd(), sessionsBase: process.cwd(), cliSessionsDir: process.cwd(), send: function () {} });
  var bridge = createSDKBridge({ cwd: process.cwd(), slug: "cold-project", sessionManager: sm, send: function () {}, adapter: adapter, adapters: { claude: adapter } });
  var discovered = bridge.refreshInstalledVendors(null);
  assert.ok(Array.isArray(discovered));
  assert.strictEqual(initCalls, 0);
  assert.deepStrictEqual(sm.installedVendors, discovered);
  assert.deepStrictEqual(sm.availableVendors, ["claude"]);
});

function museInstallationFixture(t) {
  var fs = require("node:fs");
  var path = require("node:path");
  var os = require("node:os");
  var childProcess = require("node:child_process");
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-muse-installation-"));
  var bin = path.join(directory, "bin");
  var command = process.platform === "win32" ? "where" : "which";
  var locator = childProcess.execFileSync(command, [command], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  var savedPath = process.env.PATH;
  var savedOverride = process.env.MUSE_CODE_PATH;
  var config = require("../lib/config");
  var savedRealHome = config.REAL_HOME;
  config.REAL_HOME = directory;
  fs.mkdirSync(bin);
  if (process.platform === "win32") fs.copyFileSync(locator, path.join(bin, "where.exe"));
  else fs.symlinkSync(locator, path.join(bin, "which"));
  process.env.PATH = bin;
  delete process.env.MUSE_CODE_PATH;
  t.after(function () {
    config.REAL_HOME = savedRealHome;
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedOverride === undefined) delete process.env.MUSE_CODE_PATH; else process.env.MUSE_CODE_PATH = savedOverride;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  var initCalls = 0;
  var adapter = { vendor: "muse", init: function () { initCalls++; throw new Error("Detection must not initialize Muse"); } };
  var sm = { sessions: new Map(), availableModels: [] };
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, send: function () {}, adapter: adapter, adapters: { muse: adapter } });
  return {
    directory: directory,
    binary: path.join(bin, process.platform === "win32" ? "muse.cmd" : "muse"),
    writeBinary: function (file, executable) {
      fs.writeFileSync(file, process.platform === "win32" ? "@exit /b 97\r\n" : "#!/bin/sh\nexit 97\n", { mode: executable ? 0o755 : 0o644 });
    },
    refresh: function (linuxUser) {
      var installed = bridge.refreshInstalledVendors(linuxUser || null);
      assert.deepStrictEqual(sm.installedVendors, installed);
      assert.strictEqual(initCalls, 0);
      return installed;
    },
    state: sm,
  };
}

test("Muse refresh detects the executable on PATH without adapter startup", function (t) {
  var fixture = museInstallationFixture(t);
  fixture.writeBinary(fixture.binary, true);
  assert.ok(fixture.refresh().includes("muse"));
  assert.ok(fixture.state.availableVendors.includes("muse"));
});

test("Muse refresh honors an explicit executable override outside PATH", function (t) {
  var fixture = museInstallationFixture(t);
  var override = require("node:path").join(fixture.directory, "custom-muse");
  fixture.writeBinary(override, true);
  process.env.MUSE_CODE_PATH = override;
  assert.ok(fixture.refresh().includes("muse"));
});

test("Muse refresh clears missing binaries and rejects invalid overrides without PATH fallback", function (t) {
  var fixture = museInstallationFixture(t);
  assert.strictEqual(fixture.refresh().includes("muse"), false);
  fixture.writeBinary(fixture.binary, true);
  assert.ok(fixture.refresh().includes("muse"));
  require("node:fs").unlinkSync(fixture.binary);
  assert.strictEqual(fixture.refresh().includes("muse"), false);
  fixture.writeBinary(fixture.binary, true);
  process.env.MUSE_CODE_PATH = require("node:path").join(fixture.directory, "missing-muse");
  assert.strictEqual(fixture.refresh().includes("muse"), false);
  process.env.MUSE_CODE_PATH = fixture.directory;
  assert.strictEqual(fixture.refresh().includes("muse"), false);
});

test("Muse refresh rejects an existing non-executable override", { skip: process.platform === "win32" }, function (t) {
  var fixture = museInstallationFixture(t);
  var override = require("node:path").join(fixture.directory, "non-executable-muse");
  fixture.writeBinary(override, false);
  process.env.MUSE_CODE_PATH = override;
  assert.strictEqual(fixture.refresh().includes("muse"), false);
});

test("Muse refresh refuses OS-isolated users even when PATH and override resolve", function (t) {
  var fixture = museInstallationFixture(t);
  fixture.writeBinary(fixture.binary, true);
  process.env.MUSE_CODE_PATH = fixture.binary;
  assert.ok(fixture.refresh().includes("muse"));
  assert.strictEqual(fixture.refresh("isolated-muse-owner").includes("muse"), false);
  assert.strictEqual(fixture.state.availableVendors.includes("muse"), false);
});

function probeMuseMenu(t, options) {
  options = options || {};
  var fs = require("node:fs");
  var path = require("node:path");
  var childProcess = require("node:child_process");
  var home = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "clay-muse-menu-"));
  t.after(function () { fs.rmSync(home, { recursive: true, force: true }); });
  var localBin = path.join(home, ".local", "bin");
  var binary = path.join(localBin, process.platform === "win32" ? "muse.exe" : "muse");
  fs.mkdirSync(localBin, { recursive: true });
  if (options.installed !== false) fs.writeFileSync(binary, "#!/bin/sh\nexit 97\n", { mode: options.nonExecutable ? 0o644 : 0o755 });
  // Keep the locator available, while excluding the installed binary directory.
  var locatorName = process.platform === "win32" ? "where" : "which";
  var locator = childProcess.execFileSync(locatorName, [locatorName], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  var probePath = path.join(home, "path");
  fs.mkdirSync(probePath);
  if (process.platform === "win32") fs.copyFileSync(locator, path.join(probePath, "where.exe"));
  else fs.symlinkSync(locator, path.join(probePath, "which"));
  var probeEnv = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, CLAY_HOME: path.join(home, "data"), CLAY_CONFIG: "", SUDO_USER: "", SUDO_HOME: "", PATH: probePath });
  delete probeEnv.MUSE_CODE_PATH;
  if (options.override !== undefined) probeEnv.MUSE_CODE_PATH = options.override;
  var output = childProcess.execFileSync(process.execPath, ["--require", path.join(__dirname, "helpers", "yoke-no-provider-processes.cjs"), path.join(__dirname, "fixtures", "muse-installation-probe.cjs"), options.isolated ? "isolated" : "owner"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10000,
    env: probeEnv,
  });
  var result = JSON.parse(output.split(/\r?\n/).find(function (line) { return line.indexOf("MUSE_DISCOVERY=") === 0; }).substring("MUSE_DISCOVERY=".length));
  assert.strictEqual(result.initCalls, 0);
  assert.strictEqual(result.options.type, "new_session_options");
  assert.strictEqual(result.options.requestId, "probe");
  return { result: result, binary: binary };
}

test("Muse session-create options discover the standard local install outside daemon PATH", function (t) {
  var probe = probeMuseMenu(t);
  var vendor = probe.result.options.vendors.find(function (entry) { return entry.id === "muse"; });
  assert.ok(vendor && vendor.installed, "authoritative new_session_options must include the local Muse install");
  assert.strictEqual(probe.result.binary, probe.binary);
  assert.strictEqual(probe.result.runtimeBinary, probe.binary);
  assert.strictEqual(probe.result.globalInstalled, true);
  assert.strictEqual(probe.result.canCreate, true);
});

test("Muse session-create local discovery never authorizes a mapped OS owner", function (t) {
  var probe = probeMuseMenu(t, { isolated: true });
  assert.strictEqual(probe.result.installed.includes("muse"), false);
  assert.strictEqual(probe.result.available.includes("muse"), false);
  assert.strictEqual(probe.result.canCreate, false);
  assert.strictEqual(probe.result.isolationRefused, true);
});

test("Muse session-create options refuse an absent standard local install", function (t) {
  var probe = probeMuseMenu(t, { installed: false });
  assert.strictEqual(probe.result.binary, null);
  assert.strictEqual(probe.result.globalInstalled, false);
  assert.strictEqual(probe.result.canCreate, false);
});

test("Muse session-create options reject a non-executable standard local install", { skip: process.platform === "win32" }, function (t) {
  var probe = probeMuseMenu(t, { nonExecutable: true });
  assert.strictEqual(probe.result.binary, null);
  assert.strictEqual(probe.result.canCreate, false);
});

test("Muse session-create local discovery never replaces an explicit invalid override", function (t) {
  var probe = probeMuseMenu(t, { override: require("node:path").join(require("node:os").tmpdir(), "clay-muse-explicit-missing-" + process.pid) });
  assert.notStrictEqual(probe.result.binary, probe.binary);
  assert.strictEqual(probe.result.canCreate, false);
  assert.strictEqual(probe.result.options.vendors.some(function (vendor) { return vendor.id === "muse" && vendor.installed; }), false);
});

test("Muse discovery and real init share override validation including empty selections", async function(t) {
  var fixture = museInstallationFixture(t);
  fixture.writeBinary(fixture.binary, true);
  var muse = require('../lib/yoke/adapters/muse');
  for (var value of ['', fixture.directory, require('node:path').join(fixture.directory, 'missing')]) {
    process.env.MUSE_CODE_PATH = value;
    assert.throws(function() { muse.findMusePath(); }, /Invalid explicit/);
    await assert.rejects(muse.createMuseAdapter({ _sdk: {} }).init(), /Invalid explicit/);
    assert.equal(fixture.refresh().includes('muse'), false);
  }
  process.env.MUSE_CODE_PATH = fixture.binary;
  var adapter = muse.createMuseAdapter({ _sdk: {} }); await adapter.init();
  assert.equal(adapter.binaryPath, muse.findMusePath()); await adapter.shutdown();
});
