/* BexHR H7: guarded Reporting Lines Save, dormant until the verified P7B capability exists.
 * A separate, existing protected tenant-admin RPC writes the position link.
 * Does not update employees, Primary/Secondary lines, PA, Leave or system roles.
 * Existing H6C reviewer and H6E tab remain the source of the position proposal.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRReportingLinesSaveH7 = api;
  if (!root || !root.document || typeof root.addEventListener !== 'function') return;
  const start = () => api.mount(root);
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const value = (v) => String(v == null ? '' : v).trim();
  const TOP = '__top_level__';
  const DENIED = 'This reporting line is not ready to save. Review the change again.';

  function normalizeSnapshot(s) {
    if (!s || !value(s.tenantId) || !Array.isArray(s.positions) ||
        !Array.isArray(s.links) || !Array.isArray(s.departments)) return null;
    const tenant = value(s.tenantId);
    const records = (rows, columns) => rows.filter((r) => value(r?.tenant_id) === tenant)
      .map((r) => columns.map((k) => value(r[k])).join('\u001f'))
      .sort();
    return JSON.stringify({
      tenant,
      positions: records(s.positions, ['id', 'tenant_id', 'department_id', 'job_title', 'status']),
      departments: records(s.departments, ['id', 'tenant_id', 'department_name']),
      links: records(s.links, ['tenant_id', 'job_title_id', 'reports_to_job_title_id']),
    });
  }
  function reviewedMatch(reviewed, current, fresh) {
    if (!reviewed || !reviewed.ok || !current || !current.ok ||
        reviewed.childId !== current.childId ||
        reviewed.desiredParentId !== current.desiredParentId ||
        reviewed.oldParentId !== current.oldParentId ||
        reviewed.configured !== current.configured ||
        reviewed.affectedPositionCount !== current.affectedPositionCount) return false;
    return value(reviewed.snapshotSignature) !== '' &&
      reviewed.snapshotSignature === normalizeSnapshot(fresh);
  }
  function allowedReady(data) {
    return Boolean(data?.loaded === true && data?.canMaintain === true &&
      data?.hierarchyPreview?.departmentReportingEnabled === true &&
      value(data?.hierarchyPreview?.tenantId));
  }
  function mount(root) {
    const doc = root.document;
    const editor = doc.getElementById('bexhrH6CManualPositionEditor');
    const panel = doc.getElementById('bexhrHierarchyTemplateAssistant');
    const child = doc.getElementById('bexhrH6CChild');
    const parent = doc.getElementById('bexhrH6CParent');
    const reviewButton = doc.getElementById('bexhrH6CReview');
    const checkbox = doc.getElementById('bexhrH6CAcknowledge');
    const acknowledgement = doc.getElementById('bexhrH6CAcknowledgeWrap');
    const openEditor = doc.getElementById('bexhrH6COpenEditor');
    const result = doc.getElementById('bexhrH6CResult');
    if (!editor || !panel || !child || !parent || !reviewButton || !checkbox ||
        !acknowledgement || !openEditor || !result || !root.BexHRHierarchyManualPositionEditor ||
        doc.getElementById('bexhrH7SaveReportingLine')) return;
    const model = root.BexHRHierarchyManualPositionEditor;
    if (typeof model.plan !== 'function') return;
    const save = doc.createElement('button');
    save.type = 'button';
    save.id = 'bexhrH7SaveReportingLine';
    save.className = 'btn btn-primary btn-sm mt-2 ms-2';
    save.textContent = 'Save reporting line';
    save.disabled = true;
    const hint = doc.createElement('p');
    hint.id = 'bexhrH7SaveHint';
    hint.className = 'small text-secondary mt-2 mb-0';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    openEditor.insertAdjacentElement('afterend', save);
    save.insertAdjacentElement('afterend', hint);
    let snapshot = null, canMaintain = false, backendReady = false;
    let reviewed = null, busy = false;
    function notice(message) { hint.textContent = message; }
    function refreshButtons() {
      save.disabled = !backendReady || !canMaintain || !reviewed || !checkbox.checked || busy;
      if (backendReady) {
        // H6C's original two-form handoff remains the fallback on old backend only.
        openEditor.hidden = true;
        notice('Review, confirm and save. Existing employee managers are not reassigned.');
      } else {
        notice('Save becomes available after the verified departmental reporting database upgrade.');
      }
    }
    function reset() { reviewed = null; save.disabled = true; }
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const data = event?.detail || {};
      snapshot = data.loaded === true ? data.hierarchyPreview : null;
      canMaintain = data.canMaintain === true;
      backendReady = allowedReady(data);
      reset();
      refreshButtons();
    });
    child.addEventListener('change', reset);
    parent.addEventListener('change', reset);
    reviewButton.addEventListener('click', () => {
      reset();
      if (!backendReady || !canMaintain || !snapshot || acknowledgement.hidden) {
        refreshButtons();
        return;
      }
      const proposed = model.plan(snapshot, child.value, parent.value);
      if (proposed?.ok) reviewed = Object.freeze({ ...proposed,
        snapshotSignature: normalizeSnapshot(snapshot) });
      refreshButtons();
    });
    checkbox.addEventListener('change', refreshButtons);
    async function fetchLatest(client, tenant) {
      const [p, d, l, cap] = await Promise.all([
        client.from('organization_job_titles').select('id,tenant_id,department_id,job_title,status').eq('tenant_id', tenant),
        client.from('organization_departments').select('id,tenant_id,department_name,status').eq('tenant_id', tenant),
        client.from('organization_job_title_hierarchy').select('tenant_id,job_title_id,reports_to_job_title_id').eq('tenant_id', tenant),
        client.rpc('bexhr_p7b_structure_capabilities'),
      ]);
      if (p.error || d.error || l.error || cap.error ||
          cap.data?.department_positions !== true || cap.data?.atomic_position_save !== true ||
          !Array.isArray(p.data) || !Array.isArray(d.data) || !Array.isArray(l.data)) {
        throw new Error('Reporting configuration could not be verified. Nothing was submitted.');
      }
      return { tenantId: tenant, departmentReportingEnabled: true,
        positions: p.data.filter((r) => value(r.status || 'active').toLowerCase() === 'active'),
        departments: d.data.filter((r) => value(r.status || 'active').toLowerCase() === 'active'),
        links: l.data };
    }
    save.addEventListener('click', async () => {
      if (!backendReady || !canMaintain || !snapshot || !reviewed ||
          !checkbox.checked || busy || value(child.value) !== reviewed.childId ||
          value(parent.value) !== reviewed.desiredParentId ||
          !root.supabaseClient || typeof root.confirm !== 'function') return;
      const tenant = value(snapshot.tenantId);
      const before = model.plan(snapshot, child.value, parent.value);
      if (!reviewedMatch(reviewed, before, snapshot)) {
        reset(); result.textContent = DENIED; refreshButtons(); return;
      }
      const message = 'Save the reporting line for ' + reviewed.childLabel +
        '?\n\nCurrently: ' + reviewed.oldLabel + '\nNew: ' + reviewed.nextLabel +
        '\n\nExisting employees and their Primary/Secondary Managers will not be reassigned. ' +
        'PA and Leave impact must be separately verified.';
      if (!root.confirm(message)) return;
      busy = true; refreshButtons();
      let submitted = false;
      try {
        const client = root.supabaseClient;
        const fresh = await fetchLatest(client, tenant);
        const updatedPlan = model.plan(fresh, reviewed.childId, reviewed.desiredParentId);
        if (!reviewedMatch(reviewed, updatedPlan, fresh)) {
          throw new Error('Company positions or reporting lines changed since review. Refresh and review again; nothing was saved.');
        }
        // The only write is the EXISTING tenant-admin-only, cycle/root guarded RPC.
        const { error } = await client.rpc('hr_tenant_admin_save_organization_job_title_hierarchy', {
          p_job_title_id: reviewed.childId,
          p_reports_to_job_title_id: reviewed.desiredParentId === TOP ? null : reviewed.desiredParentId,
        });
        submitted = true;
        if (error) throw error;
        const check = await client.from('organization_job_title_hierarchy')
          .select('reports_to_job_title_id')
          .eq('tenant_id', tenant).eq('job_title_id', reviewed.childId).maybeSingle();
        if (check.error || !check.data ||
            value(check.data.reports_to_job_title_id) !==
              (reviewed.desiredParentId === TOP ? '' : reviewed.desiredParentId)) {
          throw new Error('The server response could not be verified. Refresh to inspect the saved line; do not retry blindly.');
        }
        result.textContent = 'Reporting line saved. Existing employee manager assignments were not changed.';
        reset();
        if (typeof root.refreshOrganizationHrSetupValues === 'function') {
          try { await root.refreshOrganizationHrSetupValues(); }
          catch (refreshError) {
            console.warn('H7 saved reporting; subsequent refresh failed:', refreshError);
            notice('Saved and verified. Refresh this page to update the displayed hierarchy.');
          }
        } else notice('Saved and verified. Refresh the page to update the displayed hierarchy.');
      } catch (error) {
        console.error('H7 reporting line save:', error);
        result.textContent = value(error?.message) ||
          (submitted ? 'Save result uncertain; refresh and verify before retrying.' : 'No change submitted.');
        reset();
      } finally {
        busy = false;
        refreshButtons();
      }
    });
    refreshButtons();
  }
  return Object.freeze({ TOP, normalizeSnapshot, reviewedMatch, allowedReady, mount });
});
