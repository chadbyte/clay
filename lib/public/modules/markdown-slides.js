import { store } from './store.js';
import { refreshIcons } from './icons.js';

var levelMenu = null;

function normalizedLevel(level) {
  var parsed = Number(level);
  return parsed >= 1 && parsed <= 3 ? parsed : 1;
}

function directHeadings(markdownEl, level) {
  if (!markdownEl) return [];
  var tagName = "H" + normalizedLevel(level);
  return Array.from(markdownEl.children).filter(function (child) {
    return child.tagName === tagName;
  });
}

export function countMarkdownSlides(markdownEl, level) {
  return directHeadings(markdownEl, level).length;
}

export function markdownSlideHeadingCounts(markdownEl) {
  return [0, 1, 2, 3].map(function (level) {
    return level === 0 ? 0 : countMarkdownSlides(markdownEl, level);
  });
}

export function chooseMarkdownSlideLevel(counts, preferred, fallback) {
  var selected = normalizedLevel(preferred || fallback);
  if (preferred && counts[selected] > 0) return selected;
  if (counts[1] === 1 && counts[2] > 1) return 2;
  if (counts[1] > 0) return 1;
  if (counts[2] > 0) return 2;
  if (counts[3] > 0) return 3;
  return selected;
}

export function suggestedMarkdownSlideLevel(markdownEl) {
  var selected = store.get('markdownSlidePreferredLevel') || store.get('markdownSlideLevel');
  return chooseMarkdownSlideLevel(markdownSlideHeadingCounts(markdownEl), store.get('markdownSlideLevelExplicit') ? selected : null, selected);
}

function updateSlideButton(active, available, level) {
  var button = document.getElementById("file-viewer-slides");
  var levelButton = document.getElementById("file-viewer-slide-level");
  var selectedLevel = normalizedLevel(level || store.get('markdownSlideLevel'));
  if (!button) return;
  button.classList.toggle("hidden", !available);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.setAttribute("aria-label", active ? "Exit slide show" : "Present Markdown by H" + selectedLevel + " headings");
  button.title = active ? "Exit slide show (Esc)" : "Present by H" + selectedLevel + " sections";
  if (levelButton) {
    levelButton.classList.toggle("hidden", !available || active);
    levelButton.setAttribute("aria-label", "Choose slide heading level. Current: H" + selectedLevel);
    levelButton.title = "Split slides by heading level";
    var label = levelButton.querySelector("span");
    if (label) label.textContent = "H" + selectedLevel;
  }
}

export function syncMarkdownSlidesButton(markdownEl) {
  if (!markdownEl) {
    closeMarkdownSlideLevelMenu();
    updateSlideButton(false, false, store.get('markdownSlideLevel'));
    return 0;
  }
  var level = suggestedMarkdownSlideLevel(markdownEl);
  var count = countMarkdownSlides(markdownEl, level);
  store.set({ markdownSlideLevel: level });
  updateSlideButton(false, count > 0, level);
  return count;
}

function closeLevelMenuOnOutside(event) {
  var button = document.getElementById("file-viewer-slide-level");
  if (levelMenu && (levelMenu.contains(event.target) || (button && button.contains(event.target)))) return;
  closeMarkdownSlideLevelMenu();
}

export function closeMarkdownSlideLevelMenu() {
  if (levelMenu) levelMenu.remove();
  levelMenu = null;
  document.removeEventListener("pointerdown", closeLevelMenuOnOutside);
  var button = document.getElementById("file-viewer-slide-level");
  if (button) button.setAttribute("aria-expanded", "false");
}

