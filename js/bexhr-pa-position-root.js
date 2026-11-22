/* BexHR Phase 7B: PA read-only explicit-root recognition.
 * Uses the tenant's configured position IDs and parent links, never CEO/COO
 * spelling, department emptiness, or the person's application role.
 * This is display/filter logic only; database appraisal-route snapshots remain
 * authoritative for review and approval permissions.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRPaPositionRoot = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const getId = (x) => String(x == null ? '' : x).trim();
  const norm = (x) => getId(x).toLowerCase().replace(/\s+/g, ' ');

  function isExplicitRoot({
    tenantId, person, positions, links, departments = [],
    loaded = false, positionsError = false, hierarchyError = false,
  } = {}) {
    const tenant = getId(tenantId);
    if (!tenant || !loaded || positionsError || hierarchyError ||
        !person || !getId(person.id) ||
        !Array.isArray(positions) || !Array.isArray(links) ||
        !Array.isArray(departments)) return false;
    if (getId(person.tenant_id || person.tenantId) &&
        getId(person.tenant_id || person.tenantId) !== tenant) return false;
    const core = root && root.BexHROrganizationHierarchy;
    if (!core || typeof core.createModel !== 'function') return false;

    const jobTitle = getId(person.jobTitle || person.job_title);
    const explicitPositionId = getId(
      person.organizationJobTitleId || person.organization_job_title_id ||
      person.jobTitleId || person.job_title_id
    );
    if (!jobTitle && !explicitPositionId) return false;

    // The source queries in PA are restricted to this tenant; they omit the
    // tenant_id column. Only fill absent IDs, never override a different ID.
    const scopedPositions = positions.map((position) => ({
      ...position,
      tenant_id: position && position.tenant_id != null
        ? position.tenant_id : tenant,
    }));
    const scopedLinks = links.map((link) => ({
      ...link,
      tenant_id: link && link.tenant_id != null ? link.tenant_id : tenant,
    }));
    const scopedDepartments = departments.map((department) => ({
      ...department,
      tenant_id: department && department.tenant_id != null
        ? department.tenant_id : tenant,
    }));
    const departmentId = getId(person.departmentId || person.department_id);
    const departmentName = getId(person.department);

    // If there are same-named departmental positions but no unambiguous
    // department match, do not assume the whole-company position. Avoids
    // treating a departmental employee as a top-level executive by title.
    if (!explicitPositionId && (departmentId || departmentName)) {
      const sameNamedDepartmentPositions = scopedPositions.filter((position) =>
        norm(position && position.job_title) === norm(jobTitle) &&
        getId(position && position.department_id) &&
        getId(position.tenant_id) === tenant
      );
      if (sameNamedDepartmentPositions.length) {
        const exactMatches = sameNamedDepartmentPositions.filter((position) => {
          if (departmentId) return getId(position.department_id) === departmentId;
          const department = scopedDepartments.find((row) =>
            getId(row && row.id) === getId(position.department_id)
          );
          return Boolean(departmentName &&
            norm(department && (department.department_name || department.name)) ===
              norm(departmentName));
        });
        if (exactMatches.length !== 1) return false;
      }
    }

    try {
      const employee = {
        id: getId(person.id),
        tenant_id: tenant,
        status: person.status || 'Active',
        job_title: jobTitle,
        department: departmentName,
        department_id: departmentId,
        organization_job_title_id: explicitPositionId,
      };
      const model = core.createModel({
        tenantId: tenant,
        positions: scopedPositions,
        links: scopedLinks,
        employees: [employee],
        departments: scopedDepartments,
      });
      const resolved = model.resolvePosition(employee);
      if (resolved.code !== 'OK') return false;
      const ancestry = model.walkAncestors(resolved.position.id);
      return ancestry.code === 'OK' && ancestry.isConfiguredRoot === true;
    } catch (_) {
      // PA must never invent top-level status when catalogue data is broken.
      return false;
    }
  }

  return Object.freeze({ isExplicitRoot });
});
