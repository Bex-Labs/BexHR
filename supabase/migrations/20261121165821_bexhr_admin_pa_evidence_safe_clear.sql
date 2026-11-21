-- BexHR PA clear recovery: Stage 1, read-only safety preflight.
-- No deletions, trigger changes, FK changes or Storage mutations.
-- Do not deploy independently as the final PA clearing correction.

create or replace function public.admin_pa_clear_evidence_preflight(
    target_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor uuid := auth.uid();
    v_count bigint;
    v_ready bigint;
    v_missing bigint;
    v_extra bigint;
begin
    if v_actor is null or not exists (
        select 1
        from public.profiles p
        where p.id = v_actor
          and lower(trim(coalesce(p.role, ''))) = 'admin'
          and p.is_active is true
    ) then
        raise exception 'Platform Admin authorisation required';
    end if;

    if not exists (
        select 1 from public.tenants t
        where t.id = target_tenant_id
    ) then
        raise exception 'Target company not found';
    end if;

    select count(*),
           count(*) filter (where e.status = 'ready'),
           count(*) filter (where o.id is null)
    into v_count, v_ready, v_missing
    from public.pa_progress_evidence e
    left join storage.objects o
      on o.bucket_id = 'pa-progress-evidence'
     and o.name = e.storage_path
    where e.tenant_id = target_tenant_id;

    select count(*)
    into v_extra
    from storage.objects o
    where o.bucket_id = 'pa-progress-evidence'
      and split_part(o.name, '/', 1) = target_tenant_id::text
      and not exists (
          select 1 from public.pa_progress_evidence e
          where e.tenant_id = target_tenant_id
            and e.storage_path = o.name
      );

    return jsonb_build_object(
        'tenant_id', target_tenant_id,
        'evidence_records', v_count,
        'ready_records', v_ready,
        'missing_storage_objects', v_missing,
        'unreferenced_storage_objects', v_extra,
        'safe_to_clear_without_evidence',
            v_count = 0 and v_extra = 0
    );
end;
$function$;

revoke all on function public.admin_pa_clear_evidence_preflight(uuid)
from public, anon;

grant execute on function public.admin_pa_clear_evidence_preflight(uuid)
to authenticated;

-- ============================================================
-- BexHR R41 / PA clear safety correction (part 2)
-- APPEND to already-created migration 20261121151412_...
--
-- Durable deletion outbox: commit PA record clear and file manifest
-- in ONE database transaction. Remove physical objects ONLY via the
-- Storage API from the authenticated server-side Edge Function.
-- If Storage cleanup fails, the outbox remains retriable and the UI
-- must NOT report completion. Never SQL-delete storage.objects.
--
-- The original admin_clear_tenant_pa_cycle_records(uuid) is unchanged;
-- its tenant scope, table deletion order and audit insert are reused.
-- ============================================================

create table bex_pa_private.admin_pa_clear_jobs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    actor_user_id uuid not null,
    status text not null default 'storage_pending'
        check (status in ('storage_pending', 'complete')),
    legacy_result jsonb,
    evidence_deleted integer not null default 0,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create unique index admin_pa_clear_one_pending_per_tenant
on bex_pa_private.admin_pa_clear_jobs (tenant_id)
where status = 'storage_pending';

create table bex_pa_private.admin_pa_clear_job_files (
    job_id uuid not null references bex_pa_private.admin_pa_clear_jobs(id),
    evidence_id uuid not null,
    storage_path text not null,
    primary key (job_id, evidence_id),
    unique (job_id, storage_path)
);

alter table bex_pa_private.admin_pa_clear_jobs enable row level security;
alter table bex_pa_private.admin_pa_clear_job_files enable row level security;
revoke all on bex_pa_private.admin_pa_clear_jobs from public, anon, authenticated;
revoke all on bex_pa_private.admin_pa_clear_job_files from public, anon, authenticated;

-- Exact original trigger semantics are preserved for normal callers.
-- Only a deletion already listed in an internal, active Admin job can
-- remove a protected record; no general cascade or RLS bypass is added.
create or replace function bex_pa_private.bexhr_pa_pending_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if exists (
        select 1
        from bex_pa_private.admin_pa_clear_job_files f
        join bex_pa_private.admin_pa_clear_jobs j on j.id = f.job_id
        where j.tenant_id = old.tenant_id
          and j.actor_user_id = auth.uid()
          and j.status = 'storage_pending'
          and f.evidence_id = old.id
          and f.storage_path = old.storage_path
    ) then
        return old;
    end if;

    if old.status <> 'pending' or exists (
        select 1 from storage.objects o
        where o.bucket_id = 'pa-progress-evidence'
          and o.name = old.storage_path
    ) then
        raise exception 'PA evidence: delete Storage object first or record is ready'
            using errcode = '23503';
    end if;
    return old;
end;
$function$;

-- This API is callable only by an ACTIVE, authenticated Platform Admin.
-- It does NOT delete Storage objects. It atomically queues exact paths,
-- removes matching evidence records, and runs the original tenant PA
-- clearing routine. If the latter fails, ALL database changes roll back.
create or replace function public.admin_clear_tenant_pa_cycle_records_safe(
    p_target_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor uuid := auth.uid();
    v_tenant uuid;
    v_job uuid;
    v_legacy jsonb;
    v_evidence_count integer := 0;
    v_deleted integer := 0;
begin
    if v_actor is null or not exists (
        select 1 from public.profiles p
        where p.id = v_actor
          and p.is_active is true
          and lower(trim(coalesce(p.role, ''))) = 'admin'
    ) then
        raise exception 'Only an active Platform Admin can clear PA cycles.';
    end if;

    -- Serialise Admin clears for one tenant, preserving the legacy lock.
    select t.id into v_tenant from public.tenants t
    where t.id = p_target_tenant_id for update;
    if v_tenant is null then
        raise exception 'The selected company could not be found.';
    end if;

    -- Retry a previously committed Storage cleanup before starting a new
    -- clear. This makes interruptions safe and prevents duplicate jobs.
    select j.id, j.legacy_result into v_job, v_legacy
    from bex_pa_private.admin_pa_clear_jobs j
    where j.tenant_id = v_tenant and j.status = 'storage_pending'
    for update;
    if v_job is not null then
        return jsonb_build_object(
            'success', false, 'storage_cleanup_pending', true,
            'job_id', v_job, 'legacy_result', v_legacy,
            'message', 'PA records were cleared; evidence Storage cleanup is pending. Retry safely.'
        );
    end if;

    -- Fail closed on malformed or cross-tenant paths and owner mismatch.
    if exists (
        select 1 from public.pa_progress_evidence e
        left join storage.objects o
          on o.bucket_id = 'pa-progress-evidence' and o.name = e.storage_path
        where e.tenant_id = v_tenant and (
            split_part(e.storage_path, '/', 1) <> v_tenant::text
            or (o.id is not null and o.owner_id is distinct from e.uploaded_by::text)
            or (e.status = 'ready' and o.id is null)
        )
    ) then
        raise exception 'PA clear blocked: evidence path, owner or Storage integrity requires review.';
    end if;

    -- Do not silently leave unrelated/orphan Storage objects for the target
    -- tenant. No cross-tenant paths may be queued or deleted by this RPC.
    if exists (
        select 1 from storage.objects o
        where o.bucket_id = 'pa-progress-evidence'
          and split_part(o.name, '/', 1) = v_tenant::text
          and not exists (
              select 1 from public.pa_progress_evidence e
              where e.tenant_id = v_tenant and e.storage_path = o.name
          )
    ) then
        raise exception 'PA clear blocked: unreferenced tenant evidence files require review.';
    end if;

    -- Every evidence record is pinned in a durable, private manifest.
    select count(*) into v_evidence_count
    from public.pa_progress_evidence e where e.tenant_id = v_tenant;

    if v_evidence_count > 0 then
        insert into bex_pa_private.admin_pa_clear_jobs (
            tenant_id, actor_user_id, status
        ) values (v_tenant, v_actor, 'storage_pending')
        returning id into v_job;

        insert into bex_pa_private.admin_pa_clear_job_files (
            job_id, evidence_id, storage_path
        )
        select v_job, e.id, e.storage_path
        from public.pa_progress_evidence e
        where e.tenant_id = v_tenant;

        -- Delete only the evidence rows that were actually manifested.
        -- Concurrent rows cannot be silently deleted or untracked.
        delete from public.pa_progress_evidence e
        using bex_pa_private.admin_pa_clear_job_files f
        where f.job_id = v_job and e.id = f.evidence_id
          and e.tenant_id = v_tenant and e.storage_path = f.storage_path;
        get diagnostics v_deleted = row_count;
        if v_deleted <> v_evidence_count then
            raise exception 'PA clear aborted: evidence changed while preparing cleanup.';
        end if;
    end if;

    -- Keep the original deletion order, tenant scope, templates, and audit.
    -- This shares the current transaction and rolls back on any error.
    v_legacy := public.admin_clear_tenant_pa_cycle_records(v_tenant);
    if coalesce((v_legacy ->> 'success')::boolean, false) is distinct from true then
        raise exception 'Original PA clear routine did not complete successfully.';
    end if;

    if v_job is null then
        return jsonb_build_object(
            'success', true, 'storage_cleanup_pending', false,
            'legacy_result', v_legacy
        );
    end if;

    update bex_pa_private.admin_pa_clear_jobs
    set legacy_result = v_legacy, evidence_deleted = v_deleted
    where id = v_job;

    insert into public.admin_security_audit_logs (
        event_type, action_status, actor_user_id, target_tenant_id, details
    ) values (
        'pa_cycle_storage_cleanup_pending', 'pending', v_actor, v_tenant,
        jsonb_build_object('job_id', v_job, 'evidence_records', v_deleted)
    );

    return jsonb_build_object(
        'success', false, 'storage_cleanup_pending', true,
        'job_id', v_job, 'legacy_result', v_legacy,
        'message', 'PA database records were cleared. Private evidence file cleanup is pending.'
    );
end;
$function$;

revoke all on function public.admin_clear_tenant_pa_cycle_records_safe(uuid)
from public, anon;
grant execute on function public.admin_clear_tenant_pa_cycle_records_safe(uuid)
to authenticated;

-- The worker can obtain ONLY paths for an already authorised, committed
-- job. It returns only currently present objects, supporting bounded retry.
create or replace function public.admin_pa_clear_storage_manifest(
    p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_job bex_pa_private.admin_pa_clear_jobs%rowtype;
    v_paths jsonb;
begin
    select j.* into v_job from bex_pa_private.admin_pa_clear_jobs j
    where j.id = p_job_id;
    if not found then
        raise exception 'Unknown PA clear job';
    end if;
    if v_job.status <> 'storage_pending' then
        return jsonb_build_object('paths', '[]'::jsonb, 'complete', true);
    end if;

    select coalesce(jsonb_agg(x.storage_path order by x.storage_path), '[]'::jsonb)
    into v_paths
    from (
        select f.storage_path
        from bex_pa_private.admin_pa_clear_job_files f
        join storage.objects o
          on o.bucket_id = 'pa-progress-evidence'
         and o.name = f.storage_path
        where f.job_id = p_job_id
          and split_part(f.storage_path, '/', 1) = v_job.tenant_id::text
        order by f.storage_path
        limit 400
    ) x;

    return jsonb_build_object('paths', v_paths, 'complete', false);
end;
$function$;

revoke all on function public.admin_pa_clear_storage_manifest(uuid)
from public, anon, authenticated;
grant execute on function public.admin_pa_clear_storage_manifest(uuid)
to service_role;

-- Worker finalises only after confirmed absence of ALL manifested objects.
-- The data is already cleared; finalisation is idempotent and auditable.
create or replace function public.admin_pa_clear_storage_finalize(
    p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_job bex_pa_private.admin_pa_clear_jobs%rowtype;
    v_remaining integer;
begin
    select j.* into v_job from bex_pa_private.admin_pa_clear_jobs j
    where j.id = p_job_id for update;
    if not found then
        raise exception 'Unknown PA clear job';
    end if;
    if v_job.status = 'complete' then
        return jsonb_build_object(
            'success', true, 'storage_cleanup_pending', false,
            'legacy_result', v_job.legacy_result
        );
    end if;

    select count(*) into v_remaining
    from bex_pa_private.admin_pa_clear_job_files f
    join storage.objects o
      on o.bucket_id = 'pa-progress-evidence' and o.name = f.storage_path
    where f.job_id = p_job_id;

    if v_remaining > 0 then
        return jsonb_build_object(
            'success', false, 'storage_cleanup_pending', true,
            'job_id', p_job_id, 'remaining_files', v_remaining,
            'legacy_result', v_job.legacy_result,
            'message', 'PA records were cleared; evidence cleanup is incomplete. Retry safely.'
        );
    end if;

    update bex_pa_private.admin_pa_clear_jobs
    set status = 'complete', completed_at = now()
    where id = p_job_id;

    insert into public.admin_security_audit_logs (
        event_type, action_status, actor_user_id, target_tenant_id, details
    ) values (
        'pa_cycle_storage_cleanup_completed', 'success',
        v_job.actor_user_id, v_job.tenant_id,
        jsonb_build_object('job_id', v_job.id,
                           'evidence_records_deleted', v_job.evidence_deleted)
    );

    return jsonb_build_object(
        'success', true, 'storage_cleanup_pending', false,
        'legacy_result', v_job.legacy_result
    );
end;
$function$;

revoke all on function public.admin_pa_clear_storage_finalize(uuid)
from public, anon, authenticated;
grant execute on function public.admin_pa_clear_storage_finalize(uuid)
to service_role;

comment on function public.admin_clear_tenant_pa_cycle_records_safe(uuid)
is 'Platform Admin-only PA clear with transactional evidence manifest and retriable Storage API cleanup. Original clear routine reused unchanged.';
