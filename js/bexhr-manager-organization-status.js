/* BexHR Phase 7B: manager no-team position label.
 * READ ONLY. Labels never confer roles, visibility, or decision authority.
 * Current position status comes exclusively from the tenant-checked Supabase RPC;
 * a missing RPC, missing link, or transient error displays a neutral fallback.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRManagerOrganizationStatus = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const valid = new Set(['CONFIGURED_ROOT', 'HIGHEST_OCCUPIED', 'HAS_OCCUPIED_PARENT', 'SETUP_NEEDED']);
  const generic = Object.freeze({
    label: 'Manager',
    description: 'No employees currently report directly to you. Your HR administrator can review reporting assignments.',
    decisionAuthority: 'A Primary Manager assignment is required for decisions',
    kind: 'default',
  });
  function sanitizeTitle(value) {
    const title = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
    return title && title.length <= 100 ? title : '';
  }
  function presentation(summary) {
    if (!summary || !valid.has(String(summary.status || ''))) return generic;
    const title = sanitizeTitle(summary.position_title);
    if (!title) return generic;
    if (summary.status === 'CONFIGURED_ROOT') {
      return Object.freeze({label: `${title} - Top level`,
        description: `${title} is the configured top-level position. No employees currently report directly to you.`,
        decisionAuthority: generic.decisionAuthority, kind: 'root'});
    }
    if (summary.status === 'HIGHEST_OCCUPIED') {
      return Object.freeze({label: `${title} - Highest active`,
        description: `${title} is the highest currently occupied position in its reporting chain. Higher configured positions may be vacant. No employees currently report directly to you.`,
        decisionAuthority: generic.decisionAuthority, kind: 'highest'});
    }
    if (summary.status === 'HAS_OCCUPIED_PARENT') {
      return Object.freeze({label: `${title} - No direct reports`,
        description: `Your ${title} position is in the configured reporting structure, but no employees currently report directly to you.`,
        decisionAuthority: generic.decisionAuthority, kind: 'parent'});
    }
    return Object.freeze({label: 'Reporting setup needed',
      description: 'Your position is not fully configured in your company reporting structure. Ask your HR administrator to review it.',
      decisionAuthority: generic.decisionAuthority, kind: 'incomplete'});
  }
  async function load(client, employeeId) {
    if (!client || typeof client.rpc !== 'function' || !String(employeeId || '').trim()) return null;
    try {
      const { data, error } = await client.rpc('bexhr_p7b_my_organization_position', {
        p_employee_id: employeeId,
      });
      if (error || !data || typeof data !== 'object' || !valid.has(data.status)) return null;
      return Object.freeze({ status: data.status, position_title: sanitizeTitle(data.position_title) });
    } catch (_error) {
      // Do not sign out or claim organizational authority on network failures.
      return null;
    }
  }
  return Object.freeze({ presentation, load });
});
