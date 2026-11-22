-- BEXHR GOVERNANCE REMOVAL
--
-- Purpose:
--   Remove the Phase 4.5 executive compensation governance workflow while
--   preserving tenant payroll isolation, RLS and grant hardening.
--
-- Historical Phase 4.5A/4.5B migrations remain in version control. This
-- forward migration removes their governance-specific runtime effects only.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'Governance removal stopped: organization hierarchy is missing.';
  end if;

  if to_regprocedure('bexhr_private.employee_is_in_current_tenant(uuid)') is null then
    raise exception 'Governance removal stopped: tenant payroll helper employee_is_in_current_tenant(uuid) is missing.';
  end if;

  if to_regprocedure('bexhr_private.payroll_master_is_in_current_tenant(uuid)') is null then
    raise exception 'Governance removal stopped: tenant payroll helper payroll_master_is_in_current_tenant(uuid) is missing.';
  end if;

  if to_regclass('public.payroll_master_records') is null
     or to_regclass('public.payroll_allowance_components') is null
     or to_regclass('public.payroll_statutory_deductions') is null
     or to_regclass('public.payroll_other_deductions') is null
     or to_regclass('public.payroll_employee_overrides') is null
     or to_regclass('public.payroll_records') is null then
    raise exception 'Governance removal stopped: one or more payroll tables are missing.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. REMOVE GOVERNANCE WRITE ENFORCEMENT FROM PAYROLL
-- ---------------------------------------------------------------------------

drop trigger if exists trg_phase45b_govern_payroll_master_write
on public.payroll_master_records;

drop trigger if exists trg_phase45b_govern_payroll_allowance_write
on public.payroll_allowance_components;

drop trigger if exists trg_phase45b_govern_payroll_statutory_write
on public.payroll_statutory_deductions;

drop trigger if exists trg_phase45b_govern_payroll_other_deduction_write
on public.payroll_other_deductions;

drop trigger if exists trg_phase45b_govern_payroll_employee_override_write
on public.payroll_employee_overrides;

drop trigger if exists trg_phase45b_govern_payroll_record_write
on public.payroll_records;

-- Governance-specific delete restrictions are removed. Existing permissive
-- table policies and the retained tenant-scope restrictive policies continue
-- to determine normal HR/Payroll delete authority.
drop policy if exists phase45b_restrict_payroll_master_delete
on public.payroll_master_records;

drop policy if exists phase45b_restrict_payroll_allowance_delete
on public.payroll_allowance_components;

drop policy if exists phase45b_restrict_payroll_statutory_delete
on public.payroll_statutory_deductions;

drop policy if exists phase45b_restrict_payroll_other_deduction_delete
on public.payroll_other_deductions;

drop policy if exists phase45b_restrict_payroll_employee_override_delete
on public.payroll_employee_overrides;

drop policy if exists phase45b_restrict_payroll_record_delete
on public.payroll_records;

-- ---------------------------------------------------------------------------
-- 2. REMOVE PUBLIC GOVERNANCE APPROVAL / REQUEST RPCS
-- ---------------------------------------------------------------------------

drop function if exists public.request_compensation_governance_approval(
  uuid, text, text, uuid, jsonb, text, text
);

drop function if exists public.governance_get_compensation_requests();

drop function if exists public.governance_approve_compensation_request(uuid, text);

drop function if exists public.governance_reject_compensation_request(uuid, text);

drop function if exists public.governance_approve_compensation_change(
  uuid, text, text, uuid, jsonb, text, text
);

drop function if exists public.governance_revoke_compensation_approval(uuid, text);

-- ---------------------------------------------------------------------------
-- 3. REMOVE PRIVATE GOVERNANCE APPROVAL PIPELINE
-- ---------------------------------------------------------------------------

drop function if exists bexhr_private.enforce_compensation_governance_write();

drop function if exists bexhr_private.consume_compensation_change_approval(
  uuid, text, text, uuid, uuid, jsonb
);

drop function if exists bexhr_private.require_restricted_compensation_executor(uuid);

drop function if exists bexhr_private.payroll_master_compensation_is_standard(uuid);

drop function if exists bexhr_private.employee_compensation_is_standard(uuid);

drop function if exists bexhr_private.compensation_change_snapshot(text, jsonb);

drop table if exists bexhr_private.compensation_change_approvals;

-- ---------------------------------------------------------------------------
-- 4. REMOVE PHASE 4.5A POSITION / AUTHORITY GOVERNANCE
-- ---------------------------------------------------------------------------

drop trigger if exists bexhr_enforce_organization_job_title_governance_integrity
on public.organization_job_title_governance;

drop trigger if exists audit_organization_job_title_governance_changes
on public.organization_job_title_governance;

drop trigger if exists bexhr_enforce_organization_governance_authority_integrity
on public.organization_governance_authorities;

drop trigger if exists audit_organization_governance_authority_changes
on public.organization_governance_authorities;

drop function if exists public.hr_tenant_admin_save_job_title_governance(uuid, text);
drop function if exists public.hr_tenant_admin_delete_job_title_governance(uuid);
drop function if exists public.governance_authority_release_job_title_governance(uuid);
drop function if exists public.hr_tenant_admin_save_governance_authority(uuid, text);
drop function if exists public.hr_tenant_admin_remove_governance_authority(uuid, text);
drop function if exists public.hr_tenant_admin_list_governance_authorities();
drop function if exists public.hr_get_employee_compensation_governance();

drop function if exists bexhr_private.capture_organization_governance_audit();
drop function if exists bexhr_private.enforce_organization_governance_authority_integrity();
drop function if exists bexhr_private.enforce_organization_job_title_governance_integrity();
drop function if exists bexhr_private.current_user_has_governance_authority(uuid, text);
drop function if exists bexhr_private.is_governance_authority_profile_independent(uuid, uuid);
drop function if exists bexhr_private.resolve_employee_compensation_governance(uuid, uuid);

