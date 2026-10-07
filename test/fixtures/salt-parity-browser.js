// Rasterize both SVGs in the same browser at original size, then compare every pixel.
async function raster(svg) {
  var image = new Image();
  var source = new XMLSerializer().serializeToString(svg);
  var url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
    var canvas = document.createElement('canvas');
    canvas.width = svg.viewBox.baseVal.width;
    canvas.height = svg.viewBox.baseVal.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return { canvas: canvas, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } finally { URL.revokeObjectURL(url); }
}
async function compare() {
  await document.fonts.ready;
  var results = [];
  for (var section of document.querySelectorAll('section')) {
    var reference = section.querySelector('.reference svg[data-diagram-type="SALT"]');
    var native = section.querySelector('.native svg');
    if (!reference || !native) continue;
    var message = document.createElement('p');
    section.querySelector('h2').after(message);
    var original = await raster(reference);
    var actual = await raster(native);
    var result = { id: section.id, sameSize: original.canvas.width === actual.canvas.width && original.canvas.height === actual.canvas.height };
    if (result.sameSize) {
      var a = original.pixels.data;
      var b = actual.pixels.data;
      var count = 0;
      var maxDelta = 0;
      var diff = new ImageData(original.canvas.width, original.canvas.height);
      for (var i = 0; i < a.length; i += 4) {
        var delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (delta) count++;
        maxDelta = Math.max(maxDelta, delta);
        diff.data[i] = 255; diff.data[i + 1] = delta ? 0 : 255; diff.data[i + 2] = delta ? 0 : 255; diff.data[i + 3] = 255;
      }
      result.differentPixels = count; result.maxChannelDelta = maxDelta;
      var details = document.createElement('details');
      var summary = document.createElement('summary'); summary.textContent = 'Pixel differences (red)'; details.appendChild(summary);
      var canvas = document.createElement('canvas'); canvas.width = diff.width; canvas.height = diff.height;
      canvas.getContext('2d').putImageData(diff, 0, 0); details.appendChild(canvas); message.after(details);
    }
    message.textContent = JSON.stringify(result);
    results.push(result);
  }
  var status = document.createElement('p'); status.id = 'pixel-results'; status.setAttribute('role', 'status');
  status.textContent = JSON.stringify(results); document.querySelector('h1').after(status);
}
compare().catch(function (error) { document.getElementById('bounds').textContent = 'Pixel check failed: ' + error.message; });
