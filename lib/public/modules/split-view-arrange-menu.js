import { iconHtml } from './icons.js';
import { appendLayoutOption } from './split-view-layout-icons.js';
import { SPLIT_SIDES } from './split-view-picker-render.js';

export function ensureArrangeMenu(closePresentationArrange) {
  var menu = document.getElementById("split-view-arrange-menu");
  if (menu) return menu;
  menu = document.createElement("div"); menu.id = "split-view-arrange-menu"; menu.className = "split-view-arrange";
  menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "Arrange Split view"); menu.hidden = true;
  var header = document.createElement("div"); header.className = "split-view-arrange-header";
  var title = document.createElement("strong"); title.textContent = "Arrange Split view"; header.appendChild(title);
  var close = document.createElement("button"); close.type = "button"; close.setAttribute("aria-label", "Close arrangement menu"); close.innerHTML = iconHtml("x"); header.appendChild(close);
  close.addEventListener("click", function () { closePresentationArrange(); }); menu.appendChild(header);
  var presets = [["balanced", "Balanced"], ["columns", "Columns"], ["rows", "Rows"], ["grid", "Grid"], ["main-left", "Main left"], ["main-right", "Main right"]];
  var presetGrid = document.createElement("div"); presetGrid.className = "split-view-arrange-grid";
  presets.forEach(function (item) { var button = document.createElement("button"); button.type = "button"; button.dataset.preset = item[0]; appendLayoutOption(button, item[1], "preset", item[0]); presetGrid.appendChild(button); });
  menu.appendChild(presetGrid);
  var positions = [["left", "Left half"], ["right", "Right half"], ["top", "Top half"], ["bottom", "Bottom half"], ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"], ["left-third", "Left third"], ["right-third", "Right third"]];
  var positionGrid = document.createElement("div"); positionGrid.className = "split-view-arrange-grid split-view-arrange-positions";
  positions.forEach(function (item) { var button = document.createElement("button"); button.type = "button"; button.dataset.position = item[0]; appendLayoutOption(button, item[1], "position", item[0]); positionGrid.appendChild(button); });
  menu.appendChild(positionGrid);
  var additions = document.createElement('div'); additions.className = 'split-session-directions';
  SPLIT_SIDES.forEach(function (side) {
    var button = document.createElement('button'); button.type = 'button'; button.dataset.arrangeAddSide = side[0];
    button.innerHTML = iconHtml(side[2]); var label = document.createElement('span'); label.textContent = 'Add ' + side[1] + ' Split'; button.appendChild(label); additions.appendChild(button);
  });
  menu.appendChild(additions);
  var focusButton = document.createElement("button"); focusButton.type = "button"; focusButton.dataset.focusLayout = "true"; menu.appendChild(focusButton);
  var membership = document.createElement("button"); membership.type = "button"; membership.dataset.arrangeMembership = "true";
  membership.textContent = "Choose sessions"; menu.appendChild(membership);
  var context = document.createElement("div"); context.className = "split-view-arrange-context";
  var contextButton = document.createElement("button"); contextButton.type = "button"; contextButton.dataset.arrangeContext = "true";
  contextButton.setAttribute("aria-expanded", "false"); contextButton.setAttribute("aria-controls", "split-view-arrange-context-list");
  var contextTitle = document.createElement("span"); contextTitle.dataset.arrangeContextTitle = "true"; contextButton.appendChild(contextTitle); context.appendChild(contextButton);
  var contextList = document.createElement("div"); contextList.id = "split-view-arrange-context-list"; contextList.hidden = true; contextList.setAttribute("role", "listbox");
  context.appendChild(contextList); menu.insertBefore(context, presetGrid);
  document.body.appendChild(menu); return menu;
}
