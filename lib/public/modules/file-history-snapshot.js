// Session tool input is historical evidence. The current disk file is not.
export function historicalSnapshot(entry, before) {
  if (!entry || entry.source === 'git') return undefined;
  var full = before ? entry.beforeContent : entry.afterContent;
  if (typeof full === 'string') return full;
  if (entry.toolName === 'Write' || entry.isFullWrite) return before ? undefined : typeof entry.content === 'string' ? entry.content : undefined;
  var excerpt = before ? entry.old_string : entry.new_string;
  return typeof excerpt === 'string' ? excerpt : undefined;
}
export function historicalScope(entry) {
  return entry && entry.source !== 'git' && entry.toolName === 'Edit' && typeof entry.afterContent !== 'string' ? 'Recorded changed excerpt; a full-file snapshot was not recorded.' : '';
}
