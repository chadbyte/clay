var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

// Execute production socket cases, stream state, bubble construction and replay
// batching. Only DOM/layout, Markdown parsing and unrelated UI services are doubles.
function create(options) {
  options = options || {};
  function Element() { this.children = []; this.dataset = {}; this.className = ''; this.raw = ''; this.style = {}; }
  Element.prototype.appendChild = function (child) { if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this; return child; };
  Element.prototype.remove = function () { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(function (child) { return child !== this; }, this); this.parentNode = null; } };
  Element.prototype.setAttribute = function (name, value) { this[name] = value; };
  Element.prototype.addEventListener = function () {};
  Element.prototype.removeEventListener = function () {};
  Element.prototype.querySelectorAll = function (selector) {
    var found = [];
    function visit(node) { node.children.forEach(function (child) {
      var attr = selector.match(/^\[data-client-message-id="(.*)"\]$/);
      if (attr ? child.dataset.clientMessageId === attr[1] : child.className.split(' ').indexOf(selector.slice(1)) !== -1) found.push(child);
      visit(child);
    }); }
    visit(this); return found;
  };
  Element.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
  Object.defineProperty(Element.prototype, 'lastElementChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  Object.defineProperty(Element.prototype, 'classList', { get: function () {
    var self = this;
    return { contains: function (value) { return self.className.split(' ').indexOf(value) !== -1; },
      add: function (value) { if (!this.contains(value)) self.className += ' ' + value; }, remove: function () {} };
  } });
  Object.defineProperty(Element.prototype, 'textContent', { get: function () { return this.raw + this.children.map(function (child) { return child.textContent; }).join(''); },
    set: function (text) { this.children = []; this.raw = String(text); } });
  Object.defineProperty(Element.prototype, 'innerHTML', { get: function () { return this.raw; }, set: function (html) {
    this.children = []; this.raw = html;
    var self = this;
    Array.from(html.matchAll(/<(?:span|button)[^>]*class="([^"]+)"[^>]*>/g)).forEach(function (match) {
      var child = new Element(); child.className = match[1]; self.appendChild(child);
    });
  } });
  var messages = new Element();
  var calls = {};
  var errors = [];
  var frames = new Map(); var frameId = 0;
  var context = { console: Object.assign({}, console, { error: function (message) { errors.push(String(message)); } }), window: {}, document: { body: new Element(), hidden: false,
    createElement: function () { return new Element(); }, addEventListener: function () {}, removeEventListener: function () {}, getElementById: function () { return null; }, querySelectorAll: function () { return []; } },
    messagesEl: messages, getMessagesEl: function () { return messages; },
    renderMarkdown: function (text) { return text; },
    escapeHtml: function (text) { return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); },
    userAvatarUrl: function () { return '/owner.png'; }, iconHtml: function () { return ''; },
    resolveProjectAssistantIdentity: function () { return { avatarUrl: '/muse-avatar.svg', name: 'Muse Code' }; },
    applyProjectAssistantIdentity: function () {},
    requestAnimationFrame: function (fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: function (id) { frames.delete(id); },
    setTimeout: function () { return 1; }, clearTimeout: function () {},
    setStatus: function (status) { context.store.set({ status: status }); },
  };
  ['highlightCodeBlocks', 'renderMermaidBlocks', 'enhanceClaySessionLinks', 'refreshIcons', 'closeToolGroup',
    'beginMarkdownTurn', 'resetThinkingGroup', 'markAllToolsDone', 'stopThinking', 'setActivity', 'finishThinkingTurn',
    'clearAllImageGenerationProgress', 'addTurnMeta', 'accumulateUsage', 'accumulateContext', 'hideWorkerDelegationNotice',
    'enableMainInput', 'resetToolState', 'finishMarkdownTurn', 'stopUrgentBlink', 'updateHistorySentinel',
    'resumeThinkingAfterReplay', 'applyDeadSessionTodoCompaction', 'markContextUnavailable', 'updateContextPanel',
    'updateUsagePanel', 'isDebateActive', 'getPendingNavigate', 'handlePaletteHistoryDone',
    'renderPermissionRequest', 'markPermissionCancelled', 'markPermissionResolved', 'startUrgentBlink',
    'getTools', 'removeToolFromGroup', 'renderAskUserQuestion', 'markAskUserAnswered', 'getTodoTools', 'updateToolExecuting',
    'renderElicitationRequest', 'markElicitationResolved', 'renderUserDialogRequest', 'markUserDialogResolved'].forEach(function (name) {
      context[name] = function () { calls[name] = (calls[name] || 0) + 1; };
    });
  context.getTools = function () { return {}; };
  context.getTodoTools = function () { return {}; };
  vm.createContext(context);
  var base = path.join(__dirname, '../../lib/public/modules/');
  function load(file) {
    var source = fs.readFileSync(base + file, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/export /g, '');
    vm.runInContext(source, context, { filename: file });
  }
  load('store.js');
  context.createStore({ currentSlug: 'queue-project', activeSessionId: 'queue-session', currentVendor: 'muse', myUserId: 'owner', cachedAllUsers: [],
    currentMsgEl: null, currentFullText: '', sessionIsProcessing: true, vendorCapabilities: { rewind: false } });
  load('pane-binding.js');
  load('chat-render-runtime.js'); load('chat-bubble-renderer.js'); load('app-message-cards.js'); load('app-rendering.js'); load('history-replay-batch.js'); load('app-favicon.js');
  context.scrollToBottom = function () {}; context.forceScrollToBottom = function () {};
  context.armStickyBottom = function () {};
  context.setStatus = function (status) { context.store.set({ status: status }); };
  context.startUrgentBlink = function () { calls.startUrgentBlink = (calls.startUrgentBlink || 0) + 1; };
  context.stopUrgentBlink = function () {};
  var source = fs.readFileSync(base + 'app-messages.js', 'utf8');
  var cases = Array.from(source.matchAll(/^      case "([^"]+)":/gm));
  var wanted = ['user_message', 'assistant_boundary', 'delta', 'result', 'done', 'history_meta', 'history_done', 'status', 'turn_activity', 'error', 'permission_request', 'permission_cancel', 'permission_resolved', 'permission_request_pending', 'tool_start', 'tool_executing', 'ask_user_answered', 'elicitation_request', 'elicitation_resolved', 'user_dialog_request', 'user_dialog_resolved'];
  var clauses = cases.filter(function (match) { return wanted.indexOf(match[1]) !== -1; }).map(function (match) {
    var at = cases.indexOf(match); return source.slice(match.index, cases[at + 1].index);
  }).join('\n');
  var dispatch = vm.runInContext('(function(msg) { store.set({ currentHistoryIndex: msg._historyIndex, currentHistoryIndexes: msg._historyIndexes }); switch(msg.type) {\n' + clauses + '\n} })', context);
  var process = function (event) { try { dispatch(event); } catch (error) { errors.push(error.message); throw error; } };
  function frame() { var pending = Array.from(frames.values()); frames.clear(); pending.forEach(function (fn) { fn(); }); }
  return { context: context, messages: messages, calls: calls, errors: errors, dispatch: function (event) { process(event); if (options.animate) frame(); },
    activity: function () { var el = context.getActivityEl(); var label = el && el.querySelector('.activity-state-label'); return label && label.textContent || null; },
    replay: function (event) { context.receiveHistoryReplay(event, process); }, frame: frame,
    rows: function () { return messages.children.filter(function (row) { return row.classList.contains('msg-user') || row.classList.contains('msg-assistant'); }).map(function (row) {
      return { role: row.classList.contains('msg-user') ? 'user' : 'assistant', text: row.querySelector('.md-content') ? row.querySelector('.md-content').textContent : row.querySelector('.bubble').textContent };
    }); } };
}
module.exports = { create: create };
