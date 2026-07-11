// ADMIN COMPLETE USER REMOVAL
//
// Permanently removes an unused/test company user and releases:
// - the company employee number;
// - the employee work email;
// - the Supabase Auth email.
//
// Security:
// - callable only by an authenticated active platform Admin;
// - service-role key remains inside the Edge Function;
// - self-deletion and Admin deletion are blocked;
// - deletion is blocked when payroll/history records exist.

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

async function countLinkedRows(
  supabaseAdmin: ReturnType<typeof createClient>,
  tableName: string,
  columnName: string,
  employeeId: string,
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(tableName)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq(columnName, employeeId);

  if (error) {
    throw new Error(
      `Could not verify ${tableName} dependencies: ${error.message}`,
    );
  }

  return Number(count || 0);
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

if (!employeeRecords.length) {
  return jsonResponse(404, {
    success: false,
    error:
      "No employee record is linked to the selected user account.",
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

    const protectedDependencies = [
      {
        tableName: "payroll_master_records",
        columnName: "employee_id",
        label: "payroll master",
      },
      {
        tableName: "payroll_records",
        columnName: "employee_id",
        label: "payroll",
      },
      {
        tableName: "payroll_employee_overrides",
        columnName: "employee_id",
        label: "payroll override",
      },
      {
        tableName: "payslip_email_logs",
        columnName: "employee_id",
        label: "payslip email",
      },
      {
        tableName: "employee_reporting_lines",
        columnName: "employee_id",
        label: "reporting-line",
      },
      {
        tableName: "employee_reporting_lines",
        columnName: "manager_employee_id",
        label: "manager reporting-line",
      },
    ];

    const blockingRecords: string[] = [];

    for (const dependency of protectedDependencies) {
      const count = await countLinkedRows(
        supabaseAdmin,
        dependency.tableName,
        dependency.columnName,
        employeeId,
      );

      if (count > 0) {
        blockingRecords.push(
          `${dependency.label}: ${count}`,
        );
      }
    }

    if (blockingRecords.length) {
      return jsonResponse(409, {
        success: false,
        error:
          "This employee has protected payroll or reporting history and cannot be permanently deleted.",
        dependencies: blockingRecords,
      });
    }

    const { error: employeeDeleteError } =
      await supabaseAdmin
        .from("employees")
        .delete()
        .eq("id", employeeId);

    if (employeeDeleteError) {
      throw new Error(
        `Employee deletion failed: ${employeeDeleteError.message}`,
      );
    }

    // The employee deletion releases employee_number and work_email.
    // Existing ON DELETE CASCADE rules remove unused child records such
    // as automatically-created leave balances.

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