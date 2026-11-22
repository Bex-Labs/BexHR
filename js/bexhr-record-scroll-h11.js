/* BEXHR_STAGING_SCROLL_V3: native wheel scroll for all BexHR dashboards.
 * No document-level wheel handler. No event.preventDefault() calls.
 * The existing 10-record table-height policy remains unchanged.
 * Presentation only; no DB, permissions, reporting, PA, or Leave changes.
 */
(function () {
  'use strict';
  if (document.getElementById('bexhrStagingRecordScrollStyle')) return;
  const style = document.createElement('style');
  style.id = 'bexhrStagingRecordScrollStyle';
  style.textContent = `
    [id$="TableWrapper"], .table-responsive, .dashboard-table-wrap,
    [class*="table-scroll"], [class*="records-scroll"] {
      scrollbar-width: thin;
      overscroll-behavior-y: auto !important;
    }
    .dashboard-section-card, .hr-setup-internal-panel, .card,
    .admin-panel, .hr-employee-access-modal-body {
      overscroll-behavior-y: auto !important;
    }
    [id$="TableWrapper"]::-webkit-scrollbar, .table-responsive::-webkit-scrollbar,
    .dashboard-table-wrap::-webkit-scrollbar { width: 11px; height: 11px; }
    [id$="TableWrapper"]::-webkit-scrollbar-thumb, .table-responsive::-webkit-scrollbar-thumb,
    .dashboard-table-wrap::-webkit-scrollbar-thumb {
      border-radius: 6px; background: #a7b8c3; border: 2px solid transparent;
      background-clip: padding-box;
    }
    [id$="TableWrapper"]:focus-visible, .table-responsive:focus-visible,
    .dashboard-table-wrap:focus-visible { outline: 2px solid #13a5a2; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
})();