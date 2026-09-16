function attachDurableSchedulerLifecycle(ctx) {
  var server = ctx.server;
  var scheduler = ctx.scheduler;
  var onError = ctx.onError || function () {};
  var shutdownPromise = null;

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    try {
      shutdownPromise = Promise.resolve(scheduler.shutdown());
    } catch (error) {
      shutdownPromise = Promise.reject(error);
    }
    shutdownPromise = shutdownPromise.catch(function (error) {
      onError(error);
      return false;
    });
    return shutdownPromise;
  }

  scheduler.start();
  server.once("close", function () { shutdown(); });
  return { shutdown: shutdown };
}

module.exports = { attachDurableSchedulerLifecycle: attachDurableSchedulerLifecycle };
