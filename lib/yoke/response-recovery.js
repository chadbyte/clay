// Explicit provider implementation, with a live binding to the implementation
// selected for this session. Stop always reaches the originally bound service.
function attachResponseRecovery(ctx) {
  var managers = new Map(), bindings = new WeakMap();
  function policy(session) {
    return require('./provider-contract').resolve(ctx.getProvider ? ctx.getProvider(session) : session.vendor || 'claude');
  }
  function manager(session, create) {
    if (!create) return bindings.get(session) || null;
    var factory = policy(session).recoveryFactory;
    var previous = bindings.get(session);
    if (factory === undefined) {
      if (previous) previous.cancel(session);
      bindings.delete(session);
      return null;
    }
    if (typeof factory !== 'function') throw new Error('Provider recovery implementation is unavailable.');
    if (!managers.has(factory)) {
      var context = Object.assign({}, ctx, { isCurrentProvider: function(target) { return policy(target).recoveryFactory === factory; } });
      var service = factory(context);
      ['begin', 'enqueue', 'event', 'progress', 'cancel', 'current', 'valid', 'stopping', 'dispose'].forEach(function(name) {
        if (!service || typeof service[name] !== 'function') throw new Error('Provider recovery implementation is missing ' + name + '.');
      });
      managers.set(factory, service);
    }
    var selected = managers.get(factory);
    if (previous && previous !== selected) previous.cancel(session);
    bindings.set(session, selected);
    return selected;
  }
  var api = {};
  ['begin', 'enqueue', 'event', 'progress', 'cancel', 'current', 'valid', 'stopping'].forEach(function(name) {
    api[name] = function(session) {
      var service = manager(session, name === 'begin' || name === 'enqueue');
      return service ? service[name].apply(service, arguments) : name === 'stopping' || name === 'valid' ? false : null;
    };
  });
  api.dispose = function() { managers.forEach(function(service) { service.dispose(); }); managers.clear(); bindings = new WeakMap(); };
  return api;
}
module.exports = { attachResponseRecovery: attachResponseRecovery };
