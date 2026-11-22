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
    if (editorSubtext) editorSubtext.textContent = 'Select a position and who it reports to. Review, confirm, then save; nothing changes automatically.';
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
    explain.textContent = 'Suggestions use positions already in this company and never apply themselves. Review and save reporting changes in Reporting Lines.';
    starter.append(starterLabel, explain, controls, message, results);
    panel.replaceChildren(title, summary, status, editor, helper, existing, starter);

    // BEXHR_R40_7B_HIERARCHY_CLARITY_20261120
    // Read-only presentation of explicitly saved position links. This never
    // promotes people, guesses rank from their titles, or changes permissions.
    const hierarchyGuide = doc.createElement('section');
    hierarchyGuide.id = 'bexhrR40ReportingHierarchyGuide';
    hierarchyGuide.className = 'border rounded-4 bg-light p-3 mb-3';
    const hierarchyAtGlance = doc.createElement('p');
    hierarchyAtGlance.className = 'fw-semibold mb-2';
    hierarchyAtGlance.textContent = 'Loading the current reporting structure...';
    const hierarchyDetails = doc.createElement('details');
    hierarchyDetails.className = 'mb-2';
    const hierarchyDetailsLabel = doc.createElement('summary');
    hierarchyDetailsLabel.className = 'fw-semibold';
    hierarchyDetailsLabel.textContent = 'View reporting hierarchy';
    const hierarchyContent = doc.createElement('div');
    hierarchyContent.className = 'mt-2 small';
    hierarchyDetails.append(hierarchyDetailsLabel, hierarchyContent);
    const authorityNote = doc.createElement('p');
    authorityNote.className = 'small text-secondary mb-1';
    authorityNote.textContent = 'Choose who reports to whom. This does not change employee managers or HR access.';
    const workflowNote = doc.createElement('p');
    workflowNote.className = 'small text-secondary mb-0';
    workflowNote.textContent = 'Tip: Connect a position to the hierarchy before others can report to it.';
    hierarchyGuide.append(hierarchyAtGlance, hierarchyDetails, authorityNote, workflowNote);
    panel.insertBefore(hierarchyGuide, editor);
    function renderHierarchyGuide(detail) {
      const current = detail?.loaded === true ? detail.hierarchyPreview : null;
      const tenant = str(current?.tenantId);
      if (!tenant || !Array.isArray(current?.positions) || !Array.isArray(current?.links)) {
        hierarchyAtGlance.textContent = 'Company reporting structure unavailable.';
        hierarchyContent.replaceChildren();
        return;
      }
      const isActive = (row) => str(row?.status || 'active').toLowerCase() === 'active';
      const positions = current.positions.filter((p) => positionOwn(p, tenant) && isActive(p));
      const byId = new Map(positions.map((p) => [str(p.id), p]));
      const deptNames = new Map((current.departments || [])
        .filter((d) => positionOwn(d, tenant))
        .map((d) => [str(d.id), str(d.department_name)]));
      const links = current.links.filter((h) => positionOwn(h, tenant) && byId.has(str(h.job_title_id)));
      const byChild = new Map(links.map((h) => [str(h.job_title_id), str(h.reports_to_job_title_id)]));
      const roots = links.filter((h) => !str(h.reports_to_job_title_id)).map((h) => str(h.job_title_id));
      const unconfigured = positions.filter((p) => !byChild.has(str(p.id)));
      const format = (p) => str(p.job_title || 'Unnamed position') + ' (' +
        (str(p.department_id) ? deptNames.get(str(p.department_id)) || 'Department' : 'Whole organisation') + ')';
      const compare = (a, b) => format(byId.get(a)).localeCompare(format(byId.get(b)));
      const children = new Map();
      for (const h of links) {
        const parentId = str(h.reports_to_job_title_id);
        if (!parentId || !byId.has(parentId)) continue;
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(str(h.job_title_id));
      }
      const rootName = roots.length === 1 ? format(byId.get(roots[0])) : '';
      hierarchyAtGlance.textContent = (rootName ? 'Highest position: ' + rootName : 'Highest position: not yet set') +
        '  \u00b7  ' + links.length + ' configured  \u00b7  ' + unconfigured.length + ' pending';
      hierarchyContent.replaceChildren();
      if (!positions.length) {
        const note = doc.createElement('p');
        note.textContent = 'Create the first job title in Step 2. Reporting is configured here afterwards.';
        hierarchyContent.append(note);
        return;
      }
      const visited = new Set();
      function makeNode(id, depth) {
        if (visited.has(id) || depth > 128 || !byId.has(id)) return null;
        visited.add(id);
        const item = doc.createElement('li');
        item.className = 'mb-1';
        const label = doc.createElement('span');
        label.textContent = format(byId.get(id)) + (!byChild.get(id) ? ' - highest' : '');
        item.append(label);
        const below = (children.get(id) || []).filter((childId) => !visited.has(childId)).sort(compare);
        if (below.length) {
          const list = doc.createElement('ul');
          list.className = 'mt-1';
          for (const childId of below) {
            const element = makeNode(childId, depth + 1);
            if (element) list.append(element);
          }
          if (list.children.length) item.append(list);
        }
        return item;
      }
      const list = doc.createElement('ul');
      list.className = 'mb-2 ps-3';
      for (const id of roots.sort(compare)) {
        const row = makeNode(id, 0);
        if (row) list.append(row);
      }
      if (list.children.length) hierarchyContent.append(list);
      const detached = links.filter((h) => !visited.has(str(h.job_title_id)));
      if (detached.length) {
        const warning = doc.createElement('p');
        warning.className = 'text-warning-emphasis mb-1';
        warning.textContent = 'Some saved reporting paths cannot be connected to the current highest position. Review before making further changes.';
        hierarchyContent.append(warning);
      }
      if (unconfigured.length) {
        const note = doc.createElement('p');
        note.className = 'fw-semibold mb-1';
        note.textContent = 'Not yet configured (' + unconfigured.length + '):';
        const names = doc.createElement('p');
        names.className = 'mb-0';
        names.textContent = unconfigured.map(format).sort((a, b) => a.localeCompare(b)).join(', ');
        hierarchyContent.append(note, names);
      }
    }
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
      renderHierarchyGuide(data);
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
