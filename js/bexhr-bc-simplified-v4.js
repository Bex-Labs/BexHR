/* BexHR Group B V4: ONE job-title and placement workflow. UI-only integration.
 * Keeps the existing tenant-scoped create/modify API and the V3 atomic head RPC.
 * No title-based automatic promotion, employee reassignment or PA/Leave changes.
 */
(() => {
  'use strict';
  const TAG = 'BEXHR_BC_V4_ONE_FORM';
  const TOP = '__top_level__';
  const PROMOTE = '__bexhr_v4_new_highest__';
  const $ = (id) => document.getElementById(id);
  let mounted = false;
  let working = false;
  let rootSnapshot = '';
  let lastHint = '';

  function permitted() {
    return typeof canCurrentUserMaintainOrganizationSetupData === 'function' &&
      canCurrentUserMaintainOrganizationSetupData();
  }
  function currentRoot() {
    if (typeof state === 'undefined' || !state.organizationPositionHierarchyLoaded) return null;
    const tenant = String(state.currentProfile?.tenant_id || '').trim();
    const active = new Map((state.organizationJobTitles || [])
      .filter(x => String(x.tenant_id || '') === tenant && String(x.status || '').toLowerCase() === 'active')
      .map(x => [String(x.id), x]));
    const roots = (state.organizationJobTitleHierarchy || []).filter(h =>
      String(h.tenant_id || '') === tenant && !h.reports_to_job_title_id && active.has(String(h.job_title_id)));
    if (roots.length !== 1) return null;
    const position = active.get(String(roots[0].job_title_id));
    return { id: String(position.id), title: String(position.job_title || '') };
  }
  function make(tag, cls, label) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (label != null) node.textContent = label;
    return node;
  }
  function status(message, isError) {
    const el = $('bexhrBcV4Status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'bexhr-bc-v4-status' + (isError ? ' bexhr-bc-v4-error' : '');
  }
  function isNew() { return !String($('editingOrganizationJobTitleId')?.value || '').trim(); }
  function isWhole() { return $('organizationJobTitleScope')?.value === 'organization'; }
  function isActive() { return $('organizationJobTitleStatus')?.value === 'Active'; }
  function selectedPromotion() { return $('organizationJobTitleReportsTo')?.value === PROMOTE; }
  function stopLegacyDualEditor() {
    // The separate position-reporting editor duplicates the job-title parent selector.
    // Hide its step only in enabled position hierarchy workspaces; leave all functions intact.
    const enabled = typeof state !== 'undefined' && state.p7bDepartmentReportingEnabled === true;
    const step = document.querySelector('[data-reporting-step="reportingLines"]');
    if (step && enabled) {
      step.hidden = true;
      step.setAttribute('aria-hidden','true');
      step.tabIndex = -1;
    }
    const quickSuggestions = $('bexhrHierarchyTemplateAssistant');
    if (quickSuggestions && enabled) quickSuggestions.hidden = true;
    const heading = $('organizationJobTitlesSection');
    const subtitle = heading?.querySelector('.section-subtext');
    if (subtitle) subtitle.textContent = 'Create a position and choose where it belongs. Use Edit to update an existing position.';
    const note = document.querySelector('#bexhrStagingReportingSteps + #bexhrStagingReportingHelpV2');
    if (note && enabled) note.textContent = 'One place to manage job titles and their reporting positions.';
  }
  function concealDuplicate() {
    const duplicate = $('bexhrBcV3Executive');
    if (duplicate) duplicate.hidden = true; // Preserve legacy event listeners, do not invoke.
  }
  function createInline() {
    if ($('bexhrBcV4Review')) return;
    const select = $('organizationJobTitleReportsTo');
    const field = $('organizationJobTitleReportsToField');
    if (!select || !field) return;
    const label = field.querySelector('label[for="organizationJobTitleReportsTo"]');
    if (label) label.innerHTML = 'Reports to <span class="text-danger">*</span>';
    const help = $('organizationJobTitleReportsToHelp');
    if (help) help.textContent = 'Choose the position above this one. A company can have one highest position.';
    const panel = make('section', 'bexhr-bc-v4-review');
    panel.id = 'bexhrBcV4Review';
    panel.classList.add('col-12');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Review new highest position');
    const text = make('div','bexhr-bc-v4-impact');
    text.id = 'bexhrBcV4Impact';
    text.setAttribute('aria-live', 'polite');
    const confirmation = make('label','bexhr-bc-v4-confirm');
    const checkbox = make('input','form-check-input');
    checkbox.type = 'checkbox';
    checkbox.id = 'bexhrBcV4Confirm';
    const caption = make('span','', 'I confirm this position becomes the organisation head; the previous head will report to it. No employee is promoted.');
    confirmation.append(checkbox,caption);
    const line = make('div','bexhr-bc-v4-status');
    line.id = 'bexhrBcV4Status';
    line.setAttribute('role','status');
    line.setAttribute('aria-live','polite');
    panel.append(text,confirmation,line);
    field.insertAdjacentElement('afterend', panel);
    checkbox.addEventListener('change', () => {
      if (typeof updateOrganizationJobTitleSaveButtonState === 'function') updateOrganizationJobTitleSaveButtonState();
      render();
    });
  }
  function optionForPromotion(root) {
    const option = document.createElement('option');
    option.value = PROMOTE;
    option.textContent = 'Make this the new highest position (above ' + root.title + ')';
    return option;
  }
  function render() {
    if (!mounted) return;
    concealDuplicate();
    stopLegacyDualEditor();
    const select = $('organizationJobTitleReportsTo');
    const panel = $('bexhrBcV4Review');
    const confirm = $('bexhrBcV4Confirm');
    if (!select || !panel) return;
    const root = currentRoot();
    const canOffer = !!root && isNew() && isWhole() && isActive() && permitted() &&
      typeof state !== 'undefined' && state.p7bDepartmentReportingEnabled === true;
    const old = select.querySelector('option[value="' + PROMOTE + '"]');
    if (canOffer) {
      if (!old) select.appendChild(optionForPromotion(root));
      else old.textContent = 'Make this the new highest position (above ' + root.title + ')';
    } else if (old) {
      old.remove();
    }
    // Do not silently convert a promoted position to a normal child on status/scope changes.
    // Require the HR Admin to select a valid placement again.
    if (!canOffer && select.value === PROMOTE) select.value = '';
    if (root && root.id !== rootSnapshot) {
      rootSnapshot = root.id;
      if (confirm) confirm.checked = false;
    }
    const promoted = canOffer && selectedPromotion();
    panel.hidden = !promoted;
    if (!promoted) {
      if (confirm) confirm.checked = false;
      if (!working) status('');
    } else {
      const title = String($('organizationJobTitleName')?.value || '').trim() || 'New position';
      const impact = $('bexhrBcV4Impact');
      if (impact) impact.textContent = title + ' (new highest)  →  ' + root.title + ' (reports to ' + title + ')';
    }
    const submit = $('saveOrganizationJobTitleBtn');
    if (submit && promoted && !working) submit.disabled = !confirm?.checked ||
      String($('organizationJobTitleName')?.value || '').trim().length < 2;
    if (submit && working) submit.disabled = true;
    if (root && lastHint !== root.id) lastHint = root.id;
  }
  function updateAfterInput() { queueMicrotask(render); }
  async function saveHighest(event) {
    if (!selectedPromotion()) return; // Ordinary existing Save handler remains authoritative.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (working) return;
    const root = currentRoot();
    const title = String($('organizationJobTitleName')?.value || '').trim();
    const accepted = $('bexhrBcV4Confirm')?.checked;
    if (!permitted() || !isNew() || !isWhole() || !isActive() || !root || title.length < 2 || !accepted) {
      status('Review the proposed change and confirm before saving.', true);
      return;
    }
    const duplicate = (state.organizationJobTitles || []).some(job =>
      !job.department_id && String(job.job_title || '').trim().toLowerCase() === title.toLowerCase());
    if (duplicate) { status('This job title already exists. Edit that position instead.',true); return; }
    working = true;
    const button = $('saveOrganizationJobTitleBtn');
    const previousHtml = button?.innerHTML || '';
    if (button) { button.disabled = true; button.textContent = 'Saving position...'; }
    status('Saving organisation hierarchy...');
    try {
      if (typeof getSupabaseClient !== 'function') throw new Error('Your workspace is not connected.');
      const { data, error } = await getSupabaseClient().rpc('bexhr_bc_v3_introduce_highest_position', {
        p_job_title: title,
        p_expected_current_root: root.id,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('The change could not be confirmed.');
      if (typeof refreshOrganizationHrSetupValues === 'function') await refreshOrganizationHrSetupValues();
      if (typeof resetOrganizationJobTitleForm === 'function') resetOrganizationJobTitleForm();
      if (typeof redirectToOrganizationJobTitleRecordsAfterSave === 'function') redirectToOrganizationJobTitleRecordsAfterSave();
      if (typeof showPageAlert === 'function') showPageAlert('success', title + ' is now the highest position. Existing employee managers are unchanged.');
      status('');
    } catch (error) {
      const msg = String(error?.message || 'Unable to save the position.');
      const expired = /jwt expired|invalid jwt|401|not authenticated|unauthorized/i.test(msg);
      status(expired ? 'Session expired. Sign in again, then retry. No hierarchy change was confirmed.' : msg, true);
    } finally {
      working = false;
      if (button) button.innerHTML = previousHtml;
      if (typeof updateOrganizationJobTitleSaveButtonState === 'function') updateOrganizationJobTitleSaveButtonState();
      render();
    }
  }
  function mount() {
    if (mounted) return;
    const form = $('organizationJobTitleForm');
    const select = $('organizationJobTitleReportsTo');
    if (!form || !select) return;
    mounted = true;
    createInline();
    concealDuplicate();
    stopLegacyDualEditor();
    // Capture is necessary: the established app has its own bubble-phase Save handler.
    // Only the explicit 'make highest' selection is intercepted.
    form.addEventListener('submit', saveHighest, true);
    for (const id of ['organizationJobTitleScope','organizationJobTitleStatus',
      'organizationJobTitleName','organizationJobTitleReportsTo', 'editingOrganizationJobTitleId']) {
      $(id)?.addEventListener('change',updateAfterInput);
      $(id)?.addEventListener('input',updateAfterInput);
    }
    const observer = new MutationObserver(() => {
      // Existing app repopulates the parent dropdown after org refresh/edit.
      // Observe only direct option changes and avoid unnecessary writes.
      queueMicrotask(render);
    });
    observer.observe(select,{childList:true});
    const records = $('organizationJobTitlesTableBody');
    if (records) new MutationObserver(() => queueMicrotask(render)).observe(records,{childList:true});
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
