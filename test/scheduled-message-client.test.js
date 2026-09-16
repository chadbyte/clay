var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

function source(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }

test("scheduled transcript events no longer own a bubble or composer disabled state", function () {
  var messages = source("lib/public/modules/app-messages.js");
  var rateLimit = source("lib/public/modules/app-rate-limit.js");
  assert.doesNotMatch(messages, /applyScheduledMessage|addScheduledMessageBubble|removeScheduledMessageBubble/);
  assert.doesNotMatch(rateLimit, /scheduled-msg-bubble|addScheduledMessageBubble|removeScheduledMessageBubble/);
});

test("scheduled control helper carries queue correlation when present", function () {
  var code = source("lib/public/modules/scheduled-message-state.js").replace(/export function/g, "function");
  var exported;
  eval(code + "\nexported = scheduledMessageControl;");
  assert.deepEqual(exported("send_scheduled_now", { jobId: "job-1", revision: "rev-2", queueRevision: 9 }), {
    type: "send_scheduled_now", jobId: "job-1", revision: "rev-2", queueRevision: 9,
  });
});

test("scheduled admission is correlated in the composer and keeps attachments until success", function () {
  var input = source("lib/public/modules/input.js");
  var messages = source("lib/public/modules/app-messages.js");
  assert.match(input, /pendingScheduleAdmission/);
  assert.match(input, /export function handleScheduleMessageResult/);
  assert.match(input, /msg\.requestId !== pending\.requestId/);
  assert.match(input, /msg\.accountId !== currentContext\.accountId/);
  assert.match(input, /if \(!msg\.ok\)[\s\S]*showToast/);
  assert.match(input, /JSON\.stringify\(currentDraft\) !== JSON\.stringify\(pending\.draft\)/);
  assert.match(messages, /handleScheduleMessageResult\(msg\)/);
  assert.match(input, /while \(boundedIds\.length > 8\)/);
  assert.match(input, /scheduleDraftMatches\(candidate\.draft, scheduleDraft\)/);
});

