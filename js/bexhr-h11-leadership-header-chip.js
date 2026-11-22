/* BexHR H11: read-only, independently verified top-position context before account/sign-out.
 * No title-guessing, role mutation, entitlement cache, SQL writes or new port. */
(() => {
  'use strict';
  const AREA = '.manager-modern-account-area, .hr-modern-account-area, .employee-modern-account-area';
  const STATUS = new Set(['CONFIGURED_ROOT', 'HIGHEST_OCCUPIED']);
  const CHIP_ID = 'bexhrH11LeadershipStatusChip';
  function normalized(value) { return String(value == null ? '' : value).trim(); }
  async function showVerifiedLeadership() {
    const area = document.querySelector(AREA);
    const button = area?.querySelector('.manager-modern-account-button, .hr-modern-account-button, .employee-modern-account-button');
    const client = window.supabaseClient;
    if (!area || !button || !client?.auth?.getUser || !client?.from || !client?.rpc) return;
    if (document.getElementById(CHIP_ID)) return;
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      const uid = normalized(userData?.user?.id);
      if (userError || !uid) return;
      const { data: profile, error: profileError } = await client.from('profiles')
        .select('tenant_id,is_active').eq('id', uid).maybeSingle();
      if (profileError || !profile || profile.is_active !== true || !normalized(profile.tenant_id)) return;
      const { data: employees, error: employeesError } = await client.from('employees')
        .select('id,tenant_id,user_id,status').eq('user_id', uid)
        .eq('tenant_id', profile.tenant_id).limit(2);
      if (employeesError || !Array.isArray(employees) || employees.length !== 1) return;
      const employee = employees[0];
      if (normalized(employee.user_id) !== uid || normalized(employee.tenant_id) !== normalized(profile.tenant_id)
        || normalized(employee.status || 'active').toLowerCase() !== 'active' || !normalized(employee.id)) return;

      // Two independently tenant-scoped server RPCs, not CEO/COO title strings.
      const [{data: position, error: positionError}, {data: scopes, error: scopeError}] = await Promise.all([
        client.rpc('bexhr_p7b_my_organization_position', {p_employee_id: employee.id}),
        client.rpc('bexhr_group_b_v13_my_visible_scopes')
      ]);
      if (positionError || scopeError || !position || !STATUS.has(normalized(position.status))
        || !Array.isArray(scopes) || !scopes.some((r) =>
          normalized(r.employee_id) === normalized(employee.id) && r.position_scope === 'organization')) return;
      const title = normalized(position.position_title).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').slice(0, 70);
      if (!title || document.getElementById(CHIP_ID)) return;

      const chip = document.createElement('span');
      chip.id = CHIP_ID;
      chip.className = 'bexhr-h11-leadership-chip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-label', 'Verified organisation position status');
      chip.title = 'Organisation position context only — not an HR grant or management permission';
      const icon = document.createElement('span'); icon.className = 'bexhr-h11-leadership-icon';
      icon.setAttribute('aria-hidden','true'); icon.textContent = '◆';
      const copy = document.createElement('span'); copy.className = 'bexhr-h11-leadership-copy';
      const eyebrow = document.createElement('span'); eyebrow.className = 'bexhr-h11-leadership-overline';
      eyebrow.textContent = 'Whole organisation';
      const detail = document.createElement('span'); detail.className = 'bexhr-h11-leadership-detail';
      detail.textContent = title + ' · ' + (position.status === 'CONFIGURED_ROOT' ? 'Top position' : 'Highest active');
      copy.appendChild(eyebrow); copy.appendChild(detail); chip.appendChild(icon); chip.appendChild(copy);
      area.insertBefore(chip, button);
    } catch (_error) { /* Fail closed; no guessed leadership label. */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showVerifiedLeadership, {once: true});
  else showVerifiedLeadership();
})();
