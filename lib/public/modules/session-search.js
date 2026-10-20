// --- In-session search (Cmd+F / Ctrl+F) ---
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { paneMessageBinding } from './pane-binding.js';
import { updatePaneSearchStatus, beginPaneSearch, endPaneSearch, acceptsSessionSearchResults } from './session-search-pane-state.js';

var ctx = null;
var searchBarEl = null;
var searchInputEl = null;
var matchCountEl = null;
var currentQuery = "";
var matches = [];       // DOM highlight marks (for loaded messages)
var currentMatchIndex = -1;
var highlightClass = "session-search-highlight";
var activeHighlightClass = "session-search-highlight-active";

// Timeline state
var timelineEl = null;
var timelineScrollHandler = null;
var serverHits = [];    // full history hits from server
var serverTotal = 0;
var pendingScrollTarget = null;

function setSearchStatus(text) {
  updatePaneSearchStatus(matchCountEl, currentQuery, text);
}

function initSessionSearch(context) {
  ctx = context;
  createSearchBar();
  var searchBinding = paneMessageBinding();
  store.subscribe(function () {
    var nextBinding = paneMessageBinding();
    if (searchBinding === nextBinding) return;
    searchBinding = nextBinding;
    if (store.get('paneSearchOpen') || currentQuery || matches.length || serverHits.length) closeSearch();
  });
  document.addEventListener("keydown", function (e) {
    var isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key === "f") {
      e.preventDefault();
      openSearch();
    }
    if (e.key === "Escape" && isSearchOpen()) {
      e.preventDefault();
      closeSearch();
    }
  });
}

function createSearchBar() {
  searchBarEl = document.createElement("div");
  searchBarEl.id = "session-search-bar";
  searchBarEl.className = "session-search-bar hidden";
  searchBarEl.innerHTML =
    '<div class="session-search-inner">' +
      '<input type="text" id="find-in-session-input" placeholder="Search in this session..." autocomplete="off" spellcheck="false">' +
      '<span class="session-search-count" id="find-in-session-count"></span>' +
      '<button class="session-search-btn" id="find-in-session-prev" title="Previous (Shift+Enter)" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>' +
      '<button class="session-search-btn" id="find-in-session-next" title="Next (Enter)" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' +
      '<button class="session-search-btn" id="find-in-session-close" title="Close (Esc)" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
    '</div>';

  // Insert at top of #app
  var appEl = ctx.messagesEl.parentElement;
  appEl.insertBefore(searchBarEl, appEl.firstChild);

  searchInputEl = document.getElementById("find-in-session-input");
  matchCountEl = document.getElementById("find-in-session-count");

  var debounceTimer = null;
  searchInputEl.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      performSearch(searchInputEl.value);
    }, 250);
  });

  searchInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });

  document.getElementById("find-in-session-prev").addEventListener("click", function () {
    goToPrevMatch();
  });
  document.getElementById("find-in-session-next").addEventListener("click", function () {
    goToNextMatch();
  });
  document.getElementById("find-in-session-close").addEventListener("click", function () {
    closeSearch();
  });
}

function isSearchOpen() {
  if (store.get('paneMode')) return store.get('paneSearchOpen') === true;
  return searchBarEl && !searchBarEl.classList.contains("hidden");
}

function openSearch(prefill) {
  if (!searchBarEl) return;
  if (store.get('paneMode') && window.parent !== window) {
    window.parent.postMessage({ type: "clay-pane-search-open", paneBinding: paneMessageBinding() }, window.location.origin);
    return;
  }
  searchBarEl.classList.remove("hidden");
  var btn = document.getElementById("find-in-session-btn");
  if (btn) btn.classList.add("active");
  if (typeof prefill === "string" && prefill) {
    searchInputEl.value = prefill;
    performSearch(prefill);
  }
  searchInputEl.focus();
  searchInputEl.select();
  if (!prefill && searchInputEl.value) {
    performSearch(searchInputEl.value);
  }
}

