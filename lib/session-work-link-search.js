var github = require("./session-github");
var linear = require("./linear-api");

function matchesSavedLink(links, parseReference, matchesReference) {
  return Array.isArray(links) && links.some(function (link) {
    if (!link) return false;
    var reference;
    try { reference = parseReference(link.url); }
    catch (error) { return false; }
    return matchesReference(reference);
  });
}

// Reserve explicit prefixes, including partial input, for saved-link search.
function parseWorkLinkFilter(query) {
  var filter = query.trim().match(/^(pr|issue|linear):([\s\S]*)$/i);
  return filter ? { kind: filter[1].toLowerCase(), value: filter[2] } : null;
}

function workLinkMatcher(value, scopes) {
  var githubRef = (scopes.includes("pr") || scopes.includes("issue")) &&
    value.match(/^(?:([^#/\s]+\/[^#/\s]+)#)?([1-9][0-9]*)$/);
  var repository = githubRef && githubRef[1] && githubRef[1].toLowerCase();
  var identifier = scopes.includes("linear") && /^[a-z][a-z0-9_]*-[1-9][0-9]*$/i.test(value) && value.toUpperCase();
  if (!githubRef && !identifier) return null;
  function matchGitHub(reference) {
    return scopes.includes(reference.kind) && String(reference.number) === githubRef[2] &&
      (!repository || reference.repository.toLowerCase() === repository);
  }
  function matchLinear(reference) { return reference.identifier === identifier; }
  return function (session) {
    return (githubRef && matchesSavedLink(session.githubLinks, github.parseReference, matchGitHub)) ||
      (identifier && matchesSavedLink(session.linearLinks, linear.parseReference, matchLinear));
  };
}

module.exports = { workLinkMatcher: workLinkMatcher, parseWorkLinkFilter: parseWorkLinkFilter };
