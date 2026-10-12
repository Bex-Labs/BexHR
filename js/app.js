// =========================================================
// LANDING PAGE LOADER - v1.0.0
//
// Presentation only.
//
// The loader is released when the public landing page has
// completed browser loading. It does not wait on authentication,
// tenant validation, Supabase profile loading, or sign-in logic.
// =========================================================
function releaseLandingPageLoader() {
  const body = document.body;

  const loader =
    document.getElementById("bexhrLandingLoader");

  const firstPaintGate =
    document.getElementById(
      "landingWorkspaceFirstPaintGate",
    );


  body?.classList.remove(
    "landing-workspace-booting",
  );

  body?.removeAttribute("aria-busy");


  firstPaintGate?.remove();


  if (!loader) return;


  loader.setAttribute(
    "aria-hidden",
    "true",
  );

  loader.style.opacity = "0";
  loader.style.pointerEvents = "none";


  window.setTimeout(() => {
    loader.remove();
  }, 220);
}


// LANDING PAGE LOADER - v1.0.0
// Do not introduce an artificial loading delay.
// Release as soon as the browser reports the landing page ready.
if (document.readyState === "complete") {

  window.requestAnimationFrame(() => {
    releaseLandingPageLoader();
  });

} else {

  window.addEventListener(
    "load",
    releaseLandingPageLoader,
    { once: true },
  );

}

