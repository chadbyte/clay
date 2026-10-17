// project-start-forms.js - Create and clone steps (name or URL only)

import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { submitCreate, submitClone } from './project-start-submit.js';

var FORMS = {
  create: {
    label: 'Project name', field: 'name', placeholder: 'my-project', action: 'Create project', busy: 'Creating…',
    hint: 'Letters, numbers, dashes and underscores.', submit: submitCreate,
  },
  clone: {
    label: 'GitHub repository URL', field: 'url', placeholder: 'https://github.com/user/repo', action: 'Clone repository', busy: 'Cloning…',
    hint: 'Paste the repository address to bring it into Clay.', submit: submitClone,
  },
};

export function formViewHtml(kind) {
  var form = FORMS[kind];
  return '<form class="project-start-view" data-view="' + kind + '" novalidate>' +
    '<div class="project-start-scroll project-start-formbody">' +
      '<label class="project-start-label" for="project-start-field">' + form.label + '</label>' +
      '<input type="text" id="project-start-field" class="project-start-input" data-ps="field" placeholder="' + form.placeholder + '" autocomplete="off" spellcheck="false" aria-describedby="project-start-hint">' +
      '<p class="project-start-hint" id="project-start-hint">' + form.hint + '</p>' +
      '<p class="project-start-progress" data-ps="progress" role="status" hidden><span class="project-start-spinner" aria-hidden="true"></span>Cloning repository…</p>' +
      '<p class="project-start-error" data-ps="error" role="alert" hidden></p>' +
    '</div>' +
    '<div class="project-start-footer"><button type="submit" class="project-start-primary" data-ps="submit">' + escapeHtml(form.action) + '</button></div>' +
  '</form>';
}

function root(kind) { return document.querySelector('#project-start-body [data-view="' + kind + '"]'); }

export function renderFormView(kind) {
  var view = root(kind);
  if (!view) return;
  var form = FORMS[kind];
  var current = store.get('projectStart');
  var submit = current.submit;
  var busy = submit.status === 'busy';
  var field = view.querySelector('[data-ps="field"]');
  if (field.value !== current[form.field]) field.value = current[form.field];
  field.readOnly = busy;
  var button = view.querySelector('[data-ps="submit"]');
  button.disabled = busy;
  button.textContent = busy ? form.busy : form.action;
  view.querySelector('[data-ps="progress"]').hidden = !(busy && kind === 'clone' && submit.cloning);
  var error = view.querySelector('[data-ps="error"]');
  error.textContent = submit.error || '';
  error.hidden = !submit.error;
  view.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function bindFormView(kind) {
  var view = root(kind);
  var form = FORMS[kind];
  view.querySelector('[data-ps="field"]').addEventListener('input', function (event) {
    var patch = {};
    patch[form.field] = event.target.value;
    store.set({ projectStart: Object.assign({}, store.get('projectStart'), patch) });
  });
  view.addEventListener('submit', function (event) {
    event.preventDefault();
    form.submit();
  });
}
