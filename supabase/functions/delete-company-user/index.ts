// ADMIN COMPLETE USER REMOVAL
//
// Permanently force-deletes a company user and releases:
// - the company employee number;
// - the employee work email;
// - the Supabase Auth email.
//
// Security:
// - callable only by an authenticated active platform Admin;
// - service-role key remains inside the Edge Function;
// - self-deletion and Admin deletion are blocked;
// - dependent employee records are purged transactionally before deletion.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normaliseEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function normaliseRole(value: unknown): string {
  return cleanText(value).toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, {
      success: false,
      error: "Method not allowed.",
    });
  }

  try {
    const supabaseUrl = cleanText(
      Deno.env.get("SUPABASE_URL"),
    );

    const anonKey = cleanText(
      Deno.env.get("SUPABASE_ANON_KEY"),
    );

    const serviceRoleKey = cleanText(
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, {
        success: false,
        error: "Required Supabase function secrets are missing.",
      });
    }

    const authorization = cleanText(
      req.headers.get("Authorization"),
    );

    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(401, {
        success: false,
        error: "Unauthorized.",
      });
    }

    const accessToken = authorization.slice(7).trim();

    const authClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      },
    );

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const {
      data: callerAuthData,
      error: callerAuthError,
    } = await authClient.auth.getUser(accessToken);

    const callerUser = callerAuthData?.user;

    if (callerAuthError || !callerUser?.id) {
      return jsonResponse(401, {
        success: false,
        error: "Unauthorized.",
      });
    }

    const {
      data: callerProfile,
      error: callerProfileError,
    } = await supabaseAdmin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", callerUser.id)
      .maybeSingle();

    if (callerProfileError) {
      throw new Error(
        `Caller profile validation failed: ${callerProfileError.message}`,
      );
    }

    if (
      !callerProfile ||
      normaliseRole(callerProfile.role) !== "admin" ||
      callerProfile.is_active === false
    ) {
      return jsonResponse(403, {
        success: false,
        error:
          "Only an active platform Admin can permanently delete company users.",
      });
    }

    let payload: Record<string, unknown>;

    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, {
        success: false,
        error: "A valid request body is required.",
      });
    }

    // ADMIN COMPLETE USER REMOVAL - EMPLOYEE RESOLUTION
    // The browser supplies only the selected profile and confirmation email.
    // The privileged backend resolves the linked employee record securely.
    const profileId = cleanText(payload.profileId);
    const confirmationEmail = normaliseEmail(
      payload.confirmationEmail,
    );

    if (!profileId || !confirmationEmail) {
      return jsonResponse(400, {
        success: false,
        error:
          "Profile ID and confirmation email are required.",
      });
    }

    if (profileId === callerUser.id) {
      return jsonResponse(400, {
        success: false,
        error: "You cannot permanently delete your own Admin account.",
      });
    }

    const {
      data: targetProfile,
      error: targetProfileError,
    } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, email, full_name, role, tenant_id, is_active",
      )
      .eq("id", profileId)
      .maybeSingle();

    if (targetProfileError) {
      throw new Error(
        `Target profile lookup failed: ${targetProfileError.message}`,
      );
    }

    if (!targetProfile) {
      return jsonResponse(404, {
        success: false,
        error: "The selected user profile could not be found.",
      });
    }

    if (normaliseRole(targetProfile.role) === "admin") {
      return jsonResponse(403, {
        success: false,
        error:
          "Platform Admin accounts cannot be deleted through company user management.",
      });
    }

    const profileEmail = normaliseEmail(targetProfile.email);

    if (
      !profileEmail ||
      profileEmail !== confirmationEmail
    ) {
      return jsonResponse(400, {
        success: false,
        error:
          "The confirmation email does not match the selected user.",
      });
    }

    const {
      data: linkedEmployees,
      error: targetEmployeeError,
    } = await supabaseAdmin
      .from("employees")
      .select(
        "id, employee_number, tenant_id, user_id, work_email, first_name, last_name",
      )
      .eq("user_id", profileId);

    if (targetEmployeeError) {
      throw new Error(
        `Employee lookup failed: ${targetEmployeeError.message}`,
      );
    }

    const employeeRecords = Array.isArray(linkedEmployees)
      ? linkedEmployees
      : [];

