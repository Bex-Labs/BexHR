/* BexHR Phase 7B: position-aware Primary / Secondary Manager candidate checks.
 * Structural decision only; existing HR role, auth, RLS and reporting-line RPC
 * remain authoritative for writes and approvals. NEVER updates employee records.
 * Only the exact configured child position invokes strict position ancestry.
 * Unconfigured departmental positions keep the existing default role rules
 * even after the capability is installed; a configured or ambiguous position
 * never gets a silent legacy fallback.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRReportingPositionEligibility = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const id = (value) => String(value == null ? '' : value).trim();
  const norm = (value) => id(value).toLowerCase().replace(/\s+/g, ' ');
  const result = (mode, allowed, reason) => Object.freeze({ mode, allowed, reason });

  function evaluate({
    kind = 'primary', tenantId, employee, manager, employees = [],
    positions = [], links = [], departments = [], loaded = false,
    departmentReportingEnabled = false, hierarchyCore,
  } = {}) {
    const tenant = id(tenantId);
    const employeeId = id(employee?.id) || '__bexhr_draft_employee__';
    const managerId = id(manager?.id);
    if (!tenant || !managerId || managerId === employeeId ||
        (employee?.tenant_id && id(employee.tenant_id) !== tenant) ||
        id(manager?.tenant_id) !== tenant) {
      return result('blocked', false, 'OUTSIDE_TENANT_OR_SELF');
    }
    // H2: Position determines reporting order; the existing application role
    // still determines whether the candidate may exercise management rights.
    // The backend configured-Primary validator applies the identical role set.
    if (!['manager', 'hr', 'hr_manager'].includes(norm(manager?.system_role))) {
      return result('blocked', false, 'MANAGER_ROLE_NOT_ENABLED');
    }
    if (!loaded || !Array.isArray(employees) || !Array.isArray(positions) ||
        !Array.isArray(links) || !Array.isArray(departments)) {
      return result('blocked', false, 'HIERARCHY_NOT_LOADED');
    }
    // Manager must already be in the current tenant's loaded employee roster.
    // A stale or injected candidate must never create a fictitious occupant.
    if (!employees.some((person) =>
      id(person?.id) === managerId && id(person?.tenant_id) === tenant &&
      norm(person?.status || 'active') === 'active',
    )) return result('blocked', false, 'MANAGER_NOT_IN_CURRENT_ROSTER');
    const core = hierarchyCore || root?.BexHROrganizationHierarchy;
    if (!core || typeof core.createModel !== 'function') {
      return result('blocked', false, 'HIERARCHY_ENGINE_MISSING');
    }
    const candidate = { ...manager, tenant_id: tenant };
    const target = { ...employee, id: employeeId, tenant_id: tenant };
    const team = employees.filter((person) =>
      id(person?.id) !== employeeId && id(person?.id) !== managerId,
    );
    team.push(target, candidate);

    try {
      const model = core.createModel({
        tenantId: tenant, positions, links, departments, employees: team,
      });
      const resolved = model.resolvePosition(target);
      if (resolved.code !== 'OK') {
        // A configured hierarchy can never silently turn an invalid or
        // ambiguous employee title into an allowed legacy assignment.
        if (id(target.organization_job_title_id || target.job_title_id) ||
            resolved.code !== 'POSITION_NOT_CONFIGURED' ||
            !id(target.department_id || target.department)) {
          return result('blocked', false, resolved.code);
        }
        // Backend rollout enables configuration, not a global ban on default
        // departmental reporting. Only an unconfigured department falls back.
        return result('legacy', false, 'DEPARTMENT_NOT_YET_CONFIGURED');
      }
      const targetPositionId = id(resolved.position.id);
      const hasLink = links.some((row) =>
        id(row?.tenant_id) === tenant &&
        id(row?.job_title_id) === targetPositionId,
      );
      if (!hasLink) {
        // A configured hierarchy wins over default rules. An unconfigured
        // department retains its old role-based rules until HR configures it.
        // Whole-company positions require an explicit configured root/parent.
        if (!id(resolved.position.department_id)) {
          return result('blocked', false, 'POSITION_NOT_CONFIGURED');
        }
        return result('legacy', false, 'DEPARTMENT_NOT_YET_CONFIGURED');
      }
      if (model.issues.some((issue) =>
        id(issue.positionId) === targetPositionId &&
        issue.code === 'DUPLICATE_POSITION_LINK',
      )) return result('blocked', false, 'AMBIGUOUS_POSITION_LINK');

      const ancestry = model.walkAncestors(targetPositionId);
      if (ancestry.code !== 'OK') return result('blocked', false, ancestry.code);
      if (ancestry.isConfiguredRoot) {
        return result('configured', false, 'TOP_LEVEL_HAS_NO_MANAGERS');
      }
      const resolvedManager = model.resolvePosition(candidate);
      if (resolvedManager.code !== 'OK') {
        return result('configured', false, 'MANAGER_' + resolvedManager.code);
      }
      const managerPositionId = id(resolvedManager.position.id);
      const isAncestor = ancestry.ancestors.some((ancestor) =>
        id(ancestor.id) === managerPositionId,
      );
      if (!isAncestor) {
        return result('configured', false, 'NOT_AN_ANCESTOR_POSITION');
      }
      // Secondary managers supplement the direct reporting chain; they do not
      // become a second formal parent or gain Primary decision rights.
      if (norm(kind) === 'secondary') {
        return result('configured', true, 'CONFIGURED_ANCESTOR');
      }
      const nearest = model.nearestOccupiedAncestor(employeeId);
      const allowed = nearest.code === 'PARENT_OCCUPIED' &&
        nearest.occupants.some((person) => id(person.id) === managerId);
      return result('configured', allowed,
        allowed ? 'NEAREST_OCCUPIED_PARENT' : nearest.code === 'PARENT_OCCUPIED'
          ? 'NOT_NEAREST_OCCUPIED_PARENT' : nearest.code);
    } catch (_) {
      return result('blocked', false, 'HIERARCHY_RESOLUTION_FAILED');
    }
  }

  return Object.freeze({ evaluate });
});
