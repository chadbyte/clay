import { selectIntegrationEditor, clearIntegrationEditor } from './personal-integration-editor.js';
import { showToast } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { githubMark } from './github-mark.js';
import { confirmSettingsAction } from './server-settings-state.js';
import { openTuiModal, closeTuiModal, getTuiModalTerminalId } from './tui-attention.js';
function context() { return JSON.stringify([store.get('myUserId'),store.get('currentSlug'),store.get('projectSplitViewSocketGeneration')]); }
function send(action) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !store.get('githubSettingsContextId')) return false;
  var requestId = crypto.randomUUID(), data = store.get('githubSettingsData') || {};
  ws.send(JSON.stringify({type:'personal_github_'+action,requestId:requestId,contextId:store.get('githubSettingsContextId'),reviewId:data.reviewId}));
  if (action !== 'release' && action !== 'stop') {
    store.set({githubSettingsRequest:requestId,githubSettingsPending:true,githubSettingsAction:action});
    if (action === 'get') store.set({githubSettingsData:Object.assign({},data,{state:'checking',observed:null,reviewId:null})});
    setTimeout(function () {
      if (store.get('githubSettingsRequest') !== requestId || !store.get('githubSettingsPending')) return;
      store.set({githubSettingsPending:false,githubSettingsData:Object.assign({},store.get('githubSettingsData'),{state:'unknown',reviewId:null,message:'The response is unknown. Stop any active login, then refresh. No action is retried automatically.'})}); render();
    },20000);
  }
  return true;
}
function text(tag,value,cls) { var el=document.createElement(tag); el.textContent=value; if(cls) el.className=cls; return el; }
function button(parent,label,action,disabled) {
  var el=text('button',label,'settings-btn-sm');el.type='button';el.disabled=!!disabled;el.onclick=action;parent.appendChild(el);return el;
}
function open() { selectIntegrationEditor('github', '#us-github-editor', function () { loadGithubIntegration(); if (!store.get('githubSettingsPending')) send('get'); store.set({githubSettingsEditing:true});render();document.getElementById('us-github-editor').focus(); }); }
function closeTerminal() {
  var id=store.get('githubSettingsTerminal');store.set({githubSettingsTerminal:null});
  if(id && getTuiModalTerminalId() === id) closeTuiModal();
}
export function closeGithubEditor() { store.set({githubSettingsEditing:false});clearIntegrationEditor('github');render(); }
function close() { closeGithubEditor();var el=document.querySelector('#us-github-connections button') || document.getElementById('us-github-add');if(el)el.focus(); }
function statusLabel(data) {
  var saved=data.saved && data.saved.connection, observed=data.observed;
  if (!saved) return '';
  if (!observed || data.state === 'checking') return 'Saved · Verification pending';
  if (observed.status !== 'authenticated') return 'Saved · '+(observed.status === 'unauthenticated' ? 'Sign-in required' : 'Verification unknown');
  var sameRuntime=['user','uid','gid','home'].every(function(key){return saved.runtime[key]===data.runtime[key];});
  if(saved.account.id !== observed.account.id || saved.account.login !== observed.account.login || !sameRuntime)return 'Saved · Account or runtime changed';
  return 'Verified '+new Date(observed.checkedAt).toLocaleString();
}
function render() {
  var editor = document.getElementById('us-github-editor');
  var focused = editor && editor.contains(document.activeElement);
  renderEditor();
  if (focused && editor && !editor.hidden && !editor.contains(document.activeElement)) editor.focus();
}
function renderEditor() {
  var root=document.getElementById('us-github-connections'), add=document.getElementById('us-github-add'), editor=document.getElementById('us-github-editor');
  if(!root || !add || !editor)return;
  var data=store.get('githubSettingsData') || {}, saved=data.saved && data.saved.connection, observed=data.observed, pending=store.get('githubSettingsPending');
  add.hidden=!!saved;
  if(saved){
    var row=root.firstElementChild;
    if(!row){
      row=text('div','','us-voice-row');row.dataset.connectionId='github';var controls=text('div','','us-voice-row-controls');
      var brand=text('span','','us-integration-brand');brand.innerHTML=githubMark();var copy=text('div','','us-voice-provider-copy');
      copy.append(text('strong',''),text('small',''));controls.append(brand,copy,text('span','','us-integration-state'));
      var manage=button(controls,'Manage',open);manage.setAttribute('aria-controls','us-github-editor');
      row.appendChild(controls);root.appendChild(row);
    }
    row.querySelector('strong').textContent=saved.account.login;
    row.querySelector('small').textContent='GitHub · '+saved.account.host+' · ID '+saved.account.id;
    row.querySelector('.us-integration-state').textContent=statusLabel(data);
    row.querySelector('button').setAttribute('aria-expanded',String(!!store.get('githubSettingsEditing')));
    if(store.get('githubSettingsEditing') && editor.parentElement!==row)row.appendChild(editor);
  } else {
    var setup=document.getElementById('us-integration-setup');if(editor.parentElement!==setup)setup.appendChild(editor);
    root.replaceChildren();
  }
  editor.hidden=!store.get('githubSettingsEditing'); editor.replaceChildren();
  if(editor.hidden)return;
  editor.appendChild(text('h3',saved?'Manage GitHub':'Connect GitHub'));
  if(data.runtime){
    editor.appendChild(text('p',data.runtime.shared?'This server OS account shares GitHub CLI credentials across Clay Studio accounts and other processes.':'GitHub CLI runs as your mapped OS account.','settings-hint'));
    var details=text('details'), summary=text('summary','Runtime account');details.append(summary,text('p','OS account '+data.runtime.user+' · UID '+data.runtime.uid+' / GID '+data.runtime.gid+' · HOME '+data.runtime.home,'settings-hint'));editor.appendChild(details);
  }
  if(observed){
    var labels={missing:'GitHub CLI is not installed for this runtime. Ask the server operator to install gh, then refresh.',unknown:'Authentication could not be verified. Check the network and server setup, then refresh.',unauthenticated:'GitHub CLI is not authenticated for github.com.'};
    editor.appendChild(text('p',observed.account?'Current CLI account: '+observed.account.login+' · ID '+observed.account.id+' · '+observed.account.host:labels[observed.status] || 'Verification pending.','settings-hint'));
    if(observed.overridden)editor.appendChild(text('p','GH_TOKEN or GITHUB_TOKEN controls the effective CLI account. Browser sign-in cannot change this override. Ask the server operator to update the environment.','settings-hint'));
  }
  if(saved)editor.appendChild(text('p','Saved account: '+saved.account.login+' · ID '+saved.account.id+' · '+saved.account.host+'. Connected '+new Date(saved.connectedAt).toLocaleString()+'.','settings-hint'));
  var help=text('a','Official GitHub CLI setup and authentication','settings-link');help.href='https://cli.github.com/manual/gh_auth_login';help.target='_blank';help.rel='noopener noreferrer';editor.appendChild(help);
  if(data.state === 'started' || data.state === 'stopping' || store.get('githubSettingsTerminal')){
    editor.appendChild(text('p',data.message || 'Waiting for GitHub approval…','settings-hint'));
    button(editor,'Stop login',function(){send('stop');},data.state==='stopping');return;
  }
  var actions=text('div','','settings-form-actions');editor.appendChild(actions);
  button(actions,'Refresh',function(){send('get');},pending);
  if(observed && observed.account && data.reviewId){
    button(actions,(saved?'Confirm account: ':'Connect ')+observed.account.login,function(){send('connect');},pending);
  }
  if(data.canLogin && observed && ['authenticated','unauthenticated'].indexOf(observed.status)>=0 && data.reviewId){
    editor.appendChild(text('p','A new login may replace the GitHub CLI account for this runtime and change its Git authentication settings. GitHub CLI owns the credentials. After approval, verify and explicitly confirm the resulting account.','settings-hint'));
    button(actions,saved?'Reconnect with browser':'Sign in with browser',function(){
      confirmSettingsAction('Start gh auth login for github.com in OS account '+data.runtime.user+' (HOME '+data.runtime.home+')? This may replace credentials used by other applications. Approve only at https://github.com/login/device.','Start GitHub login',function(){send('login');});
    },pending);
  } else if(data.runtime && data.runtime.shared && !data.canLogin && !(observed && observed.overridden))editor.appendChild(text('p','Only a server administrator can start a new login in the shared OS account. You can connect its verified existing account.','settings-hint'));
  if(saved && data.reviewId)button(actions,'Disconnect',function(){confirmSettingsAction('Remove only this Clay Studio association? GitHub CLI credentials remain available to other applications and existing CLI-backed GitHub tools.','Disconnect',function(){send('disconnect');});},pending);
  button(actions,'Cancel',close,pending);
}
export function initGithubIntegration(root){
  var list=text('div');list.id='us-github-connections';root.querySelector('#us-linear-connections').after(list);
  var editor=text('section','','settings-form');editor.id='us-github-editor';editor.hidden=true;editor.tabIndex=-1;root.querySelector('#us-integration-setup').appendChild(editor);
  var add=text('button','','us-integration-tile');add.type='button';add.id='us-github-add';add.innerHTML=githubMark()+'<span>GitHub</span>';add.onclick=open;root.querySelector('.us-integration-tiles').appendChild(add);
  var status=text('p','','settings-status');status.id='us-github-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');list.after(status);
  store.subscribe(function(state,previous){
    if(state.myUserId!==previous.myUserId || state.currentSlug!==previous.currentSlug || state.projectSplitViewSocketGeneration!==previous.projectSplitViewSocketGeneration || state.connected===false && previous.connected!==false){leaveGithubIntegration();}
  });
}
export function loadGithubIntegration(){
  if(store.get('githubSettingsContextId'))return;
  store.set({githubSettingsContextId:crypto.randomUUID(),githubSettingsContext:context(),githubSettingsData:null});send('get');
}
export function leaveGithubIntegration(){
  if(!store.get('githubSettingsContextId'))return;
  if(store.get('githubSettingsTerminal') || store.get('githubSettingsPending') && store.get('githubSettingsAction')==='login') {
    store.set({githubSettingsClosing:{contextId:store.get('githubSettingsContextId'),requestId:store.get('githubSettingsRequest'),owner:store.get('myUserId')}});
    showToast(store.get('connected')===false?'GitHub login closure is unconfirmed after disconnection. Refresh before another attempt.':'Stopping the GitHub login terminal. Waiting for exit acknowledgement.','info');
  }
  send('release');closeTerminal();
  store.set({githubSettingsContextId:null,githubSettingsRequest:null,githubSettingsPending:false,githubSettingsEditing:false,githubSettingsData:null});
  var root=document.querySelector('.us-section[data-section=us-integrations]');if(root)root.dataset.githubLoaded='false';
  clearIntegrationEditor('github');render();
}
export function handleGithubIntegration(message){
  var closing=store.get('githubSettingsClosing');
  if(closing && closing.contextId===message.contextId && closing.requestId===message.requestId && closing.owner===store.get('myUserId')) {
    if(message.state==='stopped' || message.state==='unknown') {
      showToast(message.message,message.state==='unknown'?'error':'info');
      if(message.state==='stopped')store.set({githubSettingsClosing:null});
    }
  }
  if(!store.get('githubSettingsContextId') || store.get('githubSettingsContext')!==context() || message.contextId!==store.get('githubSettingsContextId') || message.requestId!==store.get('githubSettingsRequest'))return;
  var previous=store.get('githubSettingsData') || {};
  var data=Object.assign({},previous,message);
  if(message.state==='error' || message.state==='unknown')data.observed=null;
  store.set({githubSettingsData:data,githubSettingsPending:['checking','verifying','stopping'].indexOf(message.state)>=0});
  var status=document.getElementById('us-github-status');if(status){status.textContent=message.message || (message.state==='checking'?'Checking GitHub…':'');status.dataset.state=['error','unknown'].indexOf(message.state)>=0?'error':'';}
  if(message.state==='started'){
    store.set({githubSettingsTerminal:message.terminalId});
    openTuiModal(message.terminalId,message.slug,{sessionTitle:'GitHub sign in',compact:true,githubAttachKey:message.attachKey,onClose:function(result){if(!result.exited && store.get('githubSettingsTerminal')===message.terminalId)send('stop');}});
  } else if(['ready','saved','stopped','unknown'].indexOf(message.state)>=0)closeTerminal();
  var root=document.querySelector('.us-section[data-section=us-integrations]');if(root && message.saved)root.dataset.githubLoaded='true';
  if(message.state==='saved'){store.set({githubSettingsEditing:false});}
  render();
  if(message.state==='saved')close();
}

