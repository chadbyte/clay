// Per-vendor usage capability for all eleven Clay vendors.
//
// mode:
//   query         Clay asks the vendor's own native source for account figures
//                 (a reader exists in lib/vendor-usage-*-readers.js).
//   event         The vendor pushes quota into a session; only the latest
//                 observed snapshot of the owner's own sessions is shown.
//   unintegrated  A source may exist, but it is not verified safe or not
//                 reachable from Clay's integration, so Clay does not read it.
//                 This is "not integrated", never "the provider has none".
//
// `observed` is true when session-observed quota can also be displayed (the
// existing rate-limit snapshot path). `units` lists the metric kinds the reader
// returns; they are never converted to each other. `identity` states what a
// direct account read needs: "owner-os-user" (the runtime runs as the owner's
// mapped OS user), "owner-session" (answered by one of the owner's own live
// sessions), "single-user" (the credential is the server user's; refused in
// account mode because no owner can be proven), or null.
//
// Evidence kinds in `source`/`reason`: "installed" = observed on the installed
// CLI/SDK in this repository's environment; "primary doc" = the vendor's own
// documentation; "Orca" = Orca@17a2bced code only (not independently run here).

var CAPABILITIES = {
  claude: {
    mode: "query", observed: true, units: ["percent", "credits", "currency"], identity: "owner-session",
    source: "Claude SDK account usage call on one of your live sessions (installed SDK 0.3.x; the SDK marks it experimental, so it is capability-guarded and shape-checked); session rate_limit_event otherwise",
  },
  codex: {
    mode: "query", observed: true, units: ["percent", "credits"], identity: "owner-os-user",
    source: "codex app-server account/rateLimits/read (installed protocol schema) and account/rateLimits/updated events",
  },
  muse: {
    mode: "query", observed: true, units: ["percent"], identity: "single-user",
    source: "Muse Code usage/read (installed adapter) and usage/changed events",
  },
  antigravity: {
    mode: "unintegrated", observed: false, units: [], identity: null,
    reason: "Not integrated: the only known read is print-mode `agy -p /usage` (Orca), which Orca documents as spending a model turn on versions that answer it as a prompt. Stays disabled until a non-billable path is proven.",
  },
  opencode: {
    mode: "unintegrated", observed: false, units: [], identity: null,
    reason: "Not integrated: OpenCode Go quota exists (Orca reads it with an OpenCode Go key) but OpenCode hosts many backends and Clay cannot tell which one a session uses; ACP exposes context tokens only.",
  },
  kimi: {
    mode: "query", observed: false, units: ["count"], identity: "single-user",
    source: "Kimi Code GET /usages with the CLI's saved token (Orca; Kimi CLI not installed here). Counts only: the response does not name a period or unit.",
  },
  grok: {
    mode: "query", observed: false, units: ["percent", "amount"], identity: "single-user",
    source: "Grok CLI chat proxy GET /billing with the CLI's saved token (Orca; Grok CLI not installed here). Money fields carry no currency, so they stay unit-less amounts.",
  },
  copilot: {
    mode: "unintegrated", observed: false, units: [], identity: null,
    reason: "Not integrated: GitHub's Copilot SDK documents account.getQuota (entitlement, used requests, remaining %, reset date), but Clay talks to the Copilot CLI over ACP and ships no SDK client; ACP exposure of it is unverified.",
  },
  qwen: {
    mode: "unintegrated", observed: false, units: [], identity: null,
    reason: "Not integrated: Qwen Code's documented /stats and /context report session token and call metrics; no account quota read is documented (primary doc, checked this task).",
  },
  junie: {
    mode: "unintegrated", observed: false, units: [], identity: null,
    reason: "Not integrated: Junie CLI documents a /usage slash command (session cost and remaining balance), but running it through ACP could be treated as a prompt; side effects are unverified.",
  },
  kiro: {
    mode: "query", observed: false, units: ["credits", "currency"], identity: "single-user",
    source: "Kiro ACP `_kiro.dev/commands/execute` command usage (installed kiro-cli 2.32.0: structured credits used/limit and billing-cycle reset; no model turn observed). Creates an empty local session record.",
  },
};

var VENDORS = Object.keys(CAPABILITIES);

function capabilityFor(vendor) {
  var entry = CAPABILITIES[vendor];
  if (!entry) return { mode: "unintegrated", observed: false, units: [], identity: null, reason: "Not integrated: no usage source has been reviewed for this vendor." };
  return entry;
}

// Serializable form for the client; never includes functions.
function publicCapability(vendor) {
  var entry = capabilityFor(vendor);
  var result = { mode: entry.mode, observed: entry.observed === true, units: entry.units.slice() };
  if (entry.source) result.source = entry.source;
  if (entry.reason) result.reason = entry.reason;
  return result;
}

module.exports = { VENDORS: VENDORS, capabilityFor: capabilityFor, publicCapability: publicCapability };
