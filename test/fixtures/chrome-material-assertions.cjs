var assert = require('node:assert/strict');

async function assertMaterial(page, selector, solid) {
  var material = await page.locator(selector).first().evaluate(function (element) {
    var style = getComputedStyle(element), backing = getComputedStyle(element, '::before');
    var canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    var paint = canvas.getContext('2d'); paint.fillStyle = style.backgroundColor; paint.fillRect(0, 0, 1, 1);
    return { coverAlpha: paint.getImageData(0, 0, 1, 1).data[3] / 255, fill: backing.backgroundColor, blur: backing.backdropFilter || backing.webkitBackdropFilter,
      opacity: style.opacity, filter: style.filter, backdrop: style.backdropFilter,
      pointerEvents: backing.pointerEvents };
  });
  assert.equal(material.opacity, '1', selector + ': controls stay fully opaque');
  assert.ok(material.coverAlpha <= .1, selector + ': only a subtle identity tint may cover the backing');
  assert.equal(material.filter, 'none', selector + ': text and icons stay sharp');
  assert.equal(material.backdrop, 'none', selector + ': container does not capture fixed descendants');
  assert.equal(material.pointerEvents, 'none', selector + ': backing cannot intercept clicks');
  if (solid) {
    assert.equal(material.blur, 'none', selector + ': reduced transparency removes blur');
    assert.doesNotMatch(material.fill, /\/\s*0\.|rgba\([^)]*,\s*0\./, selector + ': fallback is opaque');
  } else {
    assert.match(material.blur, /blur\(14px\)/, selector + ': backing blurs the backdrop');
    assert.match(material.fill, /(?:\/\s*0\.74|,\s*0\.74\))/, selector + ': backing is translucent');
  }
}

async function assertFixedControl(page, selector) {
  var bounds = await page.locator(selector).first().evaluate(function (element) {
    var probe = document.createElement('button');
    probe.style.cssText = 'position:fixed;left:3px;top:5px;width:20px;height:20px;';
    element.appendChild(probe);
    var rect = probe.getBoundingClientRect();
    probe.remove();
    return { x: rect.x, y: rect.y };
  });
  assert.deepEqual(bounds, { x: 3, y: 5 }, selector + ': fixed controls retain viewport coordinates');
}

async function assertTransparencyFallback(page, selectors) {
  var client = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await page.evaluate(function () { return matchMedia('(prefers-reduced-transparency: reduce)').matches; }), true);
    for (var selector of selectors) await assertMaterial(page, selector, true);
  } finally {
    await client.send('Emulation.setEmulatedMedia', { features: [] });
    await client.detach();
  }
  for (var selector of selectors) await assertMaterial(page, selector, false);
}

module.exports = { assertMaterial: assertMaterial, assertFixedControl: assertFixedControl,
  assertTransparencyFallback: assertTransparencyFallback };
