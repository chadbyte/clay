var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

var indexSource = source("lib/public/index.html");
var appSource = source("lib/public/app.js");
var hubSource = source("lib/public/modules/app-home-hub.js");
var chatSource = source("lib/public/modules/home-mate-chat.js");
var streamStateSource = source("lib/public/modules/home-chat-stream-state.js");
var messagesSource = source("lib/public/modules/app-messages.js");
var settingsSource = source("lib/public/modules/home-mate-settings.js");
var modelPickerSource = source("lib/public/modules/home-mate-model-picker.js");
var serverSource = source("lib/server-home-chat.js");
var serverEventsSource = source("lib/server-home-chat-events.js");
var serverModelsSource = source("lib/server-home-models.js");
var sidebarCss = source("lib/public/css/home-sidebar.css");
var hubCss = source("lib/public/css/home-hub.css");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="sidebar-column"'));

test("Model is available through Mate Settings rather than the first-depth sidebar", function () {
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-model"|id="home-sidebar-model-value"/);
  assert.doesNotMatch(hubSource, /home-sidebar-model|defaultModel|modelValue/);
  assert.match(settingsSource, /var sections = \["general", "model", "memory", "knowledge"\]/);
  assert.match(settingsSource, /renderHomeMateModelPicker\(body, renderDialogContent\)/);
  assert.match(messagesSource, /case "mate_updated":[\s\S]*store\.set\(\{ cachedMatesList: _cml \}\)/);
  assert.doesNotMatch(sidebarCss, /home-sidebar-model-action|home-sidebar-action-value/);
});