drop table if exists public.organization_governance_authorities;
drop table if exists public.organization_job_title_governance;

-- ---------------------------------------------------------------------------
-- 5. VERIFICATION: GOVERNANCE GONE, SECURITY BOUNDARIES RETAINED
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_trigger_count integer;
  v_governance_delete_policy_count integer;
  v_tenant_scope_policy_count integer;
  v_target_rls_count integer;
  v_bad_grant_count integer;
begin
  if to_regclass('public.organization_job_title_governance') is not null
     or to_regclass('public.organization_governance_authorities') is not null
     or to_regclass('bexhr_private.compensation_change_approvals') is not null then
    raise exception 'Governance removal verification failed: governance table/ledger still exists.';
  end if;

  if to_regprocedure('bexhr_private.resolve_employee_compensation_governance(uuid,uuid)') is not null
     or to_regprocedure('bexhr_private.current_user_has_governance_authority(uuid,text)') is not null
     or to_regprocedure('bexhr_private.enforce_compensation_governance_write()') is not null
     or to_regprocedure('public.request_compensation_governance_approval(uuid,text,text,uuid,jsonb,text,text)') is not null
     or to_regprocedure('public.governance_get_compensation_requests()') is not null
     or to_regprocedure('public.governance_approve_compensation_request(uuid,text)') is not null
     or to_regprocedure('public.governance_reject_compensation_request(uuid,text)') is not null then
    raise exception 'Governance removal verification failed: governance function/RPC still exists.';
  end if;

  select count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger_record
  join pg_catalog.pg_class trigger_table
    on trigger_table.oid = trigger_record.tgrelid
  join pg_catalog.pg_namespace trigger_schema
    on trigger_schema.oid = trigger_table.relnamespace
  where trigger_schema.nspname = 'public'
    and trigger_record.tgisinternal is false
    and trigger_record.tgname in (
      'trg_phase45b_govern_payroll_master_write',
      'trg_phase45b_govern_payroll_allowance_write',
      'trg_phase45b_govern_payroll_statutory_write',
      'trg_phase45b_govern_payroll_other_deduction_write',
      'trg_phase45b_govern_payroll_employee_override_write',
      'trg_phase45b_govern_payroll_record_write'
    );

  if v_trigger_count <> 0 then
    raise exception 'Governance removal verification failed: % payroll governance trigger(s) remain.', v_trigger_count;
  end if;

  select count(*)
  into v_governance_delete_policy_count
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.policyname in (
      'phase45b_restrict_payroll_master_delete',
      'phase45b_restrict_payroll_allowance_delete',
      'phase45b_restrict_payroll_statutory_delete',
      'phase45b_restrict_payroll_other_deduction_delete',
      'phase45b_restrict_payroll_employee_override_delete',
      'phase45b_restrict_payroll_record_delete'
    );

  if v_governance_delete_policy_count <> 0 then
    raise exception 'Governance removal verification failed: governance delete policies remain.';
  end if;

  -- These six tenant-isolation policies were introduced in Phase 4.5B but are
  -- intentionally retained because they are generic payroll security controls.
  select count(*)
  into v_tenant_scope_policy_count
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.policyname in (
      'phase45b_tenant_scope_payroll_master_records',
      'phase45b_tenant_scope_payroll_allowance_components',
      'phase45b_tenant_scope_payroll_statutory_deductions',
      'phase45b_tenant_scope_payroll_other_deductions',
      'phase45b_tenant_scope_payroll_employee_overrides',
      'phase45b_tenant_scope_payroll_records'
    )
    and policy_record.permissive = 'RESTRICTIVE';

  if v_tenant_scope_policy_count <> 6 then
    raise exception 'Governance removal verification failed: expected 6 retained tenant-scope payroll policies, found %.', v_tenant_scope_policy_count;
  end if;

  if to_regprocedure('bexhr_private.employee_is_in_current_tenant(uuid)') is null
     or to_regprocedure('bexhr_private.payroll_master_is_in_current_tenant(uuid)') is null then
    raise exception 'Governance removal verification failed: tenant payroll helpers were removed.';
  end if;

  if to_regclass('public.organization_job_title_hierarchy') is null then
    raise exception 'Governance removal verification failed: organization hierarchy was removed.';
  end if;

  select count(*)
  into v_target_rls_count
  from pg_catalog.pg_class table_class
  join pg_catalog.pg_namespace table_schema
    on table_schema.oid = table_class.relnamespace
  where table_schema.nspname = 'public'
    and table_class.relname in (
      'payroll_master_records',
      'payroll_allowance_components',
      'payroll_statutory_deductions',
      'payroll_other_deductions',
      'payroll_employee_overrides',
      'payroll_records'
    )
    and table_class.relrowsecurity is true;

  if v_target_rls_count <> 6 then
    raise exception 'Governance removal verification failed: expected RLS on all 6 payroll targets, found %.', v_target_rls_count;
  end if;

  select count(*)
  into v_bad_grant_count
  from information_schema.role_table_grants grant_record
  where grant_record.table_schema = 'public'
    and grant_record.table_name in (
      'payroll_master_records',
      'payroll_allowance_components',
      'payroll_statutory_deductions',
      'payroll_other_deductions',
      'payroll_employee_overrides',
      'payroll_records'
    )
    and (
      grant_record.grantee = 'anon'
      or (
        grant_record.grantee = 'authenticated'
        and grant_record.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
      )
    );

  if v_bad_grant_count <> 0 then
    raise exception 'Governance removal verification failed: payroll grant hardening regressed.';
  end if;
end;
$verify$;

commit;
