// Serializable descriptions of implemented provider controls. Legacy setting
// keys and message names describe persistence compatibility, never authority.
var claude = {
  auto: true,
  permissionModes: [{ value: 'default', label: 'Ask' }, { value: 'plan', label: 'Plan' }, { value: 'acceptEdits', label: 'Auto-accept edits' }],
  thinking: { options: ['disabled', 'adaptive', 'budget'], budget: true },
};
var codex = {
  approval: { options: [{ value: 'never', label: 'Auto' }, { value: 'untrusted', label: 'Untrusted' }, { value: 'on-request', label: 'Ask' }], state: 'codexApproval', message: 'set_codex_approval', key: 'approval' },
  sandbox: { options: [{ value: 'read-only', label: 'Read Only' }, { value: 'workspace-write', label: 'Workspace' }, { value: 'danger-full-access', label: 'Full Access' }], state: 'codexSandbox', message: 'set_codex_sandbox', key: 'sandbox' },
  webSearch: { options: [{ value: 'disabled', label: 'Off' }, { value: 'cached', label: 'Cached' }, { value: 'live', label: 'Live' }], state: 'codexWebSearch', message: 'set_codex_websearch', key: 'webSearch' },
};
module.exports = { claude: claude, codex: codex };