// Retain the editor until the exact login reports terminal exit; unknown never navigates.
export function stopGithubEditorLogin() {
  var data = store.get('githubSettingsData') || {};
  var login = store.get('githubSettingsTerminal') || ['started','stopping'].indexOf(data.state) >= 0 ||
    store.get('githubSettingsAction') === 'login' && (store.get('githubSettingsPending') || data.state === 'unknown');
  if (!login) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var contextId = store.get('githubSettingsContextId'), requestId = store.get('githubSettingsRequest');
    var timer;
    function finish(ok) { clearTimeout(timer); unsubscribe(); resolve(ok); }
    var unsubscribe = store.subscribe(function (state) {
      if (state.githubSettingsContextId !== contextId || state.githubSettingsRequest !== requestId) { finish(false); return; }
      var current = state.githubSettingsData || {};
      if (current.state === 'stopped') finish(true);
      else if (current.state === 'unknown' || state.connected === false) finish(false);
    });
    timer = setTimeout(function () {
      var message = 'GitHub login closure is unconfirmed. Keep this editor open and ask the server operator to inspect it. No login is retried automatically.';
      store.set({githubSettingsPending:false,githubSettingsData:Object.assign({},store.get('githubSettingsData'),{state:'unknown',message:message,reviewId:null})});
      showToast(message,'error'); render(); finish(false);
    },20000);
    if (!send('stop')) finish(false);
  });
}
