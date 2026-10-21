// Allowlisted display fields and scalar aggregates, never session identities or path/runtime objects.
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
    icon: typeof status.icon === 'string' ? status.icon : null,
    isWorktree: status.isWorktree === true,
    parentSlug: status.isWorktree === true && typeof status.parentSlug === 'string' ? status.parentSlug : null,
    sessions: Number.isSafeInteger(status.sessions) && status.sessions >= 0 ? status.sessions : null,
    clients: Number.isSafeInteger(status.clients) && status.clients >= 0 ? status.clients : null,
    isProcessing: typeof status.isProcessing === 'boolean' ? status.isProcessing : null,
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
  var navigation = projects.filter(function (project) { return !project.isMate; }).map(function (project) {
    return { slug: project.slug, title: project.title || project.project || project.slug, icon: typeof project.icon === 'string' ? project.icon : null,
      isWorktree: project.isWorktree === true, parentSlug: project.parentSlug || null, contentAccess: project.contentAccess !== false };
  });
  var payload = JSON.stringify({ project: metadata, projects: navigation }).replace(/</g, "\\u003c");
  function fact(label, value) { return '<div><dt>' + escape(label) + '</dt><dd>' + escape(value === null ? 'Unavailable' : String(value)) + '</dd></div>'; }
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(metadata.title) + ' · Clay</title>' +
    '<script src="/appearance-bootstrap.js"></script><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/project-admin-overview.css"></head><body class="project-admin-page">' +
    '<div id="layout"><header id="top-bar"><a href="/" class="top-bar-brand-link" aria-label="Clay home"><span class="top-bar-brand-wordmark"></span></a><span class="project-admin-role">Server administration</span></header>' +
    '<div id="layout-body"><nav id="icon-strip" aria-label="Projects"><a class="icon-strip-home" href="/" aria-label="Clay home" data-tip="Clay home"><img class="icon-strip-logo" src="/clay-studio-symbol.png" alt="" width="38" height="38"></a><div class="icon-strip-separator"></div><div class="icon-strip-projects" id="icon-strip-projects"></div></nav>' +
    '<main id="main-area" class="project-admin-overview"><div class="project-admin-canvas"><div class="project-admin-heading"><div><p class="project-admin-eyebrow">Project overview</p><h1>' + escape(metadata.title) + '</h1><p id="project-admin-parent" hidden></p></div><span class="project-admin-access-badge">Content restricted</span></div>' +
    '<div role="tablist" aria-label="Project information"><button type="button" role="tab" aria-selected="true" id="overview-tab" aria-controls="overview-panel">Overview</button><button type="button" role="tab" aria-selected="false" id="access-tab" aria-controls="access-panel">Access</button></div>' +
    '<section id="overview-panel" role="tabpanel" aria-labelledby="overview-tab"><dl class="project-admin-facts">' + fact('Owner', metadata.ownerName) + fact('Visibility', metadata.visibility) + fact('Registration', metadata.runtimeHealth) + fact('Sessions', metadata.sessions) + fact('Connected clients', metadata.clients) + fact('Agent activity', metadata.isProcessing === null ? null : metadata.isProcessing ? 'Active turn reported' : 'No active turn reported') + '</dl><p class="project-admin-secondary">Session and activity counts reflect this page load.</p>' +
    '<section class="project-admin-storage" aria-labelledby="storage-heading"><div class="project-admin-section-heading"><h2 id="storage-heading">Storage</h2><button type="button" id="project-admin-refresh">Refresh usage</button></div><div id="project-admin-usage" aria-busy="true"><dl class="project-admin-metrics"><div><dt>Project allocated</dt><dd id="usage-bytes">—</dd></div><div><dt>Files</dt><dd id="usage-files">—</dd></div><div><dt>Volume available</dt><dd id="usage-free">—</dd></div><div><dt>Volume capacity</dt><dd id="usage-capacity">—</dd></div></dl><p id="usage-status" role="status">Measuring storage…</p><p class="project-admin-secondary">Allocated filesystem blocks, including dependencies. Nested registered projects are counted separately; hard links shared across projects are excluded. Volume space is shared, not a project quota.</p></div></section>' +
    '<div class="project-admin-notice"><h2>Administrative metadata only</h2><p>' + escape(privacyText) + '</p></div></section>' +
    '<section id="access-panel" role="tabpanel" aria-labelledby="access-tab" hidden><h2>Administrative metadata only</h2><p>' + escape(accessText) + '</p><dl class="project-admin-facts">' + fact('Owner', metadata.ownerName) + fact('Your access', 'Administrative metadata only') + '</dl></section></div></main></div></div>' +
    '<script type="application/json" id="project-admin-data">' + payload + '</script><script type="module" src="/modules/project-admin-overview.js"></script></body></html>';
}

module.exports = { metadataFor: metadataFor, page: page };
