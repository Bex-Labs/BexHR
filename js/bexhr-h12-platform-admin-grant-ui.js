/* BexHR H12 Stage 2B: Platform Admin -> secondary HR Standard grant/revoke.
 * Frontend only. No profile/employee role writes and no direct private-table access.
 * Authorisation, target eligibility and grant changes happen exclusively in
 * public.bexhr_h12_set_hr_standard_grant(uuid, boolean).
 * A Manager's entry to HR Standard requires live AAL2-backed entitlement.
 */
(() => {
  'use strict';

  const ids = {
    accessChoices: 'adminUserAccessActionChoices',
    groupedModal: 'adminUserGroupedActionsModal',
    controls: 'bexhrH12PlatformAdminGrantControls',
    grant: 'bexhrH12PlatformAdminGrantBtn',
    revoke: 'bexhrH12PlatformAdminRevokeBtn',
    feedback: 'bexhrH12PlatformAdminGrantFeedback',
  };

  function initialise() {
    const choices = document.getElementById(ids.accessChoices);
    const modal = document.getElementById(ids.groupedModal);
    if (!choices || !modal || document.getElementById(ids.controls)) return;

    const group = document.createElement('div');
    group.id = ids.controls;
    group.className = 'd-none border-top pt-3 mt-2';
    group.innerHTML = `
      <div class="small fw-bold text-uppercase text-secondary mb-2">H12 secondary workspace</div>
      <p class="small text-secondary mb-2">Manager remains primary. HR Standard is read-only and requires Manager MFA (AAL2).</p>
      <button type="button" class="btn btn-outline-success dashboard-action-btn text-start w-100 mb-2" id="${ids.grant}">
        <i class="bi bi-shield-plus me-2" aria-hidden="true"></i>Grant HR Standard access
      </button>
      <button type="button" class="btn btn-outline-secondary dashboard-action-btn text-start w-100" id="${ids.revoke}">
        <i class="bi bi-shield-minus me-2" aria-hidden="true"></i>Revoke HR Standard access
      </button>
      <p id="${ids.feedback}" class="small mt-2 mb-0" role="status" aria-live="polite"></p>
    `;
    choices.appendChild(group);

    const grantButton = group.querySelector(`#${ids.grant}`);
    const revokeButton = group.querySelector(`#${ids.revoke}`);
    const feedback = group.querySelector(`#${ids.feedback}`);
    let target = null;
    let busy = false;

    // Capture the existing Access action button before the original inline
    // handler opens the modal. Never infer authority from a CEO/COO title.
    document.addEventListener('click', (event) => {
      const source = event.target instanceof Element
        ? event.target.closest('.admin-user-access-actions-btn') : null;
      if (!source) return;

      const row = source.closest('tr');
      const loginRole = String(row?.querySelector('.admin-user-security-actions-btn')
        ?.dataset?.profileRole || '').trim().toLowerCase();
      const employeeRole = String(row?.querySelector('.admin-access-role-pill')
        ?.textContent || '').trim().toLowerCase();
      const profileId = String(source.dataset.profileId || '').trim();
      // Presentation-only filter. Protected backend verifies role, active
      // employee linkage and tenant again, independently of these labels.
      const eligibleCandidate = loginRole === 'manager' && employeeRole === 'manager'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId);
      target = eligibleCandidate ? {
        profileId,
        label: String(row?.querySelector('.fw-semibold')?.textContent || 'this Manager').trim(),
      } : null;
      group.classList.toggle('d-none', !target);
      feedback.textContent = '';
      feedback.className = 'small mt-2 mb-0';
    }, true);

    async function submit(allowHr) {
      if (busy || !target) return;
      const selected = { ...target };
      const action = allowHr ? 'Grant' : 'Revoke';
      if (!window.confirm(`${action} secondary read-only HR Standard access ${allowHr ? 'to' : 'from'} ${selected.label}?\n\nThe primary Manager role is not changed.`)) return;

      busy = true;
      grantButton.disabled = true;
      revokeButton.disabled = true;
      feedback.textContent = 'Checking authorised Platform Admin request...';
      feedback.className = 'small mt-2 mb-0 text-secondary';

      try {
        const client = window.supabaseClient;
        if (!client?.rpc || !client?.auth?.getUser) throw new Error('Authenticated BexHR session unavailable.');
        const { data: userData, error: authError } = await client.auth.getUser();
        if (authError || !userData?.user?.id) throw new Error('Platform Admin sign-in is required.');
        const { data, error } = await client.rpc('bexhr_h12_set_hr_standard_grant', {
          target_profile_id: selected.profileId,
          allow_hr: allowHr,
        });
        if (error) throw error;
        if (data !== true) throw new Error('Protected grant RPC did not confirm the request.');

        // This RPC confirms the administrative change, not a live Manager MFA
        // test. The existing Manager entry remains fail-closed until AAL2.
        feedback.textContent = allowHr
          ? 'Grant confirmed by server. Verify Manager MFA (AAL2) and HR Standard switcher in the Manager session.'
          : 'Revoke request confirmed by server. Refresh/re-sign-in as Manager to verify HR Standard is denied.';
        feedback.className = 'small mt-2 mb-0 text-success';
      } catch (error) {
        feedback.textContent = `Request not confirmed: ${String(error?.message || 'Authorisation failed.')}`;
        feedback.className = 'small mt-2 mb-0 text-danger';
      } finally {
        busy = false;
        grantButton.disabled = false;
        revokeButton.disabled = false;
      }
    }

    grantButton.addEventListener('click', () => submit(true));
    revokeButton.addEventListener('click', () => submit(false));
    modal.addEventListener('hidden.bs.modal', () => {
      target = null;
      group.classList.add('d-none');
      feedback.textContent = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
