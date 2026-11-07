/* BexHR H6C — guarded manual position reporting editor hand-off.
 * HR Admin uses an existing protected Job Title editor to save, after review.
 * This helper performs NO write operations, SQL, fetch or privilege grants.
 * Employee Primary/Secondary manager lines and historical PA/leave are untouched.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRHierarchyManualPositionEditor = api;
  if (root && root.document && root.addEventListener) {
    const start = () => api.mount(root);
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else start();
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const value = (x) => String(x == null ? '' : x).trim();
  const normalize = (x) => value(x).toLowerCase();
  const own = (x, tenant) => value(x && x.tenant_id) === tenant;
  const statusOk = (x) => !['inactive', 'archived', 'deleted'].includes(normalize(x && x.status || 'active'));
  const TOP = '__top_level__';
  const deny = (code, reason) => Object.freeze({ ok: false, code, reason });
  const clean = (x) => value(x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function validateSnapshot(snapshot) {
    if (!snapshot || !value(snapshot.tenantId) ||
      !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.links) ||
      !Array.isArray(snapshot.departments)) return deny('NOT_LOADED', 'Company reporting data is unavailable. Refresh Organisation Setup.');
    const tenant = value(snapshot.tenantId);
    // Global catalogue entries and other companies' positions are NOT editable here.
    const positions = snapshot.positions.filter((p) => own(p, tenant) && value(p.id) && statusOk(p));
    const byId = new Map();
    for (const p of positions) {
      if (byId.has(value(p.id))) return deny('DUPLICATE_POSITION', 'Duplicate position records need administrator review.');
      byId.set(value(p.id), p);
    }
    const saved = snapshot.links.filter((row) => own(row, tenant));
    const parents = new Map();
    for (const row of saved) {
      const child = value(row.job_title_id);
      const parent = value(row.reports_to_job_title_id);
      if (!child || !byId.has(child) || parent && !byId.has(parent)) {
        return deny('BROKEN_LINK', 'Saved reporting links refer to missing or non-company positions. Do not change anything here.');
      }
      if (parents.has(child)) return deny('DUPLICATE_LINK', 'Duplicate reporting links require review.');
      parents.set(child, parent);
    }
    const roots = [...parents].filter(([, parent]) => !parent).map(([child]) => child);
    if (roots.length > 1) return deny('MULTIPLE_ROOTS', 'Multiple organisation heads require manual integrity review first.');
    for (const child of parents.keys()) {
      const visited = new Set();
      let cursor = child;
      while (cursor) {
        if (visited.has(cursor)) return deny('SAVED_CYCLE', 'Existing position reporting contains a cycle.');
        visited.add(cursor);
        if (visited.size > 128) return deny('PATH_DEPTH', 'Reporting path exceeded the safe depth.');
        cursor = parents.get(cursor) || '';
      }
    }
    return { ok: true, tenant, byId, parents, roots, departments: new Map(
      snapshot.departments.filter((d) => own(d, tenant)).map((d) => [value(d.id), value(d.department_name)])) };
  }

  function positionName(position, validated) {
    if (!position) return '(position unavailable)';
    const name = value(position.job_title) || 'Unnamed position';
    const deptId = value(position.department_id);
    return deptId ? name + ' (' + (validated.departments.get(deptId) || 'Department') + ')' :
      name + ' (Whole organisation)';
  }

  function choices(snapshot, childId) {
    const result = validateSnapshot(snapshot);
    if (!result.ok) return result;
    const { byId, parents, roots } = result;
    const child = byId.get(value(childId));
    if (!child) return deny('UNKNOWN_CHILD', 'Select a company-owned active position to edit.');
    const currentParent = parents.has(value(childId)) ? parents.get(value(childId)) : undefined;
    const candidates = [];
    // Do not allow making a second root, nor detaching the only existing root.
    if (!roots.length || roots[0] === value(childId)) {
      candidates.push({ id: TOP, label: 'Organisation head (no parent)' });
    }
    for (const [parentId, parent] of byId) {
      if (parentId === value(childId) || !parents.has(parentId)) continue;
      const seen = new Set([value(childId)]);
      let cursor = parentId;
      let invalid = false;
      while (cursor) {
        if (seen.has(cursor) || !parents.has(cursor)) { invalid = true; break; }
        seen.add(cursor);
        if (seen.size > 128) { invalid = true; break; }
        cursor = parents.get(cursor) || '';
      }
      // Only offer an already rooted, fully configured ancestor chain.
      // In a completely new company, the HR Admin first configures the root.
      if (!invalid) candidates.push({ id: parentId, label: positionName(parent, result) });
    }
    return { ok: true, child: positionName(child, result), currentParent,
      candidates: candidates.sort((a, b) => a.id === TOP ? -1 : b.id === TOP ? 1 : a.label.localeCompare(b.label)) };
  }

  function plan(snapshot, childId, desiredParentId) {
    const s = validateSnapshot(snapshot);
    if (!s.ok) return s;
    const childKey = value(childId);
    const parentKey = value(desiredParentId);
    const child = s.byId.get(childKey);
    if (!child) return deny('UNKNOWN_CHILD', 'The position is not active in this company.');
    if (value(child.department_id) && snapshot.departmentReportingEnabled !== true) {
      return deny('DEPARTMENT_HELD', 'Department position editing is held until the reviewed database capability is activated. Preview only.');
    }
    const available = choices(snapshot, childKey);
    if (!available.ok) return available;
    if (!available.candidates.some((c) => c.id === parentKey)) {
      return deny('UNSAFE_PARENT', 'That reporting parent is unavailable, unconfigured, foreign or circular.');
    }
    const nextParent = parentKey === TOP ? '' : parentKey;
    const wasConfigured = s.parents.has(childKey);
    const oldParent = wasConfigured ? s.parents.get(childKey) : undefined;
    if (oldParent !== undefined && oldParent === nextParent) {
      return deny('NO_CHANGE', 'The selected reporting relationship is already saved.');
    }
    // The only root cannot be assigned a parent here: doing so would orphan
    // the configured organisation head until a verified admin migration.
    if (s.roots.length === 1 && s.roots[0] === childKey && nextParent) {
      return deny('ROOT_MOVE', 'Changing the saved organisation head requires a separately reviewed root change.');
    }
    const affected = new Set();
    const queue = [childKey];
    for (let i = 0; i < queue.length && i < 128; i++) {
      for (const [id, parent] of s.parents) {
        if (parent === queue[i] && !affected.has(id)) {
          affected.add(id); queue.push(id);
        }
      }
    }
    if (queue.length > 128) return deny('DEPTH_LIMIT', 'Too many descendant positions to review safely.');
    const oldLabel = oldParent === undefined ? 'Not yet configured' :
      oldParent ? positionName(s.byId.get(oldParent), s) : 'Organisation head (no parent)';
    const nextLabel = nextParent ? positionName(s.byId.get(nextParent), s) : 'Organisation head (no parent)';
    return Object.freeze({ ok: true, childId: childKey, desiredParentId: parentKey,
      oldParentId: oldParent === undefined ? null : oldParent,
      oldLabel, nextLabel, childLabel: positionName(child, s),
      affectedPositionCount: affected.size, configured: wasConfigured,
      // The editor will revalidate the current choices before any save.
      note: 'Position reporting only; existing employee Primary/Secondary Managers do not change automatically.' });
  }

  function mount(root) {
    const doc = root.document;
    const container = doc.getElementById('bexhrHierarchyTemplateAssistant');
    if (!container || doc.getElementById('bexhrH6CManualPositionEditor')) return;
    const panel = doc.createElement('section');
    panel.id = 'bexhrH6CManualPositionEditor';
    panel.className = 'border-top mt-4 pt-3';
    panel.setAttribute('aria-label', 'Manually edit reporting positions');
    panel.hidden = true;
    panel.innerHTML = '<h5 class="h6 fw-bold mb-1">Edit a reporting position</h5>' +
      '<p class="small text-secondary">Review one position at a time. An HR Admin must save through the existing protected Job Title form. Employee managers remain unchanged.</p>' +
      '<div class="row g-2 align-items-end">' +
        '<div class="col-12 col-lg-5"><label for="bexhrH6CChild" class="form-label small fw-semibold">Position to edit</label><select id="bexhrH6CChild" class="form-select"></select></div>' +
        '<div class="col-12 col-lg-5"><label for="bexhrH6CParent" class="form-label small fw-semibold">Reports to</label><select id="bexhrH6CParent" class="form-select"></select></div>' +
        '<div class="col-12 col-lg-2"><button type="button" id="bexhrH6CReview" class="btn btn-outline-primary w-100">Review change</button></div>' +
      '</div>' +
      '<div id="bexhrH6CResult" class="mt-3" role="status" aria-live="polite"></div>' +
      '<div id="bexhrH6CAcknowledgeWrap" hidden class="form-check mt-3">' +
        '<input id="bexhrH6CAcknowledge" class="form-check-input" type="checkbox">' +
        '<label for="bexhrH6CAcknowledge" class="form-check-label small">I reviewed this position-level change and understand that saved employee managers will not be reassigned.</label>' +
      '</div>' +
      '<button type="button" id="bexhrH6COpenEditor" class="btn btn-primary btn-sm mt-2" hidden disabled>Open protected position editor</button>' +
      '<p class="small text-secondary mt-3 mb-0"><strong>To correct one employee:</strong> use People &rarr; Employee Directory &rarr; Actions &rarr; Manage reporting managers. Do not change the entire position hierarchy for an individual exception. Individual exceptions are not yet a new PA/Leave authorisation grant.</p>';
    container.appendChild(panel);
    const childInput = panel.querySelector('#bexhrH6CChild');
    const parentInput = panel.querySelector('#bexhrH6CParent');
    const reviewButton = panel.querySelector('#bexhrH6CReview');
    const result = panel.querySelector('#bexhrH6CResult');
    const acknowledgeWrap = panel.querySelector('#bexhrH6CAcknowledgeWrap');
    const acknowledge = panel.querySelector('#bexhrH6CAcknowledge');
    const openEditor = panel.querySelector('#bexhrH6COpenEditor');
    let snapshot = null;
    let canMaintain = false;
    let pending = null;
    function invalidate() {
      pending = null;
      acknowledge.checked = false;
      acknowledgeWrap.hidden = true;
      openEditor.hidden = true;
      openEditor.disabled = true;
      result.textContent = '';
    }
    function fillParents() {
      invalidate();
      const available = choices(snapshot, childInput.value);
      parentInput.replaceChildren(new Option('Select reporting parent', ''),
        ...(available.ok ? available.candidates : []).map((c) => new Option(c.label, c.id)));
      if (!available.ok) result.textContent = available.reason;
      else if (available.currentParent !== undefined) {
        parentInput.value = available.currentParent || TOP;
      }
    }
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const data = event && event.detail || {};
      canMaintain = data.loaded === true && data.canMaintain === true;
      snapshot = canMaintain ? data.hierarchyPreview : null;
      panel.hidden = !canMaintain;
      invalidate();
      childInput.replaceChildren(new Option('Select company position', ''));
      parentInput.replaceChildren(new Option('Select reporting parent', ''));
      if (!canMaintain || !snapshot) return;
      const validated = validateSnapshot(snapshot);
      if (!validated.ok) { result.textContent = validated.reason; return; }
      const values = [...validated.byId.values()].sort((a, b) =>
        positionName(a, validated).localeCompare(positionName(b, validated)));
      childInput.replaceChildren(new Option('Select company position', ''),
        ...values.map((p) => new Option(positionName(p, validated), value(p.id))));
    });
    childInput.addEventListener('change', fillParents);
    parentInput.addEventListener('change', invalidate);
    reviewButton.addEventListener('click', () => {
      invalidate();
      if (!canMaintain || !snapshot) { result.textContent = 'HR Admin access and current company data are required.'; return; }
      const change = plan(snapshot, childInput.value, parentInput.value);
      if (!change.ok) { result.textContent = change.reason; return; }
      pending = change;
      result.innerHTML = '<div class="rounded border p-3 bg-white">' +
        '<strong>' + clean(change.childLabel) + '</strong><br>' +
        '<span class="small text-secondary">Currently:</span> ' + clean(change.oldLabel) +
        '<br><span class="small text-secondary">Proposed:</span> ' + clean(change.nextLabel) +
        '<br><span class="small text-secondary">Positions below this position:</span> ' + change.affectedPositionCount +
        '<p class="small text-secondary mb-0 mt-2">' + clean(change.note) +
        ' Review impacted PA and Leave authority before final activation.</p></div>';
      acknowledgeWrap.hidden = false;
      openEditor.hidden = false;
    });
    acknowledge.addEventListener('change', () => {
      openEditor.disabled = !(acknowledge.checked && pending && canMaintain);
    });
    openEditor.addEventListener('click', () => {
      if (!pending || !acknowledge.checked || !canMaintain || !snapshot) return;
      const refreshed = plan(snapshot, childInput.value, parentInput.value);
      if (!refreshed.ok || refreshed.childId !== pending.childId ||
          refreshed.desiredParentId !== pending.desiredParentId ||
          refreshed.oldParentId !== pending.oldParentId ||
          refreshed.oldLabel !== pending.oldLabel) {
        invalidate(); result.textContent = 'The proposal changed. Review it again before editing.';
        return;
      }
      if (typeof root.hrEditOrganizationJobTitleRecord !== 'function') {
        result.textContent = 'The protected Job Title editor is unavailable. No records were changed.';
        return;
      }
      root.hrEditOrganizationJobTitleRecord(refreshed.childId);
      const editingId = doc.getElementById('editingOrganizationJobTitleId');
      const reportsTo = doc.getElementById('organizationJobTitleReportsTo');
      if (!editingId || value(editingId.value) !== refreshed.childId || !reportsTo || reportsTo.disabled ||
          !Array.from(reportsTo.options).some((opt) => value(opt.value) === refreshed.desiredParentId)) {
        result.textContent = 'This parent is not available in the current protected editor. No changes were saved. Refresh Organisation Setup.';
        return;
      }
      reportsTo.value = refreshed.desiredParentId;
      reportsTo.dispatchEvent(new root.Event('change', { bubbles: true }));
      invalidate();
      result.textContent = 'Loaded into the protected Job Title form. Check all fields and click Update Job Title to save. No change has been saved yet.';
    });
  }
  return Object.freeze({ TOP, validateSnapshot, choices, plan, mount });
});
