var museQuery = require("../muse-query");
var runtimeTools = require("../muse-runtime");
var findMusePath = require("../providers/muse-executable").resolve;

function createMuseAdapter(opts) {
  opts = opts || {};
  var adapter = {
    vendor: "muse",
    userInputCapability: { mode: "native", native: true },
    providerContract: require("../vendor-registry").getVendorInfo("muse"),
    queryContract: require("./muse-query-contract"),
    cwd: opts.cwd || process.cwd(),
    binaryPath: opts._binaryPath || null,
    sdkPromise: null,
    catalog: [],
    clients: new Set(),
    handles: new Set(),
    shuttingDown: false,
    requestTimeoutMs: opts._requestTimeoutMs || 9e4,
    titleTimeoutMs: opts._titleTimeoutMs || 15e3,
    shutdownTimeoutMs: opts._shutdownTimeoutMs == null ? 1e3 : opts._shutdownTimeoutMs
  };
  adapter.loadSdk = function() {
    if (opts._sdk) return Promise.resolve(opts._sdk);
    if (!adapter.sdkPromise) adapter.sdkPromise = import("@muse-code/sdk");
    return adapter.sdkPromise;
  };
  adapter.init = async function(initOpts) {
    if (opts.osUsers || opts.linuxUser || initOpts && (initOpts.linuxUser || initOpts.osUsers)) throw new Error("Muse Code does not support OS-owner isolation");
    if (!adapter.binaryPath) adapter.binaryPath = findMusePath();
    if (!adapter.binaryPath) throw new Error("Muse Code binary not found: muse. Install Muse Code or set MUSE_CODE_PATH.");
    await adapter.loadSdk();
    return {
      models: [],
      defaultModel: null,
      skills: [],
      slashCommands: [],
      fastModeState: null,
      capabilities: {
        effort: true,
        midSessionModelSwitch: true,
        fork: true,
        rollback: false,
        sessionListing: true,
        sessionRename: true,
        thinking: true,
        betas: false,
        rewind: false,
        sessionResume: true,
        promptSuggestions: false,
        elicitation: false,
        fileCheckpointing: false,
        contextCompacting: true,
        queryBoundTools: {
          mode: "stdio-mcp",
          source: "@muse-code/sdk SessionConfig.mcpServers"
        },
        skillSharing: true,
        toolPolicy: [ "ask", "allow-all" ]
      }
    };
  };
  adapter.supportedModels = async function() {
    if (adapter.shuttingDown) throw new Error("Muse Code adapter is shutting down");
    if (!adapter.binaryPath) await adapter.init();
    var sdk = await adapter.loadSdk();
    if (adapter.shuttingDown) throw new Error("Muse Code adapter is shutting down");
    var runtime = runtimeTools.createRuntime(adapter, sdk, {
      command: adapter.binaryPath,
      args: [ "serve" ],
      cwd: adapter.cwd,
      env: Object.assign({}, process.env)
    });
    runtime.fail = function(error) {
      runtime.close().catch(function(closeError) {
        adapter.lastCloseError = closeError;
      });
    };
    try {
      var spawned = await runtime.initialize();
      adapter.catalog = runtimeTools.normalizeCatalog(await runtime.waitRequest(spawned.connection.request("model/list", {})));
      return adapter.catalog.slice();
    } finally {
      await runtime.close();
    }
  };
  adapter.createToolServer = function() {
    return null;
  };
  adapter.createQuery = async function(queryOpts) {
    if (opts.osUsers || opts.linuxUser || queryOpts && queryOpts.linuxUser) throw new Error("Muse Code does not support OS-owner isolation");
    if (!adapter.binaryPath) await adapter.init(queryOpts || {});
    if (adapter.shuttingDown) throw new Error("Muse Code adapter is shutting down");
    return museQuery.createMuseQueryHandle(adapter, queryOpts || {});
  };
  adapter.generateTitle = function(messages, titleOpts) {
    return require("../title-query").generateTitle(adapter, messages, Object.assign({}, titleOpts, { timeoutMs: adapter.titleTimeoutMs }),
      { skipProjectInstructions: true, skipSkills: true, adapterOptions: { MUSE: { readOnly: true, mcpServers: [] } } });
  };
  adapter.shutdown = async function() {
    adapter.shuttingDown = true;
    var results = await Promise.allSettled(Array.from(adapter.handles).map(function(handle) {
      return handle.close();
    }).concat(Array.from(adapter.clients).map(function(runtime) {
      return runtime.close();
    })));
    var failed = results.find(function(result) {
      return result.status === "rejected";
    });
    if (failed) throw failed.reason;
    return true;
  };
  require("../muse-services").attach(adapter);
  return adapter;
}

module.exports = {
  createMuseAdapter: createMuseAdapter,
  findMusePath: findMusePath,
  isAuthError: runtimeTools.isAuthError,
  chooseApprovalDecision: require("../muse-policy").chooseApprovalDecision
};
