import { visibleTarget } from './clay-control-target-visibility.js';
import { store } from './store.js';

function node(selector, id, revision, field) {
  return Array.from(document.querySelectorAll(selector)).find(function (item) {
    return item.dataset[field] === id && item.dataset.controlRevision === String(revision) && item.dataset.controlRuntime === store.get('controlRuntimeId');
  });
}
// Fixed object adapters verify authoritative client state before locating rendered identities.
export function detailedControlTarget(target) {
  if (target.kind === 'notifications') {
    var notifications = store.get('clayControlNotifications') || [];
    var nodes = target.items.map(function (item) {
      if (!notifications.some(function (saved) { return saved.id === item.id && saved.controlRevision === item.revision; })) return null;
      return Array.from(document.querySelectorAll('.notif-banner[data-notif-id]')).find(function (el) { return el.dataset.notifId === item.id && el.dataset.controlRevision === item.revision; });
    });
    return nodes.every(function (item) { return visibleTarget(item); }) ? nodes.length === 1 ? nodes[0] : nodes[0].parentElement : null;
  }
  if (target.projectSlug !== store.get('currentSlug') || target.runtimeId !== store.get('controlRuntimeId')) return null;
  if (target.kind === 'git-set') {
    var git = store.get('clayControlGitView');
    if (!git || git.repository !== target.repository || git.runtimeId !== target.runtimeId || git.projectSlug !== target.projectSlug) return null;
    var rows = target.files.map(function (file) { return git.files.some(function (saved) { return saved.path === file.path && saved.revision === file.revision; }) && node('.git-file-row', file.path, file.revision, 'controlGitPath'); });
    if (!rows.every(function (item) { return visibleTarget(item); })) return null;
    return document.querySelector('#git-panel-body');
  }
  if (target.kind !== 'knowledge' || !target.objectId) return null;
  var main = (store.get('mateKnowledgeWorkspaces') || {})[target.projectSlug];
  if (!main) return null;
  if (target.object === 'document') {
    var file = main.files.concat(main.deletedFiles || []).find(function (item) { return !item.common && item.id === target.objectId && item.name === target.name && String(item.revision) === target.revision; });
    return file && node('.knowledge-file-row', 'local:' + file.id, target.revision, 'openDocument');
  }
  if (target.object === 'database') {
    var database = main.files.find(function (item) { return !item.common && item.id === target.databaseId && String(item.revision) === target.revision; });
    return database && node('.knowledge-file-row', 'local:' + target.databaseId, target.revision, 'openDocument');
  }
  var db = ((store.get('mateKnowledgeDatabaseWorkspaces') || {})[target.projectSlug] || {}).databases;
  var view = db && db[target.databaseId];
  if (!view || !view.database || String(view.database.revision) !== target.databaseRevision) return null;
  if (target.object === 'database') return node('.knowledge-file-row', 'local:' + target.databaseId, target.revision, 'openDocument');
  var record = (view.records || []).concat(view.recordDetail && view.recordDetail.record || []).find(function (item) { return item.id === target.objectId && String(item.revision) === target.revision; });
  return record && Array.from(document.querySelectorAll('[data-db-record][data-db-database]')).find(function (item) { return item.dataset.dbRecord === record.id && item.dataset.dbDatabase === target.databaseId && item.dataset.controlRevision === target.revision && item.dataset.controlRuntime === target.runtimeId; });
}