export function toggleMarkdownSlideLevelMenu(markdownEl) {
  if (levelMenu) {
    closeMarkdownSlideLevelMenu();
    return;
  }
  if (!markdownEl) return;
  var button = document.getElementById("file-viewer-slide-level");
  if (!button) return;
  var selected = normalizedLevel(store.get('markdownSlideLevel'));
  var menu = document.createElement("div");
  menu.className = "markdown-slide-level-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Slide heading level");
  menu.innerHTML = '<div class="markdown-slide-level-title">Start a new slide at</div>';
  for (var level = 1; level <= 3; level++) {
    var count = countMarkdownSlides(markdownEl, level);
    var option = document.createElement("button");
    option.type = "button";
    option.className = "markdown-slide-level-option" + (level === selected ? " selected" : "");
    option.disabled = count === 0;
    option.dataset.level = String(level);
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", level === selected ? "true" : "false");
    option.innerHTML = '<span class="markdown-slide-level-name">H' + level + '</span>' +
      '<code>' + "#".repeat(level) + '</code>' +
      '<span class="markdown-slide-level-count">' + count + (count === 1 ? " heading" : " headings") + '</span>' +
      '<i data-lucide="check"></i>';
    option.addEventListener("click", function () {
      var nextLevel = normalizedLevel(this.dataset.level);
      store.set({ markdownSlideLevel: nextLevel, markdownSlidePreferredLevel: nextLevel, markdownSlideLevelExplicit: true });
      updateSlideButton(false, true, nextLevel);
      closeMarkdownSlideLevelMenu();
      refreshIcons();
    });
    menu.appendChild(option);
  }
  document.body.appendChild(menu);
  levelMenu = menu;
  button.setAttribute("aria-expanded", "true");
  var rect = button.getBoundingClientRect();
  menu.style.left = Math.max(12, rect.right - menu.offsetWidth) + "px";
  menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 12, rect.bottom + 8) + "px";
  setTimeout(function () { document.addEventListener("pointerdown", closeLevelMenuOnOutside); }, 0);
  refreshIcons();
}

function createControls(viewer, move, exit) {
  var controls = document.createElement("div");
  controls.className = "markdown-slide-controls";
  controls.innerHTML =
    '<button type="button" class="markdown-slide-nav markdown-slide-prev" aria-label="Previous slide"><i data-lucide="arrow-left"></i></button>' +
    '<span class="markdown-slide-counter" aria-live="polite"></span>' +
    '<span class="markdown-slide-progress" aria-hidden="true"><span></span></span>' +
    '<button type="button" class="markdown-slide-nav markdown-slide-next" aria-label="Next slide"><i data-lucide="arrow-right"></i></button>' +
    '<button type="button" class="markdown-slide-exit" aria-label="Exit slide show"><i data-lucide="minimize-2"></i><span>Exit slides</span></button>';
  controls.querySelector(".markdown-slide-prev").addEventListener("click", function () { move(-1); });
  controls.querySelector(".markdown-slide-next").addEventListener("click", function () { move(1); });
  controls.querySelector(".markdown-slide-exit").addEventListener("click", exit);
  viewer.appendChild(controls);
}

export function displayMarkdownSlide(viewer, index, previous) {
  var slides = viewer.querySelectorAll(".markdown-slide-deck > .markdown-slide");
  if (!slides.length) return null;
  var next = Math.max(0, Math.min(index, slides.length - 1));
  viewer.dataset.slideDirection = next < previous ? "backward" : "forward";
  for (var i = 0; i < slides.length; i++) {
    var active = i === next;
    slides[i].classList.toggle("active", active);
    slides[i].setAttribute("aria-hidden", active ? "false" : "true");
    slides[i].toggleAttribute("inert", !active);
  }
  var counter = viewer.querySelector(".markdown-slide-counter");
  if (counter) counter.textContent = (next + 1) + " / " + slides.length;
  var progress = viewer.querySelector(".markdown-slide-progress > span");
  if (progress) progress.style.width = (((next + 1) / slides.length) * 100) + "%";
  var prevButton = viewer.querySelector(".markdown-slide-prev");
  var nextButton = viewer.querySelector(".markdown-slide-next");
  if (prevButton) prevButton.disabled = next === 0;
  if (nextButton) nextButton.disabled = next === slides.length - 1;
  slides[next].scrollTop = 0;
  return { index: next, count: slides.length };
}

