// EMPLOYEE LOGIN PROVISIONING
// Secure server-side invite for new employees.
//
// This function is called by the HR dashboard immediately after a new employee
// record is created. It validates the calling HR/admin user, then uses the
// Supabase admin API (service role key — never exposed to the browser) to send
// an invite email to the employee's work address.
//
// The invite email contains a secure magic link. When the employee clicks it
// they are prompted to set their own password and are then redirected to the
// HR & Payroll login page. No temporary password is ever transmitted in plain text.
//
// After the invite is issued, the function creates the employee's profiles row
// immediately so that role-based access is ready as soon as they complete setup.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// EMPLOYEE LOGIN PROVISIONING - STEP 1F-2
// Keep invite permissions aligned with HR People maintenance roles.
// HR, HR Manager, Admin, and System Admin can create employee records,
// so the secure invite function must allow the same maintenance roles.
const allowedRoles = new Set([
  "hr",
  "hr_manager",
  "admin",
  "system_admin",
]);

function normaliseRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
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
// HR EMPLOYEE LOGIN INVITE RECOVERY - STEP 2A
// Finds an existing Supabase Auth user by email when inviteUserByEmail reports
// that the account already exists. Supabase Admin does not provide a direct
// getUserByEmail method here, so this uses bounded pagination instead of
// exposing service-role access to the browser.
async function findAuthUserByEmail(supabaseAdmin: any, workEmail: string) {
  const targetEmail = cleanText(workEmail).toLowerCase();

  if (!targetEmail) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      console.error("Auth user lookup by email failed:", error);
      return null;
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    const matchedUser = users.find(
      (user: any) => cleanText(user?.email).toLowerCase() === targetEmail,
    );

    if (matchedUser) return matchedUser;
    if (users.length < 1000) break;
  }

  return null;
}

