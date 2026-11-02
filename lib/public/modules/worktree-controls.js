import { store } from './store.js';
import { showConfirm } from './app-misc.js';
import { showToast } from './utils.js';

async function request(stage, data) {
  var result;
  try {
    var response = await fetch('/api/worktree-removal/' + stage, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clay-Worktree-Control': '1' },
      credentials: 'same-origin', body: JSON.stringify(data),
    });
    result = await response.json();
  } catch (error) {
    throw new Error(stage === 'execute' ? 'The removal outcome is unknown. Inspect the worktree directory and pending operation before trying again.' : 'Could not inspect the worktree. Try again when the server is reachable.');
  }
  if (!result.ok) {
    var detail = result.filesDeleted ? ' The directory was removed, but cleanup is pending.' + (result.deleteBranch && !result.branchDeleted ? ' Local branch deletion was not confirmed.' : '') : '';
    throw new Error((result.error || 'Worktree removal failed.') + detail + (result.operationId ? ' Operation: ' + result.operationId + '. Inspect it before retrying.' : ''));
  }
  return result;
}
export async function reviewWorktreeRemoval(slug, action, anchor) {
  if (store.get('worktreeRemoval')) return;
  var pending = { slug: slug, action: action, projectSlug: store.get('currentSlug'), sequence: 0, deleteBranch: false, preview: null };
  store.set({ worktreeRemoval: pending });
  function active() { return store.get('worktreeRemoval') === pending && store.get('currentSlug') === pending.projectSlug; }
  function cleanup() {
    document.getElementById('confirm-text').classList.remove('worktree-removal-review');
    var option = document.getElementById('worktree-branch-option'); if (option) option.remove();
    document.getElementById('confirm-ok').disabled = false;
  }
  function reset() {
    if (store.get('worktreeRemoval') !== pending) return;
    cleanup(); store.set({ worktreeRemoval: null });
    if (anchor && anchor.isConnected) anchor.focus();
  }
  function description(preview) {
    return (action === 'delete' ? 'Delete worktree' : 'Exclude worktree') + '\nBranch: ' + preview.branch + '\nDirectory: ' + preview.path + '\n\n' +
      (action === 'delete' ? 'Stop its sessions and Workers, then remove this linked Git worktree and directory from disk. ' +
        (preview.deleteBranch ? 'Then delete the local branch ' + preview.branch + '. If that step fails, the directory stays removed and cleanup remains pending.' : 'The local branch is kept.') +
        ' Stored history is kept. Remote branches are untouched. Changed, untracked, ignored or locked worktrees cannot be deleted.' +
        (preview.localBranch ? '' : '\nDetached HEAD has no local branch to delete.') :
        'Stop its sessions and Workers and hide it from Clay Studio. The worktree directory, Git branch and stored history are kept. This exclusion is saved across restarts.');
  }
  try {
    pending.preview = await request('preview', { slug: slug, action: action, deleteBranch: false });
    if (!active()) { reset(); return; }
    showConfirm(description(pending.preview), async function () {
      if (!active() || !pending.preview || pending.preview.deleteBranch !== pending.deleteBranch) { reset(); return; }
      var reviewed = pending.preview; cleanup();
      try {
        showToast('Closing worktree runtimes…', 'info');
        var result = await request('execute', { token: reviewed.token, deleteBranch: pending.deleteBranch });
        showToast(result.filesDeleted ? (result.branchDeleted ? 'Worktree directory and local branch deleted' : 'Worktree directory deleted; branch kept') : 'Worktree excluded; files kept', 'success');
        if (store.get('currentSlug') === slug) window.location.assign('/p/' + encodeURIComponent(slug.split('--')[0]) + '/');
      } catch (error) { showConfirm(error.message, function () {}, 'Close', false); }
      finally { reset(); }
    }, action === 'delete' ? 'Delete worktree' : 'Exclude', true, reset);
    var container = document.getElementById('confirm-text');
    container.classList.add('worktree-removal-review');
    if (action === 'delete' && pending.preview.localBranch) {
      var copy = document.createElement('span'); copy.textContent = description(pending.preview); container.textContent = ''; container.appendChild(copy);
      var label = document.createElement('label'); label.id = 'worktree-branch-option'; label.className = 'worktree-branch-option';
      var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = false;
      var caption = document.createElement('span'); caption.textContent = 'Also delete the local branch';
      label.appendChild(checkbox); label.appendChild(caption); container.appendChild(label);
      checkbox.addEventListener('change', async function () {
        pending.deleteBranch = checkbox.checked; pending.preview = null; pending.sequence++;
        var sequence = pending.sequence, choice = pending.deleteBranch;
        document.getElementById('confirm-ok').disabled = true;
        copy.textContent = 'Checking the selected local branch choice…'; store.set({ worktreeRemoval: pending });
        try {
          var refreshed = await request('preview', { slug: slug, action: action, deleteBranch: choice });
          if (!active() || pending.sequence !== sequence) return;
          if (refreshed.deleteBranch !== choice) throw new Error('The branch choice changed. Review again.');
          pending.preview = refreshed; copy.textContent = description(refreshed);
          document.getElementById('confirm-ok').disabled = false;
        } catch (error) {
          if (!active() || pending.sequence !== sequence) return;
          copy.textContent = error.message + '\nUncheck the option to keep the local branch, or Cancel.';
        }
      });
    }
    var cancel = document.getElementById('confirm-cancel'); if (cancel) cancel.focus();
  } catch (error) { reset(); showToast(error.message, 'error'); }
}
