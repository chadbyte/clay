import { store } from './store.js';
import { confirmSettingsAction as showConfirmDialog } from './server-settings-state.js';

function wrapEditor(content, title, summary) {
  var group=document.createElement('section');group.className='us-config-group';
  content.before(group);
  var heading=document.createElement('div');heading.className='us-editor-heading';
  var label=document.createElement('h3');label.textContent=title;
  var edit=document.createElement('button');edit.type='button';edit.className='settings-btn-sm';edit.textContent='Edit';
  var state=document.createElement('p');state.className='us-editor-summary';state.textContent=summary();
  heading.append(label,edit);group.append(heading,state);
  var help=content.querySelector('.settings-hint');var copy=null;if(help && title!=='Personal allow rules'){copy=help.cloneNode(true);group.appendChild(copy);}
  group.appendChild(content);content.hidden=true;
  store.subscribe(function(next,previous){if(next.userSettingsProfile!==previous.userSettingsProfile)state.textContent=summary();});
  var done=document.createElement('button');done.type='button';done.className='settings-btn-sm';done.textContent='Done';content.appendChild(done);
  edit.onclick=function(){if(copy)copy.hidden=true;content.hidden=false;state.hidden=true;edit.hidden=true;var first=content.querySelector('button,input,textarea,select');if(first)first.focus();};
  done.onclick=function(){if(copy)copy.hidden=false;content.hidden=true;state.hidden=false;edit.hidden=false;state.textContent=summary();edit.focus();};
  return {group:group,state:state,edit:edit,done:done,content:content};
}
export function initPersonalEditors() {
  var allow=document.getElementById('us-claude-allow-list');var permission=wrapEditor(allow.closest('.settings-card'),'Personal allow rules',function(){var count=(store.get('userAllowSaved') || []).length;return count+' personal rules. Managed defaults apply separately.';});
  permission.done.textContent='Cancel';permission.done.onclick=function(){function cancel(){allow.value=(store.get('userAllowSaved') || []).join('\n');store.set({userAllowDirty:false,userAllowNeedsRetry:false});permission.content.hidden=true;permission.state.hidden=false;permission.edit.hidden=false;permission.edit.focus();}if(store.get('userAllowDirty'))showConfirmDialog('Discard unsaved command rules?', 'Discard',cancel);else cancel();};
  store.subscribe(function(state,previous){if(state.userAllowSaved!==previous.userAllowSaved){permission.state.textContent=(state.userAllowSaved || []).length+' personal rules. Managed defaults apply separately.';if(previous.userAllowDirty && !state.userAllowDirty){permission.content.hidden=true;permission.state.hidden=false;permission.edit.hidden=false;permission.edit.focus();}}});
}
