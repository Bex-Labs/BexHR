/* REDESIGN37_HR_UI_004_SELF_SERVICE_FIRST_PAINT
 * One-time presentation handoff shared by HR Admin/Standard, Manager, Employee.
 * Keep the existing authenticated workspace loader visible until the selected
 * self-service view has a real visible card AND Leave authority is resolved.
 * No authentication, leave, payroll, position, tenant or database logic changes.
 */
(function installBexhrR37SelfServiceFirstPaint() {
  'use strict';

  const WAIT_LIMIT_MS = 9000;
  const CHECK_EVERY_MS = 70;
  const BOOT_CLASSES = {
    hr: 'hr-workspace-booting',
    manager: 'manager-workspace-booting',
    employee: 'employee-workspace-booting',
  };

  function shown(element) {
    return Boolean(
      element &&
      !element.hidden &&
      !element.closest('.d-none') &&
      window.getComputedStyle(element).display !== 'none' &&
      element.getClientRects().length > 0
    );
  }

  function getContext(surface) {
    if (surface === 'employee') {
      const leave = document.getElementById('leaveSection');
      const payroll = document.getElementById('payrollSection');
      if (shown(leave)) return { kind: 'leave', section: leave, employee: true };
      if (shown(payroll)) return { kind: 'payroll', section: payroll, employee: true };
      return null;
    }

    const host = document.getElementById(
      surface === 'manager' ? 'managerSelfServiceSection' : 'hrSelfServiceSection'
    );
    if (!shown(host)) return null;

    const leave = document.getElementById('ssLeaveSection');
    const payroll = document.getElementById('ssPayrollSection');
    if (shown(leave)) return { kind: 'leave', section: leave, employee: false };
    if (shown(payroll)) return { kind: 'payroll', section: payroll, employee: false };
    return null;
  }

  function hasSelectedVisibleCard(context) {
    const section = context.section;
    if (context.kind === 'payroll') {
      return Boolean(
        Array.from(section.querySelectorAll('.dashboard-section-card'))
          .some(shown)
      );
    }

    const position = document.documentElement.getAttribute('data-bexhr-h12-leave-position');
    if (position !== 'highest' && position !== 'other') return false;

    const key = context.employee ? 'employeeLeaveView' : 'ssLeaveView';
    const view = section.dataset[key];
    if (!['request', 'balances', 'history', 'decision'].includes(view)) return false;
    if (position === 'highest' && view === 'request') return false;

    const tab = section.querySelector(
      context.employee
        ? '[data-employee-leave-view="' + view + '"]'
        : '[data-ss-leave-view="' + view + '"]'
    );
    if (!tab?.classList.contains('active') || !shown(tab)) return false;

    const ids = context.employee
      ? {
          request: 'leaveRequestForm',
          balances: 'leaveBalancesCardCollapse',
          history: 'leaveHistoryCardCollapse',
          decision: 'latestDecisionCardCollapse',
        }
      : {
          request: 'ssLeaveRequestForm',
          balances: 'ssLeaveBalancesCardCollapse',
          history: 'ssLeaveHistoryCardCollapse',
          decision: 'ssLatestDecisionCardCollapse',
        };
    return shown(document.getElementById(ids[view]));
  }

  function fallback(context) {
    if (!context || context.kind !== 'leave') return;

    // Fail closed: if the selected card cannot paint, switch to the safe
    // Balances pane rather than expose an unverified Request Leave form.
    // A visible History/Decision pane is preserved if only data loading is slow.
    if (!hasSelectedVisibleCard(context)) {
      if (context.employee) {
        window.setEmployeeLeaveView?.('balances');
      } else {
        window.EmployeeSelfService?.show?.('leave', { leaveView: 'balances' });
      }
    }

    if (!document.getElementById('bexhrR37SelfServiceBootNotice')) {
      const notice = document.createElement('p');
      notice.id = 'bexhrR37SelfServiceBootNotice';
      notice.className = 'alert alert-info mb-3';
      notice.setAttribute('role', 'status');
      notice.textContent = 'Leave is taking longer than expected to load. You can review balances or history; please refresh if information is missing.';
      context.section.prepend(notice);
    }
  }

  function waitForReady({ surface, expected = false, isInitialised } = {}) {
    const bootClass = BOOT_CLASSES[surface];
    if (!bootClass || !expected || document.documentElement.classList.contains('bexhr-pa-return')) {
      return Promise.resolve('not-applicable');
    }

    const body = document.body;
    if (!body?.classList.contains(bootClass)) return Promise.resolve('already-visible');

    const started = Date.now();
    return new Promise(resolve => {
      function check() {
        if (!body.classList.contains(bootClass)) {
          resolve('already-released');
          return;
        }

        const context = getContext(surface);
        const initialised = typeof isInitialised !== 'function' || isInitialised() === true;
        if (initialised && context && hasSelectedVisibleCard(context)) {
          resolve('ready');
          return;
        }

        if (Date.now() - started >= WAIT_LIMIT_MS) {
          console.warn('[R37 UI-004] Self-service first paint was delayed; showing a safe fallback.');
          fallback(context);
          window.requestAnimationFrame(() => resolve('timeout'));
          return;
        }
        window.setTimeout(check, CHECK_EVERY_MS);
      }
      check();
    });
  }

  window.BexHRR37SelfServiceFirstPaint = Object.freeze({ waitForReady });
})();
