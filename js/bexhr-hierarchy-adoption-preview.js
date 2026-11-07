/* BexHR H6B: tenant-scoped, no-write legacy reporting adoption preview.
 * The HR Admin's saved employee reporting lines are evidence, never auto-applied
 * as position hierarchy links or overwritten by template guesses.
 * Only the existing HR Admin setup workspace may request the preview.
 * No data is fetched or written; SQL/PA/Leave authority remains held.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRHierarchyAdoptionPreview = api;
  if (root && root.document && root.addEventListener) {
    const initialize = () => api.mount(root);
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else initialize();
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const val = (value) => String(value == null ? '' : value).trim();
  const norm = (value) => val(value).replace(/\s+/g, ' ').toLowerCase();
  const active = (row) => !['inactive', 'exited', 'terminated', 'deleted'].includes(
    norm(row?.employment_status || row?.status || 'active'));
  const escapeHtml = (value) => val(value).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const friendlyDepartment = (employee) => val(employee?.department) || '(none / administrative)';
  const label = (value) => val(value) || '(not set)';
  const safeRole = (candidate) => ['manager', 'hr', 'hr_manager'].includes(norm(candidate?.system_role));

  function analyze({ tenantId, employees = [], reportingLines = [], positions = [], links = [],
    departments = [], positionLoaded = false, reportingLoaded = false, core } = {}) {
    const tenant = val(tenantId);
    if (!tenant || ![employees, reportingLines, positions, links, departments].every(Array.isArray)) {
      throw new Error('H6B_INVALID_TENANT_OR_DATA');
    }
    if (!positionLoaded || !reportingLoaded) {
      return Object.freeze({ ready: false, reason: 'Employee reporting or organisational setup has not fully loaded. Refresh People and Organisation Setup before reviewing.' });
    }
    if (!core || typeof core.createModel !== 'function') {
      return Object.freeze({ ready: false, reason: 'Position hierarchy model is unavailable. No adoption decisions can be made.' });
    }
    const ownEmployees = employees.filter((row) => val(row?.tenant_id) === tenant && val(row?.id) && active(row));
    const ownById = new Map(ownEmployees.map((row) => [val(row.id), row]));
    const ownPositions = positions.filter((row) => (!val(row?.tenant_id) || val(row.tenant_id) === tenant) && active(row));
    const ownLinks = links.filter((row) => val(row?.tenant_id) === tenant);
    const ownDepartments = departments.filter((row) => !val(row?.tenant_id) || val(row.tenant_id) === tenant);
    // Caller must supply tenant-tagged reporting rows. This prevents accidentally
    // reusing an unfiltered cached list or mixing tenants during a preview.
    const ownLines = reportingLines.filter((row) => val(row?.tenant_id) === tenant &&
      norm(row?.manager_type) === 'primary' && norm(row?.status || 'active') === 'active');
    const normalizedEmployees = ownEmployees.map((row) => ({ ...row, status: active(row) ? 'active' : 'inactive' }));
    const model = core.createModel({ tenantId: tenant, positions: ownPositions,
      links: ownLinks, employees: normalizedEmployees, departments: ownDepartments });
    const groups = new Map();
    const employeeGroup = new Map();
    const employeePosition = new Map();
    const positionById = new Map(ownPositions.map((row) => [val(row.id), row]));
    const departmentById = new Map(ownDepartments.map((row) => [val(row.id), row]));
    let unresolved = 0;
    let unconfigured = 0;
    let configured = 0;
    let legacyWholeWithDepartment = 0;
    const reasons = {};
    for (const employee of ownEmployees) {
      const position = model.resolvePosition(employee);
      let category = 'unresolved';
      let titleId = '';
      let positionName = val(employee.job_title) || '(no job title)';
      let displayDepartment = friendlyDepartment(employee);
      if (position.code === 'OK') {
        titleId = val(position.position.id);
        positionName = val(position.position.job_title) || positionName;
        const configuredResult = model.walkAncestors(titleId);
        category = configuredResult.code === 'OK' ? 'configured' : 'unconfigured';
        if (category === 'configured') configured++;
        else { unconfigured++; reasons[configuredResult.code] = (reasons[configuredResult.code] || 0) + 1; }
        if (!val(position.position.department_id) && (val(employee.department) || val(employee.department_id))) {
          legacyWholeWithDepartment++;
        }
        if (val(position.position.department_id)) {
          const dept = departmentById.get(val(position.position.department_id));
          displayDepartment = val(dept?.department_name || dept?.name) || displayDepartment;
        } else {
          displayDepartment = 'Whole organisation (employee department retained)';
        }
      } else {
        unresolved++;
        reasons[position.code] = (reasons[position.code] || 0) + 1;
      }
      const key = titleId ? `position:${titleId}` : `unresolved:${norm(positionName)}:${norm(displayDepartment)}`;
      if (!groups.has(key)) groups.set(key, {
        jobTitle: positionName, department: displayDepartment, category,
        employees: 0, primaryLines: 0, aligned: 0, awaitingConfiguration: 0,
        differingFromStandard: 0, managerRoleReview: 0, managerPositions: new Set(),
      });
      groups.get(key).employees++;
      employeeGroup.set(val(employee.id), key);
      employeePosition.set(val(employee.id), position);
    }
    let preservedPrimary = 0;
    let alignedPrimary = 0;
    let awaitingPrimary = 0;
    let differingPrimary = 0;
    let roleReview = 0;
    let missingActor = 0;
    let duplicatePrimary = 0;
    const primaryByChild = new Map();
    for (const row of ownLines) {
      preservedPrimary++;
      const childId = val(row.employee_id);
      const managerId = val(row.manager_employee_id);
      primaryByChild.set(childId, (primaryByChild.get(childId) || 0) + 1);
      const group = groups.get(employeeGroup.get(childId));
      const manager = ownById.get(managerId);
      const child = ownById.get(childId);
      if (!manager || !child || childId === managerId) missingActor++;
      if (group) {
        group.primaryLines++;
        if (manager) group.managerPositions.add(`${label(manager.job_title)} / ${friendlyDepartment(manager)}`);
      }
      if (manager && !safeRole(manager)) {
        roleReview++;
        if (group) group.managerRoleReview++;
      }
      let code = 'UNRESOLVED';
      if (child && manager) code = model.primaryPositionEligibility(childId, managerId).code;
      if (code === 'ELIGIBLE') {
        alignedPrimary++;
        if (group) group.aligned++;
      } else if (code === 'WRONG_PARENT_POSITION' || code === 'CONFIGURED_ROOT') {
        differingPrimary++;
        if (group) group.differingFromStandard++;
      } else {
        awaitingPrimary++;
        if (group) group.awaitingConfiguration++;
      }
    }
    for (const count of primaryByChild.values()) if (count > 1) duplicatePrimary += count - 1;
    // Summary is deliberately group-level; no names, emails, employee numbers
    // or profile IDs are rendered or exported by this module.
    const rows = [...groups.values()].map((group) => Object.freeze({
      ...group, managerPositions: [...group.managerPositions].sort(),
    })).sort((left, right) => left.department.localeCompare(right.department) ||
      left.jobTitle.localeCompare(right.jobTitle));
    return Object.freeze({ ready: true, tenantId: tenant,
      counts: Object.freeze({ activeEmployees: ownEmployees.length, configured, unconfigured,
        unresolved, legacyWholeWithDepartment, preservedPrimary, alignedPrimary,
        awaitingPrimary, differingPrimary, roleReview, missingActor, duplicatePrimary,
        unassignedEmployees: ownEmployees.length - primaryByChild.size,
        totalGroups: rows.length }),
      reasons: Object.freeze({ ...reasons }), rows: Object.freeze(rows),
    });
  }

  function render(target, review) {
    if (!target) return;
    target.hidden = false;
    if (!review?.ready) {
      target.textContent = review?.reason || 'Existing reporting preview is unavailable. No data was changed.';
      return;
    }
    const c = review.counts;
    const fields = [
      ['Employees', c.activeEmployees], ['Saved Primary lines', c.preservedPrimary],
      ['Configured positions', c.configured], ['Awaiting position setup', c.unconfigured],
      ['Unresolved titles', c.unresolved], ['Primary lines awaiting configuration', c.awaitingPrimary],
      ['Primary lines differing from configured chain', c.differingPrimary],
      ['Primary lines needing manager-role review', c.roleReview],
      ['Unassigned employees (preserved)', c.unassignedEmployees],
    ];
    const cards = fields.map(([name, count]) =>
      `<div class="rounded border p-2"><span class="small text-secondary d-block">${escapeHtml(name)}</span><strong>${count}</strong></div>`).join('');
    const body = review.rows.map((row) => {
      const state = row.category === 'configured' ? 'Position configured' :
        row.category === 'unconfigured' ? 'Position not linked' : 'Position cannot be matched';
      const managers = row.managerPositions.length ? row.managerPositions.join('; ') : '(no current Primary in this group)';
      return `<tr><td>${escapeHtml(row.jobTitle)}</td><td>${escapeHtml(row.department)}</td>` +
        `<td>${escapeHtml(state)}</td><td>${row.employees}</td><td>${row.primaryLines}</td>` +
        `<td>${escapeHtml(managers)}</td><td>${row.differingFromStandard ? 'Review exception' :
          row.awaitingConfiguration ? 'Needs position setup' : row.aligned ? 'Chain agrees' : 'No active Primary'}</td></tr>`;
    }).join('');
    target.innerHTML = `
      <div class="alert alert-info small mb-3">
        <strong>Read-only compatibility review.</strong> Existing HR assignments are preserved. Job-title setup does not
        change an employee's Primary Manager; a differing assignment may be intentional. HR Admin can correct an
        individual manager in People &rarr; Manage reporting managers. Position parents are edited separately in
        Organisation Setup after the backend reporting capability is enabled.
      </div>
      <div class="d-flex flex-wrap gap-2 mb-3">${cards}</div>
      <div class="small text-secondary mb-2">${c.legacyWholeWithDepartment} employees use a whole-organisation position while retaining administrative department metadata. No department change is required.</div>
      <div class="table-responsive" style="max-height:300px;overflow:auto"><table class="table table-sm align-middle">
        <thead><tr><th>Job position</th><th>Scope / department</th><th>Position status</th><th>Employees</th><th>Primary lines</th><th>Saved manager positions (not proposed changes)</th><th>Review</th></tr></thead>
        <tbody>${body || '<tr><td colspan="7">No active employee positions to review.</td></tr>'}</tbody>
      </table></div>
      <p class="small text-secondary mt-2 mb-0">No records, PA cycles, leave decisions or manager assignments were written. Refresh this preview after legitimate HR edits. This review does not grant new approval rights.</p>`;
  }

  function mount(root) {
    const panel = root.document.getElementById('bexhrHierarchyTemplateAssistant');
    if (!panel || panel.querySelector('#bexhrHierarchyAdoptionReviewButton')) return;
    const section = root.document.createElement('section');
    section.className = 'border-top mt-4 pt-3';
    section.setAttribute('aria-label', 'Existing company reporting compatibility review');
    section.innerHTML = '<h5 class="h6 fw-bold">Keep existing HR reporting</h5>' +
      '<p class="small text-secondary mb-2">Check how saved employee managers relate to the new positions before applying a template. This does not change anything.</p>' +
      '<button type="button" id="bexhrHierarchyAdoptionReviewButton" class="btn btn-outline-primary btn-sm" hidden disabled>Review existing reporting (read-only)</button>' +
      '<div id="bexhrHierarchyAdoptionResults" role="status" aria-live="polite" class="mt-3" hidden></div>';
    // Put the preservation check before template suggestions, so HR sees its
    // current approved reporting arrangements before reviewing any new chain.
    const templateControls = panel.querySelector('.row.g-2');
    if (templateControls && templateControls.parentNode === panel) {
      panel.insertBefore(section, templateControls);
    } else panel.appendChild(section);
    const button = section.querySelector('#bexhrHierarchyAdoptionReviewButton');
    const result = section.querySelector('#bexhrHierarchyAdoptionResults');
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const detail = event?.detail || {};
      const ready = detail.loaded === true && detail.canMaintain === true;
      button.hidden = !ready;
      button.disabled = !ready;
      result.hidden = true;
      result.textContent = '';
    });
    button.addEventListener('click', () => {
      result.hidden = false;
      result.textContent = 'Reviewing currently loaded employee and reporting records...';
      root.dispatchEvent(new Event('bexhr:h6b-adoption-review-request'));
    });
  }
  return Object.freeze({ analyze, render, mount });
});
