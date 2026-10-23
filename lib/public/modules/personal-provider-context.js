import { store } from './store.js';
import { getWs } from './ws-ref.js';
export function personalProviderContext() {
  return JSON.stringify([store.get('myUserId'), store.get('currentSlug'), store.get('projectSplitViewSocketGeneration')]);
}
export function personalLoginCurrent(message) {
  if (!message.personalRequestId) return true;
  return store.get('settingsOpen') && store.get('personalProvidersOpen') && store.get('connected') !== false &&
    message.personalRequestId === store.get('personalProviderRevision') && store.get('personalProviderContext') === personalProviderContext() &&
    getWs() && getWs().readyState === 1;
}
