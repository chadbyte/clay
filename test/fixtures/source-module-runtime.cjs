// Module-level browser tests import production exports to seed state and inspect
// effects. Keep their app entry in the same ESM graph, even when a local asset
// build exists; importing source beside a bundle would create a second store.
async function install(page) {
  await page.route(/\/pane-assets\/app-[^/]+\.js(?:\?.*)?$/, function (route) {
    var url = new URL(route.request().url());
    var entry = url.pathname.replace(/pane-assets\/[^/]+$/, 'app.js');
    return route.fulfill({ contentType: 'text/javascript', body: 'import ' + JSON.stringify(entry) + ';' });
  });
}
module.exports = { install: install };
