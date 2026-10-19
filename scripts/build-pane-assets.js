var fs = require('fs');
var path = require('path');
var esbuild = require('esbuild');
var contract = require('../lib/pane-asset-manifest');

async function buildPaneAssets(publicDir) {
  publicDir = fs.realpathSync(publicDir);
  var outdir = path.join(publicDir, 'pane-assets');
  var inputs = {};
  var result = await esbuild.build({
    absWorkingDir: publicDir, entryPoints: { app: 'app.js', style: 'style.css' },
    outdir: outdir, entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]',
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2020',
    minify: true, metafile: true, write: false, legalComments: 'eof',
    plugins: [{ name: 'pane-public-inputs', setup: function (build) {
      build.onResolve({ filter: /.*/ }, function (args) {
        if (args.kind !== 'url-token') return;
        if (/^(?:[a-z]+:|\/|#)/i.test(args.path)) return { path: args.path, external: true };
        var parts = args.path.split(/(?=[?#])/), asset = path.resolve(args.resolveDir, parts.shift());
        var relative = path.relative(publicDir, asset).split(path.sep).join('/');
        if (!contractSafe(relative)) throw new Error('CSS asset outside public root');
        return { path: '../' + relative + parts.join(''), external: true };
      });
      build.onLoad({ filter: /.*/ }, function (args) {
        if (!/\.(js|css)$/.test(args.path)) throw new Error('Unsupported pane input type');
        var name = path.relative(publicDir, args.path).split(path.sep).join('/');
        if (!contractSafe(name) || fs.realpathSync(args.path) !== args.path) throw new Error('Input outside public root');
        var bytes = fs.readFileSync(args.path);
        inputs[name] = contract.digest(bytes);
        return { contents: bytes.toString('utf8'), loader: path.extname(args.path).slice(1), resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  inputs['index.html'] = contract.digest(fs.readFileSync(path.join(publicDir, 'index.html')));
  var manifest = { version: 1, inputs: inputs, outputs: {} };
  result.outputFiles.forEach(function (file) {
    var name = path.relative(publicDir, file.path).split(path.sep).join('/');
    manifest.outputs[name] = contract.digest(file.contents);
    var meta = result.metafile.outputs[path.relative(publicDir, file.path)];
    if (meta && meta.entryPoint === 'app.js') manifest.js = name;
    if (meta && meta.entryPoint === 'style.css') manifest.css = name;
  });
  contract.validate(manifest);
  var json = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(json) > contract.maxBytes) throw new Error('Manifest too large');
  Object.keys(inputs).forEach(function (name) {
    if (contract.digest(fs.readFileSync(path.join(publicDir, name))) !== inputs[name]) throw new Error('Source changed during build');
  });
  fs.mkdirSync(outdir, { recursive: true });
  result.outputFiles.forEach(function (file) { fs.writeFileSync(file.path, file.contents); });
  fs.writeFileSync(path.join(outdir, 'manifest.json.tmp'), json);
  fs.renameSync(path.join(outdir, 'manifest.json.tmp'), path.join(outdir, 'manifest.json'));
  // Retain older hashed chunks for documents already open during a rebuild.
  return manifest;
}
function contractSafe(name) { return name && name !== '..' && !name.startsWith('../') && !path.isAbsolute(name); }
if (require.main === module) buildPaneAssets(path.resolve(__dirname, '../lib/public')).then(function (manifest) {
  console.log('Built pane assets: ' + Object.keys(manifest.inputs).length + ' inputs, ' + Object.keys(manifest.outputs).length + ' outputs');
}).catch(function (error) { console.error(error); process.exitCode = 1; });
module.exports = { buildPaneAssets: buildPaneAssets };
