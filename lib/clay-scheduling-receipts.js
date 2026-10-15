// Persist before execution; an interrupted application never retries blindly.
function attachReceipts(ctx) {
  function entries() { return ctx.session.claySchedulingReceipts || []; }
  function save(entry) {
    ctx.authorize();
    var previous = ctx.session.claySchedulingReceipts;
    var all = entries().filter(function (item) {
      var stamp = /_(\d{13})_/.exec(item.id);
      return item.id !== entry.id && (item.status === 'applying' || !stamp || Date.now() - Number(stamp[1]) <= 86400000);
    });
    if (all.length >= 100) throw new Error('Scheduling receipt capacity is full for this 24-hour window; inspect pending attempts and wait for completed receipts to expire.');
    ctx.session.claySchedulingReceipts = all.concat([entry]);
    if (ctx.save() !== true) { ctx.session.claySchedulingReceipts = previous; throw new Error('The scheduling retry receipt could not be saved.'); }
    ctx.authorize();
  }
  function read(id, key) {
    ctx.authorize();
    var match = /^[A-Za-z][A-Za-z0-9-]*_(\d{13})_[A-Za-z0-9_-]{1,80}$/.exec(id || '');
    if (!match || Math.abs(Date.now() - Number(match[1])) > 86400000) throw new Error('Scheduling requestId requires prefix_<13-digit creation time>_<unique suffix> within 24 hours.');
    var entry = entries().find(function (item) { return item.id === id; });
    if (entry && key !== undefined && entry.key !== key) throw new Error('requestId already names another scheduling intent.');
    return entry;
  }
  return { read: read, save: save };
}
module.exports = { attachReceipts: attachReceipts };
