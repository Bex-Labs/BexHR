/* BEXHR_H12_CARD_DOUBLECLICK_V2_20261113
 * FEAT UI-only corrective contract across HR, Manager, Employee, Admin:
 * - A safe, non-interactive card surface double-click OPENS or CLOSES the
 *   nearest uniquely controlled panel via its existing collapse button.
 * - A collapse/expand button remains SINGLE-CLICK; keyboard access unchanged.
 * - Sidebar items remain SINGLE-CLICK navigation (not collapsible cards).
 * - Never toggle record/table/form/modal content or ambiguous card shells.
 * - Employee Lifecycle's dedicated V3 double-click implementation is preserved.
 * - Nested HR audit / payslip log and Admin subworkspace panels are isolated.
 * No database, role, auth, payroll calculation or lifecycle write behaviour.
 */
(() => {
  'use strict';
  if (window.__bexhrCardDoubleClickV2) return;
  window.__bexhrCardDoubleClickV2 = true;

  const ROOTS = [
    '.company-admin-audit-panel',
    '.hr-payroll-email-status-panel',
    '.admin-companies-subworkspace',
    '.dashboard-section-card'
  ].join(', ');

  // Never turn a double-click on data, an actionable control or a table into a
  // card-level action. The explicit opt-out protects future dynamically built UI.
  const NO_TOGGLE = [
    'button', 'a', 'input', 'select', 'textarea', 'label', 'option',
    'form', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'summary', 'details', 'dialog', 'iframe', 'video', 'audio', 'canvas',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="grid"]',
    '[role="dialog"]', '[role="menu"]', '[role="menuitem"]',
    '[contenteditable]', '[data-bs-toggle]', '[data-bexhr-dblclick-exclude]',
    '[data-manager-employee-id]', '[data-employee-id]', '[data-record-id]',
    '.table-responsive', '.dashboard-table-wrap',
    '.manager-assigned-employee-card', '.employee-leave-history-scroll-area',
    '.list-group-item', '.dropdown', '.dropdown-menu', '.modal',
    '[class*="table-scroll"]', '[class*="history-scroll"]', '[class*="records-scroll"]'
  ].join(', ');

  // HR Bank Directory predates the consistent aria-controls convention.
  // Its real panel and original bindCardCollapseToggle handler still exist.
  const LEGACY_PAIRS = Object.freeze({
    toggleBankDirectoryCardBtn: 'bankDirectoryCardCollapse'
  });

  function pairFor(scope) {
    // Never bind a broad shell with two independently controlled panels:
    // force the user to double-click within the individual subworkspace.
    const candidates = [];
    for (const button of scope.querySelectorAll('button')) {
      if (button.closest(ROOTS) !== scope) continue;
      const id = button.getAttribute('aria-controls') || LEGACY_PAIRS[button.id];
      if (!id || !id.endsWith('Collapse')) continue;
      const panel = document.getElementById(id);
      if (!panel || panel.closest(ROOTS) !== scope) continue;
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
      if (button.hasAttribute('data-bs-toggle')) continue;
      candidates.push({ button, panel });
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  document.addEventListener('dblclick', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(NO_TOGGLE)) return;
    const scope = target.closest(ROOTS);
    if (!scope || !scope.isConnected) return;
    // Dedicated V3 module is authoritative, including the intended sidebar
    // single-click and accessible Enter/Space behavior. Never double-bind it.
    if (target.closest('#hrEmployeeLifecycleCard')) return;
    const pair = pairFor(scope);
    if (!pair || !pair.button.isConnected || !pair.panel.isConnected) return;

    // Capture before the older collapse-only listeners on the card surface;
    // otherwise a double-click may close twice or refuse to open.
    event.preventDefault();
    event.stopImmediatePropagation();
    pair.button.click(); // Use the original single-click state/ARIA/scroll logic.
  }, true);
})();
