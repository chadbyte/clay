function classify(text) {
  if (/thread-store conflict|already has an active writer/i.test(String(text))) return {
    kind: 'session_writer_conflict',
    text: 'This Codex session is already open in another Clay or Codex process. Stop the other server or close the other session, then try again.',
  };
  return null;
}
module.exports = { classify: classify };
