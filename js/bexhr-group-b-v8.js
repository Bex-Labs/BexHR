/* BEXHR_GROUP_B_V8: position-level guard explanations and clear labels.
 * UI-only. Retain original Departments / Job Titles / Reporting Lines, V6 save,
 * backend hierarchy protection, employee manager decisions, PA and Leave.
 */
(() => {
  'use strict';
  const root = window;
  const doc = document;
  const byId = (id) => doc.getElementById(id);
  const key = (value) => String(value == null ? '' : value).trim();
  const norm = (value) => key(value).toLowerCase();
  let snapshot = null;
  let queued = false;
  const isActive = (row) => norm(row?.status || 'active') === 'active';
  function currentData() {
    // Never mistake a stale or different-tenant snapshot for authoritative data.
    const s = snapshot;
    if (!s || !s.loaded || !s.canMaintain || !s.tenant || !Array.isArray(s.positions) || !Array.isArray(s.links)) return null;
    return s;
  }
  function relation(id) {
    const s = currentData();
    if (!s || !id) return null;
    const selected = s.positions.find(p => key(p.id) === key(id) && key(p.tenant_id) === s.tenant);
    if (!selected) return null;
    const ownLink = s.links.find(l => key(l.tenant_id) === s.tenant && key(l.job_title_id) === key(id));
    const children = s.links.filter(l => key(l.tenant_id) === s.tenant && key(l.reports_to_job_title_id) === key(id))
      .map(l => s.positions.find(p => key(p.id) === key(l.job_title_id) && key(p.tenant_id) === s.tenant))
      .filter(p => p && isActive(p));
    const rootPosition = Boolean(ownLink && !key(ownLink.reports_to_job_title_id) && isActive(selected));
    return {position:selected, children, rootPosition};
  }
  function reason(id, action) {
    const r = relation(id);
    if (!r) return '';
    const name = key(r.position.job_title) || 'This position';
    if (r.children.length) {
      const childNames = r.children.slice(0,3).map(p => key(p.job_title) || 'Unnamed position').join(', ');
      const extra = r.children.length > 3 ? ` and ${r.children.length-3} more` : '';
      return `${name} cannot be ${action} yet. ${r.children.length} active position(s) report to it: ${childNames}${extra}. Reassign them in Reporting Lines first.`;
    }
    if (r.rootPosition) {
      return `${name} is the highest organisational position. Introduce a replacement highest position before ${action} this one.`;
    }
    return '';
  }
  function show(message) {
    const node=byId('bexhrGroupBStatusAdvice');
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }
  function setLabel(id, caption) {
    const label = doc.querySelector(`label[for="${id}"]`);
    if (!label) return;
    for (const node of label.childNodes) {
      if (node.nodeType === 3 && key(node.nodeValue)) {
        if (key(node.nodeValue) !== caption) node.nodeValue = `\n  ${caption} `;
        return;
      }
    }
  }
  function syncLabels() {
    setLabel('organizationJobTitleReportsTo', 'Reports to');
    setLabel('bexhrH6CChild', 'Position to change');
    setLabel('bexhrH6CParent', 'Reports to');
    const sel=byId('organizationJobTitleReportsTo');
    const top=Array.from(sel?.options || []).find(o=>o.value==='__top_level__');
    if (top) top.textContent=top.disabled ? 'Highest position already assigned' : 'Highest position (no supervisor)';
    const note=byId('organizationJobTitleReportsToHelp');
    if (note) note.textContent = 'Select the position this title reports to. This does not change an employee\'s Primary Manager.';
    const help=byId('bexhrGroupBStatusHelp');
    if (help) help.textContent='A vacant position can remain active. To deactivate or delete a position, first reassign its subordinate positions.';
    const selected=key(byId('editingOrganizationJobTitleId')?.value);
    const status=norm(byId('organizationJobTitleStatus')?.value);
    if (selected && status==='inactive') show(reason(selected,'deactivated'));
    else show('');
  }
  function schedule() {
    if (queued) return;
    queued=true;
    queueMicrotask(() => { queued=false; syncLabels(); });
  }
  function onSubmit(event) {
    const form=byId('organizationJobTitleForm');
    if (!form || event.target !== form) return;
    const id=key(byId('editingOrganizationJobTitleId')?.value);
    if (!id || norm(byId('organizationJobTitleStatus')?.value)!=='inactive') return;
    const message=reason(id,'deactivated');
    if (!message) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    show(message);
  }
  function onDelete(event) {
    // Only intercept the original Job Title delete action, not other delete buttons.
    const button=event.target?.closest?.('button[onclick^="window.hrDeleteOrganizationJobTitleRecord"]');
    if (!button) return;
    const onclick=button.getAttribute('onclick') || '';
    const match=onclick.match(/^window\.hrDeleteOrganizationJobTitleRecord\('([a-f0-9-]{36})'\)/i);
    if (!match) return; // Leave unexpected buttons to existing backend guards.
    const message=reason(match[1],'deleted');
    if (!message) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    show(message);
    byId('bexhrGroupBStatusAdvice')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
  }
  function mount() {
    const form=byId('organizationJobTitleForm');
    if (!form || byId('bexhrGroupBStatusAdvice')) return;
    const help=doc.createElement('p');
    help.id='bexhrGroupBStatusHelp';
    help.className='form-text mt-2';
    const notice=doc.createElement('div');
    notice.id='bexhrGroupBStatusAdvice';
    notice.className='alert alert-warning mt-2';
    notice.setAttribute('role','alert');
    notice.hidden=true;
    form.append(help,notice);
    form.addEventListener('submit',onSubmit,true);
    doc.addEventListener('click',onDelete,true);
    byId('organizationJobTitleStatus')?.addEventListener('change',schedule);
    byId('organizationJobTitleReportsTo')?.addEventListener('change',schedule);
    byId('bexhrH6CManualPositionEditor')?.addEventListener('change',schedule);
    root.addEventListener('bexhr:organization-setup-updated', event => {
      const detail=event?.detail || {};
      const s=detail.hierarchyPreview;
      snapshot = detail.loaded===true && detail.canMaintain===true && s?.tenantId
        ? {loaded:true,canMaintain:true,tenant:key(s.tenantId),positions:s.positions,links:s.links}
        : null;
      schedule();
    });
    const labels=byId('organizationJobTitleReportsTo');
    if(labels && root.MutationObserver) new root.MutationObserver(schedule).observe(labels,{childList:true});
    schedule();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
