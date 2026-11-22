/* REDESIGN37_HR_UI_002_ALWAYS_OPEN_V2
 * HR Admin card presentation only.
 * Preserve navigation, forms, permissions and database functionality.
 */
(() => {
  'use strict';

  if (!document.body?.classList.contains('bexhr-hr-visual-refresh')) return;
  if (window.BexHRHrUi002AlwaysOpen) return;

  const pairs = [
    ['toggleManagerLeaveDecisionsBtn', 'managerLeaveDecisionsCollapse'],
    ['toggleOrganizationSettingsCardBtn', 'organizationSettingsCardCollapse'],
    ['toggleCompanyAdminAuditHistoryBtn', 'companyAdminAuditHistoryCollapse'],
    ['toggleEmployeeFormCardBtn', 'employeeFormCardCollapse'],
    ['toggleEmployeeListCardBtn', 'employeeListCardCollapse'],
    ['toggleEmployeeLifecycleCardBtn', 'employeeLifecycleCardCollapse'],
    ['toggleHrp85EmailIntegrationCardBtn', 'hrp85EmailIntegrationCardCollapse'],
    ['toggleBankDirectoryCardBtn', 'bankDirectoryCardCollapse'],
    ['toggleEmployeeBankDetailsCardBtn', 'employeeBankDetailsCardCollapse'],
    ['togglePayrollMasterCardBtn', 'payrollMasterCardCollapse'],
    ['togglePayrollAllowanceCardBtn', 'payrollAllowanceCardCollapse'],
    ['togglePayrollStatutoryCardBtn', 'payrollStatutoryCardCollapse'],
    // REDESIGN37_HR_UI_002_R1_DEDUCTIONS_TAB: Other Deductions is a category tab, not an always-open card.
    ['togglePayrollEmployeeOverrideCardBtn', 'payrollEmployeeOverrideCardCollapse'],
    ['togglePayrollRecordCardBtn', 'payrollRecordCardCollapse'],
    ['togglePayrollRecordsCardBtn', 'payrollRecordsCardCollapse'],
    ['ssToggleLeaveBalancesCardBtn', 'ssLeaveBalancesCardCollapse'],
    ['ssToggleLatestDecisionCardBtn', 'ssLatestDecisionCardCollapse'],
    ['ssToggleLeaveHistoryCardBtn', 'ssLeaveHistoryCardCollapse'],
    ['ssTogglePayrollHistoryCardBtn', 'ssPayrollHistoryCardCollapse'],
    ['toggleProfileCorrectionRequestsBtn', 'profileCorrectionRequestsCollapse']
  ];

  const managed = new Map();

  function attach(button, panel) {
    if (!button || !panel || managed.get(button) === panel) return;

    managed.set(button, panel);

    function keepOpen() {
      if (!button.hidden) button.hidden = true;

      if (button.getAttribute('aria-hidden') !== 'true') {
        button.setAttribute('aria-hidden', 'true');
      }

      if (button.getAttribute('aria-expanded') !== 'true') {
        button.setAttribute('aria-expanded', 'true');
      }

      if (
        button.style.getPropertyValue('display') !== 'none' ||
        button.style.getPropertyPriority('display') !== 'important'
      ) {
        button.style.setProperty('display', 'none', 'important');
      }

      if (panel.hidden) panel.hidden = false;

      if (panel.classList.contains('d-none')) {
        panel.classList.remove('d-none');
      }

      if (panel.style.getPropertyValue('display') === 'none') {
        panel.style.removeProperty('display');
      }
    }

    const observer = new MutationObserver(keepOpen);

    observer.observe(button, {
      attributes: true,
      attributeFilter: ['hidden', 'aria-expanded', 'style']
    });

    observer.observe(panel, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style']
    });

    keepOpen();
  }

  function scan() {
    for (const [buttonId, panelId] of pairs) {
      attach(
        document.getElementById(buttonId),
        document.getElementById(panelId)
      );
    }

    document
      .querySelectorAll(
        '.dashboard-section-card button[aria-expanded][aria-controls]'
      )
      .forEach(button => {
        if (!/^(?:collapse|expand)$/i.test(button.textContent.trim())) {
          return;
        }

        const panelId = button.getAttribute('aria-controls');

        if (!/Collapse$/.test(panelId || '') || panelId === 'payrollOtherDeductionCardCollapse') return;

        attach(button, document.getElementById(panelId));
      });
  }

  let scheduled = false;

  const treeObserver = new MutationObserver(mutations => {
    if (scheduled || !mutations.some(m => m.addedNodes.length)) {
      return;
    }

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });

  treeObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  scan();

  window.addEventListener('load', scan, { once: true });

  window.BexHRHrUi002AlwaysOpen = Object.freeze({
    verify: () => {
      const entries = [...managed];

      return {
        managedCardButtons: entries.length,

        visibleCardButtons: entries
          .filter(([button]) =>
            !button.hidden &&
            getComputedStyle(button).display !== 'none'
          )
          .map(([button]) => button.id),

        collapsedCardBodies: entries
          .filter(([, panel]) =>
            panel.hidden || panel.classList.contains('d-none')
          )
          .map(([, panel]) => panel.id)
      };
    }
  });
})();