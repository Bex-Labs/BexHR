// HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-1
// Secure Admin-only backend function for resetting HR users' Supabase TOTP MFA.
//
// Security model:
// - Browser calls this through supabase.functions.invoke() as the signed-in Admin.
// - The function verifies the caller's JWT with Supabase Auth.
// - The function confirms the caller has profiles.role = admin.
// - The function uses the service-role key only inside the Edge Function.
// - The browser never receives or stores the service-role key.
// - Only HR users are reset in this step because HR Dashboard is the MFA-protected workspace.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
        },
    });
}

function normaliseRole(value = "") {
    return String(value || "").trim().toLowerCase();
}

function getFactorType(factor: Record<string, unknown>) {
    return String(
        factor.factor_type ||
        factor.type ||
        "",
    ).trim().toLowerCase();
}

function getFactorStatus(factor: Record<string, unknown>) {
    return String(factor.status || "").trim().toLowerCase();
}

function getFactorsFromAdminResponse(data: unknown) {
    const value = data as Record<string, unknown>;

    if (Array.isArray(data)) return data as Record<string, unknown>[];

    const candidates = [
        value?.factors,
        value?.all,
        value?.totp,
    ];

    const collectedFactors: Record<string, unknown>[] = [];

    candidates.forEach((candidate) => {
        if (Array.isArray(candidate)) {
            collectedFactors.push(...candidate as Record<string, unknown>[]);
        }
    });

    const uniqueFactors = new Map<string, Record<string, unknown>>();

    collectedFactors.forEach((factor) => {
        const id = String(factor.id || "").trim();
        if (!id) return;
        uniqueFactors.set(id, factor);
    });

    return Array.from(uniqueFactors.values());
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: corsHeaders,
        });
    }

    if (req.method !== "POST") {
        return jsonResponse(
            {
                success: false,
                message: "Method not allowed.",
            },
            405,
        );
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const supabaseAnonKey =
            Deno.env.get("SUPABASE_ANON_KEY") ||
            Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
            "";
        const supabaseServiceRoleKey =
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
            Deno.env.get("SUPABASE_SERVICE_KEY") ||
            "";

        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        "Reset MFA function is missing Supabase environment configuration.",
                },
                500,
            );
        }

        const authorizationHeader = req.headers.get("Authorization") || "";

        if (!authorizationHeader.toLowerCase().startsWith("bearer ")) {
            return jsonResponse(
                {
                    success: false,
                    message: "Signed-in Admin session was not provided.",
                },
                401,
            );
        }

        const callerClient = createClient(
            supabaseUrl,
            supabaseAnonKey,
            {
                global: {
                    headers: {
                        Authorization: authorizationHeader,
                    },
                },
            },
        );

        const serviceClient = createClient(
            supabaseUrl,
            supabaseServiceRoleKey,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
            },
        );

        const {
            data: callerUserData,
            error: callerUserError,
        } = await callerClient.auth.getUser();

        if (callerUserError || !callerUserData?.user?.id) {
            return jsonResponse(
                {
                    success: false,
                    message: "Admin session could not be verified.",
                },
                401,
            );
        }

        const callerUserId = callerUserData.user.id;

        const {
            data: callerProfile,
            error: callerProfileError,
        } = await serviceClient
            .from("profiles")
            .select("id, email, role, is_active")
            .eq("id", callerUserId)
            .maybeSingle();

        if (callerProfileError) {
            throw callerProfileError;
        }

        if (
            !callerProfile ||
            normaliseRole(callerProfile.role) !== "admin" ||
            callerProfile.is_active === false
        ) {
            return jsonResponse(
                {
                    success: false,
                    message: "Only an active Admin can reset HR two-factor authentication.",
                },
                403,
            );
        }

        const body = await req.json().catch(() => ({}));

        const targetUserId = String(body.targetUserId || "").trim();
        const targetEmail = String(body.targetEmail || "").trim().toLowerCase();

        if (!targetUserId && !targetEmail) {
            return jsonResponse(
                {
                    success: false,
                    message: "Target HR user was not provided.",
                },
                400,
            );
        }

        let targetQuery = serviceClient
            .from("profiles")
            .select("id, email, full_name, role, is_active");

        if (targetUserId) {
            targetQuery = targetQuery.eq("id", targetUserId);
        } else {
            targetQuery = targetQuery.eq("email", targetEmail);
        }

        const {
            data: targetProfile,
            error: targetProfileError,
        } = await targetQuery.maybeSingle();

        if (targetProfileError) {
            throw targetProfileError;
        }

        if (!targetProfile?.id) {
            return jsonResponse(
                {
                    success: false,
                    message: "Target user profile could not be found.",
                },
                404,
            );
        }

        if (String(targetProfile.id).trim() === callerUserId) {
            return jsonResponse(
                {
                    success: false,
                    message: "Admin cannot reset their own MFA from this workflow.",
                },
                400,
            );
        }

        if (normaliseRole(targetProfile.role) !== "hr") {
            return jsonResponse(
                {
                    success: false,
                    message: "Only HR users can be reset from the HR MFA reset workflow.",
                },
                400,
            );
        }

        const {
            data: factorsData,
            error: factorsError,
        } = await serviceClient.auth.admin.mfa.listFactors({
            userId: targetProfile.id,
        });

        if (factorsError) {
            throw factorsError;
        }

        const factors = getFactorsFromAdminResponse(factorsData);

        const totpFactors = factors.filter((factor) => {
            return getFactorType(factor) === "totp";
        });

        let deletedCount = 0;
        const deletedFactors: Array<{
            id: string;
            status: string;
        }> = [];

        for (const factor of totpFactors) {
            const factorId = String(factor.id || "").trim();

            if (!factorId) continue;

            const {
                error: deleteError,
            } = await serviceClient.auth.admin.mfa.deleteFactor({
                userId: targetProfile.id,
                id: factorId,
            });

            if (deleteError) {
                throw deleteError;
            }

            deletedCount += 1;

            deletedFactors.push({
                id: factorId,
                status: getFactorStatus(factor) || "unknown",
            });
        }

        return jsonResponse({
            success: true,
            targetUserId: targetProfile.id,
            targetEmail: targetProfile.email,
            targetName: targetProfile.full_name || targetProfile.email,
            deletedCount,
            deletedFactors,
            message:
                deletedCount > 0
                    ? `HR two-factor setup was reset for ${targetProfile.full_name || targetProfile.email}. The user must set up MFA again at next HR sign-in.`
                    : `No TOTP MFA factor was found for ${targetProfile.full_name || targetProfile.email}.`,
        });
    } catch (error) {
        console.error("reset-user-mfa error:", error);

        return jsonResponse(
            {
                success: false,
                message:
                    error instanceof Error
                        ? error.message
                        : "HR MFA reset could not be completed.",
            },
            500,
        );
    }
});