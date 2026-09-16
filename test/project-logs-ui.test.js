var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

// The tool registry lives in tool-palette-order.js; tool-palette.js owns the DOM.
var paletteSource = source("lib/public/modules/tool-palette-order.js");
var logsSource = source("lib/public/modules/project-logs.js");
var renderSource = source("lib/public/modules/project-logs-render.js");
var appSource = source("lib/public/app.js");
var messagesSource = source("lib/public/modules/app-messages.js");
var mobileSource = source("lib/public/modules/sidebar-mobile.js");
var css = source("lib/public/css/project-logs.css");
var filebrowserCss = source("lib/public/css/filebrowser.css");

test("Project Logs occupies the project tool slot on desktop and mobile", function () {
  assert.match(paletteSource, /id: "project-logs-btn",\s+icon: "notebook-tabs",\s+label: "Logs"/);
  assert.match(mobileSource, /icon: "notebook-tabs", label: "Logs", action: "project-logs"/);
});

test("an exact rendered log reference opens its entry directly", function () {
  assert.match(logsSource, /export function openProjectLog\(ref\)/);
  assert.match(logsSource, /\^log:\[A-Za-z0-9_-\]\{24\}\$/);
  assert.match(logsSource, /openProjectLogs\(\);[\s\S]*requestEntry\(ref\);/);
});

test("there is no canonical create or edit UI, while the owner may delete", function () {
  var combined = logsSource + renderSource;
  // The ledger is authored by agent sessions, so the client must not offer or
  // send any canonical mutation.
  assert.equal(/project_log_create|project_log_update/.test(combined), false,
    "the client never sends a canonical mutation message");
  assert.equal(/New log|Create the first log|Save log/.test(combined), false, "no create affordance");
  assert.equal(/project-log-title-input|project-log-kind-input|project-log-content-input/.test(combined), false,
    "no entry editor fields");
  assert.equal(/renderEditor|project-log-edit\b/.test(combined), false, "no editor at all");
  assert.equal(/project-logs-new/.test(combined + css), false, "no create button styling either");

  // A human may comment, and the project owner may delete through a custom
  // confirmation dialog without gaining canonical edit authority.
  assert.match(logsSource, /type: "project_log_comment", requestId: requestId, ref: ref, body: body/);
  assert.match(renderSource, /handlers\.onComment\(entry\.ref, value, status, input\)/);
  assert.match(logsSource, /type: "project_log_delete", requestId: requestId, ref: pendingDeleteEntry\.ref/);
  assert.match(renderSource, /handlers && handlers\.canDelete[\s\S]*handlers\.onDelete\(entry\)/);
  assert.match(logsSource, /role="dialog" aria-modal="true"/);
});