test("real composer send and admission ack preserve and clear the exact draft", function () {
  var code = source("lib/public/modules/input.js").replace(/^import .*;\n/gm, "").replace(/^export \{[^;]+;\n/gm, "").replace(/export /g, "");
  code += "\nglobalThis.__setInputContext = function (value) { ctx = value; };";
  code += "\nglobalThis.__setPending = function (images, pastes, files) { pendingImages = images; pendingPastes = pastes; pendingFiles = files; };";
  var state = { currentSlug: "project-a", activeSessionId: 7, myUserId: "user-a", connected: true };
  var listeners = [];
  var sent = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (update) { Object.assign(state, update); }, subscribe: function (listener) { listeners.push(listener); } },
    iconHtml: function () { return "" }, refreshIcons: function () {}, setRewindMode: function () {}, isRewindMode: function () { return false; },
    renderPicker: function () {}, checkForMention: function () { return {}; }, showMentionMenu: function () {}, hideMentionMenu: function () {}, isMentionMenuVisible: function () { return false; },
    mentionMenuKeydown: function () { return false; }, setMentionAtIdx: function () {}, parseMentionFromInput: function () { return null; }, clearMentionState: function () {}, stickyReapplyMention: function () {},
    sendMention: function () {}, sendUserMention: function () {}, renderMentionUser: function () {}, renderUserMention: function () {}, removeMentionChip: function () {},
    sendAcknowledgedMessage: function () {}, mateAvatarUrl: function () { return "" }, tuiIsActive: function () { return false; }, tuiSubmitText: function () {},
    VENDOR_AVATARS: {}, VENDOR_NAMES: {}, showToast: function () {}, isShellCommandMode: function () { return false; }, submitShellCommand: function () { return false; },
    showPasteModal: function () {}, prepareAutonomousPayload: function () { return true; },
  };
  var domNode = function () { return { classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, style: {}, value: "", querySelector: function () { return null; }, appendChild: function () {}, remove: function () {} }; };
  var sandbox = {
    window: {}, document: { getElementById: function () { return domNode(); }, querySelector: function () { return domNode(); } },
    setTimeout: function () {}, clearTimeout: function () {}, setInterval: function () {}, clearInterval: function () {}, console: console,
    CustomEvent: function () {}, store: context.store, iconHtml: context.iconHtml, refreshIcons: context.refreshIcons, setRewindMode: context.setRewindMode,
    isRewindMode: context.isRewindMode, renderContextPicker: context.renderPicker, checkForMention: context.checkForMention, showMentionMenu: context.showMentionMenu,
    hideMentionMenu: context.hideMentionMenu, isMentionMenuVisible: context.isMentionMenuVisible, mentionMenuKeydown: context.mentionMenuKeydown, setMentionAtIdx: context.setMentionAtIdx,
    parseMentionFromInput: context.parseMentionFromInput, clearMentionState: context.clearMentionState, stickyReapplyMention: context.stickyReapplyMention, sendMention: context.sendMention,
    sendUserMention: context.sendUserMention, renderMentionUser: context.renderMentionUser, renderUserMention: context.renderUserMention, removeMentionChip: context.removeMentionChip,
    sendAcknowledgedMessage: context.sendAcknowledgedMessage, mateAvatarUrl: context.mateAvatarUrl, tuiIsActive: context.tuiIsActive, tuiSubmitText: context.tuiSubmitText,
    VENDOR_AVATARS: {}, VENDOR_NAMES: {}, showToast: context.showToast, isShellCommandMode: context.isShellCommandMode, submitShellCommand: context.submitShellCommand,
    showPasteModal: context.showPasteModal, prepareAutonomousPayload: context.prepareAutonomousPayload,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  var input = { value: "caption", style: {}, focus: function () {} };
  var imagePreviewBar = { innerHTML: "", classList: { add: function () {}, remove: function () {} } };
  var socket = { send: function (value) { sent.push(JSON.parse(value)); } };
  sandbox.__setInputContext({ inputEl: input, imagePreviewBar: imagePreviewBar, slashMenu: domNode(), slashCommands: function () { return []; }, ws: socket, connected: true, processing: false, isDebateEndedMode: function () { return false; }, isDebateConcludeMode: function () { return false; }, isDebateFloorMode: function () { return false; }, isDmMode: function () { return false; }, isMateDm: function () { return false; }, hideSuggestionChips: function () {}, currentMsgTs: null });
  sandbox.setScheduleDelayMs(60000);
  var image = { mediaType: "image/png", data: "image" };
  sandbox.__setPending([image], [{ text: "paste", preview: "paste" }], []);
  sandbox.sendMessage();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].images, [image]);
  assert.deepEqual(sent[0].pastes, ["paste"]);
  assert.equal(input.value, "caption");
  var requestId = sent[0].requestId;
  sandbox.sendMessage();
  assert.equal(sent[1].requestId, requestId);
  sandbox.handleScheduleMessageResult({ requestId: requestId, projectSlug: "project-a", sessionId: 7, accountId: "user-a", ok: false, error: "rejected" });
  assert.equal(input.value, "caption");
  sandbox.handleScheduleMessageResult({ requestId: requestId, projectSlug: "project-a", sessionId: 7, accountId: "user-a", ok: true });
  assert.equal(input.value, "");
  assert.equal(imagePreviewBar.innerHTML, "");
  sandbox.setScheduleDelayMs(60000);
  input.value = "first";
  sandbox.__setPending([image], [], []);
  sandbox.sendMessage();
  var firstRequestId = sent[2].requestId;
  input.value = "newer";
  sandbox.sendMessage();
  var newerRequestId = sent[3].requestId;
  assert.notEqual(newerRequestId, firstRequestId);
  sandbox.handleScheduleMessageResult({ requestId: firstRequestId, projectSlug: "project-a", sessionId: 7, accountId: "user-a", ok: true });
  assert.equal(input.value, "newer");
  state.connected = false;
  listeners.forEach(function (listener) { listener(state, { currentSlug: "project-a", activeSessionId: 7, myUserId: "user-a", connected: true }); });
  sandbox.handleScheduleMessageResult({ requestId: newerRequestId, projectSlug: "project-a", sessionId: 7, accountId: "user-a", ok: true });
  assert.equal(input.value, "newer");
});
