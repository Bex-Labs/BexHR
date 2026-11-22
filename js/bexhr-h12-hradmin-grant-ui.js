/* Internal implementation: H12 Stage 2B SaaS permission presentation.
 * Extends the existing People > Manage employee access modal without editing
 * primary role, reporting lines, HR dashboard logic, or other workspaces.
 * Server status and grant RPCs are mandatory; failure is fail-closed.
 */
(() => {
  'use strict';

  const MODAL_ID = 'hrEmployeeAccessModal';
  const PANEL_ID = 'bexhrH12HrAdminSecondaryPanel';
  const STATUS_RPC = 'bexhr_h12_hradmin_secondary_status';
  const GRANT_RPC = 'bexhr_h12_set_hr_standard_grant';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let generation = 0;
  let selected = null;
  let grantActive = null;
  let ready = false;
  let busy = false;
  let checking = false;
  let queued = false;

  const el = (id) => document.getElementById(id);
  const asText = (value) => String(value ?? '').trim();
  const asLower = (value) => asText(value).toLowerCase();
  function hrState() {
    try { return typeof state !== 'undefined' ? state : null; }
    catch (_) { return null; }
  }
  function client() { return window.supabaseClient || null; }
  function modalOpen() {
    const modal = el(MODAL_ID);
    return !!modal && !modal.classList.contains('d-none') &&
      modal.getAttribute('aria-hidden') === 'false';
  }
  function sameContext(a, b) {
    return !!a && !!b && a.employeeId === b.employeeId &&
      a.profileId === b.profileId && a.tenant === b.tenant;
  }
  function resolveManager() {
    if (!modalOpen()) return null;
    const hr = hrState();
    const tenant = asText(hr?.currentProfile?.tenant_id);
    if (!hr?.currentUser?.id || !UUID.test(tenant) ||
        hr.currentProfile?.is_active !== true ||
        asLower(hr.currentProfile?.role) !== 'hr' ||
        asLower(hr.currentProfile?.hr_access_level) !== 'tenant_admin') return null;
    const employeeId = asText(el('hrEmployeeAccessEmployeeId')?.value);
    if (!UUID.test(employeeId) || asLower(el('hrEmployeeAccessRole')?.value) !== 'manager') return null;
    const employee = (hr.employees || []).find(e => asText(e?.id) === employeeId);
    if (!employee || asText(employee.tenant_id) !== tenant ||
        asLower(employee.status || 'active') !== 'active' ||
        asLower(employee.system_role) !== 'manager') return null;
    const authId = asText(employee.user_id || employee.auth_user_id);
    if (!UUID.test(authId)) return null;
    const profile = (hr.authProfiles || []).find(p => asText(p?.id) === authId);
    if (!profile || asText(profile.tenant_id) !== tenant ||
        asLower(profile.role) !== 'manager' || profile.is_active !== true) return null;
    const displayName = [employee.first_name, employee.middle_name, employee.last_name]
      .map(asText).filter(Boolean).join(' ') || 'this Manager';
    return { employeeId, profileId: authId, tenant, displayName };
  }
  function note(value, kind = 'secondary') {
    const node = el('bexhrH12SecondaryStatus');
    if (!node) return;
    node.className = `small mt-3 mb-0 text-${kind}`;
    node.textContent = value;
  }
  function setReportingNumber(visible) {
    const grid = el(MODAL_ID)?.querySelector('.hr-access-section-grid');
    const reporting = grid?.querySelector('section.hr-access-section-card:not(.hr-access-section-card--primary):not(#' + PANEL_ID + ')');
    const step = reporting?.querySelector('.hr-access-section-step');
    if (step) step.textContent = visible ? '3' : '2';
  }
  function render() {
    const panel = el(PANEL_ID);
    if (!panel) return;
    const checkboxWrap = el('bexhrH12SecondaryApprovalWrap');
    const checkbox = el('bexhrH12SecondaryApprovalCheck');
    const grant = el('bexhrH12SecondaryGrantBtn');
    const revoke = el('bexhrH12SecondaryRevokeBtn');
    const badge = el('bexhrH12SecondaryAccessState');
    const usable = ready && typeof grantActive === 'boolean';
    const showGrant = usable && grantActive === false;
    const showRevoke = usable && grantActive === true;
    checkboxWrap?.classList.toggle('d-none', !showGrant);
    grant?.classList.toggle('d-none', !showGrant);
    revoke?.classList.toggle('d-none', !showRevoke);
    if (grant) grant.disabled = !showGrant || busy || checkbox?.checked !== true;
    if (revoke) revoke.disabled = !showRevoke || busy;
    if (checkbox) checkbox.disabled = !showGrant || busy;
    if (badge) {
      badge.textContent = !usable ? (checking ? 'Checking access...' : 'Status unavailable') : grantActive ? 'Access active' : 'Not granted';
      badge.className = 'badge rounded-pill ' + (!usable
        ? 'text-bg-light border text-secondary'
        : grantActive ? 'text-bg-success' : 'text-bg-light border text-secondary');
    }
  }
  function clear() {
    generation++;
    selected = null;
    grantActive = null;
    ready = false;
    busy = false;
    checking = false;
    const panel = el(PANEL_ID);
    panel?.classList.add('d-none');
    const check = el('bexhrH12SecondaryApprovalCheck');
    if (check) check.checked = false;
    note('');
    setReportingNumber(false);
    render();
  }
  function mount() {
    if (el(PANEL_ID)) return true;
    const modal = el(MODAL_ID);
    const grid = modal?.querySelector('.hr-access-section-grid');
    const cards = grid?.querySelectorAll(':scope > section.hr-access-section-card');
    if (!grid || !cards || cards.length !== 2 ||
        !cards[0].classList.contains('hr-access-section-card--primary') ||
        !el('hrEmployeeAccessEmployeeId') || !el('hrEmployeeAccessRole') ||
        !el('hrEmployeeAccessStatus')) return false;

    const title = cards[0].querySelector('.hr-access-section-heading h3');
    if (title && title.textContent.trim() === 'Dashboard access') title.textContent = 'Primary dashboard access';

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'hr-access-section-card d-none';
    panel.setAttribute('aria-label', 'Additional workspace access');
    panel.innerHTML = `
      <div class="hr-access-section-heading">
        <span class="hr-access-section-step" aria-hidden="true">2</span>
        <div>
          <h3>Additional workspace access</h3>
          <p>Give approved Managers access to an additional workspace without changing their main sign-in role.</p>
        </div>
      </div>
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div class="fw-semibold">HR Standard</div>
        <span id="bexhrH12SecondaryAccessState" class="badge rounded-pill text-bg-light border text-secondary"
          role="status" aria-live="polite">Checking access...</span>
      </div>
      <p class="small text-secondary mb-2">
        <strong id="bexhrH12SecondaryManagerName"></strong> keeps Manager as the primary role.
        Additional HR Standard access is limited to read-only duties and requires two-factor authentication.
        Reporting responsibilities stay unchanged.
      </p>
      <div id="bexhrH12SecondaryApprovalWrap" class="form-check mb-3 d-none">
        <input class="form-check-input" type="checkbox" id="bexhrH12SecondaryApprovalCheck" />
        <label class="form-check-label small" for="bexhrH12SecondaryApprovalCheck">
          I confirm this employee has approved HR Standard responsibilities.
        </label>
      </div>
      <div class="d-flex flex-wrap gap-2">
        <button id="bexhrH12SecondaryGrantBtn" type="button" class="btn btn-sm btn-outline-success d-none" disabled>
          <i class="bi bi-shield-plus me-1" aria-hidden="true"></i> Grant HR Standard access
        </button>
        <button id="bexhrH12SecondaryRevokeBtn" type="button" class="btn btn-sm btn-outline-secondary d-none" disabled>
          <i class="bi bi-shield-minus me-1" aria-hidden="true"></i> Remove HR Standard access
        </button>
      </div>
      <p id="bexhrH12SecondaryStatus" class="small mt-3 mb-0 text-secondary" role="status" aria-live="polite"></p>`;
    grid.insertBefore(panel, cards[1]);
    el('bexhrH12SecondaryApprovalCheck')?.addEventListener('change', render);
    el('bexhrH12SecondaryGrantBtn')?.addEventListener('click', () => void changeGrant(true));
    el('bexhrH12SecondaryRevokeBtn')?.addEventListener('click', () => void changeGrant(false));
    el('hrEmployeeAccessRole')?.addEventListener('change', queueRefresh);
    return true;
  }
  async function verifySession(seq, context) {
    const api = client();
    if (!api?.auth?.getUser || !api?.auth?.mfa?.getAuthenticatorAssuranceLevel || !api?.rpc) return false;
    const [u, assurance] = await Promise.all([
      api.auth.getUser(), api.auth.mfa.getAuthenticatorAssuranceLevel()
    ]);
    if (seq !== generation || !sameContext(context, resolveManager())) return false;
    return !u.error && !assurance.error &&
      u.data?.user?.id === asText(hrState()?.currentUser?.id) &&
      assurance.data?.currentLevel === 'aal2';
  }
  async function readAccess(seq, context) {
    const api = client();
    if (!api?.rpc) throw new Error('Access status service unavailable');
    const { data, error } = await api.rpc(STATUS_RPC, { target_profile_id: context.profileId });
    if (error) throw error;
    if (seq !== generation || !sameContext(context, resolveManager())) return null;
    if (typeof data?.is_granted !== 'boolean' || data?.primary_role !== 'manager') {
      throw new Error('Access status response was not valid');
    }
    return data.is_granted;
  }
  async function refresh() {
    if (busy) return;
    const seq = ++generation;
    ready = false;
    selected = null;
    grantActive = null;
    checking = true;
    if (!mount()) return;
    const panel = el(PANEL_ID);
    const context = resolveManager();
    if (!context) { clear(); return; }
    panel.classList.remove('d-none');
    setReportingNumber(true);
    el('bexhrH12SecondaryManagerName').textContent = context.displayName;
    el('bexhrH12SecondaryApprovalCheck').checked = false;
    note('Checking your access and two-factor authentication...');
    render();
    try {
      if (!(await verifySession(seq, context))) {
        if (seq === generation) {
          checking = false;
          render();
          note('Sign in as your company HR Admin with two-factor authentication to manage access.', 'warning');
        }
        return;
      }
      const currentStatus = await readAccess(seq, context);
      if (seq !== generation || currentStatus === null) return;
      selected = context;
      grantActive = currentStatus;
      ready = true;
      checking = false;
      render();
      note(currentStatus ? 'HR Standard access is enabled for this Manager.' :
        'HR Standard access has not been granted to this Manager.', 'secondary');
    } catch (_) {
      if (seq === generation && sameContext(context, resolveManager())) {
        checking = false;
        render();
        note('Current access could not be verified. Changes are disabled until the secure status service is available.', 'warning');
      }
    }
  }
  function queueRefresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!modalOpen()) { clear(); return; }
      void refresh();
    });
  }
  async function changeGrant(allow) {
    if (busy || !ready || grantActive !== !allow ||
        !sameContext(selected, resolveManager())) return;
    const approval = el('bexhrH12SecondaryApprovalCheck');
    if (allow && approval?.checked !== true) {
      note('Confirm approved HR Standard responsibilities first.', 'warning');
      return;
    }
    const context = { ...selected };
    const question = allow
      ? `Grant additional HR Standard access to ${context.displayName}? Their Manager role and reporting responsibilities will remain unchanged.`
      : `Remove additional HR Standard access for ${context.displayName}? Their Manager role and reporting responsibilities will remain unchanged.`;
    if (!window.confirm(question)) return;
    const seq = generation;
    let writeConfirmed = false;
    busy = true;
    render();
    note('Verifying your request...');
    try {
      if (!(await verifySession(seq, context))) throw new Error('Authorised HR Admin sign-in and two-factor authentication are required.');
      if (seq !== generation || !modalOpen() || !sameContext(context, resolveManager())) return;
      const { data, error } = await client().rpc(GRANT_RPC, {
        target_profile_id: context.profileId,
        allow_hr: allow
      });
      if (error) throw error;
      if (data !== true) throw new Error('The server did not confirm the access change.');
      writeConfirmed = true;
      // Never claim a changed status from an RPC success alone; read it again.
      const verified = await readAccess(seq, context);
      if (verified === null || seq !== generation) return;
      if (verified !== allow) {
        ready = false;
        grantActive = null;
        throw new Error('Access changed, but the latest status could not be confirmed. Reopen this employee to check again.');
      }
      grantActive = verified;
      ready = true;
      if (approval) approval.checked = false;
      note(allow ? 'HR Standard access granted. Manager remains the primary role.' :
        'HR Standard access removed. Manager remains the primary role.', 'success');
    } catch (error) {
      if (seq === generation && sameContext(context, resolveManager()) && modalOpen()) {
        // A successful write followed by a failed status read must never retain stale buttons.
        if (writeConfirmed) {
          ready = false;
          grantActive = null;
        }
        note(writeConfirmed
          ? 'The request reached the server, but the current access status could not be verified. Reopen this employee before any further changes.'
          : (error?.message || 'The access change could not be confirmed. No further action permitted.'), 'danger');
      }
    } finally {
      busy = false;
      if (seq === generation && sameContext(context, resolveManager()) && modalOpen()) render();
    }
  }
  function start() {
    const modal = el(MODAL_ID);
    if (!modal || !mount()) {
      console.warn('Additional workspace access controls were not mounted; no access changes made.');
      return;
    }
    new MutationObserver(queueRefresh).observe(modal, {
      attributes: true, attributeFilter: ['class', 'aria-hidden']
    });
    if (modalOpen()) queueRefresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
