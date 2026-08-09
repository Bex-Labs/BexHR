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
        "id, email, full_name, role, hr_access_level, department, is_active, must_change_password",
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

  // MULTI-WORKSPACE ACCESS - HR / MANAGER DECOUPLING - v1.0.1
  // System access and reporting-line responsibility are independent.
  // An HR user with an active Primary or Secondary Manager assignment may
  // enter the Manager workspace without changing their HR system role.
  async function hasManagerWorkspaceAccess(profile = {}) {
    const role = String(profile.role || "").trim().toLowerCase();

    if (role === "manager") return true;
    if (role !== "hr") return false;

    const supabase = getSupabaseClient();
    if (!supabase) return false;

    const { data, error } = await supabase.rpc(
      "get_manager_reporting_line_assignments",
    );

    if (error) {
      console.warn(
        "Manager workspace availability could not be resolved:",
        error.message || error,
      );
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  }

  function getCurrentWorkspaceKey() {
    const path = String(window.location.pathname || "").toLowerCase();
    const params = new URLSearchParams(window.location.search || "");

    if (path.endsWith("manager-dashboard.html")) return "manager";
    if (
      path.endsWith("hr-dashboard.html") &&
      String(params.get("workspace") || "").toLowerCase() === "selfservice"
    ) {
      return "selfservice";
    }
    if (path.endsWith("hr-dashboard.html")) return "hr";
    if (path.endsWith("employee-dashboard.html")) return "selfservice";
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

    const role = String(profile.role || "").trim().toLowerCase();
    const managerAvailable = await hasManagerWorkspaceAccess(profile);
    const options = [];

    if (role === "hr") {
      const normalizedHrAccessLevel = String(profile.hr_access_level || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");

      const accessLabel = new Set([
        "admin",
        "hr_admin",
        "tenant_admin",
        "company_admin",
      ]).has(normalizedHrAccessLevel)
        ? "HR Administration"
        : "HR Workspace";

      options.push({
        key: "hr",
        label: accessLabel,
        description: "People, HR review, payroll, and organisation setup.",
        icon: "bi bi-people",
        href: "hr-dashboard.html",
      });
    }

    if (managerAvailable) {
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

    startIdleTimeout();
    attachAuthStateListener();

    try {
      await initialiseWorkspaceSwitcher(result.profile);
    } catch (error) {
      console.warn("Workspace switcher could not be initialised:", error);
    }

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
    hasManagerWorkspaceAccess,
    initialiseWorkspaceSwitcher,
  };
})();