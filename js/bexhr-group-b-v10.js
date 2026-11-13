/* BexHR Group B V10: read-only position-scope presentation and new-hire role suggestion.
 * No database writes, dashboard authorisation, manager reassignment, or position mutation.
 */
(function (root) {
  'use strict';
  const id = (value) => String(value == null ? '' : value).trim();
  const norm = (value) => id(value).toLowerCase().replace(/\s+/g, ' ');
  const active = (row) => norm(row?.status || 'active') === 'active';

  function matchingPositions(jobTitle, tenantId, positions) {
    const title = norm(jobTitle);
    const tenant = id(tenantId);
    if (!title || !tenant || !Array.isArray(positions)) return [];
    return positions.filter((row) =>
      id(row?.tenant_id) === tenant &&
      active(row) && norm(row?.job_title) === title
    );
  }

  // Text-only employee records are not bound to a position UUID. A sole,
  // tenant-owned matching position is unambiguous; duplicates require review.
  function resolveEmployeeScope(employee = {}, context = {}) {
    const savedDepartment = id(employee.department);
    const fallback = {
      label: savedDepartment || 'No department',
      kind: 'saved', needsReview: false,
    };
    const tenant = id(context.tenantId);
    if (!context.loaded || !tenant || id(employee.tenant_id) !== tenant) return fallback;
    const matches = matchingPositions(employee.job_title, tenant, context.positions);
    if (matches.length === 1) {
      if (!id(matches[0].department_id)) {
        return { label: 'Whole organisation', kind: 'whole', needsReview: false };
      }
      return { ...fallback, kind: 'department' };
    }
    if (matches.length > 1 && matches.some((row) => !id(row.department_id))) {
      return { ...fallback, kind: 'ambiguous', needsReview: true };
    }
    return fallback;
  }

  // A company-wide position is suggested as Manager only where the actual
  // position tree identifies a leader: a root or a position with direct reports.
  // No CEO/COO/Director title strings or blanket Whole-organisation promotion.
  function isConfiguredLeadershipPosition(context = {}) {
    const tenant = id(context.tenantId);
    if (!context.loaded || !tenant || !context.isWholeOrganisation) return false;
    const matches = matchingPositions(context.jobTitle, tenant, context.positions);
    if (matches.length !== 1 || id(matches[0].department_id)) return false;
    const positionId = id(matches[0].id);
    const tenantLinks = (Array.isArray(context.links) ? context.links : [])
      .filter((row) => id(row?.tenant_id) === tenant);
    const ownLinks = tenantLinks.filter((row) => id(row?.job_title_id) === positionId);
    if (ownLinks.length !== 1) return false;
    const isRoot = !id(ownLinks[0].reports_to_job_title_id);
    const hasDirectReports = tenantLinks.some((row) =>
      id(row?.reports_to_job_title_id) === positionId
    );
    return isRoot || hasDirectReports;
  }

  root.BexHrGroupBV10 = Object.freeze({ resolveEmployeeScope, isConfiguredLeadershipPosition });
})(window);
