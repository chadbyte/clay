// Log lifecycle metadata only: never pass keys, audio, transcripts or draft text.
export function speechTrace(active, event, details) {
  var record = Object.assign({ version: 'voice-debug-v1', attempt: active && active.traceId || 'none', event: event,
    elapsedMs: active && active.traceStarted ? Date.now() - active.traceStarted : 0,
    phase: active && active.phase || 'idle', model: active && active.model && active.model.id || 'browser' }, details || {});
  console.log('[Clay voice] ' + JSON.stringify(record));
}