test("composer presents concrete, loading, or accessible Choose model states", function () {
  assert.match(homeMarkup, /home-mate-chat-composer-frame[\s\S]*home-mate-chat-composer[\s\S]*id="home-mate-chat-input"[\s\S]*id="home-mate-chat-session-model"[^>]*role="status"[^>]*aria-live="polite"[^>]*title="Model for this conversation: Loading model…"/);
  assert.match(homeMarkup, />Conversation model<\/span>[\s\S]*id="home-mate-chat-session-model-value">Loading model…<\/span>[\s\S]*id="home-mate-chat-session-model-choose"[^>]*>Choose model<\/button>/);
  assert.match(hubCss, /#home-mate-chat-session-model-choose \{[\s\S]*cursor: pointer/);
  assert.match(chatSource, /sessionModelEl\.setAttribute\("aria-label", "Model for this conversation: " \+ label\)/);
  assert.match(chatSource, /canChangeDraft[\s\S]*Choose a model for this draft conversation and future new conversations/);
  assert.match(chatSource, /sessionModelChooseEl\.addEventListener\("click"[\s\S]*openHomeMateSettings\(mate\.id, sessionModelChooseEl, \{ section: "model", sessionId: store\.get\('homeChatSessionId'\) \}\)/);
  assert.match(modelPickerSource, /clay:home-mate-model-confirmed[\s\S]*requestedSessionId: msg\.requestedSessionId[\s\S]*sessionApplied: msg\.sessionApplied === true/);
  assert.match(chatSource, /clay:home-mate-model-confirmed[\s\S]*handleHomeMateModelConfirmed\(event\.detail \|\| \{\}\)/);
  assert.match(chatSource, /handleHomeMateModelConfirmed\(msg\)[\s\S]*confirmedHomeSessionModel[\s\S]*homeChatSessionVendor: confirmed\.vendor[\s\S]*homeChatSessionModel: confirmed\.model/);
  assert.doesNotMatch(chatSource.slice(chatSource.indexOf("export function handleHomeMateModelConfirmed")), /msg\.ok/);
  assert.match(chatSource, /inputEl\.disabled = !mateId \|\| awaitingQuestion \|\| !hasCommittedSessionModel\(\)/);
  assert.match(chatSource, /sendBtn\.disabled = !mateId \|\| streaming \|\| awaitingQuestion \|\| !hasCommittedSessionModel\(\)/);
});

test("Home session model state resets before every Mate, session, and new-conversation open", function () {
  assert.match(appSource, /homeChatSessionModel: null,[\s\S]*homeChatSessionVendor: null,[\s\S]*homeChatSessionModelLoading: false/);
  assert.match(chatSource, /function resetHomeSessionModel\(sessionId\)[\s\S]*homeChatSessionModel: null,[\s\S]*homeChatSessionVendor: null,[\s\S]*homeChatSessionModelLoading: true/);
  assert.match(chatSource, /export function openHomeChat\(mateId\)[\s\S]*resetHomeSessionModel\(preferredSession\)/);
  assert.match(chatSource, /export function openHomeConversation\(mateId, sessionId\)[\s\S]*resetHomeSessionModel\(sessionId\)/);
  assert.match(chatSource, /export function startNewHomeConversation\(\)[\s\S]*requestHomeSession\(\{ type: "home_mate_new_session", mateId: mateId \}, null\)/);
  assert.match(chatSource, /message\.requestId = requestId[\s\S]*homeChatSessionModelLoading: true/);
});

test("correlated history owns the displayed model and stale sessions cannot overwrite it", function () {
  assert.match(serverSource, /type: "home_mate_history",[\s\S]*requestId: requestId \|\| null,[\s\S]*model: session\.model \|\| null,[\s\S]*vendor: session\.vendor \|\| null/);
  assert.match(chatSource, /function isCurrentSessionMessage\(msg\)[\s\S]*isOwnedHomeSessionMessage/);
  assert.match(streamStateSource, /msg\.requestId && msg\.requestId !== active\.requestId[\s\S]*msg\.sessionId !== active\.sessionId/);
  assert.match(chatSource, /handleHomeMateHistory\(msg\)[\s\S]*homeChatSessionModel: typeof msg\.model[\s\S]*homeChatSessionVendor: typeof msg\.vendor[\s\S]*homeChatSessionModelLoading: false/);
  assert.match(serverEventsSource, /transformEvent\(event, mateId, session, requestId, stableSessionId\)[\s\S]*model: session && session\.model \? session\.model : null,[\s\S]*vendor: session && session\.vendor \? session\.vendor : null/);
});

test("Home failures preserve request correlation while older uncorrelated errors remain compatible", function () {
  assert.match(serverSource, /function sendError\(ws, mateId, text, requestId, sessionId, code, details\)[\s\S]*sessionId: sessionId \|\| null,[\s\S]*requestId: requestId \|\| null/);
  assert.match(serverSource, /"Conversation not available\.", msg\.requestId \|\| null, msg\.sessionId \|\| null, "session_not_found"/);
  assert.match(serverSource, /var sendRequestId = msg\.requestId \|\| \(sendTap && sendTap\.requestId\) \|\| null/);
  assert.match(chatSource, /home_mate_send", mateId: mateId, sessionId: store\.get\('homeChatSessionId'\), requestId: activeSessionRequestId/);
  assert.match(chatSource, /handleHomeMateError\(msg\) \{\s*if \(!isCurrentSessionMessage\(msg\)\) return/);
  assert.match(streamStateSource, /if \(msg\.requestId && msg\.requestId !== active\.requestId\) return false/);
});

test("missing committed models require an explicit choice without default inference", function () {
  assert.match(chatSource, /if \(model\) return \(store\.get\('homeChatSessionVendor'\) \|\| "Vendor"\) \+ " · " \+ model;[\s\S]*return "Choose model"/);
  assert.match(chatSource, /msg\.code === "model_unavailable"[\s\S]*homeChatSessionModel: null,[\s\S]*homeChatSessionModelLoading: false/);
  assert.doesNotMatch(hubSource + chatSource + homeMarkup, /Vendor default|[A-Z][A-Za-z ]+ default/);
  assert.doesNotMatch(chatSource, /currentModel|model-picker|mate\.model/);
  assert.doesNotMatch(modelPickerSource, /currentModel|set_model|get_vendor_models/);
  assert.doesNotMatch(serverSource.slice(serverSource.indexOf("function sendHistory"), serverSource.indexOf("function handleMessage")), /found\.mate\.model/);
  assert.match(serverModelsSource, /selected = catalogModel\(models, catalog\.defaultModel\)[\s\S]*for \(var i = 0; i < models\.length && !selected; i\+\+\) selected = modelEntryValue\(models\[i\]\)/);
});
