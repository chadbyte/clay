var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function ClassList() { this.items = []; }
ClassList.prototype.add = function () { for (var i = 0; i < arguments.length; i++) if (this.items.indexOf(arguments[i]) === -1) this.items.push(arguments[i]); };
ClassList.prototype.remove = function () { for (var i = 0; i < arguments.length; i++) this.items = this.items.filter(function (item) { return item !== arguments[i]; }.bind(this)); };
ClassList.prototype.contains = function (value) { return this.items.indexOf(value) !== -1; };

function Element(id) {
  this.id = id || '';
  this.children = [];
  this.attributes = Object.create(null);
  this.dataset = Object.create(null);
  this.classList = new ClassList();
  this._text = '';
}
Element.prototype.appendChild = function (child) { this.children.push(child); return child; };
Element.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
Element.prototype.getAttribute = function (name) { return this.attributes[name] === undefined ? null : this.attributes[name]; };
Element.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
Object.defineProperty(Element.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (value) { this._text = String(value); this.children = []; },
});

test('header renderer survives late project lists and repeated Mate/project switches', async function () {
  var nodes = {
    'title-bar-project-dropdown': new Element('title-bar-project-dropdown'),
    'title-bar-project-icon': new Element('title-bar-project-icon'),
    'title-bar-project-name': new Element('title-bar-project-name'),
    'title-bar-project-default': new Element('title-bar-project-default'),
  };
  var document = {
    getElementById: function (id) { return nodes[id] || null; },
    createElement: function (tag) { var element = new Element(); element.tagName = String(tag).toUpperCase(); return element; },
  };
  var modulePath = path.join(__dirname, '../lib/public/modules/project-header-identity.js');
  var source = fs.readFileSync(modulePath, 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
  var header = { document: document, mateAvatarUrl: function (mate) { return 'avatar:' + mate.id; }, getHomeMateBio: function (mate) { return mate.profile && mate.profile.bio || mate.bio || mate.description || ''; }, VENDOR_AVATARS: { codex: '/codex-avatar.png' }, VENDOR_NAMES: { codex: 'Codex' }, parseEmojis: function () {} };
  vm.runInNewContext(source, header);
    var mateA = { id: 'a', name: 'Ada', vendor: 'codex', model: 'gpt-a', profile: { displayName: 'Ada', avatarStyle: 'bottts', avatarSeed: 'a', bio: '  Helps\nshape   careful product decisions.  ' } };
    var mateB = { id: 'b', name: 'Bea', vendor: 'unknown-local', model: 'model-b', profile: { displayName: 'Bea' } };
    var state = { currentSlug: 'mate-a', projectsHubList: [{ slug: 'ordinary', title: 'Ordinary', icon: '🛠️' }] };

    assert.strictEqual(header.renderMateProjectHeader(state, mateA), true);
    assert.strictEqual(nodes['title-bar-project-name'].textContent, 'Ada');
    assert.strictEqual(nodes['title-bar-project-icon'].children.length, 2);
    assert.strictEqual(nodes['title-bar-project-icon'].children[1].src, '/codex-avatar.png');
    assert.strictEqual(nodes['title-bar-project-default'].textContent, 'Helps shape careful product decisions.');
    assert.strictEqual(nodes['title-bar-project-dropdown'].dataset.mateBio, 'true');

    // A late ordinary project list must not replace the currently rendered Mate.
    state.projectsHubList.push({ slug: 'mate-a', title: 'Stale generic Mate project', isMate: true });
    assert.strictEqual(header.renderMateProjectHeader(state, mateA), true);
    assert.strictEqual(nodes['title-bar-project-name'].textContent, 'Ada');

    state.currentSlug = 'mate-b';
    assert.strictEqual(header.renderMateProjectHeader(state, mateB), true);
    assert.strictEqual(nodes['title-bar-project-name'].textContent, 'Bea');
    assert.strictEqual(nodes['title-bar-project-icon'].children.length, 1, 'unknown vendors get no misleading badge');
    assert.strictEqual(nodes['title-bar-project-default'].textContent, '');
    assert.strictEqual(nodes['title-bar-project-dropdown'].dataset.mateBio, undefined);

    state.currentSlug = 'ordinary';
    assert.strictEqual(header.renderOrdinaryProjectHeader(state), true);
    assert.strictEqual(nodes['title-bar-project-name'].textContent, 'Ordinary');
    assert.strictEqual(nodes['title-bar-project-icon'].textContent, '🛠️');
    assert.strictEqual(nodes['title-bar-project-icon'].classList.contains('is-mate-avatar'), false);
    assert.strictEqual(nodes['title-bar-project-dropdown'].dataset.mateDefaults, undefined, 'ordinary projects restore the chevron');

    state.currentSlug = 'mate-a';
    header.renderMateProjectHeader(state, mateA);
    assert.strictEqual(nodes['title-bar-project-name'].textContent, 'Ada');
    assert.strictEqual(nodes['title-bar-project-dropdown'].getAttribute('aria-label'), 'Open Mate settings for Ada');

    mateA.profile.bio = 'Updated bio';
    header.renderMateProjectHeader(state, mateA);
    assert.strictEqual(nodes['title-bar-project-default'].textContent, 'Updated bio');
});