function closeSearch() {
  if (!searchBarEl) return;
  endPaneSearch();
  searchBarEl.classList.add("hidden");
  var btn = document.getElementById("find-in-session-btn");
  if (btn) btn.classList.remove("active");
  clearHighlights();
  removeTimeline();
  currentQuery = "";
  matches = [];
  currentMatchIndex = -1;
  serverHits = [];
  serverTotal = 0;
  setSearchStatus("");
}

export function controlPaneSearch(action, query) {
  if (!store.get('paneMode')) return false;
  if (action === "close") { closeSearch(); return true; }
  if (action === "open") {
    store.set({ paneSearchOpen: true });
    searchInputEl.value = String(query || "");
    performSearch(searchInputEl.value);
    return true;
  }
  if (!store.get('paneSearchOpen')) return false;
  if (action === "query") {
    searchInputEl.value = String(query || "");
    performSearch(searchInputEl.value);
    return true;
  }
  if (action === "next") { goToNextMatch(); return true; }
  if (action === "previous") { goToPrevMatch(); return true; }
  return false;
}

function toggleSearch() {
  if (isSearchOpen()) {
    closeSearch();
  } else {
    openSearch();
  }
}

function performSearch(query) {
  clearHighlights();
  removeTimeline();
  matches = [];
  currentMatchIndex = -1;
  serverHits = [];
  serverTotal = 0;
  currentQuery = query.trim();
  if (store.get('paneMode')) beginPaneSearch(currentQuery);

  if (!currentQuery) {
    setSearchStatus("");
    return;
  }

  // Highlight in currently loaded DOM
  highlightLoadedMessages();

  // Request full-history search from server
  if (ctx.ws && ctx.ws.readyState === 1) {
    ctx.ws.send(JSON.stringify({ type: "search_session_content", query: currentQuery, source: "find_in_session" }));
  }
}

function highlightLoadedMessages() {
  var messagesEl = ctx.messagesEl;
  var msgEls = messagesEl.querySelectorAll(".msg-user, .msg-assistant, .debate-turn, .debate-user-comment");
  var queryLower = currentQuery.toLowerCase();

  for (var i = 0; i < msgEls.length; i++) {
    var contentEl = msgEls[i].querySelector(".bubble") || msgEls[i].querySelector(".md-content") || msgEls[i].querySelector(".debate-comment-text");
    if (!contentEl) continue;
    highlightInElement(contentEl, queryLower);
  }

  matches = Array.from(messagesEl.querySelectorAll("." + highlightClass));

  if (matches.length > 0) {
    currentMatchIndex = 0;
    setActiveMatch(0);
    setSearchStatus("1 / " + matches.length);
  } else {
    setSearchStatus("Searching...");
  }
}

// Handle server response with full-history search results
function handleFindInSessionResults(msg) {
  if (!isSearchOpen() || !acceptsSessionSearchResults(store.snap(), msg, currentQuery)) return;

  serverHits = msg.hits || [];
  serverTotal = msg.total || 0;

  // Update count to reflect total server hits
  if (serverHits.length > 0) {
    // Re-highlight loaded messages to get accurate DOM match count
    clearHighlights();
    highlightLoadedMessages();
    if (matches.length > 0) {
      setSearchStatus("1 / " + matches.length + " (" + serverHits.length + " total)");
    } else {
      setSearchStatus(serverHits.length + " matches");
    }
    buildTimeline();
  } else {
    setSearchStatus("No results");
  }
}

// Called after older history is prepended to DOM
function onHistoryPrepended() {
  if (!pendingScrollTarget) return;
  var target = pendingScrollTarget;
  pendingScrollTarget = null;
  // Re-highlight with current query
  if (currentQuery && isSearchOpen()) {
    clearHighlights();
    highlightLoadedMessages();
  }
  requestAnimationFrame(function() {
    findAndScrollToMatch(target.snippet, target.query);
  });
}

