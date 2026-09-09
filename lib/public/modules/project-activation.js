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
