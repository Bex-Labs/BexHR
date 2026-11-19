/* BEXHR_H12_SAFE_CARD_DBLCLICK_V1
 * Non-interactive surface double-click toggles an existing, explicitly paired
 * expand/collapse card in BOTH directions. Reuses the original button.click()
 * so original state, labels, ARIA, loading and form handlers remain canonical.
 * No role, tenant, RLS, payroll, PA, Leave, create/update/delete permissions.
 */
(() => {
  'use strict';
  if (window.__bexhrSafeCardDoubleClickV1) return;
  window.__bexhrSafeCardDoubleClickV1 = true;

  const excluded = [
    'button', 'a', 'input', 'select', 'textarea', 'label', 'summary',
    'table', '[role="button"]', '[role="link"]', '[contenteditable]',
    '[data-bs-toggle]', '.table-responsive', '[class*="table-scroll"]',
    '[class*="history-scroll"]', '[class*="records-scroll"]'
  ].join(', ');

  function resolveCardPair(card) {
    if (card.id === 'hrEmployeeLifecycleCard') return null; // H12 custom behaviour already correct.
    const candidates = Array.from(card.querySelectorAll('button[aria-controls]'))
      .filter(button => {
        const targetId = button.getAttribute('aria-controls');
        if (!targetId || !/CardCollapse$|Collapse$/.test(targetId)) return false;
        const panel = document.getElementById(targetId);
        return panel && panel.closest('.dashboard-section-card') === card &&
          button.closest('.dashboard-section-card') === card &&
          !button.hasAttribute('disabled') &&
          !button.hasAttribute('data-bs-toggle');
      });
    // If the container has multiple panels, its shell is ambiguous: fail closed.
    if (candidates.length !== 1) return null;
    return candidates[0];
  }

  document.addEventListener('dblclick', event => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(excluded)) return;
    const card = target.closest('.dashboard-section-card');
    if (!card || target.closest('[data-bexhr-dblclick-exclude]')) return;
    const button = resolveCardPair(card);
    if (!button) return;
    // Some card shells have an existing collapse-only dblclick listener. Run
    // this at capture phase so precisely one toggle occurs, open OR closed.
    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  }, true);
})();
