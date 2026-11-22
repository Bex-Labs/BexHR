/* BexHR Group B: a deliberate, authorised 'new highest position' workflow.
 * Frontend is an add-on only. No automatic employee promotion or PA/Leave edits.
 */
(() => {
  'use strict';
  const $$ = (id) => document.getElementById(id);
  const getRoot = () => {
    if (typeof state === 'undefined' || !state.organizationPositionHierarchyLoaded) return null;
    const tenant = String(state.currentProfile?.tenant_id || '').trim();
    const roots = (state.organizationJobTitleHierarchy || []).filter((h) =>
      String(h.tenant_id || '').trim() === tenant && !String(h.reports_to_job_title_id || '').trim());
    if (roots.length !== 1) return null;
    const root = (state.organizationJobTitles || []).find((p) =>
      String(p.id) === String(roots[0].job_title_id) && String(p.status || '').toLowerCase() === 'active');
    return root ? { id: String(root.id), label: String(root.job_title || '') } : null;
  };
  const canManage = () => typeof canCurrentUserMaintainOrganizationSetupData === 'function' &&
    canCurrentUserMaintainOrganizationSetupData();
  function make(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent) node.textContent = textContent;
    return node;
  }
  function mount() {
    const form = $$('organizationJobTitleForm');
    if (!form || $$('bexhrBcV3Executive')) return;
    const wrapper = make('section', 'bexhr-bc-v3-executive');
    wrapper.id = 'bexhrBcV3Executive';
    wrapper.setAttribute('aria-label', 'Executive organisation hierarchy');
    const explanation = make('p', 'bexhr-bc-v3-helper',
      'Executive positions can sit at different levels. For a COO reporting to a CEO, create the COO normally and choose CEO as Parent position.');
    const trigger = make('button', 'btn btn-outline-primary', 'Introduce a new highest position');
    trigger.type = 'button';
    trigger.id = 'bexhrBcV3Show';
    trigger.setAttribute('aria-controls','bexhrBcV3Panel');
    trigger.setAttribute('aria-expanded','false');
    const panel = make('div', 'bexhr-bc-v3-panel');
    panel.id = 'bexhrBcV3Panel';
    panel.hidden = true;
    const title = make('h4', 'h6 fw-semibold', 'Introduce the new organisation head');
    const help = make('p', 'small text-secondary',
      'Example: add CEO above the current highest position. This changes position hierarchy only, not employee managers or appointments.');
    const label = make('label', 'form-label fw-semibold', 'New position title *');
    label.htmlFor = 'bexhrBcV3NewTitle';
    const input = make('input', 'form-control');
    input.id = 'bexhrBcV3NewTitle';
    input.type = 'text';
    input.maxLength = 100;
    input.placeholder = 'e.g. Chief Executive Officer';
    input.autocomplete = 'off';
    const preview = make('p', 'bexhr-bc-v3-preview');
    preview.id = 'bexhrBcV3Preview';
    preview.setAttribute('aria-live','polite');
    const checkRow = make('label', 'bexhr-bc-v3-confirm');
    const checkbox = make('input', 'form-check-input');
    checkbox.id = 'bexhrBcV3Confirm';
    checkbox.type = 'checkbox';
    checkRow.append(checkbox,make('span','',
      'I confirm this new position will become the highest organisational position. The previous head will report to it.'));
    const actions = make('div', 'bexhr-bc-v3-actions');
    const submit = make('button', 'btn btn-primary', 'Save highest position');
    submit.type = 'button';
    submit.id = 'bexhrBcV3Submit';
    submit.disabled = true;
    const cancel = make('button','btn btn-outline-secondary','Cancel');
    cancel.type = 'button';
    const status = make('div','bexhr-bc-v3-status');
    status.id = 'bexhrBcV3Status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    actions.append(submit,cancel);
    panel.append(title,help,label,input,preview,checkRow,actions,status);
    wrapper.append(explanation,trigger,panel);
    form.before(wrapper);
    let saving = false;
    let displayedRootId = '';
    function update() {
      const root = getRoot();
      const manager = canManage();
      wrapper.hidden = !root || !manager;
      if (!root) return;
      if (root.id !== displayedRootId) {
        displayedRootId = root.id;
        if (!saving) { checkbox.checked = false; input.value = ''; }
      }
      const newName = input.value.trim();
      preview.textContent = newName ?
        `${newName} (new highest)  →  ${root.label} (reports to ${newName})` :
        `Current highest position: ${root.label}. Enter a new position to preview the change.`;
      submit.disabled = saving || !manager || !checkbox.checked || newName.length < 2 ||
        newName.toLowerCase() === root.label.toLowerCase();
    }
    function close() {
      if (saving) return;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded','false');
      status.textContent = '';
      checkbox.checked = false;
      input.value = '';
      update();
    }
    trigger.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded',String(!panel.hidden));
      if (!panel.hidden) input.focus({preventScroll:true});
      update();
    });
    cancel.addEventListener('click',close);
    input.addEventListener('input', update);
    checkbox.addEventListener('change', update);
    submit.addEventListener('click',async () => {
      if (saving || submit.disabled) return;
      const root = getRoot();
      if (!root || !canManage()) return;
      const newTitle = input.value.trim();
      saving = true;
      submit.textContent = 'Saving position...';
      submit.disabled = true;
      status.className = 'bexhr-bc-v3-status';
      status.textContent = 'Updating the organisational structure...';
      try {
        if (typeof getSupabaseClient !== 'function') throw new Error('Workspace is not connected.');
        const { data,error } = await getSupabaseClient().rpc('bexhr_bc_v3_introduce_highest_position', {
          p_job_title: newTitle, p_expected_current_root: root.id,
        });
        if (error) throw error;
        if (!data?.success) throw new Error('The position was not confirmed as saved.');
        if (typeof refreshOrganizationHrSetupValues === 'function') await refreshOrganizationHrSetupValues();
        status.className = 'bexhr-bc-v3-status bexhr-bc-v3-success';
        status.textContent = `${newTitle} is now the highest position. ${root.label} reports to ${newTitle}. No employee assignments changed.`;
        input.value = '';
        checkbox.checked = false;
        panel.hidden = false;
        trigger.setAttribute('aria-expanded','true');
      } catch (error) {
        status.className = 'bexhr-bc-v3-status bexhr-bc-v3-error';
        status.textContent = error?.message || 'Unable to update the highest position. No changes were confirmed.';
      } finally {
        saving = false;
        submit.textContent = 'Save highest position';
        update();
      }
    });
    const table = $$('organizationJobTitlesTableBody');
    if (table) new MutationObserver(update).observe(table,{childList:true});
    // The existing Job Titles loader refreshes this table when tenant state changes.
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
