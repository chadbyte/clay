var test = require("node:test");
var assert = require("node:assert");
var path = require("node:path");

function loadLinks() {
  return import("file://" + path.join(__dirname, "../lib/public/modules/github-links.js") + "?test=" + Date.now());
}

test("GitHub recognition is strict and preserves query and hash", async function () {
  var links = await loadLinks();
  assert.deepEqual(links.githubLinkTarget("https://github.com/ThroughLineCare/fs-handler-interviewer/pulls?tab=active#top"), {
    owner: "ThroughLineCare", repo: "fs-handler-interviewer", kind: "pulls", number: null,
    href: "https://github.com/ThroughLineCare/fs-handler-interviewer/pulls?tab=active#top", label: "Pull requests"
  });
  assert.equal(links.githubLinkTarget("https://github.com/a/b/issues/123").kind, "issue");
  assert.equal(links.githubLinkTarget("https://github.com/a/b/pull/9").kind, "pull");
  assert.equal(links.githubLinkTarget("https://github.com/a/b").kind, "repository");
  assert.equal(links.githubLinkTarget("http://github.com/a/b"), null);
  assert.equal(links.githubLinkTarget("https://github.com.evil/a/b"), null);
  assert.equal(links.githubLinkTarget("https://user:pass@github.com/a/b"), null);
  assert.equal(links.githubLinkTarget("https://www.github.com/a/b"), null);
  assert.equal(links.githubLinkTarget("https://github.com/a/b/blob/main/app.js"), null);
  assert.equal(links.githubLinkTarget("https://github.com/a//b"), null);
  assert.equal(links.githubLinkTarget("https://github.com/a%2Fb/c"), null);
  assert.equal(links.githubLinkTarget("https://github.com/-owner/repo"), null);
  assert.equal(links.githubLinkTarget("https://github.com/owner_name/repo"), null);
});

test("GitHub chips are accessible native links with meaningful custom labels", async function () {
  var links = await loadLinks();
  var html = links.renderGithubLink("https://github.com/a/b/issues/123?x=1#comments", "Issue link", "Review the issue");
  assert.match(html, /class="github-link-chip[^"]*"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /a\/b/);
  assert.match(html, /Review the issue/);
  assert.match(html, /Issue #123/);
  assert.match(html, /data-lucide="github"/);
  assert.match(html, /GitHub/);
});

test("GitLab recognizes nested namespaces and issue or merge-request routes", async function () {
  var links = await loadLinks();
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/group/subgroup/repo").owner, "group/subgroup");
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/group/subgroup/repo/-/issues?scope=all#open").kind, "issues");
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/group/subgroup/repo/-/issues/42").label, "Issue #42");
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/group/subgroup/repo/-/merge_requests/7").label, "MR !7");
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/groups/foo/-/issues"), null);
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/explore/projects"), null);
  assert.equal(links.gitlabLinkTarget("https://gitlab.com/-/profile"), null);
  assert.equal(links.gitlabLinkTarget("https://gitlab.example.com/group/repo"), null);
  assert.equal(links.gitlabLinkTarget("http://gitlab.com/group/repo"), null);
  assert.match(links.renderGitlabLink("https://gitlab.com/group/subgroup/repo/-/merge_requests/7", null, "Review"), /data-lucide="gitlab"/);
});

test("GitHub enhancement skips code and is idempotent", async function () {
  var links = await loadLinks();
  var githubClass = false;
  var restoredClass = true;
  var restoredTarget = null;
  var restoredRel = null;
  var githubAnchor = {
    classList: { contains: function () { return githubClass; }, add: function () { githubClass = true; } },
    getAttribute: function (name) { return name === "href" ? "https://github.com/a/b/pull/7" : null; },
    textContent: "https://github.com/a/b/pull/7",
    setAttribute: function () {},
    innerHTML: "",
    closest: function () { return null; }
  };
  var sanitizedAnchor = {
    classList: { contains: function (name) { return name === "github-link-chip" && restoredClass; }, add: function () { restoredClass = true; } },
    getAttribute: function (name) { return name === "href" ? "https://github.com/a/b/issues/3" : null; },
    textContent: "Issue",
    setAttribute: function (name, value) { if (name === "target") restoredTarget = value; if (name === "rel") restoredRel = value; },
    target: "",
    rel: "",
    innerHTML: "",
    closest: function () { return null; }
  };
  var codeAnchor = Object.assign({}, githubAnchor, { closest: function () { return {}; } });
  var root = { querySelectorAll: function () { return [githubAnchor, codeAnchor, sanitizedAnchor]; } };
  global.document = {};
  global.requestAnimationFrame = function (callback) { callback(); };
  global.lucide = { createIcons: function () {} };
  links.enhanceGithubLinks(root);
  assert.match(githubAnchor.innerHTML, /PR #7/);
  var firstMarkup = githubAnchor.innerHTML;
  links.enhanceGithubLinks(root);
  assert.equal(githubAnchor.innerHTML, firstMarkup);
  assert.equal(restoredTarget, "_blank");
  assert.equal(restoredRel, "noopener noreferrer");
  assert.equal(codeAnchor.innerHTML, "");
  delete global.document;
  delete global.requestAnimationFrame;
  delete global.lucide;
});

test("the direct Issue and Log enhancer path includes GitHub chips", function () {
  var source = require("node:fs").readFileSync(path.join(__dirname, "../lib/public/modules/clay-log-links.js"), "utf8");
  var markdown = require("node:fs").readFileSync(path.join(__dirname, "../lib/public/modules/markdown.js"), "utf8");
  assert.match(source, /import \{ enhanceGithubLinks \} from '\.\/github-links\.js'/);
  assert.match(source, /enhanceGithubLinks\(root\)/);
  assert.match(markdown, /DOMPurify\.sanitize\(marked\.parse\(normalized\), \{ ADD_ATTR: \["target", "rel"\] \}\)/);
  assert.match(markdown, /tokens && this\.parser && this\.parser\.parseInline/);
  var css = require("node:fs").readFileSync(path.join(__dirname, "../lib/public/css/messages.css"), "utf8");
  assert.match(css, /\.github-link-kind \{[^}]*min-width: 0[^}]*max-width: 65%[^}]*flex: 0 1 auto[^}]*overflow: hidden[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/s);
  assert.match(css, /\.md-content \.github-link-chip \{ color: var\(--text\); \}/);
  assert.match(css, /\.hosted-link-chip, \.github-link-chip \{/);
});
