var github = require("./session-github");
var linear = require("./linear-api");

function matchingSavedLinks(links, parseReference, matchesReference) {
  if (!Array.isArray(links)) return [];
  var matches = new Map();
  links.forEach(function (link) {
    if (!link) return;
    var reference;
    try { reference = parseReference(link.url); }
    catch (error) { return; }
    if (matchesReference(reference)) matches.set(reference.url.toLowerCase(), { kind: reference.kind || "linear", url: reference.url });
  });
  return Array.from(matches.values());
}

function workLinkMatcher(value, scopes) {
  var githubRef = (scopes.includes("pr") || scopes.includes("issue")) &&
    value.match(/^(?:([^#/\s]+\/[^#/\s]+)#)?([1-9][0-9]*)$/);
  var repository = githubRef && githubRef[1] && githubRef[1].toLowerCase();
  var identifier = scopes.includes("linear") && /^[a-z][a-z0-9_]*-[1-9][0-9]*$/i.test(value) && value.toUpperCase();
  var suffix = scopes.includes("linear") && /^[1-9][0-9]*$/.test(value) && "-" + value;
  if (!githubRef && !identifier && !suffix) return null;
  function matchGitHub(reference) {
    return scopes.includes(reference.kind) && String(reference.number) === githubRef[2] &&
      (!repository || reference.repository.toLowerCase() === repository);
  }
  function matchLinear(reference) { return reference.identifier === identifier || (suffix && reference.identifier.endsWith(suffix)); }
  return function (session) {
    var matches = githubRef ? matchingSavedLinks(session.githubLinks, github.parseReference, matchGitHub) : [];
    return identifier || suffix ? matches.concat(matchingSavedLinks(session.linearLinks, linear.parseReference, matchLinear)) : matches;
  };
}

module.exports = { workLinkMatcher: workLinkMatcher };
