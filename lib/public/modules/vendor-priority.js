export var VENDOR_ORDER = ["claude", "codex", "muse", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];

// Availability comes from the caller's server catalog. Unknown providers keep
// their catalog order within each availability group.
export function sortVendorEntries(entries) {
  return entries.map(function (entry, index) { return { entry: entry, index: index }; }).sort(function (a, b) {
    var installed = Number(!!b.entry.installed) - Number(!!a.entry.installed);
    if (installed) return installed;
    var aRank = VENDOR_ORDER.indexOf(a.entry.id);
    var bRank = VENDOR_ORDER.indexOf(b.entry.id);
    if (aRank === -1) aRank = VENDOR_ORDER.length;
    if (bRank === -1) bRank = VENDOR_ORDER.length;
    return aRank - bRank || a.index - b.index;
  }).map(function (item) { return item.entry; });
}
export var EXPERIMENTAL_VENDORS = ["grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode"];

export function isExperimentalVendor(vendor) {
  return EXPERIMENTAL_VENDORS.indexOf(vendor) !== -1;
}

export function firstInstalledVendor(installedVendors) {
  var installed = Array.isArray(installedVendors) ? installedVendors : [];
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    if (installed.indexOf(VENDOR_ORDER[i]) !== -1) return VENDOR_ORDER[i];
  }
  return "";
}
