// Reversible project-chrome suppression for the home route.
import { store } from './store.js';

export function showHomeShell() {
  document.body.classList.add("home-active");
  store.set({ homeShellVisible: true });
}

export function hideHomeShell() {
  document.body.classList.remove("home-active");
  store.set({ homeShellVisible: false });
}
