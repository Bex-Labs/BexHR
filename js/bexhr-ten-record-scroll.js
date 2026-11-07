/**
 * BexHR record-table scroll policy (presentation only).
 * Show up to ten displayed DATA records at natural height.
 * Activate a height-bounded, keyboard-accessible inner list only with 11+.
 * The height of 10 actual rows is measured so browser zoom/text enlargement
 * does not silently reduce the number of visible records.
 *
 * Applies only to record-table wrappers across authenticated dashboards.
 * Excludes dialogs/forms/navigation, PA goal lists and the two People lists
 * which already implement this same threshold in Phase 7A6.
 */
(function () {
  'use strict';

  const LIMIT = 10;
  const TABLE_WRAPPER_SELECTOR = '[id$="TableWrapper"], .hr-batch-review-table-wrap';
  const EXCLUDED_IDS = new Set(['employeeRecordsTableWrapper', 'hrEmployeeLifecycleTableWrapper']);
  const EXCLUDED_CONTAINERS = '.modal, [role="dialog"], .offcanvas, .dropdown-menu, .hr-employee-details-modal';
  const EXCLUDED_DATA_ROWS = '.d-none, [hidden], .hr-employee-directory-loading-row, .bexhr-table-placeholder, .hr-payroll-breakdown-row';
  const tracked = new Map();
  let pending = false;

  function visibleRecordRows(tbody) {
    if (!tbody) return [];
    return Array.from(tbody.children).filter(function (row) {
      if (String(row.tagName).toUpperCase() !== 'TR') return false;
      if (row.matches && row.matches(EXCLUDED_DATA_ROWS)) return false;
      if (row.getAttribute && row.getAttribute('aria-hidden') === 'true') return false;
      if (row.style && row.style.display === 'none') return false;
      // CSS-hidden rows created by client-side filtering are not records on screen.
      if (typeof getComputedStyle === 'function' && getComputedStyle(row).display === 'none') return false;
      return true;
    });
  }

  function recordTableFor(wrapper) {
    const table = wrapper.querySelector('table');
    if (!table) return null;
    const tbody = table.tBodies && table.tBodies[0] || table.querySelector('tbody');
    return tbody ? { table: table, tbody: tbody } : null;
  }

  function isSupported(wrapper) {
    if (!wrapper || EXCLUDED_IDS.has(wrapper.id)) return false;
    if (wrapper.closest && wrapper.closest(EXCLUDED_CONTAINERS)) return false;
    return !!recordTableFor(wrapper);
  }

  function canMeasure(wrapper) {
    if (!wrapper.isConnected) return false;
    const box = wrapper.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function setPolicy(wrapper, moreThanTen, maxHeight) {
    const style = wrapper.style;
    style.setProperty('max-height', moreThanTen ? String(maxHeight) + 'px' : 'none', 'important');
    style.setProperty('overflow-y', moreThanTen ? 'auto' : 'visible', 'important');
    style.setProperty('scrollbar-gutter', moreThanTen ? 'stable' : 'auto', 'important');
    wrapper.dataset.bexhrTenRecordScroll = moreThanTen ? 'on' : 'off';
    if (!moreThanTen && wrapper.scrollTop !== 0) wrapper.scrollTop = 0;
    const state = tracked.get(wrapper);
    if (moreThanTen && state && !wrapper.hasAttribute('tabindex')) {
      wrapper.setAttribute('tabindex', '0');
      state.addedTabindex = true;
    } else if (!moreThanTen && state && state.addedTabindex) {
      wrapper.removeAttribute('tabindex');
      state.addedTabindex = false;
    }
  }

  function fitTable(wrapper, tbody) {
    const rows = visibleRecordRows(tbody);
    const count = rows.length;
    if (!canMeasure(wrapper)) return;
    if (count <= LIMIT) {
      setPolicy(wrapper, false, 0);
      return;
    }

    // The eleventh visible record is the cutoff, not a fixed 420-620px cap.
    const nextRow = rows[LIMIT];
    const outerBox = wrapper.getBoundingClientRect();
    const rowBox = nextRow.getBoundingClientRect();
    // getBoundingClientRect includes CSS zoom, whereas max-height uses local
    // CSS pixels. Normalise to the wrapper's layout width before applying.
    const zoomScale = wrapper.offsetWidth > 0
      ? outerBox.width / wrapper.offsetWidth : 1;
    const safeScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
    const size = (rowBox.top - outerBox.top) / safeScale + wrapper.scrollTop - 2;
    if (!Number.isFinite(size) || size < 48) return;
    setPolicy(wrapper, true, Math.ceil(size));
  }

  function refresh() {
    pending = false;
    for (const [wrapper, state] of tracked) {
      if (!wrapper.isConnected) {
        state.observer.disconnect();
        if (state.resizeObserver) state.resizeObserver.disconnect();
        tracked.delete(wrapper);
        continue;
      }
      fitTable(wrapper, state.tbody);
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(refresh);
  }

  function attach() {
    for (const wrapper of document.querySelectorAll(TABLE_WRAPPER_SELECTOR)) {
      if (!isSupported(wrapper) || tracked.has(wrapper)) continue;
      const tableInfo = recordTableFor(wrapper);
      const observer = new MutationObserver(schedule);
      observer.observe(tableInfo.tbody, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
      });
      const state = { tbody: tableInfo.tbody, observer: observer, addedTabindex: false, resizeObserver: null };
      if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(tableInfo.table);
        state.resizeObserver = resizeObserver;
      }
      tracked.set(wrapper, state);
    }
    schedule();
  }

  function refreshLater() {
    attach();
    window.setTimeout(schedule, 50);
    window.setTimeout(schedule, 250);
  }

  window.BexHrTenRecordScroll = Object.freeze({
    limit: LIMIT,
    refresh: function () { attach(); schedule(); },
    trackedCount: function () { return tracked.size; },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
  window.addEventListener('resize', refreshLater);
  window.addEventListener('pageshow', refreshLater);
  window.addEventListener('hashchange', refreshLater);
  document.addEventListener('click', refreshLater);
  document.addEventListener('input', refreshLater);
  document.addEventListener('change', refreshLater);
})();
