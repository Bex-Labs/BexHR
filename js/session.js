// js/session.js

(function () {
  const IDLE_WARNING_MS = 25444 * 60 * 1000; // 25 minutes
  const IDLE_TIMEOUT_MS = 30444 * 60 * 1000; // 30 minutes
  const IDLE_WARNING_REMAINING_MINUTES = 5;

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
  // Central storage keys used by login and dashboard session handling.
  // Tenant context must be cleared whenever the user logs out or the session ends.
  const APP_SESSION_STORAGE_KEY = "hrPayrollSession";
  const TENANT_CONTEXT_STORAGE_KEY = "hrPayrollTenantContext";

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Stores a safe post-login destination when an employee opens a protected
  // payroll notification link while signed out.
  const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

    let idleWarningTimer = null;
    let idleLogoutTimer = null;
    let idleWarningElement = null;
    let activityListenersAttached = false;
    let authListenerAttached = false;

  function getSupabaseClient() {
    // Single agreed global client name for the whole app
    if (!window.supabaseClient) {
      console.error("Supabase client is not available on window.supabaseClient");
      return null;
    }
    return window.supabaseClient;
  }

  async function getSession() {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("Error getting session:", error.message);
      return null;
    }

    return data?.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  /* =========================================================
     Expanded profile fetch
     ---------------------------------------------------------
     Safe expansion for manager dashboard and future stories.
     Existing pages that only need a subset will continue to work.
  ========================================================= */
  async function getProfile(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, email, full_name, role, department, is_active, must_change_password",
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching profile:", error.message);
      return null;
    }

    return data;
  }

  // PAYSLIP EMAIL DEEP LINK ROUTING - STEP 1B
  // Preserve only safe payroll landing routes before redirecting unauthenticated
  // users to login. Do not store payroll IDs, salary values, bank details,
  // employee IDs, or arbitrary URLs.
  function cacheSafePostLoginRedirect() {
    try {
      const currentPath = window.location.pathname || "";
      const currentParams = new URLSearchParams(window.location.search || "");

      const requestedSection = String(currentParams.get("section") || "")
        .trim()
        .toLowerCase();

      const requestedWorkspace = String(currentParams.get("workspace") || "")
        .trim()
        .toLowerCase();

      const isEmployeeDashboard =
        currentPath.endsWith("/employee-dashboard.html") ||
        currentPath.endsWith("employee-dashboard.html");

      const isHrDashboard =
        currentPath.endsWith("/hr-dashboard.html") ||
        currentPath.endsWith("hr-dashboard.html");

      if (isEmployeeDashboard && requestedSection === "payroll") {
        sessionStorage.setItem(
          POST_LOGIN_REDIRECT_STORAGE_KEY,
          "/employee-dashboard.html?section=payroll",
        );
        return;
      }

      if (
        isHrDashboard &&
        requestedWorkspace === "selfservice" &&
        requestedSection === "payroll"
      ) {
        sessionStorage.setItem(
          POST_LOGIN_REDIRECT_STORAGE_KEY,
          "/hr-dashboard.html?workspace=selfservice&section=payroll",
        );
      }
    } catch (error) {
      console.warn("Safe post-login redirect could not be cached:", error);
    }
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - RECOVERY PATCH
  // Clear local browser session data, including the validated tenant/company
  // context. This must exist because logoutUser calls it on logout, timeout,
  // expiry, and unauthorised redirects.
  //
  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Do not clear sessionStorage here because the safe payroll post-login
  // redirect is temporarily stored there while the user signs back in.
  function clearLocalSessionContext() {
    localStorage.removeItem(APP_SESSION_STORAGE_KEY);
    localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
  }

  async function logoutUser(reason = "logout") {
    const supabase = getSupabaseClient();

    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }

    clearLocalSessionContext();

    if (reason === "timeout") {
      window.location.href = "index.html?message=session-timeout";
      return;
    }

    if (reason === "expired") {
      window.location.href = "index.html?message=session-expired";
      return;
    }

    if (reason === "unauthorized") {
      window.location.href = "index.html?message=unauthorized";
      return;
    }

    if (reason === "hr-mfa-required") {
      window.location.href = "index.html?message=hr-mfa-required";
      return;
    }

    window.location.href = "index.html";
  }


    function removeIdleWarning() {
    if (idleWarningElement && idleWarningElement.parentNode) {
      idleWarningElement.parentNode.removeChild(idleWarningElement);
    }

    idleWarningElement = null;
  }


    function showIdleWarning() {
    removeIdleWarning();

    idleWarningElement = document.createElement("div");
    idleWarningElement.setAttribute("role", "alert");
    idleWarningElement.setAttribute("aria-live", "assertive");

    idleWarningElement.style.position = "fixed";
    idleWarningElement.style.right = "24px";
    idleWarningElement.style.bottom = "24px";
    idleWarningElement.style.zIndex = "99999";
    idleWarningElement.style.maxWidth = "420px";
    idleWarningElement.style.padding = "18px";
    idleWarningElement.style.borderRadius = "12px";
    idleWarningElement.style.background = "#ffffff";
    idleWarningElement.style.boxShadow = "0 18px 45px rgba(15, 23, 42, 0.22)";
    idleWarningElement.style.border = "1px solid rgba(15, 23, 42, 0.12)";
    idleWarningElement.style.fontFamily = "Arial, sans-serif";
    idleWarningElement.style.color = "#172033";

    idleWarningElement.innerHTML = `
    <div style="font-weight:700;font-size:16px;margin-bottom:8px;">
      Session timeout warning
    </div>
    <div style="font-size:14px;line-height:1.5;margin-bottom:14px;">
      You have been inactive for a while. You will be signed out in
      ${IDLE_WARNING_REMAINING_MINUTES} minutes unless you continue working.
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button type="button" data-session-action="logout" style="border:1px solid #cbd5e1;background:#ffffff;color:#334155;border-radius:8px;padding:8px 12px;cursor:pointer;">
        Sign out now
      </button>
      <button type="button" data-session-action="continue" style="border:0;background:#0f766e;color:#ffffff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;">
        Stay signed in
      </button>
    </div>
  `;

    document.body.appendChild(idleWarningElement);

    const continueButton = idleWarningElement.querySelector(
      '[data-session-action="continue"]',
    );

    const logoutButton = idleWarningElement.querySelector(
      '[data-session-action="logout"]',
    );

    if (continueButton) {
      continueButton.addEventListener("click", () => {
        resetIdleTimer();
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        await logoutUser("timeout");
      });
    }
  }

    function clearIdleTimer() {
    if (idleWarningTimer) {
      clearTimeout(idleWarningTimer);
      idleWarningTimer = null;
    }

    if (idleLogoutTimer) {
      clearTimeout(idleLogoutTimer);
      idleLogoutTimer = null;
    }

    removeIdleWarning();
  }

    function resetIdleTimer() {
    clearIdleTimer();

    idleWarningTimer = setTimeout(() => {
      showIdleWarning();
    }, IDLE_WARNING_MS);

    idleLogoutTimer = setTimeout(async () => {
      removeIdleWarning();
      await logoutUser("timeout");
    }, IDLE_TIMEOUT_MS);
  }

  function attachActivityListeners() {
    if (activityListenersAttached) return;

    const events = [
      "mousemove",
      "mousedown",
      "click",
      "scroll",
      "keypress",
      "touchstart",
    ];

    events.forEach((eventName) => {
      document.addEventListener(eventName, resetIdleTimer, true);
    });

    activityListenersAttached = true;
  }

  function startIdleTimeout() {
    attachActivityListeners();
    resetIdleTimer();
  }

  function stopIdleTimeout() {
    clearIdleTimer();
  }

  /* =========================================================
     Central role redirect
  ========================================================= */
  function redirectToRoleDashboard(role) {
    // PAYSLIP EMAIL DEEP LINK ROUTING - STEP 1B
    // If an HR user is already signed in and clicks the protected employee
    // payslip link, route them to their own HR Self-Service payroll view.
    // This keeps HR away from the Employee Dashboard while preserving the
    // payroll landing intent from the email.
    try {
      const currentPath = window.location.pathname || "";
      const currentParams = new URLSearchParams(window.location.search || "");
      const requestedSection = String(currentParams.get("section") || "")
        .trim()
        .toLowerCase();

      const isEmployeePayrollDeepLink =
        (
          currentPath.endsWith("/employee-dashboard.html") ||
          currentPath.endsWith("employee-dashboard.html")
        ) &&
        requestedSection === "payroll";

      if (String(role || "").trim().toLowerCase() === "hr" && isEmployeePayrollDeepLink) {
        window.location.href = "hr-dashboard.html?workspace=selfservice&section=payroll";
        return;
      }
    } catch (error) {
      console.warn("Role redirect payroll deep link could not be resolved:", error);
    }

    switch (role) {
      case "admin":
        window.location.href = "admin-dashboard.html";
        break;
      case "employee":
        window.location.href = "employee-dashboard.html";
        break;
      case "manager":
        window.location.href = "manager-dashboard.html";
        break;
      case "hr":
        window.location.href = "hr-dashboard.html";
        break;
      default:
        window.location.href = "index.html?message=no-role-dashboard";
        break;
    }
  }

  async function requireAuth() {
    const session = await getSession();

    if (!session) {
      // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
      // If the employee opened a safe payroll notification link while signed out,
      // preserve the payroll section destination before redirecting to login.
      cacheSafePostLoginRedirect();

      await logoutUser("expired");
      return null;
    }

    return session;
  }

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
  // HR Dashboard requires Supabase Auth AAL2. This prevents a user from
  // bypassing the login MFA screen by manually opening hr-dashboard.html
  // after only password authentication.
  async function hasRequiredHrMfaAssurance(profile = {}) {
    const role = String(profile.role || "").trim().toLowerCase();

    if (role !== "hr") {
      return true;
    }

    const supabase = getSupabaseClient();

    if (!supabase?.auth?.mfa?.getAuthenticatorAssuranceLevel) {
      console.error("Supabase MFA assurance check is not available.");
      return false;
    }

    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (error) {
      console.error("Error checking HR MFA assurance level:", error.message);
      return false;
    }

    return data?.currentLevel === "aal2";
  }

  /* =========================================================
     Flexible role matching
     ---------------------------------------------------------
     Supports a single role string or an array of roles.
  ========================================================= */
  function roleMatches(expectedRole, actualRole) {
    if (!expectedRole) return true;

    if (Array.isArray(expectedRole)) {
      return expectedRole.includes(actualRole);
    }

    return actualRole === expectedRole;
  }

  async function requireRole(expectedRole) {
    const session = await requireAuth();
    if (!session) return null;

    const profile = await getProfile(session.user.id);

    if (!profile) {
      await logoutUser("unauthorized");
      return null;
    }

    // Optional first-time password enforcement
    if (profile.must_change_password === true) {
      if (!window.location.pathname.endsWith("reset-password.html")) {
        window.location.href = "reset-password.html";
        return null;
      }
    }

    if (!roleMatches(expectedRole, profile.role)) {
      redirectToRoleDashboard(profile.role);
      return null;
    }

    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2A
    // Role match alone is not enough for HR. HR must have an AAL2 session.
    // If the user only has password-level authentication, sign them out and
    // return them to login so the MFA flow can run properly.
    if (!(await hasRequiredHrMfaAssurance(profile))) {
      await logoutUser("hr-mfa-required");
      return null;
    }

    return { session, profile };
  }

  async function protectPage(expectedRole = null) {
    const result = await requireRole(expectedRole);
    if (!result) return null;

    startIdleTimeout();
    attachAuthStateListener();

    return result;
  }

  function attachAuthStateListener() {
    if (authListenerAttached) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        stopIdleTimeout();
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        resetIdleTimer();
      }
    });

    authListenerAttached = true;
  }

  window.SessionManager = {
    getSession,
    getUser,
    getProfile,
    requireAuth,
    requireRole,
    protectPage,
    startIdleTimeout,
    stopIdleTimeout,
    resetIdleTimer,
    logoutUser,
    redirectToRoleDashboard,
  };
})();