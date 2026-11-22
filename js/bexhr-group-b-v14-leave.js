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
      // BEXHR_H12_HIGHEST_LEAVE_VISIBLE_20261114
      // Restore only the verified highest occupant's selected Leave view.
      if (parentVisible && leaveSelected &&
          ['balances', 'history', 'decision'].includes(leaveSection.dataset.ssLeaveView)) {
        leaveSection.hidden = false;
        leaveSection.classList.remove('d-none');
        leaveSection.style.removeProperty('display');
        if (root.getComputedStyle(leaveSection).display === 'none') {
          leaveSection.style.setProperty('display', 'block');
        }
      }
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
  // BEXHR_EMPLOYEE_UI_002_20261119
  // Keep the last verified Employee Leave display during background checks.
  // New identities and failed checks retain the original protective gate.
  let employeePositionApplySequence = 0;

  async function apply(client, employeeId) {
    const id = String(employeeId || '').trim();
    const sequence = ++employeePositionApplySequence;

    const keepVerifiedEmployeeView = Boolean(
      id &&
      current.id === id &&
      current.verified &&
      document.body?.classList.contains('bexhr-employee-visual-refresh')
    );

    if (!keepVerifiedEmployeeView) {
      current = { id, highest: false, verified: false };
      // BEXHR_H12_LEAVE_AUTHORITY_BOOT_GATE_20261114
      document.documentElement.removeAttribute('data-bexhr-h12-leave-position');
    }

    if (!id || !client || typeof client.rpc !== 'function') {
      current = { id, highest: false, verified: false };
      document.documentElement.removeAttribute('data-bexhr-h12-leave-position');
      syncView();
      return false;
    }

    let next = { id, highest: false, verified: false };

    try {
      const { data, error } = await client.rpc(
        'bexhr_p7b_my_organization_position',
        { p_employee_id: id }
      );

      if (!error && data && checkStatuses.has(data.status)) {
        next = {
          id,
          highest: data.status === 'CONFIGURED_ROOT' ||
                   data.status === 'HIGHEST_OCCUPIED',
          verified: true
        };
      }
    } catch (_) {
      // A failed verification must not grant Leave access.
    }

    if (sequence !== employeePositionApplySequence ||
        current.id !== id) {
      return false;
    }

    current = next;
    syncView();

    if (current.verified) {
      document.documentElement.setAttribute(
        'data-bexhr-h12-leave-position',
        current.highest ? 'highest' : 'other'
      );
    } else {
      document.documentElement.removeAttribute(
        'data-bexhr-h12-leave-position'
      );
    }

    return current.verified;
  }
  root.BexHRGroupBV14Leave = Object.freeze({ apply, isHighestCurrent, syncView });
})(window);

/* BEXHR_H12_SHARED_LEAVE_LOADER_HANDOFF_20261114
 * Retain the existing BexHR first-paint loader until the selected Leave card
 * is actually ready. This does not query the server or change leave authority.
 */
(function installBexhrSharedLeaveLoaderHandoff() {
  'use strict';
  const body = document.body;
  const loader = document.getElementById('bexhrWorkspaceLoader');
  if (!body || !loader || document.documentElement.classList.contains('bexhr-pa-return')) return;
  // BEXHR_H12_MANAGER_NATIVE_LOADER_READY_20261114
  if (body.classList.contains('manager-workspace-booting')) return;

  const bootClasses = ['manager-workspace-booting', 'hr-workspace-booting', 'employee-workspace-booting'];
  const booting = () => bootClasses.some(name => body.classList.contains(name));
  if (!booting()) return; // Only the initial page load; never re-open on later navigation.

  const HOLD_CLASS = 'bexhr-h12-leave-loader-hold';
  let holding = false;
  let finished = false;
  let timeout = 0;

  function leaveContext() {
    const manager = document.getElementById('managerSelfServiceSection');
    if (manager && !manager.classList.contains('d-none') &&
        document.getElementById('sidebarManagerSelfServiceLeaveBtn')?.classList.contains('active')) {
      return { section: document.getElementById('ssLeaveSection'), shared: true };
    }
    const hr = document.getElementById('hrSelfServiceSection');
    if (hr && !hr.classList.contains('d-none') &&
        document.getElementById('sidebarSelfServiceLeaveBtn')?.classList.contains('active')) {
      return { section: document.getElementById('ssLeaveSection'), shared: true };
    }
    const employee = document.getElementById('leaveSection');
    if (employee && !employee.classList.contains('d-none')) {
      return { section: employee, shared: false };
    }
    return null;
  }

  function displayed(element) {
    if (!element || element.hidden || element.closest('.d-none') ||
        window.getComputedStyle(element).display === 'none') return false;
    return element.getClientRects().length > 0;
  }

  function cardReady(context) {
    const position = document.documentElement.getAttribute('data-bexhr-h12-leave-position');
    if (position !== 'highest' && position !== 'other') return false;
    if (!displayed(context.section)) return false;

    const viewKey = context.shared ? 'ssLeaveView' : 'employeeLeaveView';
    let view = context.section.dataset[viewKey] || 'request';
    if (position === 'highest' && view === 'request') view = 'balances';
    const cards = context.shared
      ? {
          request: 'ssLeaveRequestForm', balances: 'ssLeaveBalancesCardCollapse',
          history: 'ssLeaveHistoryCardCollapse', decision: 'ssLatestDecisionCardCollapse'
        }
      : {
          request: 'leaveRequestForm', balances: 'leaveBalancesCardCollapse',
          history: 'leaveHistoryCardCollapse', decision: 'latestDecisionCardCollapse'
        };
    return displayed(document.getElementById(cards[view] || cards.balances));
  }

  const observer = new MutationObserver(check);
  function finish() {
    if (finished) return;
    finished = true;
    observer.disconnect();
    if (timeout) window.clearTimeout(timeout);
    body.classList.remove(HOLD_CLASS);
  }

  function check() {
    if (finished) return;
    const context = leaveContext();
    if (!holding && booting() && context) {
      holding = true;
      body.classList.add(HOLD_CLASS);
    }
    if (!holding) {
      if (!booting()) finish();
      return;
    }
    if (!context || cardReady(context)) finish();
  }

  // Observe only through first paint, then disconnect; no ongoing navigation hooks.
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-bexhr-h12-leave-position',
      'data-ss-leave-view', 'data-employee-leave-view'],
    childList: true,
    subtree: true
  });

  // Network/identity faults must not trap users behind the loader indefinitely.
  timeout = window.setTimeout(() => {
    if (finished) return;
    if (holding) {
      const context = leaveContext();
      if (context && !cardReady(context)) {
        if (context.shared) {
          window.EmployeeSelfService?.show?.('leave', { leaveView: 'balances' });
        } else {
          window.setEmployeeLeaveView?.('balances');
        }
        const section = context.section;
        if (section && !document.getElementById('bexhrH12LeaveBootStatus')) {
          const status = document.createElement('p');
          status.id = 'bexhrH12LeaveBootStatus';
          status.className = 'alert alert-info mb-3';
          status.setAttribute('role', 'status');
          status.textContent = 'Leave is taking longer than expected to prepare. You can review balances or history; refresh if the expected option is missing.';
          section.prepend(status);
        }
      }
    }
    finish();
  }, 9000);
  check();
})();
