/* BexHR Group B V14: read-only highest-position leave presentation. */
(function (root) {
  'use strict';
  let current = { id: '', highest: false, verified: false };
  const checkStatuses = new Set(['CONFIGURED_ROOT', 'HIGHEST_OCCUPIED', 'HAS_OCCUPIED_PARENT', 'SETUP_NEEDED']);
  function isHighestCurrent() { return current.verified && current.highest; }
  function syncView() {
    const highest = isHighestCurrent();
    const form = document.getElementById('ssLeaveRequestForm') || document.getElementById('leaveRequestForm');
    const card = form?.closest('.hr-self-service-request-card, .dashboard-form-card');
    const column = card?.closest('.col-12');
    const mainRow = column?.closest('.ss-leave-main-row');
    const history = mainRow?.querySelector('.hr-self-service-history-card')?.closest('.col-12');
    if (!card || !mainRow) return;
    // Presentation only: existing server-side Primary Manager requirement is untouched.
    if (column) column.style.setProperty('display', highest ? 'none' : '', highest ? 'important' : '');
    if (history) {
      history.classList.toggle('col-xl-12', highest);
      history.classList.toggle('col-xl-7', !highest);
    }
    // BEXHR_GROUP_B_V15_PATCH: hide the request tab and redirect to usable leave balances.
    const tabs = document.querySelectorAll('[data-employee-leave-view="request"], [data-ss-leave-view="request"]');
    tabs.forEach(tab => {
      tab.hidden = highest;
      if (highest) tab.style.setProperty('display', 'none', 'important');
      else tab.style.removeProperty('display');
    });
    const leaveSection = mainRow.closest('#ssLeaveSection, #leaveSection');
    if (highest && leaveSection?.id === 'ssLeaveSection' &&
        leaveSection.dataset.ssLeaveView === 'request') {
      root.EmployeeSelfService?.showLeaveView?.('balances');
    }
    // BEXHR_GROUP_B_V16_PATCH: restore the selected content if a Manager/HR tab was switched
    // while the Leave section was hidden. Keep History/Decision selection intact.
    if (highest && leaveSection?.id === 'ssLeaveSection') {
      const parent = leaveSection.closest('#managerSelfServiceSection, #hrSelfServiceSection');
      const parentVisible = parent && !parent.classList.contains('d-none');
      const managerLeave = document.getElementById('sidebarManagerSelfServiceLeaveBtn');
      const hrLeave = document.getElementById('sidebarSelfServiceLeaveBtn');
      const leaveSelected = Boolean(managerLeave?.classList.contains('active') ||
        hrLeave?.classList.contains('active'));
      const view = leaveSection.dataset.ssLeaveView;
      const balancesCard = document.getElementById('ssLeaveBalancesCardCollapse')?.closest('.dashboard-section-card');
      const balancedButHidden = view === 'balances' && balancesCard?.classList.contains('d-none');
      if (parentVisible && leaveSelected &&
          (leaveSection.classList.contains('d-none') || !view || view === 'request' || balancedButHidden)) {
        root.EmployeeSelfService?.show?.('leave', {
          leaveView: view === 'history' || view === 'decision' ? view : 'balances',
        });
      }
      // BEXHR_GROUP_B_V17_PATCH: the Manager-focused navigation can leave the shared leave
      // section or its content hidden after an async route completes. Ensure
      // verified top-level users see their real balances, without allowing a
      // leave request or changing any decision, data or entitlement.
      if (parentVisible && leaveSelected && parent.id === 'managerSelfServiceSection') {
        const chosen = leaveSection.dataset.ssLeaveView;
        if (!chosen || chosen === 'request' || chosen === 'balances') {
          leaveSection.classList.remove('d-none');
          const balances = document.getElementById('ssLeaveBalancesCardCollapse');
          const balanceCard = balances?.closest('.dashboard-section-card');
          balanceCard?.classList.remove('d-none');
          balances?.classList.remove('d-none');
          if (leaveSection.dataset.ssLeaveView !== 'balances') {
            root.EmployeeSelfService?.showLeaveView?.('balances');
          }
        }
      }
    }
    // Show a meaningful task label for a highest occupant, rather than
    // suggesting that a new leave request is available.
    ['sidebarManagerSelfServiceLeaveBtn','sidebarSelfServiceLeaveBtn'].forEach(id => {
      const label = document.getElementById(id)?.querySelector('span');
      if (label) label.textContent = highest ? 'Leave balances' : 'Leave';
    });
    let notice = document.getElementById('bexhrGroupBV14HighestLeaveNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'bexhrGroupBV14HighestLeaveNotice';
      notice.className = 'alert alert-info border mb-3';
      notice.setAttribute('role', 'status');
      notice.textContent = 'This is the highest occupied organisational position. No higher approving Primary Manager is available; leave balances and history remain accessible.';
      const leaveSection = mainRow.closest('#ssLeaveSection, #leaveSection');
      const viewTabs = leaveSection?.querySelector('#ssLeaveInlineTabs, #employeeLeaveInlineTabs');
      if (viewTabs) viewTabs.after(notice); else mainRow.before(notice);
    }
    notice.hidden = !highest;
    notice.classList.toggle('d-none', !highest);
    if (highest && document.getElementById('leaveSection')) {
      // Employee navigation must never reopen the hidden Request Leave pane.
      const leave = document.getElementById('leaveSection');
      if (leave.dataset.employeeLeaveView === 'request' && typeof root.setEmployeeLeaveView === 'function') {
        root.setEmployeeLeaveView('balances');
      }
    }
  }
  async function apply(client, employeeId) {
    const id = String(employeeId || '').trim();
    current = { id, highest: false, verified: false };
    if (!id || !client || typeof client.rpc !== 'function') { syncView(); return false; }
    try {
      const { data, error } = await client.rpc('bexhr_p7b_my_organization_position', { p_employee_id: id });
      if (!error && data && checkStatuses.has(data.status) && current.id === id) {
        current = { id, highest: data.status === 'CONFIGURED_ROOT' || data.status === 'HIGHEST_OCCUPIED', verified: true };
      }
    } catch (_) { /* Neutral UI on transient lookup error; leave server readiness remains authoritative. */ }
    syncView();
    return current.verified;
  }
  root.BexHRGroupBV14Leave = Object.freeze({ apply, isHighestCurrent, syncView });
})(window);
