// Small dependency-free model catalog helpers shared by server resolvers.

function modelEntryValue(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.value || entry.id || "";
}

function modelEntryMatches(entry, value) {
  if (!entry || !value) return false;
  if (typeof entry === "string") return entry === value;
  return entry.value === value || entry.id === value || entry.resolvedModel === value;
}

module.exports = { modelEntryValue: modelEntryValue, modelEntryMatches: modelEntryMatches };
