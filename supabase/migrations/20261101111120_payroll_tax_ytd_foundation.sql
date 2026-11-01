-- BexHR Payroll Tax YTD Foundation
--
-- Purpose:
--   Preserve the tax facts required for compliant year-to-date PAYE records
--   without fabricating historical values for payroll rows created before this
--   migration.
--
-- This migration intentionally DOES NOT:
--   * change PAYE calculation behaviour;
--   * backfill legacy payroll records;
--   * alter tenant/RLS policies;
--   * modify PA, governance, leave, hierarchy, or payslip history.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.payroll_records') is null then
    raise exception 'Payroll tax YTD foundation stopped: public.payroll_records is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'employee_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'pay_date'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'gross_pay'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'paye_tax'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'employee_pension'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_records'
      and column_name = 'is_finalised'
  ) then
    raise exception 'Payroll tax YTD foundation stopped: required payroll_records columns are missing.';
  end if;
end;
$preflight$;

alter table public.payroll_records
  add column if not exists tax_rule_version text,
  add column if not exists tax_calculation_snapshot jsonb,
  add column if not exists ytd_gross_emoluments numeric(18,2),
  add column if not exists ytd_eligible_deductions numeric(18,2),
  add column if not exists ytd_taxable_emoluments numeric(18,2),
  add column if not exists ytd_cumulative_tax numeric(18,2);

comment on column public.payroll_records.tax_rule_version is
'Payroll tax rule identifier used for this historical payroll calculation, for example NTA_2025_2026_V1.';

comment on column public.payroll_records.tax_calculation_snapshot is
'Historical tax calculation detail for the payroll period. Kept nullable so legacy rows are not assigned invented relief or YTD values.';

comment on column public.payroll_records.ytd_gross_emoluments is
'Year-to-date cumulative gross employment emoluments through this payroll record. Null on legacy rows unless explicitly recalculated from complete evidence.';

comment on column public.payroll_records.ytd_eligible_deductions is
'Year-to-date cumulative documented eligible PAYE deductions/reliefs through this payroll record. Null on legacy rows unless explicitly recalculated from complete evidence.';

comment on column public.payroll_records.ytd_taxable_emoluments is
'Year-to-date cumulative taxable employment emoluments after eligible deductions/reliefs through this payroll record.';

comment on column public.payroll_records.ytd_cumulative_tax is
'Corresponding year-to-date cumulative PAYE tax through this payroll record.';

do $verify$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payroll_records'
    and column_name in (
      'tax_rule_version',
      'tax_calculation_snapshot',
      'ytd_gross_emoluments',
      'ytd_eligible_deductions',
      'ytd_taxable_emoluments',
      'ytd_cumulative_tax'
    );

  if v_count <> 6 then
    raise exception 'Payroll tax YTD foundation verification failed: expected 6 new payroll tax columns, found %.', v_count;
  end if;
end;
$verify$;

commit;
