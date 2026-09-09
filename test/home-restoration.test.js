var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var pathToFileURL = require("node:url").pathToFileURL;
var vm = require("node:vm");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Home defers an early Mate selection until durable session preferences load", function () {
  var chat = source("lib/public/modules/home-mate-chat.js");
  var hub = source("lib/public/modules/app-home-hub.js");
  var surface = source("lib/public/modules/home-surface.js");
  var connection = source("lib/public/modules/app-connection.js");
  assert.match(chat, /if \(store\.get\('homeSurfaceLoaded'\)\) resumeHomeChat\(\);/);
  assert.match(hub, /state\.homeSurfaceLoaded !== prev\.homeSurfaceLoaded[\s\S]*if \(!restoreHomeDebatesArchive\(\) && state\.homeChatMateId\) resumeHomeChat\(\);/);
  assert.match(surface, /homePreferredMateId = store\.get\('homePreferredMateId'\) \|\| preference\.activeMateId \|\| store\.get\('homeChatMateId'\)/);
  assert.match(connection, /requestHomeSurfacePreference\(\);[\s\S]*if \(store\.get\('homeSurfaceLoaded'\) && !isHomeDebatesSurface\(\)\) resumeHomeChat\(\);/);
});

test("Home surface writes send only changed preference fields", function () {
  var surface = source("lib/public/modules/home-surface.js");
  assert.match(surface, /var outgoing = \{\};/);
  assert.match(surface, /preference: outgoing/);
  assert.doesNotMatch(surface, /home_surface_set", preference: next/);
});

test("Home Close chooses only a server-authorized ordinary project", async function () {
  var activation = await import(pathToFileURL(path.join(root, "lib/public/modules/project-activation.js")).href);
  var projects = [
    { slug: "mate-clay", isMate: true },
    { slug: "allowed-second" },
    { slug: "allowed-first" },
  ];
  assert.equal(activation.chooseProjectActivationTarget(projects, ["revoked", "allowed-first"]), "allowed-first");
  assert.equal(activation.chooseProjectActivationTarget(projects, ["revoked", "mate-clay"]), "allowed-second");
  assert.equal(activation.chooseProjectActivationTarget([{ slug: "mate-only", isMate: true }], ["mate-only"]), null);

  var hub = source("lib/public/modules/app-home-hub.js");
  assert.match(hub, /function getHomeReturnSlug\(\)[\s\S]*chooseProjectActivationTarget\([\s\S]*getCachedProjects\(\)[\s\S]*homeSurfaceProjectSlug/);
  assert.match(hub, /syncHomeCloseControl\(\)[\s\S]*classList\.toggle\("hidden", !getHomeReturnSlug\(\)\)/);
  assert.match(hub, /export function minimizeHomeHub\(\) \{[\s\S]*var slug = getHomeReturnSlug\(\)[\s\S]*switchProject\(slug\)/);
  assert.doesNotMatch(hub.slice(hub.indexOf("export function minimizeHomeHub")), /rememberHomePrimarySurface\("project"\)/);
});

test("error recovery does not mistake intended routing state for project activation", async function () {
  var activation = await import(pathToFileURL(path.join(root, "lib/public/modules/project-activation.js")).href);
  var route = "/p/allowed/ws";
  var recovery = {
    currentSlug: "allowed",
    wsPath: route,
    socketPath: "/ws",
    connected: true,
    activeProjectSlug: null,
    sessionActivatedProjectSlug: null,
  };
  assert.equal(activation.isProjectActivated(recovery, "allowed", { readyState: 1 }), false);
  assert.equal(activation.isProjectActivationPending(recovery, "allowed", { readyState: 1 }), false);

  recovery.socketPath = route;
  recovery.connected = false;
  assert.equal(activation.isProjectActivationPending(recovery, "allowed", { readyState: 0 }), true);
  assert.equal(activation.isProjectActivated(recovery, "allowed", { readyState: 0 }), false);

  recovery.connected = true;
  recovery.activeProjectSlug = "allowed";
  assert.equal(activation.isProjectContextConnected(recovery, "allowed", { readyState: 1 }), true);
  assert.equal(activation.isProjectActivated(recovery, "allowed", { readyState: 1 }), false);
  recovery.sessionActivatedProjectSlug = "allowed";
  assert.equal(activation.isProjectActivated(recovery, "allowed", { readyState: 1 }), true);

  var projects = source("lib/public/modules/app-projects.js");
  var messages = source("lib/public/modules/app-messages.js");
  assert.match(projects, /if \(homeVisible\) store\.set\(\{ pendingHomeProjectSlug: slug \}\);[\s\S]*isProjectActivationPending\([\s\S]*return;[\s\S]*connect\(\)/);
  assert.match(projects, /export function completePendingProjectActivation\(\)[\s\S]*isProjectActivated\([\s\S]*pendingHomeProjectSlug: null[\s\S]*rememberHomePrimarySurface\("project", slug\)[\s\S]*history\.(?:replaceState|pushState)/);
  assert.match(messages, /case "info":[\s\S]*activeProjectSlug: msg\.slug/);
  assert.match(messages, /case "session_switched":[\s\S]*maybeRestoreSplitGroup\(\);[\s\S]*finishProjectSessionActivation\(\)[\s\S]*hideHomeHub\(\)/);
});

function createNavigationHarness(activation) {
  var projectsSource = source("lib/public/modules/app-projects.js");
  var navigation = projectsSource.slice(
    projectsSource.indexOf("export function switchProject"),
    projectsSource.indexOf("export function showUpdateAvailable")
  ).replace(/export function /g, "function ");
  var hubSource = source("lib/public/modules/app-home-hub.js");
  var returnTarget = hubSource.slice(
    hubSource.indexOf("function getHomeReturnSlug"),
    hubSource.indexOf("function getVisibleMates")
  );
  var close = hubSource.slice(hubSource.indexOf("export function minimizeHomeHub")).replace("export function", "function");
  var state = {
    currentSlug: "allowed",
    wsPath: "/p/allowed/ws",
    socketPath: "/ws",
    connected: true,
    activeProjectSlug: null,
    sessionActivatedProjectSlug: null,
    pendingHomeProjectSlug: null,
    dmMode: false,
  };
  var socket = { readyState: 1 };
  var connects = 0;
  var hidden = 0;
  var preferences = [];
  var routes = [];
  var context = {
    store: {
      get: function (key) { return state[key]; },
      set: function (patch) { Object.assign(state, patch); },
      snap: function () { return Object.assign({}, state); },
    },
    getWs: function () { return socket; },
    projectWsPath: activation.projectWsPath,
    isProjectActivated: activation.isProjectActivated,
    isProjectActivationPending: activation.isProjectActivationPending,
    isProjectContextConnected: activation.isProjectContextConnected,
    chooseProjectActivationTarget: activation.chooseProjectActivationTarget,
    getCachedProjects: function () { return [{ slug: "allowed" }]; },
    isHomeHubVisible: function () { return context.homeHubVisible; },
    hideHomeHub: function () { context.homeHubVisible = false; hidden++; },
    rememberHomePrimarySurface: function (surface, slug) { preferences.push([surface, slug]); },
    connect: function () {
      connects++;
      socket = { readyState: 0 };
      state.socketPath = state.wsPath;
      state.connected = false;
      state.activeProjectSlug = null;
      state.sessionActivatedProjectSlug = null;
    },
    history: {
      pushState: function (value, title, route) { routes.push(route); },
      replaceState: function (value, title, route) { routes.push(route); },
    },
    document: {
      cookie: "",
      documentElement: { classList: { contains: function () { return false; } } },
      getElementById: function () { return { disabled: true }; },
    },
    closeWhatsNewArticle: function () {},
    exitDmMode: function () {},
    resetFileBrowser: function () {},
    closeNotesBrowser: function () {},
    hideMemory: function () {},
    isSchedulerOpen: function () { return false; },
    closeScheduler: function () {},
    resetScheduler: function () {},
    resetClientState: function () {},
    homeHubVisible: true,
  };
  vm.runInNewContext(navigation + "\n" + returnTarget + "\n" + close, context);
  return {
    context: context,
    state: state,
    setSocket: function (next) { socket = next; },
    connects: function () { return connects; },
    hidden: function () { return hidden; },
    preferences: preferences,
    routes: routes,
  };
}

test("actual Home Close waits through info, deduplicates activation, and completes after session restoration", async function () {
  var activation = await import(pathToFileURL(path.join(root, "lib/public/modules/project-activation.js")).href);
  var f = createNavigationHarness(activation);

  f.context.minimizeHomeHub();
  assert.equal(f.context.homeHubVisible, true);
  assert.equal(f.connects(), 1);
  assert.deepEqual(f.preferences, []);
  assert.deepEqual(f.routes, []);

  f.setSocket({ readyState: 1 });
  Object.assign(f.state, { connected: true, activeProjectSlug: "allowed" });
  f.context.minimizeHomeHub();
  assert.equal(f.context.homeHubVisible, true, "info alone must not close Home");
  assert.equal(f.connects(), 1, "a repeated Close must reuse the in-flight exact socket");
  assert.equal(f.state.pendingHomeProjectSlug, "allowed");

  assert.equal(f.context.finishProjectSessionActivation(), true);
  f.context.hideHomeHub();
  assert.equal(f.context.homeHubVisible, false);
  assert.equal(f.state.sessionActivatedProjectSlug, "allowed");
  assert.equal(f.state.pendingHomeProjectSlug, null);
  assert.deepEqual(f.preferences, [["project", "allowed"]]);
  assert.deepEqual(f.routes, ["/p/allowed/"]);
});

test("actual normal Home Close exits immediately after an exact session is active", async function () {
  var activation = await import(pathToFileURL(path.join(root, "lib/public/modules/project-activation.js")).href);
  var f = createNavigationHarness(activation);
  f.state.socketPath = "/p/allowed/ws";
  f.state.activeProjectSlug = "allowed";
  f.state.sessionActivatedProjectSlug = "allowed";

  f.context.minimizeHomeHub();
  assert.equal(f.context.homeHubVisible, false);
  assert.equal(f.connects(), 0);
  assert.deepEqual(f.preferences, [["project", "allowed"]]);
  assert.deepEqual(f.routes, ["/p/allowed/"]);
});

test("replaced socket callbacks cannot confirm or process stale project events", function () {
  var connectionSource = source("lib/public/modules/app-connection.js");
  var connectSource = connectionSource.slice(
    connectionSource.indexOf("export function connect"),
    connectionSource.indexOf("export function cancelReconnect")
  ).replace("export function", "function");
  var state = { wsPath: "/p/old/ws", connected: false };
  var currentSocket = null;
  var sockets = [];
  var processed = [];
  function FakeWebSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.close = function () { this.readyState = 3; };
    this.send = function () {};
    sockets.push(this);
  }
  var context = {
    store: {
      get: function (key) { return state[key]; },
      set: function (patch) { Object.assign(state, patch); },
    },
    getWs: function () { return currentSocket; },
    setWs: function (socket) { currentSocket = socket; },
    WebSocket: FakeWebSocket,
    location: { protocol: "https:", host: "clay.test" },
    stopHeartbeat: function () {},
    setStatus: function (status) { state.connected = status === "connected"; },
    startHeartbeat: function () {},
    blinkIO: function () {},
    onConnected: function () {},
    closeDmUserPicker: function () {},
    setActivity: function () {},
    scheduleReconnect: function () {},
    processMessage: function (message) { processed.push(message); },
    setTimeout: function () { return 1; },
    clearTimeout: function () {},
    connectTimeoutId: null,
    hasConnectedOnce: false,
    disconnectedAt: 0,
    reconnectDelay: 1000,
    reconnectTimer: null,
    heartbeatDeadlineTimer: null,
    window: {},
    console: console,
  };
  vm.runInNewContext(connectSource, context);
  context.connect();
  var stale = sockets[0];
  var staleOpen = stale.onopen;
  var staleMessage = stale.onmessage;
  var staleClose = stale.onclose;
  state.wsPath = "/p/new/ws";
  context.connect();

  staleOpen();
  staleMessage({ data: JSON.stringify({ type: "info", slug: "old" }) });
  staleClose({ wasClean: false, code: 1006, reason: "stale" });
  assert.equal(currentSocket, sockets[1]);
  assert.equal(state.socketPath, "/p/new/ws");
  assert.equal(state.activeProjectSlug, null);
  assert.equal(state.sessionActivatedProjectSlug, null);
  assert.deepEqual(processed, []);
});

test("normal Home Close still exits immediately for a confirmed live project", function () {
  var projects = source("lib/public/modules/app-projects.js");
  assert.match(projects, /var alreadyInProject = isProjectActivated\(st, slug, ws\);/);
  assert.match(projects, /if \(homeVisible && alreadyInProject\) \{[\s\S]*rememberHomePrimarySurface\("project", slug\);[\s\S]*hideHomeHub\(\);[\s\S]*history\.(?:replaceState|pushState)[\s\S]*return;/);
});

test("restored exact conversations rerender and reveal the selected Mate locally", function () {
  var chat = source("lib/public/modules/home-mate-chat.js");
  var hub = source("lib/public/modules/app-home-hub.js");
  assert.match(chat, /export function openHomeConversation\(mateId, sessionId\)[\s\S]*resetHomeSessionModel\(sessionId\);[\s\S]*store\.set\(\{ homeChatMateId: mateId \}\)/);
  assert.match(hub, /state\.homeChatMateId !== prev\.homeChatMateId \|\| state\.cachedMatesList !== prev\.cachedMatesList\) renderHomeMateSwitcher\(\)/);
  assert.match(hub, /state\.homeSurfaceLoaded !== prev\.homeSurfaceLoaded[\s\S]*renderHomeMateSwitcher\(\)/);
  assert.match(hub, /selectionChanged \? activeRow : focusedRow \|\| activeRow/);
  assert.match(hub, /list\.scrollTop/);
  assert.doesNotMatch(hub, /document\.(?:body|documentElement)\.scroll|window\.scroll/);
});
