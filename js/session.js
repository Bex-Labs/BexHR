// js/session.js

(function () {
  const IDLE_WARNING_MS = 25 * 60 * 1000; // 25 minutes
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
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

  // BEXHR AUTH TOKEN RECOVERY
  // One refresh request at a time prevents concurrent browser reads from
  // trying to rotate the same refresh token independently.
  let sessionRefreshPromise = null;
  let sessionRecoveryListenersAttached = false;

  const SESSION_REFRESH_LEEWAY_MS =
    60 * 1000;

  function getSupabaseClient() {
    // Single agreed global client name for the whole app
    if (!window.supabaseClient) {
      console.error("Supabase client is not available on window.supabaseClient");
      return null;
    }
    return window.supabaseClient;
  }

  function isSessionNearExpiry(
    session = null,
    leewayMs = SESSION_REFRESH_LEEWAY_MS,
  ) {
    const expiresAt =
      Number(session?.expires_at || 0) * 1000;

    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return false;
    }

    return expiresAt - Date.now() <= leewayMs;
  }

  async function refreshAuthSessionSingleFlight() {
    if (sessionRefreshPromise) {
      return sessionRefreshPromise;
    }

    const supabase = getSupabaseClient();

    if (!supabase?.auth?.refreshSession) {
      return null;
    }

    sessionRefreshPromise = (async () => {
      try {
        const { data, error } =
          await supabase.auth.refreshSession();

        if (error) {
          console.warn(
            "BexHR session refresh failed:",
            error.message || error,
          );
          return null;
        }

        return data?.session || null;
      } catch (error) {
        console.warn(
          "BexHR session refresh failed:",
          error,
        );
        return null;
      }
    })();

    try {
      return await sessionRefreshPromise;
    } finally {
      sessionRefreshPromise = null;
    }
  }

  async function getSession() {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } =
      await supabase.auth.getSession();

    let session =
      data?.session || null;

    if (error) {
      console.warn(
        "Session read failed; attempting token recovery:",
        error.message || error,
      );

      return await refreshAuthSessionSingleFlight();
    }

    if (!session) {
      return null;
    }

    if (!isSessionNearExpiry(session)) {
      return session;
    }

    const refreshed =
      await refreshAuthSessionSingleFlight();

    if (refreshed) {
      return refreshed;
    }

    const expiresAt =
      Number(session.expires_at || 0) * 1000;

    return expiresAt > Date.now()
      ? session
      : null;
  }

  function isJwtExpiredAuthError(error = null) {
    const message = String(
      error?.message ||
      error?.error_description ||
      error ||
      "",
    )
      .trim()
      .toLowerCase();

    return (
      message.includes("jwt expired") ||
      message.includes("jwt has expired")
    );
  }

  // READ-ONLY recovery helper.
  // The operation may run twice only when its first result explicitly reports
  // an expired JWT. Never use this helper for mutations.
  async function runWithFreshSessionRead(operation) {
    if (typeof operation !== "function") {
      throw new TypeError(
        "runWithFreshSessionRead requires a read operation.",
      );
    }

    await getSession();

    let result;

    try {
      result = await operation();
    } catch (error) {
      if (!isJwtExpiredAuthError(error)) {
        throw error;
      }

      const refreshed =
        await refreshAuthSessionSingleFlight();

      if (!refreshed) {
        throw error;
      }

      return await operation();
    }

    if (!isJwtExpiredAuthError(result?.error)) {
      return result;
    }

    const refreshed =
      await refreshAuthSessionSingleFlight();

    if (!refreshed) {
      return result;
    }

    return await operation();
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
  // BEXHR AUTH READ SAFETY - PHASE 7B SUPPORT
  // A failed network/RLS/API read is not evidence that an active employee was
  // offboarded. Only a successful inactive profile or a definitive no-row
  // response may revoke the local session as unauthorized. All unknown reads
  // fail closed (no dashboard authorisation) but preserve the login for retry.
  async function readProfileStatus(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return { status: "unavailable", profile: null };

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, role, hr_access_level, tenant_id, department, is_active, must_change_password",
        )
        .eq("id", userId)
        .single();

      if (error) {
        // .single() returns PGRST116 for a missing/inaccessible profile.
        // The id lookup is unique, so multiple-row ambiguity cannot occur.
        if (String(error.code || "").toUpperCase() === "PGRST116") {
          return { status: "missing", profile: null };
        }

        console.warn(
          "BexHR profile check temporarily unavailable:",
          error.message || error,
        );
        return { status: "unavailable", profile: null };
      }

      return data
        ? { status: "found", profile: data }
        : { status: "missing", profile: null };
    } catch (error) {
      console.warn("BexHR profile check temporarily unavailable:", error);
      return { status: "unavailable", profile: null };
    }
  }

  async function getProfile(userId) {
    const result = await readProfileStatus(userId);
    return result.profile;
  }

  function showProfileVerificationRetry() {
    if (typeof document === "undefined" || !document.body) return;
    if (document.getElementById("bexhr-profile-verification-retry")) return;

    const notice = document.createElement("div");
    notice.id = "bexhr-profile-verification-retry";
    notice.setAttribute("role", "alert");
    notice.style.cssText =
      "position:fixed;z-index:100000;top:16px;left:50%;transform:translateX(-50%);" +
      "max-width:min(560px,92vw);padding:14px 18px;border:1px solid #e5b661;" +
      "border-radius:10px;background:#fff7e6;color:#573e15;" +
      "box-shadow:0 8px 25px #0002;font:14px/1.5 Arial,sans-serif";
    notice.textContent =
      "BexHR could not verify your access because the connection failed. " +
      "You have not been signed out. Check your connection and refresh this page.";
    document.body.appendChild(notice);
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

  // BEXHR TRUSTED HR SESSION TIMEOUT - v1.0.0
  // A normal HR inactivity timeout locks the BexHR workspace but preserves the
  // real AAL2 Supabase session on this browser. Explicit sign-out, true auth
  // expiry, unauthorised access, or MFA failure still revoke the current
  // browser session. No local flag can grant access on its own.
  function getCurrentApplicationRole() {
    try {
      const storedSession = JSON.parse(
        localStorage.getItem(APP_SESSION_STORAGE_KEY) || "null",
      );

      return String(storedSession?.role || "")
        .trim()
        .toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function shouldPreserveTrustedHrSession(reason = "") {
    return (
      reason === "timeout" &&
      getCurrentApplicationRole() === "hr"
    );
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - RECOVERY PATCH
  // App-session UI state is always cleared. The previously validated tenant
  // context is retained only for a trusted HR inactivity lock so the same
  // AAL2 browser session can be safely restored.
  function clearLocalSessionContext({
    preserveTenantContext = false,
  } = {}) {
    localStorage.removeItem(APP_SESSION_STORAGE_KEY);

    if (!preserveTenantContext) {
      localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
    }
  }

  async function logoutUser(reason = "logout") {
    const supabase = getSupabaseClient();
    const preserveTrustedHrSession =
      shouldPreserveTrustedHrSession(reason);

    if (preserveTrustedHrSession) {
      clearLocalSessionContext({
        preserveTenantContext: true,
      });
    } else {
      try {
        if (supabase) {
          await supabase.auth.signOut({ scope: "local" });
        }
      } catch (error) {
        console.error("Error during logout:", error);
      }

      clearLocalSessionContext();
    }

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
      You have been inactive for a while. Your workspace will lock in
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
        await logoutUser("logout");
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

  // PHASE 7B: HR and Manager access stay distinct from organisation rank.
  // The new server RPC checks authenticated tenant/profile identity and either
  // assigned reporting lines or a uniquely configured whole-company position.
  // Until that RPC is deployed, fall back ONLY to the pre-existing protected
  // reporting-line read. An explicit server denial is authoritative.
  async function hasManagerWorkspaceAccess(profile = {}) {
    const role = String(profile.role || "").trim().toLowerCase();
    if (role === "manager") return true;
    if (role !== "hr") return false;

    const supabase = getSupabaseClient();
    if (!supabase) return false;

    // P7B INTEGRATION GATE: fallback is permitted ONLY when the position-aware
    // RPC has not been deployed (PostgREST PGRST202 / PostgreSQL 42883).
    // Errors, timeouts, malformed responses or an explicit false must deny.
    let legacyRpcNotInstalled = false;
    try {
      const { data, error } = await supabase.rpc("bexhr_p7b_workspace_access");
      if (!error) {
        if (!data || !(typeof data.can_enter_manager === "boolean")) return false;
        return data.can_enter_manager === true;
      }
      const code = String(error?.code || "").trim().toUpperCase();
      if (code !== "PGRST202" && code !== "42883") {
        console.warn("Position-aware workspace verification failed:", error);
        return false;
      }
      legacyRpcNotInstalled = true;
    } catch (error) {
      console.warn("Position-aware workspace verification unavailable:", error);
      return false;
    }

    if (!legacyRpcNotInstalled) return false;

    // Compatibility only before the new RPC exists. Once it exists, a server
    // error or denial must never be bypassed by an older reporting-line read.
    try {
      const { data, error } = await supabase.rpc(
        "get_manager_reporting_line_assignments",
      );
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    } catch (error) {
      console.warn("Manager workspace availability could not be resolved:", error);
      return false;
    }
  }

// BEXHR H10 — WHOLE-ORGANISATION DUAL WORKSPACE
// The H8 position RPC is the only authority for whole-company eligibility.
// Before that RPC exists, retain the historical assigned-team switcher so
// H10 does not regress the already working UI while H11 is still pending.
// Transient RPC failures or explicit denials NEVER activate legacy fallback.
async function readWholeOrganizationDualWorkspaceStatus(profile = {}) {
  const role = String(profile.role || "").trim().toLowerCase();
  const hrAccess = String(profile.hr_access_level || "")
    .trim().toLowerCase().replace(/[\s-]+/g, "_");

  // Keep legacy HR access unmodified until the H8 RPC is installed.
  // Once installed, only explicit HR Standard can use the new dual mode.
  if (role !== "hr" ||
      profile.is_active !== true || !profile.id || !profile.tenant_id) {
    return { mode: "denied", eligible: false };
  }

  const supabase = getSupabaseClient();
  if (!supabase || typeof supabase.rpc !== "function") {
    return { mode: "denied", eligible: false };
  }

  try {
    const { data, error } = await supabase.rpc("bexhr_p7b_workspace_access");
    if (error) {
      const code = String(error.code || "").trim().toUpperCase();
      if (code === "PGRST202" || code === "42883") {
        return { mode: "not_installed", eligible: false };
      }
      return { mode: "denied", eligible: false };
    }
    if (!data || typeof data.can_enter_manager !== "boolean" ||
        typeof data.preferred_workspace !== "string") {
      return { mode: "denied", eligible: false };
    }
    return {
      mode: "authoritative",
      eligible: (hrAccess === "standard" || hrAccess === "tenant_admin") && data.can_enter_manager === true &&
        data.preferred_workspace === "manager",
    };
  } catch (error) {
    console.warn("Whole-organisation workspace eligibility unavailable:", error);
    return { mode: "denied", eligible: false };
  }
}

function getCurrentWorkspaceKey() {
  const path = String(window.location.pathname || "")
    .toLowerCase()
    .replace(/\/+$/, "");

  const params = new URLSearchParams(window.location.search || "");

  // WORKSPACE SWITCHER CLEAN-URL PARITY - TICKET 4 v1.0.0
  // Production uses extensionless routes such as /manager-dashboard,
  // while local development may use /manager-dashboard.html.
  // Recognise both forms without changing workspace navigation,
  // authentication, role, tenant, or reporting-line behaviour.
  const isManagerDashboard =
    path.endsWith("/manager-dashboard") ||
    path.endsWith("/manager-dashboard.html");

  const isHrDashboard =
    path.endsWith("/hr-dashboard") ||
    path.endsWith("/hr-dashboard.html");

  const isEmployeeDashboard =
    path.endsWith("/employee-dashboard") ||
    path.endsWith("/employee-dashboard.html");

  if (isManagerDashboard) return "manager";

  if (
    isHrDashboard &&
    String(params.get("workspace") || "").toLowerCase() === "selfservice"
  ) {
    return "selfservice";
  }

  if (isHrDashboard) return "hr";

  if (isEmployeeDashboard) return "selfservice";

  return "";
}

  function closeWorkspaceSwitcher() {
    document
      .querySelectorAll("[data-bexhr-workspace-menu]")
      .forEach((menu) => {
        menu.hidden = true;
      });

    document
      .querySelectorAll("[data-bexhr-workspace-trigger]")
      .forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  }

  function buildWorkspaceMenuOption(option, currentWorkspace) {
    const isCurrent = option.key === currentWorkspace;
    const activeClass = isCurrent ? " is-current" : "";
    const currentText = isCurrent
      ? '<span class="bexhr-workspace-menu-current">Current</span>'
      : "";

    return `
      <a class="bexhr-workspace-menu-option${activeClass}"
        href="${option.href}"
        ${isCurrent ? 'aria-current="page"' : ""}>
        <span class="bexhr-workspace-menu-option-icon">
          <i class="${option.icon}" aria-hidden="true"></i>
        </span>
        <span class="bexhr-workspace-menu-option-copy">
          <strong>${option.label}</strong>
          <small>${option.description}</small>
        </span>
        ${currentText}
      </a>
    `;
  }

  // LIVE WORKSPACE SWITCHER ELIGIBILITY REFRESH - v1.0.0
  // This function may run at startup and again after reporting assignments
  // change. Existing menu markup is rebuilt without duplicating event handlers.
  async function initialiseWorkspaceSwitcher(profile = {}) {
    const trigger =
      document.querySelector(".hr-modern-account-button") ||
      document.querySelector(".manager-modern-account-button");

    if (!trigger) return;

    const accountArea = trigger.parentElement;
    if (!accountArea) return;

    // WORKSPACE SWITCHER PROFILE ACTION RESTORE - v1.0.0
    // Preserve the account button's normal Profile action before temporarily
    // converting it into a multi-workspace switcher trigger.
    const currentOnclick = String(
      trigger.getAttribute("onclick") || "",
    ).trim();

    if (
      currentOnclick &&
      !trigger.dataset.workspaceSwitcherOriginalOnclick
    ) {
      trigger.dataset.workspaceSwitcherOriginalOnclick = currentOnclick;
    }

    // The current HR page may already have had its inline action removed by an
    // earlier switcher build. Keep the established HR Profile action recoverable.
    if (
      trigger.classList.contains("hr-modern-account-button") &&
      !trigger.dataset.workspaceSwitcherOriginalOnclick
    ) {
      trigger.dataset.workspaceSwitcherOriginalOnclick =
        "document.getElementById('hrTabProfileBtn')?.click()";
    }

    const dualStatus = await readWholeOrganizationDualWorkspaceStatus(profile);
    // Preserve the pre-H8 assigned-team switcher only when the RPC does not
    // exist. It is not evidence of company-wide position authority.
    const legacyMode = dualStatus.mode === "not_installed";
    const dualWorkspaceAvailable = dualStatus.eligible ||
      (legacyMode && await hasManagerWorkspaceAccess(profile));
    const options = [];

    if (dualWorkspaceAvailable) {
      options.push({
        key: "hr",
        label: (legacyMode || String(profile.hr_access_level || "").toLowerCase() === "tenant_admin") ? "HR Workspace" : "HR Standard Workspace",
        description: "Authorised people management and HR responsibilities.",
        icon: "bi bi-people",
        // Explicit intent prevents manager-default redirect after H8 activates.
        href: legacyMode ? "hr-dashboard.html" : "hr-dashboard.html?workspace=hr",
      });
    }

    if (dualWorkspaceAvailable) {
      options.push({
        key: "manager",
        label: "Manager Workspace",
        description: "Assigned employees, leave decisions, and team coverage.",
        icon: "bi bi-diagram-3",
        href: "manager-dashboard.html",
      });
    }

    accountArea
      .querySelectorAll("[data-bexhr-workspace-menu]")
      .forEach((existingMenu) => existingMenu.remove());

    closeWorkspaceSwitcher();

    if (options.length < 2) {
      accountArea.classList.remove("bexhr-workspace-account-area");

      delete trigger.dataset.workspaceSwitcherReady;
      delete trigger.dataset.bexhrWorkspaceTrigger;

      trigger.removeAttribute("aria-haspopup");
      trigger.removeAttribute("aria-expanded");

      const originalOnclick = String(
        trigger.dataset.workspaceSwitcherOriginalOnclick || "",
      ).trim();

      if (originalOnclick) {
        trigger.setAttribute("onclick", originalOnclick);
      }

      trigger.setAttribute(
        "aria-label",
        trigger.classList.contains("hr-modern-account-button")
          ? "Open my profile"
          : "Open my profile",
      );

      return;
    }

    accountArea.classList.add("bexhr-workspace-account-area");

    trigger.removeAttribute("onclick");
    trigger.dataset.workspaceSwitcherReady = "true";
    trigger.dataset.bexhrWorkspaceTrigger = "true";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Open workspace switcher");

    const menu = document.createElement("div");
    menu.className = "bexhr-workspace-menu";
    menu.dataset.bexhrWorkspaceMenu = "true";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    const currentWorkspace = getCurrentWorkspaceKey();

    menu.innerHTML = `
      <div class="bexhr-workspace-menu-heading">
        <span>Switch workspace</span>
        <small>Your access and reporting responsibilities stay unchanged.</small>
      </div>
      <div class="bexhr-workspace-menu-options">
        ${options
          .map((option) => buildWorkspaceMenuOption(option, currentWorkspace))
          .join("")}
      </div>
    `;

    accountArea.appendChild(menu);

    menu.addEventListener("click", (event) => event.stopPropagation());

    if (trigger.dataset.workspaceSwitcherBound !== "true") {
      trigger.dataset.workspaceSwitcherBound = "true";

      trigger.addEventListener("click", (event) => {
        if (trigger.dataset.workspaceSwitcherReady !== "true") {
          return;
        }

        const currentMenu = trigger.parentElement?.querySelector(
          "[data-bexhr-workspace-menu]",
        );

        if (!currentMenu) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const willOpen = currentMenu.hidden;

        closeWorkspaceSwitcher();

        currentMenu.hidden = !willOpen;
        trigger.setAttribute("aria-expanded", String(willOpen));
      });
    }

    if (
      document.documentElement.dataset.workspaceSwitcherEventsBound !== "true"
    ) {
      document.documentElement.dataset.workspaceSwitcherEventsBound = "true";

      document.addEventListener("click", closeWorkspaceSwitcher);

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        closeWorkspaceSwitcher();

        const activeTrigger = document.querySelector(
          "[data-bexhr-workspace-trigger]",
        );

        activeTrigger?.focus();
      });
    }
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

    const profileRead = await readProfileStatus(session.user.id);
    if (profileRead.status === "unavailable") {
      // Deny page initialisation, but do not destroy a valid Auth session
      // because Supabase/PostgREST could not be reached this time.
      showProfileVerificationRetry();
      return null;
    }
    const profile = profileRead.profile;

    if (!profile) {
      await logoutUser("unauthorized");
      return null;
    }

    // PHASE 7A12: a valid Auth JWT is not permission to keep using BexHR.
    // Offboarding sets profiles.is_active=false; reject an already-open session
    // before routing to any HR/Manager/Employee workspace.
    if (profile.is_active !== true) {
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

    let hasExpectedAccess = roleMatches(expectedRole, profile.role);

    if (
      !hasExpectedAccess &&
      expectedRole === "manager" &&
      String(profile.role || "").trim().toLowerCase() === "hr"
    ) {
      hasExpectedAccess = await hasManagerWorkspaceAccess(profile);
    }

    if (!hasExpectedAccess) {
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

    // H10: an eligible whole-organisation HR Standard lands in Manager by
    // default. Intentional HR choices (?workspace=hr) and all deep links are
    // respected. Before H8 RPC activation, routing remains unchanged.
    const currentPath = String(window.location.pathname || "").toLowerCase();
    const isHrLanding = currentPath.endsWith("/hr-dashboard") ||
      currentPath.endsWith("/hr-dashboard.html");
    if (expectedRole === "hr" && isHrLanding && String(result.profile.hr_access_level || "").toLowerCase() !== "tenant_admin" &&
        !String(window.location.search || "").trim() &&
        (await readWholeOrganizationDualWorkspaceStatus(result.profile)).eligible) {
      window.location.href = "manager-dashboard.html";
      return null;
    }

    startIdleTimeout();
    attachAuthStateListener();
    attachActiveProfileLifecycleChecks();

    try {
      await initialiseWorkspaceSwitcher(result.profile);
    } catch (error) {
      console.warn("Workspace switcher could not be initialised:", error);
    }

    return result;
  }

  // PHASE 7A12: periodically revalidate the authoritative profiles row.
  // Local Auth signOut cannot instantaneously revoke already-issued JWTs;
  // the database's active-account RLS remains the server-side enforcement.
  let activeProfileLifecycleCheckPromise = null;
  let activeProfileLifecycleTimerId = null;
  let activeProfileLifecycleListenersAttached = false;

  async function revalidateActiveProfile() {
    if (activeProfileLifecycleCheckPromise) return activeProfileLifecycleCheckPromise;
    activeProfileLifecycleCheckPromise = (async () => {
      const session = await getSession();
      if (!session?.user?.id) {
        await logoutUser("expired");
        return false;
      }
      const profileRead = await readProfileStatus(session.user.id);
      if (profileRead.status === "unavailable") {
        // Protect server-side access through RLS; retry on the next check.
        // A temporary API/network failure must never become a false logout.
        return false;
      }
      const profile = profileRead.profile;
      if (!profile || profile.is_active !== true) {
        await logoutUser("unauthorized");
        return false;
      }
      return true;
    })();
    try {
      return await activeProfileLifecycleCheckPromise;
    } finally {
      activeProfileLifecycleCheckPromise = null;
    }
  }

  function stopActiveProfileLifecycleChecks() {
    if (activeProfileLifecycleTimerId !== null) {
      window.clearInterval(activeProfileLifecycleTimerId);
      activeProfileLifecycleTimerId = null;
    }
  }

  function attachActiveProfileLifecycleChecks() {
    if (!activeProfileLifecycleListenersAttached) {
      const checkWhenVisible = () => {
        if (!document.hidden) void revalidateActiveProfile().catch((error) => {
          console.warn("Active profile check failed:", error);
        });
      };
      window.addEventListener("focus", checkWhenVisible);
      document.addEventListener("visibilitychange", checkWhenVisible);
      window.addEventListener("storage", (event) => {
        if (event.key === "bexhrEmployeeLifecycleSync") checkWhenVisible();
      });
      activeProfileLifecycleListenersAttached = true;
    }
    if (activeProfileLifecycleTimerId === null) {
      activeProfileLifecycleTimerId = window.setInterval(() => {
        if (!document.hidden) void revalidateActiveProfile().catch((error) => {
          console.warn("Active profile periodic check failed:", error);
        });
      }, 20000);
    }
  }

  function attachSessionRecoveryListeners() {
    if (sessionRecoveryListenersAttached) {
      return;
    }

    const recover = () => {
      if (
        typeof document !== "undefined" &&
        document.hidden
      ) {
        return;
      }

      Promise.resolve(
        getSession(),
      ).catch((error) => {
        console.warn(
          "Foreground session recovery failed:",
          error,
        );
      });
    };

    document.addEventListener(
      "visibilitychange",
      recover,
    );

    window.addEventListener(
      "focus",
      recover,
    );

    window.addEventListener(
      "online",
      recover,
    );

    sessionRecoveryListenersAttached = true;
  }

  function attachAuthStateListener() {
    attachSessionRecoveryListeners();

    if (authListenerAttached) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        stopIdleTimeout();
        stopActiveProfileLifecycleChecks();
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        resetIdleTimer();
      }
    });

    authListenerAttached = true;
  }

  window.SessionManager = {
    getSession,
    runWithFreshSessionRead,
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
    hasManagerWorkspaceAccess,
    initialiseWorkspaceSwitcher,
    revalidateActiveProfile,
  };
})();