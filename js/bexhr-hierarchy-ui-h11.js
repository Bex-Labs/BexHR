/* BEXHR_STAGING_HIERARCHY_UX_V2: display-only improvements, no writes. */
(function () {
  'use strict';
  let applied = false;
  function mount() {
    if (applied) return true;
    const shell = document.getElementById('hrOrganizationInternalWorkspace');
    const steps = document.getElementById('bexhrStagingReportingSteps');
    if (!shell || !steps || !steps.querySelector('[data-reporting-step="reportingLines"]')) return false;
    applied = true;

    // Remove only the redundant V1 chart UI. Its existing saved reporting data stays intact.
    steps.querySelector('[data-reporting-step="chart"]')?.remove();
    document.getElementById('bexhrStagingHierarchyChart')?.remove();

    const mainTab = shell.querySelector('[data-hr-setup-workspace-button="departments"]');
    const mainTabLabel = mainTab?.querySelector('span');
    if (mainTabLabel) mainTabLabel.textContent = 'Reporting Structure';
    mainTab?.setAttribute('aria-label', 'Reporting Structure: departments, job titles and reporting lines');

    const childLabel = document.querySelector('label[for="bexhrH6CChild"]');
    const parentLabel = document.querySelector('label[for="bexhrH6CParent"]');
    if (childLabel) childLabel.textContent = 'Position that reports';
    if (parentLabel) parentLabel.textContent = 'Supervisor position';
    // BEXHR_STAGING_REPORTING_V4: one short instruction; saved relationships
    // and Review/Save approval sequence stay unchanged.
    const editorNote = document.querySelector('#bexhrH6CManualPositionEditor > p');
    if (editorNote) editorNote.textContent = 'Choose a position and its supervisor. Review the change, then confirm and Save.';

    const explanation = document.createElement('p');
    explanation.id = 'bexhrStagingReportingHelpV2';
    explanation.className = 'small text-secondary mt-2 mb-3';
    explanation.textContent = 'Any job title may report upward. Regular-employee-only positions cannot supervise other positions.';
    steps.insertAdjacentElement('afterend', explanation);
    function syncExplanation() {
      explanation.hidden = !['departments', 'jobTitles', 'reportingLines'].includes(String(shell.dataset.activePanel || ''));
    }
    new MutationObserver(syncExplanation).observe(shell, { attributes:true, attributeFilter:['data-active-panel'] });
    syncExplanation();

    const style = document.createElement('style');
    style.id = 'bexhrStagingHierarchySpacingV2';
    style.textContent = `
      #hrOrganizationInternalWorkspace #bexhrStagingReportingSteps {
        display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr));
        gap:12px; margin:16px 0 12px; align-items:stretch;
      }
      #hrOrganizationInternalWorkspace #bexhrStagingReportingSteps[hidden] { display:none !important; }
      #hrOrganizationInternalWorkspace #bexhrStagingReportingSteps > .bexhr-rs-step {
        width:100%; min-width:0; text-align:center; padding:14px 16px;
        line-height:1.45; min-height:54px; border-radius:12px;
      }
      #bexhrStagingHierarchyChart, [data-reporting-step="chart"] { display:none !important; }
      #hrOrganizationInternalWorkspace .bexhr-rs-explanation { margin:18px 0 12px; }
      #hrOrganizationInternalWorkspace #bexhrRsManagerRoleHint { margin-top:12px; }
      #hrOrganizationInternalWorkspace #bexhrStagingReportingHelpV2 { max-width:75ch; }
      @media(max-width:740px) {
        #hrOrganizationInternalWorkspace #bexhrStagingReportingSteps {
          grid-template-columns:1fr; gap:8px;
        }
      }
    `;
    document.head.append(style);
    return true;
  }
  function mountShortcutIdentity() {
    const modal = document.getElementById('hrSupportingManagerModal');
    if (!modal || modal.dataset.bexhrStagingShortcutIdentity === '1') return;
    modal.dataset.bexhrStagingShortcutIdentity = '1';
    const name = modal.querySelector('#hrSupportingManagerEmployeeName');
    const summary = modal.querySelector('.hr-access-modal-heading');
    if (!name || !summary) return;
    const detail = document.createElement('p');
    detail.id = 'bexhrStagingShortcutEmployeeLabel';
    detail.className = 'small fw-semibold mb-2';
    detail.setAttribute('aria-live', 'polite');
    summary.querySelector('#hrSupportingManagerModalDescription')?.before(detail);
    function updateName() {
      const who = String(name.textContent || '').trim();
      detail.textContent = who && who !== 'Employee'
        ? 'Managing reporting for: ' + who : 'Loading employee reporting...';
    }
    new MutationObserver(updateName).observe(name, { childList:true, subtree:true, characterData:true });
    updateName();
  }
  function initialize() {
    if (!mount()) {
      let attempts = 0;
      const interval = setInterval(() => {
        if (mount() || ++attempts >= 140) clearInterval(interval);
      }, 100);
    }
    mountShortcutIdentity();
    // The shortcut dialog is created on demand; observe only direct body children.
    new MutationObserver(mountShortcutIdentity).observe(document.body, { childList:true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once:true });
  } else initialize();
})();