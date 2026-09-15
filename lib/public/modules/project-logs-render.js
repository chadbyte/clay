// Project Logs rendering — ledger rows, entry detail, and discussion.
//
// Split from project-logs.js so both stay well inside the module size limit.
// This module owns markup only: it never talks to the WebSocket and never
// decides navigation. Callers pass in the handlers they want wired.

import { refreshIcons } from './icons.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';

// Priority is a stable enum, so its labels are known ahead of time.
var PRIORITY_LABELS = { normal: "Normal", important: "Important", urgent: "Urgent" };

// A comment is a proposal the Project Driver reviews, so its state is shown
// plainly rather than implying the ledger changed.
var COMMENT_STATUS_LABELS = {
  "pending": "Awaiting Project Driver review",
  "clarification-needed": "Project Driver asked a question",
  "incorporated": "Incorporated",
  "declined": "Declined",
};

// Categories are each project's own evolving vocabulary, so there is no label
// table: any kebab-case label is rendered readably by de-slugging it. Every
// category reaches the DOM through textContent, never markup, so an arbitrary
// label is displayed safely whatever it contains.
export function categoryLabel(value) {
  if (typeof value !== "string" || !value) return "Record";
  var words = value.split("-");
  var out = [];
  for (var i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    out.push(i === 0 ? words[i].charAt(0).toUpperCase() + words[i].slice(1) : words[i]);
  }
  return out.length ? out.join(" ") : "Record";
}

function actorLabel(actor) {
  var source = actor || {};
  return source.displayName || source.userName || source.userId || source.sessionKey || "Unknown author";
}

// Who authored a canonical record. The backend keeps full blame on the author
// object (userId, sessionKey, vendor), but a session-authored entry must not
// read as if the human owner wrote it: the Project Driver did. The owner is
// only the account the session ran under.
function authorLine(entry) {
  var actor = (entry && (entry.updatedBy || entry.createdBy)) || {};
  if (actor.type === "system") return actor.displayName || "Scheduled Tasks";
  if (actor.type === "session") {
    return actor.vendor ? "Project Driver (" + vendorLabel(actor.vendor) + ")" : "Project Driver";
  }
  return actorLabel(actor);
}

function vendorLabel(vendor) {
  if (typeof vendor !== "string" || !vendor) return "";
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

function formatTime(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); }
  catch (e) { return ""; }
}

function relativeTime(value) {
  if (!value) return "";
  var delta = Date.now() - value;
  if (delta < 0) return formatTime(value);
  var minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  var days = Math.floor(hours / 24);
  if (days < 30) return days + "d ago";
  return formatTime(value);
}

function setText(parent, selector, value) {
  var el = parent.querySelector(selector);
  if (el) el.textContent = value;
}

// --- List ----------------------------------------------------------------

// The filter control. A compact select, not a dashboard: it narrows the
// ledger without becoming a surface of its own.
export function renderFilter(container, categories, selected, onChange) {
  container.innerHTML = "";
  var select = document.createElement("select");
  select.id = "project-logs-category";
  select.className = "project-logs-filter";
  select.setAttribute("aria-label", "Filter by category");
  var all = document.createElement("option");
  all.value = "";
  all.textContent = "All categories";
  select.appendChild(all);
  for (var i = 0; i < categories.length; i++) {
    var option = document.createElement("option");
    option.value = categories[i];
    option.textContent = categoryLabel(categories[i]);
    select.appendChild(option);
  }
  select.value = selected || "";
  select.addEventListener("change", function () { onChange(select.value); });
  container.appendChild(select);
}

export function renderContextFilter(container, selected, isWorktree, onChange) {
  container.innerHTML = "";
  var select = document.createElement("select");
  select.id = "project-logs-context";
  select.className = "project-logs-filter project-logs-context-filter";
  select.setAttribute("aria-label", "Filter by change scope");
  var options = isWorktree
    ? [["current", "Current worktree"], ["project", "Project"], ["all", "All changes"]]
    : [["project", "Project"], ["all", "All changes"]];
  for (var i = 0; i < options.length; i++) {
    var option = document.createElement("option");
    option.value = options[i][0];
    option.textContent = options[i][1];
    select.appendChild(option);
  }
  select.value = selected || (isWorktree ? "current" : "project");
  select.addEventListener("change", function () { onChange(select.value); });
  container.appendChild(select);
}

function contextLabel(context) {
  if (!context || !context.changeSetId) return "";
  var label = context.branch || "Worktree change";
  if (context.status === "merged") return label + " · Merged";
  if (context.status === "archived") return label + " · Archived";
  return label + " · Active";
}

