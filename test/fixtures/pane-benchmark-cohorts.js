import { store } from '/p/reuse/modules/store.js';
import { getCachedSessions } from '/p/reuse/modules/sidebar-sessions.js';
import { getWs } from '/p/reuse/modules/ws-ref.js';

function members(count) {
  if ([1, 4, 8].indexOf(count) === -1) throw new Error('Choose 1, 4 or 8 panes.');
  return Array.from({ length: count }, function (_, index) {
    var session = getCachedSessions().find(function (item) { return item.title === 'Benchmark ' + count + ' pane ' + index; });
    if (!session) throw new Error('Restart the updated fixture to seed the benchmark sessions.');
    return session;
  });
}
function matchingView(sessions) {
  var origins = sessions.map(function (session) { return session.sessionOriginId; });
  return (store.get('projectSplitViews') || []).find(function (view) {
    return view.sessions.length === origins.length && view.sessions.every(function (member) { return origins.indexOf(member.sessionOriginId) >= 0; });
  });
}
function visible(selector) {
  var candidates = Array.from(document.querySelectorAll(selector)).filter(function (node) { return node.getClientRects().length > 0; });
  if (candidates.length !== 1) throw new Error('Expected one visible cohort target; found ' + candidates.length + '.');
  return candidates[0];
}
function receipt() { var state = store.snap(); return { owner: state.myUserId, slug: state.currentSlug, socket: getWs(), generation: state.projectSplitViewSocketGeneration }; }
function current(target) { var state = store.snap(); return state.connected && state.myUserId === target.owner && state.currentSlug === target.slug && getWs() === target.socket && state.projectSplitViewSocketGeneration === target.generation; }
function waitFor(check, label, target) {
  var started = performance.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (!current(target)) { reject(new Error('Cohort context changed.')); return; }
      if (check()) { resolve(); return; }
      if (performance.now() - started > 30000) { reject(new Error(label + ' exceeded 30 seconds.')); return; }
      requestAnimationFrame(poll);
    }
    poll();
  });
}
export function openBenchmarkCohort(count) {
  var sessions = members(count), view = count > 1 && matchingView(sessions);
  if (count > 1 && !view) throw new Error('Prepare the ' + count + '-pane cohort first.');
  var target = view ? visible('.split-view-group[data-split-view-id="' + view.id + '"][data-split-view-surface="desktop"] .split-view-group-open') : visible('.session-item[data-session-id="' + sessions[0].id + '"]');
  target.click();
}
export async function prepareBenchmarkCohort(count) {
  if (!store.get('projectSplitViewHydrated') || !store.get('connected')) throw new Error('Wait for project hydration before preparing a cohort.');
  var target = receipt(), sessions = members(count), origins = sessions.map(function (session) { return session.sessionOriginId; });
  if (store.get('projectSplitViewPending')) throw new Error('Wait for the current presentation change to finish.');
  var view = count > 1 && matchingView(sessions);
  if (!view) {
    visible('.session-item[data-session-id="' + sessions[0].id + '"]').click();
    await waitFor(function () { return store.get('activeSessionId') === sessions[0].id && !store.get('projectSplitViewActiveId'); }, 'singleton selection', target);
    if (!current(target)) throw new Error('Cohort context changed.');
    if (count > 1) {
      document.dispatchEvent(new CustomEvent('clay-split-view-create', { detail: { origins: origins } }));
      await waitFor(function () { return !store.get('projectSplitViewPending') && !!matchingView(sessions); }, 'cohort persistence', target);
    }
  }
  if (!current(target)) throw new Error('Cohort context changed.');
  openBenchmarkCohort(count);
  await waitFor(function () {
    var active = matchingView(sessions), frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not([hidden]) .split-pane-frame'));
    return (count === 1 ? !store.get('projectSplitViewActiveId') : active && active.id === store.get('projectSplitViewActiveId')) &&
      !store.get('projectSplitViewPending') && origins.indexOf(store.get('sessionOriginId')) >= 0 && frames.length === count && frames.every(function (frame) {
        var live = frame.clayPane && frame.clayPane.identity();
        return live && live.ready && origins.indexOf(frame.dataset.sessionOriginId) >= 0 && live.binding.sessionOriginId === frame.dataset.sessionOriginId;
      });
  }, 'cohort readiness', target);
  return { count: count, origins: origins };
}
