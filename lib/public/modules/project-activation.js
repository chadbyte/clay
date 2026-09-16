// Pure project activation and Home-return selection helpers.

export function projectWsPath(slug) {
  return slug ? "/p/" + slug + "/ws" : null;
}

export function chooseProjectActivationTarget(projects, candidates) {
  var available = Array.isArray(projects) ? projects : [];
  var preferred = Array.isArray(candidates) ? candidates : [];
  for (var ci = 0; ci < preferred.length; ci++) {
    if (!preferred[ci]) continue;
    for (var pi = 0; pi < available.length; pi++) {
      if (available[pi] && !available[pi].isMate && available[pi].slug === preferred[ci]) return preferred[ci];
    }
  }
  for (var i = 0; i < available.length; i++) {
    if (available[i] && !available[i].isMate && available[i].slug) return available[i].slug;
  }
  return null;
}

export function isProjectActivationPending(state, slug, socket) {
  var target = projectWsPath(slug);
  return !!target
    && state.currentSlug === slug
    && state.wsPath === target
    && state.socketPath === target
    && !!socket
    && (socket.readyState === 0 || socket.readyState === 1);
}

export function isProjectActivated(state, slug, socket) {
  return isProjectActivationPending(state, slug, socket)
    && socket.readyState === 1
    && state.connected === true
    && state.activeProjectSlug === slug
    && state.sessionActivatedProjectSlug === slug;
}

export function isProjectContextConnected(state, slug, socket) {
  return isProjectActivationPending(state, slug, socket)
    && socket.readyState === 1
    && state.connected === true
    && state.activeProjectSlug === slug;
}

export function isProjectSessionReady(state, socket) {
  var target = projectWsPath(state.currentSlug);
  return !!socket
    && socket.readyState === 1
    && state.connected === true
    && !!state.currentSlug
    && state.wsPath === target
    && state.socketPath === target
    && state.activeProjectSlug === state.currentSlug
    && state.sessionActivatedProjectSlug === state.currentSlug
    && state.sessionListProjectSlug === state.currentSlug
    && state.splitGroupsProjectSlug === state.currentSlug;
}

export function splitPanesMatchProject(split, slug) {
  if (!split || !Array.isArray(split.panes) || split.panes.length !== 2 || !slug) return false;
  return split.panes[0].slug === slug && split.panes[1].slug === slug;
}

export function hasCurrentSplitGroup(split, groups) {
  if (!split || !split.groupId) return true;
  var members = split.panes && split.panes.map(function (pane) { return pane.sessionId; });
  if (!members || members.length !== 2) return false;
  var available = Array.isArray(groups) ? groups : [];
  for (var i = 0; i < available.length; i++) {
    var group = available[i];
    if (group.id !== split.groupId || !Array.isArray(group.members) || group.members.length !== 2) continue;
    if (group.members.indexOf(members[0]) !== -1 && group.members.indexOf(members[1]) !== -1) return true;
  }
  return false;
}

export function reconcileRestoredSplit(split, groups) {
  if (!split || !split.groupId) return { action: "none" };
  var available = Array.isArray(groups) ? groups : [];
  for (var i = 0; i < available.length; i++) {
    var group = available[i];
    if (group.id !== split.groupId) continue;
    var oldMembers = split.panes && split.panes.map(function (pane) { return pane.sessionId; });
    var members = Array.isArray(group.members) ? group.members : [];
    if (oldMembers && oldMembers.length === 2 && members.length === 2
        && members.indexOf(oldMembers[0]) !== -1 && members.indexOf(oldMembers[1]) !== -1) {
      return { action: "keep", group: group };
    }
    return { action: "rebuild", group: group };
  }
  return { action: "clear" };
}
