import { store } from './store.js';
export function skillState() {
  var value = store.get('skillsUi');
  if (!value) { value = { activeTab: 'installed', discoverySort: 'all', requestVersion: 0, currentView: 'list', skillsData: {}, installedSkills: {}, searchQuery: '', searchTimer: null, searchCache: {} }; store.set({ skillsUi: value }); }
  return value;
}
export function content() { return document.getElementById('skills-content'); }
export function basePath() { return store.get('basePath') || ''; }
export function getInstalledInfo(skillId) { return skillState().installedSkills[skillId] || null; }
export function scopeLabel(scope) { return scope === 'both' ? 'This project + All projects' : scope === 'project' ? 'This project' : 'All projects'; }

export function patchSkills(values) { store.set({ skillsUi: Object.assign({}, skillState(), values) }); }
