// Decorative opening state; conversation readiness remains with its host.
export function mateLoadingMarkup() {
  return '<div data-clay-loading class="mate-loading" role="status" aria-live="polite">' +
    '<div class="mate-loading-scene" aria-hidden="true">' +
    '<img class="mate-loading-avatar" alt="">' +
    '<img class="mate-loading-desk" src="/welcome-art/conversation-desk.png" alt="" decoding="async">' +
    '</div><p class="mate-loading-label"></p>' +
    '<div class="mate-loading-dots" aria-hidden="true"><span></span><span></span><span></span></div></div>';
}

export function updateMateLoadingScene(element, name, avatar) {
  var image = element.querySelector('.mate-loading-avatar');
  if (image.getAttribute('src') !== avatar) image.setAttribute('src', avatar);
  var label = element.querySelector('.mate-loading-label');
  var text = 'Getting ready with ' + name;
  if (label.textContent !== text) label.textContent = text;
}
