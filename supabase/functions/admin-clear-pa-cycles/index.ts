// BexHR R41: Platform Admin PA cycle clear with recoverable evidence cleanup.
// Database RPC authorises the caller and commits a private Storage outbox.
// This server-only function deletes files through the Storage API, then
// finalises the outbox. Never report success while cleanup remains pending.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function respond(status: number, payload: JsonObject): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function completeResponse(result: JsonObject): JsonObject {
  const legacy = asObject(result.legacy_result);
  return {
    success: true,
    storage_cleanup_pending: false,
    deleted_total: Number(legacy.deleted_total || 0),
    pa_templates_preserved: Number(legacy.pa_templates_preserved || 0),
    message: String(legacy.message || "PA cycle records and evidence cleanup completed."),
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, message: "Method not allowed." });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anonKey || !serviceKey) {
    return respond(503, { success: false, message: "Secure PA cleanup service is not configured." });
  }

  const authorization = req.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return respond(401, { success: false, message: "Authentication required." });
  const token = match[1].trim();

  let body: unknown;
  try {
    body = await req.json();
  } catch (_error) {
    return respond(400, { success: false, message: "Invalid request body." });
  }
  const tenantId = String(asObject(body).target_tenant_id || "").trim();
  if (!isUuid(tenantId)) {
    return respond(400, { success: false, message: "Invalid company identifier." });
  }

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Service-role key stays server-side; no privileged operations in the browser.
  const worker = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return respond(401, { success: false, message: "Session verification failed." });
  }

  // The SECURITY DEFINER RPC independently verifies active Platform Admin
  // role, locks the selected tenant, records evidence paths transactionally,
  // and delegates unchanged PA data clearing to the original RPC.
  const { data: startRaw, error: startError } = await caller.rpc(
    "admin_clear_tenant_pa_cycle_records_safe",
    { p_target_tenant_id: tenantId },
  );
  if (startError) {
    console.error("PA clear database step rejected:", startError.message);
    return respond(409, {
      success: false,
      message: startError.message || "PA clear could not proceed.",
    });
  }
  const start = asObject(startRaw);
  if (start.success === true && start.storage_cleanup_pending === false) {
    return respond(200, completeResponse(start));
  }

  const jobId = start.job_id;
  if (!isUuid(jobId) || start.storage_cleanup_pending !== true) {
    return respond(500, {
      success: false,
      message: "Unexpected PA clear response. No completion was confirmed.",
    });
  }

  // Database records have committed. At this point any failure must stay
  // recoverable. The same Admin action safely resumes an existing job.
  let cleanupFailure = "";
  try {
    const { data: manifestRaw, error: manifestError } = await worker.rpc(
      "admin_pa_clear_storage_manifest",
      { p_job_id: jobId },
    );
    if (manifestError) {
      console.error("PA cleanup manifest:", manifestError.message);
      cleanupFailure = "Evidence manifest unavailable.";
    } else {
      const manifest = asObject(manifestRaw);
      const paths = Array.isArray(manifest.paths) ? manifest.paths : null;
      if (paths === null) {
        cleanupFailure = "Unexpected evidence manifest.";
      } else if (!paths.every((path: unknown) =>
        typeof path === "string" && path.startsWith(`${tenantId}/`)
      )) {
        cleanupFailure = "Evidence manifest failed tenant validation.";
      } else {
        // Manifest returns up to 400 current objects. A later invocation
        // resumes from remaining paths if a larger job needs another pass.
        for (let i = 0; i < paths.length; i += 100) {
          const batch = paths.slice(i, i + 100) as string[];
          const { error } = await worker.storage.from("pa-progress-evidence").remove(batch);
          if (error) {
            console.error("PA evidence Storage API cleanup:", error.message);
            cleanupFailure = "Evidence files could not all be removed.";
            break;
          }
        }
      }
    }

    // Finalization checks absence of ALL manifested Storage objects before
    // recording complete. If anything remains, job stays safely retriable.
    const { data: finalRaw, error: finalError } = await worker.rpc(
      "admin_pa_clear_storage_finalize",
      { p_job_id: jobId },
    );
    if (finalError) {
      console.error("PA cleanup finalization:", finalError.message);
      cleanupFailure = "Evidence cleanup verification unavailable.";
    } else {
      const final = asObject(finalRaw);
      if (final.success === true && final.storage_cleanup_pending === false) {
        return respond(200, completeResponse(final));
      }
      return respond(202, {
        success: false,
        storage_cleanup_pending: true,
        remaining_files: final.remaining_files,
        message: "PA records were cleared; evidence file cleanup is incomplete. Retry Clear PA Cycles safely.",
      });
    }
  } catch (error) {
    console.error("PA evidence cleanup interrupted:", error);
    cleanupFailure = "Evidence cleanup interrupted.";
  }

  if (cleanupFailure) console.warn("PA evidence cleanup remains pending:", cleanupFailure);
  return respond(202, {
    success: false,
    storage_cleanup_pending: true,
    message: "PA records were cleared; evidence cleanup awaits verification. Retry Clear PA Cycles safely.",
  });
});
