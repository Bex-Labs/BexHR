/* BexHR Phase 7B - small, data-driven organisation setup reminder.
 * Admin-only display. No localStorage completion flag, no writes, no permissions.
 * State comes from the existing tenant-scoped HR setup refresh.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.attach(root);
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function evaluate({ canMaintain = false, loaded = false, activeDepartments = 0,
    activeTitles = 0, unconfiguredPositions = 0, activeLinks = 0 } = {}) {
    if (!canMaintain || !loaded) return { show: false, complete: false, stage: 'hidden' };
    const hasDepartment = activeDepartments > 0;
    const hasTitle = activeTitles > 0;
    const hasReporting = hasTitle && activeLinks > 0 && unconfiguredPositions === 0;
    const complete = hasDepartment && hasTitle && hasReporting;
    const count = Number(hasDepartment) + Number(hasTitle) + Number(hasReporting);
    const firstTime = !hasDepartment && !hasTitle;
    return {
      show: !complete, complete, count, firstTime,
      stage: !hasDepartment ? 'departments' : !hasTitle ? 'jobTitles' : 'reporting',
    };
  }
  function attach(root) {
    if (root.__bexhrOrgSetupGuideAttached) return;
    root.__bexhrOrgSetupGuideAttached = true;
    const doc = root.document;
    function showStage(stage) {
      doc.getElementById('sidebarSetupOrganizationBtn')?.click();
      const panelName = stage === 'departments' ? 'departments' : 'jobTitles';
      root.setTimeout(() => {
        const panelButton = doc.querySelector(
          `#hrOrganizationInternalWorkspace [data-hr-setup-workspace-button="${panelName}"]`,
        );
        panelButton?.click();
        const section = panelName === 'departments'
          ? doc.getElementById('organizationDepartmentsSection')
          : doc.getElementById('organizationJobTitlesSection');
        section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
    root.addEventListener('bexhr:organization-setup-updated', (event) => {
      const target = doc.getElementById('hrDashboardSection');
      if (!target) return;
      const state = evaluate(event.detail || {});
      let banner = doc.getElementById('bexhrOrganizationSetupGuide');
      if (!state.show) {
        banner?.remove();
        return;
      }
      if (!banner) {
        banner = doc.createElement('aside');
        banner.id = 'bexhrOrganizationSetupGuide';
        banner.className = 'bexhr-setup-compact';
        banner.setAttribute('aria-label', 'Organisation setup guidance');
        target.insertBefore(banner, target.firstChild);
      }
      // Text-only DOM construction: never interpret tenant data as HTML.
      const headline = state.firstTime ? 'Set up your organisation' : 'Organisation setup';
      const detail = state.stage === 'departments'
        ? 'Add departments'
        : state.stage === 'jobTitles'
          ? 'Add job titles'
          : event.detail?.wholeOrganizationPositions === 0
            ? 'Add a company-wide position'
            : 'Connect your reporting positions';
      banner.replaceChildren();
      const copy = doc.createElement('div');
      copy.className = 'bexhr-setup-compact-copy';
      const heading = doc.createElement('strong');
      heading.className = 'bexhr-setup-compact-title';
      heading.textContent = headline;
      const body = doc.createElement('span');
      body.className = 'bexhr-setup-compact-detail';
      body.textContent = detail;
      copy.append(heading, body);
      const footer = doc.createElement('div');
      footer.className = 'bexhr-setup-compact-actions';
      const progress = doc.createElement('span');
      progress.className = 'bexhr-setup-compact-progress';
      progress.textContent = `${state.count} of 3 done`;
      progress.setAttribute('aria-label', `${state.count} of 3 organisation setup steps completed`);
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-primary bexhr-setup-compact-button';
      button.textContent = 'Continue organisation setup';
      button.addEventListener('click', () => showStage(state.stage));
      footer.append(progress, button);
      banner.append(copy, footer);
    });
  }
  return Object.freeze({ evaluate, attach });
});
