var fs = require("fs");
var path = require("path");
var vm = require("vm");
var test = require("node:test");
var assert = require("node:assert/strict");

function buildHarness() {
  var moduleRoot = path.join(__dirname, "../lib/public/modules");
  var sent = []; var documentClicks = [];
  var noop = function () {};
  var element = {
    insertBefore: noop,
    appendChild: noop,
    addEventListener: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
  };
  var context = {
    console: console,
    document: {
      getElementById: function (id) { return id === "sticky-notes-container" ? null : element; },
      createElement: function () { return element; },
      addEventListener: function (type, listener, capture) { if (type === "click" && capture) documentClicks.push(listener); },
      documentElement: element,
    },
    window: { addEventListener: noop },
    history: { pushState: noop, replaceState: noop },
    getWs: function () { return socket; },
    syncPairChrome: noop,
    detachTuiView: noop,
    refreshIcons: noop,
    getCachedSessions: function () { return [{ id: 11 }, { id: 12 }, { id: 25 }, { id: 26 }]; },
    closeWhatsNewArticle: noop,
    isHomeHubVisible: function () { return false; },
    resetFileBrowser: noop,
    closeScheduledTasks: noop,
    closeNotesBrowser: noop,
    hideMemory: noop,
    isSchedulerOpen: function () { return false; },
    resetScheduler: noop,
  };
  var socket = {
    readyState: 1,
    send: function (raw) {
      sent.push({ slug: context.store.get("currentSlug"), message: JSON.parse(raw) });
    },
  };
  vm.createContext(context);

  function load(file) {
    var source = fs.readFileSync(path.join(moduleRoot, file), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/export function /g, "function ")
      .replace(/export \{[^}]+\};/g, "");
    vm.runInContext(source, context, { filename: file });
  }

  load("store.js");
  load("split-group-helpers.js");
  load("project-activation.js");
  load("split-session-boundary.js");
  load("app-projects.js");
  load("split-view.js");
  vm.runInContext("renderSplit=function(){};createDropOverlay=function(){return null;};resetClientState=function(){};connect=function(){clearProjectSplitState();store.set({socketPath:store.get('wsPath'),activeProjectSlug:null,sessionActivatedProjectSlug:null,sessionListProjectSlug:null,splitGroupsProjectSlug:null});};", context);

  function hydrate(slug, id, groups, groupFirst) {
    context.store.set({
      currentSlug: slug,
      wsPath: "/p/" + slug + "/ws",
      socketPath: "/p/" + slug + "/ws",
      connected: true,
      activeProjectSlug: slug,
      sessionListProjectSlug: null,
      splitGroupsProjectSlug: null,
    });
    if (groupFirst) {
      context.applyProjectSplitGroups(groups);
      context.store.set({ activeSessionId: id, sessionActivatedProjectSlug: slug, sessionListProjectSlug: slug });
    } else {
      context.store.set({ activeSessionId: id, sessionActivatedProjectSlug: slug, sessionListProjectSlug: slug });
      context.applyProjectSplitGroups(groups);
    }
    context.maybeRestoreSplitGroup();
  }

  return { context: context, sent: sent, hydrate: hydrate, documentClicks: documentClicks };
}

test("split sidebar capture preserves nested GitHub controls before row selection", function () {
  var harness = buildHarness(); var context = harness.context; var switched = [];
  context.createStore({ splitPanes: { groupId: "pairA", panes: [{ slug: "A", sessionId: 11 }, { slug: "A", sessionId: 12 }] } });
  context.initSplitView();
  context.switchNativeSession = function (id) { switched.push(id); };
  assert.equal(harness.documentClicks.length, 1);
  var item = { dataset: { sessionId: "12" } };
  function eventFor(control, modified) {
    var prevented = 0; var stopped = 0;
    return { button: 0, ctrlKey: !!modified, target: { closest: function (selector) {
      if (selector === ".session-close-btn, .session-more-btn, .session-github-link, .github-work-more") return control;
      if (selector === ".session-item[data-session-id], .session-loop-child[data-session-id]") return item;
      return null;
    } }, preventDefault: function () { prevented++; }, stopImmediatePropagation: function () { stopped++; }, prevented: function () { return prevented; }, stopped: function () { return stopped; } };
  }
  var anchor = { className: "session-github-link" };
  var normalAnchor = eventFor(anchor, false); harness.documentClicks[0](normalAnchor);
  var modifiedAnchor = eventFor(anchor, true); harness.documentClicks[0](modifiedAnchor);
  var keyboardAnchor = eventFor(anchor, false); keyboardAnchor.detail = 0; harness.documentClicks[0](keyboardAnchor);
  var overflow = eventFor({ className: "github-work-more" }, false); harness.documentClicks[0](overflow);
  assert.deepEqual(switched, []);
  assert.equal(normalAnchor.prevented(), 0); assert.equal(normalAnchor.stopped(), 0);
  assert.equal(modifiedAnchor.prevented(), 0); assert.equal(modifiedAnchor.stopped(), 0);
  assert.equal(keyboardAnchor.prevented(), 0); assert.equal(keyboardAnchor.stopped(), 0);
  var row = eventFor(null, false); harness.documentClicks[0](row);
  assert.deepEqual(switched, [12]);
  assert.equal(row.prevented(), 1); assert.equal(row.stopped(), 1);
});

