import { store } from './store.js';
import { iconHtml } from './icons.js';

export function validActivity(value) {
  return !!(value && typeof value.epoch === 'string' && value.epoch.length <= 64 && Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
    Number.isSafeInteger(value.queryGeneration) && value.queryGeneration >= 0 && Number.isFinite(value.timestamp) && value.timestamp > 0 &&
    typeof value.summary === 'string' && value.summary.length <= 80);
}
export function observeWorkerActivity(key, activity, live) {
  var all = Object.assign({}, store.get('workerActivityIndicators') || {}), previous = all[key];
  if (activity && !validActivity(activity)) return null;
  if (previous && activity && previous.cursor && activity.epoch === previous.cursor.epoch &&
      (activity.sequence <= previous.cursor.sequence || activity.queryGeneration < previous.cursor.queryGeneration)) return null;
  // Initial subscriptions/reconnects establish a baseline; never animate cached activity.
  var fresh = !!(live && previous && activity);
  if (previous && previous.activity && activity && previous.activity.epoch !== activity.epoch) fresh = false;
  var generationChanged = previous && previous.activity && (!activity || previous.activity.queryGeneration !== activity.queryGeneration);
  var angle = previous && !generationChanged ? previous.angle : 0, now = performance.now();
  var nextStepAt = previous && !generationChanged ? previous.nextStepAt : 0;
  if (fresh && now >= nextStepAt) { angle += 30; nextStepAt = now + 350; }
  all[key] = { processing: previous && previous.processing, fresh: fresh, cursor: activity || previous && previous.cursor || null, activity: activity || null, angle: angle, nextStepAt: nextStepAt };
  store.set({ workerActivityIndicators: all });
  return fresh;
}
export function setWorkerActivityRuntime(key, processing) {
  var all = Object.assign({}, store.get('workerActivityIndicators') || {}), previous = all[key];
  if (!previous || typeof processing !== 'boolean' || previous.processing === processing) return;
  all[key] = Object.assign({}, previous, { processing: processing }); store.set({ workerActivityIndicators: all });
}
export function syncWorkerActivityIndicator(chip, worker) {
  var icon = chip.querySelector('.split-view-worker-loop'); if (!icon) return;
  var state = (store.get('workerActivityIndicators') || {})[chip.dataset.messagePreview];
  var angle = state ? state.angle : 0;
  var scope = chip.dataset.messagePreview + ':' + (state && state.activity ? state.activity.epoch + ':' + state.activity.queryGeneration : 'unknown');
  if (icon.dataset.activityScope !== scope) {
    var initial = icon.dataset.activityScope == null ? angle : state && state.fresh ? 0 : angle;
    icon.style.transition = 'none'; icon.style.transform = 'rotate(' + initial + 'deg)';
    void icon.offsetWidth;
    icon.style.transition = ''; icon.dataset.activityScope = scope;
  }
  icon.style.transform = 'rotate(' + angle + 'deg)';
  var processing = state && typeof state.processing === 'boolean' ? state.processing : worker && worker.isProcessing;
  icon.dataset.state = !store.get('connected') ? 'disconnected' : processing ? 'working' : 'ready';
  icon.setAttribute('aria-label', !store.get('connected') ? 'Disconnected' : processing ? 'Worker running; motion indicates received activity' : 'Worker idle');
}
export function createWorkerActivityIndicator() {
  var icon = document.createElement('span'); icon.className = 'split-view-worker-loop';
  icon.innerHTML = iconHtml('refresh-cw'); icon.setAttribute('role', 'img'); return icon;
}
