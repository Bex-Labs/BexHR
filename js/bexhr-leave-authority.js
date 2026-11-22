/* BexHR Phase 7B: leave decision and delegation presentation checks.
 * The database RPC is always the final decision authority. No client-side
 * relationship label, role, or organisational title grants approval rights.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRLeaveAuthority = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const normalize = value => String(value ?? '').trim().toLowerCase();

  function fromReadiness(readiness) {
    if (!readiness || typeof readiness !== 'object') return null;
    return {
      managerRelationshipLabel: `${String(readiness.manager_type || '').trim()} Manager`,
      canDecideLeaveRequest: readiness.can_decide === true,
      decisionAuthority: String(readiness.decision_authority || 'view_only'),
      activeDelegationId: readiness.delegation_id || null,
      delegationEndsAt: readiness.delegation_ends_at || null,
      employeeRecordId: readiness.canonical_employee_id || null,
    };
  }

  function canDecide(request = {}, now = Date.now()) {
    if (request?.canDecideLeaveRequest !== true) return false;
    const authority = normalize(request.decisionAuthority);
    const relationship = normalize(request.managerRelationshipLabel);

    if (authority === 'primary') {
      return relationship === 'primary manager' || relationship === 'primary';
    }
    if (authority !== 'delegated') return false;
    if (relationship !== 'secondary manager' && relationship !== 'secondary') return false;
    if (!String(request.activeDelegationId || '').trim()) return false;

    const expiry = Date.parse(String(request.delegationEndsAt || ''));
    return Number.isFinite(expiry) && expiry > now;
  }

  async function createIndividually(delegateIds = [], save) {
    if (!Array.isArray(delegateIds) || typeof save !== 'function') {
      throw new TypeError('Delegate IDs and the server save operation are required.');
    }
    const succeeded = [];
    const failed = [];
    for (const id of [...new Set(delegateIds.map(value => String(value || '').trim()))]) {
      if (!id) continue;
      try {
        await save(id);
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, message: String(error?.message || error || 'Unknown error') });
      }
    }
    return Object.freeze({ succeeded, failed });
  }

  return Object.freeze({ canDecide, fromReadiness, createIndividually });
});
