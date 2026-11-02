// A declaration and an actual exact-query method are both required.
var UNSUPPORTED = 'Force termination is not yet supported for this vendor';
function support(provider, handle) {
  var declared = require('./provider-contract').resolve(provider).forceTermination === true;
  if (!declared) return { supported: false, reason: UNSUPPORTED };
  if (!handle || typeof handle.forceStop !== 'function') return { supported: false, reason: 'Force termination is unavailable for this session runtime' };
  return { supported: true, scope: 'query-runtime', externalEffects: 'unconfirmed' };
}
function operation(provider, handle) {
  var state = support(provider, handle);
  if (!state.supported) throw new Error(state.reason);
  var method = handle.forceStop;
  return function () {
    var timer, effect;
    try { effect = method.call(handle); } catch (error) { effect = Promise.reject(error); }
    return Promise.race([Promise.resolve(effect), new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(null); }, 6000);
    })]).then(function (result) {
      if (!result || result.status !== 'terminated' || result.scope !== 'query-runtime') {
        return { status: 'unconfirmed', scope: 'query-runtime', externalEffects: 'unconfirmed' };
      }
      return { status: 'terminated', scope: 'query-runtime', externalEffects: 'unconfirmed' };
    }).finally(function () { clearTimeout(timer); });
  };
}
module.exports = { support: support, operation: operation, UNSUPPORTED: UNSUPPORTED };
