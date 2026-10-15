function loginPrompt(event, preview, provider) {
  if (event.cost && event.cost !== 0 || String(preview || '').length >= 100) return false;
  var text = String(preview || '').trim();
  if (/not logged in/i.test(text) && /\/login/i.test(text)) return true;
  var policy = require('./provider-contract').resolve(provider);
  return typeof policy.authenticationReply === 'function' && policy.authenticationReply(text);
}
function authenticationReply(text) { return /^Failed to authenticate: OAuth session expired and could not be refreshed\.?$/i.test(text); }
function isAuthenticationError(detail) {
  var text = String(detail || '').toLowerCase();
  return /not logged in|unauthenticated|authentication|sign in|log in|please login/.test(text);
}
function normalize(event, preview, provider) {
  if (!event || event.yokeType !== "result") return event;
  return Object.assign({}, event, { authenticationRequired: event.authenticationRequired === true || loginPrompt(event, preview, provider) });
}
module.exports = { normalize: normalize, loginPrompt: loginPrompt, authenticationReply: authenticationReply, isAuthenticationError: isAuthenticationError };
