import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { requestVendorLogin, cancelVendorLogin } from './vendor-login.js';
import { renderProviderInstall, handleProviderInstall, resetProviderInstall } from './user-settings-provider-install.js';
import { personalProviderContext } from './personal-provider-context.js';

function render() {
  var root = document.getElementById('us-coding-agents'); if (!root) return;
  root.replaceChildren();
  var status = document.createElement('p'); status.className = 'settings-status'; status.role = 'status';
  status.textContent = store.get('personalProvidersError') || store.get('personalProvidersNotice') || (store.get('personalProvidersLoading') ? 'Checking installations…' : '');
  status.dataset.state = store.get('personalProvidersError') ? 'error' : store.get('personalProvidersNotice') ? 'info' : ''; root.appendChild(status);
  var refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'settings-btn-sm';
  refresh.textContent = 'Refresh status'; refresh.disabled = !!store.get('personalProvidersLoading') || !!store.get('personalProviderSigningIn') || !!store.get('personalProviderInstallBusy');
  refresh.onclick = loadPersonalProviders;
  var headingActions=document.getElementById('us-provider-refresh'); if (headingActions) headingActions.replaceChildren(refresh);
  var catalog = store.get('personalProviderCatalog'); if (!catalog) return;
  var runtime=catalog.runtime;
  var scope = document.createElement('p'); scope.className = 'settings-hint'; scope.textContent = 'Account: ' + (catalog.accountName || catalog.owner) + ' · ' + (runtime.shared ? 'Shared server OS account: ' : 'Mapped OS account: ') + runtime.user; root.appendChild(scope);
  if (runtime.shared) { var shared=document.createElement('p'); shared.className='settings-hint'; shared.textContent='Provider credentials are shared across Clay Studio accounts.'; root.appendChild(shared); }
  var details=document.createElement('details'); details.className='settings-runtime-details settings-hint'; details.open=!!store.get('personalProviderRuntimeDetailsOpen');
  var summary=document.createElement('summary'); summary.textContent='Runtime details';
  var exact=document.createElement('p'); exact.className='settings-hint'; exact.dataset.providerRuntime=''; exact.textContent='OS account: '+runtime.user+' · UID '+runtime.uid+' · HOME '+runtime.home;
  details.append(summary,exact); details.ontoggle=function () { if (details.isConnected && store.get('personalProviderCatalog') === catalog) store.set({personalProviderRuntimeDetailsOpen:details.open}); }; root.appendChild(details);
  catalog.providers.forEach(function (provider) {
    var row = document.createElement('div'); row.className = 'us-voice-row'; row.dataset.codingProvider = provider.id;
    var controls = document.createElement('div'); controls.className = 'us-voice-row-controls';
    var logo = document.createElement('img'); logo.src = provider.icon; logo.alt = ''; logo.className = 'us-voice-provider-logo';
    var copy = document.createElement('div'); copy.className = 'us-voice-provider-copy';
    var name = document.createElement('strong'); name.textContent = provider.name;
    var state = document.createElement('small'); state.textContent = (provider.installed === true ? 'Installed' : provider.installed === false ? 'Not installed' : 'Installation unavailable') + ((store.get('personalProviderSignInResults') || {})[provider.id] ? ' · Sign-in reported success · Not tested' : ' · Authentication unknown · Not tested');
    copy.append(name, state);
    var manage = document.createElement('button'); manage.type = 'button'; manage.className = 'settings-btn-sm';
    manage.textContent = provider.installed ? 'Manage' : provider.canInstall ? 'Install' : 'Setup instructions'; manage.setAttribute('aria-label', manage.textContent + ' ' + provider.name);
    manage.setAttribute('aria-expanded', String(store.get('personalProviderEditing') === provider.id));
    manage.setAttribute('aria-controls', 'provider-setup-' + provider.id);
    manage.onclick = function () { store.set({personalProviderEditing:store.get('personalProviderEditing') === provider.id ? null : provider.id}); render(); var button = root.querySelector('[data-coding-provider="' + provider.id + '"] button'); if (button) button.focus(); };
    controls.append(logo, copy, manage); row.appendChild(controls);
    var editor = document.createElement('div'); editor.id = 'provider-setup-' + provider.id; editor.className = 'settings-card'; editor.hidden = store.get('personalProviderEditing') !== provider.id;
    var detail = document.createElement('p'); detail.className = 'settings-hint'; detail.textContent = provider.reason || (provider.installed ? 'Runtime: '+runtime.user+' · HOME '+runtime.home+'. Sign-in uses this account. It can replace that OS account’s provider credentials. Sign-in does not send or replay any task. Provider logout and credential inspection are unavailable here.' : provider.setup); editor.appendChild(detail);
    if (provider.reason && !provider.installed) { var setup = document.createElement('p'); setup.className = 'settings-hint'; setup.textContent = provider.setup; editor.appendChild(setup); }
    if (!provider.installed && !provider.canInstall && provider.setupUrl) { var source=document.createElement('a'); source.className='settings-link'; source.href=provider.setupUrl; source.target='_blank'; source.rel='noopener noreferrer'; source.textContent='Official setup instructions'; editor.appendChild(source); }
    renderProviderInstall(editor,provider,render);
    if (provider.canSignIn) {
      function signIn(mode) {
        if (store.get('personalProviderSigningIn') || !store.get('personalProviderRevision') || store.get('personalProvidersLoading')) return;
        var results=Object.assign({},store.get('personalProviderSignInResults') || {}); delete results[provider.id];
        store.set({personalProviderSigningIn:provider.id,personalProvidersError:'',personalProvidersNotice:'',personalProviderSignInResults:results});
        if (!requestVendorLogin(provider.id, {personalRequestId:store.get('personalProviderRevision'),mode:mode})) {
          store.set({personalProviderSigningIn:null,personalProvidersError:'Reconnect the workspace and refresh status before signing in.'}); render();
        }
        render();
      }
      var actions = document.createElement('div'); actions.className = 'settings-form-actions';
      var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn-sm'; button.textContent = 'Sign in'; button.disabled = !!store.get('personalProviderSigningIn') || !store.get('personalProviderRevision');
      button.onclick = function () { signIn(provider.browser ? 'browser' : 'terminal'); }; actions.appendChild(button);
      if (provider.browser) { var terminal = document.createElement('button'); terminal.type = 'button'; terminal.className = 'settings-btn-sm'; terminal.textContent = 'Use terminal sign-in'; terminal.disabled = !!store.get('personalProviderSigningIn') || !store.get('personalProviderRevision'); terminal.onclick = function () { signIn('terminal'); }; actions.appendChild(terminal); }
      if (store.get('personalProviderSigningIn') === provider.id) { var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'settings-btn-sm'; cancel.textContent = 'Cancel sign-in'; cancel.onclick = function () { cancelVendorLogin(provider.id); store.set({personalProviderSigningIn:null}); render(); }; actions.appendChild(cancel); }
      editor.appendChild(actions);
    }
    row.appendChild(editor); root.appendChild(row);
  });
}
export function loadPersonalProviders() {
  resetProviderInstall();
  var ws = getWs();
  var id = crypto.randomUUID();
  store.set({personalProvidersOpen:true,personalProviderRequest:id,personalProviderContext:personalProviderContext(),personalProviderRevision:null,personalProvidersLoading:true,personalProvidersError:'',personalProvidersNotice:'',personalProviderSignInResults:{}});
  if (!ws || ws.readyState !== 1) { store.set({personalProvidersLoading:false,personalProvidersError:'Connect to a project workspace to check provider installations and sign in.'}); render(); return; }
  ws.send(JSON.stringify({type:'vendor_login_catalog_request', requestId:id})); render();
  setTimeout(function () { if (store.get('personalProviderRequest') === id && store.get('personalProvidersLoading')) { store.set({personalProvidersLoading:false,personalProvidersError:'Provider status timed out. Reconnect, then refresh status.'}); render(); } },10000);
}
export function handlePersonalProviderMessage(message) {
  if (handleProviderInstall(message,render)) return true;
  if (message.type !== 'vendor_login_catalog') {
    if (message.personalRequestId && store.get('personalProvidersOpen') && store.get('personalProviderContext') === personalProviderContext() && message.personalRequestId === store.get('personalProviderRevision') && ['vendor_login_ready','vendor_login_error','auth_refreshed'].indexOf(message.type) >= 0) {
      var succeeded=message.type === 'auth_refreshed' && !message.error;
      var results=Object.assign({},store.get('personalProviderSignInResults') || {});
      if (succeeded) results[message.vendor]=true; else if (message.type === 'vendor_login_error') delete results[message.vendor];
      store.set({personalProviderSigningIn:message.type === 'vendor_login_ready' ? message.vendor : null,personalProviderSignInResults:results,personalProvidersError:message.error || '',personalProvidersNotice:succeeded ? 'Sign-in reported success. Explicitly retry your task to test provider access.' : ''}); render();
    }
    if (message.type === 'vendor_login_state' && store.get('personalProviderSigningIn') && !(message.flows || []).some(function (flow) { return flow.personalRequestId === store.get('personalProviderRevision'); })) { store.set({personalProviderSigningIn:null}); render(); }
    return false;
  }
  if (!store.get('personalProvidersOpen') || message.requestId !== store.get('personalProviderRequest') || store.get('personalProviderContext') !== personalProviderContext()) return true;
  store.set({personalProvidersLoading:false,personalProvidersError:message.error || '',personalProviderCatalog:message.error ? null : message,personalProviderRevision:message.revision || null}); render(); return true;
}
export function leavePersonalProviders() {
  if (!store.get('personalProvidersOpen')) return;
  resetProviderInstall();
  var signing = store.get('personalProviderSigningIn'); if (signing) cancelVendorLogin(signing);
  var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'vendor_login_personal_release'}));
  store.set({personalProvidersOpen:false,personalProviderRequest:null,personalProviderRevision:null,personalProviderSigningIn:null,personalProvidersLoading:false});
}
export function initPersonalProviders() {
  store.subscribe(function (state, previous) {
    if (state.myUserId !== previous.myUserId || state.currentSlug !== previous.currentSlug || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration || state.connected === false && previous.connected !== false) {
      leavePersonalProviders(); store.set({personalProviderCatalog:null,personalProviderEditing:null,personalProviderRuntimeDetailsOpen:false,personalProvidersNotice:'',personalProviderSignInResults:{},personalProvidersError:'Connection or account changed. Refresh status to continue.'}); render();
    }
  });
  render();
}
