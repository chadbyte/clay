// Browser identity is presentation-only; native speech also requires its runtime API.
export function browserSpeechInfo(win) {
  win = win || window;
  var nav = win.navigator || {};
  var ua = nav.userAgent || '';
  var brands = nav.userAgentData && nav.userAgentData.brands || [];
  var brand = brands.map(function (item) { return item.brand; }).join(' ');
  var arc = /\bArc\b/i.test(brand) || /\bArc\//i.test(ua);
  // Arc can identify as Chrome. Its injected palette is a best-effort signal,
  // not a guaranteed browser API; check again whenever the picker/start is used.
  try {
    var host = win.top || win;
    var style = host.getComputedStyle(host.document.documentElement);
    arc = arc || !!style.getPropertyValue('--arc-palette-background').trim();
  } catch (error) { /* Palette unavailable in this host. */ }
  var id = 'browser'; var name = 'Browser';
  if (arc) { id = 'arc'; name = 'Arc'; }
  else if (/Microsoft Edge/i.test(brand) || /Edg(?:e|A|iOS)?\//.test(ua)) { id = 'edge'; name = 'Edge'; }
  else if (/Opera/i.test(brand) || /(?:OPR|Opera|OPiOS)\//.test(ua)) { id = 'opera'; name = 'Opera'; }
  else if (/Brave/i.test(brand) || nav.brave) { id = 'brave'; name = 'Brave'; }
  else if (/(?:Firefox|FxiOS)\//.test(ua)) { id = 'firefox'; name = 'Firefox'; }
  else if (/Google Chrome/i.test(brand) || /(?:Chrome|CriOS)\//.test(ua)) { id = 'chrome'; name = 'Chrome'; }
  else if (/Chromium/i.test(brand) || /Chromium\//.test(ua)) { id = 'chromium'; name = 'Chromium'; }
  else if (/Safari\//.test(ua)) { id = 'safari'; name = 'Safari'; }
  var reason = !win.isSecureContext ? 'Voice input requires a secure HTTPS connection.' :
      !(win.SpeechRecognition || win.webkitSpeechRecognition) ? 'Browser speech is unavailable here. Choose a cloud voice model.' : '';
  return { id: id, name: name, icon: id === 'browser' ? null : '/icons/browsers/' + id + '.svg', available: !reason, reason: reason };
}

export function compareSpeechModels(a, b) {
  function rank(model) { return model.provider === 'browser' ? 0 : model.provider === 'openai' ? 1 : 2; }
  return rank(a) - rank(b);
}