export function mountMarkdownSlideDeck(viewer, markdownEl, level, move, exit) {
  var headingTag = "H" + level;
  var deck = document.createElement("div");
  deck.className = "markdown-slide-deck";
  var children = Array.from(markdownEl.children);
  var prelude = [];
  var slide = null;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child.tagName === headingTag) {
      if (!slide && prelude.length) {
        var cover = document.createElement("section");
        cover.className = "markdown-slide markdown-slide-cover";
        cover.setAttribute("role", "group");
        cover.setAttribute("aria-roledescription", "slide");
        for (var p = 0; p < prelude.length; p++) cover.appendChild(prelude[p]);
        deck.appendChild(cover);
        prelude = [];
      }
      slide = document.createElement("section");
      slide.className = "markdown-slide";
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      child.classList.add("markdown-slide-heading");
      slide.appendChild(child);
      deck.appendChild(slide);
    } else if (slide) {
      slide.appendChild(child);
    } else {
      prelude.push(child);
    }
  }

  var slides = Array.from(deck.children);
  for (var j = 0; j < slides.length; j++) {
    slides[j].setAttribute("aria-label", "Slide " + (j + 1) + " of " + slides.length);
  }
  markdownEl.appendChild(deck);
  viewer.classList.add("markdown-slides-active");
  viewer.dataset.slideLevel = String(level);
  createControls(viewer, move, exit);
  refreshIcons();
}

function showMarkdownSlide(index) {
  var viewer = document.getElementById("file-viewer");
  if (!viewer || !store.get('markdownSlidesActive')) return;
  var shown = displayMarkdownSlide(viewer, index, store.get('markdownSlideIndex') || 0);
  if (shown) store.set({ markdownSlideIndex: shown.index, markdownSlideCount: shown.count });
}

export function moveMarkdownSlide(delta) {
  showMarkdownSlide((store.get('markdownSlideIndex') || 0) + delta);
}

export function enterMarkdownSlides(markdownEl, startIndex, requestedLevel) {
  var level = normalizedLevel(requestedLevel || store.get('markdownSlideLevel'));
  if (!countMarkdownSlides(markdownEl, level)) return false;
  exitMarkdownSlides();

  var viewer = document.getElementById("file-viewer");
  mountMarkdownSlideDeck(viewer, markdownEl, level, moveMarkdownSlide, exitMarkdownSlides);
  store.set({ markdownSlidesActive: true, markdownSlideIndex: 0, markdownSlideLevel: level });
  updateSlideButton(true, true, level);
  showMarkdownSlide(typeof startIndex === "number" ? startIndex : 0);
  return true;
}

export function unmountMarkdownSlideDeck(viewer) {
  var markdownEl = viewer.querySelector(".file-viewer-markdown");
  var deck = markdownEl ? markdownEl.querySelector(":scope > .markdown-slide-deck") : null;
  if (deck) {
    var fragment = document.createDocumentFragment();
    var slides = Array.from(deck.children);
    for (var i = 0; i < slides.length; i++) {
      while (slides[i].firstChild) {
        slides[i].firstChild.classList.remove("markdown-slide-heading");
        fragment.appendChild(slides[i].firstChild);
      }
    }
    markdownEl.insertBefore(fragment, deck);
    deck.remove();
  }
  var controls = viewer.querySelector(".markdown-slide-controls");
  if (controls) controls.remove();
  viewer.classList.remove("markdown-slides-active");
  delete viewer.dataset.slideDirection;
  delete viewer.dataset.slideLevel;
}

export function exitMarkdownSlides() {
  var viewer = document.getElementById("file-viewer");
  if (!viewer) return;
  unmountMarkdownSlideDeck(viewer);
  var markdownEl = viewer.querySelector(".file-viewer-markdown");
  store.set({ markdownSlidesActive: false, markdownSlideCount: 0, markdownSlideIndex: 0 });
  closeMarkdownSlideLevelMenu();
  var level = normalizedLevel(store.get('markdownSlideLevel'));
  updateSlideButton(false, countMarkdownSlides(markdownEl, level) > 0, level);
}

export function handleSlideDeckKey(event, index, count, show, exit) {
  var key = event.key;
  if (key === "Escape") {
    event.preventDefault();
    exit();
    return true;
  }
  if (event.target && event.target.closest && event.target.closest("button, a, input, textarea, select")) return false;
  var next;
  if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " ") next = index + 1;
  else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") next = index - 1;
  else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else return false;
  event.preventDefault();
  show(next);
  return true;
}

export function handleMarkdownSlideKey(event) {
  if (levelMenu && event.key === "Escape") {
    event.preventDefault();
    closeMarkdownSlideLevelMenu();
    return true;
  }
  if (!store.get('markdownSlidesActive')) return false;
  return handleSlideDeckKey(event, store.get('markdownSlideIndex') || 0, store.get('markdownSlideCount') || 1, showMarkdownSlide, exitMarkdownSlides);
}
