-- Candidate migration: create its timestamped repository file with Supabase CLI.
-- Latest-update attribution only; this is not an immutable audit history.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.pa_stamp_goal_update_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  actor_name text;
  actor_tenant uuid;
  actor_active boolean;
  stamped_at timestamptz := statement_timestamp();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required to update a PA goal.' USING ERRCODE = '42501';
  END IF;
  SELECT p.full_name, p.tenant_id, p.is_active
    INTO actor_name, actor_tenant, actor_active
    FROM public.profiles p WHERE p.id = actor_id;
  IF actor_tenant IS DISTINCT FROM NEW.tenant_id OR actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'An active profile in the same tenant is required.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := stamped_at;
  NEW.payload := coalesce(NEW.payload, '{}'::jsonb) || jsonb_build_object(
    'lastUpdate', jsonb_build_object('userId', actor_id,
      'name', coalesce(nullif(btrim(actor_name), ''), 'Authenticated user'),
      'at', stamped_at));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.pa_stamp_goal_update_actor() FROM PUBLIC, anon, authenticated;
DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['pa_organisation_goals','pa_deliverables','pa_department_goals','pa_individual_goals','pa_progress_updates']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_pa_stamp_goal_update_actor ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER zz_pa_stamp_goal_update_actor BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pa_stamp_goal_update_actor()', table_name);
  END LOOP;
END;
$triggers$;
COMMIT;