// HR EMPLOYEE LOGIN INVITE RECOVERY - STEP 2A
// One safe backend path for both new invites and recovery repairs.
// It creates/repairs the profile row and links the existing employee record
// to the Auth user. This prevents "employee saved but No User Account" states.
async function upsertProfileAndLinkEmployeeAccount({
  supabaseAdmin,
  userId,
  workEmail,
  fullName,
  tenantId,
}: {
  supabaseAdmin: any;
  userId: string;
  workEmail: string;
  fullName: string;
  tenantId: string | null;
}) {
  const cleanUserId = cleanText(userId);
  const cleanEmail = cleanText(workEmail).toLowerCase();
  const cleanFullName = cleanText(fullName);

  if (!cleanUserId || !cleanEmail) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "User account or work email was missing during employee login linkage.",
    };
  }

  const { data: existingProfile, error: existingProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, role, tenant_id")
      .eq("id", cleanUserId)
      .maybeSingle();

  if (existingProfileError) {
    console.warn("Existing profile lookup failed before profile repair:", existingProfileError);
  }

  const profilePayload: Record<string, unknown> = {
    id: cleanUserId,
    email: cleanEmail,
    full_name: cleanText(existingProfile?.full_name) || cleanFullName,
    role: cleanText(existingProfile?.role) || "employee",
    is_active: true,
    must_change_password: false,
  };

  if (tenantId) {
    profilePayload.tenant_id = tenantId;
  } else if (existingProfile?.tenant_id) {
    profilePayload.tenant_id = existingProfile.tenant_id;
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" });

  if (profileError) {
    console.error("Profile upsert/repair error after invite:", profileError);

    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "Login account exists, but the profile row could not be created or repaired.",
    };
  }

  let employeeLinkQuery = supabaseAdmin
    .from("employees")
    .update({ user_id: cleanUserId })
    .eq("work_email", cleanEmail);

  if (tenantId) {
    employeeLinkQuery = employeeLinkQuery.eq("tenant_id", tenantId);
  }

  const { data: linkedEmployees, error: employeeLinkError } =
    await employeeLinkQuery.select("id, work_email, user_id");

  if (employeeLinkError) {
    console.error("Employee account linkage error after invite:", employeeLinkError);

    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "Login account exists, but the employee record could not be linked to it.",
    };
  }

  return {
    success: true,
    linkedEmployeeCount: Array.isArray(linkedEmployees) ? linkedEmployees.length : 0,
    error: "",
  };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing authorization header." });
    }

    // Build the admin Supabase client using the service role key.
    // This key is stored as a Supabase secret and is never sent to the browser.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Build a user-scoped client to verify the caller's identity and role.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verify the calling user is authenticated.
    const { data: { user: callerUser }, error: callerAuthError } =
      await supabaseUser.auth.getUser();

    if (callerAuthError || !callerUser) {
      return jsonResponse(401, { error: "Unauthorized." });
    }

    // HR EMPLOYEE LOGIN RESEND - STEP 15K
    // Verify the caller has an active HR or Admin profile.
    // Primary lookup is by verified Auth user id. Email fallback is used only from
    // the verified JWT user object, so the browser cannot spoof caller identity.
    const { data: callerProfileById, error: callerProfileByIdError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, email, role, is_active")
        .eq("id", callerUser.id)
        .maybeSingle();

    if (callerProfileByIdError) {
      console.error("Caller profile lookup by id failed:", callerProfileByIdError);

      return jsonResponse(403, {
        error: "Caller profile could not be validated.",
      });
    }

    let callerProfile = callerProfileById;

    const callerEmail = cleanText(callerUser.email).toLowerCase();

    if (!callerProfile && callerEmail) {
      const { data: callerProfileByEmail, error: callerProfileByEmailError } =
        await supabaseAdmin
          .from("profiles")
          .select("id, email, role, is_active")
          .eq("email", callerEmail)
          .maybeSingle();

      if (callerProfileByEmailError) {
        console.error("Caller profile lookup by email failed:", callerProfileByEmailError);

        return jsonResponse(403, {
          error: "Caller profile could not be validated.",
        });
      }

      callerProfile = callerProfileByEmail;
    }

    if (!callerProfile) {
      return jsonResponse(403, { error: "Caller profile not found." });
    }

    const callerRole = normaliseRole(callerProfile.role);

    if (!allowedRoles.has(callerRole) || callerProfile.is_active === false) {
      return jsonResponse(403, {
        error: "You do not have permission to provision employee logins.",
      });
    }

    // Parse and validate the request payload.
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body." });
    }

    const workEmail = cleanText(payload.workEmail).toLowerCase();
    const fullName = cleanText(payload.fullName);
    const tenantId = cleanText(payload.tenantId) || null;
    const companyName = cleanText(payload.companyName) || "Your Company";

    if (!workEmail) {
      return jsonResponse(400, { error: "workEmail is required." });
    }

    if (!fullName) {
      return jsonResponse(400, { error: "fullName is required." });
    }

    // EMPLOYEE LOGIN PROVISIONING HARDENING - STEP 1
    // The invite email says "Set My Password", so the verified invite must
    // return to the password setup page, not the normal sign-in landing page.
    // APP_URL must match the Supabase Auth Site URL / Redirect URLs exactly.
    const appOrigin = cleanText(Deno.env.get("APP_URL")) ||
      cleanText(req.headers.get("origin"));

    const redirectTo = appOrigin
      ? `${appOrigin}/reset-password.html?mode=first-time`
      : "/reset-password.html?mode=first-time";

    // HR EMPLOYEE LOGIN INVITE RECOVERY - STEP 2A
    // Send the invite. If the Auth account already exists, repair/link the
    // existing account instead of returning a dead-end 409 to the HR dashboard.
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(workEmail, {
        data: {
          full_name: fullName,
          company_name: companyName,
          role: "employee",
        },
        redirectTo,
      });

    if (inviteError) {
      const message = cleanText(inviteError.message).toLowerCase();
      const isExistingAccount =
        message.includes("already registered") ||
        message.includes("already been registered") ||
        message.includes("user already exists");

      if (!isExistingAccount) {
        console.error("inviteUserByEmail error:", inviteError);
        throw new Error(inviteError.message || "Invite could not be sent.");
      }

      const existingAuthUser = await findAuthUserByEmail(
        supabaseAdmin,
        workEmail,
      );

      if (!existingAuthUser?.id) {
        return jsonResponse(409, {
          success: false,
          existingAccount: true,
          inviteSent: false,
          error:
            `A login account already exists for ${workEmail}, but it could not be found for employee linkage. Please review the Auth user manually.`,
        });
      }

      const linkResult = await upsertProfileAndLinkEmployeeAccount({
        supabaseAdmin,
        userId: existingAuthUser.id,
        workEmail,
        fullName,
        tenantId,
      });

      if (!linkResult.success || linkResult.linkedEmployeeCount < 1) {
        return jsonResponse(500, {
          success: false,
          existingAccount: true,
          inviteSent: false,
          error:
            linkResult.error ||
            "Existing login account was found, but no matching employee record was linked.",
        });
      }

      // HR EMPLOYEE LOGIN RESEND - STEP 15B
      // Existing Auth users cannot receive a new invite via inviteUserByEmail.
      // Send a secure password setup/recovery email instead, after HR permission
      // and employee linkage have already been validated server-side.
      const { error: recoveryEmailError } =
        await supabaseAdmin.auth.resetPasswordForEmail(workEmail, {
          redirectTo,
        });

      if (recoveryEmailError) {
        console.error("Existing employee login recovery email error:", recoveryEmailError);

        return jsonResponse(500, {
          success: false,
          existingAccount: true,
          inviteSent: false,
          recoveryEmailSent: false,
          linkedEmployeeCount: linkResult.linkedEmployeeCount,
          error:
            recoveryEmailError.message ||
            `Existing login account was linked, but a new setup link could not be sent to ${workEmail}.`,
        });
      }

      return jsonResponse(200, {
        success: true,
        existingAccount: true,
        inviteSent: false,
        recoveryEmailSent: true,
        linkedEmployeeCount: linkResult.linkedEmployeeCount,
        message:
          `Existing login account found for ${workEmail}. A fresh setup link has been sent.`,
      });
    }

    const newUserId = cleanText(inviteData?.user?.id);

    if (!newUserId) {
      return jsonResponse(500, {
        success: false,
        inviteSent: true,
        error:
          "Login invite was created, but Supabase did not return the Auth user ID needed to link the employee record.",
      });
    }

    const linkResult = await upsertProfileAndLinkEmployeeAccount({
      supabaseAdmin,
      userId: newUserId,
      workEmail,
      fullName,
      tenantId,
    });

    if (!linkResult.success || linkResult.linkedEmployeeCount < 1) {
      return jsonResponse(500, {
        success: false,
        inviteSent: true,
        error:
          linkResult.error ||
          "Login invite was created, but no matching employee record was linked.",
      });
    }

    return jsonResponse(200, {
      success: true,
      existingAccount: false,
      inviteSent: true,
      linkedEmployeeCount: linkResult.linkedEmployeeCount,
      message: `Login invite sent to ${workEmail}.`,
    });
  } catch (error) {
    console.error("invite-employee-login unexpected error:", error);
    return jsonResponse(500, {
      error: cleanText((error as Error).message) ||
        "An unexpected error occurred.",
    });
  }
});