document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("loginForm");

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
  // Company/Tenant ID is collected during login before tenant validation
  // is wired in the next step.
  const loginTenantCodeInput = document.getElementById("loginTenantCode");

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const alertContainer = document.getElementById("loginAlertContainer");
  const togglePasswordBtn = document.getElementById("togglePasswordBtn");
  const togglePasswordIcon = document.getElementById("togglePasswordIcon");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const rememberMeInput = document.getElementById("rememberMe");
  const REMEMBERED_LOGIN_STORAGE_KEY = "hrPayrollRememberedLogin";
  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
  // Supabase-backed TOTP MFA controls for HR dashboard access.
  const hrMfaPanel = document.getElementById("hrMfaPanel");
  const hrMfaTitle = document.getElementById("hrMfaTitle");
  const hrMfaDescription = document.getElementById("hrMfaDescription");
  const hrMfaEnrollmentBox = document.getElementById("hrMfaEnrollmentBox");
  const hrMfaQrCodeImage = document.getElementById("hrMfaQrCodeImage");
  const hrMfaSecretValue = document.getElementById("hrMfaSecretValue");
  const hrMfaCodeInput = document.getElementById("hrMfaCodeInput");
  const hrMfaStatus = document.getElementById("hrMfaStatus");
  const hrMfaRecoveryNote = document.getElementById("hrMfaRecoveryNote");
  const verifyHrMfaBtn = document.getElementById("verifyHrMfaBtn");
  const cancelHrMfaBtn = document.getElementById("cancelHrMfaBtn");

  let pendingHrMfaLoginContext = null;
  let pendingHrMfaFactorId = "";
  let pendingHrMfaMode = "";
  const SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
  );

  window.SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  window.SUPABASE_ANON_KEY = "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  const supabaseClient = window.supabaseClient;
  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Dedicated browser cache key for the validated tenant/company context.
  // This allows dashboards to know which company workspace the signed-in user belongs to.
  const TENANT_CONTEXT_STORAGE_KEY = "hrPayrollTenantContext";
  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Matches the safe post-login redirect key used by session.js.
  const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

  function showAlert(message, type) {
    if (!alertContainer) return;

    alertContainer.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }

  function clearValidationStates() {
    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
    // Clear Tenant ID validation together with existing login fields.
    if (loginTenantCodeInput) loginTenantCodeInput.classList.remove("is-invalid");

    if (emailInput) emailInput.classList.remove("is-invalid");
    if (passwordInput) passwordInput.classList.remove("is-invalid");
  }

  /* =========================================================
     Role-to-dashboard routing
  ========================================================= */
  function getDashboardByRole(role) {
    const roleRoutes = {
      employee: "/employee-dashboard.html",
      manager: "/manager-dashboard.html",
      hr: "/hr-dashboard.html",
      admin: "/admin-dashboard.html",
    };

    return roleRoutes[role] || "/index.html";
  }

  // PAYSLIP EMAIL DEEP LINK ROUTING - STEP 4A
  // Return a stored safe post-login payroll destination based on the signed-in
  // user's role. Payslip email login also carries source=payslip-email so the
  // Employee Dashboard can open Payroll History by default only for this journey.
  function getSafePostLoginRedirectForRole(role = "") {
    const userRole = String(role || "").trim().toLowerCase();

    try {
      const storedRedirect = sessionStorage.getItem(
        POST_LOGIN_REDIRECT_STORAGE_KEY,
      );

      sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);

      const isPayslipEmailRedirect =
        storedRedirect === "/employee-dashboard.html?section=payroll&source=payslip-email";

      const isStandardPayrollRedirect = [
        "/employee-dashboard.html?section=payroll",
        "/hr-dashboard.html?workspace=selfservice&section=payroll",
      ].includes(storedRedirect);

      if (!isPayslipEmailRedirect && !isStandardPayrollRedirect) {
        return "";
      }

      if (userRole === "employee") {
        return isPayslipEmailRedirect
          ? "/employee-dashboard.html?section=payroll&source=payslip-email"
          : "/employee-dashboard.html?section=payroll";
      }

      if (userRole === "hr") {
        return "/hr-dashboard.html?workspace=selfservice&section=payroll";
      }
    } catch (error) {
      console.warn("Safe post-login redirect could not be resolved:", error);
    }

    return "";
  }

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
  // HR Dashboard is the sensitive workspace. Only profile.role = hr is forced
  // through MFA here. Admin, Manager, and Employee routes are not changed in
  // this step.
  function isHrDashboardMfaRequiredRole(role = "") {
    return String(role || "").trim().toLowerCase() === "hr";
  }

  function setHrMfaStatus(type = "info", message = "") {
    if (!hrMfaStatus) return;

    hrMfaStatus.className = `alert alert-${type} mt-3 mb-0`;
    hrMfaStatus.textContent = message;
    hrMfaStatus.classList.toggle("d-none", !message);
  }

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2B
  // Convert Supabase/Auth MFA errors into HR-friendly operational guidance.
  function getFriendlyHrMfaErrorMessage(error = {}, mode = "") {
    const rawMessage = String(error?.message || error || "").trim();
    const normalisedMessage = rawMessage.toLowerCase();

    if (
      normalisedMessage.includes("invalid") ||
      normalisedMessage.includes("not accepted") ||
      normalisedMessage.includes("code")
    ) {
      return "The authenticator code was not accepted. Enter the current 6-digit code from your authenticator app. If it is about to expire, wait for the next code and try again.";
    }

    if (
      normalisedMessage.includes("expired") ||
      normalisedMessage.includes("challenge")
    ) {
      return "This verification attempt expired. Enter the current code from your authenticator app and try again.";
    }

    if (
      normalisedMessage.includes("factor") &&
      normalisedMessage.includes("not found")
    ) {
      return "The MFA factor could not be found. Please sign in again. If this continues, ask your administrator to reset your HR two-factor setup.";
    }

    if (
      normalisedMessage.includes("too many") ||
      normalisedMessage.includes("maximum") ||
      normalisedMessage.includes("upper limit")
    ) {
      return "This account has too many MFA factors. Ask your administrator to remove old or incomplete authenticator factors before trying again.";
    }

    if (mode === "enroll") {
      return rawMessage || "Authenticator setup could not be completed. Please try again or ask your administrator to reset your HR two-factor setup.";
    }

    return rawMessage || "Two-factor verification failed. Check the current authenticator code and try again.";
  }

  function getHrMfaFactorType(factor = {}) {
    return String(factor.factor_type || factor.type || "").trim().toLowerCase();
  }

  function getHrMfaFactorStatus(factor = {}) {
    return String(factor.status || "").trim().toLowerCase();
  }

  function isHrTotpFactor(factor = {}) {
    return getHrMfaFactorType(factor) === "totp";
  }

  function getUniqueHrMfaFactors(data = {}) {
    const factors = [
      ...(Array.isArray(data?.totp) ? data.totp : []),
      ...(Array.isArray(data?.all) ? data.all : []),
    ];

    const uniqueFactors = new Map();

    factors.forEach((factor) => {
      if (!factor?.id) return;
      uniqueFactors.set(factor.id, factor);
    });

    return Array.from(uniqueFactors.values());
  }

  async function listHrMfaFactors() {
    const { data, error } = await supabaseClient.auth.mfa.listFactors();

    if (error) {
      throw error;
    }

    return getUniqueHrMfaFactors(data);
  }

  function sortHrMfaFactorsNewestFirst(factors = []) {
    return [...factors].sort((firstFactor, secondFactor) => {
      const firstDate = new Date(
        firstFactor.updated_at ||
        firstFactor.created_at ||
        0,
      ).getTime();

      const secondDate = new Date(
        secondFactor.updated_at ||
        secondFactor.created_at ||
        0,
      ).getTime();

      return secondDate - firstDate;
    });
  }

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2B
  // If a previous QR setup was abandoned, Supabase may still have an
  // unverified TOTP factor. Clean those up before creating another QR setup.
  // This prevents a pile-up of incomplete HR MFA factors.
  async function cleanupUnverifiedHrTotpFactors() {
    if (!supabaseClient.auth?.mfa?.unenroll) {
      return 0;
    }

    const factors = await listHrMfaFactors();
    const unverifiedTotpFactors = factors.filter((factor) => {
      return isHrTotpFactor(factor) && getHrMfaFactorStatus(factor) === "unverified";
    });

    let removedCount = 0;

    for (const factor of unverifiedTotpFactors) {
      try {
        const { error } = await supabaseClient.auth.mfa.unenroll({
          factorId: factor.id,
        });

        if (error) {
          console.warn("Incomplete HR MFA factor could not be removed.", error);
          continue;
        }

        removedCount += 1;
      } catch (error) {
        console.warn("Incomplete HR MFA factor cleanup failed.", error);
      }
    }

    return removedCount;
  }

  function normaliseHrMfaCode(value = "") {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
  }

  function setHrMfaLoading(isLoading = false, label = "Verify and Continue") {
    if (!verifyHrMfaBtn) return;

    verifyHrMfaBtn.disabled = isLoading || normaliseHrMfaCode(hrMfaCodeInput?.value).length !== 6;

    verifyHrMfaBtn.innerHTML = isLoading
      ? `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Verifying...`
      : `<i class="bi bi-shield-check me-2"></i>${label}`;
  }

  function getHrMfaQrCodeImageSource(qrCode = "") {
    const value = String(qrCode || "").trim();

    if (!value) return "";

    if (value.startsWith("data:") || value.startsWith("http")) {
      return value;
    }

    if (value.startsWith("<svg")) {
      return `data:image/svg+xml;utf8,${encodeURIComponent(value)}`;
    }

    return value;
  }

  function showHrMfaPanel({
    mode = "challenge",
    factorId = "",
    qrCode = "",
    secret = "",
  } = {}) {
    pendingHrMfaMode = mode;
    pendingHrMfaFactorId = factorId;

    loginForm?.classList.add("d-none");
    hrMfaPanel?.classList.remove("d-none");
    document.body.classList.add("bexhr-mfa-active");

    if (hrMfaCodeInput) {
      hrMfaCodeInput.value = "";
      hrMfaCodeInput.focus();
    }

    if (mode === "enroll") {
      setHrMfaStatus(
        "info",
        "Scan the QR code, then enter the current 6-digit code to complete setup.",
      );
    } else {
      setHrMfaStatus("", "");
    }

    if (hrMfaTitle) {
      hrMfaTitle.textContent =
        mode === "enroll"
          ? "Set up secure verification"
          : "Secure verification";
    }

    if (hrMfaDescription) {
      hrMfaDescription.textContent =
        mode === "enroll"
          ? "Scan the QR code once, then confirm setup with the latest authenticator code."
          : "Step 2 of 2. Enter the latest code from your authenticator app.";
    }

    if (hrMfaRecoveryNote) {
      hrMfaRecoveryNote.classList.remove("d-none");
    }

    hrMfaEnrollmentBox?.classList.toggle("d-none", mode !== "enroll");

    if (hrMfaQrCodeImage) {
      const imageSource = getHrMfaQrCodeImageSource(qrCode);
      hrMfaQrCodeImage.src = imageSource;
      hrMfaQrCodeImage.classList.toggle("d-none", !imageSource);
    }

    if (hrMfaSecretValue) {
      hrMfaSecretValue.textContent = secret || "--";
    }

    setHrMfaLoading(false);
  }

  function hideHrMfaPanel() {
    pendingHrMfaLoginContext = null;
    pendingHrMfaFactorId = "";
    pendingHrMfaMode = "";

    hrMfaPanel?.classList.add("d-none");
    hrMfaEnrollmentBox?.classList.add("d-none");
    loginForm?.classList.remove("d-none");
    document.body.classList.remove("bexhr-mfa-active");

    if (hrMfaCodeInput) {
      hrMfaCodeInput.value = "";
    }

    setHrMfaStatus("", "");
  }

  function buildApplicationSessionPayload({
    authData,
    profile,
    cachedTenantContext,
  } = {}) {
    return {
      userId: authData.user.id,
      email: profile.email || authData.user.email,
      fullName: profile.full_name || "",
      role: profile.role,
      department: profile.department || "",

      tenantId: cachedTenantContext?.tenantId || null,
      tenantCode: cachedTenantContext?.tenantCode || "",
      companyName: cachedTenantContext?.companyName || "Platform Admin",

      loginTime: new Date().toISOString(),
    };
  }

  function finishSuccessfulLoginRedirect(loginContext = {}) {
    const { authData, profile, tenantValidation, cachedTenantContext } = loginContext;

    localStorage.setItem(
      "hrPayrollSession",
      JSON.stringify(
        buildApplicationSessionPayload({
          authData,
          profile,
          cachedTenantContext,
        }),
      ),
    );

    const redirectTarget =
      getSafePostLoginRedirectForRole(profile.role) ||
      getDashboardByRole(profile.role);

    console.log("Supabase sign-in success:", {
      userId: authData.user.id,
      email: profile.email || authData.user.email,
      role: profile.role,
      redirectTarget,
      source: "profiles.role",
      mfa: isHrDashboardMfaRequiredRole(profile.role) ? "aal2-required" : "not-required",
    });

    setTimeout(function () {
      window.location.href = redirectTarget;
    }, 1200);
  }

  async function getVerifiedHrTotpFactor() {
    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2B
    // Prefer an existing verified TOTP factor instead of enrolling again.
    // This keeps future HR sign-ins as code-only verification, not QR setup.
    const factors = await listHrMfaFactors();

    const verifiedTotpFactors = factors.filter((factor) => {
      const status = getHrMfaFactorStatus(factor);

      return isHrTotpFactor(factor) && (!status || status === "verified");
    });

    return sortHrMfaFactorsNewestFirst(verifiedTotpFactors)[0] || null;
  }

  async function verifySupabaseMfaFactor(factorId = "", code = "") {
    if (!factorId) {
      throw new Error("MFA factor was not found. Please sign in again.");
    }

    if (typeof supabaseClient.auth.mfa.challengeAndVerify === "function") {
      const { error } = await supabaseClient.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

      if (error) {
        throw error;
      }

      return;
    }

    const { data: challengeData, error: challengeError } =
      await supabaseClient.auth.mfa.challenge({
        factorId,
      });

    if (challengeError) {
      throw challengeError;
    }

    const { error: verifyError } = await supabaseClient.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });

    if (verifyError) {
      throw verifyError;
    }
  }

  async function startHrDashboardMfaFlow(loginContext = {}) {
    if (!supabaseClient.auth?.mfa?.getAuthenticatorAssuranceLevel) {
      throw new Error("Supabase MFA is not available in this environment.");
    }

    pendingHrMfaLoginContext = loginContext;

    const { data: assuranceData, error: assuranceError } =
      await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

    if (assuranceError) {
      throw assuranceError;
    }

    if (assuranceData?.currentLevel === "aal2") {
      finishSuccessfulLoginRedirect(loginContext);
      return true;
    }

    const existingTotpFactor = await getVerifiedHrTotpFactor();

    if (existingTotpFactor?.id) {
      showHrMfaPanel({
        mode: "challenge",
        factorId: existingTotpFactor.id,
      });

      return true;
    }

    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2B
    // Clean up abandoned unverified TOTP setup attempts before creating a new
    // QR setup. This avoids creating a new incomplete factor every time HR
    // cancels or refreshes during first-time MFA enrollment.
    const removedIncompleteFactors = await cleanupUnverifiedHrTotpFactors();

    if (removedIncompleteFactors > 0) {
      console.info(
        `Removed ${removedIncompleteFactors} incomplete HR MFA setup factor(s).`,
      );
    }

    const { data: enrollData, error: enrollError } =
      await supabaseClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "BexHR HR Dashboard",
      });

    if (enrollError) {
      throw enrollError;
    }

    showHrMfaPanel({
      mode: "enroll",
      factorId: enrollData.id,
      qrCode: enrollData.totp?.qr_code || "",
      secret: enrollData.totp?.secret || "",
    });

    return true;
  }

  async function handleHrMfaVerification() {
    const code = normaliseHrMfaCode(hrMfaCodeInput?.value);

    if (hrMfaCodeInput) {
      hrMfaCodeInput.value = code;
    }

    if (code.length !== 6) {
      setHrMfaStatus("warning", "Enter the 6-digit code from your authenticator app.");
      setHrMfaLoading(false);
      return;
    }

    try {
      setHrMfaLoading(true);
      setHrMfaStatus("info", "Verifying HR two-factor code...");

      await verifySupabaseMfaFactor(pendingHrMfaFactorId, code);

      const { data: assuranceData, error: assuranceError } =
        await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

      if (assuranceError) {
        throw assuranceError;
      }

      if (assuranceData?.currentLevel !== "aal2") {
        throw new Error("Two-factor verification did not promote the session to AAL2.");
      }

      const loginContext = pendingHrMfaLoginContext;

      hideHrMfaPanel();

      finishSuccessfulLoginRedirect(loginContext);
    } catch (error) {
      console.error("HR MFA verification failed:", error);

      setHrMfaStatus(
        "danger",
        getFriendlyHrMfaErrorMessage(error, pendingHrMfaMode),
      );

      setHrMfaLoading(false);
    }
  }

  async function cancelHrMfaVerification() {
    try {
      await supabaseClient.auth.signOut();
    } catch (error) {
      console.warn("HR MFA cancel sign-out failed:", error);
    }

    localStorage.removeItem("hrPayrollSession");
    localStorage.removeItem("hrPayrollTenantContext");

    hideHrMfaPanel();

    showAlert(
      "HR two-factor verification was cancelled. Please sign in again to access the HR Dashboard.",
      "warning",
    );
  }

  // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4C
  // The email button opens the public login/landing page first.
  // When ?payslip=1&source=payslip-email is present, cache a safe payroll
  // destination for after successful login. The source flag is intentionally
  // preserved so Employee Dashboard can open Payroll History automatically
  // only for this email journey.
  // No payroll ID, salary value, bank detail, employee ID, or arbitrary URL is stored.
  function cachePayslipEmailLandingIntentFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const isPayslipEmailLanding =
        String(params.get("payslip") || "").trim() === "1" &&
        String(params.get("source") || "").trim() === "payslip-email";

      if (!isPayslipEmailLanding) return;

      sessionStorage.setItem(
        POST_LOGIN_REDIRECT_STORAGE_KEY,
        "/employee-dashboard.html?section=payroll&source=payslip-email",
      );
    } catch (error) {
      console.warn("Payslip email landing intent could not be cached:", error);
    }
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-3
  // Validate the entered Company/Tenant ID after Supabase email/password
  // authentication succeeds. This uses the safe database function created in
  // Step 1F-1 and does not directly query or update tenant/profile tables here.
  async function validateTenantLoginForSignedInUser(loginTenantCode = "") {
    const cleanTenantCode = String(loginTenantCode || "").trim().toUpperCase();

    const { data, error } = await supabaseClient.rpc(
      "validate_current_user_tenant_login",
      {
        input_tenant_code: cleanTenantCode,
      },
    );

    if (error) {
      throw error;
    }

    const validationResult = Array.isArray(data) ? data[0] : data;

    return {
      isValid: Boolean(validationResult?.is_valid),
      tenantId: validationResult?.tenant_id || null,
      tenantCode: validationResult?.tenant_code || cleanTenantCode,
      companyName: validationResult?.company_name || "",
      reason:
        validationResult?.reason ||
        "Tenant login validation failed. Please check your Company/Tenant ID.",
    };
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Store the validated tenant context after login succeeds.
  // This is only written after the database confirms the user belongs to
  // the entered Company/Tenant ID.
  function cacheValidatedTenantContext({
    userId = "",
    tenantId = "",
    tenantCode = "",
    companyName = "",
  } = {}) {
    const tenantContext = {
      userId,
      tenantId,
      tenantCode: String(tenantCode || "").trim().toUpperCase(),
      companyName: String(companyName || "").trim(),
      cachedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      TENANT_CONTEXT_STORAGE_KEY,
      JSON.stringify(tenantContext),
    );

    return tenantContext;
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Read the cached tenant context safely.
  // If the cache is missing or corrupted, return null and let login continue normally.
  function getCachedTenantContext() {
    try {
      const rawValue = localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY);
      if (!rawValue) return null;

      const parsedValue = JSON.parse(rawValue);

      if (!parsedValue?.tenantCode) {
        return null;
      }

      return parsedValue;
    } catch (error) {
      localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
      return null;
    }
  }

  // REMEMBER ME - LOGIN PREFILL
  // Stores only non-sensitive login hints. Never store passwords.
  function getRememberedLoginDetails() {
    try {
      const rawValue = localStorage.getItem(REMEMBERED_LOGIN_STORAGE_KEY);
      if (!rawValue) return null;

      const parsedValue = JSON.parse(rawValue);

      return {
        tenantCode: String(parsedValue?.tenantCode || "").trim().toUpperCase(),
        email: String(parsedValue?.email || "").trim().toLowerCase(),
      };
    } catch (error) {
      localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
      return null;
    }
  }

  // REMEMBER ME - LOGIN PREFILL
  // Prefills Company/Tenant ID and email when the user previously selected Remember me.
  function prefillRememberedLoginDetails() {
    const rememberedLogin = getRememberedLoginDetails();

    if (!rememberedLogin) return;

    if (loginTenantCodeInput && rememberedLogin.tenantCode) {
      loginTenantCodeInput.value = rememberedLogin.tenantCode;
    }

    if (emailInput && rememberedLogin.email) {
      emailInput.value = rememberedLogin.email;
    }

    if (rememberMeInput) {
      rememberMeInput.checked = true;
    }
  }

  // REMEMBER ME - LOGIN PREFILL
  // Saves or clears remembered login details after a successful login.
  function cacheRememberedLoginDetails({
    tenantCode = "",
    email = "",
  } = {}) {
    if (!rememberMeInput?.checked) {
      localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      REMEMBERED_LOGIN_STORAGE_KEY,
      JSON.stringify({
        tenantCode: String(tenantCode || "").trim().toUpperCase(),
        email: String(email || "").trim().toLowerCase(),
        rememberedAt: new Date().toISOString(),
      }),
    );
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // If a tenant was validated earlier and the cache still exists, prefill the
  // Company/Tenant ID field so the user does not need to retype it.
  function prefillTenantCodeFromCache() {
    if (!loginTenantCodeInput || loginTenantCodeInput.value) return;

    const cachedTenant = getCachedTenantContext();
    if (!cachedTenant?.tenantCode) return;

    loginTenantCodeInput.value = cachedTenant.tenantCode;
  }

  async function handleForgotPassword(event) {
    event.preventDefault();

    if (!emailInput) return;

    clearValidationStates();
    alertContainer.innerHTML = "";

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      emailInput.classList.add("is-invalid");
      showAlert(
        "Enter your email address first, then click Forgot password again.",
        "warning",
      );
      return;
    }

    // PASSWORD RESET PRODUCTION ROUTING - STEP 1
    // Local development stays local. Any hosted deployment, including the
    // Vercel preview URL, sends recovery links to the public BexHR domain.
    const isLocalPasswordResetOrigin = [
      "localhost",
      "127.0.0.1",
    ].includes(window.location.hostname);

    const resetRedirectOrigin = isLocalPasswordResetOrigin
      ? window.location.origin
      : "https://app.bexhr.com";

    const resetRedirectUrl =
      `${resetRedirectOrigin}/reset-password.html?mode=recovery`;

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: resetRedirectUrl,
      });

      if (error) {
        showAlert(
          error.message || "Password reset request could not be sent.",
          "danger",
        );
        return;
      }

      showAlert(
        `A password reset link has been sent to <strong>${email}</strong>. Please check your inbox.`,
        "success",
      );
    } catch (error) {
      console.error("Forgot password error:", error);
      showAlert(
        "An unexpected error occurred while sending reset email.",
        "danger",
      );
    }
  }

  function showMessageFromQueryString() {
    const params = new URLSearchParams(window.location.search);
    const message = params.get("message");
    const authError = String(params.get("error") || "")
      .trim()
      .toLowerCase();
    const authErrorCode = String(params.get("error_code") || "")
      .trim()
      .toLowerCase();
    const authErrorDescription = String(
      params.get("error_description") || "",
    ).trim();

    const isExpiredAuthLink =
      authErrorCode === "otp_expired" ||
      authErrorDescription.toLowerCase().includes("expired");

    if (isExpiredAuthLink) {
      showAlert(
        "This password reset link is invalid or has expired. Request a new password reset email and use only the newest link.",
        "danger",
      );
      return;
    }

    if (authError || authErrorCode) {
      showAlert(
        "This authentication link could not be completed. Please request a new password reset email and try again.",
        "danger",
      );
      return;
    }

    if (!message) return;

    switch (message) {
      case "session-timeout":
        showAlert(
          "Your session expired due to inactivity. Please sign in again.",
          "warning",
        );
        break;
      case "session-expired":
        showAlert("Your session has expired. Please sign in again.", "warning");
        break;
      case "unauthorized":
        showAlert("You are not authorized to access that page.", "danger");
        break;
      case "hr-mfa-required":
        showAlert(
          "HR Dashboard access requires two-factor verification. Please sign in and complete the authenticator code step.",
          "warning",
        );
        break;
      case "password-reset-success":
        showAlert(
          "Your password has been reset successfully. You can now sign in.",
          "success",
        );
        break;
      case "first-time-setup-success":
        showAlert(
          "Your account setup is complete. Please sign in with your new password.",
          "success",
        );
        break;
      default:
        break;
    }
  }

  if (togglePasswordBtn && passwordInput && togglePasswordIcon) {
    togglePasswordBtn.addEventListener("click", function () {
      const isPasswordHidden =
        passwordInput.getAttribute("type") === "password";

      passwordInput.setAttribute(
        "type",
        isPasswordHidden ? "text" : "password",
      );

      togglePasswordIcon.className = isPasswordHidden
        ? "bi bi-eye-slash"
        : "bi bi-eye";
    });
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", handleForgotPassword);
  }

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
  // Verification is deliberately separate from the password submit button.
  if (hrMfaCodeInput) {
    hrMfaCodeInput.addEventListener("input", function () {
      hrMfaCodeInput.value = normaliseHrMfaCode(hrMfaCodeInput.value);
      setHrMfaLoading(false);
    });

    hrMfaCodeInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        handleHrMfaVerification();
      }
    });
  }

  if (verifyHrMfaBtn) {
    verifyHrMfaBtn.addEventListener("click", handleHrMfaVerification);
  }

  if (cancelHrMfaBtn) {
    cancelHrMfaBtn.addEventListener("click", cancelHrMfaVerification);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      clearValidationStates();
      alertContainer.innerHTML = "";

      // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
      // Capture Company/Tenant ID from the login form.
      // Full Supabase tenant validation is added in the next step.
      const loginTenantCode = String(loginTenantCodeInput?.value || "")
        .trim()
        .toUpperCase();

      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;

      let isValid = true;

      // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
      // Do not block blank Tenant ID at this early stage.
      // We must first sign in and read the profile role, because Admin/System Admin
      // can log in without Tenant ID while other roles still require it later.
      if (!email) {
        emailInput.classList.add("is-invalid");
        isValid = false;
      }

      if (!password) {
        passwordInput.classList.add("is-invalid");
        isValid = false;
      }

      if (!isValid) {
        // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
        // Tenant ID is role-dependent. Admin can skip it, but username/email
        // and password are always required for Supabase authentication.
        showAlert(
          "Please enter username/email and password.",
          "warning",
        );
        return;
      }

      const submitButton = loginForm.querySelector("button[type='submit']");
      const originalButtonHtml = submitButton.innerHTML;

      submitButton.disabled = true;
      submitButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Signing In...`;

      try {
        const { data: authData, error: authError } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password,
          });

        if (authError) {
          showAlert(
            authError.message || "Invalid credentials. Please try again.",
            "danger",
          );
          return;
        }

        if (!authData || !authData.user) {
          showAlert(
            "Sign-in could not be completed. Please try again.",
            "danger",
          );
          return;
        }

        const { data: profile, error: profileError } = await supabaseClient
          .from("profiles")
          .select(
            "id, email, full_name, role, department, is_active, must_change_password",
          )
          .eq("id", authData.user.id)
          .single();

        if (profileError) {
          console.error("Profile fetch error:", profileError);
          showAlert(
            "You signed in successfully, but your profile record could not be found. Please contact support.",
            "warning",
          );
          return;
        }

        if (!profile) {
          showAlert(
            "You signed in successfully, but no profile is attached to your account.",
            "warning",
          );
          return;
        }

        if (profile.is_active === false) {
          showAlert(
            "Your account is inactive. Please contact support.",
            "danger",
          );
          await supabaseClient.auth.signOut();
          return;
        }

        // Admin is a platform-level owner. They can log in without a
        // Company/Tenant ID so they can create tenants and assign users.
        // Tenant validation remains mandatory for all other roles.
        const userRole = String(profile.role || "").trim().toLowerCase();
        const isPlatformAdmin = userRole === "admin";

        if (!isPlatformAdmin && !loginTenantCode) {
          localStorage.removeItem("hrPayrollSession");
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          loginTenantCodeInput?.classList.add("is-invalid");

          showAlert(
            "Company/Tenant ID is required for this user role.",
            "warning",
          );

          return;
        }

        // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-3
        // Email/password sign-in succeeded. Non-admin users must belong to the
        // entered Company/Tenant ID before the app creates a local session or redirects.
        let tenantValidation;

        try {
          // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
          // Platform Admin bypasses tenant validation. Other roles still use the
          // tenant validation RPC exactly as before.
          tenantValidation = isPlatformAdmin
            ? {
              isValid: true,
              tenantId: null,
              tenantCode: "",
              companyName: "Platform Admin",
              reason: "Admin tenant validation bypassed.",
            }
            : await validateTenantLoginForSignedInUser(loginTenantCode);
        } catch (tenantValidationError) {
          console.error("Tenant login validation error:", tenantValidationError);

          localStorage.removeItem("hrPayrollSession");

          // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
          // Clear any previous tenant context if tenant validation fails.
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          showAlert(
            "Tenant validation could not be completed. Please try again or contact support.",
            "danger",
          );

          return;
        }

        if (!tenantValidation.isValid) {
          localStorage.removeItem("hrPayrollSession");

          // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
          // Wrong tenant login must not leave an old tenant/company cached locally.
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          loginTenantCodeInput?.classList.add("is-invalid");

          showAlert(
            tenantValidation.reason ||
            "The entered Company/Tenant ID is not linked to this user profile.",
            "warning",
          );

          return;
        }

        // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
        // Cache tenant context only for tenant-based users.
        // Platform Admin does not belong to one tenant and should not inherit a stale
        // tenant cache from a previous login.
        let cachedTenantContext = null;

        if (isPlatformAdmin) {
          localStorage.removeItem("hrPayrollTenantContext");
        } else {
          cachedTenantContext = cacheValidatedTenantContext({
            userId: authData.user.id,
            tenantId: tenantValidation.tenantId,
            tenantCode: tenantValidation.tenantCode,
            companyName: tenantValidation.companyName,
          });
        }

        cacheRememberedLoginDetails({
          tenantCode: isPlatformAdmin
            ? ""
            : tenantValidation.tenantCode || loginTenantCode,
          email,
        });

        const loginContext = {
          authData,
          profile,
          tenantValidation,
          cachedTenantContext,
        };

        if (profile.must_change_password === true) {
          showAlert(
            "First-time setup required. Redirecting you to set a new password...",
            "warning",
          );

          setTimeout(function () {
            window.location.href = "/reset-password.html?mode=first-time";
          }, 1200);

          return;
        }

        // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
        // Do not create the local application session or redirect HR until Supabase
        // confirms the session has reached AAL2 through TOTP MFA.
        if (isHrDashboardMfaRequiredRole(profile.role)) {
          try {
            await startHrDashboardMfaFlow(loginContext);
          } catch (mfaStartError) {
            console.error("HR MFA start failed:", mfaStartError);

            await supabaseClient.auth.signOut();

            localStorage.removeItem("hrPayrollSession");
            localStorage.removeItem("hrPayrollTenantContext");

            showAlert(
              getFriendlyHrMfaErrorMessage(mfaStartError, "enroll"),
              "danger",
            );
          }

          return;
        }

        finishSuccessfulLoginRedirect(loginContext);
      } catch (unexpectedError) {
        console.error("Unexpected sign-in error:", unexpectedError);
        showAlert("An unexpected error occurred while signing in.", "danger");
      } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonHtml;
      }
    });
  }

  // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4C
  // Cache safe payroll intent once before sign-in so the user lands on Payroll
  // after authentication without first touching a protected dashboard URL.
  cachePayslipEmailLandingIntentFromUrl();

  prefillRememberedLoginDetails();
  prefillTenantCodeFromCache();

  showMessageFromQueryString();
});
