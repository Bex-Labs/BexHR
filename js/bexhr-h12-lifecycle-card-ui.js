/* BEXHR_H12_G4_LIFECYCLE_DBLCLICK_V3_20261111
 * Fix: no pointer single-click collapse/expand handler is registered.
 * Pointer double-click on the header/blank card surface or the toggle
 * expands/collapses in both directions. Keyboard Enter/Space remains accessible.
 * Sidebar navigation remains a normal single-click action.
 * No employee, leave, payroll, PA or permission behaviour is modified.
 */
(() => {
  'use strict';
  function bind() {
    const card = document.getElementById('hrEmployeeLifecycleCard');
    const toggle = document.getElementById('toggleEmployeeLifecycleCardBtn');
    const panel = document.getElementById('employeeLifecycleCardCollapse');
    if (!card || !toggle || !panel || toggle.dataset.bexhrH12LifecycleCardBound === 'v3') return;

    // Intentionally DO NOT call bindCardCollapseToggle(toggle, panel).
    // That native helper registers a pointer single-click action.
    function setExpanded(expand) {
      panel.classList.toggle('d-none', !expand);
      toggle.setAttribute('aria-expanded', String(expand));
      const icon = toggle.querySelector('i');
      const label = toggle.querySelector('span');
      if (icon) icon.className = expand ? 'bi bi-chevron-up me-2' : 'bi bi-chevron-down me-2';
      if (label) label.textContent = expand ? 'Collapse' : 'Expand';
    }
    function flip() {
      setExpanded(panel.classList.contains('d-none'));
    }

    // Suppress pointer single-clicks on the toggle. Retain Enter/Space,
    // whose native button click event has detail === 0.
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.detail === 0) flip();
    }, true);

    // One delegated double-click handler; works with open and closed cards.
    card.addEventListener('dblclick', (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const interactive = target.closest('button, a, input, select, textarea, label, table, summary, [contenteditable="true"], [role="button"], [role="link"]');
      if (interactive && interactive !== toggle) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      flip();
    }, true);

    toggle.title = 'Double-click to expand or collapse; Enter/Space also works';
    toggle.dataset.bexhrH12LifecycleCardBound = 'v3';

    // Deliberate exception: selecting Employee Lifecycle from the sidebar
    // must open the relevant view with a single click.
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest('[data-hr-navigation-task="people.lifecycle"], [data-hr-focused-navigation-task="people.lifecycle"]')) return;
      setExpanded(true);
    }, true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
