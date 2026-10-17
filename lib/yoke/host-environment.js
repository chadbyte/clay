// Provider compatibility at the host boundary. No effects occur on import.
function prepare(env) { delete env.CLAUDECODE; }
function reaper(env) {
  return { idleMs: Number(env.CLAY_ADAPTER_IDLE_MS) || Number(env.CLAY_CODEX_IDLE_MS) || 5 * 60 * 1000,
    reapMs: Number(env.CLAY_ADAPTER_REAPER_MS) || Number(env.CLAY_CODEX_REAPER_MS) || 60 * 1000 };
}
module.exports = { prepare: prepare, reaper: reaper };
