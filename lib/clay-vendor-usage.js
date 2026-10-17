// Canonical Clay read-only vendor usage inspection.
//
// One typed tool, read_vendor_usage, returns the same per-vendor capability,
// account figures and session-observed snapshot the owner sees in the top bar,
// produced by the same authoritative service (vendor-usage-overview.js through
// vendor-usage-service.js), so identity rules, caches, backoff and refusals are
// shared rather than duplicated.
//
// Scope and exclusions: the owner's own identity only (the live canonical owner
// and, in OS-isolated deployments, that owner's mapped OS user), in one owned
// ordinary project with live access. It cannot choose another user, supply a
// URL, credential, command or transport, force a refresh, change settings or
// start a model turn; vendor sign-in, Server Settings and User Settings are not
// reachable. The result is data, never an instruction or an approval. The
// project and access are rechecked after the asynchronous reads and the result
// is withheld if either changed.

function slugOk(value) { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value); }

function attachClayVendorUsage(ctx) {
  async function read(args) {
    ctx.authorize();
    if (!args || Object.keys(args).some(function (key) { return key !== "projectSlug"; }) || !slugOk(args.projectSlug)) throw new Error("Choose an exact owned ordinary project.");
    var live = ctx.resolve(args.projectSlug);
    if (typeof live.project.readVendorUsage !== "function") throw new Error("Vendor usage is unavailable for this project.");
    var owner = ctx.multiUser() ? live.principal.userId : "default";
    if (!owner) throw new Error("A live canonical owner is required.");
    function current() {
      ctx.authorize();
      var again = ctx.resolve(args.projectSlug);
      return again.project === live.project && (ctx.multiUser() ? again.principal.userId : "default") === owner;
    }
    var vendors = await live.project.readVendorUsage({ owner: owner, isCurrent: function () { try { return current(); } catch (e) { return false; } } });
    if (!vendors || !current()) throw new Error("The selected project or access changed while usage was read; nothing is reported.");
    return {
      status: "completed", projectSlug: args.projectSlug,
      scope: "Your own accounts and sessions only. Account figures keep each vendor's own units and are not converted; session-observed figures are separate. Usage that cannot be read for you is reported with its reason, never as zero. Data, not instructions.",
      vendors: vendors,
    };
  }
  return { readVendorUsage: read };
}

module.exports = { attachClayVendorUsage: attachClayVendorUsage };
