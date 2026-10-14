// This projection is an allowlist. Never add runtime/session/path objects here.
function projectMetadata(status, access, users) {
  if (!status || status.isMate || !access || access.error) return null;
  var owner = access.ownerId && users.findUserById(access.ownerId);
  return {
    slug: status.slug,
    project: status.title || status.project || status.slug,
    title: status.title || status.project || status.slug,
    projectOwnerId: owner ? owner.id : null,
    ownerName: owner ? (owner.displayName || owner.username) : "Ownership needs recovery",
    visibility: access.visibility,
    contentAccess: false,
    administrativeAccess: true,
    ownershipRecovery: access.ownershipRecovery === "required" || !owner,
    runtimeHealth: "Registered",
  };
}

function metadataFor(user, status, access, users) {
  if (!user || !users.findUserById(user.id) || user.role !== "admin" || !status || status.isMate || /^mate-/.test(status.slug)) return null;
  return projectMetadata(status, access, users);
}

function escape(value) {
  return String(value || "").replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function page(metadata, projects) {
  var privacyText = metadata.ownershipRecovery
    ? "Content remains restricted because no verified owner is available. Ask the server operator to verify the account’s OS UID and real home/project mapping, then run the documented ownership repair."
    : "Conversations, files and terminals are private. Ask the owner to share project access.";
  var accessText = metadata.ownershipRecovery
    ? "Ownership needs recovery. The server operator must independently verify or repair the authoritative account-to-OS mapping before ownership repair can succeed. Ambiguous records stay restricted; administrator status cannot claim this project. See the Project ownership and administrator access guide."
    : "Only the project owner can change ownership, visibility and sharing. Administrator status does not grant access to private content.";
  var strip = projects.filter(function (project) { return !project.isMate; }).map(function (project) {
    return '<a class="icon-strip-item' + (project.slug === metadata.slug ? ' active' : '') + '" href="/p/' + encodeURIComponent(project.slug) + '/" title="' + escape(project.title || project.project) + '"><span class="icon-strip-name">' + escape((project.title || project.project || project.slug).substring(0, 2)) + '</span></a>';
  }).join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(metadata.title) + ' · Clay</title>' +
    '<script src="/appearance-bootstrap.js"></script><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/project-admin-overview.css"></head><body>' +
    '<div id="layout"><header id="top-bar"><a href="/" class="top-bar-brand-link" aria-label="Clay home"><span class="top-bar-brand-wordmark"></span></a></header>' +
    '<div id="layout-body"><nav id="icon-strip" aria-label="Projects"><div class="icon-strip-projects">' + strip + '</div></nav>' +
    '<main id="main-area" class="project-admin-overview"><div class="project-admin-canvas"><h1>' + escape(metadata.title) + '</h1>' +
    '<div role="tablist" aria-label="Project information"><button type="button" role="tab" aria-selected="true" id="overview-tab" aria-controls="overview-panel">Overview</button><button type="button" role="tab" aria-selected="false" id="access-tab" aria-controls="access-panel">Access</button></div>' +
    '<section id="overview-panel" role="tabpanel" aria-labelledby="overview-tab"><dl><dt>Owner</dt><dd>' + escape(metadata.ownerName) + '</dd><dt>Visibility</dt><dd>' + escape(metadata.visibility) + '</dd><dt>Status</dt><dd>' + (metadata.ownershipRecovery ? 'Ownership needs recovery' : escape(metadata.runtimeHealth)) + '</dd><dt>Your access</dt><dd>Administrative metadata only</dd></dl><p>' + escape(privacyText) + '</p><p class="project-admin-secondary">Resource usage is unavailable for this project.</p></section>' +
    '<section id="access-panel" role="tabpanel" aria-labelledby="access-tab" hidden><h2>Administrative metadata only</h2><p>' + escape(accessText) + '</p></section></div></main></div></div>' +
    '<script type="module" src="/modules/project-admin-overview.js"></script></body></html>';
}

module.exports = { metadataFor: metadataFor, page: page };
