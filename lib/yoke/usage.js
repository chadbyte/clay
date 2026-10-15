function number() {
  for (var i = 0; i < arguments.length; i++) if (typeof arguments[i] === 'number' && Number.isFinite(arguments[i]) && arguments[i] >= 0) return arguments[i];
  return null;
}
function accounting(value) {
  if (!value) return null;
  return Object.assign({}, value, { inputTokens: number(value.inputTokens, value.input_tokens), outputTokens: number(value.outputTokens, value.output_tokens),
    cacheReadInputTokens: number(value.cacheReadInputTokens, value.cache_read_input_tokens), cacheCreationInputTokens: number(value.cacheCreationInputTokens, value.cache_creation_input_tokens) });
}
function validateProjection(value) {
  value = value || {};
  var used = number(value.usedTokens), window = number(value.windowTokens);
  var measurement = ['observed', 'estimated', 'unavailable'].indexOf(value.measurement) >= 0 ? value.measurement : 'unavailable';
  var inflated = used !== null && window !== null && used > window;
  if (inflated || used === null || measurement === 'unavailable') { used = null; measurement = 'unavailable'; }
  return { usedTokens: used, windowTokens: window, measurement: measurement, source: inflated || measurement === 'unavailable' && window === null ? 'unavailable' : typeof value.source === 'string' ? value.source : 'unavailable' };
}
function context(value, provider) {
  if (!value) return null;
  if (value.context && value.context.measurement) return Object.assign({}, value, { context: validateProjection(value.context) });
  var policy = require('./provider-contract').resolve(provider);
  var projection = typeof policy.normalizeContext === 'function' ? policy.normalizeContext(value) : { usedTokens: null, windowTokens: null, measurement: 'unavailable', source: 'unavailable' };
  return Object.assign({}, value, { context: validateProjection(projection) });
}
function sdkContext(value) { return { usedTokens: number(value.totalTokens), windowTokens: number(value.maxTokens), measurement: value.unavailable ? 'unavailable' : value.measurement === 'estimated' ? 'estimated' : 'observed', source: 'claude_sdk_context_usage' }; }
function tokenContext(value) { return { usedTokens: number(value.input_tokens), windowTokens: number(value.contextWindow), measurement: value.unavailable ? 'unavailable' : value.measurement === 'estimated' ? 'estimated' : 'observed', source: 'adapter_context_usage' }; }
function turnContext(event) {
  var models = event.modelUsage || {}, entries = Object.keys(models);
  var result = { usedTokens: null, windowTokens: null, measurement: 'unavailable', source: 'unavailable' };
  for (var i = 0; i < entries.length; i++) {
    var value = models[entries[i]], snapshot = value.contextSnapshot;
    if (snapshot) return { usedTokens: snapshot.valid === true ? number(snapshot.inputTokens) : null, windowTokens: number(snapshot.contextWindow, value.contextWindow), measurement: snapshot.valid === true ? 'observed' : 'unavailable', source: 'last_turn' };
    result.windowTokens = number(value.contextWindow, result.windowTokens);
  }
  // Per-query accounting can contain many API calls. Never use its sum as
  // current occupancy. Only an actual last-call measurement is a valid estimate.
  result.usedTokens = number(event.lastStreamInputTokens);
  if (result.usedTokens !== null) { result.measurement = 'estimated'; result.source = 'last_call'; }
  return result;
}
function clientEvent(event, provider) {
  if (!event) return event;
  var info = require('./provider-contract').resolve(provider);
  if ((event.type === 'rate_limit' || event.type === 'rate_limit_usage') && !event.source && info.requiresQuotaSource) return Object.assign({}, event, { ignored: true });
  if (event.type !== 'result') return event;
  return Object.assign({}, event, { usage: accounting(event.usage), context: validateProjection(event.context || turnContext(event)) });
}
module.exports = { number: number, accounting: accounting, context: context, sdkContext: sdkContext, tokenContext: tokenContext, turnContext: turnContext, clientEvent: clientEvent };
