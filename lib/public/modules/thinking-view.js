import { thinkingSummary } from './thinking-summary.js';
import { renderMarkdown } from './markdown.js';

export function prepareThinkingView(el) {
  el.hidden = false;
  el.classList.remove("empty", "done", "expanded", "thinking-live");
  var header = el.querySelector(".thinking-header");
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "false");
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

export function updateThinkingView(el, summaryText, detailsText) {
  var summary = thinkingSummary(summaryText);
  var label = el.querySelector(".thinking-label");
  label.textContent = summary;
  label.title = summary;
  el.querySelector(".thinking-content").innerHTML = detailsText.trim() ? renderMarkdown(detailsText) : "";
}

export function setThinkingViewLive(el, live) {
  el.classList.toggle("thinking-live", !!live);
}

export function beginThinkingView(el, shimmer) {
  el.hidden = false;
  el.classList.remove("done", "empty", "expanded");
  setThinkingViewLive(el, shimmer);
  var header = el.querySelector(".thinking-header");
  header.setAttribute("aria-expanded", "false");
  header.setAttribute("aria-disabled", "true");
  header.tabIndex = -1;
  header.style.cursor = "";
  el.querySelector(".thinking-chevron").style.display = "";
}

export function finishThinkingView(el, summaryText, detailsText) {
  el.classList.remove("thinking-live");
  el.classList.add("done");
  el.classList.remove("expanded");
  updateThinkingView(el, summaryText, detailsText);
  var hasContent = !!detailsText.trim();
  var header = el.querySelector(".thinking-header");
  header.setAttribute("aria-expanded", "false");
  header.setAttribute("aria-disabled", hasContent ? "false" : "true");
  header.tabIndex = hasContent ? 0 : -1;
  header.style.cursor = hasContent ? "pointer" : "default";
  el.hidden = !hasContent;
  if (!hasContent) {
    el.classList.add("empty");
    el.querySelector(".thinking-chevron").style.display = "none";
  }
}
