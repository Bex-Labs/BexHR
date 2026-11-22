/* H12 Gate 4 RC4b: explicit, server-authorised HR Standard entry on Manager dashboard.
 * No role mutation, grants, direct HR admin routes, or local entitlement cache. */
(() => {
  'use strict';
  const ENTRY_ID = 'bexhrH12HrStandardEntry';
  async function showEntry() {
    const area = document.querySelector('.manager-modern-account-area');
    const button = area?.querySelector('.manager-modern-account-button');
    const client = window.supabaseClient;
    if (!area || !button || !client?.rpc || !client?.auth?.getUser) return;
    // Fail closed: a client-side link is shown only after live server auth and
    // the independently granted, tenant-scoped, AAL2-backed entitlement.
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user?.id) return;
      const { data, error } = await client.rpc('bexhr_h12_workspace_entitlements');
      if (error || data?.hr_grant_present !== true ||
          data?.can_enter_manager !== true || data?.can_enter_hr !== true ||
          data?.hr_standard_scope !== 'read_only') return;
      if (document.getElementById(ENTRY_ID)) return;
      const link = document.createElement('a');
      link.id = ENTRY_ID;
      // BEXHR_H12_G4_NATIVE_PILOT_20261111: use the existing native HR Dashboard.
      link.href = 'hr-dashboard.html?workspace=hr';
      link.className = 'btn btn-outline-primary';
      link.textContent = 'HR Standard';
      link.setAttribute('aria-label', 'Switch to authorised HR Standard workspace');
      link.style.cssText = 'white-space:nowrap;align-self:center;padding:9px 12px;font-weight:600;font-size:13px;';
      area.insertBefore(link, button);
    } catch (error) {
      console.warn('H12 HR Standard entry unavailable; access remains denied.');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showEntry, { once: true });
  else showEntry();
})();
