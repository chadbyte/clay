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

function content(metadata, projects) {
  var privacyText = metadata.ownershipRecovery
    ? "Content remains restricted because no verified owner is available. Open Access to check the recovery owner and recover ownership."
    : "Conversations, files and terminals are private. Ask the owner to share project access.";
  var accessText = metadata.ownershipRecovery
    ? "Ownership needs recovery. Use the recovery checks below. The recovery panel identifies the account that will own this project and any directory or system identity issues."
    : "Only the project owner can change ownership, visibility and sharing. Administrator status does not grant access to private content.";
  var navigation = projects.filter(function (project) { return !project.isMate; }).map(function (project) {
    return { slug: project.slug, title: project.title || project.project || project.slug, icon: typeof project.icon === 'string' ? project.icon : null,
      isWorktree: project.isWorktree === true, parentSlug: project.parentSlug || null, contentAccess: project.contentAccess !== false };
  });
  var payload = JSON.stringify({ project: metadata, projects: navigation }).replace(/</g, "\\u003c");
  function fact(label, value) { return '<div><dt>' + escape(label) + '</dt><dd>' + escape(value === null ? 'Unavailable' : String(value)) + '</dd></div>'; }
  return '<section id="project-restricted-content" class="project-admin-overview" aria-label="Project ownership and access"><div class="project-admin-canvas"><div class="project-admin-heading"><div><p class="project-admin-eyebrow">Project overview</p><h1>' + escape(metadata.title) + '</h1><p id="project-admin-parent" hidden></p></div><span class="project-admin-access-badge">Content restricted</span></div>' +
    '<div role="tablist" aria-label="Project information"><button type="button" role="tab" aria-selected="true" id="overview-tab" aria-controls="overview-panel">Overview</button><button type="button" role="tab" aria-selected="false" id="access-tab" aria-controls="access-panel">Access</button></div>' +
    '<section id="overview-panel" role="tabpanel" aria-labelledby="overview-tab"><dl class="project-admin-facts">' + fact('Owner', metadata.ownerName) + fact('Visibility', metadata.visibility) + fact('Registration', metadata.runtimeHealth) + fact('Sessions', metadata.sessions) + fact('Connected clients', metadata.clients) + fact('Agent activity', metadata.isProcessing === null ? null : metadata.isProcessing ? 'Active turn reported' : 'No active turn reported') + '</dl><p class="project-admin-secondary">Session and activity counts reflect this page load.</p>' +
    '<section class="project-admin-storage" aria-labelledby="storage-heading"><div class="project-admin-section-heading"><h2 id="storage-heading">Storage</h2><button type="button" id="project-admin-refresh" class="settings-btn-sm">Refresh usage</button></div><div id="project-admin-usage" aria-busy="true"><dl class="project-admin-metrics"><div><dt>Project allocated</dt><dd id="usage-bytes">—</dd></div><div><dt>Files</dt><dd id="usage-files">—</dd></div><div><dt>Volume available</dt><dd id="usage-free">—</dd></div><div><dt>Volume capacity</dt><dd id="usage-capacity">—</dd></div></dl><p id="usage-status" role="status">Measuring storage…</p><p class="project-admin-secondary">Allocated filesystem blocks, including dependencies. Nested registered projects are counted separately; hard links shared across projects are excluded. Volume space is shared, not a project quota.</p></div></section>' +
    '<div class="project-admin-notice"><h2>Administrative metadata only</h2><p>' + escape(privacyText) + '</p></div></section>' +
    '<section id="access-panel" role="tabpanel" aria-labelledby="access-tab" hidden><h2>Administrative metadata only</h2><p>' + escape(accessText) + '</p><dl class="project-admin-facts">' + fact('Owner', metadata.ownerName) + fact('Your access', 'Administrative metadata only') + '</dl></section></div></section>' +
    '<script type="application/json" id="project-admin-data">' + payload + '</script>';
}

function workspaceShell(shell, metadata, projects) {
  var marker = '<base href="/"><script>window.__clayRestrictedProject=' + JSON.stringify(metadata.slug).replace(/</g, '\\u003c') + ';</script><link rel="stylesheet" href="/css/project-restricted-shell.css"><link rel="stylesheet" href="/css/project-admin-overview.css">';
  shell = shell.replace('<head>', '<head>' + marker);
  shell = shell.replace('<body class="capsules-disabled">', '<body class="capsules-disabled project-restricted-shell">');
  return shell.replace('<div id="main-area">', '<div id="main-area">' + content(metadata, projects));
}

module.exports = { metadataFor: metadataFor, page: content, workspaceShell: workspaceShell };
