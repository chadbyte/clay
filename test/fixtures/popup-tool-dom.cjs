// Small in-process DOM for native tool lifecycle checks; HTML writes replace nodes.
function element(tag) {
  var node = { tagName: tag, className: '', children: [], dataset: {}, style: {}, attrs: {}, hidden: false, inert: false, title: '', listeners: {} };
  node.classList = {
    contains: function (name) { return node.className.split(' ').indexOf(name) >= 0; },
    add: function (name) { if (!this.contains(name)) node.className += ' ' + name; },
    remove: function (name) { node.className = node.className.split(' ').filter(function (item) { return item !== name; }).join(' '); },
    toggle: function (name, force) { var on = force === undefined ? !this.contains(name) : force; if (on) this.add(name); else this.remove(name); return on; }
  };
  node.setAttribute = function (key, value) { this.attrs[key] = String(value); };
  node.getAttribute = function (key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; };
  node.removeAttribute = function (key) { delete this.attrs[key]; };
  node.remove = function () { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; };
  node.appendChild = function (child) { child.remove(); this.children.push(child); child.parentNode = this; return child; };
  node.insertBefore = function (child, before) { child.remove(); var index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; return child; };
  node.replaceChildren = function () { this.children.slice().forEach(function (child) { child.remove(); }); };
  node.addEventListener = function (key, fn) { (this.listeners[key] || (this.listeners[key] = [])).push(fn); };
  node.click = function () { var event = { stopPropagation: function () {}, preventDefault: function () {} }; if (this.onclick) this.onclick(event); (this.listeners.click || []).forEach(function (fn) { fn(event); }); };
  node.contains = function (child) { return child === this || this.children.some(function (item) { return item.contains(child); }); };
  node.querySelectorAll = function (selector) {
    var result = [];
    this.children.forEach(function walk(child) {
      if (selector.split(',').some(function (part) {
        part = part.trim();
        if (part[0] === '.') return child.classList.contains(part.slice(1));
        if (part === 'a[href]') return child.tagName === 'a' && child.getAttribute('href') !== null;
        var role = /^\[role="([^"]+)"\]$/.exec(part);
        return role ? child.getAttribute('role') === role[1] : child.tagName === part;
      })) result.push(child);
      child.children.forEach(walk);
    });
    return result;
  };
  node.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
  var text = '';
  Object.defineProperty(node, 'textContent', { get: function () { return text + this.children.map(function (child) { return child.textContent; }).join(''); }, set: function (value) { this.replaceChildren(); text = String(value); } });
  Object.defineProperty(node, 'innerHTML', { set: function (html) {
    this.textContent = '';
    var stack = [this], tokens = String(html).match(/<[^>]+>|[^<]+/g) || [];
    tokens.forEach(function (token) {
      if (token.slice(0, 2) === '</') { stack.pop(); return; }
      if (token[0] !== '<') { stack[stack.length - 1].appendChild(element('#text')).textContent = token; return; }
      var match = /^<([\w-]+)/.exec(token); if (!match) return;
      var child = element(match[1]);
      token.replace(/([\w-]+)="([^"]*)"/g, function (_, key, value) { if (key === 'class') child.className = value; else child.setAttribute(key, value); return _; });
      stack[stack.length - 1].appendChild(child);
      if (!/^(img|input|br)$/.test(child.tagName)) stack.push(child);
    });
  } });
  node.insertAdjacentHTML = function (_, html) { var wrapper = element('div'); wrapper.innerHTML = html; wrapper.children.slice().forEach(function (child) { node.appendChild(child); }); };
  return node;
}
module.exports = { element: element };
