// Codex restores dynamic definitions from the original thread catalog.
// Keep persisted legacy field names here so old conversations remain readable.
var fields = {
  schedules: "codexDynamicToolCatalogVersion",
  questions: "codexUserInputToolCatalogVersion",
  browser: "codexSharedBrowserToolCatalogVersion",
  issues: "codexIssuesToolCatalogVersion",
  knowledge: "codexYouToolCatalogVersion",
  linear: "codexLinearToolCatalogVersion",
  notes: "codexNotesToolCatalogVersion",
};
module.exports = {
  toolTransport: "dynamic",
  catalogLifetime: "conversation",
  externalToolTransport: "dynamic",
  defaultUserInputMode: "fallback",
  questionGuidance: require("../user-input-guidance").codexQuestionGuidance,
  catalogVersion: function (session, family) { return Number(session[fields[family]] || 0); },
  recordCatalog: function (session, versions) {
    Object.keys(versions).forEach(function (family) {
      if (fields[family]) session[fields[family]] = versions[family];
    });
  },
  staleCatalogReason: "This Codex conversation predates Clay's scheduled-task tool catalog. Start a new conversation to use the assisted interview; manual task creation remains available here.",
};
