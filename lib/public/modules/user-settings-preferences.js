import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getChatLayout, setChatLayout } from './theme.js';

export function preferenceStatus(id, text, error) {
  var control = document.getElementById(id); if (!control) return;
  var status = document.getElementById(id + '-receipt');
  if (!status) {status = document.createElement('p');status.id=id+'-receipt';status.className='settings-status';status.setAttribute('role','status');control.closest('.settings-card').appendChild(status);}
  status.textContent=text;status.dataset.state=error?'error':'';
}
async function saveToggle(id, url, apply) {
  var input=document.getElementById(id);var want=input.checked;
  input.disabled=true;preferenceStatus(id,'Saving…');
  try {
    var response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:want})});var data=await response.json();
    if(!response.ok || !data.ok)throw new Error(data.error || 'Could not save.');
    if(apply)apply(want);preferenceStatus(id,'Saved.');
  } catch(error) {input.checked=!want;preferenceStatus(id,error.message+' Try again.',true);}
  finally {input.disabled=false;}
}
export function initPersonalPreferences() {
  document.getElementById('us-auto-continue').onchange=function(){saveToggle(this.id,'/api/user/auto-continue');};

  document.querySelectorAll('#us-layout-switcher button').forEach(function(button){button.onclick=async function(){
    var layout=button.dataset.layout;var controls=button.parentElement.querySelectorAll('button');controls.forEach(function(el){el.disabled=true;});preferenceStatus('us-layout-switcher','Saving…');
    try {var response=await fetch('/api/user/chat-layout',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:layout})});if(!response.ok)throw new Error('Could not save layout.');setChatLayout(layout);controls.forEach(function(el){el.classList.toggle('selected',el.dataset.layout===layout);el.setAttribute('aria-pressed',el.dataset.layout===layout);});preferenceStatus('us-layout-switcher','Saved. Applied to conversations in this view.');}
    catch(error){preferenceStatus('us-layout-switcher',error.message+' Try again.',true);}
    finally{controls.forEach(function(el){el.disabled=false;});}
  };});
  var textarea=document.getElementById('us-claude-allow-list');textarea.oninput=function(){
    var patterns=textarea.value.split('\n').map(function(line){return line.trim();}).filter(Boolean);
    store.set({userAllowDirty:!!store.get('userAllowNeedsRetry') || JSON.stringify(patterns)!==JSON.stringify(store.get('userAllowSaved') || [])});
  };
  document.getElementById('us-claude-allow-save').onclick=function(){
    var ws=getWs();if(!ws || ws.readyState!==1){preferenceStatus('us-claude-allow-list','Disconnected. Your draft is retained.',true);return;}
    this.disabled=true;preferenceStatus('us-claude-allow-list','Saving…');ws.send(JSON.stringify({type:'set_claude_user_allow_list',patterns:textarea.value.split('\n').map(function(line){return line.trim();}).filter(Boolean)}));
    setTimeout(function(){var save=document.getElementById('us-claude-allow-save');if(save.disabled){save.disabled=false;preferenceStatus('us-claude-allow-list','No acknowledgement. Your draft is retained; reconnect and retry.',true);}},12000);
  };
}
export function handlePersonalSettingsMessage(msg) {
  if(msg.type==='claude_allow_list') {
    store.set({userAllowSaved:msg.user || []});
    if(store.get('userAllowDirty'))document.getElementById('us-claude-allow-list').oninput();
    if(store.get('userAllowDirty'))return;
  }
  if(msg.type==='set_claude_user_allow_list_result') {
    document.getElementById('us-claude-allow-save').disabled=false;
    if(msg.ok)store.set({userAllowDirty:msg.effective===false,userAllowNeedsRetry:msg.effective===false,userAllowSaved:msg.patterns || []});
    var message=msg.ok ? (msg.effective===false ? 'Saved to your account, but not installed in Claude. Check filesystem access, then Save to retry.' : 'Saved. Applies on the next Claude invocation.') : msg.error || 'Save failed. Your draft is retained.';
    preferenceStatus('us-claude-allow-list',message,!msg.ok || msg.effective===false);
  }
}
