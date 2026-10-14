// Keep production exports available; replace socket-owning navigation and
// panel cleanup effects. A click traverses the real openMateWorkspace path.
export * from '/modules/app-projects.js?fixture-original';
export * from '/modules/terminal.js?fixture-original';
export * from '/modules/filebrowser.js?fixture-original';
import { store } from '/modules/store.js';
export function switchProject(slug) {
  window.__opened.push(slug);
  store.set({ currentSlug: slug, homeShellVisible: false, dmMode: false });
  if (window.__holdProjectActivation) return;
  store.set({ activeProjectSlug: slug, sessionActivatedProjectSlug: slug });
}
export function closeTerminal() { window.__panelCloses.push('terminal'); }
export function closeFileViewer() { window.__panelCloses.push('files'); }
