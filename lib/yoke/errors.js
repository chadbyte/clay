function classify(provider, text) {
  var service = require('./provider-contract').resolve(provider).classifyError;
  return typeof service === 'function' ? service(text) : null;
}
function contextOverflow(error) {
  return /prompt is too long|context_length|maximum context length/i.test(String(error || ""));
}
module.exports = { contextOverflow: contextOverflow, classify: classify };
