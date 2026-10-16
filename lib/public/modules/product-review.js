// Display-only metadata from a bound product service. The exact question and
// authenticated response remain unchanged; this renderer grants no authority.
export function renderProductReview(element, question) {
  var review = question.review;
  if (!review || review.kind !== 'product-control' || typeof review.action !== 'string' || typeof review.target !== 'string' || typeof review.context !== 'string' || typeof review.reason !== 'string') return false;
  element.classList.add('product-review');
  element.textContent = '';
  function text(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    element.appendChild(node);
  }
  text('strong', 'product-review-action', review.action + ': ' + review.target);
  text('p', 'product-review-context', review.context);
  text('p', 'product-review-reason', review.reason);
  var details = document.createElement('details');
  var summary = document.createElement('summary');
  summary.textContent = 'Exact request details';
  var payload = document.createElement('pre');
  payload.textContent = question.question;
  details.appendChild(summary);
  details.appendChild(payload);
  element.appendChild(details);
  return true;
}
