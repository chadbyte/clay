// The caller isolates HOME, CLAY_HOME and PATH before this process imports Clay.
var createSDKBridge = require("../../lib/sdk-bridge").createSDKBridge;
var attachModels = require("../../lib/project-models").attachModels;
var attachSessionCreation = require("../../lib/project-session-creation").attachSessionCreation;
var yoke = require("../../lib/yoke");
var muse = require("../../lib/yoke/adapters/muse");
var linuxUser = process.argv[2] === "isolated" ? "isolated-owner" : null;
var sent = [];
var initCalls = 0;
var adapter = { vendor: "muse", init: function () { initCalls++; throw new Error("Discovery must not start Muse"); } };
var adapters = { muse: adapter };
var sm = { sessions: new Map(), availableModels: [] };
var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: sm, adapters: adapters, adapter: adapter, send: function () {} });
var models = attachModels({
  cwd: process.cwd(), slug: "muse-discovery", sm: sm, sdk: bridge, adapters: adapters,
  sendTo: function () {}, getSessionForWs: function () { return null; },
  getLinuxUserForWs: function () { return linuxUser; },
});
var creation = attachSessionCreation({
  slug: "muse-discovery", usersModule: { isMultiUser: function () { return false; } },
  getVendorAvailability: models.getVendorAvailability,
  sendTo: function (ws, message) { sent.push(message); },
});
async function probe() {
  creation.handleMessage({}, { type: "new_session_options_get", slug: "muse-discovery", requestId: "probe" });
  var binary = null;
  try { binary = muse.findMusePath(); } catch (error) {}
  var runtimeBinary = null;
  var isolationRefused = false;
  var runtimeAdapter = muse.createMuseAdapter({ _sdk: {} });
  if (linuxUser) {
    try { await runtimeAdapter.init({ linuxUser: linuxUser }); }
    catch (error) { isolationRefused = /OS-owner isolation/.test(error.message); }
  } else if (binary) {
    await runtimeAdapter.init();
    runtimeBinary = runtimeAdapter.binaryPath;
  }
  console.log("MUSE_DISCOVERY=" + JSON.stringify({
    options: sent[0], binary: binary, installed: sm.installedVendors,
    globalInstalled: yoke.checkInstalled().muse, available: sm.availableVendors,
    canCreate: creation.isInstalled({}, "muse"), initCalls: initCalls,
    runtimeBinary: runtimeBinary, isolationRefused: isolationRefused,
  }));
}
probe().catch(function (error) { console.error(error); process.exitCode = 1; });
