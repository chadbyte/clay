import { studioControlTarget } from './clay-studio-render.js';
import { store } from './store.js';
import { detailedControlTarget } from './clay-control-detail-targets.js';
import { contextualMateStamp } from './contextual-mate-identity.js';

// Server projections identify the object; fixed adapters only locate its rendered view.
export function objectControlTarget(target) {
  if (target.kind === 'surface') return studioControlTarget(target);
  var detailed = detailedControlTarget(target);
  if (['knowledge', 'notifications', 'git-set'].indexOf(target.kind) >= 0) return detailed;
  if (target.kind === 'mate') {
    var mate = (store.get('cachedMatesList') || []).find(function (item) { return item.id === target.mateId && !item.archived && !item.lifecycleDeletion && contextualMateStamp(item) === target.mateStamp; });
    if (!mate) return null;
    return Array.from(document.querySelectorAll('.icon-strip-project-mate[data-mate-id], .icon-strip-brand')).find(function (item) {
      return item.dataset.mateId === mate.id && item.dataset.controlMateStamp === target.mateStamp || mate.builtinKey === 'clay' && item.classList.contains('icon-strip-brand');
    });
  }
  var project = (store.get('projectsHubList') || []).find(function (item) { return item.slug === target.projectSlug && item.controlRuntimeId === target.runtimeId && item.contentAccess !== false; });
  if (target.kind === 'project') {
    if (!project) return null;
    return Array.from(document.querySelectorAll('#icon-strip-projects .icon-strip-item[href]')).find(function (item) { return item.dataset.controlRuntime === target.runtimeId && new URL(item.href, location.href).pathname === '/p/' + encodeURIComponent(target.projectSlug) + '/'; });
  }
  if (target.projectSlug !== store.get('currentSlug') || target.runtimeId !== store.get('controlRuntimeId')) return null;
  if (target.kind === 'record') {
    var selector = target.area === 'issues' ? '.issue-row[data-open-issue], .issue-detail[data-control-ref]' : '.project-log-row[data-ref]';
    return Array.from(document.querySelectorAll(selector)).find(function (item) {
      return (item.dataset.openIssue || item.dataset.controlRef || item.dataset.ref) === target.ref && item.dataset.controlRevision === target.revision && item.dataset.controlRuntime === target.runtimeId;
    });
  }
  if (target.kind === 'file') {
    var file = store.get('clayControlFileView');
    if (!file || file.path !== target.path || file.revision !== target.revision || file.projectSlug !== target.projectSlug || file.runtimeId !== target.runtimeId) return null;
    return document.querySelector('#file-viewer .file-viewer-header');
  }
  if (target.kind === 'git') {
    var git = store.get('clayControlGitView');
    if (!git || git.projectSlug !== target.projectSlug || git.runtimeId !== target.runtimeId || git.repository !== target.repository || !git.files.some(function (item) { return item.path === target.path && item.revision === target.revision; })) return null;
    return Array.from(document.querySelectorAll('.git-file-row[data-control-git-path]')).find(function (item) { return item.dataset.controlGitPath === target.path && item.dataset.controlRevision === target.revision && item.dataset.controlRuntime === target.runtimeId; });
  }
  if (target.kind === 'terminal') {
    var terminal = (store.get('clayControlTerminalViews') || []).find(function (item) { return item.id === target.id && item.identity === target.identity && item.revision === target.revision && item.runtimeId === target.runtimeId; });
    if (!terminal) return null;
    return Array.from(document.querySelectorAll('.terminal-tab[data-control-terminal-id]')).find(function (item) { return item.dataset.controlTerminalId === String(target.id) && item.dataset.controlRuntime === target.runtimeId; });
  }
  if (target.kind === 'schedule') {
    if (target.sessionId !== store.get('activeSessionId') || target.sessionOriginId !== store.get('sessionOriginId')) return null;
    var queue = store.get('pendingMessageQueue');
    var logical = queue && (queue.items || []).some(function (item) { return item.schedule && item.schedule.logicalScheduleId === target.id && item.schedule.logicalRevision === target.revision; });
    return Array.from(document.querySelectorAll('.scheduled-task-row[data-task-id], .pending-message-chip[data-control-schedule-id]')).find(function (item) { return (item.dataset.taskId === target.id || logical && item.dataset.controlScheduleId === target.id) && item.dataset.controlRevision === target.revision && item.dataset.controlRuntime === target.runtimeId; });
  }
  return null;
}