test("production split boundary survives project changes, hydration races, and live dissolution", function () {
  var harness = buildHarness();
  var context = harness.context;
  var sent = harness.sent;
  context.createStore({
    currentSlug: "A",
    wsPath: "/p/A/ws",
    socketPath: "/p/A/ws",
    connected: true,
    activeProjectSlug: "A",
    sessionActivatedProjectSlug: "A",
    sessionListProjectSlug: "A",
    splitGroupsProjectSlug: "A",
    activeSessionId: 11,
    splitGroups: [{ id: "pairA", members: [11, 12] }],
    splitPanes: { groupId: "pairA", panes: [{ slug: "A", sessionId: 11 }, { slug: "A", sessionId: 12 }] },
  });
  context.initSplitView();

  context.switchProject("B");
  assert.equal(context.store.get("splitPanes"), null);
  assert.equal(context.store.get("activeSessionId"), null);
  assert.equal(sent.length, 0);

  harness.hydrate("B", 25, [{ id: "pairB", members: [25, 26] }], true);
  assert.equal(context.store.get("splitPanes").panes[0].slug, "B");
  assert.equal(context.store.get("activeSessionId"), 25);
  assert.equal(sent.length, 0);

  context.switchProject("A");
  harness.hydrate("A", 11, [{ id: "pairA", members: [11, 12] }], false);
  assert.equal(context.store.get("splitPanes").panes[0].slug, "A");
  assert.equal(context.store.get("activeSessionId"), 11);
  assert.equal(sent.length, 0);

  context.store.set({ splitGroups: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].slug, "A");
  assert.equal(sent[0].message.id, 11);
});

test("reconnect reconciliation clears obsolete split without overriding restored second member", function () {
  var harness = buildHarness();
  var context = harness.context;
  var sent = harness.sent;
  context.createStore({
    currentSlug: "A",
    wsPath: "/p/A/ws",
    socketPath: "/p/A/ws",
    connected: true,
    activeProjectSlug: "A",
    sessionActivatedProjectSlug: "A",
    sessionListProjectSlug: "A",
    splitGroupsProjectSlug: "A",
    activeSessionId: 11,
    splitGroups: [{ id: "pairA", members: [11, 12] }],
    splitPanes: { groupId: "pairA", panes: [{ slug: "A", sessionId: 11 }, { slug: "A", sessionId: 12 }] },
  });
  context.initSplitView();

  context.store.set({ activeProjectSlug: null, sessionActivatedProjectSlug: null, sessionListProjectSlug: null, splitGroupsProjectSlug: null });
  context.store.set({ activeProjectSlug: "A", sessionListProjectSlug: "A" });
  context.applyProjectSplitGroups([]);
  context.store.set({ activeSessionId: 12, sessionActivatedProjectSlug: "A" });
  context.maybeRestoreSplitGroup();

  assert.equal(context.store.get("splitPanes"), null);
  assert.equal(context.store.get("activeSessionId"), 12);
  assert.equal(sent.length, 0);
});

test("reconnect reconciliation rebuilds panes when the same group replaces a member", function () {
  var harness = buildHarness();
  var context = harness.context;
  var sent = harness.sent;
  context.createStore({
    currentSlug: "A",
    wsPath: "/p/A/ws",
    socketPath: "/p/A/ws",
    connected: true,
    activeProjectSlug: "A",
    sessionActivatedProjectSlug: "A",
    sessionListProjectSlug: "A",
    splitGroupsProjectSlug: "A",
    activeSessionId: 11,
    splitGroups: [{ id: "pairA", members: [11, 12] }],
    splitPanes: { groupId: "pairA", panes: [{ slug: "A", sessionId: 11 }, { slug: "A", sessionId: 12 }] },
  });
  context.initSplitView();

  context.store.set({ activeProjectSlug: null, sessionActivatedProjectSlug: null, sessionListProjectSlug: null, splitGroupsProjectSlug: null });
  context.store.set({ activeProjectSlug: "A", sessionListProjectSlug: "A" });
  context.applyProjectSplitGroups([{ id: "pairA", members: [11, 25] }]);
  context.store.set({ activeSessionId: 11, sessionActivatedProjectSlug: "A" });
  context.maybeRestoreSplitGroup();

  assert.equal(context.store.get("splitPanes").panes.map(function (pane) { return pane.sessionId; }).join(","), "11,25");
  assert.equal(sent.length, 0);
});
