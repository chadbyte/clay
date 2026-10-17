var crypto = require('crypto');
function attachProductSessionQueue(ctx) {
  var queue = ctx.queue;
  function actor(principal) {
    if (!ctx.users.isMultiUser()) return null;
    var user = ctx.users.findUserById(principal.userId);
    if (!user) throw new Error('Queue owner is no longer available.');
    return user;
  }
  function inspect(principal, session) {
    var user = actor(principal), state = queue.hydrate(session, user);
    if (!state.ok) throw new Error(state.error || 'Queue inspection failed.');
    return { revision: state.revision, paused: state.paused || !!session._pendingMessageDrainPaused || !!session.taskStopRequested,
      items: state.items.filter(function (item) { return item.actorId === (user ? user.id : 'default'); }).filter(function (item, index, all) { return item.state === 'pending' || item.state === 'claimed' || index >= all.length - 20; }).map(function (item) {
        return { id: item.id, state: item.state, text: String(item.message.text || '').slice(0, 1600), textTruncated: String(item.message.text || '').length > 1600,
          imageCount: (item.message.images || []).length, pasteCount: (item.message.pastes || []).length, scheduled: !!item.schedule, failure: item.failure ? String(item.failure).slice(0, 500) : null };
      }) };
  }
  function apply(principal, session, args, revalidate, requestKey) {
    revalidate();
    var user = actor(principal), before = queue.getRevision(), result;
    try {
      if (args.action === 'queue_add') {
        var clientId = 'clay-control:' + crypto.createHash('sha256').update(requestKey).digest('hex');
        var existing = queue.inspect(session, user, clientId);
        var digest = crypto.createHash('sha256').update(args.text).digest('hex');
        if (existing && (existing.message._clayControlDigest || crypto.createHash('sha256').update(existing.message.text).digest('hex')) !== digest) throw new Error('This requestId already identifies a different durable queue message.');
        result = queue.admit(session, { type: 'message', text: args.text, clientMessageId: clientId, _clayControlDigest: digest }, user);
      } else if (args.action === 'queue_edit') result = queue.edit(session, user, args.messageId, before, session.localId, { text: args.text });
      else if (args.action === 'queue_cancel') result = queue.cancel(session, user, args.messageId, before, session.localId);
      else if (args.action === 'queue_reorder') result = queue.reorder(session, user, args.ids, before, session.localId);
      else throw new Error('Unsupported queue action.');
    } catch (error) {
      return { status: 'failed', outcome: queue.getRevision() !== before ? 'partial' : 'failed', persisted: queue.getRevision() !== before, error: error.message, queue: inspect(principal, session) };
    }
    if (!result || !result.ok) return { status: 'failed', persisted: false, error: result && result.error || 'Queue operation failed.', messageId: result && result.item && result.item.id, deliveryState: result && result.item && result.item.state, queue: inspect(principal, session) };
    var state = inspect(principal, session);
    if (args.action === 'queue_add') {
      if (result.item && result.item.state === 'pending' && !state.paused) setImmediate(function () { if (ctx.sm.sessions.get(session.localId) === session) ctx.requestDrain(session); });
      return { status: result.item && result.item.state === 'consumed' ? 'completed' : 'queued', persisted: true, messageId: result.item && result.item.id, deliveryState: result.item && result.item.state, queue: state };
    }
    return { status: 'completed', persisted: true, queue: state };
  }
  return { inspect: inspect, apply: apply };
}
module.exports = { attachProductSessionQueue: attachProductSessionQueue };