test("the client uses store state, direct imports, and correlated requests", function () {
  assert.match(logsSource, /import \{ store \} from '\.\/store\.js'/);
  assert.match(logsSource, /import \{ getWs \} from '\.\/ws-ref\.js'/);
  assert.match(logsSource, /projectLogsListRequestId/);
  assert.match(logsSource, /projectLogsReadRequestId/);
  assert.match(logsSource, /projectLogsCommentRequestId/);
  assert.match(appSource, /projectLogsView: 'list'/);
  assert.match(appSource, /projectLogsCategory: ''/);
  assert.match(appSource, /projectLogsCommentRequestId: null/);
  assert.match(appSource, /projectLogsDeleteRequestId: null/);
  assert.match(appSource, /projectLogsCanDelete: false/);
  assert.match(messagesSource, /case "project_log_commented":[\s\S]*handleProjectLogCommented\(msg\)/);
  assert.match(messagesSource, /case "project_log_deleted":[\s\S]*handleProjectLogDeleted\(msg\)/);
  assert.equal(/project_log_saved/.test(messagesSource), false, "the retired response is no longer routed");
  [["project-logs.js", logsSource], ["project-logs-render.js", renderSource]].forEach(function (pair) {
    assert.equal(/=>/.test(pair[1]), false, "no arrow functions in " + pair[0]);
    assert.equal(/^\s*(const|let)\s/m.test(pair[1]), false, "var only in " + pair[0]);
    assert.equal(/localStorage|alert\(|confirm\(|prompt\(/.test(pair[1]), false, "no storage or native dialogs in " + pair[0]);
  });
});

test("Logs is one navigation stack, not a master/detail split", function () {
  // Two sibling regions in the pane, one visible at a time.
  assert.match(logsSource, /id="project-logs-list"/);
  assert.match(logsSource, /id="project-logs-detail"/);
  assert.equal(/project-logs-layout|project-logs-index/.test(logsSource + css), false,
    "the two-column frame is gone");
  assert.equal(/grid-template-columns/.test(css), false, "no split columns remain");

  var showList = logsSource.slice(logsSource.indexOf("function showList()"), logsSource.indexOf("function showDetail("));
  assert.match(showList, /detailEl\.classList\.add\("hidden"\)/);
  assert.match(showList, /listEl\.classList\.remove\("hidden"\)/);
  assert.match(showList, /backBtn\.classList\.add\("hidden"\)/);

  var showDetail = logsSource.slice(logsSource.indexOf("function showDetail(entry)"), logsSource.indexOf("// --- Requests"));
  assert.match(showDetail, /listEl\.classList\.add\("hidden"\)/);
  assert.match(showDetail, /detailEl\.classList\.remove\("hidden"\)/);
  assert.match(showDetail, /backBtn\.classList\.remove\("hidden"\)/);
});

test("Back returns to the list preserving query, filter, and scroll", function () {
  assert.match(logsSource, /id="project-logs-back"/);
  assert.match(logsSource, /backBtn\.addEventListener\("click", showList\)/,
    "Back returns directly to the preserved list");
  // Scroll is captured on the way in and restored on the way back.
  assert.match(logsSource, /store\.set\(\{ projectLogsListScroll: listEl\.scrollTop/);
  assert.match(logsSource, /listEl\.scrollTop = store\.get\('projectLogsListScroll'\) \|\| 0;/);
  // The list is re-shown rather than re-requested, so the search box and the
  // category select keep their values.
  var showList = logsSource.slice(logsSource.indexOf("function showList()"), logsSource.indexOf("function showDetail("));
  assert.equal(/requestList\(\)/.test(showList), false, "returning does not refetch and reset the query");
  assert.equal(/searchEl\.value = /.test(logsSource), false, "the query is never cleared");
});

test("detail renders Markdown through the shared renderer and shows the record metadata", function () {
  assert.match(renderSource, /import \{ renderMarkdown, highlightCodeBlocks \} from '\.\/markdown\.js'/);
  assert.match(renderSource, /markdown\.innerHTML = renderMarkdown\(entry\.body \|\| ""\)/);
  assert.match(renderSource, /highlightCodeBlocks\(markdown\)/);
  // Category, priority, revision, agent author and time, then the summary.
  assert.match(renderSource, /chip\.dataset\.category = entry\.category \|\| entry\.kind/);
  assert.match(renderSource, /flag\.dataset\.priority = entry\.priority/);
  assert.match(renderSource, /"Revision " \+ \(entry\.revisions \|\| 1\)/);
  assert.match(renderSource, /authorLine\(entry\)/);
  assert.match(renderSource, /setText\(header, "\.project-log-doc-summary", entry\.summary \|\| ""\)/);
});

test("a canonical entry is attributed to the Project Driver, not the account owner", function () {
  var authorFn = renderSource.slice(renderSource.indexOf("function authorLine(entry)"), renderSource.indexOf("function vendorLabel("));

  // The server keeps full blame on the author object, but a session-authored
  // record must not read as if the human owner wrote it.
  assert.match(authorFn, /if \(actor\.type === "session"\)/);
  assert.match(authorFn, /"Project Driver \(" \+ vendorLabel\(actor\.vendor\) \+ "\)" : "Project Driver"/);
  assert.equal(/actorLabel\(actor\)[\s\S]*actor\.type === "session"/.test(authorFn), false,
    "the owner display name is never used for a session-authored entry");

  // The vendor is title-cased, so it reads as "Project Driver (Claude)".
  assert.match(renderSource, /function vendorLabel\(vendor\)/);
  assert.match(renderSource, /vendor\.charAt\(0\)\.toUpperCase\(\) \+ vendor\.slice\(1\)/);

  // A human comment is still attributed to the human.
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("export function renderDetail"));
  assert.match(comments, /actorLabel\(comment\.author\)/);
  assert.equal(/authorLine/.test(comments), false, "a comment never borrows the canonical byline");
  assert.match(renderSource, /source\.displayName \|\| source\.userName \|\| source\.userId/,
    "actorLabel still prefers a human display name");

  // Both the ledger row and the detail byline use the canonical author line.
  assert.match(renderSource, /var parts = \[authorLine\(entry\), relativeTime/);
  assert.match(renderSource, /authorLine\(entry\),\s*\n\s*formatTime/);
});

test("the ledger row reveals history without opening the record", function () {
  var row = renderSource.slice(renderSource.indexOf("function renderRow("), renderSource.indexOf("export function renderList"));
  assert.match(row, /categoryLabel\(entry\.category \|\| entry\.kind\)/, "category chip");
  assert.match(row, /entry\.priority && entry\.priority !== "normal"/, "priority only when it matters");
  assert.match(row, /entry\.title \|\| "Untitled log"/);
  assert.match(row, /summary\.textContent = entry\.summary/);
  assert.match(row, /parts\.push\("v" \+ entry\.revisions\)/, "revision count");
  assert.match(row, /entry\.commentCount \+ \(entry\.commentCount === 1 \? " comment" : " comments"\)/);
  assert.match(row, /relativeTime\(entry\.updatedAt \|\| entry\.createdAt\)/);
  assert.equal(/entry\.body/.test(row), false, "a row never renders the record body");
});

test("category labels are project-defined and rendered safely", function () {
  // No label table and no per-category CSS: the vocabulary is not known at
  // build time, so nothing may be hard-coded against it.
  assert.equal(/CATEGORY_LABELS\s*=/.test(renderSource), false, "no exhaustive label map");
  assert.equal(/data-category="/.test(css), false, "no per-category CSS selectors");
  assert.equal(/\.project-log-chip\.[a-z]/.test(css), false, "no exhaustive chip classes");
  assert.match(css, /Categories are project-defined/, "the neutral styling is deliberate");

  // Priority keeps the only stable colour, because urgency is a fixed scale.
  assert.match(css, /\.project-log-priority\[data-priority="urgent"\]/);
  assert.match(css, /\.project-log-priority\[data-priority="important"\]/);

  // Any label is de-slugged for display and reaches the DOM as text, never markup.
  assert.match(renderSource, /export function categoryLabel\(value\)/);
  // Any script, not just Latin: labels are only ever de-slugged for display.
  assert.equal(/[a-z]\.charCodeAt|\/\[a-z\]\//.test(renderSource), false,
    "the client makes no ASCII assumption about a category label");
  assert.match(renderSource, /chip\.textContent = categoryLabel\(entry\.category \|\| entry\.kind\)/);
  assert.match(renderSource, /option\.textContent = categoryLabel\(categories\[i\]\)/);
  assert.equal(/innerHTML\s*=\s*[^;]*categoryLabel/.test(renderSource), false,
    "a category is never interpolated into markup");
  // The chip is length-bounded so a long label cannot break the row.
  assert.match(css, /\.project-log-chip \{[^}]*text-overflow: ellipsis/s);
});

test("category filtering is a compact control, not a dashboard", function () {
  assert.match(renderSource, /export function renderFilter\(container, categories, selected, onChange\)/);
  assert.match(renderSource, /select\.className = "project-logs-filter"/);
  assert.match(renderSource, /all\.textContent = "All categories"/);
  assert.match(logsSource, /renderFilter\(filterEl, msg\.categories, store\.get\('projectLogsCategory'\), applyFilter\)/);
  assert.match(logsSource, /category: store\.get\('projectLogsCategory'\) \|\| ""/);
  assert.match(css, /\.project-logs-filter \{/);
  // Server-provided vocabulary, not a hard-coded client list.
  assert.match(logsSource, /Array\.isArray\(msg\.categories\)/);
  assert.equal(/"decision"|"security"|"operations"|"incident"/.test(logsSource + renderSource), false,
    "the client hard-codes no category name at all");
});

test("worktree log context is visible and can be filtered without forking the ledger", function () {
  assert.match(logsSource, /id="project-logs-context-filter-slot"/);
  assert.match(logsSource, /contextMode: store\.get\('projectLogsContextMode'\) \|\| ""/);
  assert.match(renderSource, /\[\["current", "Current worktree"\], \["project", "Project"\], \["all", "All changes"\]\]/);
  assert.match(renderSource, /context\.branch \|\| "Worktree change"/);
  assert.match(renderSource, /context\.status === "merged"/);
  assert.match(renderSource, /context\.status === "archived"/);
});

test("loading, empty, filtered-empty, and error states stay inside the ledger", function () {
  assert.match(logsSource, /"Loading the project ledger\.\.\."/);
  assert.match(logsSource, /"No entries match the current scope, search, or category\."/);
  assert.match(logsSource, /"The ledger could not be loaded\. Try opening Logs again\."/);
  assert.match(logsSource, /listEl\.setAttribute\("aria-busy", "true"\)/);
  assert.match(logsSource, /listEl\.removeAttribute\("aria-busy"\)/);
  assert.match(renderSource, /export function renderList\(listEl, entries, onOpen, emptyState\)/);
  assert.match(css, /\.project-logs-list\[aria-busy="true"\]/);
});

test("the discussion section shows attributed comments and a composer", function () {
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("export function renderDetail"));
  assert.match(comments, /"Discussion \(" \+ comments\.length \+ "\)"/);
  assert.match(comments, /actorLabel\(comment\.author\) \+ " · " \+ relativeTime\(comment\.at\)/);
  assert.match(comments, /body\.textContent = comment\.body \|\| ""/);

  assert.match(renderSource, /id="project-log-comment-input"/);
  assert.match(renderSource, /A comment cannot be empty\./);
  assert.match(logsSource, /statusEl\.textContent = "Logs are unavailable while disconnected\."/);
  // A posted comment refreshes both the open record and the ledger counts.
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogCommented"));
  assert.match(handler, /showDetail\(msg\.entry\)/);
  assert.match(handler, /requestList\(\)/);
});

test("the bounded right workbench pane is preserved", function () {
  assert.match(logsSource, /document\.getElementById\("main-panels"\)/);
  assert.match(logsSource, /panels\.appendChild\(panel\)/);
  assert.doesNotMatch(logsSource, /getElementById\("messages"\)|getElementById\("input-area"\)|title-bar-content/);

  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*#project-logs-panel \{[\s\S]*width: 50%;[\s\S]*max-width: 720px;[\s\S]*min-width: 360px;/);
  assert.match(css, /animation: workbench-panel-in/);
  assert.match(filebrowserCss, /@keyframes workbench-panel-in/);
  assert.match(css, /#project-logs-panel\.project-logs-wide \{[\s\S]*width: 70%;/);
  assert.match(css, /#project-logs-panel\.panel-fullscreen \{[\s\S]*width: 100%;/);
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*#project-logs-panel \{[\s\S]*position: fixed;[\s\S]*z-index: 300;/);
  assert.match(css, /padding-top: var\(--safe-top\);/);

  // Still claims the single right slot and still closes cleanly.
  assert.match(logsSource, /claimRightWorkbench\("project-logs"\)/);
  assert.match(logsSource, /registerRightWorkbench\("project-logs", closeProjectLogs\)/);
  assert.match(logsSource, /applyWindowState\(store\.get\('projectLogsWide'\), false\)/);
});

test("switching project resets the ledger view completely", function () {
  var init = logsSource.slice(logsSource.indexOf("export function initProjectLogs"));
  assert.match(init, /if \(state\.currentSlug === previous\.currentSlug\) return;/);
  assert.match(init, /closeProjectLogs\(\);/);
  assert.match(init, /projectLogsView: "list"/);
  assert.match(init, /projectLogsCategory: ""/);
  assert.match(init, /projectLogsListScroll: 0/);
  assert.match(init, /projectLogsCommentRequestId: null/);
});

test("comment status and the Project Driver response are shown under each comment", function () {
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("// A compact, read-only record"));

  // Every state a comment can be in has an honest label.
  assert.match(renderSource, /"pending": "Awaiting Project Driver review"/);
  assert.match(renderSource, /"clarification-needed": "Project Driver asked a question"/);
  assert.match(renderSource, /"incorporated": "Incorporated"/);
  assert.match(renderSource, /"declined": "Declined"/);

  assert.match(comments, /badge\.dataset\.status = status/);
  assert.match(comments, /badge\.textContent = COMMENT_STATUS_LABELS\[status\] \|\| status/);
  assert.match(comments, /var status = comment\.status \|\| "pending"/, "an unreviewed comment reads as pending");

  // The Driver's answer sits beneath the comment it answers.
  assert.match(comments, /comment\.review && comment\.review\.response/);
  assert.match(comments, /responseBody\.textContent = comment\.review\.response/);
  assert.match(comments, /parts\.push\("revision " \+ comment\.review\.revision\)/);
  assert.match(comments, /var parts = \["Project Driver"\]/);
  // Rendered as text, never markup.
  assert.equal(/innerHTML[^;]*comment\.review/.test(comments), false);
  assert.match(css, /\.project-log-comment-status-badge\[data-status="incorporated"\]/);
  assert.match(css, /\.project-log-comment-response \{/);
});

test("posting a comment leaves Posting and reflects feedback delivery", function () {
  assert.match(logsSource, /statusEl\.textContent = "Posting\.\.\."/);
  assert.match(logsSource, /store\.set\(\{ projectLogsCommentStatusEl: statusEl \}\)/);
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogCommented"));
  assert.match(handler, /pendingStatus\.textContent = msg\.reviewQueued/);
  assert.match(handler, /"Project Driver is reviewing\.\.\."/);
  assert.match(handler, /"Awaiting Project Driver review"/);
  assert.match(handler, /store\.set\(\{ projectLogsCommentStatusEl: null \}\)/);
  assert.match(appSource, /projectLogsCommentStatusEl: null/);
});

test("queued feedback immediately shows that the Project Driver is reviewing", function () {
  assert.match(logsSource, /msg\.reviewQueued[\s\S]*"Project Driver is reviewing\.\.\."/);
  assert.match(logsSource, /badges\[badges\.length - 1\]\.textContent = "Project Driver is reviewing"/);
});

test("a completed comment review refreshes the open entry without stealing focus", function () {
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogCommentReviewed"));
  handler = handler.slice(0, handler.indexOf("export function handleProjectLogDeleted"));
  assert.match(handler, /msg\.ref === store\.get\('projectLogsSelectedRef'\)/);
  assert.match(handler, /requestEntry\(msg\.ref\)/);
  assert.match(handler, /requestList\(\)/);
  assert.equal(/openProjectLogs|focus\(/.test(handler), false);
  assert.match(messagesSource, /case "project_log_comment_reviewed":[\s\S]*handleProjectLogCommentReviewed\(msg\)/);
});

test("the version history is a read-only timeline with no revert control", function () {
  var history = renderSource.slice(renderSource.indexOf("function renderHistory("), renderSource.indexOf("function historyVerb("));
  assert.match(history, /"Version history \(" \+ history\.length \+ "\)"/);
  assert.match(history, /if \(history\.length < 2\) return null;/, "a single-revision entry needs no timeline");
  assert.match(history, /label\.textContent = "v" \+ revision\.revision/);
  assert.match(history, /revision\.changed\.join\(", "\)/);
  assert.match(history, /reason\.textContent = revision\.reason/);
  assert.match(renderSource, /revision\.revertedFrom \? "Reverted to v" \+ revision\.revertedFrom/);
  assert.match(renderSource, /if \(revision\.op === "incorporate"\) return "Incorporated a comment"/);

  // Restoring a revision is the Driver's decision, so there is no control here.
  assert.equal(/revert_log|project_log_revert|Revert<|onRevert/.test(renderSource + logsSource), false,
    "the client never offers or sends a revert");
  assert.equal(/review_log_comment|project_log_review/.test(renderSource + logsSource), false,
    "nor a review");
  // Metadata only: the timeline never renders a body.
  assert.equal(/revision\.snapshot|revision\.body/.test(history), false);
  assert.match(css, /\.project-log-history \{/);
});


test("Logs opens only through the explicit tool controls", function () {
  assert.equal(fs.existsSync(path.join(root, "lib/public/modules/project-logs-ambient.js")), false,
    "the ambient module is removed");
  assert.equal(/project-logs-handle|project-logs-previewing|projectLogsPreview|projectLogsPinned/.test(logsSource + css + appSource), false,
    "no edge, preview, or pin state remains");
  assert.match(logsSource, /button\.addEventListener\("click", function \(\) \{/);
  assert.match(logsSource, /else openProjectLogs\(\)/);
});

test("an update marks the explicit button and never opens the pane", function () {
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogUpdated"));
  handler = handler.slice(0, handler.indexOf("export function handleProjectLogsError"));
  assert.match(handler, /noteCanonicalUpdate\(msg\)/);
  assert.equal(/openProjectLogs|showDetail|focus\(/.test(handler), false,
    "an update never opens or steals focus");
  // The list only refreshes when it is already the visible surface.
  assert.match(handler, /if \(store\.get\('projectLogsOpen'\) && store\.get\('projectLogsView'\) !== "detail"\) requestList\(\)/);

  // The explicit button carries the restrained marker.
  assert.match(logsSource, /button\.classList\.toggle\("project-logs-unread", unread > 0\)/);
  assert.match(paletteSource, /id: "project-logs-btn"[\s\S]*countId: "project-logs-count"/);
  assert.match(css, /#project-logs-btn\.project-logs-unread \{ color: var\(--accent\); \}/);

  // No OS notification, sound, modal, or focus theft anywhere in the client.
  assert.equal(/new Notification|Audio\(|\.play\(\)|alert\(|confirm\(/.test(logsSource), false);
});

test("updates are deduped by ref and revision without client persistence", function () {
  assert.match(logsSource, /var seen = store\.get\('projectLogsSeenRevisions'\) \|\| \{\}/);
  assert.match(logsSource, /if \(seen\[msg\.ref\] >= msg\.revision\) return false;/);
  assert.match(logsSource, /if \(!msg \|\| !msg\.ref \|\| !msg\.revision\) return false;/);
  // An update while the pane is open is acknowledged, not counted.
  assert.match(logsSource, /projectLogsUnread: store\.get\('projectLogsOpen'\) \? 0 :/);
  assert.match(appSource, /projectLogsSeenRevisions: \{\}/);
  assert.equal(/localStorage|sessionStorage/.test(logsSource), false, "no client-side persistence");
});

test("opening acknowledges, and project switch resets without animating", function () {
  var open = logsSource.slice(logsSource.indexOf("export function openProjectLogs"));
  open = open.slice(0, open.indexOf("export function closeProjectLogs"));
  assert.match(open, /acknowledgeUpdates\(\)/);
  assert.match(open, /store\.set\(\{ projectLogsOpen: true \}\)/);

  var init = logsSource.slice(logsSource.indexOf("export function initProjectLogs"));
  assert.match(init, /projectLogsUnread: 0/);
  assert.match(init, /projectLogsSeenRevisions: \{\}/);
  // Acknowledgement is server-free: no preference write, no storage.
  assert.equal(/fetch\(|localStorage/.test(logsSource), false);
});
