import { store } from './store.js';
import { getWs } from './ws-ref.js';

// Only serializable receipts enter store. The transport itself stays module-owned.
var layoutSocket = null;
var layoutSocketEpoch = 0;
var layoutContextEpoch = 0;
store.subscribe(function (state, previous) {
  var fields = ['projectSplitViewActiveId', 'projectSplitViewContextKey', 'currentSlug', 'currentProjectOwnerId', 'myUserId', 'projectSplitViewSocketGeneration', 'connected'];
  function activeVersion(value) {
    var view = (value.projectSplitViews || []).find(function (item) { return item.id === value.projectSplitViewActiveId; });
    return view ? JSON.stringify([view.revision, view.tree]) : '';
  }
  if (fields.some(function (key) { return state[key] !== previous[key]; }) || activeVersion(state) !== activeVersion(previous)) layoutContextEpoch++;
});
function socketEpoch() {
  var socket = getWs();
  if (socket !== layoutSocket) { layoutSocket = socket; layoutSocketEpoch++; }
  return layoutSocketEpoch;
}
export function layoutScope(view) {
  var state = store.snap();
  return view && { epoch: layoutContextEpoch, viewId: view.id, revision: view.revision, tree: JSON.stringify(view.tree),
    context: state.projectSplitViewContextKey, slug: state.currentSlug, owner: state.currentProjectOwnerId,
    viewer: state.myUserId, generation: state.projectSplitViewSocketGeneration, socketEpoch: socketEpoch() };
}
export function currentLayoutScope(receipt) {
  var state = store.snap();
  if (!receipt || state.connected === false || state.projectSplitViewActiveId !== receipt.viewId) return false;
  var view = (state.projectSplitViews || []).find(function (item) { return item.id === receipt.viewId; });
  return !!view && JSON.stringify(layoutScope(view)) === JSON.stringify(receipt);
}
export function presentationTree(view) {
  var receipt = store.get('projectSplitViewPreviewScope');
  return view && receipt && receipt.viewId === view.id && store.get('projectSplitViewPreviewTree') && currentLayoutScope(receipt) &&
    JSON.stringify(receipt) === JSON.stringify(layoutScope(view)) ?
    store.get('projectSplitViewPreviewTree') : view && view.tree;
}
export function bindingMatches(left, right) {
  return !!left && !!right && left.sessionId === right.sessionId && left.sessionOriginId === right.sessionOriginId &&
    left.generation === right.generation && left.requestId === right.requestId;
}
