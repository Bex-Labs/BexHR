/* BexHR organisation template assistant, Phase H1.
 * Suggestion-only: NO Supabase writes, no employee mutations, no automatic
 * management authority. Tenant-owned job positions and saved links remain
 * authoritative. Company Admin reviews each change in the existing editor.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BexHRHierarchyTemplateAssistant = api;
  if (root && root.document && root.addEventListener) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => api.mount(root));
    } else {
      api.mount(root);
    }
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const id = (x) => String(x == null ? '' : x).trim();
  const norm = (x) => id(x).toLowerCase().replace(/\s+/g, ' ');
  const active = (row) => norm(row?.status || 'active') === 'active';
  const isOwn = (row, tenant) => !id(row?.tenant_id) || id(row.tenant_id) === tenant;
  const issue = (code, message) => Object.freeze({ code, message });
  const modeNames = Object.freeze({
    quick: 'Quick setup',
    operations: 'Operations and training',
    manual: 'Build my own',
  });
  const headAliases = [
    /^(ceo|chief executive officer)$/, /^(managing director|md)$/, 
    /^(coo|chief operating officer)$/, /^(executive director)$/,
    /^(general manager)$/, /^(owner|proprietor|principal)$/,
  ];
  const isHead = (row) => headAliases.some((pattern) => pattern.test(norm(row?.job_title)));
  function rank(title) {
    const t = norm(title);
    if (/\b(chief|director|head|general manager)\b/.test(t)) return 10;
    if (/\b(manager|superintendent)\b/.test(t)) return 20;
    if (/\b(supervisor|team lead|lead)\b/.test(t)) return 30;
    if (/\b(coordinator|officer|engineer|accountant|instructor)\b/.test(t)) return 40;
    if (/\b(assistant|technician|operator|janitor|driver|clerk|trainee)\b/.test(t)) return 50;
    return 45;
  }
  const copy = (row) => ({
    id: id(row?.id), tenant_id: id(row?.tenant_id),
    job_title: id(row?.job_title), department_id: id(row?.department_id),
    status: id(row?.status || 'active'),
  });
  function generate({ tenantId, positions = [], links = [], departments = [],
    mode = 'quick', selectedRootId = '', departmentReportingEnabled = false } = {}) {
    const tenant = id(tenantId);
    if (!tenant) throw new Error('TENANT_REQUIRED');
    if (!modeNames[mode]) throw new Error('UNKNOWN_TEMPLATE');
    if (![positions, links, departments].every(Array.isArray)) throw new Error('INVALID_INPUT');
    const warnings = [];
    // Never take records from a second tenant even when they share a title.
    const selected = positions.filter((p) => p && id(p.id) && active(p) && isOwn(p, tenant)).map(copy);
    const byId = new Map();
    const duplicatePositionIds = new Set();
    for (const p of selected) {
      if (byId.has(p.id)) duplicatePositionIds.add(p.id);
      else byId.set(p.id, p);
    }
    const allPositions = [...byId.values()].sort((a, b) =>
      a.job_title.localeCompare(b.job_title) || a.id.localeCompare(b.id));
    const tenantLinks = links.filter((link) => id(link?.tenant_id) === tenant && id(link?.job_title_id));
    const byChild = new Map();
    const duplicateLinks = new Set();
    for (const link of tenantLinks) {
      const child = id(link.job_title_id);
      if (byChild.has(child)) duplicateLinks.add(child);
      else byChild.set(child, id(link.reports_to_job_title_id));
    }
    // Reject broken existing hierarchy data instead of inventing a template fix.
    const unknownLinks = tenantLinks.some((x) => !byId.has(id(x.job_title_id)) ||
      (id(x.reports_to_job_title_id) && !byId.has(id(x.reports_to_job_title_id))));
    let positionCycle = false;
    for (const child of byChild.keys()) {
      const seenParents = new Set([child]);
      let cursor = byChild.get(child);
      while (cursor) {
        if (seenParents.has(cursor)) { positionCycle = true; break; }
        seenParents.add(cursor);
        cursor = byChild.get(cursor);
      }
      if (positionCycle) break;
    }
    if (unknownLinks) warnings.push(issue('UNKNOWN_SAVED_POSITION', 'Saved links include an unavailable position. Review existing setup before applying suggestions.'));
    if (positionCycle) warnings.push(issue('SAVED_POSITION_CYCLE', 'Saved position links contain a cycle. No suggestions can be used.'));
    const roots = tenantLinks.filter((x) => byId.has(id(x.job_title_id)) && !id(x.reports_to_job_title_id));
    const rootIds = [...new Set(roots.map((r) => id(r.job_title_id)))];
    if (duplicatePositionIds.size) warnings.push(issue('DUPLICATE_POSITION', 'Duplicate position IDs require review.'));
    if (duplicateLinks.size) warnings.push(issue('DUPLICATE_LINK', 'Duplicate position hierarchy links require review.'));
    if (rootIds.length > 1) warnings.push(issue('MULTIPLE_ROOTS', 'Multiple configured roots exist. Resolve this before suggesting changes.'));
    if (rootIds.length === 1 && selectedRootId && id(selectedRootId) !== rootIds[0]) {
      warnings.push(issue('ROOT_CONFLICT', 'A different root is already configured. Existing links will not be replaced.'));
    }
    const selectedRoot = id(selectedRootId);
    if (selectedRoot && !byId.has(selectedRoot)) warnings.push(issue('ROOT_NOT_FOUND', 'Selected organisation head is unavailable in this company.'));
    const availableHeads = allPositions.filter((p) => !p.department_id && isHead(p));
    let rootId = rootIds.length === 1 ? rootIds[0] : '';
    if (!rootId && selectedRoot && byId.has(selectedRoot)) rootId = selectedRoot;
    if (!rootId && availableHeads.length === 1) rootId = availableHeads[0].id;
    if (!rootId && mode !== 'manual') warnings.push(issue('CHOOSE_ROOT',
      'Choose the company\'s actual organisational head; no reporting links will be guessed.'));
    const fatal = Boolean(unknownLinks || positionCycle || duplicatePositionIds.size || duplicateLinks.size || rootIds.length > 1 ||
      (rootIds.length === 1 && selectedRoot && rootIds[0] !== selectedRoot) ||
      (selectedRoot && !byId.has(selectedRoot)));
    const label = (positionId) => byId.get(positionId)?.job_title || '';
    const isSupported = (position) => departmentReportingEnabled || !position.department_id;
    const branchDepartment = (row) => id(row?.department_id);
    const coo = allPositions.filter((p) => !p.department_id &&
      /^(chief operating officer|coo)$/.test(norm(p.job_title)) && p.id !== rootId);
    const execAnchorId = coo.length === 1 ? coo[0].id : rootId;
    const proposals = [];
    for (const position of allPositions) {
      if (byChild.has(position.id)) {
        const parentId = byChild.get(position.id);
        proposals.push({ jobTitleId: position.id, jobTitle: position.job_title,
          departmentId: position.department_id, parentId, parentTitle: parentId ? label(parentId) : 'Organisation head',
          state: 'preserved', editable: false, note: 'Existing saved link preserved.' });
        continue;
      }
      if (mode === 'manual' || fatal || !rootId) {
        proposals.push({ jobTitleId: position.id, jobTitle: position.job_title,
          departmentId: position.department_id, parentId: null, parentTitle: '',
          state: 'manual', editable: false, note: 'Configure manually; no changes are applied.' });
        continue;
      }
      if (position.id === rootId) {
        proposals.push({ jobTitleId: position.id, jobTitle: position.job_title,
          departmentId: position.department_id, parentId: null, parentTitle: 'Organisation head',
          state: 'suggested', editable: isSupported(position), note: 'Confirm the single organisational head.' });
        continue;
      }
      let parentId = position.id === execAnchorId ? rootId : execAnchorId;
      let note = 'Suggested from existing company positions; review before saving.';
      let ambiguous = false;
      const sameDepartment = allPositions.filter((p) => p.id !== position.id &&
        branchDepartment(p) && branchDepartment(p) === branchDepartment(position) &&
        rank(p.job_title) < rank(position.job_title));
      if (sameDepartment.length) {
        const bestRank = Math.max(...sameDepartment.map((p) => rank(p.job_title)));
        const candidates = sameDepartment.filter((p) => rank(p.job_title) === bestRank);
        if (candidates.length === 1) {
          parentId = candidates[0].id;
          note = 'Suggested same-department reporting chain; review before saving.';
        } else {
          ambiguous = true;
          note = 'Several possible supervisors. Choose the reporting position manually.';
        }
      }
      if (mode === 'operations' && !ambiguous && !sameDepartment.length && position.department_id) {
        // Operations and training companies often have several specialist
        // chains under the COO. Match ONLY existing titles, and require review.
        const family = ['training', 'maintenance', 'bosiet', 'logistics',
          'commercial', 'account', 'project', 'engineering', 'security', 'business']
          .find((word) => norm(position.job_title).includes(word));
        if (family) {
          const higher = allPositions.filter((p) => p.id !== position.id &&
            norm(p.job_title).includes(family) && rank(p.job_title) < rank(position.job_title));
          if (higher.length) {
            const nearestRank = Math.max(...higher.map((p) => rank(p.job_title)));
            const matches = higher.filter((p) => rank(p.job_title) === nearestRank);
            if (matches.length === 1) {
              parentId = matches[0].id;
              note = 'Operations template: proposed specialist reporting chain. Confirm it fits your company.';
            } else {
              ambiguous = true;
              note = 'Multiple possible specialist leads. Choose the reporting position manually.';
            }
          }
        }
      }
      if (mode === 'operations' && !ambiguous && !position.department_id) {
        // Never insert the Alpatech company chart into another tenant.
        note = 'Operations template suggestion from existing titles; review before saving.';
      }
      if (parentId === position.id) { ambiguous = true; note = 'Self reporting blocked.'; }
      const parentReady = parentId ? byChild.has(parentId) : true;
      const supported = isSupported(position);
      const state = ambiguous ? 'needs-review' : supported ? 'suggested' : 'preview-only';
      proposals.push({ jobTitleId: position.id, jobTitle: position.job_title,
        departmentId: position.department_id, parentId, parentTitle: label(parentId),
        state, editable: !ambiguous && supported && parentReady,
        note: !supported ? 'Department reporting is not activated on this database; preview only.' :
          (!parentReady && !ambiguous ? 'Configure the proposed superior position first.' : note) });
    }
    return Object.freeze({ tenantId: tenant, mode, rootId, warnings, positions: allPositions,
      proposals, canReview: !fatal && Boolean(rootId), departmentReportingEnabled: !!departmentReportingEnabled });
  }

  function mount(root) {
    const document = root.document;
    const panel = document.getElementById('bexhrHierarchyTemplateAssistant');
    if (!panel || panel.dataset.mounted === 'true') return;
    panel.dataset.mounted = 'true';
    const modeInput = document.getElementById('bexhrHierarchyTemplateMode');
    const rootSelect = document.getElementById('bexhrHierarchyTemplateRoot');
    const previewButton = document.getElementById('bexhrHierarchyTemplatePreview');
    const preview = document.getElementById('bexhrHierarchyTemplateResults');
    const message = document.getElementById('bexhrHierarchyTemplateMessage');
    let snapshot = null;
    let canMaintain = false;
    let currentPlan = null;
    function showMessage(text) { if (message) message.textContent = text; }
    function escapeHtml(text) { return id(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function draw() {
      if (!snapshot) { showMessage('Organisation setup data is not available yet.'); return; }
      currentPlan = generate({ ...snapshot, mode: modeInput.value, selectedRootId: rootSelect.value });
      const notes = currentPlan.warnings.map((warning) => warning.message);
      const rows = currentPlan.proposals.map((p) => {
        const desc = p.state === 'preserved' ? 'Saved' : p.state === 'suggested' ? 'Suggested' :
          p.state === 'preview-only' ? 'Preview only' : 'Needs review';
        return `<tr><td>${escapeHtml(p.jobTitle)}</td><td>${escapeHtml(p.parentTitle || 'Select manually')}</td>` +
          `<td>${escapeHtml(desc)}</td><td>` +
          (p.editable && canMaintain ? `<button type="button" class="btn btn-sm btn-outline-primary" ` +
          `data-bexhr-hierarchy-review="${escapeHtml(p.jobTitleId)}">Review in form</button>` :
          `<span class="small text-secondary">${escapeHtml(p.note)}</span>`) + '</td></tr>';
      }).join('');
      preview.innerHTML = '<div class="table-responsive" style="max-height:360px;overflow-y:auto"><table class="table table-sm align-middle mb-0">' +
        '<thead><tr><th>Existing position</th><th>Suggested parent</th><th>State</th><th>Next action</th></tr></thead>' +
        `<tbody>${rows || '<tr><td colspan="4">No positions configured yet.</td></tr>'}</tbody></table></div>`;
      preview.hidden = false;
      showMessage((notes.length ? notes.join(' ') + ' ' : '') +
        'Suggestions never save automatically. Existing links and employees are unchanged.');
    }
    function refreshRootOptions() {
      if (!snapshot || !rootSelect) return;
      const previous = rootSelect.value;
      const available = (snapshot.positions || []).filter((p) =>
        active(p) && (!id(p.department_id) || snapshot.departmentReportingEnabled));
      rootSelect.replaceChildren(new Option('Suggest automatically', ''),
        ...available.map((p) => new Option(id(p.job_title), id(p.id))));
      if (available.some((p) => id(p.id) === previous)) rootSelect.value = previous;
    }
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const detail = event?.detail || {};
      if (!detail.loaded || !detail.hierarchyPreview) {
        snapshot = null;
        currentPlan = null;
        if (preview) preview.hidden = true;
        showMessage('Organisation setup data is unavailable; no suggestions can be made.');
        return;
      }
      snapshot = detail.hierarchyPreview;
      canMaintain = detail.canMaintain === true;
      refreshRootOptions();
      if (preview && !preview.hidden) draw();
      else showMessage('Choose an approach, then preview. Nothing is changed until you save it in the existing form.');
    });
    previewButton?.addEventListener('click', draw);
    preview?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-bexhr-hierarchy-review]');
      if (!button || !canMaintain || !currentPlan) return;
      const targetId = id(button.dataset.bexhrHierarchyReview);
      const plan = currentPlan.proposals.find((p) => p.jobTitleId === targetId);
      if (!plan?.editable || typeof root.hrEditOrganizationJobTitleRecord !== 'function') {
        showMessage('This position is not ready for editing. Configure the parent first or refresh setup.');
        return;
      }
      root.hrEditOrganizationJobTitleRecord(targetId);
      const parentField = document.getElementById('organizationJobTitleReportsTo');
      const proposedValue = plan.parentId || '__top_level__';
      if (!parentField || ![...parentField.options].some((o) => o.value === proposedValue)) {
        showMessage('The proposed parent is not available in the current editor. No changes were saved.');
        return;
      }
      parentField.value = proposedValue;
      parentField.dispatchEvent(new Event('change', { bubbles: true }));
      showMessage('Review the position, its department and the Reports to selection, then click Update Job Title yourself.');
    });
    showMessage('Choose a template and preview your existing company positions. No records will be changed.');
  }
  return Object.freeze({ generate, mount, modeNames });
});
