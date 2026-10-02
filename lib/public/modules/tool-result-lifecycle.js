export function isInterimToolResult(msg) {
  return !!msg && msg.detached === true;
}