// --- Timeline (scroll map) ---
function buildTimeline() {
  removeTimeline();
  if (serverHits.length === 0) return;

  var messagesEl = ctx.messagesEl;
  var appEl = messagesEl.parentElement;

  timelineEl = document.createElement("div");
  timelineEl.className = "find-in-session-timeline";
  timelineEl.id = "find-in-session-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";
  track.dataset.historyTotal = serverTotal;

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < serverHits.length; i++) {
    var hit = serverHits[i];
    var pct = serverTotal <= 1 ? 50 : 6 + (hit.historyIndex / (serverTotal - 1)) * 88;

    var snippetText = hit.snippet;
    if (snippetText.length > 24) snippetText = snippetText.substring(0, 24) + "\u2026";

    var dateText = "";
    if (hit.ts) {
      var d = new Date(hit.ts);
      var mon = d.getMonth() + 1;
      var day = d.getDate();
      var hr = d.getHours();
      var min = d.getMinutes();
      dateText = mon + "/" + day + " " + (hr < 10 ? "0" : "") + hr + ":" + (min < 10 ? "0" : "") + min;
    }

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker search-hit-marker";
    marker.innerHTML = iconHtml("search") +
      (dateText ? '<span class="marker-date">' + dateText + '</span>' : '') +
      '<span class="marker-text">' + escapeHtml(snippetText) + '</span>';
    marker.style.top = pct + "%";
    marker.dataset.historyIndex = hit.historyIndex;

    (function(hitData, markerEl) {
      markerEl.addEventListener("click", function() {
        scrollToSearchHit(hitData.historyIndex, hitData.snippet, currentQuery);
      });
    })(hit, marker);

    track.appendChild(marker);
  }

  timelineEl.appendChild(track);

  // Position timeline to align with messages area
  var titleBarEl = document.querySelector(".title-bar-content");
  var inputAreaEl = document.getElementById("input-area");
  var appRect = appEl.getBoundingClientRect();
  var titleBarRect = titleBarEl ? titleBarEl.getBoundingClientRect() : { bottom: appRect.top };
  var inputRect = inputAreaEl.getBoundingClientRect();

  timelineEl.style.top = (titleBarRect.bottom - appRect.top + 4) + "px";
  timelineEl.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timelineEl);
  refreshIcons();

  timelineScrollHandler = function() { updateTimelineViewport(track, viewport); };
  messagesEl.addEventListener("scroll", timelineScrollHandler);
  updateTimelineViewport(track, viewport);
}

function removeTimeline() {
  if (timelineEl) {
    timelineEl.remove();
    timelineEl = null;
  }
  if (timelineScrollHandler && ctx.messagesEl) {
    ctx.messagesEl.removeEventListener("scroll", timelineScrollHandler);
    timelineScrollHandler = null;
  }
}

function updateTimelineViewport(track, viewport) {
  if (!track) return;
  var messagesEl = ctx.messagesEl;
  var scrollH = messagesEl.scrollHeight;
  var viewH = messagesEl.clientHeight;

  var historyFrom = ctx.getHistoryFrom ? ctx.getHistoryFrom() : 0;
  var total = parseInt(track.dataset.historyTotal || "0", 10) || 1;
  var timelineStart = 6 + (historyFrom / (total - 1 || 1)) * 88;
  var timelineEnd = 94;
  var timelineRange = timelineEnd - timelineStart;

  if (scrollH <= viewH) {
    viewport.style.top = timelineStart + "%";
    viewport.style.height = timelineRange + "%";
  } else {
    var scrollFrac = messagesEl.scrollTop / scrollH;
    var viewFrac = viewH / scrollH;
    viewport.style.top = (timelineStart + scrollFrac * timelineRange) + "%";
    viewport.style.height = (viewFrac * timelineRange) + "%";
  }
}

function scrollToSearchHit(historyIndex, snippet, query) {
  var historyFrom = ctx.getHistoryFrom ? ctx.getHistoryFrom() : 0;
  if (historyIndex < historyFrom) {
    // Need to load older history first
    pendingScrollTarget = { historyIndex: historyIndex, snippet: snippet, query: query };
    if (ctx.ws && ctx.ws.readyState === 1) {
      ctx.ws.send(JSON.stringify({ type: "load_more_history", before: historyFrom, target: historyIndex }));
    }
    return;
  }
  findAndScrollToMatch(snippet, query);
}

