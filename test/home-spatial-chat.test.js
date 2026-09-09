var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var serverSource = fs.readFileSync(path.join(root, "lib/server.js"), "utf8");
var projectsSource = fs.readFileSync(path.join(root, "lib/public/modules/app-projects.js"), "utf8");
var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
var connectionSource = fs.readFileSync(path.join(root, "lib/public/modules/app-connection.js"), "utf8");
var shellSource = fs.readFileSync(path.join(root, "lib/public/modules/home-shell.js"), "utf8");
var dockSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock.js"), "utf8");
var dockResizeSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock-resize.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var identitySource = fs.readFileSync(path.join(root, "lib/public/modules/home-chat-identity.js"), "utf8");
var debateLiveSource = fs.readFileSync(path.join(root, "lib/public/modules/home-debate-live.js"), "utf8");
var renderingSource = fs.readFileSync(path.join(root, "lib/public/modules/app-rendering.js"), "utf8");
var cardsSource = fs.readFileSync(path.join(root, "lib/public/modules/app-message-cards.js"), "utf8");
var runtimeSource = fs.readFileSync(path.join(root, "lib/public/modules/chat-render-runtime.js"), "utf8");
var bubbleSource = fs.readFileSync(path.join(root, "lib/public/modules/chat-bubble-renderer.js"), "utf8");
var homeSidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var paletteSource = fs.readFileSync(path.join(root, "lib/public/modules/command-palette.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-hub.css"), "utf8");
var sidebarCssSource = fs.readFileSync(path.join(root, "lib/public/css/home-sidebar.css"), "utf8");
var matesCssSource = fs.readFileSync(path.join(root, "lib/public/css/mates.css"), "utf8");
var avatarCssSource = fs.readFileSync(path.join(root, "lib/public/css/avatar-imprints.css"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("home markup uses the first-depth Mate list and unified chat stage", function () {
  assert.match(indexSource, /id="home-mate-list"/);
  assert.doesNotMatch(homeMarkup, /id="home-mate-chat-switcher"|data-home-mate-switcher/);
  assert.match(indexSource, /class="home-mate-chat-stage"/);
  assert.match(indexSource, /id="home-mate-chat-suggestions"/);
  assert.match(homeMarkup, /home-sidebar-primary-actions[\s\S]*id="home-tools-btn"[^>]*aria-expanded="false"[^>]*aria-controls="home-tool-workbench"[\s\S]*id="home-tools-label">Capsules<\/span>/);
  assert.equal((homeMarkup.match(/id="home-tools-btn"/g) || []).length, 1);
  assert.match(homeMarkup, /id="home-sidebar-expand"[^>]*aria-label="Show Home sidebar"[^>]*aria-describedby="home-sidebar-expand-brand-label"[\s\S]*home-sidebar-expand-wordmark/);
  assert.match(homeMarkup, /id="home-close-control"[^>]*class="home-close-control hidden"[^>]*title="Close Home"[^>]*aria-label="Close Home"[\s\S]*data-lucide="x"[^>]*aria-hidden="true"[\s\S]*<span>Close<\/span>/);
  assert.equal((homeMarkup.match(/id="home-close-control"/g) || []).length, 1);
  var workbenchMarkup = homeMarkup.slice(homeMarkup.indexOf('<section id="home-tool-workbench"'), homeMarkup.indexOf('</section>', homeMarkup.indexOf('<section id="home-tool-workbench"')) + 10);
  assert.doesNotMatch(workbenchMarkup, /home-close-control|Close Home/);
  assert.doesNotMatch(homeMarkup, /home-mate-chat-header|home-mate-chat-controls|home-minimize-btn|home-minimize-trigger/);
  assert.match(cssSource, /\.home-workspace \{[\s\S]*--home-dock-width: clamp\(520px, 46vw, 760px\);[\s\S]*--home-dock-edge-inset: 8px;[\s\S]*--home-close-dock-gap: 8px;/);
  assert.match(cssSource, /\.home-close-control \{[\s\S]*position: absolute;[\s\S]*top: 8px;[\s\S]*right: 10px;[\s\S]*border: 1px solid var\(--border-subtle\);/);
  assert.match(cssSource, /@media \(min-width: 1340px\) \{[\s\S]*margin: 8px var\(--home-dock-edge-inset\) 8px 12px;[\s\S]*#home-hub\.dock-split \.home-close-control \{\s*right: calc\(var\(--home-dock-width\) \+ var\(--home-dock-edge-inset\) \+ var\(--home-close-dock-gap\)\);/);
  assert.match(cssSource, /@media \(min-width: 769px\) and \(max-width: 1339px\) \{[\s\S]*right: var\(--home-dock-edge-inset\);[\s\S]*#home-hub\.dock-split \.home-close-control \{\s*right: calc\(min\(var\(--home-dock-width\), 65vw\) \+ var\(--home-dock-edge-inset\) \+ var\(--home-close-dock-gap\)\);/);
  assert.match(cssSource, /#home-hub\.dock-focus \.home-close-control \{ display: none; \}/);
  assert.match(cssSource, /@media \(max-width: 768px\) \{[\s\S]*#home-hub\.dock-split \.home-close-control,[\s\S]*#home-hub\.dock-focus \.home-close-control \{ display: none; \}/);
  assert.doesNotMatch(cssSource, /\.home-dock-actions \.home-close-control|\.home-project-reveal/);
  assert.doesNotMatch(hubSource, /dockActions|parentNode !==|insertBefore\(close|insertBefore\(reveal|is-docked/);
  assert.doesNotMatch(homeMarkup + hubSource + cssSource, /Reveal project|data-lucide="chevron-down"[^\n]*Close|>Project<\/span>|home-project-reveal/);
  assert.doesNotMatch(indexSource, /id="home-bar"|id="home-projects-btn"|id="home-search-btn"/);
  assert.doesNotMatch(cssSource, /#home-bar|\.home-bar-|\.home-projects-|#home-projects-btn/);
  assert.doesNotMatch(homeMarkup, /notif-center-btn|user-settings-btn|home-bar/);
  assert.doesNotMatch(indexSource, /id="home-hub-mates"/);
});

test("home minimizes and resumes without resetting its mounted work", function () {
  assert.match(hubSource, /homeHubSuspended/);
  assert.match(hubSource, /export function minimizeHomeHub\(\)/);
  assert.match(hubSource, /function syncHomeCloseControl\(\)[\s\S]*getElementById\("home-close-control"\)[\s\S]*classList\.toggle\("hidden", !getHomeReturnSlug\(\)\)/);
  assert.match(hubSource, /function getHomeReturnSlug\(\)[\s\S]*chooseProjectActivationTarget\([\s\S]*getCachedProjects\(\)[\s\S]*homeSurfaceProjectSlug/);
  assert.match(hubSource, /home-close-control"\)\.addEventListener\("click", minimizeHomeHub\)/);
  assert.match(hubSource, /state\.currentSlug !== prev\.currentSlug\) syncHomeCloseControl\(\)/);
  assert.doesNotMatch(hubSource, /syncHomeCloseControl[\s\S]{0,180}dockOpen|dockOpen[\s\S]{0,180}syncHomeCloseControl/);
  assert.match(hubSource, /switchProject\(slug\)/);
  assert.match(projectsSource, /var alreadyInProject = isProjectActivated\(st, slug, ws\)/);
  assert.match(hubSource, /getElementById\("input"\)[\s\S]*projectInput\.focus\(\{ preventScroll: true \}\)/);
  assert.match(hubSource, /if \(!resume && store\.get\('homeSurfaceRestoreRequested'\) !== true\) \{[\s\S]*requestTools\(\)[\s\S]*renderDock\(\)/);
  assert.doesNotMatch(hubSource, /resetHomeDockFocus|closeHomeChat/);
  assert.match(connectionSource, /resumeHomeChat\(\)/);
  assert.match(chatSource, /export function resumeHomeChat\(\)/);
});

test("Home sheet overlays its project without reserving a main toolbar row", function () {
  assert.doesNotMatch(homeMarkup, /home-mate-chat-header|home-mate-chat-controls/);
  assert.doesNotMatch(cssSource, /\.home-mate-chat-header/);
  assert.match(cssSource, /\.home-workspace \{[\s\S]*position: relative;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(cssSource, /\.home-conversation-region \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(cssSource, /\.home-mate-chat \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(cssSource, /\.home-mate-chat-stage \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(cssSource, /\.home-mate-chat-messages \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
  assert.match(sidebarCssSource, /#home-hub\.dock-focus \.home-sidebar-expand \{ display: none; \}/);
});

test("home shell only toggles reversible project chrome", function () {
  assert.match(shellSource, /classList\.add\("home-active"\)/);
  assert.match(shellSource, /classList\.remove\("home-active"\)/);
  assert.doesNotMatch(shellSource, /getCachedProjects|openAddProjectModal|switchProject|home-project|home-bar|notif-center-btn|user-settings-btn/);
  assert.match(cssSource, /body\.home-active #top-bar,[\s\S]*body\.home-active #icon-strip,[\s\S]*body\.home-active #sidebar-column/);
  assert.match(cssSource, /body\.home-active \.title-bar-content/);
  assert.match(appSource, /if \(!newSlug\) \{\s*showHomeHub\(true\);\s*return;/);
  assert.match(appSource, /initHomeSurfaceBoot\(\);/);
  assert.doesNotMatch(appSource, /if \(!slugMatch\) \{\s*showHomeHub\(true\);/);
  assert.match(appSource, /document\.body\.dataset\.homeProjectSlug/);
  assert.match(serverSource, /data-home-project-slug/);
  assert.doesNotMatch(indexSource, /home-hub-close/);
  assert.doesNotMatch(hubSource, /hubCloseBtn/);
  assert.doesNotMatch(appSource, /isHomeHubVisible\(\) && store\.get\('currentSlug'\)/);
});

test("Cmd+K remains a global conversation search when Home is explicitly opened", function () {
  assert.match(paletteSource, /document\.addEventListener\("keydown"[\s\S]*\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "k"/);
  assert.match(paletteSource, /fetch\("\/api\/palette\/search"/);
  assert.doesNotMatch(paletteSource, /ctx\.projectList|cmd-palette-group-label">Projects|entry\.type === "project"/);
  assert.match(paletteSource, /navigateToSession[\s\S]*ctx\.switchProject\(item\.projectSlug\)/);
  assert.match(projectsSource, /if \(homeVisible && alreadyInProject\) \{[\s\S]*hideHomeHub\(\)/);
  assert.match(serverSource, /Root path — render the default project workspace/);
  assert.match(serverSource, /Fall back to first accessible project/);
  assert.match(serverSource, /data-home-project-slug/);
});

test("home dock exposes conversation, split, and focused tool states", function () {
  assert.match(indexSource, /id="home-tools-btn"/);
  assert.match(indexSource, /id="home-dock-divider"/);
  assert.match(homeMarkup, /aria-label="Resize Capsules Workbench"/);
  assert.match(homeMarkup, /id="home-tool-workbench"[^>]*aria-label="Capsules Workbench"/);
  assert.match(homeMarkup, /aria-label="Focus Capsules Workbench"/);
  assert.match(homeMarkup, /aria-label="Collapse Capsules Workbench"/);
  assert.match(indexSource, /Return to conversation/);
  assert.match(dockSource, /dock-split/);
  assert.match(dockSource, /dock-focus/);
  assert.match(dockSource, /dockOpen: false/);
  assert.match(dockSource, /home_dock_get/);
  assert.match(dockSource, /home_dock_set/);
  assert.match(dockSource, /window\.innerWidth <= 768[\s\S]*closeHomeDock\(\)/);
  assert.match(dockResizeSource, /available - 504/);
  assert.match(dockResizeSource, /window\.innerWidth \* 0\.58/);
  assert.match(dockResizeSource, /workbench\.getBoundingClientRect\(\)/);
  assert.match(dockResizeSource, /pointerOffset/);
  assert.match(dockResizeSource, /workspace\.style\.setProperty\("--home-dock-width", resolved \+ "px"\)/);
  assert.match(dockSource, /applyHomeDockWidth\(store\.get\('dockWidth'\)\)/);
  assert.match(cssSource, /\.home-tool-workbench \{[\s\S]*border: 1px solid var\(--border\);[\s\S]*border-radius: 12px;[\s\S]*box-shadow:/);
  assert.match(cssSource, /@keyframes home-workbench-in/);
  assert.match(cssSource, /#home-hub\.dock-split \.home-dock-divider::after \{[\s\S]*background: transparent;/);
  assert.match(cssSource, /@media \(max-width: 768px\) \{[\s\S]*#home-hub\.dock-split \.home-conversation-region,[\s\S]*display: none;/);
  assert.match(cssSource, /#home-hub\.dock-split,[\s\S]*padding: var\(--safe-top\) 0 calc\(56px \+ var\(--safe-bottom, 0px\)\)/);
  assert.doesNotMatch(cssSource, /flex: 0 0 52vh|flex: 0 0 62vh/);
  assert.doesNotMatch(indexSource + cssSource, /hub-split|hub-pane-board|home-app-frame/);
  assert.doesNotMatch(dockSource, /localStorage/);
});

test("first-depth Home Mate list preserves management and activity affordances", function () {
  assert.match(hubSource, /home-mate-list-avatar/);
  assert.match(hubSource, /home-mate-list-activity/);
  assert.match(hubSource, /home-mate-list-unread/);
  assert.match(hubSource, /if \(mate\.model\)[\s\S]*home-mate-list-model[\s\S]*model\.textContent = mate\.model/);
  assert.match(hubSource, /getActiveMentionMateIds/);
  assert.match(homeMarkup, /id="home-sidebar-debate"/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-(?:model|memory|knowledge|settings)"/);
  assert.match(hubSource, /createHomeMateSettingsTrigger\(mate\)/);
  assert.match(homeSidebarSource, /openHomeDebatesArchive/);
});

test("home surface no longer propagates mate colors", function () {
  var homeSource = hubSource + chatSource + cssSource;
  assert.doesNotMatch(homeSource, /--home-mate-color|--mate-color|avatarColor/);
});

test("legacy home mate rail selectors are gone from client styles", function () {
  var styleSource = cssSource + matesCssSource + avatarCssSource;
  assert.doesNotMatch(styleSource, /home-hub-mates|home-hub-mate-|home-mate-tooltip|home-mate-hover/);
});

test("Home and project chat share the fixed bubble Markdown renderer", function () {
  assert.match(renderingSource, /from ['"]\.\/chat-bubble-renderer\.js['"]/);
  assert.match(chatSource, /from ['"]\.\/chat-bubble-renderer\.js['"]/);
  assert.match(identitySource, /from ['"]\.\/chat-bubble-renderer\.js['"]/);
  assert.match(renderingSource, /createAssistantBubble\(\{/);
  assert.match(chatSource, /createHomeOrdinaryBubble\(message, mate, mateName, timeText\)/);
  assert.match(identitySource, /createAssistantBubble\(\{/);
  assert.match(identitySource, /createUserBubble\(\{/);
  assert.match(bubbleSource, /content\.className = "md-content"/);
  assert.match(bubbleSource, /content\.innerHTML = renderMarkdown\(text \|\| ""\)/);
  assert.match(bubbleSource, /highlightCodeBlocks\(content\)/);
  assert.match(bubbleSource, /renderMermaidBlocks\(content\)/);
  assert.match(chatSource, /if \(finalize\) finalizeAssistantBubble[\s\S]*else renderAssistantBubbleText\(row, message\.text \|\| "", false\)/);
  assert.match(chatSource, /appendMessage\(messages\[i\], mate, mateName, !streaming\)/);
  assert.match(chatSource, /disposeChatBubbleTree\(messagesEl\);[\s\S]*messagesEl\.innerHTML = ""/);
  assert.match(bubbleSource, /document\.removeEventListener\("click", handleOutsideClick\)/);
  assert.match(chatSource, /home-mate-chat-transcript home-chat-bubble-layout/);
  assert.match(cssSource, /\.home-mate-chat-transcript\.home-chat-bubble-layout \.msg-user/);
  assert.match(cssSource, /\.home-mate-chat-transcript\.home-chat-bubble-layout \.msg-assistant/);
  assert.doesNotMatch(chatSource, /currentMsgEl|currentFullText|wide-view/);
  assert.doesNotMatch(bubbleSource, /store\.js|currentMsgEl|currentFullText/);
  assert.match(cardsSource, /from ['"]\.\/chat-render-runtime\.js['"]/);
  assert.match(renderingSource, /from ['"]\.\/chat-render-runtime\.js['"]/);
  assert.match(renderingSource, /export \{ addUserMessage, addSystemMessage, addConflictMessage, addContextOverflowMessage \} from ['"]\.\/app-message-cards\.js['"]/);
  assert.doesNotMatch(renderingSource, /export function addUserMessage|export function addSystemMessage/);
  assert.doesNotMatch(renderingSource, /var (?:turnCounter|prependAnchor|activityEl|isUserScrolledUp|stickyBottom)\b|function (?:addToMessages|scrollToBottom|getMsgTime|shouldGroupMessage)\b|export var VENDOR_/);
  assert.match(runtimeSource, /var turnCounter = 0;[\s\S]*var prependAnchor = null;[\s\S]*var activityEl = null;[\s\S]*var isUserScrolledUp = false;[\s\S]*var stickyBottom = false;/);
  assert.ok(renderingSource.split("\n").length < 500);
  assert.ok(cardsSource.split("\n").length < 500);
  assert.ok(runtimeSource.split("\n").length < 500);
  assert.doesNotMatch(chatSource, /content\.textContent = message\.text|home-chat-message-assistant|home-chat-message-user|home-chat-message-content/);
  assert.ok(bubbleSource.split("\n").length < 500);
  assert.doesNotMatch(bubbleSource, /\b(?:const|let)\b|=>|localStorage/);
  assert.match(chatSource, /createHomeOrdinaryTyping\(mate, mateName\)/);
  assert.match(debateLiveSource, /home-chat-typing/);
});

test("empty home chat renders contextual greeting and working suggestions", function () {
  // The empty stage body lives in home-chat-empty-state.js; the chat surface
  // keeps the call site.
  var emptyStateSource = fs.readFileSync(path.join(root, "lib/public/modules/home-chat-empty-state.js"), "utf8");
  assert.match(emptyStateSource, /home-mate-chat-brand/);
  assert.match(emptyStateSource, /symbol\.src = "\/clay-studio-symbol\.png"/);
  assert.match(emptyStateSource, /home-sidebar-brand-wordmark home-mate-chat-brand-wordmark/);
  assert.match(emptyStateSource, /wordmark\.textContent = "Clay Studio"/);
  assert.match(chatSource, /if \(hasConversation\) \{[\s\S]*appendMessage[\s\S]*\} else \{\s*renderEmptyState/);
  assert.match(emptyStateSource, /What should we work on,/);
  assert.match(emptyStateSource, /getHomeMateShortBio\(mate\)/);
  assert.match(emptyStateSource, /Make me a small tool/);
  assert.match(emptyStateSource, /onSuggestion\(suggestion\)/);
  assert.doesNotMatch(emptyStateSource, /\b(?:const|let)\b|=>|localStorage/);
});

test("Mate and new-conversation actions live in the Home sidebar", function () {
  assert.match(homeMarkup, /id="home-sidebar-new"/);
  assert.match(homeMarkup, /id="home-sidebar-debate"[^>]*title="Browse debates"[^>]*aria-label="Browse debates"[^>]*aria-pressed="false"[\s\S]*>Debates<\/span>/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-(?:model|memory|knowledge|settings)"/);
  assert.doesNotMatch(homeMarkup, /id="home-mate-chat-actions"/);
  assert.match(homeSidebarSource, /startNewHomeConversation/);
  assert.match(homeSidebarSource, /openHomeDebatesArchive/);
  assert.match(chatSource, /export function openHomeMateAction\(kind, initialTopic\)/);
  assert.match(chatSource, /openHomeMateSettings\(mate\.id, sessionModelChooseEl/);
  assert.match(chatSource, /kind !== "debate"/);
});

test("home chat CSS centers the transcript and keeps one composer surface", function () {
  assert.match(cssSource, /\.home-mate-chat-transcript\s*\{[\s\S]*?width: min\(720px, 100%\)/);
  assert.match(cssSource, /\.home-mate-chat-transcript\.home-chat-bubble-layout \.msg-user \.bubble\s*\{[\s\S]*?max-width: 85%/);
  assert.match(cssSource, /\.home-mate-chat-transcript\.home-chat-bubble-layout \.msg-assistant \.md-content\s*\{[\s\S]*?background: none/);
  assert.match(cssSource, /\.home-mate-chat-composer-frame\s*\{[\s\S]*?width: min\(720px, calc\(100% - 36px\)\)/);
  assert.match(cssSource, /\.home-mate-chat-composer\s*\{[\s\S]*?border-radius: 22px/);
  assert.match(cssSource, /\.home-mate-chat\.is-empty \.home-mate-chat-stage/);
  assert.match(cssSource, /\.home-mate-chat\.is-empty \.home-mate-chat-stage\s*\{[\s\S]*?padding-bottom: 18%/);
  assert.match(cssSource, /#home-hub\s*\{[\s\S]*?padding: calc\(6px \+ var\(--safe-top\)\) 12px 16px/);
});

test("home app imports the compatible Mate-list renderer", function () {
  assert.match(appSource, /renderHomeMateSwitcher/);
  assert.match(hubSource, /getElementById\("home-mate-list"\)/);
});