// One ledger row. Reveals what happened without opening the record: category,
// priority, title, summary, author, time, revision and comment counts.
function renderRow(entry, onOpen) {
  var row = document.createElement("button");
  row.type = "button";
  row.className = "project-log-row";
  row.dataset.ref = entry.ref;
  row.setAttribute("role", "listitem");

  var head = document.createElement("div");
  head.className = "project-log-row-head";

  var chip = document.createElement("span");
  chip.className = "project-log-chip";
  chip.dataset.category = entry.category || entry.kind || "progress";
  chip.textContent = categoryLabel(entry.category || entry.kind);
  head.appendChild(chip);

  if (entry.priority && entry.priority !== "normal") {
    var flag = document.createElement("span");
    flag.className = "project-log-priority";
    flag.dataset.priority = entry.priority;
    flag.textContent = PRIORITY_LABELS[entry.priority] || entry.priority;
    head.appendChild(flag);
  }

  var title = document.createElement("span");
  title.className = "project-log-row-title";
  title.textContent = entry.title || "Untitled log";
  head.appendChild(title);
  row.appendChild(head);

  if (entry.summary) {
    var summary = document.createElement("p");
    summary.className = "project-log-row-summary";
    summary.textContent = entry.summary;
    row.appendChild(summary);
  }

  var meta = document.createElement("div");
  meta.className = "project-log-row-meta";
  var parts = [authorLine(entry), relativeTime(entry.updatedAt || entry.createdAt)];
  if (entry.revisions > 1) parts.push("v" + entry.revisions);
  if (entry.commentCount > 0) {
    parts.push(entry.commentCount + (entry.commentCount === 1 ? " comment" : " comments"));
  }
  var context = contextLabel(entry.context);
  if (context) parts.push(context);
  meta.textContent = parts.filter(Boolean).join(" · ");
  row.appendChild(meta);

  row.addEventListener("click", function () { onOpen(entry.ref); });
  return row;
}

export function renderList(listEl, entries, onOpen, emptyState) {
  listEl.innerHTML = "";
  if (!entries.length) {
    var empty = document.createElement("div");
    empty.className = "project-logs-list-empty";
    empty.textContent = emptyState || "No logs yet. This project's agent sessions record decisions and work here.";
    listEl.appendChild(empty);
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    listEl.appendChild(renderRow(entries[i], onOpen));
  }
}

// --- Detail --------------------------------------------------------------

function renderComments(entry) {
  var wrap = document.createElement("section");
  wrap.className = "project-log-discussion";
  var heading = document.createElement("h2");
  var comments = entry.comments || [];
  heading.textContent = comments.length
    ? "Discussion (" + comments.length + ")"
    : "Discussion";
  wrap.appendChild(heading);

  if (!comments.length) {
    var none = document.createElement("p");
    none.className = "project-log-discussion-empty";
    none.textContent = "No comments yet.";
    wrap.appendChild(none);
  }
  for (var i = 0; i < comments.length; i++) {
    var comment = comments[i];
    var item = document.createElement("article");
    item.className = "project-log-comment";

    var meta = document.createElement("p");
    meta.className = "project-log-comment-meta";
    meta.textContent = actorLabel(comment.author) + " · " + relativeTime(comment.at);
    item.appendChild(meta);

    var body = document.createElement("p");
    body.className = "project-log-comment-body";
    body.textContent = comment.body || "";
    item.appendChild(body);

    var status = comment.status || "pending";
    var badge = document.createElement("span");
    badge.className = "project-log-comment-status-badge";
    badge.dataset.status = status;
    badge.textContent = COMMENT_STATUS_LABELS[status] || status;
    item.appendChild(badge);

    // The Driver's decision sits under the comment it answers.
    if (comment.review && comment.review.response) {
      var response = document.createElement("div");
      response.className = "project-log-comment-response";
      var responseMeta = document.createElement("p");
      responseMeta.className = "project-log-comment-response-meta";
      var parts = ["Project Driver"];
      if (comment.review.at) parts.push(relativeTime(comment.review.at));
      if (comment.review.revision) parts.push("revision " + comment.review.revision);
      responseMeta.textContent = parts.join(" · ");
      var responseBody = document.createElement("p");
      responseBody.className = "project-log-comment-response-body";
      responseBody.textContent = comment.review.response;
      response.appendChild(responseMeta);
      response.appendChild(responseBody);
      item.appendChild(response);
    }

    wrap.appendChild(item);
  }
  return wrap;
}

