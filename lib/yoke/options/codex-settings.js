// Provider setting validation and legacy wire projection. The host owns
// permission checks, the actual settings store and publication.
var config = require('./codex-defaults');
var actions = {
  set_codex_approval: { key: 'codexApproval', input: 'approval', choices: config.CODEX_APPROVAL_POLICIES, fallback: config.CODEX_DEFAULTS.approval },
  set_codex_sandbox: { key: 'codexSandbox', input: 'sandbox', choices: ['read-only', 'workspace-write', 'danger-full-access'], fallback: config.CODEX_DEFAULTS.sandbox },
  set_codex_websearch: { key: 'codexWebSearch', input: 'webSearch', choices: ['disabled', 'cached', 'live'], fallback: config.CODEX_DEFAULTS.webSearch },
};
function defaults() { return { codexApproval: config.CODEX_DEFAULTS.approval, codexSandbox: config.CODEX_DEFAULTS.sandbox, codexWebSearch: config.CODEX_DEFAULTS.webSearch }; }
function messages(settings) { return [Object.assign({ type: 'codex_config' }, config.getCodexConfig(settings))]; }
function change(message, settings) {
  var action = actions[message.type];
  if (!action) return null;
  var value = message[action.input];
  if (value == null || value === '') value = action.fallback;
  if (action.key === 'codexApproval' && value === 'on-failure') value = action.fallback;
  if (action.choices.indexOf(value) < 0) throw new Error('Unsupported provider setting value.');
  var patch = {}; patch[action.key] = value;
  return { patch: patch, messages: messages(Object.assign({}, settings, patch)) };
}
module.exports = { defaults: defaults, messages: messages, change: change };