function findAndScrollToMatch(snippet, query) {
  var messagesEl = ctx.messagesEl;
  var q = query.toLowerCase();
  var allMsgs = messagesEl.querySelectorAll(".msg-user, .msg-assistant, .debate-turn, .debate-user-comment");
  var cleanSnippet = snippet.replace(/^\u2026/, "").replace(/\u2026$/, "");

  for (var i = 0; i < allMsgs.length; i++) {
    var msgEl = allMsgs[i];
    var textEl = msgEl.querySelector(".bubble") || msgEl.querySelector(".md-content") || msgEl.querySelector(".debate-comment-text");
    if (!textEl) continue;
    var text = textEl.textContent || "";
    if (text.indexOf(cleanSnippet) !== -1) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
      msgEl.classList.remove("search-blink");
      void msgEl.offsetWidth;
      msgEl.classList.add("search-blink");
      return;
    }
  }
  // Fallback: any element containing the query
  for (var j = 0; j < allMsgs.length; j++) {
    var el = allMsgs[j];
    var tEl = el.querySelector(".bubble") || el.querySelector(".md-content") || el.querySelector(".debate-comment-text");
    if (!tEl) continue;
    if ((tEl.textContent || "").toLowerCase().indexOf(q) !== -1) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("search-blink");
      void el.offsetWidth;
      el.classList.add("search-blink");
      return;
    }
  }
}

// --- DOM highlighting ---
function highlightInElement(el, queryLower) {
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  var textNodes = [];
  var node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  for (var i = 0; i < textNodes.length; i++) {
    var textNode = textNodes[i];
    var parent = textNode.parentNode;
    if (!parent || parent.classList && parent.classList.contains(highlightClass)) continue;
    if (parent.tagName === "BUTTON" || parent.tagName === "SCRIPT" || parent.tagName === "STYLE") continue;

    var text = textNode.nodeValue;
    var textLower = text.toLowerCase();
    var idx = textLower.indexOf(queryLower);
    if (idx === -1) continue;

    var frag = document.createDocumentFragment();
    var lastIdx = 0;

    while (idx !== -1) {
      if (idx > lastIdx) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
      }
      var mark = document.createElement("mark");
      mark.className = highlightClass;
      mark.textContent = text.substring(idx, idx + currentQuery.length);
      frag.appendChild(mark);
      lastIdx = idx + currentQuery.length;
      idx = textLower.indexOf(queryLower, lastIdx);
    }

    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
    }

    parent.replaceChild(frag, textNode);
  }
}

function clearHighlights() {
  var messagesEl = ctx.messagesEl;
  var marks = messagesEl.querySelectorAll("mark." + highlightClass);
  for (var i = 0; i < marks.length; i++) {
    var mark = marks[i];
    var parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  }
  matches = [];
  currentMatchIndex = -1;
}

function setActiveMatch(index) {
  var prev = ctx.messagesEl.querySelector("." + activeHighlightClass);
  if (prev) prev.classList.remove(activeHighlightClass);

  if (index >= 0 && index < matches.length) {
    matches[index].classList.add(activeHighlightClass);
    matches[index].scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function goToNextMatch() {
  if (matches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % matches.length;
  setActiveMatch(currentMatchIndex);
  setSearchStatus((currentMatchIndex + 1) + " / " + matches.length +
    (serverHits.length > matches.length ? " (" + serverHits.length + " total)" : ""));
}

function goToPrevMatch() {
  if (matches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
  setActiveMatch(currentMatchIndex);
  setSearchStatus((currentMatchIndex + 1) + " / " + matches.length +
    (serverHits.length > matches.length ? " (" + serverHits.length + " total)" : ""));
}

export { initSessionSearch, openSearch, closeSearch, toggleSearch, isSearchOpen, handleFindInSessionResults, onHistoryPrepended };
