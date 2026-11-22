/* BEXHR_H12_G4_LIFECYCLE_SINGLE_CLICK_V4_20261113
 * The visible, accessible Expand/Collapse button toggles on one click.
 * Sidebar navigation remains one-click and opens the lifecycle workspace.
 * Existing lifecycle data / authorization / offboard actions are untouched.
 */
(() => {
  'use strict';
  function bind() {
    const card = document.getElementById('hrEmployeeLifecycleCard');
    const toggle = document.getElementById('toggleEmployeeLifecycleCardBtn');
    const panel = document.getElementById('employeeLifecycleCardCollapse');
    if (!card || !toggle || !panel || toggle.dataset.bexhrH12LifecycleCardBound === 'v4') return;

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

    // H12 single-click contract: standard pointer and keyboard click both toggle.
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      flip();
    }, true);

    // Removed legacy double-click handler. Use the visible Expand/Collapse button.

    toggle.title = 'Click to expand or collapse';
    toggle.dataset.bexhrH12LifecycleCardBound = 'v4';

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
