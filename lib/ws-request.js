var url = require("url");

function parseWsRequestUrl(requestUrl) {
  var parsed = url.parse(requestUrl || "/", true);
  var paneSession = Number(parsed.query.session);
  if (!Number.isSafeInteger(paneSession) || paneSession < 1) paneSession = null;
  return {
    path: parsed.pathname || "/",
    pane: parsed.query.pane === "1",
    paneSession: paneSession,
    contextual: parsed.query.pane === "1" && parsed.query.contextual === "1",
  };
}

module.exports = { parseWsRequestUrl: parseWsRequestUrl };
