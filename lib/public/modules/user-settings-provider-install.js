import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { personalProviderContext } from './personal-provider-context.js';
function send(type,provider,reviewId,render) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !store.get('personalProvidersOpen') || store.get('personalProviderContext') !== personalProviderContext()) return false;
  var requestId = type === 'stop' || type === 'cancel' ? store.get('personalProviderInstallRequest') : crypto.randomUUID();
  store.set({personalProviderInstallRequest:requestId});
  ws.send(JSON.stringify({requestId:requestId,type:'personal_provider_install_'+type,vendor:provider.id,personalRequestId:store.get('personalProviderRevision'),reviewId:reviewId}));
  if (type === 'review' || type === 'start') setTimeout(function () { if (store.get('personalProviderInstallRequest') === requestId && store.get('personalProviderInstallAwaiting') === requestId) { store.set({personalProviderInstallBusy:false,personalProviderInstall:{vendor:provider.id,state:'unknown',message:'Installation response timed out. Reopen settings and refresh status; never assume an installation completed.'}}); if (render) render(); } },10000);
  store.set({personalProviderInstallAwaiting:requestId}); return true;
}
export function resetProviderInstall() { store.set({personalProviderInstall:null,personalProviderInstallBusy:false,personalProviderInstallRequest:null,personalProviderInstallAwaiting:null}); }
export function handleProviderInstall(message,render) {
  if (message.type !== 'personal_provider_install') return false;
  if (!store.get('personalProvidersOpen') || !store.get('personalProviderRevision') || message.requestId !== store.get('personalProviderInstallRequest') || message.personalRequestId !== store.get('personalProviderRevision') || store.get('personalProviderContext') !== personalProviderContext()) return true;
  store.set({personalProviderInstallAwaiting:null,personalProviderInstall:message,personalProviderInstallBusy:['review','started','stopping','unknown'].indexOf(message.state)>=0}); render();
  var editor=document.getElementById('provider-setup-'+message.vendor); var status=editor && editor.querySelector('[data-install-status]'); if (status) status.focus({preventScroll:true}); return true;
}
export function renderProviderInstall(editor,provider,render) {
  if (!provider.canInstall) return;
  var item = store.get('personalProviderInstall');
  var actions = document.createElement('div'); actions.className = 'settings-form-actions';
  if (!item || item.vendor !== provider.id || ['review','started','stopping','unknown'].indexOf(item.state)<0) {
    var review = document.createElement('button'); review.type='button'; review.className='settings-btn-sm'; review.textContent='Review installation'; review.disabled=!!store.get('personalProviderInstallBusy') || !!store.get('personalProviderSigningIn');
    review.onclick=function () { if (send('review',provider,null,render)) { store.set({personalProviderInstallBusy:true}); review.disabled=true; } }; actions.appendChild(review);
  }
  if (item && item.vendor === provider.id) {
    var status=document.createElement('p'); status.className='settings-status'; status.role='status'; status.tabIndex=-1; status.dataset.installStatus=''; status.textContent=item.message; editor.appendChild(status);
    if (item.state==='review') {
      var details=document.createElement('p'); details.className='settings-hint'; details.textContent='Runtime account: '+item.runtime.user+' (UID '+item.runtime.uid+'), HOME '+item.runtime.home+'. '+item.effects; editor.appendChild(details);
      var command=document.createElement('pre'); command.className='settings-hint'; command.style.whiteSpace='pre-wrap'; command.style.overflowWrap='anywhere'; command.textContent=item.command; editor.appendChild(command);
      var source=document.createElement('a'); source.className='settings-link'; source.href=item.source; source.target='_blank'; source.rel='noopener noreferrer'; source.textContent='Official setup instructions'; editor.appendChild(source);
      var confirm=document.createElement('button'); confirm.type='button'; confirm.className='settings-btn-sm'; confirm.textContent='Install for this account'; confirm.onclick=function () { if (send('start',provider,item.reviewId,render)) { confirm.disabled=true; } }; actions.appendChild(confirm);
      var cancel=document.createElement('button'); cancel.type='button'; cancel.className='settings-btn-sm'; cancel.textContent='Cancel installation'; cancel.onclick=function () { send('cancel',provider,item.reviewId); resetProviderInstall(); render(); }; actions.appendChild(cancel);
    }
    if (item.state==='started') {
      var stop=document.createElement('button'); stop.type='button'; stop.className='settings-btn-sm'; stop.textContent='Stop installation'; stop.onclick=function () { send('stop',provider); stop.disabled=true; }; actions.appendChild(stop);
    }
  }
  editor.appendChild(actions);
}
