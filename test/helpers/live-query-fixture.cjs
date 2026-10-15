// A provider-free query stays current until the test explicitly retires it.
function create() {
  var closed = false, waiters = [];
  function close() {
    closed = true;
    waiters.splice(0).forEach(function (resolve) { resolve({ done: true }); });
  }
  return { close: close, abort: close, pushMessage: function () { return !closed; },
    [Symbol.asyncIterator]: function () { return { next: function () {
      return closed ? Promise.resolve({ done: true }) : new Promise(function (resolve) { waiters.push(resolve); });
    } }; } };
}
async function retire(session) {
  var handle = session.queryInstance;
  if (!handle) return;
  await handle.close();
  var deadline = Date.now() + 2000;
  while (session.queryInstance === handle) {
    if (Date.now() > deadline) throw new Error("Fixture query did not retire");
    await new Promise(function (resolve) { setImmediate(resolve); });
  }
}
module.exports = { create: create, retire: retire };
