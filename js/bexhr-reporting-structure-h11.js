/* BEXHR_STAGING_REPORTING_V4: restore all reporting subjects; keep supervisor-role filtering. */
/* BEXHR_STAGING_REPORTING_STRUCTURE_V1
 * Local staging UX only. No database writes or permissions granted.
 * Preserve the existing department/job-title/reporting forms, their IDs,
 * handlers, backend checks, and edit/shortcut workflows.
 */
(function () {
  'use strict';

  const GROUP = new Set(['departments', 'jobTitles', 'reportingLines']);
  const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
  const get = (id) => document.getElementById(id);
  let structure = null;
  let latestSnapshot = null;
  let rejectedSupervisorPositions = new Set();
  let rosterRequestNumber = 0;

  function renderChart() {
    if (!structure) return;
    const target = structure.chartContent;
    target.replaceChildren();
    const data = latestSnapshot;
    if (!data || !Array.isArray(data.positions) || !Array.isArray(data.links)) {
      const note = document.createElement('p');
      note.className = 'text-secondary';
      note.textContent = 'Organisation structure will appear after setup data loads.';
      target.append(note);
      return;
    }
    const tenant = String(data.tenantId || '');
    const positions = data.positions.filter((p) => String(p.tenant_id) === tenant && norm(p.status || 'active') === 'active');
    const byId = new Map(positions.map((p) => [String(p.id), p]));
    const deptNames = new Map((data.departments || []).map((d) => [String(d.id), d.department_name]));
    const configured = new Map((data.links || []).filter((l) => String(l.tenant_id) === tenant)
      .map((l) => [String(l.job_title_id), String(l.reports_to_job_title_id || '')]));
    const children = new Map();
    const rootIds = [];
    const missing = [];
    for (const p of positions) {
      const id = String(p.id);
      if (!configured.has(id)) { missing.push(p); continue; }
      const parent = configured.get(id);
      if (!parent || !byId.has(parent)) { rootIds.push(id); continue; }
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    }
    const sorter = (a, b) => norm(byId.get(a)?.job_title).localeCompare(norm(byId.get(b)?.job_title));
    for (const row of children.values()) row.sort(sorter);
    rootIds.sort(sorter);
    const list = document.createElement('ul');
    list.className = 'bexhr-rs-chart-tree';
    const seen = new Set();
    function appendPosition(id, host, ancestors) {
      if (seen.has(id) || ancestors.has(id)) return;
      seen.add(id);
      const p = byId.get(id);
      if (!p) return;
      const li = document.createElement('li');
      const label = document.createElement('div');
      label.className = 'bexhr-rs-chart-position';
      const strong = document.createElement('strong');
      strong.textContent = p.job_title || 'Unnamed position';
      const small = document.createElement('small');
      small.textContent = p.department_id ? deptNames.get(String(p.department_id)) || 'Department' : 'Whole organisation';
      label.append(strong, small);
      li.append(label);
      const descendants = children.get(id) || [];
      if (descendants.length) {
        const ul = document.createElement('ul');
        for (const child of descendants) appendPosition(child, ul, new Set([...ancestors, id]));
        li.append(ul);
      }
      host.append(li);
    }
    for (const id of rootIds) appendPosition(id, list, new Set());
    // Never discard a disconnected/corrupt configured record silently.
    for (const id of configured.keys()) if (byId.has(id) && !seen.has(id)) appendPosition(id, list, new Set());
    if (list.children.length) target.append(list);
    else {
      const blank = document.createElement('p');
      blank.textContent = 'No reporting relationships have been saved.';
      target.append(blank);
    }
    if (missing.length) {
      const note = document.createElement('p');
      note.className = 'small text-secondary mt-3';
      note.textContent = `${missing.length} position(s) are not yet configured and are not shown in the reporting chart.`;
      target.append(note);
    }
  }

  function filterSupervisorChoices() {
    if (rejectedSupervisorPositions.size === 0) return;
    for (const id of ['bexhrH6CParent', 'organizationJobTitleReportsTo']) {
      const select = get(id);
      if (!select) continue;
      let changed = false;
      for (const option of Array.from(select.options)) {
        if (rejectedSupervisorPositions.has(String(option.value))) {
          option.remove();
          changed = true;
        }
      }
      if (changed && rejectedSupervisorPositions.has(String(select.value))) select.value = '';
    }
  }

  async function refreshSupervisorPositions() {
    const snapshot = latestSnapshot;
    const serial = ++rosterRequestNumber;
    if (!snapshot || !window.supabaseClient || !snapshot.tenantId) return;
    try {
      // Read-only, tenant-filtered roster. No employee identity is displayed by this helper.
      const { data, error } = await window.supabaseClient.from('employees')
        .select('tenant_id,job_title,department,system_role,status')
        .eq('tenant_id', snapshot.tenantId);
      if (serial !== rosterRequestNumber || snapshot !== latestSnapshot) return;
      if (error || !Array.isArray(data)) {
        console.warn('Reporting Structure: supervisor-role filter unavailable; backend approval checks remain enforced.', error?.message);
        return;
      }
      const deptNames = new Map((snapshot.departments || []).map((d) => [String(d.id), norm(d.department_name)]));
      const nextRejected = new Set();
      for (const pos of snapshot.positions || []) {
        if (String(pos.tenant_id) !== String(snapshot.tenantId)) continue;
        const title = norm(pos.job_title);
        if (!title) continue;
        const department = pos.department_id ? deptNames.get(String(pos.department_id)) : '';
        // As in the backend's title resolver, an exact departmental position
        // takes precedence over a same-named company-wide position.
        const matches = data.filter((person) => {
          if (norm(person.status || 'active') !== 'active' || norm(person.job_title) !== title) return false;
          if (pos.department_id) return norm(person.department) === department;
          return !(snapshot.positions || []).some((other) => other.id !== pos.id &&
            norm(other.job_title) === title && other.department_id &&
            deptNames.get(String(other.department_id)) === norm(person.department));
        });
        // A position occupied ONLY by ordinary Employee-role people cannot
        // be chosen as a supervisor. Vacant executive/manager positions stay available.
        if (matches.length > 0 && matches.every((p) =>
          !['manager', 'hr', 'hr_manager'].includes(norm(p.system_role)))) {
          nextRejected.add(String(pos.id));
        }
      }
      rejectedSupervisorPositions = nextRejected;
      filterSupervisorChoices();
      if (structure) {
        const hint = structure.roleHint;
        hint.textContent = nextRejected.size
          ? `${nextRejected.size} position(s) occupied only by regular employees are excluded from supervisor choices.`
          : 'Only authorised users occupying supervising positions can act as Primary Managers.';
      }
    } catch (error) {
      console.warn('Reporting Structure: read-only role filter failed; backend rules remain authoritative.', error);
    }
  }

  function mount() {
    if (structure) return true;
    const shell = get('hrOrganizationInternalWorkspace');
    if (!shell || shell.dataset.organizationWorkspaceComplete !== 'true' ||
        typeof window.hrOpenOrganizationSetupPanel !== 'function') return false;
    const switcher = shell.querySelector(':scope > .hr-setup-internal-switcher');
    const panelHost = shell.querySelector(':scope > .hr-setup-internal-panel-host');
    if (!switcher || !panelHost) return false;
    const tabFor = (key) => switcher.querySelector(`[data-hr-setup-workspace-button="${key}"]`);
    const panels = (key) => panelHost.querySelector(`[data-hr-setup-workspace-panel="${key}"]`);
    const org = tabFor('organization');
    const groupTab = tabFor('departments');
    const titles = tabFor('jobTitles');
    const reporting = tabFor('reportingLines');
    if (!org || !groupTab || !titles || !reporting ||
        !panels('departments') || !panels('jobTitles') || !panels('reportingLines')) return false;

    const styling = document.createElement('style');
    styling.id = 'bexhrStagingReportingStructureStyle';
    styling.textContent = `
      #hrOrganizationInternalWorkspace > .hr-setup-internal-switcher { display:flex; flex-wrap:wrap; gap:8px; }
      #hrOrganizationInternalWorkspace > .hr-setup-internal-switcher > .hr-setup-internal-tab:not([hidden]) { flex:1 1 190px; }
      #hrOrganizationInternalWorkspace [hidden] { display:none !important; }
      .bexhr-rs-explanation { margin:14px 0 12px; color:#526579; font-size:0.92rem; }
      .bexhr-rs-step-nav { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 18px; }
      .bexhr-rs-step { border:1px solid #b8d7d8; border-radius:10px; padding:10px 14px; background:#fff;
        color:#315165; font-weight:650; cursor:pointer; }
      .bexhr-rs-step.active { background:#e1f7f4; border-color:#1baea9; color:#086e6b; }
      .bexhr-rs-chart-panel { padding:18px 12px 12px; border-top:1px solid #dbe6eb; }
      .bexhr-rs-chart-tree, .bexhr-rs-chart-tree ul { list-style:none; margin:0; padding:0 0 0 20px; }
      .bexhr-rs-chart-tree ul { margin:0 0 0 12px; border-left:1px solid #c0d8dc; }
      .bexhr-rs-chart-tree li { padding:7px 0 4px 14px; }
      .bexhr-rs-chart-position { display:inline-flex; flex-direction:column; gap:4px; padding:10px 13px;
        background:#edf8f7; border:1px solid #b8dedb; border-radius:10px; min-width:195px; max-width:100%; }
      .bexhr-rs-chart-position strong { color:#15354c; }
      .bexhr-rs-chart-position small { color:#667e8e; }
    `;
    document.head.append(styling);

    const label = groupTab.querySelector('span');
    if (label) label.textContent = 'Reporting Structure';
    groupTab.setAttribute('aria-label', 'Reporting Structure: departments, job titles, reporting lines, chart');
    for (const tab of [titles, reporting]) {
      tab.hidden = true;
      tab.style.display = 'none';
      tab.setAttribute('aria-hidden', 'true');
      tab.tabIndex = -1;
    }

    const nav = document.createElement('nav');
    nav.id = 'bexhrStagingReportingSteps';
    nav.className = 'bexhr-rs-step-nav';
    nav.setAttribute('aria-label', 'Reporting Structure sections');
    nav.hidden = true;
    const steps = [
      ['departments', '1. Departments'],
      ['jobTitles', '2. Job titles'],
      ['reportingLines', '3. Reporting lines'],
      ['chart', '4. Organisation chart'],
    ];
    const stepButtons = new Map();
    for (const [key, caption] of steps) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bexhr-rs-step';
      button.dataset.reportingStep = key;
      button.textContent = caption;
      button.addEventListener('click', () => navigate(key));
      nav.append(button);
      stepButtons.set(key, button);
    }

    const explanation = document.createElement('p');
    explanation.className = 'bexhr-rs-explanation';
    explanation.textContent = "Create departments, add job titles, then set who reports to whom. To change one employee's manager, use People > Employee Directory.";
    const hint = document.createElement('p');
    hint.id = 'bexhrRsManagerRoleHint';
    hint.className = 'small text-secondary mb-2';
    hint.textContent = 'Regular employees cannot become supervisors just because they have a job title.';
    const chart = document.createElement('section');
    chart.id = 'bexhrStagingHierarchyChart';
    chart.className = 'bexhr-rs-chart-panel';
    chart.hidden = true;
    const chartTitle = document.createElement('h3');
    chartTitle.className = 'h5 fw-bold';
    chartTitle.textContent = 'Saved organisation chart';
    const chartHelp = document.createElement('p');
    chartHelp.className = 'small text-secondary';
    chartHelp.textContent = 'Read-only position chart. Personal Primary/Secondary Manager assignments are managed separately in People.';
    const chartContent = document.createElement('div');
    chart.append(chartTitle, chartHelp, chartContent);

    shell.insertBefore(explanation, panelHost);
    shell.insertBefore(nav, panelHost);
    shell.insertBefore(hint, panelHost);
    panelHost.append(chart);

    const originalOpen = window.hrOpenOrganizationSetupPanel;
    let chartSelected = false;
    structure = { shell, nav, chart, chartContent, roleHint: hint, stepButtons };
    function activeKey() { return String(shell.dataset.activePanel || ''); }
    function showSelection() {
      const active = activeKey();
      const inGroup = GROUP.has(active);
      nav.hidden = !inGroup;
      explanation.hidden = !inGroup;
      hint.hidden = !inGroup;
      groupTab.classList.toggle('active', inGroup);
      groupTab.setAttribute('aria-selected', String(inGroup));
      groupTab.tabIndex = inGroup ? 0 : -1;
      titles.setAttribute('aria-selected', 'false');
      reporting.setAttribute('aria-selected', 'false');
      const currentStep = chartSelected && active === 'reportingLines' ? 'chart' : active;
      for (const [key, button] of stepButtons) {
        const selected = inGroup && key === currentStep;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-current', selected ? 'step' : 'false');
      }
      chart.hidden = !(inGroup && currentStep === 'chart');
      const reportingPanel = panels('reportingLines');
      if (chart.hidden) {
        // When re-entering the Reporting Lines section, restore the original panel.
        if (active === 'reportingLines') {
          reportingPanel.hidden = false;
          reportingPanel.classList.remove('d-none');
        }
      } else {
        reportingPanel.hidden = true;
        reportingPanel.classList.add('d-none');
      }
    }
    function navigate(key) {
      chartSelected = key === 'chart';
      const source = key === 'chart' ? 'reportingLines' : key;
      originalOpen(source, { focus: false });
      if (chartSelected) renderChart();
      showSelection();
      // Avoid forced scroll to the top of the entire HR dashboard.
      nav.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    window.hrOpenOrganizationSetupPanel = function (key, options) {
      chartSelected = false;
      const result = originalOpen(key, options);
      showSelection();
      return result;
    };
    groupTab.addEventListener('click', () => { chartSelected = false; queueMicrotask(showSelection); });
    org.addEventListener('click', () => { chartSelected = false; queueMicrotask(showSelection); });
    const audit = tabFor('auditHistory');
    if (audit) audit.addEventListener('click', () => { chartSelected = false; queueMicrotask(showSelection); });

    // Existing keyboard handling counts hidden tabs; restrict it to visible tabs.
    switcher.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const current = event.target.closest('[data-hr-setup-workspace-button]');
      if (!current || current.hidden) return;
      const visible = [org, groupTab, audit].filter(Boolean);
      let ix = visible.indexOf(current);
      if (ix < 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowLeft') ix = (ix + visible.length - 1) % visible.length;
      else if (event.key === 'ArrowRight') ix = (ix + 1) % visible.length;
      else if (event.key === 'Home') ix = 0;
      else ix = visible.length - 1;
      visible[ix].click();
      visible[ix].focus();
    }, true);
    new MutationObserver(showSelection).observe(shell, { attributes: true, attributeFilter: ['data-active-panel'] });

    const child = get('bexhrH6CChild');
    child?.addEventListener('change', () => setTimeout(filterSupervisorChoices, 0));
    for (const name of ['bexhrH6CParent', 'organizationJobTitleReportsTo']) {
      const select = get(name);
      if (select) new MutationObserver(filterSupervisorChoices).observe(select, { childList: true });
    }
    showSelection();
    renderChart();
    refreshSupervisorPositions();
    return true;
  }

  // Do not alter the original setup fetch, save, or refresh. The event is read-only.
  window.addEventListener('bexhr:organization-setup-updated', (event) => {
    latestSnapshot = event?.detail?.loaded ? event.detail.hierarchyPreview : null;
    rejectedSupervisorPositions = new Set();
    renderChart();
    refreshSupervisorPositions();
  });
  function waitForOriginalWorkspace() {
    if (mount()) return;
    let rounds = 0;
    const timer = setInterval(() => {
      if (mount() || ++rounds >= 200) {
        clearInterval(timer);
        if (!structure && rounds >= 200) console.warn('Reporting Structure: original setup workspace was not ready. No changes made.');
      }
    }, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForOriginalWorkspace, { once: true });
  } else waitForOriginalWorkspace();
})();