// ADMIN FORCE DELETE - UNLINKED / ORPHAN USER
//
// A Platform Admin must also be able to remove a profile/login that no
// longer has an employee record. This commonly occurs after test data,
// failed provisioning, or an incomplete historical cleanup.
//
// There is no employee data to purge in this branch, so we clean up the
// Auth account when it still exists, then remove the orphan profile.
if (!employeeRecords.length) {
  const {
    data: targetAuthData,
    error: targetAuthLookupError,
  } = await supabaseAdmin.auth.admin.getUserById(profileId);

  if (targetAuthLookupError) {
    const authLookupMessage =
      cleanText(targetAuthLookupError.message).toLowerCase();

    const authUserAlreadyMissing =
      authLookupMessage.includes("user not found") ||
      authLookupMessage.includes("not found");

    if (!authUserAlreadyMissing) {
      throw new Error(
        `Unlinked Auth account lookup failed: ${targetAuthLookupError.message}`,
      );
    }
  }

  // Remove the Auth identity when one still exists.
  if (targetAuthData?.user?.id) {
    const { error: unlinkedAuthDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(
        profileId,
        false,
      );

    if (unlinkedAuthDeleteError) {
      throw new Error(
        `Unlinked Auth account deletion failed: ${unlinkedAuthDeleteError.message}`,
      );
    }
  }

  // Remove the remaining profile/company-access record.
  const { error: unlinkedProfileDeleteError } =
    await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", profileId);

  if (unlinkedProfileDeleteError) {
    throw new Error(
      `Unlinked profile cleanup failed: ${unlinkedProfileDeleteError.message}`,
    );
  }

  return jsonResponse(200, {
    success: true,
    message:
      "The unlinked company user was permanently deleted. The email is now reusable.",
    deletedUser: {
      profileId,
      employeeId: null,
      email: profileEmail,
      employeeNumber: null,
      tenantId: cleanText(targetProfile.tenant_id),
    },
  });
}

    if (employeeRecords.length > 1) {
      return jsonResponse(409, {
        success: false,
        error:
          "Multiple employee records are linked to this user. Resolve the duplicate linkage before permanent deletion.",
      });
    }

    const targetEmployee = employeeRecords[0];
    const employeeId = cleanText(targetEmployee.id);

    if (!employeeId) {
      throw new Error(
        "The linked employee record does not contain a valid employee ID.",
      );
    }

    if (
      cleanText(targetEmployee.user_id) !== profileId
    ) {
      return jsonResponse(400, {
        success: false,
        error:
          "The selected employee is not linked to the selected user account.",
      });
    }

    if (
      normaliseEmail(targetEmployee.work_email) !==
      profileEmail
    ) {
      return jsonResponse(400, {
        success: false,
        error:
          "The employee email does not match the selected user account.",
      });
    }

    // ADMIN FORCE DELETE - TRANSACTIONAL EMPLOYEE PURGE
    //
    // All relational employee data is removed inside one PostgreSQL RPC.
    // If any unknown restricted dependency prevents deletion, PostgreSQL
    // rolls the entire purge back instead of leaving a partially deleted user.
    const {
      data: purgeResult,
      error: purgeError,
    } = await supabaseAdmin.rpc(
      "admin_force_purge_employee",
      {
        p_employee_id: employeeId,
      },
    );

    if (purgeError) {
      throw new Error(
        `Employee force purge failed: ${purgeError.message}`,
      );
    }

    if (!purgeResult) {
      throw new Error(
        "Employee force purge did not return a result.",
      );
    }

// The transactional employee purge releases employee_number and work_email.
// Supabase Auth cleanup below releases the login email separately.

const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(
        profileId,
        false,
      );

    if (authDeleteError) {
      throw new Error(
        "The employee record was deleted, but the login account could not be removed. " +
        `Retry the permanent deletion for this user. ${authDeleteError.message}`,
      );
    }

    // Standard installations remove profiles through the Auth foreign-key
    // cascade. This explicit cleanup is idempotent and handles installations
    // where the profile is not cascade-deleted.
    const { error: profileDeleteError } =
      await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", profileId);

    if (profileDeleteError) {
      throw new Error(
        `The login was deleted, but profile cleanup failed: ${profileDeleteError.message}`,
      );
    }

    return jsonResponse(200, {
      success: true,
      message:
        "The company user was permanently deleted. The email and employee number are now reusable.",
      deletedUser: {
        profileId,
        employeeId,
        email: profileEmail,
        employeeNumber:
          cleanText(targetEmployee.employee_number),
        tenantId:
          cleanText(targetEmployee.tenant_id),
      },
    });
  } catch (error) {
    console.error(
      "delete-company-user unexpected error:",
      error,
    );

    return jsonResponse(500, {
      success: false,
      error:
        cleanText((error as Error).message) ||
        "The company user could not be permanently deleted.",
    });
  }
});