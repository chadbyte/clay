import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var GITLAB_RESERVED = { admin: true, dashboard: true, explore: true, groups: true, help: true, profile: true, projects: true, public: true, search: true, snippets: true, users: true };

function parseTarget(href, provider) {
  if (typeof href !== "string" || !href) return null;
  var url;
  try { url = new URL(href); } catch (e) { return null; }
  if (url.protocol !== "https:" || url.hostname !== provider.host || url.port || url.username || url.password) return null;
  if (url.pathname.indexOf("//") !== -1 || /%(?:2f|5c)/i.test(url.pathname)) return null;
  var parts = url.pathname.split("/").filter(function (part) { return part !== ""; });
  var repoParts = parts;
  var resourceParts = [];
  if (provider.name === "github") {
    repoParts = parts.slice(0, 2); resourceParts = parts.slice(2);
  } else if (provider.separator) {
    var separator = parts.indexOf(provider.separator);
    if (separator !== -1) { repoParts = parts.slice(0, separator); resourceParts = parts.slice(separator + 1); }
  }
  if (repoParts.length < 2 || (provider.reserved && provider.reserved[repoParts[0].toLowerCase()])) return null;
  if (provider.ownerPattern && !provider.ownerPattern.test(repoParts[0])) return null;
  if (provider.repoPattern && !provider.repoPattern.test(repoParts[repoParts.length - 1])) return null;
  for (var i = 0; i < repoParts.length; i++) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(repoParts[i])) return null;
  }
  if (provider.name === "github" && repoParts.length !== 2) return null;
  if (provider.name === "gitlab" && resourceParts.length > 2) return null;
  var target = { url: url, provider: provider.name, icon: provider.icon, cssClass: provider.cssClass, owner: repoParts.slice(0, -1).join("/"), repo: repoParts[repoParts.length - 1], kind: "repository", label: repoParts.join("/") };
  if (!resourceParts.length) return target;
  if (provider.name === "github") {
    if (resourceParts.length === 1 && (resourceParts[0] === "issues" || resourceParts[0] === "pulls")) {
      target.kind = resourceParts[0]; target.label = resourceParts[0] === "issues" ? "Issues" : "Pull requests"; return target;
    }
    if (resourceParts.length === 2 && (resourceParts[0] === "issues" || resourceParts[0] === "pull") && /^\d+$/.test(resourceParts[1])) {
      target.kind = resourceParts[0] === "pull" ? "pull" : "issue"; target.number = resourceParts[1]; target.label = target.kind === "pull" ? "PR #" + target.number : "Issue #" + target.number; return target;
    }
    return null;
  }
  if (resourceParts.length === 1 && (resourceParts[0] === "issues" || resourceParts[0] === "merge_requests")) {
    target.kind = resourceParts[0] === "issues" ? "issues" : "merge_requests"; target.label = target.kind === "issues" ? "Issues" : "Merge requests"; return target;
  }
  if (resourceParts.length === 2 && (resourceParts[0] === "issues" || resourceParts[0] === "merge_requests") && /^\d+$/.test(resourceParts[1])) {
    target.kind = resourceParts[0] === "issues" ? "issue" : "merge_request"; target.number = resourceParts[1]; target.label = target.kind === "issue" ? "Issue #" + target.number : "MR !" + target.number; return target;
  }
  return null;
}

var GITHUB = { name: "github", displayName: "GitHub", host: "github.com", icon: "github", cssClass: "github-link-chip", ownerPattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, repoPattern: /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/ };
var GITLAB = { name: "gitlab", displayName: "GitLab", host: "gitlab.com", icon: "gitlab", cssClass: "gitlab-link-chip", separator: "-", reserved: GITLAB_RESERVED };

function plainLabel(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function hasCustomLabel(target, text) {
  var label = plainLabel(text);
  return !!label && label !== target.url.href;
}

function accessibleLabel(target, text) {
  var location = target.owner + "/" + target.repo;
  var detail = target.kind === "repository" ? "" : " · " + target.label;
  return hasCustomLabel(target, text) ? plainLabel(text) + " · " + location + detail : location + detail;
}

function chipMarkup(target, text) {
  var custom = hasCustomLabel(target, text);
  var primary = custom ? plainLabel(text) : target.owner + "/" + target.repo;
  var meta = custom ? target.owner + "/" + target.repo + (target.kind === "repository" ? "" : " · " + target.label) : (target.kind === "repository" ? "" : target.label);
  return iconHtml(target.icon, "github-link-icon") + '<span class="github-link-main">' + escapeHtml(primary) + '</span>' +
    (meta && primary !== target.label ? '<span class="github-link-kind">' + escapeHtml(meta) + '</span>' : "");
}

function renderHostedLink(href, title, text, provider) {
  var target = parseTarget(href, provider);
  if (!target) return null;
  return '<a class="' + provider.cssClass + ' hosted-link-chip" href="' + escapeHtml(target.url.href) + '" target="_blank" rel="noopener noreferrer"' +
    (title ? ' title="' + escapeHtml(title) + '"' : ' title="Open ' + escapeHtml(accessibleLabel(target, text)) + ' on ' + provider.displayName + '"') +
    ' aria-label="Open ' + escapeHtml(accessibleLabel(target, text)) + ' on ' + provider.displayName + '">' + chipMarkup(target, text) + '</a>';
}

export function githubLinkTarget(href) {
  var target = parseTarget(href, GITHUB);
  if (!target) return null;
  return { owner: target.owner, repo: target.repo, kind: target.kind, number: target.number || null, href: target.url.href, label: target.label };
}

export function gitlabLinkTarget(href) {
  var target = parseTarget(href, GITLAB);
  if (!target) return null;
  return { owner: target.owner, repo: target.repo, kind: target.kind, number: target.number || null, href: target.url.href, label: target.label };
}

export function renderGithubLink(href, title, text) { return renderHostedLink(href, title, text, GITHUB); }
export function renderGitlabLink(href, title, text) { return renderHostedLink(href, title, text, GITLAB); }

export function enhanceGithubLinks(root) {
  if (!root || typeof document === "undefined") return;
  var anchors = root.querySelectorAll("a[href]");
  for (var i = 0; i < anchors.length; i++) {
    var anchor = anchors[i];
    if (anchor.closest("code, pre")) continue;
    var target = parseTarget(anchor.getAttribute("href"), anchor.classList.contains("gitlab-link-chip") ? GITLAB : GITHUB);
    if (!target) { target = parseTarget(anchor.getAttribute("href"), GITLAB); if (!target) continue; }
    var text = anchor.textContent || "";
    if (anchor.classList.contains("github-link-chip") || anchor.classList.contains("gitlab-link-chip")) {
      anchor.setAttribute("target", "_blank"); anchor.setAttribute("rel", "noopener noreferrer"); continue;
    }
    anchor.classList.add("hosted-link-chip", target.cssClass); anchor.setAttribute("target", "_blank"); anchor.setAttribute("rel", "noopener noreferrer");
    anchor.setAttribute("aria-label", "Open " + accessibleLabel(target, text) + " on " + (target.provider === "gitlab" ? "GitLab" : "GitHub"));
    anchor.innerHTML = chipMarkup(target, text);
  }
  refreshIcons();
}
