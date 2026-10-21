// One registry for the non-resource workbenches and their existing entrypoints.
export var WORKBENCH_PANELS = {
  'project-logs': { id: 'project-logs-panel', label: 'Logs', icon: 'notebook-text', open: 'openProjectLogs', load: function () { return import('./project-logs.js'); } },
  you: { id: 'you-panel', label: 'Me', icon: 'user', open: 'openYou', load: function () { return import('./you.js'); } },
  issues: { id: 'issues-panel', label: 'Issues', icon: 'circle-dot', open: 'openIssues', load: function () { return import('./issues.js'); } },
  linear: { id: 'linear-panel', label: 'Linear', icon: 'list-todo', open: 'openLinear', load: function () { return import('./linear-panel.js'); } },
  'notes-browser': { id: 'notes-browser', label: 'Sticky Notes', icon: 'sticky-note', open: 'openNotesBrowser', load: function () { return import('./sticky-notes-browser.js'); } },
  'scheduled-tasks': { id: 'scheduled-tasks-panel', label: 'Scheduled Tasks', icon: 'calendar-clock', open: 'openScheduledTasks', load: function () { return import('./scheduled-tasks.js'); } },
  debates: { id: 'debates-workbench', label: 'Debates', icon: 'messages-square', open: 'openDebatesWorkbench', load: function () { return import('./debates-workbench.js'); } },
  'mcp-skills': { id: 'mcp-skills-workbench', label: 'MCP / Skills', icon: 'blocks', open: 'openMcpSkillsWorkbench', load: function () { return import('./mcp-skills-workbench.js'); } },
  'mate-knowledge': { id: 'mate-knowledge-workbench', label: 'Knowledge', icon: 'book-open', open: 'openKnowledgeWorkbench', load: function () { return import('./mate-knowledge-workbench.js'); } },
  wireframe: { id: 'wireframe-panel', label: 'Sketch', icon: 'panels-top-left', open: 'restoreWireframeWorkbench', load: function () { return import('./wireframe-workbench.js'); } }
};

export function setWorkbenchExpanded(name, expanded) {
  var definition = WORKBENCH_PANELS[name], panel = definition && document.getElementById(definition.id);
  if (!panel || panel.classList.contains('panel-fullscreen') === expanded) return;
  var button = panel.querySelector('header button[aria-label*="fullscreen"], header button[title*="fullscreen"]');
  if (button) button.click();
  else panel.classList.toggle('panel-fullscreen', expanded);
}
