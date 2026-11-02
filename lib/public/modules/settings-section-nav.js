// Personal provider anchors reuse the Agent behavior page's continuous-page
// navigation and shell placement. Other pages retain their own lifecycle.
import { store } from './store.js';
import { attachSectionNav } from './agent-behavior-nav.js';
import { setPageSubnav } from './settings-shell-view.js';

var mounted = null;

export function deactivateSettingsSections() {
  if (!mounted) return;
  var positions = Object.assign({}, store.get('settingsPageScroll') || {});
  positions['user-settings:us-providers'] = mounted.scroller.scrollTop;
  store.set({ settingsPageScroll: positions });
  mounted.controller.destroy();
  setPageSubnav(null, null);
  mounted.nav.remove();
  mounted.layout.classList.remove('ab-layout', 'ab-narrow');
  mounted = null;
}

export function activateSettingsSections(page, anchor) {
  var area = document.getElementById('settings-shell-content');
  var pane = document.querySelector('.settings-pane:not(.hidden)');
  if (!area || !pane) return;
  if (page !== 'us-providers' || pane.id !== 'user-settings') {
    // Agent behavior owns its catalog-derived anchors. Legacy shortcuts on
    // other pages only reveal and focus their destination.
    var heading = anchor && document.getElementById(anchor);
    if (heading && pane.contains(heading)) {
      if (heading.tagName === 'DETAILS') heading.open = true;
      heading.tabIndex = -1; heading.scrollIntoView({ block: 'start' }); heading.focus({ preventScroll: true });
    }
    return;
  }
  if (!mounted) {
    var layout = pane.querySelector('.us-section[data-section="us-providers"]');
    var nav = document.createElement('nav'); nav.className = 'ab-nav'; nav.setAttribute('aria-label', 'AI providers sections');
    var list = document.createElement('ul'); list.className = 'ab-nav-list'; nav.appendChild(list);
    var sections = Array.from(layout.querySelectorAll('[data-settings-section]')).map(function (heading) {
      var item = document.createElement('li'); var link = document.createElement('a');
      link.className = 'ab-nav-link'; link.href = '#' + heading.id; link.dataset.section = heading.id;
      link.dataset.settingsAnchor = heading.id; link.textContent = heading.textContent; item.appendChild(link); list.appendChild(item);
      heading.tabIndex = -1;
      return { id: heading.id, el: heading, heading: heading, disclosure: heading.parentElement.querySelector('details.us-experiments') };
    });
    layout.classList.add('ab-layout');
    var last = sections[sections.length - 1];
    if (last) last.el.closest('.settings-section-group').style.minHeight = area.clientHeight + 'px';
    var controller = attachSectionNav({ layout: layout, nav: nav, scroller: area, sections: sections, onPlace: function (narrow) {
      if (narrow) { setPageSubnav(null, null); layout.insertBefore(nav, layout.firstChild); }
      else setPageSubnav('us-providers', nav);
    } });
    mounted = { layout: layout, nav: nav, scroller: area, controller: controller };
    area.scrollTop = (store.get('settingsPageScroll') || {})['user-settings:us-providers'] || 0;
    controller.refresh();
  }
  if (anchor) mounted.controller.go(anchor);
}
