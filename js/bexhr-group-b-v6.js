/* BEXHR_GROUP_B_V6: Existing three-step Reporting Structure stays unchanged.
 * Extend ONLY existing Job Titles "Reports to" selector for a deliberate top-level transition.
 * No automatic CEO/COO title ranking; no employee assignment, PA, Leave or payroll writes.
 */
(() => {
  'use strict';
  const SPECIAL = '__bexhr_new_highest__';
  const ROOT = '__top_level__';
  const el = id => document.getElementById(id);
  const clean = x => String(x ?? '').trim();
  let saving = false;
  let syncing = false;
  let queued = false;

  function currentRoot() {
    if (typeof state === 'undefined' || state.organizationPositionHierarchyLoaded !== true) return null;
    const tenant = clean(state.currentProfile?.tenant_id);
    if (!tenant) return null;
    const roots = (state.organizationJobTitleHierarchy || []).filter(h =>
      clean(h.tenant_id) === tenant && !clean(h.reports_to_job_title_id));
    if (roots.length !== 1) return null;
    const head = (state.organizationJobTitles || []).find(j => clean(j.id) === clean(roots[0].job_title_id) &&
      clean(j.status).toLowerCase() === 'active' && clean(j.tenant_id) === tenant);
    return head ? {id:clean(head.id),title:clean(head.job_title)} : null;
  }
  function eligible() {
    return !clean(el('editingOrganizationJobTitleId')?.value) &&
      clean(el('organizationJobTitleScope')?.value) === 'organization' &&
      clean(el('organizationJobTitleStatus')?.value).toLowerCase() === 'active';
  }
  function showMessage(message, kind='info') {
    const node=el('bexhrGroupBRootAdvice');
    if (node) { node.textContent=message; node.dataset.tone=kind; node.hidden=!message; }
  }
  function sync() {
    if (syncing || saving) return;
    const select=el('organizationJobTitleReportsTo');
    if (!select) return;
    syncing=true;
    try {
      const root=currentRoot();
      const allowed=eligible();
      const existing=select.querySelector(`option[value="${SPECIAL}"]`);
      const top=select.querySelector(`option[value="${ROOT}"]`);
      const prev=select.value;
      // A root may only be created when none exists, or maintained while editing that exact root.
      if (top) {
        const editingId=clean(el('editingOrganizationJobTitleId')?.value);
        const editingCurrentRoot=!!root && editingId===root.id;
        top.disabled=!!root && !editingCurrentRoot;
        // Keep the existing top-level option label unchanged: the existing Group C
        // observer manages it. Only disable invalid root selection here.
      }
      if (allowed && root && typeof canCurrentUserMaintainOrganizationSetupData==='function' && canCurrentUserMaintainOrganizationSetupData()) {
        const option=existing || document.createElement('option');
        option.value=SPECIAL;
        option.textContent=`Make new highest position (above ${root.title})`;
        if (!existing) select.append(option);
        if (prev===SPECIAL) select.value=SPECIAL;
      } else if (existing) {
        existing.remove();
        if (prev===SPECIAL) select.value='';
      }
      if (select.value===SPECIAL && allowed && root) {
        const title=clean(el('organizationJobTitleName')?.value) || 'New position';
        showMessage(`${title} becomes the highest position; ${root.title} reports to ${title}. No employee manager changes.`, 'preview');
      } else if (select.value===ROOT && root && clean(el('editingOrganizationJobTitleId')?.value)!==root.id) {
        showMessage(`Only one highest position is allowed. Choose a parent or select “Make new highest position”.`,'warning');
        select.value='';
      } else showMessage('');
      if (typeof updateOrganizationJobTitleSaveButtonState==='function') updateOrganizationJobTitleSaveButtonState();
    } finally {syncing=false;}
  }
  function schedule() {
    if (queued) return;
    queued=true;
    queueMicrotask(()=>{ queued=false; sync(); });
  }
  async function saveHighest(event) {
    const select=el('organizationJobTitleReportsTo');
    if (select?.value!==SPECIAL) return;
    // Capture BEFORE original form's bubble-phase handler; no double submission.
    event.preventDefault(); event.stopImmediatePropagation();
    if (saving) return;
    const root=currentRoot();
    if (!root || !eligible()) return showMessage('Refresh the organisation setup and try again.','warning');
    const title=clean(el('organizationJobTitleName')?.value);
    if (title.length<2 || title.length>100 || title.toLowerCase()===root.title.toLowerCase())
      return showMessage('Enter a different position title (2–100 characters).','warning');
    if (typeof canCurrentUserMaintainOrganizationSetupData!=='function' || !canCurrentUserMaintainOrganizationSetupData())
      return showMessage('Only an authorised HR Admin can change the highest position.','warning');
    if (!window.confirm(`Make “${title}” the new highest organisational position?\n\n“${root.title}” will report to “${title}”.\n\nEmployee Primary Managers, PA and Leave approvals will NOT change.`)) return;
    const button=el('saveOrganizationJobTitleBtn');
    const label=el('organizationJobTitleSubmitLabel');
    const before=label?.textContent;
    saving=true;
    if (button) button.disabled=true;
    if (label) label.textContent='Saving hierarchy...';
    showMessage('Saving position and reporting change...','progress');
    try {
      if (typeof getSupabaseClient!=='function') throw Error('Workspace connection unavailable.');
      const response=await getSupabaseClient().rpc('bexhr_bc_v3_introduce_highest_position', {
        p_job_title:title, p_expected_current_root:root.id
      });
      if (response.error) throw response.error;
      if (!response.data?.success) throw Error('The position change was not confirmed.');
      if (typeof refreshOrganizationHrSetupValues==='function') await refreshOrganizationHrSetupValues();
      if (typeof resetOrganizationJobTitleForm==='function') resetOrganizationJobTitleForm();
      showMessage(`${title} is now highest. ${root.title} reports to ${title}.`,'success');
      if (typeof showDashboardToast==='function') showDashboardToast('success','Highest position saved',`${title} is now the highest organisational position.`);
    } catch (err) {
      showMessage(clean(err?.message) || 'Unable to save the highest position. No change was confirmed.','warning');
    } finally {
      saving=false;
      if (label) label.textContent=before || 'Create Job Title';
      sync();
    }
  }
  function mount() {
    const form=el('organizationJobTitleForm');
    const select=el('organizationJobTitleReportsTo');
    const helper=el('organizationJobTitleReportsToHelp');
    if (!form || !select || !helper || el('bexhrGroupBRootAdvice')) return;
    const advice=document.createElement('div');
    advice.id='bexhrGroupBRootAdvice';
    advice.className='bexhr-group-b-root-advice';
    advice.setAttribute('role','status');
    advice.setAttribute('aria-live','polite');
    advice.hidden=true;
    helper.insertAdjacentElement('afterend',advice);
    form.addEventListener('submit',saveHighest,true);
    select.addEventListener('change',schedule);
    for(const id of ['organizationJobTitleName','organizationJobTitleScope','organizationJobTitleStatus','editingOrganizationJobTitleId']){
      el(id)?.addEventListener('change',schedule);
      el(id)?.addEventListener('input',schedule);
    }
    new MutationObserver(schedule).observe(select,{childList:true});
    const table=el('organizationJobTitlesTableBody');
    if (table) new MutationObserver(schedule).observe(table,{childList:true,subtree:false});
    window.addEventListener('bexhr:organization-setup-updated',schedule);
    schedule();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