// A compact, read-only record of how the entry reached its current state.
// Metadata only: no bodies, and no revert control, because restoring a
// revision is the Project Driver's decision.
function renderHistory(entry) {
  var history = entry.history || [];
  if (history.length < 2) return null;
  var wrap = document.createElement("section");
  wrap.className = "project-log-history";
  var heading = document.createElement("h2");
  heading.textContent = "Version history (" + history.length + ")";
  wrap.appendChild(heading);

  var list = document.createElement("ol");
  list.className = "project-log-history-list";
  for (var i = history.length - 1; i >= 0; i--) {
    var revision = history[i];
    var row = document.createElement("li");
    row.className = "project-log-history-row";

    var label = document.createElement("span");
    label.className = "project-log-history-label";
    label.textContent = "v" + revision.revision;
    row.appendChild(label);

    var text = document.createElement("span");
    text.className = "project-log-history-text";
    var summary = [historyVerb(revision), relativeTime(revision.at)];
    if (revision.changed && revision.changed.length) summary.push(revision.changed.join(", "));
    text.textContent = summary.filter(Boolean).join(" · ");
    row.appendChild(text);

    if (revision.reason) {
      var reason = document.createElement("span");
      reason.className = "project-log-history-reason";
      reason.textContent = revision.reason;
      row.appendChild(reason);
    }
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function historyVerb(revision) {
  if (revision.op === "create") return "Created";
  if (revision.op === "incorporate") return "Incorporated a comment";
  if (revision.op === "revert") {
    return revision.revertedFrom ? "Reverted to v" + revision.revertedFrom : "Reverted";
  }
  if (revision.op === "link") return "Linked";
  return "Revised";
}

// The entry, full pane. People may comment and the project owner may delete;
// there is no edit affordance because canonical authorship belongs to agents.
export function renderDetail(detailEl, entry, handlers) {
  detailEl.innerHTML = "";
  if (!entry) return;

  var article = document.createElement("article");
  article.className = "project-log-document";

  var header = document.createElement("header");
  header.innerHTML =
    '<div class="project-log-doc-chips"></div>' +
    '<h1></h1>' +
    '<p class="project-log-doc-summary"></p>' +
    '<p class="project-log-byline"></p>';
  var chips = header.querySelector(".project-log-doc-chips");
  var chip = document.createElement("span");
  chip.className = "project-log-chip";
  chip.dataset.category = entry.category || entry.kind || "progress";
  chip.textContent = categoryLabel(entry.category || entry.kind);
  chips.appendChild(chip);
  if (entry.priority && entry.priority !== "normal") {
    var flag = document.createElement("span");
    flag.className = "project-log-priority";
    flag.dataset.priority = entry.priority;
    flag.textContent = PRIORITY_LABELS[entry.priority] || entry.priority;
    chips.appendChild(flag);
  }
  var context = contextLabel(entry.context);
  if (context) {
    var contextChip = document.createElement("span");
    contextChip.className = "project-log-context-chip";
    contextChip.dataset.status = entry.context.status || "active";
    contextChip.textContent = context;
    chips.appendChild(contextChip);
  }
  setText(header, "h1", entry.title || "Untitled log");
  setText(header, ".project-log-doc-summary", entry.summary || "");
  var byline = [
    "Revision " + (entry.revisions || 1),
    authorLine(entry),
    formatTime(entry.updatedAt || entry.createdAt),
  ].filter(Boolean).join(" · ");
  setText(header, ".project-log-byline", byline);
  if (handlers && handlers.canDelete && !entry.scheduledResult) {
    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "project-log-delete-button";
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i><span>Delete log</span>';
    deleteButton.addEventListener("click", function () { handlers.onDelete(entry); });
    header.appendChild(deleteButton);
  }
  article.appendChild(header);

  if (entry.scheduledResult && entry.scheduledResult.driverOriginId && handlers && handlers.onOpenSession) {
    var sessionButton = document.createElement("button");
    sessionButton.type = "button";
    sessionButton.className = "project-log-session-button";
    sessionButton.innerHTML = '<i data-lucide="external-link"></i><span>View session</span>';
    sessionButton.addEventListener("click", function () { handlers.onOpenSession(entry); });
    article.appendChild(sessionButton);
  }

  var markdown = document.createElement("div");
  markdown.className = "project-log-markdown md-content";
  markdown.innerHTML = renderMarkdown(entry.body || "");
  highlightCodeBlocks(markdown);
  article.appendChild(markdown);

  var history = renderHistory(entry);
  if (history) article.appendChild(history);
  article.appendChild(renderComments(entry));

  var form = document.createElement("form");
  form.className = "project-log-comment-form";
  form.innerHTML =
    '<label for="project-log-comment-input">Add a comment</label>' +
    '<textarea id="project-log-comment-input" rows="3" required placeholder="Add context, a correction, or a question."></textarea>' +
    '<p id="project-log-comment-status" class="project-log-comment-status" role="status"></p>' +
    '<div class="project-log-comment-actions"><button class="primary" type="submit">Comment</button></div>';
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var input = form.querySelector("#project-log-comment-input");
    var status = form.querySelector("#project-log-comment-status");
    var value = input.value.trim();
    if (!value) { status.textContent = "A comment cannot be empty."; return; }
    handlers.onComment(entry.ref, value, status, input);
  });
  article.appendChild(form);

  detailEl.appendChild(article);
  refreshIcons();
}
