const fs = require('fs');
const assert = require('assert');

const js = fs.readFileSync('js/hr-dashboard.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261101171500_payroll_staff_level_suggestions.sql', 'utf8');

assert(js.includes('PHASE 3R-D - TENANT STAFF LEVEL SUGGESTION LEARNING'));
assert(js.includes('PAYROLL_STAFF_LEVEL_SUGGESTIONS_TABLE'));
assert(js.includes('learnPayrollStaffLevelSuggestion(savedStaffLevelLabel)'));
assert(js.includes('await loadPayrollStaffLevelSuggestions();'));
assert(js.includes('...learnedLabels'));
assert(js.includes('isDefaultPayrollStaffLevelSuggestion(cleanLabel)'));
assert(js.includes('.eq("tenant_id", tenantId)'));
assert(js.includes('String(error.code || "") === "23505"'));

const responseErrorIndex = js.indexOf('if (response.error) {', js.indexOf('async function handlePayrollMasterSave()'));
const learnIndex = js.indexOf('await learnPayrollStaffLevelSuggestion(savedStaffLevelLabel)', responseErrorIndex);
const refreshIndex = js.indexOf('await refreshPayrollMasterWorkspace();', responseErrorIndex);
assert(responseErrorIndex >= 0 && learnIndex > responseErrorIndex && refreshIndex > learnIndex);

assert(sql.includes('create table if not exists public.payroll_staff_level_suggestions'));
assert(sql.includes('tenant_id uuid not null references public.tenants(id)'));
assert(sql.includes('lower(btrim(label))'));
assert(sql.includes('enable row level security'));
assert(sql.includes('tenant_id = public.current_authenticated_profile_tenant_id()'));
assert(sql.includes("lower(trim(coalesce(profile.role, ''))) in ('hr', 'hr_manager')"));
assert(sql.includes('grant select, insert on table public.payroll_staff_level_suggestions'));

console.log('PASS: Phase 3R-D tenant Staff Level suggestion learning regression.');
