/* BEXHR_GROUP_B_V7: clarity and post-save refresh convention.
 * No hierarchy writes, no app role changes, no guesses about seniority based on title.
 * Existing organisation refreshers stay authoritative. This script does not reload the page.
 */
(() => {
  'use strict';
  const root = typeof window === 'object' ? window : globalThis;
  const doc = root.document;
  if (!doc) return;
  const get = (id) => doc.getElementById(id);
  const text = (value) => String(value == null ? '' : value).trim();
  let scheduled = false;
  const FIRST = 'organization';
  const scopes = new Set();
  let refreshTimer = null;
  let refreshPromise = null;

  // The form's original required (*) remains a red, accessible span.
  function updateLabel(forId, caption) {
    const label = doc.querySelector(`label[for="${forId}"]`);
    if (!label) return;
    const firstText = [...label.childNodes].find(node => node.nodeType === 3 && text(node.nodeValue));
    if (firstText && text(firstText.nodeValue) !== caption) firstText.nodeValue = `\n  ${caption} `;
    else if (!firstText && !label.querySelector('.text-danger') && text(label.textContent) !== caption) label.textContent = caption;
  }
  function rewriteOption(select, value, caption) {
    if (!select) return;
    const option = [...select.options].find(entry => entry.value === value);
    if (option && option.textContent !== caption) option.textContent = caption;
  }
  function updateText(selector, caption) {
    const node = doc.querySelector(selector);
    if (node && node.textContent !== caption) node.textContent = caption;
  }
  function syncWording() {
    updateLabel('organizationJobTitleReportsTo', 'Reports to (position)');
    updateLabel('bexhrH6CChild', 'Position to update');
    updateLabel('bexhrH6CParent', 'Reports to (position)');
    updateText('#organizationJobTitleReportsToHelp',
      'Select the position above this one. This does not assign or change any employee\'s Primary Manager.');
    const formSelect = get('organizationJobTitleReportsTo');
    rewriteOption(formSelect, '', 'Choose the position above this one');
    const top = [...(formSelect?.options || [])].find(option => option.value === '__top_level__');
    if (top) {
      const caption = top.disabled ? 'Highest position already assigned' : 'Highest position (no supervisor)';
      if (top.textContent !== caption) top.textContent = caption;
    }
    // V6 provides the new highest-position option only when the tenant is eligible.
    const promoted = [...(formSelect?.options || [])].find(option => option.value === '__bexhr_new_highest__');
    if (promoted && !promoted.textContent.startsWith('Make this the new highest position')) {
      const match = promoted.textContent.match(/\(above (.+)\)$/);
      if (match) promoted.textContent = `Make this the new highest position (above ${match[1]})`;
    }
    const reportsTo = get('bexhrH6CParent');
    rewriteOption(reportsTo, '', 'Choose the position above this one');
    rewriteOption(reportsTo, '__top_level__', 'Highest position (no supervisor)');
    rewriteOption(get('bexhrH6CChild'), '', 'Choose a position to update');
    updateText('#organizationJobTitleRecordsHeader + p',
      'Edit a job title here, or use Reporting Lines to change its position in the hierarchy.');
  }
  function scheduleWording() {
    if (scheduled) return;
    scheduled = true;
    root.queueMicrotask(() => { scheduled = false; syncWording(); });
  }

  // Reusable contract for subsequent modules: emit after a *confirmed* server write.
  // Organisation's current CRUD and shortcut handlers already call the built-in
  // refreshOrganizationHrSetupValues() after success; no duplicate network load is added here.
  async function flush() {
    refreshTimer = null;
    if (refreshPromise) return refreshPromise;
    const requested = new Set(scopes);
    scopes.clear();
    if (!requested.has(FIRST)) return;
    if (typeof refreshOrganizationHrSetupValues !== 'function') return;
    refreshPromise = Promise.resolve().then(() => refreshOrganizationHrSetupValues());
    try {
      await refreshPromise;
      root.dispatchEvent(new root.CustomEvent('bexhr:records-refreshed', { detail: { scope: FIRST } }));
    } catch (error) {
      console.warn('BexHR post-save refresh failed. Saved records are not rolled back:', error);
      root.dispatchEvent(new root.CustomEvent('bexhr:records-refresh-failed', { detail: { scope: FIRST } }));
    } finally {
      refreshPromise = null;
      if (scopes.size && !refreshTimer) refreshTimer = root.setTimeout(flush, 100);
    }
  }
  function notify(scope) {
    if (scope !== FIRST) return false;
    scopes.add(scope);
    if (!refreshTimer && !refreshPromise) refreshTimer = root.setTimeout(flush, 100);
    return true;
  }
  root.BexHRPostSaveRefresh = Object.freeze({ notify, syncWording });
  root.addEventListener('bexhr:record-committed', event => {
    if (event?.detail?.scope === FIRST) notify(FIRST);
  });
  root.addEventListener('bexhr:organization-setup-updated', scheduleWording);
  function mount() {
    syncWording();
    for (const id of ['organizationJobTitleReportsTo', 'bexhrH6CParent', 'bexhrH6CChild']) {
      const select = get(id);
      if (select && root.MutationObserver) {
        // Observe replacement of options, not option text changes, to avoid loops.
        new root.MutationObserver(scheduleWording).observe(select, { childList: true });
      }
    }
    get('organizationJobTitleForm')?.addEventListener('change', scheduleWording);
    get('organizationJobTitleForm')?.addEventListener('input', scheduleWording);
    get('bexhrH6CManualPositionEditor')?.addEventListener('change', scheduleWording);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
