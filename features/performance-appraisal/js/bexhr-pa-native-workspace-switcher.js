/* BEXHR_H12_PA_NATIVE_WORKSPACE_SWITCHER_20261114
 * UI bridge only: reuse SessionManager's live server-authorised HR/Manager
 * workspace menu and the accepted floating-menu portal. No role mutation,
 * entitlement caching, PA data changes or new navigation permissions.
 */
(() => {
  'use strict';

  const AREA_ID = 'bexPaAuthSwitcherArea';
  const TRIGGER_CLASS = '.bex-pa-auth-switcher-button';
  const MENU_SELECTOR = '[data-bexhr-workspace-menu]';
  const ALLOWED_NATIVE_HREF = /^(?:manager-dashboard\.html|hr-dashboard\.html(?:\?workspace=hr)?)$/;

  function hide() {
    const area = document.getElementById(AREA_ID);
    if (!area) return;
    area.hidden = true;
    area.classList.add('d-none');
  }

  async function init(verifiedIdentity) {
    const area = document.getElementById(AREA_ID);
    const trigger = area?.querySelector(TRIGGER_CLASS);
    hide();
    if (!area || !trigger) return false;

    // Only PA's already-verified integrated identity can request the UI.
    const userId = String(verifiedIdentity?.userId || '').trim();
    if (!userId || !verifiedIdentity?.tenantId) return false;
    if (typeof window.BexPaIsValidIntegratedContext !== 'function' ||
        !window.BexPaIsValidIntegratedContext(window.BexHrPerformanceAppraisalContext)) {
      return false;
    }

    const sessions = window.SessionManager;
    if (typeof sessions?.getSession !== 'function' ||
        typeof sessions?.getProfile !== 'function' ||
        typeof sessions?.initialiseWorkspaceSwitcher !== 'function') return false;

    try {
      const session = await sessions.getSession();
      if (!session?.user?.id || session.user.id !== userId) return false;
      const profile = await sessions.getProfile(userId);
      if (!profile || profile.id !== userId ||
          profile.is_active !== true ||
          String(profile.tenant_id || '') !== String(verifiedIdentity.tenantId)) return false;

      // session.js performs its existing live, tenant-scoped server RPC check
      // and inserts only the two already-authorised workspace destinations.
      await sessions.initialiseWorkspaceSwitcher(profile);
      const sourceMenu = area.querySelector(MENU_SELECTOR);
      if (trigger.dataset.workspaceSwitcherReady !== 'true' || !sourceMenu) return false;

      // PA is two directories below the dashboard URLs. Correct only the
      // existing authorised hrefs; never manufacture new links or options.
      const links = Array.from(sourceMenu.querySelectorAll('a[href]'));
      if (links.length !== 2 ||
          !links.every(link => ALLOWED_NATIVE_HREF.test(link.getAttribute('href') || ''))) {
        return false;
      }
      const repoRoot = new URL('../../', window.location.href);
      for (const link of links) {
        const relative = link.getAttribute('href');
        const target = new URL(relative, repoRoot);
        if (target.origin !== window.location.origin) return false;
        link.setAttribute('href', target.pathname + target.search + target.hash);
      }

      area.hidden = false;
      area.classList.remove('d-none');
      return true;
    } catch (error) {
      console.warn('[H12 PA] Authorised HR/Manager switcher unavailable:', error);
      return false;
    }
  }

  window.BexHRPaNativeWorkspaceSwitcher = Object.freeze({ init });
})();
