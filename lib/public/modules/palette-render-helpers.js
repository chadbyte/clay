export function formatRelativeDate(ts) {
  if (!ts) return "";
  var diff = Math.max(0, Date.now() - ts);
  var min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var days = Math.floor(hr / 24);
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  var d = new Date(ts);
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}


export function paletteSelectionIndex(previous, items, query) {
  var index = previous ? items.findIndex(function (item) {
    if (item.type !== previous.type || item.query !== previous.query) return false;
    if (!item.data || !previous.data) return !item.data && !previous.data;
    return item.data.projectSlug === previous.data.projectSlug && item.data.sessionId === previous.data.sessionId && item.data.sessionOriginId === previous.data.sessionOriginId;
  }) : -1;
  return index >= 0 ? index : query ? 0 : -1;
}
