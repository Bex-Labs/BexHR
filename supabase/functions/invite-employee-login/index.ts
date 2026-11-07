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
  systemRole,
  employeeId,
}: {
  supabaseAdmin: any;
  userId: string;
  workEmail: string;
  fullName: string;
  tenantId: string | null;
  systemRole: string;
  employeeId: string;
}) {
  const cleanUserId = cleanText(userId);
  const cleanEmail = cleanText(workEmail).toLowerCase();
  const cleanFullName = cleanText(fullName);

  // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
  // Secure provisioning may create only Employee or Manager access.
  // An existing profile role always remains authoritative.
  const cleanSystemRole =
    normaliseRole(systemRole) === "manager" ? "manager" : "employee";

  if (!cleanUserId || !cleanEmail || !tenantId || !employeeId) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "User account, target employee, or company workspace was missing during login linkage.",
    };
  }

  // PHASE 7A11: An Auth account must not be linked to a different employee or
  // company, even if the requested email matches. Recheck inside each recovery
  // path before modifying an existing profile or employee record.
  const { data: targetEmployee, error: targetEmployeeError } =
    await supabaseAdmin
      .from("employees")
      .select("id, tenant_id, status, user_id, work_email")
      .eq("id", employeeId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

  if (targetEmployeeError || !targetEmployee ||
      normaliseRole(targetEmployee.status) !== "active" ||
      cleanText(targetEmployee.work_email).toLowerCase() !== cleanEmail ||
      (targetEmployee.user_id && targetEmployee.user_id !== cleanUserId)) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "Employee login linkage requires the same active, unclaimed employee record.",
    };
  }

  const { data: existingEmployeeLinks, error: existingEmployeeLinksError } =
    await supabaseAdmin
      .from("employees")
      .select("id, tenant_id")
      .eq("user_id", cleanUserId)
      .limit(2);

  if (existingEmployeeLinksError || !Array.isArray(existingEmployeeLinks) ||
      existingEmployeeLinks.some((linked: any) => linked.id !== employeeId || linked.tenant_id !== tenantId)) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "This Auth login is already linked to another employee or company.",
    };
  }

  const { data: emailProfiles, error: emailProfilesError } =
    await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, is_active")
      .eq("email", cleanEmail)
      .limit(2);

  if (emailProfilesError || !Array.isArray(emailProfiles) ||
      emailProfiles.some((profile: any) => profile.id !== cleanUserId || profile.tenant_id !== tenantId || profile.is_active !== true)) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "An existing email profile is disabled or belongs to another account or company.",
    };
  }

  const { data: existingProfile, error: existingProfileError } =
    await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, role, tenant_id, is_active")
      .eq("id", cleanUserId)
      .maybeSingle();

  if (existingProfileError) {
    console.error("Existing profile lookup failed before profile repair:", existingProfileError);
    return { success: false, linkedEmployeeCount: 0, error: "Existing login ownership could not be validated." };
  }

  if (existingProfile && existingProfile.tenant_id !== tenantId) {
    return { success: false, linkedEmployeeCount: 0, error: "An existing login belongs to another company workspace." };
  }

  // Never turn an intentionally disabled account back on via Resend Invite.
  // Reactivation and admin access approval are separate, audited workflows.
  if (existingProfile && existingProfile.is_active !== true) {
    return { success: false, linkedEmployeeCount: 0, error: "This login is disabled. Use the authorised access-management workflow before resending an invite." };
  }

  if (existingProfile && cleanText(existingProfile.email).toLowerCase() !== cleanEmail) {
    return { success: false, linkedEmployeeCount: 0, error: "Existing login email does not match the selected employee." };
  }

  const profilePayload: Record<string, unknown> = {
    id: cleanUserId,
    email: cleanEmail,
    full_name: cleanText(existingProfile?.full_name) || cleanFullName,
    // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
    // Preserve an existing HR Standard or HR Admin profile.
    role: cleanText(existingProfile?.role) || cleanSystemRole,
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

  // Update exactly the selected employee, not every record matching an email.
  // Preserve the validated user_id state so racing edits cannot silently rebind it.
  let employeeLinkQuery = supabaseAdmin
    .from("employees")
    .update({ user_id: cleanUserId })
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .eq("work_email", cleanEmail);

  employeeLinkQuery = targetEmployee.user_id
    ? employeeLinkQuery.eq("user_id", cleanUserId)
    : employeeLinkQuery.is("user_id", null);

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

  if (!Array.isArray(linkedEmployees) || linkedEmployees.length !== 1 || linkedEmployees[0].id !== employeeId) {
    return {
      success: false,
      linkedEmployeeCount: 0,
      error: "Employee account linkage changed during provisioning. Review the record before retrying.",
    };
  }

  return {
    success: true,
    linkedEmployeeCount: 1,
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

    // HR EMPLOYEE LOGIN RESEND - PHASE 7A11
    // Authorize privileged invites only through the verified Auth user's exact
    // profile ID. Email-based caller fallback can impersonate another profile.
    const { data: callerProfileById, error: callerProfileByIdError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, email, role, is_active, tenant_id")
        .eq("id", callerUser.id)
        .maybeSingle();

    if (callerProfileByIdError) {
      console.error("Caller profile lookup by id failed:", callerProfileByIdError);

      return jsonResponse(403, {
        error: "Caller profile could not be validated.",
      });
    }

    const callerProfile = callerProfileById;

    if (!callerProfile) {
      return jsonResponse(403, { error: "Caller profile not found." });
    }

    const callerRole = normaliseRole(callerProfile.role);

    if (!allowedRoles.has(callerRole) || callerProfile.is_active !== true) {
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
    const requestedTenantId = cleanText(payload.tenantId) || null;
    const callerTenantId = cleanText(callerProfile.tenant_id) || null;
    if (!callerTenantId) {
      return jsonResponse(403, { error: "Caller company workspace could not be validated." });
    }
    if (requestedTenantId && requestedTenantId !== callerTenantId) {
      return jsonResponse(403, { error: "Employee login invite cannot cross company workspaces." });
    }
    const tenantId = callerTenantId;
    const companyName = cleanText(payload.companyName) || "Your Company";

    // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
    // Only Employee or Manager may be provisioned as a new profile.
    const requestedSystemRole =
      normaliseRole(payload.systemRole) === "manager"
        ? "manager"
        : "employee";

    if (!workEmail) {
      return jsonResponse(400, { error: "workEmail is required." });
    }

    if (!fullName) {
      return jsonResponse(400, { error: "fullName is required." });
    }

    const targetEmployeeQuery = supabaseAdmin
      .from("employees")
      .select("id, tenant_id, status, work_email, user_id")
      .eq("tenant_id", tenantId)
      .eq("work_email", workEmail);

    const { data: targetEmployees, error: targetEmployeeError } =
      await targetEmployeeQuery.limit(2);

    if (targetEmployeeError) {
      console.error("Employee lifecycle lookup failed before login invite:", targetEmployeeError);
      return jsonResponse(500, { error: "Employee lifecycle status could not be validated." });
    }

    if (!Array.isArray(targetEmployees) || targetEmployees.length !== 1) {
      return jsonResponse(409, { error: "Exactly one matching employee record is required before login can be provisioned." });
    }

    if (normaliseRole(targetEmployees[0]?.status) !== "active") {
      return jsonResponse(409, {
        error: "This employee is offboarded. Use Reactivate Employee before sending a login invite.",
      });
    }

    // Fail before sending a new invitation when a matching BexHR profile is
    // disabled or belongs to a different company. Never let Resend Invite
    // function as an unapproved access reactivation route.
    const { data: matchingProfiles, error: matchingProfilesError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, tenant_id, is_active")
        .eq("email", workEmail)
        .limit(2);

    if (matchingProfilesError || !Array.isArray(matchingProfiles)) {
      return jsonResponse(500, { error: "Existing employee login access could not be checked." });
    }
    if (matchingProfiles.length > 1 || matchingProfiles.some((profile: any) =>
      profile.tenant_id !== tenantId || profile.is_active !== true)) {
      return jsonResponse(409, { error: "Existing login access is disabled, ambiguous or belongs to another company. Use the authorised access-management workflow." });
    }

    // PHASE 7A11: Trust the configured application origin, never an untrusted
    // request Origin header. APP_URL must match Supabase Auth Redirect URLs.
    const appOrigin = cleanText(Deno.env.get("APP_URL"));
    let trustedOrigin: string;
    try {
      const url = new URL(appOrigin);
      const isLocal = url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      if (url.username || url.password || url.search || url.hash ||
          url.pathname !== "/" || (url.protocol !== "https:" && !isLocal)) {
        throw new Error("APP_URL must be an approved HTTPS origin (or localhost for development).");
      }
      trustedOrigin = url.origin;
    } catch {
      return jsonResponse(500, { error: "Application redirect URL is not configured safely. Contact the administrator." });
    }
    const redirectTo = `${trustedOrigin}/reset-password.html?mode=first-time`;

    // HR EMPLOYEE LOGIN INVITE RECOVERY - STEP 2A
    // Send the invite. If the Auth account already exists, repair/link the
    // existing account instead of returning a dead-end 409 to the HR dashboard.
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(workEmail, {
        data: {
          full_name: fullName,
          company_name: companyName,
          // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
          // Keep Auth metadata aligned with the intended route.
          role: requestedSystemRole,
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
        employeeId: targetEmployees[0].id,

        // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
        systemRole: requestedSystemRole,
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
      employeeId: targetEmployees[0].id,

        // EMPLOYEE/PROFILE ROLE SYNCHRONISATION
        systemRole: requestedSystemRole,
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
