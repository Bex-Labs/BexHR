/* BexHR H6E: a focused Reporting Lines workspace, not a new authority engine.
 * Uses existing H1/H6B/H6C read/preview and protected Job Title editor.
 * It does not fetch, save, reassign managers, issue SQL or change PA/Leave access.
 */
(function (root) {
  'use strict';
  if (!root || !root.document) return;
  const doc = root.document;
  const str = (v) => String(v == null ? '' : v).trim();
  const positionOwn = (row, tenant) => str(row?.tenant_id) === str(tenant);
  function mount() {
    const panel = doc.getElementById('bexhrHierarchyTemplateAssistant');
    if (!panel || panel.dataset.h6eMounted === 'true') return;
    const editor = panel.querySelector('#bexhrH6CManualPositionEditor');
    const adoption = panel.querySelector('[aria-label="Existing company reporting compatibility review"]');
    const title = panel.querySelector(':scope > h4');
    const summary = panel.querySelector(':scope > p');
    const controls = panel.querySelector(':scope > .row');
    const message = panel.querySelector('#bexhrHierarchyTemplateMessage');
    const results = panel.querySelector('#bexhrHierarchyTemplateResults');
    // Fail closed: never move or discard incomplete legacy setup controls.
    if (!editor || !adoption || !title || !summary || !controls || !message || !results) {
      console.warn('H6E: existing reporting components incomplete; legacy layout preserved.');
      return;
    }
    panel.dataset.h6eMounted = 'true';
    panel.classList.add('bexhr-h6e-reporting-workspace');
    panel.classList.remove('bg-light');
    title.textContent = 'Who reports to whom?';
    summary.textContent = 'Choose a job position and the position it reports to. Your existing employee managers are not changed.';
    const status = doc.createElement('div');
    status.id = 'bexhrH6EStatus';
    status.className = 'bexhr-h6e-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Loading company reporting setup…';

    const editorHeading = editor.querySelector('h5');
    if (editorHeading) editorHeading.textContent = 'Set a reporting line';
    const editorSubtext = editor.querySelector(':scope > p');
    if (editorSubtext) editorSubtext.textContent = 'Choose a position, choose its supervisor position, then review. Nothing saves automatically.';
    const editorChildLabel = editor.querySelector('label[for="bexhrH6CChild"]');
    if (editorChildLabel) editorChildLabel.textContent = 'Job position';
    const editorParentLabel = editor.querySelector('label[for="bexhrH6CParent"]');
    if (editorParentLabel) editorParentLabel.textContent = 'Reports to';
    const editorReview = editor.querySelector('#bexhrH6CReview');
    if (editorReview) editorReview.textContent = 'Review';
    editor.classList.remove('border-top', 'mt-4', 'pt-3');
    editor.classList.add('bexhr-h6e-primary-action');
    const helper = doc.createElement('p');
    helper.className = 'small text-secondary mt-3 mb-0';
    helper.textContent = 'This sets the usual reporting path for a job position. To change one person’s manager, use People → Employee Directory → Manage reporting managers.';
    // Existing H6B and H1 remain accessible without overwhelming the default screen.
    const existing = doc.createElement('details');
    existing.id = 'bexhrH6EExistingReview';
    existing.className = 'bexhr-h6e-optional';
    const existingLabel = doc.createElement('summary');
    existingLabel.textContent = 'Review saved employee managers (read-only)';
    existing.append(existingLabel, adoption);
    const starter = doc.createElement('details');
    starter.id = 'bexhrH6EStarterTemplates';
    starter.className = 'bexhr-h6e-optional';
    const starterLabel = doc.createElement('summary');
    starterLabel.textContent = 'Use a starter template (optional)';
    const explain = doc.createElement('p');
    explain.className = 'small text-secondary mt-2 mb-3';
    explain.textContent = 'Suggestions use positions already in this company and never apply themselves. Confirm any change in the Job Titles form.';
    starter.append(starterLabel, explain, controls, message, results);
    panel.replaceChildren(title, summary, status, editor, helper, existing, starter);

    const childSelect = editor.querySelector('#bexhrH6CChild');
    const parentSelect = editor.querySelector('#bexhrH6CParent');
    const resultElement = editor.querySelector('#bexhrH6CResult');
    let snapshot = null;
    let mayEdit = false;
    function updateDepartmentReadiness() {
      if (!childSelect || !parentSelect || !editorReview) return;
      if (!snapshot || !mayEdit || editor.hidden) return;
      const selected = str(childSelect.value);
      const own = (snapshot.positions || []).find((row) =>
        str(row.id) === selected && positionOwn(row, snapshot.tenantId));
      const held = Boolean(own && str(own.department_id) && snapshot.departmentReportingEnabled !== true);
      if (held) {
        parentSelect.replaceChildren(new Option('Not available until reporting upgrade', ''));
        parentSelect.disabled = true;
        editorReview.disabled = true;
        if (resultElement) resultElement.textContent =
          'This is a departmental position. Its reporting parent cannot be edited until the reviewed database upgrade is enabled. Existing employee managers remain unchanged.';
      } else {
        parentSelect.disabled = false;
        editorReview.disabled = false;
      }
    }
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const data = event?.detail || {};
      snapshot = data.loaded === true ? data.hierarchyPreview : null;
      mayEdit = data.canMaintain === true;
      if (!snapshot) {
        status.textContent = 'Company reporting setup is unavailable. Refresh Organisation Setup.';
      } else if (!mayEdit) {
        status.textContent = 'Only an authorised HR Admin can edit reporting positions.';
      } else if (snapshot.departmentReportingEnabled === true) {
        status.textContent = 'Departmental reporting is enabled. Choose a position below to review a change.';
      } else {
        status.textContent = 'Company-wide reporting is available. Departmental reporting changes remain locked until the verified database upgrade. Existing managers are preserved.';
      }
      updateDepartmentReadiness();
    });
    childSelect?.addEventListener('change', updateDepartmentReadiness);
    // The H6C and H1 handlers call the original protected Job Title editor.
    // Select its existing tab *before* their handlers scroll/focus the form.
    panel.addEventListener('click', (event) => {
      const button = event.target?.closest?.('button');
      if (!button || button.disabled) return;
      if (button.id === 'bexhrH6COpenEditor' ||
          button.hasAttribute('data-bexhr-hierarchy-review')) {
        if (typeof root.hrOpenOrganizationSetupPanel === 'function') {
          root.hrOpenOrganizationSetupPanel('jobTitles');
        }
      }
    }, true);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})(typeof window === 'object' ? window : null);
