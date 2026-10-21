// Inline, accessible layout previews for the presentation Arrange chooser.
var PRESET_TILES = {
  balanced: [[3, 3, 16, 18], [21, 3, 12, 8], [21, 13, 12, 8]],
  columns: [[3, 3, 8, 18], [13, 3, 8, 18], [23, 3, 10, 18]],
  rows: [[3, 3, 30, 4], [3, 9, 30, 5], [3, 16, 30, 5]],
  grid: [[3, 3, 14, 8], [19, 3, 14, 8], [3, 13, 14, 8], [19, 13, 14, 8]],
  "main-left": [[3, 3, 19, 18], [24, 3, 9, 8], [24, 13, 9, 8]],
  "main-right": [[14, 3, 19, 18], [3, 3, 9, 8], [3, 13, 9, 8]]
};
var POSITION_TILES = {
  left: [[3, 3, 14, 18], [19, 3, 14, 18]], right: [[19, 3, 14, 18], [3, 3, 14, 18]],
  top: [[3, 3, 30, 8], [3, 13, 30, 8]], bottom: [[3, 13, 30, 8], [3, 3, 30, 8]],
  "top-left": [[3, 3, 14, 8], [19, 3, 14, 8], [3, 13, 14, 8], [19, 13, 14, 8]],
  "top-right": [[19, 3, 14, 8], [3, 3, 14, 8], [19, 13, 14, 8], [3, 13, 14, 8]],
  "bottom-left": [[3, 13, 14, 8], [19, 13, 14, 8], [3, 3, 14, 8], [19, 3, 14, 8]],
  "bottom-right": [[19, 13, 14, 8], [3, 13, 14, 8], [19, 3, 14, 8], [3, 3, 14, 8]],
  "left-third": [[3, 3, 8, 18], [13, 3, 20, 18]], "right-third": [[23, 3, 10, 18], [3, 3, 18, 18]]
};

export function appendLayoutOption(button, label, kind, value) {
  var tiles = kind === "preset" ? PRESET_TILES[value] : POSITION_TILES[value];
  if (!tiles) return false;
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "split-view-layout-icon"); svg.setAttribute("viewBox", "0 0 36 24");
  svg.setAttribute("aria-hidden", "true" );
  var frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  frame.setAttribute("class", "split-view-layout-frame"); frame.setAttribute("x", "1"); frame.setAttribute("y", "1");
  frame.setAttribute("width", "34"); frame.setAttribute("height", "22"); frame.setAttribute("rx", "2"); svg.appendChild(frame);
  tiles.forEach(function (tile, index) {
    var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "split-view-layout-tile" + (index === 0 ? " split-view-layout-selected" : ""));
    rect.setAttribute("x", String(tile[0])); rect.setAttribute("y", String(tile[1]));
    rect.setAttribute("width", String(tile[2])); rect.setAttribute("height", String(tile[3])); rect.setAttribute("rx", "1"); svg.appendChild(rect);
  });
  var text = document.createElement("span"); text.className = "split-view-layout-label"; text.textContent = label;
  button.appendChild(svg); button.appendChild(text); return true;
}
