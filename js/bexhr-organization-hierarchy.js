/* BexHR Phase 7B: shared, pure, tenant-scoped organisation-structure model.
 * One organisational position is NOT a Supabase login role and does NOT grant permissions.
 * This module does not mutate any records, infer authority, or request private data.
 * Consumers pass only rows already authorised for that workspace.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHROrganizationHierarchy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const id = (v) => String(v ?? '').trim();
  const active = (record) => !['inactive', 'exited', 'terminated', 'deleted'].includes(norm(record?.status || 'active'));
  const status = (code, more = {}) => Object.freeze({ code, ...more });

  function createModel({ tenantId, positions = [], links = [], employees = [], departments = [] } = {}) {
    const tenant = id(tenantId);
    if (!tenant) throw new Error('Tenant ID required: reporting must never use a global fallback');
    const issues = [];
    const seen = new Set();
    const tenantPositions = [];
    for (const position of positions) {
      if (!position || !id(position.id) || !active(position)) continue;
      if (id(position.tenant_id) && id(position.tenant_id) !== tenant) continue;
      if (seen.has(id(position.id))) {
        issues.push(status('DUPLICATE_POSITION_ID', { positionId: id(position.id) }));
        continue;
      }
      seen.add(id(position.id));
      tenantPositions.push(position);
    }
    const positionById = new Map(tenantPositions.map((p) => [id(p.id), p]));
    const tenantLinks = links.filter((link) => id(link?.tenant_id) === tenant);
    const parentById = new Map();
    for (const link of tenantLinks) {
      const childId = id(link?.job_title_id);
      const parentId = id(link?.reports_to_job_title_id);
      if (!childId || !positionById.has(childId)) {
        issues.push(status('UNKNOWN_CHILD_POSITION', { positionId: childId }));
        continue;
      }
      if (parentById.has(childId)) {
        issues.push(status('DUPLICATE_POSITION_LINK', { positionId: childId }));
        continue;
      }
      parentById.set(childId, parentId);
      if (parentId && !positionById.has(parentId)) {
        issues.push(status('UNKNOWN_PARENT_POSITION', { positionId: childId, parentId }));
      }
    }
    const departmentById = new Map(departments.filter((d) => !id(d.tenant_id) || id(d.tenant_id) === tenant).map((d) => [id(d.id), d]));
    const employeeById = new Map();
    for (const person of employees) {
      if (id(person?.tenant_id) !== tenant || !id(person?.id) || !active(person)) continue;
      employeeById.set(id(person.id), person);
    }

    function resolvePosition(person) {
      if (!person || id(person.tenant_id) !== tenant || !active(person)) return status('OUTSIDE_TENANT_OR_INACTIVE');
      const explicit = id(person.organization_job_title_id || person.job_title_id);
      if (explicit) {
        return positionById.has(explicit)
          ? status('OK', { position: positionById.get(explicit) })
          : status('UNRECOGNISED_POSITION_ID');
      }
      const title = norm(person.job_title);
      if (!title) return status('POSITION_MISSING');
      let candidates = tenantPositions.filter((p) => norm(p.job_title) === title);
      const namedDepartment = norm(person.department);
      const departmentId = id(person.department_id);
      const exactDepartment = candidates.filter((p) => {
        const pid = id(p.department_id);
        if (!pid) return false;
        if (departmentId) return pid === departmentId;
        const dept = departmentById.get(pid);
        return Boolean(namedDepartment && norm(dept?.department_name || dept?.name) === namedDepartment);
      });
      // Specific department positions take precedence over a whole-company label.
      // Whole-organisation occupants are NOT required to have a blank department.
      if (exactDepartment.length) candidates = exactDepartment;
      else candidates = candidates.filter((p) => !id(p.department_id));
      const tenantOwned = candidates.filter((p) => id(p.tenant_id) === tenant);
      if (tenantOwned.length) candidates = tenantOwned;
      if (candidates.length === 0) return status('POSITION_NOT_CONFIGURED');
      if (candidates.length !== 1) return status('AMBIGUOUS_POSITION');
      return status('OK', { position: candidates[0] });
    }

    function walkAncestors(positionId) {
      const current = id(positionId);
      if (!positionById.has(current)) return status('UNKNOWN_POSITION');
      if (!parentById.has(current)) return status('POSITION_NOT_CONFIGURED');
      const chain = [];
      const visited = new Set([current]);
      let next = parentById.get(current);
      while (next) {
        if (visited.has(next)) return status('POSITION_CYCLE', { positionId: current });
        if (!positionById.has(next) || !parentById.has(next)) return status('ANCESTOR_NOT_CONFIGURED', { positionId: next });
        chain.push(positionById.get(next));
        visited.add(next);
        next = parentById.get(next);
      }
      return status('OK', { ancestors: chain, isConfiguredRoot: chain.length === 0 });
    }

    function occupants(positionId) {
      const matches = [];
      for (const employee of employeeById.values()) {
        const result = resolvePosition(employee);
        if (result.code === 'OK' && id(result.position.id) === id(positionId)) matches.push(employee);
      }
      return matches;
    }

    function nearestOccupiedAncestor(employeeId) {
      const person = employeeById.get(id(employeeId));
      if (!person) return status('EMPLOYEE_NOT_FOUND');
      const resolved = resolvePosition(person);
      if (resolved.code !== 'OK') return resolved;
      const ancestors = walkAncestors(resolved.position.id);
      if (ancestors.code !== 'OK') return ancestors;
      for (const position of ancestors.ancestors) {
        const found = occupants(position.id);
        if (found.length) return status('PARENT_OCCUPIED', { position, occupants: found });
      }
      return status(ancestors.isConfiguredRoot ? 'CONFIGURED_ROOT' : 'HIGHEST_OCCUPIED', { position: resolved.position });
    }

    // Structural eligibility only: separate server authorisation still decides
    // whether the candidate may receive management/approval permissions.
    function primaryPositionEligibility(employeeId, managerEmployeeId) {
      if (!employeeId || !managerEmployeeId || id(employeeId) === id(managerEmployeeId)) return status('SELF_OR_MISSING');
      const child = employeeById.get(id(employeeId));
      const manager = employeeById.get(id(managerEmployeeId));
      if (!child || !manager) return status('OUTSIDE_TENANT_OR_INACTIVE');
      const expected = nearestOccupiedAncestor(employeeId);
      if (expected.code !== 'PARENT_OCCUPIED') return expected;
      return expected.occupants.some((p) => id(p.id) === id(managerEmployeeId))
        ? status('ELIGIBLE', { position: expected.position })
        : status('WRONG_PARENT_POSITION', { position: expected.position });
    }

    function inspectPrimaryLines(reportingLines = []) {
      const primary = reportingLines.filter((r) =>
        norm(r.manager_type) === 'primary' && active(r) && id(r.tenant_id) === tenant,
      );
      const perEmployee = new Map();
      for (const row of primary) {
        const child = id(row.employee_id);
        if (!perEmployee.has(child)) perEmployee.set(child, []);
        perEmployee.get(child).push(row);
      }
      const findings = [];
      for (const [child, rows] of perEmployee) {
        if (rows.length > 1) findings.push(status('MULTIPLE_PRIMARY', { employeeId: child, count: rows.length }));
        for (const row of rows) {
          const result = primaryPositionEligibility(child, row.manager_employee_id);
          if (result.code !== 'ELIGIBLE') findings.push(status('REPORTING_LINE_REVIEW', { employeeId: child, managerId: id(row.manager_employee_id), reason: result.code }));
        }
      }
      return findings;
    }

    for (const child of parentById.keys()) {
      const outcome = walkAncestors(child);
      if (outcome.code !== 'OK') issues.push(status(outcome.code, { positionId: child }));
    }
    return Object.freeze({ tenantId: tenant, positions: tenantPositions, issues, resolvePosition,
      walkAncestors, nearestOccupiedAncestor, occupants, primaryPositionEligibility, inspectPrimaryLines });
  }

  return Object.freeze({ createModel, norm });
});
