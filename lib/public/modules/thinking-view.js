import { thinkingSummary } from './thinking-summary.js';
import { renderMarkdown } from './markdown.js';
import { store } from './store.js';

export function prepareThinkingView(el) {
  el.classList.remove("empty", "done");
  el.classList.toggle("thinking-live", !store.get('replayingHistory'));
  var header = el.querySelector(".thinking-header");
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", el.classList.contains("expanded") ? "true" : "false");
  header.setAttribute("aria-disabled", "true");
  header.tabIndex = -1;
  header.style.cursor = "";
  el.querySelector(".thinking-chevron").style.display = "";
  el.querySelector(".thinking-label").textContent = "Thinking";
  el.querySelector(".thinking-label").removeAttribute("title");
  el.querySelector(".thinking-duration").textContent = "";
  el.querySelector(".thinking-content").textContent = "";
}

export function bindThinkingView(el) {
  var header = el.querySelector(".thinking-header");
  function toggle() {
    if (header.getAttribute("aria-disabled") === "true") return;
    el.classList.toggle("expanded");
    header.setAttribute("aria-expanded", el.classList.contains("expanded") ? "true" : "false");
  }
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

export function updateThinkingView(el, text) {
  var hasContent = !!text.trim();
  var summary = thinkingSummary(text);
  var label = el.querySelector(".thinking-label");
  label.textContent = summary;
  label.title = summary;
  var header = el.querySelector(".thinking-header");
  header.setAttribute("aria-disabled", hasContent ? "false" : "true");
  header.tabIndex = hasContent ? 0 : -1;
  el.querySelector(".thinking-content").innerHTML = hasContent ? renderMarkdown(text) : "";
  if (hasContent && el.classList.contains("mate-thinking")) {
    var activity = el.querySelector(".mate-thinking-activity");
    if (activity) activity.style.display = "none";
    header.style.display = "";
  }
}

export function finishThinkingView(el, text) {
  el.classList.remove("thinking-live");
  updateThinkingView(el, text);
  if (!text.trim()) {
    el.classList.add("empty");
    el.classList.remove("expanded");
    var header = el.querySelector(".thinking-header");
    header.setAttribute("aria-expanded", "false");
    el.querySelector(".thinking-chevron").style.display = "none";
  }
}
