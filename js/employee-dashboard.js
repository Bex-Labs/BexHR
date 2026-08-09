// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the previous scroll position on long Leave/Payroll pages.
// Keep restoration manual so refresh always lands at the top of the restored workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Employee dashboard scroll restoration could not be set to manual.", error);
}
/* =========================================================
   employee-dashboard.js
========================================================= */

const PROFILE_IMAGES_BUCKET = "profile-images";
const PAYROLL_MODEL_GENERIC = "GENERIC";
const PAYROLL_MODEL_REGULAR = "REGULAR";

// EMPLOYEE PAYROLL PRIVACY - STEP 1H
// Browser-local preference for hiding payroll figures like a banking app.
const EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY = "employeePayrollFiguresHidden";
// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// These leave types are treated as single-application leave types
// in Employee Self Service. Do not apply this to Annual, Sick,
// Compassionate, or other repeatable entitlement/event leave types.
const SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS = [
  "maternity",
  "paternity",
  "adoption",
];

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Employee workspace tab for refresh recovery.
// No payroll, payslip, leave request, salary, or employee data is stored.
const EMPLOYEE_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastEmployeeWorkspace";

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by employee-dashboard.html to avoid first-paint
// Profile flash before employee-dashboard.js completes authentication startup.
const EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastEmployeeWorkspace:last";

// EMPLOYEE WORKSPACE LOADER PARITY - STEP 1
// Reveal the authenticated Employee shell as soon as tenant branding,
// account identity, and the intended top-level workspace are ready.
// Slower profile, request, image, leave, and payroll reads continue
// progressively after the shell becomes visible.
function releaseEmployeeWorkspaceLoader() {
  const body = document.body;
  const loader = document.getElementById("bexhrWorkspaceLoader");
  const firstPaintGate = document.getElementById(
    "employeeWorkspaceFirstPaintGate",
  );

  body?.classList.remove("employee-workspace-booting");
  body?.removeAttribute("aria-busy");
  firstPaintGate?.remove();

  if (!loader) return;

  loader.setAttribute("aria-hidden", "true");
  loader.style.pointerEvents = "none";

  window.setTimeout(() => {
    loader.remove();
  }, 220);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindNavigationEvents();
    bindLeaveFormEvents();
    bindUtilityEvents();
    bindPayrollFilterEvents();

    // EMPLOYEE PAYROLL PRIVACY - STEP 1H
    // Restore the employee's browser-local hide/show preference before
    // Current Payslip Summary values are rendered.
    restoreEmployeePayrollFigureVisibility();

    // EMPLOYEE UI CLEANUP - STEP 1B
    // Bind Payroll History collapse only. Profile, Leave, and Current Payslip
    // Summary are deliberately not part of this step.
    bindEmployeePayrollHistoryCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1L-C
    // Bind Leave Balances collapse separately from Payroll History.
    bindEmployeeLeaveBalancesCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1N
    // Bind Latest Leave Decision collapse separately from Leave Balances.
    bindEmployeeLatestDecisionCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1O-C
    // Bind optional My Leave History collapse after the history cards
    // have been cleaned up.
    bindEmployeeLeaveHistoryCardEvents();

    bindProfileImageEvents();

    // EMPLOYEE PROFILE REVIEW - STEP 1B
    // Keep the HR profile review compact by switching between read-only tabs.
    bindEmployeeProfileReviewTabs();

    // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
    // Bind the formal employee correction request flow.
    // This saves requests to Supabase and does not edit HR master data.
    bindEmployeeProfileCorrectionRequestEvents();

    bindSyncEvents();

    const authResult = await window.SessionManager.protectPage("employee");
    if (!authResult) return;

    state.currentUser = authResult.session.user;
    state.currentProfile = authResult.profile;

    await loadLatestEmployeeProfile();

    // ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
    // Apply final tenant-scoped Employee Dashboard branding after the signed-in
    // employee profile has loaded. Non-Alpatech tenants are reset to BexHR.
    applyEmployeeTenantWorkspaceShellBranding();

    if (state.dom.employeeDisplayEmail) {
      state.dom.employeeDisplayEmail.textContent =
        state.currentProfile?.email ||
        authResult.profile?.email ||
        authResult.session.user.email ||
        "No email";
    }

    if (state.dom.heroRoleValue) {
      state.dom.heroRoleValue.textContent = String(
        state.currentProfile?.role || authResult.profile?.role || "employee",
      ).toLowerCase();
    }

    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Restore the intended workspace before long leave/payroll data loading starts.
    // Safe URL links such as ?section=payroll still take priority inside
    // showInitialEmployeeDashboardSection().
    showInitialEmployeeDashboardSection();

    // EMPLOYEE WORKSPACE LOADER REGRESSION FIX - v1.0.0
    // Keep the workspace loader visible while the authenticated employee's
    // essential self-service data is still being prepared.
    //
    // Safety:
    // - authentication and tenant branding remain unchanged;
    // - profile, reporting-manager, leave and payroll queries are unchanged;
    // - only the point at which the existing loader is released is corrected.
    await loadEmployeeRecord(
      authResult.session.user.id,
      authResult.session.user.email,
    );

    // EMPLOYEE ASSIGNED MANAGERS VISIBILITY - STEP 1
    // The employee record must resolve first because reporting relationships
    // belong to employees.id. The RPC performs the final authenticated lookup
    // and tenant restriction independently.
    await loadEmployeeReportingManagers();

    // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
    // Load employee-visible correction request status after the employee row
    // has been resolved. This is read-only and does not update HR master data.
    await loadEmployeeProfileCorrectionRequests();

    await renderEmployeeProfileImage();
    await loadEmployeeLeaveBalances();
    await loadLeaveTypes();
    await loadEmployeeLeaveRequests();
    await loadEmployeePayroll();

    // EMPLOYEE WORKSPACE LOADER REGRESSION FIX - v1.0.0
    // The authenticated Employee workspace is now fully ready for first use.
    // Release the existing loader only after the initial employee, reporting-line,
    // profile, leave and payroll data has completed loading.
    releaseEmployeeWorkspaceLoader();

    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Workspace restore already happened early after authentication.
    // Keep the final startup step focused on leave auto-refresh only.
    forceEmployeeDashboardToTopAfterRefresh();

    startLeaveAutoRefresh();
  } catch (error) {
    // EMPLOYEE WORKSPACE LOADER PARITY - STEP 1
    // Never leave the authenticated page permanently covered when startup
    // fails after the Employee shell has begun initialising.
    releaseEmployeeWorkspaceLoader();

    console.error("Error initialising employee dashboard:", error);
    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the employee dashboard.",
    );
  }
});

const state = {
  currentUser: null,
  currentProfile: null,
  employeeRecord: null,
  payrollRecords: [],

  // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
  // Employee-side read-only status history for correction requests submitted to HR.
  profileCorrectionRequests: [],

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Loaded leave requests are kept in memory so the Request Leave form
  // can block duplicate/overlapping active requests before insert.
  leaveRequests: [],
  isPayrollFiguresHidden: false,
  leaveRefreshTimer: null,
  pendingProfileImageFile: null,

  // EMPLOYEE LEAVE UX WIRING - STEP 1A
  // Controls the temporary bottom-right employee notification.
  // This is separate from the existing top page alert.
  dashboardToastTimeoutId: null,

  // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
  // When an employee edits a returned request, we update and resubmit the
  // same leave_requests row instead of creating a duplicate request. The
  // database audit trigger preserves the previous returned decision.
  returnedLeaveAmendmentRequestId: null,
  returnedLeaveAmendmentOriginalStatus: null,

  identity: {
    authUserId: null,
    employeeRowId: null,
    linkedUserId: null,
  },
  dom: {},
};

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these Employee top-level workspaces are safe to restore after refresh.
function isValidEmployeeWorkspaceKey(workspace = "") {
  return ["overview", "profile", "leave", "payroll"].includes(
    String(workspace || "").trim(),
  );
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Resolve tenant/company context where available so one company session
// does not bleed remembered workspace state into another.
function getEmployeeWorkspaceTenantScope() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    const tenantContext = rawContext ? JSON.parse(rawContext) : null;

    return String(
      tenantContext?.tenantId ||
      state.currentProfile?.tenant_id ||
      "no-tenant",
    ).trim();
  } catch (error) {
    console.warn("Employee tenant context could not be read for workspace memory.", error);

    return String(state.currentProfile?.tenant_id || "no-tenant").trim();
  }
}

// ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
// Read the already validated tenant context created during login.
// This is used only for visual Employee Dashboard branding and does not
// change tenant filtering, employee records, payroll, leave, PDF, or access logic.
function getEmployeeTenantContextForBranding() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    return rawContext ? JSON.parse(rawContext) : null;
  } catch (error) {
    console.warn("Employee tenant branding context could not be read.", error);
    return null;
  }
}

// ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
// Detect only Alpatech from the validated tenant/company context.
// Non-Alpatech tenants must keep the shared BexHR Employee Dashboard shell.
function isCurrentEmployeeTenantAlpatechWorkspace() {
  const tenantContext = getEmployeeTenantContextForBranding();

  const companyName = String(
    tenantContext?.companyName ||
    state.currentProfile?.company_name ||
    "",
  )
    .trim()
    .toLowerCase();

  const tenantCode = String(
    tenantContext?.tenantCode ||
    state.currentProfile?.tenant_code ||
    "",
  )
    .trim()
    .toLowerCase();

  return (
    companyName.includes("alpatech") ||
    tenantCode.includes("alpatech")
  );
}

// ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
// Browser tab icon only. Update every declared favicon link so the browser
// cannot retain a different BexHR icon from the universal favicon set.
// Tenant branding only; no session, access, data, tenant-filter or role changes.
function applyEmployeeTenantFaviconBranding() {
  const faviconLinks = Array.from(
    document.querySelectorAll(
      'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
    ),
  );

  if (!faviconLinks.length) return;

  const isAlpatech =
    isCurrentEmployeeTenantAlpatechWorkspace();

  const faviconHref = isAlpatech
    ? "assets/alpatech-favicon-large.png?v=20260804"
    : "assets/favicon/favicon.svg?v=20260801";

  faviconLinks.forEach((faviconLink) => {
    faviconLink.href = faviconHref;
    faviconLink.type = isAlpatech
      ? "image/png"
      : "image/svg+xml";

    if (isAlpatech) {
      faviconLink.removeAttribute("sizes");
    }
  });
}

// ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
// Tenant-scoped Employee Dashboard shell branding.
// This changes visible branding only. It does not change profile, leave,
// payroll, payslip PDF, Supabase, session, or role/access behaviour.
function applyEmployeeTenantWorkspaceShellBranding() {
  // EMPLOYEE MODERN TENANT HEADER BINDING - v1.0.0
  // Presentation only. Uses the tenant context already validated during login.
  // This does not query, change, or broaden tenant access boundaries.
  const tenantContext = getEmployeeTenantContextForBranding();

  const tenantCompanyName = String(
    tenantContext?.companyName ||
    tenantContext?.tenantName ||
    tenantContext?.tenantCode ||
    state.currentProfile?.company_name ||
    state.currentProfile?.tenant_name ||
    state.currentProfile?.tenant_code ||
    "BexHR Workspace",
  ).trim();

  const modernCompanyName = document.getElementById(
    "employeeModernCompanyName",
  );

  if (modernCompanyName) {
    modernCompanyName.textContent =
      tenantCompanyName || "BexHR Workspace";
  }

  const sidebarBrand = document.getElementById("tenantSidebarBrand");
  const heroBrandingBlock = document.getElementById("tenantHeroBrandingBlock");

  applyEmployeeTenantFaviconBranding();

  if (isCurrentEmployeeTenantAlpatechWorkspace()) {
    document.body?.classList.add("alpatech-workspace");
    document.title = "Alpatech Employee Self-Service | BexHR";

    if (sidebarBrand) {
      sidebarBrand.className = "bexhr-sidebar-brand alpatech-sidebar-brand";
      sidebarBrand.innerHTML = `
        <!-- ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
             Flame icon only. CSS renders the ALPATECH wordmark beside it. -->
        <span class="alpatech-brand-mark" aria-hidden="true">
          <img src="assets/alpatech-flame.png" alt="" />
        </span>
      `;
    }

    if (heroBrandingBlock) {
      heroBrandingBlock.innerHTML = `
        <!-- ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
             Brand only the signed-in Alpatech Employee Self-Service shell. -->
        <div class="alpatech-hero-content">
          <div class="alpatech-hero-kicker-row">
            <div class="alpatech-hero-brand" aria-label="Alpatech Employee Self-Service">
              <span class="alpatech-brand-mark alpatech-hero-mark" aria-hidden="true">
                <img src="assets/alpatech-flame.png" alt="" />
              </span>
              <span class="alpatech-brand-wordmark">ALPATECH</span>
            </div>

            <div class="hero-badge alpatech-hero-badge">
              <i class="bi bi-person-badge"></i>
              Employee Self-Service
            </div>
          </div>

          <h1 class="display-6 fw-bold mb-2">My Alpatech Self-Service</h1>
          <p class="mb-0 alpatech-hero-copy">
            Access your Alpatech profile, leave requests, payroll history, payslip details, and authorised payslip PDFs from one secure workspace.
          </p>
        </div>
      `;
    }

    document.body?.classList.remove("alpatech-branding-resolving");
    return;
  }

  // ALPATECH TENANT BRANDING - EMPLOYEE STEP 1A
  // Reset shared app branding for every non-Alpatech tenant.
  document.body?.classList.remove("alpatech-workspace", "alpatech-branding-resolving");
  document.title = "Employee Dashboard | BexHR";

  if (sidebarBrand) {
    sidebarBrand.className = "bexhr-sidebar-brand";
    sidebarBrand.innerHTML = `
      <span class="hr-brand-mark" style="width:34px;height:34px;font-size:0.8rem;">EM</span>
    `;
  }

  if (heroBrandingBlock) {
    heroBrandingBlock.innerHTML = `
      <div class="hero-badge">
        <i class="bi bi-person-badge"></i>
        Employee Self Service
      </div>
      <h1 class="display-6 fw-bold mb-2">Employee Dashboard</h1>
      <p class="mb-0" style="max-width: 760px">
        View your profile information, monitor leave balances, submit
        leave requests, review payroll history, view payslip details,
        download payslip PDFs, and track manager leave decisions.
      </p>
    `;
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope the stored workspace to the signed-in employee and company context.
function getEmployeeWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();
  const tenantScope = getEmployeeWorkspaceTenantScope();

  return `${EMPLOYEE_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}:${tenantScope}`;
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active workspace key. Do not store payroll, payslip, leave,
// salary, PDF, employee, or form data in browser storage.
function rememberEmployeeWorkspace(workspace = "") {
  if (!isValidEmployeeWorkspaceKey(workspace)) return;

  try {
    sessionStorage.setItem(getEmployeeWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to employee-dashboard.js.
    sessionStorage.setItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Employee workspace memory could not be saved.", error);
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered workspace for this employee session.
// Fresh login naturally falls back to Profile after logout clears the keys.
function getRememberedEmployeeWorkspace() {
  try {
    const scopedWorkspace = sessionStorage.getItem(getEmployeeWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY);
    const workspace = scopedWorkspace || bootWorkspace || "overview";

    return isValidEmployeeWorkspaceKey(workspace) ? workspace : "overview";
  } catch (error) {
    console.warn("Employee workspace memory could not be read.", error);
    return "profile";
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout must reset the next Employee session to Overview.
function clearRememberedEmployeeWorkspace() {
  try {
    sessionStorage.removeItem(getEmployeeWorkspaceMemoryKey());
    sessionStorage.removeItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Employee workspace memory could not be cleared.", error);
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceEmployeeDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateScrollToTopButtonVisibility();
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Employee workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long pages.
function restoreEmployeeWorkspaceAfterRefresh() {
  const workspace = getRememberedEmployeeWorkspace();

  showSection(workspace);
  forceEmployeeDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceEmployeeDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceEmployeeDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceEmployeeDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceEmployeeDashboardToTopAfterRefresh, 150);
}

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error(
      "Supabase client is not available on window.supabaseClient.",
    );
  }
  return window.supabaseClient;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

/* =========================================================
   Identity helpers
========================================================= */
function getEmployeeIdentityCandidates() {
  const candidates = [
    state.identity?.linkedUserId,
    state.identity?.authUserId,
    state.identity?.employeeRowId,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function getPreferredEmployeeReferenceId() {
  return (
    state.identity?.linkedUserId ||
    state.identity?.authUserId ||
    state.identity?.employeeRowId ||
    null
  );
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Only returned requests can be edited and resubmitted by the employee.
// Approved, rejected, and pending requests remain read-only from Employee
// Self Service.
function isReturnedLeaveRequest(request = {}) {
  const status = normalizeText(request.status || "");

  return (
    status === "returned" ||
    status === "returned for clarification"
  );
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Keep the submit button label aligned with the current workflow mode.
function getLeaveSubmitButtonDefaultHtml() {
  if (state.returnedLeaveAmendmentRequestId) {
    return `<i class="bi bi-arrow-repeat me-2"></i>Resubmit Returned Request`;
  }

  return `<i class="bi bi-send-check me-2"></i>Submit for Approval`;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Find the returned request currently being amended.
function getReturnedLeaveAmendmentRequest() {
  if (!state.returnedLeaveAmendmentRequestId) return null;

  return (state.leaveRequests || []).find(
    (request) =>
      String(request.id) === String(state.returnedLeaveAmendmentRequestId),
  ) || null;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Put the Request Leave form into amendment mode using the returned request
// values. This does not save anything until the employee submits again.
function startReturnedLeaveAmendment(leaveRequestId) {
  const request = (state.leaveRequests || []).find(
    (item) => String(item.id) === String(leaveRequestId),
  );

  if (!request) {
    showPageAlert(
      "warning",
      "The returned leave request could not be found. Please refresh leave history and try again.",
    );
    return;
  }

  if (!isReturnedLeaveRequest(request)) {
    showPageAlert(
      "warning",
      "Only returned leave requests can be edited and resubmitted.",
    );
    return;
  }

  state.returnedLeaveAmendmentRequestId = request.id;
  state.returnedLeaveAmendmentOriginalStatus = request.status || null;

  if (state.dom.leaveType) {
    state.dom.leaveType.value = request.leave_type_id || "";
  }

  if (state.dom.startDate) {
    state.dom.startDate.value = request.start_date || "";
  }

  if (state.dom.endDate) {
    state.dom.endDate.value = request.end_date || "";
  }

  if (state.dom.leaveReason) {
    state.dom.leaveReason.value = request.reason || "";
  }

  calculateLeaveDays();
  updateLeaveRequestBlockNotice();

  if (state.dom.submitLeaveBtn) {
    state.dom.submitLeaveBtn.innerHTML = getLeaveSubmitButtonDefaultHtml();
  }

  updateLeaveSubmitButtonState();

  showSection("leave");
  setEmployeeLeaveHistoryCardExpanded(true);

  showPageAlert(
    "info",
    "Editing returned leave request. Update the details and resubmit for manager review.",
  );

  window.setTimeout(() => {
    state.dom.leaveRequestForm?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 50);
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Reset amendment mode after successful resubmission or when the form returns
// to normal submission mode.
function clearReturnedLeaveAmendmentMode() {
  state.returnedLeaveAmendmentRequestId = null;
  state.returnedLeaveAmendmentOriginalStatus = null;

  if (state.dom.submitLeaveBtn) {
    state.dom.submitLeaveBtn.innerHTML = getLeaveSubmitButtonDefaultHtml();
  }
}

/* =========================================================
   Safe user_id backfill
========================================================= */
async function tryBackfillEmployeeUserId(employee, authUserId, authUserEmail) {
  const supabase = getSupabaseClient();

  if (!employee?.id || !authUserId) {
    return { employee, status: "skipped" };
  }

  if (employee.user_id === authUserId) {
    return { employee, status: "already-linked" };
  }

  const employeeEmail = normalizeEmail(employee.work_email || employee.email);
  const signedInEmail = normalizeEmail(authUserEmail);

  if (!employeeEmail || !signedInEmail || employeeEmail !== signedInEmail) {
    return { employee, status: "email-mismatch" };
  }

  if (employee.user_id) {
    return { employee, status: "different-user-id-present" };
  }

  try {
    const { data, error } = await supabase
      .from("employees")
      .update({ user_id: authUserId })
      .eq("id", employee.id)
      .is("user_id", null)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Unable to backfill employees.user_id:", error);
      return { employee, status: "failed", error };
    }

    if (data) {
      return { employee: data, status: "linked" };
    }

    return {
      employee: { ...employee, user_id: authUserId },
      status: "linked-no-row-returned",
    };
  } catch (error) {
    console.error("Unexpected employees.user_id backfill error:", error);
    return { employee, status: "failed", error };
  }
}

function applyResolvedIdentity(employee) {
  state.identity = {
    authUserId: state.currentUser?.id || null,
    employeeRowId: employee?.id || null,
    linkedUserId: employee?.user_id || state.currentUser?.id || null,
  };
}

function cacheDomElements() {
  state.dom = {
    pageAlert: document.getElementById("pageAlert"),

    // GUIDED HELP LAYER - EMPLOYEE STEP 1U
    // On-demand Employee operating guide.
    // This is guidance only; it does not alter profile, leave, payroll,
    // payslip, PDF, tenant branding, Supabase, session, or access behaviour.
    openEmployeeOperatingGuideBtn: document.getElementById("openEmployeeOperatingGuideBtn"),
    openEmployeeOperatingGuideSidebarBtn: document.getElementById("openEmployeeOperatingGuideSidebarBtn"),
    employeeOperatingGuideModal: document.getElementById("employeeOperatingGuideModal"),
    closeEmployeeOperatingGuideBtn: document.getElementById("closeEmployeeOperatingGuideBtn"),
    closeEmployeeOperatingGuideFooterBtn: document.getElementById("closeEmployeeOperatingGuideFooterBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1I
    // Floating Back-to-Top button used only for page navigation.
    scrollToTopBtn: document.getElementById("scrollToTopBtn"),

    navOverviewBtn: document.getElementById("navOverviewBtn"),
    navProfileBtn: document.getElementById("navProfileBtn"),
    navLeaveBtn: document.getElementById("navLeaveBtn"),
    navPayrollBtn: document.getElementById("navPayrollBtn"),
    logoutBtn: document.getElementById("logoutBtn"),

    overviewSection: document.getElementById("overviewSection"),
    overviewWelcomeName: document.getElementById("overviewWelcomeName"),

    /* EMPLOYEE OVERVIEW LIVE METRICS - v1.0.0
       Display-only bindings for existing employee state.
       No additional Supabase queries or access changes. */
    overviewProfileStatus: document.getElementById("overviewProfileStatus"),
    overviewOpenRequestCount: document.getElementById(
      "overviewOpenRequestCount",
    ),
    overviewLeaveRequestCount: document.getElementById(
      "overviewLeaveRequestCount",
    ),
    overviewLatestPayCycle: document.getElementById(
      "overviewLatestPayCycle",
    ),

    profileSection: document.getElementById("profileSection"),
    leaveSection: document.getElementById("leaveSection"),
    payrollSection: document.getElementById("payrollSection"),

    employeeDisplayEmail: document.getElementById("employeeDisplayEmail"),
    employeeInitials: document.getElementById("employeeInitials"),
    employeeHeroImage: document.getElementById("employeeHeroImage"),
    employeeModernUserName: document.getElementById("employeeModernUserName"),
    heroRoleValue: document.getElementById("heroRoleValue"),
    heroModuleValue: document.getElementById("heroModuleValue"),

    profileImage: document.getElementById("profileImage"),
    profileImageInput: document.getElementById("profileImageInput"),
    saveProfileImageBtn: document.getElementById("saveProfileImageBtn"),
    removeProfileImageBtn: document.getElementById("removeProfileImageBtn"),
    profileFullName: document.getElementById("profileFullName"),
    profileJobTitle: document.getElementById("profileJobTitle"),
    profileDepartment: document.getElementById("profileDepartment"),
    profileEmployeeId: document.getElementById("profileEmployeeId"),

    firstName: document.getElementById("firstName"),
    lastName: document.getElementById("lastName"),
    emailAddress: document.getElementById("emailAddress"),
    phoneNumber: document.getElementById("phoneNumber"),
    roleName: document.getElementById("roleName"),
    managerName: document.getElementById("managerName"),
    // EMPLOYEE ASSIGNED MANAGERS VISIBILITY - STEP 1
    // Read-only Profile bindings for authoritative Primary/Secondary manager data.
    employeeReportingManagersCard:
      document.getElementById("employeeReportingManagersCard"),
    employeeReportingManagersLoading:
      document.getElementById("employeeReportingManagersLoading"),
    employeeReportingManagersEmpty:
      document.getElementById("employeeReportingManagersEmpty"),
    employeeReportingManagersList:
      document.getElementById("employeeReportingManagersList"),

    // EMPLOYEE PROFILE REVIEW - STEP 1A
    // Read-only HR-prepared profile fields. These let employees check
    // information held by HR without directly editing controlled HR records.
    reviewEmployeeNumber: document.getElementById("reviewEmployeeNumber"),
    reviewFullName: document.getElementById("reviewFullName"),
    reviewPersonalEmail: document.getElementById("reviewPersonalEmail"),
    reviewAlternativePhone: document.getElementById("reviewAlternativePhone"),
    reviewDateOfBirth: document.getElementById("reviewDateOfBirth"),
    reviewGender: document.getElementById("reviewGender"),
    reviewMaritalStatus: document.getElementById("reviewMaritalStatus"),
    reviewNationality: document.getElementById("reviewNationality"),
    reviewStateOfOrigin: document.getElementById("reviewStateOfOrigin"),
    reviewLga: document.getElementById("reviewLga"),
    reviewTown: document.getElementById("reviewTown"),
    reviewMeansOfIdentification: document.getElementById("reviewMeansOfIdentification"),
    reviewIssuingAuthority: document.getElementById("reviewIssuingAuthority"),
    reviewNin: document.getElementById("reviewNin"),

    // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
    // Formal correction request controls for HR-held employee profile data.
    openProfileCorrectionRequestBtn: document.getElementById("openProfileCorrectionRequestBtn"),
    profileCorrectionRequestPanel: document.getElementById("profileCorrectionRequestPanel"),
    profileCorrectionRequestForm: document.getElementById("profileCorrectionRequestForm"),
    profileCorrectionFieldKey: document.getElementById("profileCorrectionFieldKey"),
    profileCorrectionCurrentValue: document.getElementById("profileCorrectionCurrentValue"),
    profileCorrectionRequestedValue: document.getElementById("profileCorrectionRequestedValue"),
    profileCorrectionReason: document.getElementById("profileCorrectionReason"),
    profileCorrectionRequestStatus: document.getElementById("profileCorrectionRequestStatus"),
    submitProfileCorrectionRequestBtn: document.getElementById("submitProfileCorrectionRequestBtn"),
    cancelProfileCorrectionRequestBtn: document.getElementById("cancelProfileCorrectionRequestBtn"),

    // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
    // Read-only request tracking panel for the signed-in employee.
    profileCorrectionRequestHistoryPanel: document.getElementById("profileCorrectionRequestHistoryPanel"),
    refreshProfileCorrectionRequestHistoryBtn: document.getElementById("refreshProfileCorrectionRequestHistoryBtn"),
    profileCorrectionRequestHistoryEmptyState: document.getElementById("profileCorrectionRequestHistoryEmptyState"),
    profileCorrectionRequestHistoryList: document.getElementById("profileCorrectionRequestHistoryList"),

    leaveBalancesEmptyState: document.getElementById("leaveBalancesEmptyState"),
    leaveBalancesGrid: document.getElementById("leaveBalancesGrid"),
    refreshLeaveBalancesBtn: document.getElementById("refreshLeaveBalancesBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1L-C
    // Leave Balances gets its own collapse controls.
    employeeLeaveBalancesCard: document.getElementById("employeeLeaveBalancesCard"),
    employeeLeaveBalancesHeader: document.getElementById("employeeLeaveBalancesHeader"),
    toggleLeaveBalancesCardBtn: document.getElementById("toggleLeaveBalancesCardBtn"),
    leaveBalancesCardCollapse: document.getElementById("leaveBalancesCardCollapse"),

    latestDecisionEmptyState: document.getElementById(
      "latestDecisionEmptyState",
    ),
    latestDecisionCard: document.getElementById("latestDecisionCard"),
    latestDecisionStatus: document.getElementById("latestDecisionStatus"),
    latestDecisionLeaveType: document.getElementById("latestDecisionLeaveType"),
    latestDecisionDateTime: document.getElementById("latestDecisionDateTime"),
    latestDecisionPeriod: document.getElementById("latestDecisionPeriod"),
    latestDecisionBy: document.getElementById("latestDecisionBy"),
    latestDecisionComment: document.getElementById("latestDecisionComment"),

    // EMPLOYEE UI CLEANUP - STEP 1N
    // Latest Leave Decision gets its own card-level refresh and collapse controls.
    employeeLatestDecisionCard: document.getElementById("employeeLatestDecisionCard"),
    employeeLatestDecisionHeader: document.getElementById("employeeLatestDecisionHeader"),
    refreshLatestDecisionBtn: document.getElementById("refreshLatestDecisionBtn"),
    toggleLatestDecisionCardBtn: document.getElementById("toggleLatestDecisionCardBtn"),
    latestDecisionCardCollapse: document.getElementById("latestDecisionCardCollapse"),

    leaveRequestForm: document.getElementById("leaveRequestForm"),
    leaveType: document.getElementById("leaveType"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    totalDays: document.getElementById("totalDays"),
    leaveReason: document.getElementById("leaveReason"),
    submitLeaveBtn: document.getElementById("submitLeaveBtn"),

    // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
    // Inline warning shown under Leave Type when the selected request
    // conflicts with an existing active leave request.
    leaveRequestBlockNotice: document.getElementById("leaveRequestBlockNotice"),

    refreshLeaveRequestsBtn: document.getElementById("refreshLeaveRequestsBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1O-C
    // My Leave History gets optional collapse controls.
    // It stays expanded by default to avoid an awkward empty right column
    // beside the Submit Leave Request form.
    employeeLeaveHistoryCard: document.getElementById("employeeLeaveHistoryCard"),
    employeeLeaveHistoryHeader: document.getElementById("employeeLeaveHistoryHeader"),
    toggleLeaveHistoryCardBtn: document.getElementById("toggleLeaveHistoryCardBtn"),
    leaveHistoryCardCollapse: document.getElementById("leaveHistoryCardCollapse"),

    leaveRequestsEmptyState: document.getElementById("leaveRequestsEmptyState"),

    // EMPLOYEE UI CLEANUP - STEP 1O-A
    // My Leave History now renders as stacked request cards instead of a table.
    leaveRequestsList: document.getElementById("leaveRequestsList"),

    refreshPayrollBtn: document.getElementById("refreshPayrollBtn"),
    currentPayrollEmptyState: document.getElementById(
      "currentPayrollEmptyState",
    ),
    currentPayrollSummaryGrid: document.getElementById(
      "currentPayrollSummaryGrid",
    ),
    currentPayCycle: document.getElementById("currentPayCycle"),
    currentGrossPay: document.getElementById("currentGrossPay"),
    currentTotalDeductions: document.getElementById("currentTotalDeductions"),
    currentNetPay: document.getElementById("currentNetPay"),
    togglePayrollFiguresBtn: document.getElementById("togglePayrollFiguresBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1B
    // Payroll History gets its own collapse controls.
    // No other Employee dashboard card is included in this step.
    employeePayrollHistoryCard: document.getElementById("employeePayrollHistoryCard"),
    employeePayrollHistoryHeader: document.getElementById("employeePayrollHistoryHeader"),
    togglePayrollHistoryCardBtn: document.getElementById("togglePayrollHistoryCardBtn"),
    payrollHistoryCardCollapse: document.getElementById("payrollHistoryCardCollapse"),

    payrollHistoryEmptyState: document.getElementById(
      "payrollHistoryEmptyState",
    ),
    payrollHistoryTableWrapper: document.getElementById(
      "payrollHistoryTableWrapper",
    ),
    payrollHistoryTableBody: document.getElementById("payrollHistoryTableBody"),
    payrollSearchInput: document.getElementById("payrollSearchInput"),
    payrollDateFromInput: document.getElementById("payrollDateFromInput"),
    payrollDateToInput: document.getElementById("payrollDateToInput"),
    clearPayrollFiltersBtn: document.getElementById("clearPayrollFiltersBtn"),
  };
}

function bindNavigationEvents() {
  state.dom.navOverviewBtn?.addEventListener("click", () => {
    rememberEmployeeWorkspace("overview");
    showSection("overview");
  });
  state.dom.navProfileBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberEmployeeWorkspace("profile");
    showSection("profile");
  });

  state.dom.navLeaveBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Leave Management only for refresh. No leave request data is stored.
    rememberEmployeeWorkspace("leave");
    showSection("leave");
  });

  state.dom.navPayrollBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Payroll only for refresh. No payslip, salary, or payroll data is stored.
    rememberEmployeeWorkspace("payroll");
    showSection("payroll");
  });

  // EMPLOYEE OVERVIEW QUICK ACTIONS - v1.0.0
  // Reuse the existing Employee workspace and correction-request flows.
  document
    .querySelectorAll("[data-employee-overview-target]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const target = String(
          button.getAttribute("data-employee-overview-target") || "",
        ).trim();

        if (target === "requests") {
          rememberEmployeeWorkspace("profile");
          showSection("profile");
          setEmployeeProfileCorrectionPanelVisible(true);
          return;
        }

        if (!["profile", "leave", "payroll"].includes(target)) {
          return;
        }

        rememberEmployeeWorkspace(target);
        showSection(target);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

}

function bindUtilityEvents() {
  // GUIDED HELP LAYER - EMPLOYEE STEP 1U
  // Help opens as an on-demand modal so employee self-service content stays first.
  const openEmployeeOperatingGuide = () => {
    state.dom.employeeOperatingGuideModal?.classList.remove("d-none");
    state.dom.employeeOperatingGuideModal?.setAttribute("aria-hidden", "false");
  };

  const closeEmployeeOperatingGuide = () => {
    state.dom.employeeOperatingGuideModal?.classList.add("d-none");
    state.dom.employeeOperatingGuideModal?.setAttribute("aria-hidden", "true");
  };

  state.dom.openEmployeeOperatingGuideBtn?.addEventListener("click", openEmployeeOperatingGuide);
  state.dom.openEmployeeOperatingGuideSidebarBtn?.addEventListener("click", openEmployeeOperatingGuide);
  state.dom.closeEmployeeOperatingGuideBtn?.addEventListener("click", closeEmployeeOperatingGuide);
  state.dom.closeEmployeeOperatingGuideFooterBtn?.addEventListener("click", closeEmployeeOperatingGuide);

  // EMPLOYEE OPERATING GUIDE LINKED WORKFLOW - v1.1.0
  // Route guide actions through the existing Employee navigation buttons.
  // This preserves showSection(), workspace memory, active navigation state,
  // tenant boundaries, access behaviour and all existing workspace logic.
  state.dom.employeeOperatingGuideModal
    ?.querySelectorAll("[data-employee-guide-target]")
    .forEach((guideAction) => {
      guideAction.addEventListener("click", () => {
        const targetButtonId = String(
          guideAction.getAttribute("data-employee-guide-target") || "",
        ).trim();

        const allowedTargets = new Set([
          "navOverviewBtn",
          "navProfileBtn",
          "navLeaveBtn",
          "navPayrollBtn",
        ]);

        if (!allowedTargets.has(targetButtonId)) {
          console.warn(
            "Employee guide target was blocked because it is not an approved workspace.",
            targetButtonId,
          );
          return;
        }

        const targetButton = document.getElementById(targetButtonId);

        if (!targetButton) {
          console.warn(
            "Employee guide target button could not be found.",
            targetButtonId,
          );
          return;
        }

        closeEmployeeOperatingGuide();
        targetButton.click();

        window.requestAnimationFrame(() => {
          window.scrollTo({
            top: 0,
            left: 0,
            behavior: "auto",
          });
        });
      });
    });

  state.dom.employeeOperatingGuideModal?.addEventListener("click", (event) => {
    if (event.target === state.dom.employeeOperatingGuideModal) {
      closeEmployeeOperatingGuide();
    }
  });

  state.dom.logoutBtn?.addEventListener("click", async () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Logout must reset the next Employee session to Profile.
    clearRememberedEmployeeWorkspace();

    await window.SessionManager.logoutUser("logout");
  });

  state.dom.refreshLeaveBalancesBtn?.addEventListener("click", async () => {
    await refreshEmployeeLeaveBalancesManually();
  });

  state.dom.refreshLeaveRequestsBtn?.addEventListener("click", async () => {
    await refreshEmployeeLeaveHistoryManually();
  });

  // EMPLOYEE UI CLEANUP - STEP 1N
  // Refresh only the leave decision/history data from the card header.
  state.dom.refreshLatestDecisionBtn?.addEventListener("click", async () => {
    await refreshLatestDecisionManually();
  });

  state.dom.refreshPayrollBtn?.addEventListener("click", async () => {
    await refreshEmployeePayrollManually();
  });

  // EMPLOYEE UI CLEANUP - STEP 1I
  // Smoothly return the employee to the top of the dashboard.
  state.dom.scrollToTopBtn?.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  window.addEventListener("scroll", updateScrollToTopButtonVisibility, {
    passive: true,
  });

  window.addEventListener("resize", updateScrollToTopButtonVisibility);

  updateScrollToTopButtonVisibility();

  // EMPLOYEE PAYROLL PRIVACY - STEP 1H
  // Toggle only the on-screen Current Payslip Summary figures.
  // Payroll records, calculations, PDF generation, and Supabase data are not changed.
  state.dom.togglePayrollFiguresBtn?.addEventListener("click", () => {
    setEmployeePayrollFiguresHidden(!state.isPayrollFiguresHidden, true);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1I
// Show the Back-to-Top button only after the employee has scrolled down.
// This keeps the top of the dashboard clean on first load.
function updateScrollToTopButtonVisibility() {
  const button = state.dom.scrollToTopBtn;
  if (!button) return;

  const shouldShow = window.scrollY > 260;
  button.classList.toggle("d-none", !shouldShow);
}


function bindPayrollFilterEvents() {
  state.dom.payrollSearchInput?.addEventListener("input", () => {
    applyPayrollFilters();
  });

  state.dom.payrollDateFromInput?.addEventListener("change", () => {
    applyPayrollFilters();
  });

  state.dom.payrollDateToInput?.addEventListener("change", () => {
    applyPayrollFilters();
  });

  state.dom.clearPayrollFiltersBtn?.addEventListener("click", () => {
    clearPayrollFilters();
  });
}

// EMPLOYEE UI CLEANUP - STEP 1L-C
// Programmatic Leave Balances collapse state.
// This mirrors the Payroll History collapse pattern but is scoped only
// to the Leave Balances card.
function setEmployeeLeaveBalancesCardExpanded(shouldExpand) {
  const button = state.dom.toggleLeaveBalancesCardBtn;
  const panel = state.dom.leaveBalancesCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse leave balances" : "Expand leave balances";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }

  // EMPLOYEE LEAVE UX WIRING - STEP 1A
  // Keep double-click collapse visually identical to pressing the Collapse
  // button by clearing/reapplying the desktop equal-height calculation.
  requestEmployeeLeaveLayoutSync();
}

// EMPLOYEE UI CLEANUP - STEP 1L-C
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive controls are ignored so Refresh Balances remains safe.
function bindEmployeeLeaveBalancesCardEvents() {
  const card = state.dom.employeeLeaveBalancesCard;
  const button = state.dom.toggleLeaveBalancesCardBtn;
  const panel = state.dom.leaveBalancesCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Leave Balances collapsed by default.
  setEmployeeLeaveBalancesCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLeaveBalancesCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    // EMPLOYEE DASHBOARD FINAL QA - STEP 1R-A
    // Ignore double-clicks inside the scrollable history records area.
    // This prevents the card from collapsing while the employee is reviewing
    // or selecting text from manager decision comments.
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, .employee-leave-history-scroll-area, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeeLeaveBalancesCardExpanded(false);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Programmatic Latest Leave Decision collapse state.
// This mirrors the Leave Balances and Payroll History card behaviour.
function setEmployeeLatestDecisionCardExpanded(shouldExpand) {
  const button = state.dom.toggleLatestDecisionCardBtn;
  const panel = state.dom.latestDecisionCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand
    ? "Collapse latest leave decision"
    : "Expand latest leave decision";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive controls are ignored so Refresh Decision remains safe.
function bindEmployeeLatestDecisionCardEvents() {
  const card = state.dom.employeeLatestDecisionCard;
  const button = state.dom.toggleLatestDecisionCardBtn;
  const panel = state.dom.latestDecisionCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Latest Leave Decision collapsed by default.
  setEmployeeLatestDecisionCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLatestDecisionCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeeLatestDecisionCardExpanded(false);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1O-C
// Programmatic My Leave History collapse state.
// Unlike Leave Balances and Latest Decision, this remains expanded by default
// because employees should immediately see their recent leave outcomes.
function setEmployeeLeaveHistoryCardExpanded(shouldExpand) {
  const button = state.dom.toggleLeaveHistoryCardBtn;
  const panel = state.dom.leaveHistoryCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse leave history" : "Expand leave history";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1O-C
// Bind the visible collapse button and header double-click behaviour.
// Double-click is limited to the header so employees do not accidentally
// collapse the card while reading decision comments.
function bindEmployeeLeaveHistoryCardEvents() {
  const card = state.dom.employeeLeaveHistoryCard;
  const button = state.dom.toggleLeaveHistoryCardBtn;
  const panel = state.dom.leaveHistoryCardCollapse;

  if (!card || !button || !panel) return;

  // EMPLOYEE UI CLEANUP - STEP 1O-C
  // Keep My Leave History expanded by default because recent leave
  // outcomes are high-value employee information.
  setEmployeeLeaveHistoryCardExpanded(true);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLeaveHistoryCardExpanded(!isExpanded);
  });

  // EMPLOYEE UI CLEANUP - STEP 1O-C FIX
  // Make double-click responsive across the whole history card shell,
  // matching the existing employee card collapse pattern.
  // Interactive controls are ignored so Refresh History remains safe.
  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, .employee-leave-history-scroll-area, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    // EMPLOYEE LEAVE UX WIRING - STEP 1B
    // Double-click should behave exactly like pressing the visible Collapse
    // button. The HTML layout-sync script already listens to that button click,
    // so using button.click() avoids the tall blank card left by the direct
    // collapse path.
    button.click();
  });
}

// EMPLOYEE UI CLEANUP - STEP 1B
// Programmatic Payroll History collapse state.
// This mirrors the HR/Admin pattern but is scoped only to Payroll History.
function setEmployeePayrollHistoryCardExpanded(shouldExpand) {
  const button = state.dom.togglePayrollHistoryCardBtn;
  const panel = state.dom.payrollHistoryCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse payroll history" : "Expand payroll history";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1B
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive elements are ignored so filters, table scrolling, breakdown,
// and payslip download actions continue to work normally.
function bindEmployeePayrollHistoryCardEvents() {
  const card = state.dom.employeePayrollHistoryCard;
  const button = state.dom.togglePayrollHistoryCardBtn;
  const panel = state.dom.payrollHistoryCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Payroll History collapsed by default on page load.
  setEmployeePayrollHistoryCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeePayrollHistoryCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, table, .dashboard-table-wrap, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeePayrollHistoryCardExpanded(false);
  });
}

// EMPLOYEE PROFILE REVIEW - STEP 1B
// Lightweight tab behaviour for the read-only HR Profile Review block.
// No Bootstrap JS dependency is required, and no HR data is changed.
function bindEmployeeProfileReviewTabs() {
  const tabButtons = Array.from(
    document.querySelectorAll("[data-employee-profile-review-tab]"),
  );

  const tabPanels = Array.from(
    document.querySelectorAll("[data-employee-profile-review-panel]"),
  );

  if (!tabButtons.length || !tabPanels.length) return;

  const activateTab = (targetTab) => {
    tabButtons.forEach((button) => {
      const isActive =
        String(button.dataset.employeeProfileReviewTab || "") === targetTab;

      button.classList.toggle("btn-primary", isActive);
      button.classList.toggle("btn-outline-primary", !isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    tabPanels.forEach((panel) => {
      const isActive =
        String(panel.dataset.employeeProfileReviewPanel || "") === targetTab;

      panel.classList.toggle("d-none", !isActive);
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetTab = String(
        button.dataset.employeeProfileReviewTab || "core",
      );

      activateTab(targetTab);
    });
  });

  activateTab("core");
}

function bindProfileImageEvents() {
  // EMPLOYEE UI CLEANUP - STEP 1J
  // Keep profile image upload disabled until a valid file is selected.
  updateProfileImageUploadButtonState();

  state.dom.profileImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    handlePendingProfileImage(file);
  });

  state.dom.saveProfileImageBtn?.addEventListener("click", async () => {
    await uploadEmployeeProfileImage();
  });

  state.dom.removeProfileImageBtn?.addEventListener("click", async () => {
    await removeEmployeeProfileImage();
  });
}

function bindSyncEvents() {
  window.addEventListener("storage", async (event) => {
    if (event.key !== "hrPayrollLeaveDecisionSync") return;
    await refreshEmployeeLeaveViewsSilently();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await refreshEmployeeLeaveViewsSilently();
    }
  });
}

function startLeaveAutoRefresh() {
  stopLeaveAutoRefresh();

  state.leaveRefreshTimer = window.setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    await refreshEmployeeLeaveViewsSilently();
  }, 10000);
}

function stopLeaveAutoRefresh() {
  if (state.leaveRefreshTimer) {
    window.clearInterval(state.leaveRefreshTimer);
    state.leaveRefreshTimer = null;
  }
}

async function refreshEmployeeLeaveViewsSilently() {
  try {
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
  } catch (error) {
    console.warn("Silent leave refresh failed:", error);
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// My Leave History has a desktop equal-height helper in employee-dashboard.html.
// Button-click collapse already triggers that helper through its click listener,
// but double-click collapse happens inside this JS file. Dispatching resize here
// makes double-click produce the same compact result as the Collapse button.
function requestEmployeeLeaveLayoutSync() {
  window.setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 50);
}

async function refreshEmployeeLeaveBalancesManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLeaveBalancesBtn, true);
    await waitForNextPaint();

    // LEAVE BALANCE ELIGIBILITY VISIBILITY - STEP 1E
    // Refresh the employee record first so gender changes made by HR are
    // reflected before filtering Maternity/Paternity balance cards.
    await loadEmployeeRecord(
      state.currentUser.id,
      state.currentUser.email || state.currentProfile?.email,
    );

    await loadEmployeeLeaveBalances();
    await loadLeaveTypes();
    await loadEmployeeLeaveRequests();
    clearPageAlert();
    showPageAlert("success", "Leave balances refreshed successfully.");
  } catch (error) {
    console.error("Manual leave balances refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh leave balances right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLeaveBalancesBtn, false);
  }
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Card-level refresh for Latest Leave Decision.
// It reloads leave requests because Latest Decision is derived from leave request decisions.
// It also reloads balances because approved/rejected decisions can affect entitlement usage.
async function refreshLatestDecisionManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLatestDecisionBtn, true);
    await waitForNextPaint();
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
    clearPageAlert();
    showPageAlert("success", "Latest leave decision refreshed successfully.");
  } catch (error) {
    console.error("Manual latest leave decision refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh the latest leave decision right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLatestDecisionBtn, false);
  }
}


async function refreshEmployeeLeaveHistoryManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLeaveRequestsBtn, true);
    await waitForNextPaint();
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
    clearPageAlert();
    showPageAlert("success", "Leave history refreshed successfully.");
  } catch (error) {
    console.error("Manual leave history refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh leave history right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLeaveRequestsBtn, false);
  }
}

async function refreshEmployeePayrollManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshPayrollBtn, true);
    await waitForNextPaint();
    await loadEmployeePayroll();
    clearPageAlert();
    showPageAlert("success", "Payroll information refreshed successfully.");
  } catch (error) {
    console.error("Manual payroll refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh payroll information right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshPayrollBtn, false);
  }
}

function setRefreshButtonLoading(button, isLoading) {
  if (!button) return;

  const isPayrollRefreshButton = button.id === "refreshPayrollBtn";

  button.disabled = isLoading;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    // EMPLOYEE UI CLEANUP - STEP 1Q-A
    // Keep the compact Payroll refresh action icon-only even while loading.
    // Other refresh buttons keep their existing "Refreshing..." text.
    if (isPayrollRefreshButton) {
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      `;
      button.title = "Refreshing payroll";
      button.setAttribute("aria-label", "Refreshing payroll");
      return;
    }

    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Refreshing...
    `;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;

    if (isPayrollRefreshButton) {
      button.title = "Refresh payroll";
      button.setAttribute("aria-label", "Refresh payroll");
    }
  }
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-1
// Resolve the initial Employee Dashboard section from the URL.
// Example safe link: employee-dashboard.html?section=payroll
// Only known section names are allowed, so the URL cannot trigger
// unexpected behaviour or expose payroll-sensitive values.
function getInitialEmployeeDashboardSectionFromUrl() {
  const allowedSections = new Set([
    "overview",
    "profile",
    "leave",
    "payroll",
  ]);

  try {
    const params = new URLSearchParams(window.location.search);
    const requestedSection = normalizeText(params.get("section") || "");

    if (allowedSections.has(requestedSection)) {
      return requestedSection;
    }
  } catch (error) {
    console.warn("Unable to resolve initial employee dashboard section:", error);
  }

  // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
  // No URL section was requested, so let workspace memory decide.
  return null;
}

// PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4A
// Detect only the safe payslip email journey after login.
// This is UI convenience only: it opens Payroll History, but it does not expose
// payroll IDs, salary values, deductions, bank details, or employee IDs.
function isPayslipEmailDashboardLanding() {
  try {
    const params = new URLSearchParams(window.location.search || "");

    return (
      normalizeText(params.get("section") || "") === "payroll" &&
      normalizeText(params.get("source") || "") === "payslip-email"
    );
  } catch (error) {
    console.warn("Payslip email dashboard landing could not be resolved:", error);
    return false;
  }
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-1
// Open the requested safe section after all employee data has loaded.
// This keeps payslip access behind the normal authenticated employee dashboard.
function showInitialEmployeeDashboardSection() {
  // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
  // URL section wins for secure notification links, for example:
  // employee-dashboard.html?section=payroll
  // Otherwise, browser refresh restores the remembered workspace.
  const requestedSection = getInitialEmployeeDashboardSectionFromUrl();
  const sectionToShow = requestedSection || getRememberedEmployeeWorkspace();
  const shouldOpenPayrollHistoryFromEmail =
    sectionToShow === "payroll" && isPayslipEmailDashboardLanding();

  rememberEmployeeWorkspace(sectionToShow);
  showSection(sectionToShow);
  restoreEmployeeWorkspaceAfterRefresh();

  // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4A
  // Open Payroll History only when the user arrived from a payslip email.
  // Normal employee Payroll tab navigation keeps the existing collapsed default.
  if (shouldOpenPayrollHistoryFromEmail) {
    setEmployeePayrollHistoryCardExpanded(true);
  }
}

function showSection(sectionName) {
  const isOverview = sectionName === "overview";
  const isProfile = sectionName === "profile";
  const isLeave = sectionName === "leave";
  const isPayroll = sectionName === "payroll";

  // EMPLOYEE DYNAMIC WORKSPACE HEADER - v1.0.0
  // Keep the application header aligned with the active Employee workspace.
  // Presentation text only:
  // - no navigation, tenant, role, profile, leave or payroll logic changes;
  // - existing section visibility and workspace-memory behaviour remain intact.
  const workspaceHeaderContent = {
    overview: {
      module: "Overview",
      title: "Employee Overview",
      subtitle:
        "Review your profile, HR requests, leave activity, payroll information, and recent updates.",
    },
    profile: {
      module: "My Profile",
      title: "My Profile",
      subtitle:
        "Review your employee account, profile photo, reporting line, and HR-held information.",
    },
    leave: {
      module: "Leave Management",
      title: "Leave Management",
      subtitle:
        "Review balances, submit leave requests, and track manager decisions.",
    },
    payroll: {
      module: "Payroll",
      title: "Payroll & Payslips",
      subtitle:
        "Review authorised pay cycles, payroll history, and available payslip records.",
    },
  };

  const activeHeaderContent =
    workspaceHeaderContent[sectionName] ||
    workspaceHeaderContent.overview;

  const heroModuleValue =
    state.dom.heroModuleValue ||
    document.getElementById("heroModuleValue");

  const employeeModernPageTitle =
    state.dom.employeeModernPageTitle ||
    document.getElementById("employeeModernPageTitle");

  const employeeModernPageSubtitle =
    state.dom.employeeModernPageSubtitle ||
    document.getElementById("employeeModernPageSubtitle");

  if (heroModuleValue) {
    heroModuleValue.textContent = activeHeaderContent.module;
  }

  if (employeeModernPageTitle) {
    employeeModernPageTitle.textContent = activeHeaderContent.title;
  }

  if (employeeModernPageSubtitle) {
    employeeModernPageSubtitle.textContent = activeHeaderContent.subtitle;
  }

  state.dom.overviewSection?.classList.toggle("d-none", !isOverview);
  state.dom.profileSection?.classList.toggle("d-none", !isProfile);
  state.dom.leaveSection?.classList.toggle("d-none", !isLeave);
  state.dom.payrollSection?.classList.toggle("d-none", !isPayroll);

  [
    state.dom.navOverviewBtn,
    state.dom.navProfileBtn,
    state.dom.navLeaveBtn,
    state.dom.navPayrollBtn,
  ].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline-primary");
  });

  if (isOverview && state.dom.navOverviewBtn) {
    state.dom.navOverviewBtn.classList.remove("btn-outline-primary");
    state.dom.navOverviewBtn.classList.add("btn-primary");
  }

  if (isProfile && state.dom.navProfileBtn) {
    state.dom.navProfileBtn.classList.remove("btn-outline-primary");
    state.dom.navProfileBtn.classList.add("btn-primary");
  }

  if (isLeave && state.dom.navLeaveBtn) {
    state.dom.navLeaveBtn.classList.remove("btn-outline-primary");
    state.dom.navLeaveBtn.classList.add("btn-primary");
  }

  if (isPayroll && state.dom.navPayrollBtn) {
    state.dom.navPayrollBtn.classList.remove("btn-outline-primary");
    state.dom.navPayrollBtn.classList.add("btn-primary");
  }

  // CROSS-DASHBOARD SIDEBAR REPLICATION - EMPLOYEE STEP 1C-3
  // Keep the Employee desktop sidebar active state aligned with the existing
  // Employee workspace buttons. This does not change profile, leave, payroll,
  // payslip, PDF, or workspace-memory logic.
  [
    { id: "sidebarEmployeeOverviewBtn", active: isOverview },
    // Profile now lives in the Employee sidebar footer.
    // Keep the active state aligned with the existing footer button ID.
    { id: "sidebarEmployeeProfileFooterBtn", active: isProfile },
    { id: "sidebarEmployeeLeaveBtn", active: isLeave },
    { id: "sidebarEmployeePayrollBtn", active: isPayroll },
  ].forEach(({ id, active }) => {
    const item = document.getElementById(id);
    if (item) item.classList.toggle("active", active);
  });
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
// Employee eligibility depends on HR master data such as gender.
// The original lookup used exact work_email matching after user_id lookup.
// That is too brittle for seeded/test data where email casing or profile email
// source can differ. This helper keeps the lookup employee-scoped but makes
// email matching case-insensitive.
async function findEmployeeRecordByKnownEmails(emailValues = []) {
  const supabase = getSupabaseClient();

  const emails = [
    ...new Set(
      emailValues
        .map((value) => normalizeEmail(value))
        .filter(Boolean),
    ),
  ];

  for (const email of emails) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .ilike("work_email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Employee lookup by case-insensitive work_email failed:", error);
      continue;
    }

    if (data) {
      return data;
    }
  }

  return null;
}

/* =========================================================
   Employee record loading
========================================================= */
async function loadEmployeeRecord(userId, userEmail) {
  const supabase = getSupabaseClient();

  let employee = null;
  let lookupMethod = "";

  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      employee = data;
      lookupMethod = "user_id";
    }
  } catch (err) {
    console.warn("Lookup by user_id failed:", err);
  }

  if (!employee) {
    try {
      // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
      // Use both auth email and profile email, case-insensitively, so the
      // signed-in employee resolves to the full employees row including gender.
      const emailMatchedEmployee = await findEmployeeRecordByKnownEmails([
        userEmail,
        state.currentProfile?.email,
        state.currentUser?.email,
      ]);

      if (emailMatchedEmployee) {
        employee = emailMatchedEmployee;
        lookupMethod = "work_email";
      }
    } catch (err) {
      console.warn("Lookup by known employee email failed:", err);
    }
  }

  if (!employee) {
    const fallbackEmployee = {
      id: userId,
      user_id: userId,
      first_name: "",
      last_name: "",
      work_email: userEmail || state.currentProfile?.email || "",
      phone_number: "",
      role: "Employee",
      department: "--",
      employee_id: "--",
      manager_name: "--",
      job_title: "Employee",
      profile_image_url: "",
    };

    state.employeeRecord = fallbackEmployee;
    applyResolvedIdentity(fallbackEmployee);
    renderEmployeeRecord(fallbackEmployee);

    showPageAlert(
      "warning",
      "Employee record was not found in employees table for this signed-in user.",
    );
    return;
  }

  if (lookupMethod === "work_email") {
    const linkResult = await tryBackfillEmployeeUserId(employee, userId, userEmail);

    if (
      linkResult.status === "linked" ||
      linkResult.status === "linked-no-row-returned"
    ) {
      employee = linkResult.employee;
    }
  }

  state.employeeRecord = employee;
  applyResolvedIdentity(employee);
  renderEmployeeRecord(employee);
}

// EMPLOYEE ASSIGNED MANAGERS VISIBILITY - STEP 1
// Load only reporting managers belonging to the currently signed-in employee.
//
// Security:
// - Supabase resolves the employee from auth.uid()/authenticated email;
// - the RPC enforces employee + tenant scope;
// - no direct employee_reporting_lines read is performed here;
// - this is display-only and cannot modify manager assignments.
async function loadEmployeeReportingManagers() {
  const list = state.dom.employeeReportingManagersList;
  const loading = state.dom.employeeReportingManagersLoading;
  const empty = state.dom.employeeReportingManagersEmpty;

  if (!list || !loading || !empty) return;

  loading.classList.remove("d-none");
  empty.classList.add("d-none");
  list.classList.add("d-none");
  list.innerHTML = "";

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc(
      "get_employee_reporting_manager_assignments",
    );

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];

    // Keep the resolved manager list available to Employee Profile rendering
    // without introducing any write or authority behaviour.
    state.reportingManagers = rows;

    renderEmployeeReportingManagers(rows);
  } catch (error) {
    console.error(
      "Error loading employee reporting managers:",
      error,
    );

    state.reportingManagers = [];

    loading.classList.add("d-none");
    list.classList.add("d-none");
    empty.classList.remove("d-none");

    empty.textContent =
      "Your reporting managers could not be loaded right now.";
  }
}


// EMPLOYEE ASSIGNED MANAGERS VISIBILITY - STEP 1
// Render authoritative reporting relationships in Primary-first order.
// No buttons or mutation controls are intentionally included.
function renderEmployeeReportingManagers(reportingManagers = []) {
  const list = state.dom.employeeReportingManagersList;
  const loading = state.dom.employeeReportingManagersLoading;
  const empty = state.dom.employeeReportingManagersEmpty;

  if (!list || !loading || !empty) return;

  const rows = Array.isArray(reportingManagers)
    ? [...reportingManagers]
    : [];

  rows.sort((left, right) => {
    const leftType = normalizeText(left?.manager_type);
    const rightType = normalizeText(right?.manager_type);

    const priority = {
      primary: 1,
      secondary: 2,
    };

    return (
      (priority[leftType] || 3) -
      (priority[rightType] || 3)
    );
  });

  loading.classList.add("d-none");
  list.innerHTML = "";

  if (!rows.length) {
    list.classList.add("d-none");
    empty.classList.remove("d-none");
    empty.textContent =
      "No active reporting managers are currently assigned.";
    return;
  }

  empty.classList.add("d-none");
  list.classList.remove("d-none");

  rows.forEach((manager) => {
    const managerType =
      normalizeText(manager.manager_type) === "primary"
        ? "Primary Manager"
        : "Secondary Manager";

    const fullName =
      [
        manager.manager_first_name,
        manager.manager_last_name,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ") ||
      manager.manager_work_email ||
      "Manager";

    const jobTitle =
      String(manager.manager_job_title || "").trim();

    const department =
      String(manager.manager_department || "").trim();

    const workEmail =
      String(manager.manager_work_email || "").trim();

    const relationshipTone =
      managerType === "Primary Manager"
        ? "bexhr-status-pill--success"
        : "bexhr-status-pill--neutral";

    const item = document.createElement("article");

    item.className =
      "border rounded-4 bg-light p-3";

    item.innerHTML = `
      <div
        class="d-flex flex-column flex-md-row justify-content-between align-items-md-start gap-3"
      >
        <div class="d-flex align-items-start gap-3 min-w-0">
          <span
            class="rounded-circle bg-white border d-inline-flex align-items-center justify-content-center flex-shrink-0"
            style="width: 42px; height: 42px;"
            aria-hidden="true"
          >
            <i class="bi bi-person-badge"></i>
          </span>

          <div class="min-w-0">
            <div class="fw-semibold">
              ${escapeHtml(fullName)}
            </div>

            ${jobTitle
        ? `
                  <div class="small text-secondary mt-1">
                    ${escapeHtml(jobTitle)}
                  </div>
                `
        : ""
      }

            ${department
        ? `
                  <div class="small text-secondary">
                    ${escapeHtml(department)}
                  </div>
                `
        : ""
      }

            ${workEmail
        ? `
                  <div class="small mt-2">
                    <i
                      class="bi bi-envelope me-1 text-secondary"
                      aria-hidden="true"
                    ></i>
                    ${escapeHtml(workEmail)}
                  </div>
                `
        : ""
      }
          </div>
        </div>

        <span
          class="bexhr-status-pill ${relationshipTone} flex-shrink-0"
        >
          <i
            class="bi ${managerType === "Primary Manager"
        ? "bi-person-check-fill"
        : "bi-people-fill"
      }"
            aria-hidden="true"
          ></i>

          <span>${escapeHtml(managerType)}</span>
        </span>
      </div>
    `;

    list.appendChild(item);
  });
}

function getEmployeeManagerDisplayName(employee) {
  return (
    employee.manager_name ||
    employee.line_manager_name ||
    employee.line_manager ||
    employee.supervisor_name ||
    employee.reporting_manager ||
    employee.manager_email ||
    employee.line_manager_email ||
    employee.supervisor_email ||
    "--"
  );
}

function getEmployeeIdDisplayValue(employee) {
  return (
    employee.employee_id ||
    employee.staff_id ||
    employee.employee_number ||
    employee.payroll_number ||
    "--"
  );
}

function getEmployeePhoneDisplayValue(employee) {
  return (
    employee.phone_number ||
    employee.phone ||
    employee.mobile ||
    employee.mobile_phone ||
    employee.work_phone ||
    ""
  );
}

// EMPLOYEE PROFILE REVIEW - STEP 1A
// Standard display fallback for read-only HR profile review fields.
function getEmployeeProfileReviewValue(value) {
  const cleanValue = String(value || "").trim();
  return cleanValue || "--";
}

// EMPLOYEE PROFILE REVIEW - STEP 1A
// Build the full HR-held name including middle name where HR has recorded it.
function getEmployeeHrFullName(employee = {}) {
  return [
    employee.first_name,
    employee.middle_name,
    employee.last_name,
  ]
    .map((namePart) => String(namePart || "").trim())
    .filter(Boolean)
    .join(" ") || "Employee";
}

// EMPLOYEE PROFILE REVIEW - STEP 1A
// NIN is sensitive. Show only the last four digits in Employee Self Service.
function getMaskedEmployeeNin(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "--";

  if (digits.length <= 4) {
    return `\u2022\u2022\u2022\u2022${digits}`;
  }

  return `\u2022\u2022\u2022\u2022\u2022\u2022\u2022${digits.slice(-4)}`;
}

// EMPLOYEE PROFILE REVIEW - STEP 1A
// Safe setter for read-only input fields.
function setEmployeeProfileReviewField(field, value) {
  if (!field) return;
  field.value = getEmployeeProfileReviewValue(value);
}

// EMPLOYEE PROFILE REVIEW - STEP 1A
// Render HR-prepared employee data for employee review. This is display-only.
function renderEmployeeHrProfileReview(employee = {}) {
  setEmployeeProfileReviewField(
    state.dom.reviewEmployeeNumber,
    getEmployeeIdDisplayValue(employee),
  );

  setEmployeeProfileReviewField(
    state.dom.reviewFullName,
    getEmployeeHrFullName(employee),
  );

  setEmployeeProfileReviewField(
    state.dom.reviewPersonalEmail,
    employee.personal_email,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewAlternativePhone,
    employee.alternative_phone_number,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewDateOfBirth,
    employee.date_of_birth ? formatDate(employee.date_of_birth) : "",
  );

  setEmployeeProfileReviewField(
    state.dom.reviewGender,
    employee.gender || employee.sex,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewMaritalStatus,
    employee.marital_status,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewNationality,
    employee.nationality,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewStateOfOrigin,
    employee.state_of_origin,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewLga,
    employee.local_government_area,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewTown,
    employee.town,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewMeansOfIdentification,
    employee.means_of_identification,
  );

  // EMPLOYEE PROFILE REVIEW - STEP 1A FIX
  // HR saves Issuing State / Authority as identification_issue_state.
  // Keep identification_issuing_state as a fallback in case older records
  // or schema variants still use that property name.
  setEmployeeProfileReviewField(
    state.dom.reviewIssuingAuthority,
    employee.identification_issue_state || employee.identification_issuing_state,
  );

  setEmployeeProfileReviewField(
    state.dom.reviewNin,
    getMaskedEmployeeNin(employee.nin),
  );
  // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
  // Keep the correction field picker aligned with the latest HR-held values.
  populateEmployeeProfileCorrectionFieldOptions();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Build the list of HR-held fields that employees can flag for HR review.
// NIN is shown only as the masked display value; the full NIN is never copied
// into the correction request snapshot.
function getEmployeeProfileCorrectionFieldOptions(employee = state.employeeRecord || {}) {
  return [
    {
      category: "core",
      categoryLabel: "Core Details",
      fieldKey: "employee_number",
      fieldLabel: "Employee Number",
      currentValue: getEmployeeIdDisplayValue(employee),
    },
    {
      category: "core",
      categoryLabel: "Core Details",
      fieldKey: "full_name",
      fieldLabel: "Full Name Held by HR",
      currentValue: getEmployeeHrFullName(employee),
    },
    {
      category: "core",
      categoryLabel: "Core Details",
      fieldKey: "personal_email",
      fieldLabel: "Personal Email",
      currentValue: employee.personal_email,
    },
    {
      category: "core",
      categoryLabel: "Core Details",
      fieldKey: "alternative_phone_number",
      fieldLabel: "Alternative Phone Number",
      currentValue: employee.alternative_phone_number,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "date_of_birth",
      fieldLabel: "Date of Birth",
      currentValue: employee.date_of_birth ? formatDate(employee.date_of_birth) : "",
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "gender",
      fieldLabel: "Sex / Gender",
      currentValue: employee.gender || employee.sex,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "marital_status",
      fieldLabel: "Marital Status",
      currentValue: employee.marital_status,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "nationality",
      fieldLabel: "Nationality",
      currentValue: employee.nationality,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "state_of_origin",
      fieldLabel: "State of Origin",
      currentValue: employee.state_of_origin,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "local_government_area",
      fieldLabel: "Local Government Area",
      currentValue: employee.local_government_area,
    },
    {
      category: "personal_origin",
      categoryLabel: "Personal & Origin",
      fieldKey: "town",
      fieldLabel: "Town / Village / Community",
      currentValue: employee.town,
    },
    {
      category: "identity",
      categoryLabel: "Identity",
      fieldKey: "means_of_identification",
      fieldLabel: "Means of Identification",
      currentValue: employee.means_of_identification,
    },
    {
      category: "identity",
      categoryLabel: "Identity",
      fieldKey: "identification_issue_state",
      fieldLabel: "Issuing State / Authority",
      currentValue: employee.identification_issue_state || employee.identification_issuing_state,
    },
    {
      category: "identity",
      categoryLabel: "Identity",
      fieldKey: "nin",
      fieldLabel: "NIN",
      currentValue: getMaskedEmployeeNin(employee.nin),
    },
  ];
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Rebuild the correction field dropdown from the current signed-in employee record.
function populateEmployeeProfileCorrectionFieldOptions() {
  const select = state.dom.profileCorrectionFieldKey;
  if (!select) return;

  const currentValue = String(select.value || "").trim();
  const fieldOptions = getEmployeeProfileCorrectionFieldOptions();

  select.innerHTML = '<option value="">Select field</option>';

  fieldOptions.forEach((field) => {
    const option = document.createElement("option");
    option.value = field.fieldKey;
    option.textContent = `${field.categoryLabel} - ${field.fieldLabel}`;
    select.appendChild(option);
  });

  if (
    currentValue &&
    fieldOptions.some((field) => field.fieldKey === currentValue)
  ) {
    select.value = currentValue;
  }

  syncEmployeeProfileCorrectionCurrentValue();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Resolve the selected correction field and its display-safe current value.
function getSelectedEmployeeProfileCorrectionField() {
  const selectedKey = String(state.dom.profileCorrectionFieldKey?.value || "").trim();

  if (!selectedKey) return null;

  return getEmployeeProfileCorrectionFieldOptions().find(
    (field) => field.fieldKey === selectedKey,
  ) || null;
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Keep the read-only current value aligned with the selected field.
function syncEmployeeProfileCorrectionCurrentValue() {
  const selectedField = getSelectedEmployeeProfileCorrectionField();

  if (state.dom.profileCorrectionCurrentValue) {
    state.dom.profileCorrectionCurrentValue.value = getEmployeeProfileReviewValue(
      selectedField?.currentValue,
    );
  }

  updateEmployeeProfileCorrectionSubmitButtonState();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Show/hide the request panel without changing any HR-held employee data.
function setEmployeeProfileCorrectionPanelVisible(shouldShow) {
  const panel = state.dom.profileCorrectionRequestPanel;
  if (!panel) return;

  panel.classList.toggle("d-none", !shouldShow);

  if (shouldShow) {
    populateEmployeeProfileCorrectionFieldOptions();

    window.setTimeout(() => {
      panel.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 50);
  }
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Inline status helper for correction request feedback.
function setEmployeeProfileCorrectionRequestStatus(type = "info", message = "") {
  const status = state.dom.profileCorrectionRequestStatus;
  if (!status) return;

  const cleanType = ["success", "info", "warning", "danger"].includes(type)
    ? type
    : "info";

  status.className = `alert alert-${cleanType} border mb-0`;
  status.innerHTML = message;
  status.classList.toggle("d-none", !message);
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// The employee must select a field and provide a reason.
// Suggested correction remains optional so sensitive fields can be flagged
// without forcing employees to type sensitive values into the request.
function updateEmployeeProfileCorrectionSubmitButtonState() {
  const button = state.dom.submitProfileCorrectionRequestBtn;
  if (!button) return;

  const hasField = Boolean(String(state.dom.profileCorrectionFieldKey?.value || "").trim());
  const hasReason = Boolean(String(state.dom.profileCorrectionReason?.value || "").trim());
  const isLoading = button.dataset.loading === "true";

  const canSubmit = hasField && hasReason && !isLoading;

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Reset only the correction request form and status.
// This does not touch the read-only HR Profile Review fields.
function resetEmployeeProfileCorrectionRequestForm({ hidePanel = false } = {}) {
  state.dom.profileCorrectionRequestForm?.reset();

  if (state.dom.profileCorrectionCurrentValue) {
    state.dom.profileCorrectionCurrentValue.value = "";
  }

  state.dom.profileCorrectionFieldKey?.classList.remove("is-invalid");
  state.dom.profileCorrectionReason?.classList.remove("is-invalid");

  setEmployeeProfileCorrectionRequestStatus("info", "");

  if (hidePanel) {
    setEmployeeProfileCorrectionPanelVisible(false);
  } else {
    populateEmployeeProfileCorrectionFieldOptions();
  }

  updateEmployeeProfileCorrectionSubmitButtonState();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Loading state for the correction request submit button.
function setEmployeeProfileCorrectionSubmitLoading(isLoading) {
  const button = state.dom.submitProfileCorrectionRequestBtn;
  if (!button) return;

  button.dataset.loading = String(isLoading);
  button.disabled = isLoading;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Submitting Request...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  delete button.dataset.loading;
  updateEmployeeProfileCorrectionSubmitButtonState();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Normalise correction request statuses from HR and Employee workflows.
function normalizeEmployeeProfileCorrectionStatus(status = "") {
  return String(status || "Pending")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Employee-friendly status labels.
function formatEmployeeProfileCorrectionStatus(status = "") {
  const cleanStatus = normalizeEmployeeProfileCorrectionStatus(status);

  if (cleanStatus === "pending") return "Pending Review";
  if (cleanStatus === "in review") return "In Review";
  if (cleanStatus === "approved") return "Approved";
  if (cleanStatus === "rejected") return "Rejected";
  if (cleanStatus === "completed") return "Completed";
  if (cleanStatus === "closed") return "Closed";

  return status || "Pending Review";
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Status colour mapping for the employee request history cards.
function getEmployeeProfileCorrectionStatusBadgeClass(status = "") {
  const cleanStatus = normalizeEmployeeProfileCorrectionStatus(status);

  if (cleanStatus === "pending") return "text-bg-warning";
  if (cleanStatus === "in review") return "text-bg-primary";
  if (cleanStatus === "approved") return "text-bg-info";
  if (cleanStatus === "completed") return "text-bg-success";
  if (cleanStatus === "rejected") return "text-bg-danger";
  if (cleanStatus === "closed") return "text-bg-secondary";

  return "text-bg-light border text-dark";
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Explain each HR lifecycle status in employee-friendly language.
function getEmployeeProfileCorrectionStatusMessage(status = "") {
  const cleanStatus = normalizeEmployeeProfileCorrectionStatus(status);

  if (cleanStatus === "pending") {
    return "Your request has been submitted and is waiting for HR review.";
  }

  if (cleanStatus === "in review") {
    return "HR is reviewing your request.";
  }

  if (cleanStatus === "approved") {
    return "HR has accepted the request. The employee record may still need to be updated manually by HR.";
  }

  if (cleanStatus === "rejected") {
    return "HR has rejected the request. Review the HR response where provided.";
  }

  if (cleanStatus === "completed") {
    return "HR has completed the request. Review your profile information and contact HR if anything still looks incorrect.";
  }

  return "Request status is available for review.";
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// HR response/comment may exist under different names while the schema settles.
// Keep this defensive so old rows do not break the employee dashboard.
function getEmployeeProfileCorrectionHrResponse(record = {}) {
  return String(
    record.hr_response ||
    record.hr_comment ||
    record.hr_response_comment ||
    record.review_comment ||
    record.review_notes ||
    "",
  ).trim();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Keep active/newer requests first so employees see the most relevant status.
function sortEmployeeProfileCorrectionRequests(records = []) {
  return [...records].sort((a, b) => {
    const aTime = new Date(a.created_at || a.updated_at || 0).getTime() || 0;
    const bTime = new Date(b.created_at || b.updated_at || 0).getTime() || 0;

    return bTime - aTime;
  });
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Loading state for the employee-side correction request history.
function renderEmployeeProfileCorrectionRequestHistoryLoadingState() {
  const list = state.dom.profileCorrectionRequestHistoryList;
  if (!list) return;

  state.dom.profileCorrectionRequestHistoryEmptyState?.classList.add("d-none");
  list.classList.remove("d-none");

  list.innerHTML = `
    <div class="alert alert-light border mb-0">
      Loading your correction request status.
    </div>
  `;
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Render employee-visible request status history.
// This is read-only: no employee record and no HR decision record is changed here.
function renderEmployeeProfileCorrectionRequestHistory(records = []) {
  const list = state.dom.profileCorrectionRequestHistoryList;
  if (!list) return;

  const requests = sortEmployeeProfileCorrectionRequests(records);

  list.innerHTML = "";

  if (!requests.length) {
    state.dom.profileCorrectionRequestHistoryEmptyState?.classList.remove("d-none");
    list.classList.add("d-none");
    return;
  }

  state.dom.profileCorrectionRequestHistoryEmptyState?.classList.add("d-none");
  list.classList.remove("d-none");

  requests.forEach((request) => {
    const status = request.status || "Pending";
    const statusLabel = formatEmployeeProfileCorrectionStatus(status);
    const statusMessage = getEmployeeProfileCorrectionStatusMessage(status);
    const statusBadgeClass = getEmployeeProfileCorrectionStatusBadgeClass(status);

    const fieldLabel = String(request.field_label || request.field_key || "Profile Field").trim();
    const currentValue = String(request.current_value_snapshot || "").trim() || "--";
    const requestedValue = String(request.requested_value || "").trim() || "Not provided";
    const reason = String(request.reason || "").trim() || "--";
    const hrResponse = getEmployeeProfileCorrectionHrResponse(request);

    const submittedAt = formatDateTime(request.created_at || request.updated_at);
    const reviewedAt = request.reviewed_at
      ? formatDateTime(request.reviewed_at)
      : "--";

    const hrResponseHtml = hrResponse
      ? `
        <div class="alert alert-light border mt-3 mb-0">
          <div class="small fw-semibold mb-1">HR Response</div>
          <div class="small text-secondary">${escapeHtml(hrResponse)}</div>
        </div>
      `
      : `
        <div class="alert alert-light border mt-3 mb-0">
          <div class="small fw-semibold mb-1">HR Response</div>
          <div class="small text-secondary">No HR response has been added yet.</div>
        </div>
      `;

    const item = document.createElement("div");
    item.className = "border rounded-4 p-3 bg-light-subtle";

    item.innerHTML = `
      <div class="d-flex flex-column flex-lg-row justify-content-between gap-3 mb-3">
        <div>
          <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
            <span class="badge ${statusBadgeClass}">
              ${escapeHtml(statusLabel)}
            </span>

            <span class="fw-semibold">
              ${escapeHtml(fieldLabel)}
            </span>
          </div>

          <div class="small text-secondary">
            ${escapeHtml(statusMessage)}
          </div>
        </div>

        <div class="text-lg-end small">
          <div class="text-secondary">Submitted</div>
          <div class="fw-semibold">${escapeHtml(submittedAt)}</div>
        </div>
      </div>

      <div class="row g-2">
        <div class="col-12 col-lg-4">
          <div class="bg-white border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Current Value</div>
            <div class="small fw-semibold">${escapeHtml(currentValue)}</div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="bg-white border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Suggested Correction</div>
            <div class="small fw-semibold">${escapeHtml(requestedValue)}</div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="bg-white border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Last HR Review</div>
            <div class="small fw-semibold">${escapeHtml(reviewedAt)}</div>
          </div>
        </div>
      </div>

      <div class="mt-3">
        <div class="small fw-semibold mb-1">Employee Reason</div>
        <div class="small text-secondary">${escapeHtml(reason)}</div>
      </div>

      ${hrResponseHtml}
    `;

    list.appendChild(item);
  });
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Load only the signed-in employee's own correction requests.
async function loadEmployeeProfileCorrectionRequests() {
  const employee = state.employeeRecord || {};
  const list = state.dom.profileCorrectionRequestHistoryList;

  if (!list) return;

  if (!employee.id || !employee.tenant_id) {
    state.profileCorrectionRequests = [];
    renderEmployeeProfileCorrectionRequestHistory([]);
    renderEmployeeOverviewMetrics();
    return;
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("employee_profile_correction_requests")
    .select("*")
    .eq("tenant_id", employee.tenant_id)
    .eq("employee_id", employee.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  state.profileCorrectionRequests = Array.isArray(data) ? data : [];
  renderEmployeeProfileCorrectionRequestHistory(
    state.profileCorrectionRequests,
  );
  renderEmployeeOverviewMetrics();
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
// Manual refresh for employee-side request status.
async function refreshEmployeeProfileCorrectionRequestHistory() {
  const button = state.dom.refreshProfileCorrectionRequestHistoryBtn;
  const startedAt = Date.now();

  try {
    setRefreshButtonLoading(button, true);
    renderEmployeeProfileCorrectionRequestHistoryLoadingState();

    await waitForNextPaint();
    await loadEmployeeProfileCorrectionRequests();

    clearPageAlert();
    showPageAlert("success", "Profile correction request status refreshed successfully.");
  } catch (error) {
    console.error("Error refreshing employee correction request history:", error);

    state.profileCorrectionRequests = [];
    renderEmployeeProfileCorrectionRequestHistory([]);

    showPageAlert(
      "danger",
      error.message || "Unable to refresh profile correction request status.",
    );
  } finally {
    const elapsed = Date.now() - startedAt;
    const remainingDelay = Math.max(0, 400 - elapsed);

    window.setTimeout(() => {
      setRefreshButtonLoading(button, false);
    }, remainingDelay);
  }
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Save a formal correction request to Supabase.
// Employees do not edit employees.* directly; HR reviews this request later.
async function handleEmployeeProfileCorrectionRequestSubmit(event) {
  event.preventDefault();

  const selectedField = getSelectedEmployeeProfileCorrectionField();
  const employee = state.employeeRecord || {};
  const reason = String(state.dom.profileCorrectionReason?.value || "").trim();
  const requestedValue = String(state.dom.profileCorrectionRequestedValue?.value || "").trim();

  state.dom.profileCorrectionFieldKey?.classList.toggle("is-invalid", !selectedField);
  state.dom.profileCorrectionReason?.classList.toggle("is-invalid", !reason);

  if (!selectedField || !reason) {
    setEmployeeProfileCorrectionRequestStatus(
      "warning",
      "Select the field to correct and provide a reason before submitting.",
    );
    updateEmployeeProfileCorrectionSubmitButtonState();
    return;
  }

  if (!employee.id || !employee.tenant_id || !state.currentUser?.id) {
    setEmployeeProfileCorrectionRequestStatus(
      "danger",
      "Your employee profile link is incomplete. Please sign out, sign in again, and try submitting the request.",
    );
    return;
  }

  const payload = {
    tenant_id: employee.tenant_id,
    employee_id: employee.id,
    requested_by: state.currentUser.id,
    request_category: selectedField.category,
    field_key: selectedField.fieldKey,
    field_label: selectedField.fieldLabel,
    current_value_snapshot: getEmployeeProfileReviewValue(selectedField.currentValue),
    requested_value: requestedValue || null,
    reason,
    status: "Pending",
  };

  const startedAt = Date.now();

  try {
    setEmployeeProfileCorrectionSubmitLoading(true);
    setEmployeeProfileCorrectionRequestStatus("info", "");

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("employee_profile_correction_requests")
      .insert(payload);

    if (error) throw error;

    resetEmployeeProfileCorrectionRequestForm();

    setEmployeeProfileCorrectionRequestStatus(
      "success",
      `Correction request submitted for <strong>${escapeHtml(selectedField.fieldLabel)}</strong>. HR will review it from the HR dashboard.`,
    );

    if (typeof showDashboardToast === "function") {
      showDashboardToast(
        "success",
        "Correction request submitted",
        `${selectedField.fieldLabel} has been sent to HR for review.`,
      );
    }

    // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
    // Immediately refresh the employee-side request history so the employee
    // can see the new Pending Review request without leaving the page.
    try {
      await loadEmployeeProfileCorrectionRequests();
    } catch (refreshError) {
      console.warn("Correction request history refresh failed after submit:", refreshError);
    }
  } catch (error) {
    console.error("Error submitting employee profile correction request:", error);

    const errorText = `${error.code || ""} ${error.message || ""}`.toLowerCase();
    const isDuplicateActiveRequest =
      error.code === "23505" ||
      errorText.includes("duplicate key value") ||
      errorText.includes("uq_employee_profile_correction_requests_active_field");

    if (isDuplicateActiveRequest) {
      setEmployeeProfileCorrectionRequestStatus(
        "warning",
        "You already have an active correction request for this field. HR must review or close the existing request before another one can be submitted.",
      );
      return;
    }

    setEmployeeProfileCorrectionRequestStatus(
      "danger",
      escapeHtml(error.message || "Correction request could not be submitted."),
    );
  } finally {
    const elapsed = Date.now() - startedAt;
    const remainingDelay = Math.max(0, 500 - elapsed);

    window.setTimeout(() => {
      setEmployeeProfileCorrectionSubmitLoading(false);
    }, remainingDelay);
  }
}

// EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 2B
// Bind correction request UI events once on page startup.
function bindEmployeeProfileCorrectionRequestEvents() {
  state.dom.openProfileCorrectionRequestBtn?.addEventListener("click", () => {
    setEmployeeProfileCorrectionPanelVisible(true);
  });

  // EMPLOYEE PROFILE CORRECTION REQUESTS - STEP 1D
  // Let employees manually refresh their own HR correction request status.
  state.dom.refreshProfileCorrectionRequestHistoryBtn?.addEventListener("click", async () => {
    await refreshEmployeeProfileCorrectionRequestHistory();
  });

  state.dom.profileCorrectionFieldKey?.addEventListener("change", () => {
    syncEmployeeProfileCorrectionCurrentValue();
  });

  state.dom.profileCorrectionRequestedValue?.addEventListener("input", () => {
    updateEmployeeProfileCorrectionSubmitButtonState();
  });

  state.dom.profileCorrectionReason?.addEventListener("input", () => {
    state.dom.profileCorrectionReason?.classList.remove("is-invalid");
    updateEmployeeProfileCorrectionSubmitButtonState();
  });

  state.dom.profileCorrectionRequestForm?.addEventListener(
    "submit",
    handleEmployeeProfileCorrectionRequestSubmit,
  );
}

/* =========================================================
   EMPLOYEE OVERVIEW LIVE METRICS - v1.0.0

   Uses only state already loaded for the signed-in employee:
   - employeeRecord;
   - profileCorrectionRequests;
   - leaveRequests;
   - payrollRecords.

   This does not query Supabase, broaden employee identity matching,
   change tenant filtering, alter payroll authorisation, or mutate data.
   ========================================================= */

function renderEmployeeOverviewMetrics() {
  const employee = state.employeeRecord || null;

  const correctionRequests = Array.isArray(
    state.profileCorrectionRequests,
  )
    ? state.profileCorrectionRequests
    : [];

  const leaveRequests = Array.isArray(state.leaveRequests)
    ? state.leaveRequests
    : [];

  const payrollRecords = Array.isArray(state.payrollRecords)
    ? state.payrollRecords
    : [];

  /* Profile status reflects whether the signed-in user resolved to an
     employee record. It does not infer HR approval or data completeness. */
  if (state.dom.overviewProfileStatus) {
    state.dom.overviewProfileStatus.textContent = employee
      ? "Available"
      : "Unavailable";
  }

  /* Open means HR work has not reached a terminal outcome.
     Approved remains open until HR completes or closes the request. */
  const terminalCorrectionStatuses = new Set([
    "completed",
    "closed",
    "rejected",
  ]);

  const openCorrectionRequestCount = correctionRequests.filter(
    (request) => {
      const status = normalizeEmployeeProfileCorrectionStatus(
        request?.status || "Pending",
      );

      return !terminalCorrectionStatuses.has(status);
    },
  ).length;

  if (state.dom.overviewOpenRequestCount) {
    state.dom.overviewOpenRequestCount.textContent = String(
      openCorrectionRequestCount,
    );
  }

  /* The card label says Leave Requests and its supporting copy says
     submitted activity, so show the employee's complete loaded history. */
  if (state.dom.overviewLeaveRequestCount) {
    state.dom.overviewLeaveRequestCount.textContent = String(
      leaveRequests.length,
    );
  }

  /* loadEmployeePayroll already restricts this state to Authorised and
     finalised records ordered by descending pay date. */
  const latestPayrollRecord = payrollRecords[0] || null;

  if (state.dom.overviewLatestPayCycle) {
    state.dom.overviewLatestPayCycle.textContent = String(
      latestPayrollRecord?.pay_cycle || "--",
    ).trim();
  }
}

function renderEmployeeRecord(employee) {
  const firstName = employee.first_name || "";
  const lastName = employee.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim() || "Employee";

  const email =
    employee.work_email ||
    employee.email ||
    state.currentProfile?.email ||
    state.currentUser?.email ||
    "";

  const phone = getEmployeePhoneDisplayValue(employee);
  const role = employee.role || state.currentProfile?.role || "Employee";
  const department = employee.department || "--";
  const employeeId = getEmployeeIdDisplayValue(employee);
  const managerName = getEmployeeManagerDisplayName(employee);
  const jobTitle = employee.job_title || employee.position || role || "Employee";

  if (state.dom.employeeDisplayEmail) {
    state.dom.employeeDisplayEmail.textContent = email || "No email";
  }


  // EMPLOYEE HEADER IDENTITY BINDING - v1.0.0
  if (state.dom.employeeModernUserName) {
    state.dom.employeeModernUserName.textContent = fullName;
  }

  // EMPLOYEE OVERVIEW PERSONAL WELCOME - v1.0.0
  if (state.dom.overviewWelcomeName) {
    state.dom.overviewWelcomeName.textContent =
      String(firstName || fullName || "Employee").trim();
  }

  if (state.dom.heroRoleValue) {
    state.dom.heroRoleValue.textContent = String(role || "employee").toLowerCase();
  }

  if (state.dom.employeeInitials) {
    const initials =
      `${(firstName || "").charAt(0)}${(lastName || "").charAt(0)}`.trim() ||
      "EM";
    state.dom.employeeInitials.textContent = initials.toUpperCase();
  }

  if (state.dom.profileFullName) {
    state.dom.profileFullName.textContent = fullName;
  }

  if (state.dom.profileJobTitle) {
    state.dom.profileJobTitle.textContent = jobTitle;
  }

  if (state.dom.profileDepartment) {
    state.dom.profileDepartment.textContent = `Department: ${department}`;
  }

  if (state.dom.profileEmployeeId) {
    state.dom.profileEmployeeId.textContent = `Employee ID: ${employeeId}`;
  }

  if (state.dom.firstName) state.dom.firstName.value = firstName;
  if (state.dom.lastName) state.dom.lastName.value = lastName;
  if (state.dom.emailAddress) state.dom.emailAddress.value = email;
  if (state.dom.phoneNumber) state.dom.phoneNumber.value = phone;
  if (state.dom.roleName) state.dom.roleName.value = role;
  if (state.dom.managerName) state.dom.managerName.value = managerName;

  // EMPLOYEE PROFILE REVIEW - STEP 1A
  // Populate the extended read-only HR profile review block.
  renderEmployeeHrProfileReview(employee);

  renderEmployeeOverviewMetrics();
}

/* =========================================================
   Profile image
========================================================= */
async function loadLatestEmployeeProfile() {
  if (!state.currentUser?.id) return state.currentProfile;

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", state.currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      state.currentProfile = data;
    }

    return state.currentProfile;
  } catch (error) {
    console.error("Error loading latest employee profile:", error);
    return state.currentProfile;
  }
}

async function getSignedProfileImageUrl(filePath) {
  if (!filePath) return null;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error("Error creating signed profile image URL:", error);
    return null;
  }
}

async function renderEmployeeProfileImage() {
  const profileImageElement = state.dom.profileImage;
  const heroImageElement = state.dom.employeeHeroImage;
  const initialsElement = state.dom.employeeInitials;

  if (!profileImageElement) return;

  const initialsText = initialsElement?.textContent || "EMP";
  const fallbackImageUrl = `https://placehold.co/120x120?text=${encodeURIComponent(
    initialsText,
  )}`;

  const imagePath = state.currentProfile?.profile_image_path || "";

  if (state.dom.removeProfileImageBtn) {
    state.dom.removeProfileImageBtn.disabled = !imagePath;
  }

  if (!imagePath) {
    profileImageElement.src = fallbackImageUrl;

    if (heroImageElement) {
      heroImageElement.src = "";
      heroImageElement.classList.add("d-none");
    }

    if (initialsElement) {
      initialsElement.classList.remove("d-none");
    }

    return;
  }

  const signedUrl = await getSignedProfileImageUrl(imagePath);

  if (!signedUrl) {
    profileImageElement.src = fallbackImageUrl;

    if (heroImageElement) {
      heroImageElement.src = "";
      heroImageElement.classList.add("d-none");
    }

    if (initialsElement) {
      initialsElement.classList.remove("d-none");
    }

    return;
  }

  profileImageElement.src = signedUrl;

  if (heroImageElement) {
    heroImageElement.src = signedUrl;
    heroImageElement.classList.remove("d-none");
  }

  if (initialsElement) {
    initialsElement.classList.add("d-none");
  }
}

// EMPLOYEE UI CLEANUP - STEP 1J
// The upload button should behave like the admin profile upload:
// grey/disabled when no valid image is ready, active only after file selection.
function updateProfileImageUploadButtonState() {
  const button = state.dom.saveProfileImageBtn;
  if (!button) return;

  const hasPendingImage = Boolean(state.pendingProfileImageFile);

  button.disabled = !hasPendingImage;
  button.classList.toggle("profile-upload-empty", !hasPendingImage);
}

function handlePendingProfileImage(file) {
  state.pendingProfileImageFile = null;
  updateProfileImageUploadButtonState();

  if (!file) {
    void renderEmployeeProfileImage();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    updateProfileImageUploadButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    updateProfileImageUploadButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateProfileImageUploadButtonState();

  const reader = new FileReader();
  reader.onload = () => {
    if (state.dom.profileImage) {
      state.dom.profileImage.src = reader.result;
    }

    if (state.dom.employeeHeroImage) {
      state.dom.employeeHeroImage.src = reader.result;
      state.dom.employeeHeroImage.classList.remove("d-none");
    }

    if (state.dom.employeeInitials) {
      state.dom.employeeInitials.classList.add("d-none");
    }
  };

  reader.readAsDataURL(file);
}

function setProfileImageUploadLoading(isLoading) {
  const button = state.dom.saveProfileImageBtn;
  if (!button) return;

  button.disabled = isLoading || !state.pendingProfileImageFile;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Uploading...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  updateProfileImageUploadButtonState();
}

async function uploadEmployeeProfileImage() {
  if (!state.pendingProfileImageFile) {
    showPageAlert("warning", "Please choose an image before uploading.");
    return;
  }

  if (!state.currentUser?.id) {
    showPageAlert("danger", "No active employee session found.");
    return;
  }

  try {
    setProfileImageUploadLoading(true);

    const supabase = getSupabaseClient();
    const file = state.pendingProfileImageFile;
    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const filePath = `${state.currentUser.id}/profile-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("profiles")
      .update({
        profile_image_path: filePath,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      profile_image_path: filePath,
    };

    await loadLatestEmployeeProfile();

    state.pendingProfileImageFile = null;

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    // EMPLOYEE UI CLEANUP - STEP 1J
    // After successful upload, no file is pending anymore, so the button
    // returns to the grey disabled state.
    updateProfileImageUploadButtonState();

    await renderEmployeeProfileImage();
    showPageAlert("success", "Profile picture uploaded successfully.");
  } catch (error) {
    console.error("Error uploading employee profile image:", error);
    showPageAlert(
      "danger",
      error.message || "Profile picture could not be uploaded.",
    );
  } finally {
    setProfileImageUploadLoading(false);
  }
}

async function removeEmployeeProfileImage() {
  if (!state.currentUser?.id) {
    showPageAlert("danger", "No active employee session found.");
    return;
  }

  const existingImagePath = String(
    state.currentProfile?.profile_image_path || "",
  ).trim();

  if (!existingImagePath) {
    await renderEmployeeProfileImage();
    return;
  }

  const button = state.dom.removeProfileImageBtn;
  const originalHtml = button?.innerHTML || "";

  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `
        <span
          class="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        ></span>
        Removing...
      `;
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({
        profile_image_path: null,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      profile_image_path: "",
    };

    state.pendingProfileImageFile = null;

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    updateProfileImageUploadButtonState();
    await renderEmployeeProfileImage();

    const { error: storageError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .remove([existingImagePath]);

    if (storageError) {
      console.warn(
        "Profile image reference was cleared, but storage cleanup failed:",
        storageError,
      );
    }

    showPageAlert("success", "Profile picture removed successfully.");
  } catch (error) {
    console.error("Error removing employee profile image:", error);

    showPageAlert(
      "danger",
      error.message || "Profile picture could not be removed.",
    );
  } finally {
    if (button) {
      button.innerHTML = originalHtml;
    }

    await renderEmployeeProfileImage();
  }
}
/* =========================================================
   Leave balances
========================================================= */
async function loadEmployeeLeaveBalances() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    // EMPLOYEE UI CLEANUP - STEP 1L-A
    // Leave Balances should clear its own view when no employee identity
    // is available. Do not touch payroll records from the leave module.
    renderLeaveBalances([]);
    return;
  }

  let query = supabase.from("employee_leave_balances").select(`
      id,
      employee_id,
      entitled_days,
      used_days,
      remaining_days,
leave_types (
  id,
  code,
  name,
  eligibility_rule
)
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading leave balances:", error);
    showPageAlert("danger", "Unable to load leave balances.");
    return;
  }

  const balances = Array.isArray(data)
    ? data.filter(
      (balance, index, array) =>
        array.findIndex((item) => item.id === balance.id) === index,
    )
    : [];

  renderLeaveBalances(balances);
}

function renderLeaveBalances(balances) {
  const grid = state.dom.leaveBalancesGrid;
  if (!grid) return;

  grid.innerHTML = "";

  // LEAVE BALANCE ELIGIBILITY VISIBILITY - STEP 1E
  // Balance cards must follow the same gender eligibility rule as the
  // Request Leave dropdown. The database can keep all balance rows for audit
  // and future profile changes, but employees should only see currently
  // applicable leave types in self-service.
  const visibleBalances = (Array.isArray(balances) ? balances : []).filter((balance) =>
    isLeaveTypeVisibleForEmployeeProfile(balance.leave_types || {}),
  );

  if (!visibleBalances.length) {
    state.dom.leaveBalancesEmptyState?.classList.remove("d-none");
    state.dom.leaveBalancesGrid?.classList.add("d-none");
    return;
  }

  state.dom.leaveBalancesEmptyState?.classList.add("d-none");
  state.dom.leaveBalancesGrid?.classList.remove("d-none");

  visibleBalances.forEach((balance) => {
    const leaveTypeName = balance.leave_types?.name || "Unknown Leave Type";

    const entitledDays = Number(balance.entitled_days || 0);
    const usedDays = Number(balance.used_days || 0);
    const remainingDays = Number(balance.remaining_days || 0);

    const usedPercent =
      entitledDays > 0
        ? Math.min(100, Math.max(0, (usedDays / entitledDays) * 100))
        : 0;

    const remainingPercent =
      entitledDays > 0
        ? Math.min(100, Math.max(0, (remainingDays / entitledDays) * 100))
        : 0;

    const statusClass =
      remainingDays <= 0
        ? "text-bg-danger"
        : remainingPercent <= 25
          ? "text-bg-warning"
          : "text-bg-success";

    const statusLabel =
      remainingDays <= 0
        ? "Fully Used"
        : remainingPercent <= 25
          ? "Low Balance"
          : "Available";

    const progressClass =
      remainingDays <= 0
        ? "bg-danger"
        : remainingPercent <= 25
          ? "bg-warning"
          : "bg-success";

    const card = document.createElement("div");
    card.className = "col-12 col-md-6 col-xl-4";

    // EMPLOYEE UI CLEANUP - STEP 1L-B
    // HR-style leave balance card:
    // - Clear leave type header
    // - Availability status badge
    // - Entitled / Used / Remaining hierarchy
    // - Progress bar showing used entitlement
    // This changes presentation only; leave balance data is not mutated.
    card.innerHTML = `
      <div class="info-tile h-100">
        <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <div class="info-tile-label mb-1">Leave Type</div>
            <div class="info-tile-value">
              ${escapeHtml(leaveTypeName)}
            </div>
          </div>

          ${renderEmployeeModernLeaveStatusPill(statusLabel)}
        </div>

        <div class="row g-3 mb-3">
          <div class="col-4">
            <div class="info-tile-label mb-1">Entitled</div>
            <div class="fw-bold">${entitledDays}</div>
          </div>

          <div class="col-4">
            <div class="info-tile-label mb-1">Used</div>
            <div class="fw-bold">${usedDays}</div>
          </div>

          <div class="col-4">
            <div class="info-tile-label mb-1">Remaining</div>
            <div class="fw-bold">${remainingDays}</div>
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-1">
          <div class="small text-secondary">Used entitlement</div>
          <div class="small fw-semibold">${usedPercent.toFixed(0)}%</div>
        </div>

        <div class="progress" style="height: 8px;">
          <div
            class="progress-bar ${progressClass}"
            role="progressbar"
            style="width: ${usedPercent.toFixed(0)}%;"
            aria-valuenow="${usedPercent.toFixed(0)}"
            aria-valuemin="0"
            aria-valuemax="100">
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

/* =========================================================
   Leave request form
========================================================= */

function bindLeaveFormEvents() {
  // EMPLOYEE UI CLEANUP - STEP 1P-F FIX
  // Keep the submit button grey/disabled until the leave request form is
  // ready. This mirrors the existing profile upload empty-button behaviour.
  state.dom.leaveType?.addEventListener("change", () => {
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.startDate?.addEventListener("change", () => {
    calculateLeaveDays();
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.endDate?.addEventListener("change", () => {
    calculateLeaveDays();
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.leaveReason?.addEventListener("input", updateLeaveSubmitButtonState);

  state.dom.leaveRequestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleLeaveRequestSubmit();
  });

  updateLeaveSubmitButtonState();
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// The leave submit button should behave like the existing grey/active
// profile upload button: inactive when the form is incomplete, active when
// the employee has completed all required fields.
function isLeaveRequestFormReadyForSubmission() {
  const leaveType = state.dom.leaveType?.value?.trim();
  const startDate = state.dom.startDate?.value;
  const endDate = state.dom.endDate?.value;
  const reason = state.dom.leaveReason?.value?.trim();
  const totalDays = Number(state.dom.totalDays?.value || 0);

  if (!leaveType || !startDate || !endDate || !reason || totalDays < 1) {
    return false;
  }

  if (new Date(endDate) < new Date(startDate)) {
    return false;
  }

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1A
  // Keep the Submit button disabled when the selected leave type is
  // blocked for the selected leave year.
  return !getLeaveRequestPolicyBlock();
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// Empty form = grey disabled button.
// Completed required fields = blue active button.
// This is UI state only; validation and save logic still run on submit.
function updateLeaveSubmitButtonState() {
  const button = state.dom.submitLeaveBtn;
  if (!button) return;

  const isReady = isLeaveRequestFormReadyForSubmission();

  button.disabled = !isReady;

  button.classList.toggle("btn-secondary", !isReady);
  button.classList.toggle("btn-primary", isReady);
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Resolve the currently selected Leave Type without changing the dropdown.
function getSelectedLeaveTypeDetails() {
  const select = state.dom.leaveType;
  const selectedOption = select?.selectedOptions?.[0];

  return {
    id: String(select?.value || "").trim(),
    name: String(selectedOption?.textContent || "").trim(),
    code: String(selectedOption?.dataset?.code || "").trim(),

    // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
    // Eligibility is configured in leave_types. This keeps maternity/paternity
    // controls data-driven instead of hardcoded against leave names only.
    eligibilityRule: String(
      selectedOption?.dataset?.eligibilityRule || "all_employees",
    ).trim(),
  };
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Single-application leave types are blocked for the same leave year
// when an active request already exists.
function isSingleApplicationLeaveType(leaveType = {}) {
  const searchableValue = normalizeText(
    `${leaveType.name || ""} ${leaveType.code || ""}`,
  );

  return SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS.some((keyword) =>
    searchableValue.includes(keyword),
  );
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Use the selected first day of leave to determine the leave year.
function getSelectedLeaveRequestYear() {
  const startDateValue = String(state.dom.startDate?.value || "").trim();

  if (!startDateValue) return null;

  const startDate = new Date(startDateValue);

  if (Number.isNaN(startDate.getTime())) return null;

  return startDate.getFullYear();
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Detect whether an existing request touches the selected leave year.
function doesLeaveRequestTouchYear(request = {}, leaveYear) {
  if (!leaveYear) return false;

  const yearStart = new Date(leaveYear, 0, 1);
  const yearEnd = new Date(leaveYear, 11, 31, 23, 59, 59, 999);

  const requestStart = new Date(request.start_date || "");
  const requestEnd = new Date(request.end_date || request.start_date || "");

  if (
    Number.isNaN(requestStart.getTime()) ||
    Number.isNaN(requestEnd.getTime())
  ) {
    return false;
  }

  return requestStart <= yearEnd && requestEnd >= yearStart;
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Main HR policy guard:
// 1. Block any overlapping Pending/Approved leave period.
// 2. Also block duplicate single-application leave types in the same year.
// Rejected and Returned requests do not block a fresh request.
function getLeaveRequestPolicyBlock() {
  const selectedLeaveType = getSelectedLeaveTypeDetails();
  const leaveYear = getSelectedLeaveRequestYear();

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
  // Eligibility is checked before date-overlap and duplicate checks, because
  // an ineligible leave type should be blocked as soon as it is selected.
  const eligibilityBlock = getLeaveTypeEligibilityBlock(selectedLeaveType);

  if (eligibilityBlock) {
    return eligibilityBlock;
  }

  const startDateValue = String(state.dom.startDate?.value || "").trim();
  const endDateValue = String(state.dom.endDate?.value || "").trim();

  const selectedStartDate = new Date(startDateValue || "");
  const selectedEndDate = new Date(endDateValue || startDateValue || "");

  const hasValidSelectedDateRange =
    startDateValue &&
    endDateValue &&
    !Number.isNaN(selectedStartDate.getTime()) &&
    !Number.isNaN(selectedEndDate.getTime()) &&
    selectedEndDate >= selectedStartDate;

  const blockingStatuses = new Set([
    "approved",
    "pending approval",
  ]);

  const activeRequests = (state.leaveRequests || []).filter((request) =>
    blockingStatuses.has(normalizeText(request.status || "")),
  );

  if (hasValidSelectedDateRange) {
    const overlappingRequest = activeRequests.find((request) => {
      const requestStartDate = new Date(request.start_date || "");
      const requestEndDate = new Date(request.end_date || request.start_date || "");

      if (
        Number.isNaN(requestStartDate.getTime()) ||
        Number.isNaN(requestEndDate.getTime())
      ) {
        return false;
      }

      return selectedStartDate <= requestEndDate && selectedEndDate >= requestStartDate;
    });

    if (overlappingRequest) {
      const existingLeaveTypeName =
        overlappingRequest.leave_types?.name || "leave request";

      const existingStatusLabel =
        overlappingRequest.status || "active";

      const existingRequestPeriod =
        `${formatDate(overlappingRequest.start_date)} to ${formatDate(overlappingRequest.end_date)}`;

      const selectedRequestPeriod =
        `${formatDate(startDateValue)} to ${formatDate(endDateValue)}`;

      const sameLeaveType =
        String(overlappingRequest.leave_type_id || "").trim() === selectedLeaveType.id ||
        normalizeText(existingLeaveTypeName) === normalizeText(selectedLeaveType.name);

      return {
        message: sameLeaveType
          ? `${selectedLeaveType.name || "This leave type"} already has a ${existingStatusLabel} request covering ${existingRequestPeriod}. Wait for the manager decision or contact HR if this request needs to be amended.`
          : `The selected dates (${selectedRequestPeriod}) overlap with an existing ${existingStatusLabel} ${existingLeaveTypeName} request covering ${existingRequestPeriod}. Please choose different dates or contact HR if the existing request needs to be changed.`,
      };
    }
  }

  if (!selectedLeaveType.id || !leaveYear) return null;

  if (!isSingleApplicationLeaveType(selectedLeaveType)) {
    return null;
  }

  const existingRequest = activeRequests.find((request) => {
    const sameLeaveType =
      String(request.leave_type_id || "").trim() === selectedLeaveType.id ||
      normalizeText(request.leave_types?.name || "") ===
      normalizeText(selectedLeaveType.name);

    if (!sameLeaveType) return false;

    return doesLeaveRequestTouchYear(request, leaveYear);
  });

  if (!existingRequest) return null;

  const statusLabel = existingRequest.status || "recorded";
  const requestPeriod =
    `${formatDate(existingRequest.start_date)} to ${formatDate(existingRequest.end_date)}`;

  return {
    message:
      `${selectedLeaveType.name || "This leave type"} already has a ${statusLabel} request for ${leaveYear}. ` +
      `Existing request period: ${requestPeriod}. Contact HR if this relates to a different qualifying event.`,
  };
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
// Normalise employee gender values from HR master data.
// This avoids brittle comparisons if the stored value is "Male", "male", "M",
// "Female", "female", or "F".
function getNormalisedEmployeeGenderForLeaveEligibility() {
  const rawGender = normalizeText(
    state.employeeRecord?.gender ||
    state.employeeRecord?.sex ||
    state.employeeRecord?.gender_identity ||
    "",
  );

  if (["female", "f", "woman"].includes(rawGender)) {
    return "female";
  }

  if (["male", "m", "man"].includes(rawGender)) {
    return "male";
  }

  return "";
}

// LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
// Hide gender-specific leave types from the Request Leave dropdown when
// the signed-in employee profile is not eligible.
//
// HR behaviour:
// - Female employees see Maternity Leave, not Paternity Leave.
// - Male employees see Paternity Leave, not Maternity Leave.
// - Unknown/blank gender does not show gender-specific leave until HR fixes
//   the employee profile, avoiding a misleading request option.
function isLeaveTypeVisibleForEmployeeProfile(leaveType = {}) {
  const eligibilityRule = normalizeText(
    leaveType.eligibility_rule ||
    leaveType.eligibilityRule ||
    "all_employees",
  );

  if (eligibilityRule === "all_employees" || eligibilityRule === "hr_review_only") {
    return true;
  }

  const employeeGender = getNormalisedEmployeeGenderForLeaveEligibility();

  if (!employeeGender && (eligibilityRule === "female_only" || eligibilityRule === "male_only")) {
    return false;
  }

  if (eligibilityRule === "female_only") {
    return employeeGender === "female";
  }

  if (eligibilityRule === "male_only") {
    return employeeGender === "male";
  }

  return true;
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
// HR-facing leave eligibility guard.
// Keep the employee message neutral and professional. Do not expose sensitive
// or embarrassing wording such as "male employees cannot apply for maternity".
function getLeaveTypeEligibilityBlock(leaveType = {}) {
  if (!leaveType.id) return null;

  const eligibilityRule = normalizeText(
    leaveType.eligibilityRule || "all_employees",
  );

  if (eligibilityRule === "all_employees") {
    return null;
  }

  if (eligibilityRule === "hr_review_only") {
    return {
      message:
        `${leaveType.name || "This leave type"} requires HR review before it can be requested through Employee Self Service. Please contact HR for support.`,
    };
  }

  const employeeGender = getNormalisedEmployeeGenderForLeaveEligibility();

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
  // If HR profile gender cannot be resolved, do not falsely say the leave is
  // unavailable. Tell the employee the profile could not be verified.
  if (!employeeGender && (eligibilityRule === "female_only" || eligibilityRule === "male_only")) {
    return {
      message:
        `${leaveType.name || "This leave type"} eligibility could not be verified from your employee profile. Please contact HR to check your profile details.`,
    };
  }

  if (eligibilityRule === "female_only" && employeeGender === "female") {
    return null;
  }

  if (eligibilityRule === "male_only" && employeeGender === "male") {
    return null;
  }

  if (eligibilityRule === "female_only" || eligibilityRule === "male_only") {
    return {
      message:
        `${leaveType.name || "This leave type"} is not available for your employee profile. Please contact HR if this is incorrect or requires special handling.`,
    };
  }

  return null;
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Show or hide the in-form block notice without touching page layout.
function updateLeaveRequestBlockNotice() {
  const notice = state.dom.leaveRequestBlockNotice;
  if (!notice) return;

  const block = getLeaveRequestPolicyBlock();

  if (!block) {
    notice.classList.add("d-none");
    notice.textContent = "";
    return;
  }

  notice.className = "alert alert-warning border mt-3 mb-0";
  notice.innerHTML = `
    <div class="fw-semibold mb-1">Leave request blocked</div>
    <div class="small">
      ${escapeHtml(block.message)}
    </div>
  `;
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// Restores the leave type loader that is still called during employee
// dashboard initialisation. This only repopulates the Leave Type dropdown;
// it does not change submit validation, button state, or leave saving logic.
async function loadLeaveTypes() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("leave_types")
    .select("id, code, name, eligibility_rule")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error loading leave types:", error);
    showPageAlert("danger", "Unable to load leave types.");
    return;
  }

  if (!state.dom.leaveType) return;

  state.dom.leaveType.innerHTML = `<option value="">Select leave type</option>`;

  // LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
  // Only show leave types the signed-in employee can actually request.
  // The existing policy block remains as a defensive guard.
  (data || []).filter(isLeaveTypeVisibleForEmployeeProfile).forEach((leaveType) => {
    const option = document.createElement("option");
    option.value = leaveType.id;
    option.textContent = leaveType.name;
    option.dataset.code = leaveType.code;

    // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
    // Store the configured eligibility rule on the option so the existing
    // form policy guard can block ineligible leave before submission.
    option.dataset.eligibilityRule =
      leaveType.eligibility_rule || "all_employees";

    state.dom.leaveType.appendChild(option);
  });

  updateLeaveSubmitButtonState();
}

function calculateLeaveDays() {
  const startDateValue = state.dom.startDate.value;
  const endDateValue = state.dom.endDate.value;

  if (!startDateValue || !endDateValue) {
    state.dom.totalDays.value = "";
    return;
  }

  const startDate = new Date(startDateValue);
  const endDate = new Date(endDateValue);

  if (endDate < startDate) {
    state.dom.totalDays.value = "";
    return;
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const differenceInMilliseconds = endDate - startDate;
  const totalDays =
    Math.floor(differenceInMilliseconds / millisecondsPerDay) + 1;

  state.dom.totalDays.value = totalDays;
}

function validateLeaveRequestForm() {
  let isValid = true;

  const leaveType = state.dom.leaveType.value.trim();
  const startDate = state.dom.startDate.value;
  const endDate = state.dom.endDate.value;
  const reason = state.dom.leaveReason.value.trim();
  const totalDays = Number(state.dom.totalDays.value);

  [
    state.dom.leaveType,
    state.dom.startDate,
    state.dom.endDate,
    state.dom.leaveReason,
  ].forEach((field) => field?.classList.remove("is-invalid"));

  if (!leaveType) {
    state.dom.leaveType.classList.add("is-invalid");
    isValid = false;
  }

  if (!startDate) {
    state.dom.startDate.classList.add("is-invalid");
    isValid = false;
  }

  if (!endDate) {
    state.dom.endDate.classList.add("is-invalid");
    isValid = false;
  }

  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    state.dom.endDate.classList.add("is-invalid");
    showPageAlert("warning", "End date cannot be earlier than start date.");
    isValid = false;
  }

  if (!reason) {
    state.dom.leaveReason.classList.add("is-invalid");
    isValid = false;
  }

  if (!totalDays || totalDays < 1) {
    showPageAlert("warning", "Total leave days must be at least 1.");
    isValid = false;
  }

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Final submit guard. This protects against direct submit even if
  // button state has not refreshed yet.
  const policyBlock = getLeaveRequestPolicyBlock();

  if (policyBlock) {
    state.dom.leaveType?.classList.add("is-invalid");
    updateLeaveRequestBlockNotice();
    showPageAlert("warning", policyBlock.message);
    isValid = false;
  }

  return isValid;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C-FIX B
// Resubmit through a controlled Supabase RPC instead of a direct table update.
// The function validates ownership, returned status, dates, days, and reason
// before moving the same leave request row back to Pending Approval.
async function resubmitReturnedLeaveRequest(payload = {}) {
  const amendmentRequest = getReturnedLeaveAmendmentRequest();

  if (!amendmentRequest) {
    throw new Error(
      "Returned leave request could not be resolved for resubmission. Please refresh leave history and try again.",
    );
  }

  if (!isReturnedLeaveRequest(amendmentRequest)) {
    throw new Error(
      "Only returned leave requests can be edited and resubmitted.",
    );
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc(
    "resubmit_returned_leave_request",
    {
      p_leave_request_id: amendmentRequest.id,
      p_leave_type_id: payload.leave_type_id,
      p_start_date: payload.start_date,
      p_end_date: payload.end_date,
      p_total_days: payload.total_days,
      p_reason: payload.reason,
    },
  );

  if (error) throw error;

  const updatedRequest = Array.isArray(data) ? data[0] : data;

  if (!updatedRequest) {
    throw new Error(
      "Returned leave request was not resubmitted. Please refresh leave history and try again.",
    );
  }

  if (normalizeText(updatedRequest.status) !== "pending approval") {
    throw new Error(
      `Returned leave request resubmission verification failed. Expected Pending Approval but Supabase returned ${updatedRequest.status || "--"}.`,
    );
  }

  return updatedRequest;
}

async function handleLeaveRequestSubmit() {
  clearPageAlert();

  if (!state.currentUser) {
    showPageAlert("danger", "No active user session found.");
    return;
  }

  calculateLeaveDays();

  if (!validateLeaveRequestForm()) {
    return;
  }

  const supabase = getSupabaseClient();

  const payload = {
    employee_id: getPreferredEmployeeReferenceId(),
    leave_type_id: state.dom.leaveType.value,
    start_date: state.dom.startDate.value,
    end_date: state.dom.endDate.value,
    total_days: Number(state.dom.totalDays.value),
    reason: state.dom.leaveReason.value.trim(),
    status: "Pending Approval",
  };

  const isReturnedResubmission = Boolean(state.returnedLeaveAmendmentRequestId);

  try {
    setLeaveSubmitLoading(true);

    if (isReturnedResubmission) {
      await resubmitReturnedLeaveRequest(payload);
    } else {
      const { error } = await supabase.from("leave_requests").insert([payload]);

      if (error) {
        throw error;
      }
    }

    const successMessage = isReturnedResubmission
      ? "Returned leave request updated and resubmitted for manager review."
      : "Leave request submitted successfully and saved with Pending Approval status.";

    showPageAlert("success", successMessage);

    showEmployeeDashboardToast(
      "success",
      isReturnedResubmission ? "Leave request resubmitted" : "Leave request submitted",
      isReturnedResubmission
        ? "Your returned leave request was updated and sent back for manager review."
        : "Your leave request was submitted successfully and is pending manager review.",
    );

    clearReturnedLeaveAmendmentMode();

    state.dom.leaveRequestForm.reset();
    state.dom.totalDays.value = "";
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();

    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();

    // EMPLOYEE LEAVE POST-SUBMIT UX - STEP 1H-A
    // After a successful leave submission, open My Leave History so the
    // employee can immediately see the new Pending Approval record.
    // This changes only post-submit visibility; it does not change leave
    // saving, manager approval, balance calculation, or payroll behaviour.
    showSection("leave");
    setEmployeeLeaveHistoryCardExpanded(true);

    // EMPLOYEE LEAVE POST-SUBMIT UX - STEP 1H-A
    // Reuse the existing desktop height-sync listener after the card opens,
    // so Request Leave and My Leave History stay aligned.
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  } catch (error) {
    console.error("Error submitting leave request:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to submit leave request. Please try again.",
    );
  } finally {
    setLeaveSubmitLoading(false);
  }
}

function setLeaveSubmitLoading(isLoading) {
  const button = state.dom.submitLeaveBtn;
  if (!button) return;

  button.disabled = isLoading;

  if (isLoading) {
    button.classList.remove("btn-secondary");
    button.classList.add("btn-primary");

    const loadingLabel = state.returnedLeaveAmendmentRequestId
      ? "Resubmitting for approval..."
      : "Submitting for approval...";

    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      ${loadingLabel}
    `;
  } else {
    button.innerHTML = getLeaveSubmitButtonDefaultHtml();

    updateLeaveSubmitButtonState();
  }
}

/* =========================================================
   Leave history + decision updates
========================================================= */
async function loadEmployeeLeaveRequests() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    state.leaveRequests = [];
    renderEmployeeOverviewMetrics();
    renderLeaveRequests([]);
    renderLatestDecisionCard([]);
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
    return;
  }

  let query = supabase.from("leave_requests").select(`
      id,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      total_days,
      reason,
      status,
      submitted_at,
      decision_at,
      decision_by,
      decision_by_name,
      decision_comment,
      cancelled_at,
      cancelled_by,
      cancelled_by_name,
      cancellation_reason,
      cancelled_from_status,
      balance_restored_at,
      balance_restored_days,
      leave_types (
        name
      )
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query.order("submitted_at", {
    ascending: false,
  });

  if (error) {
    console.error("Error loading leave requests:", error);
    showPageAlert("danger", "Unable to load leave history.");
    return;
  }

  const requests = Array.isArray(data)
    ? data.filter(
      (request, index, array) =>
        array.findIndex((item) => item.id === request.id) === index,
    )
    : [];

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Keep loaded leave requests available to the Request Leave form.
  state.leaveRequests = requests;
  renderEmployeeOverviewMetrics();

  renderLeaveRequests(requests);
  renderLatestDecisionCard(requests);
  updateLeaveRequestBlockNotice();
  updateLeaveSubmitButtonState();
}

// EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
// Cancelled leave is HR reversal/audit information, not a normal manager
// decision comment. These helpers keep employee-facing wording accurate
// across Latest Leave Decision and My Leave History.
function isCancelledLeaveRequestAudit(request = {}) {
  return normalizeText(request.status) === "cancelled" || Boolean(request.cancelled_at);
}

function getCancelledLeaveActionDate(request = {}) {
  return formatDateTime(request.cancelled_at || request.decision_at || request.submitted_at);
}

function getCancelledLeaveActionBy(request = {}) {
  return (
    request.cancelled_by_name ||
    request.cancelled_by ||
    "HR"
  );
}

// EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A-FIX 1
// Show the HR capacity beside the cancelling user's name.
// The name identifies who performed the action; "Cancelled by HR" explains
// the authority/context of the action to the employee.
function buildCancelledLeaveActionByHtml(request = {}, options = {}) {
  const compact = Boolean(options.compact);
  const nameClass = compact ? "fw-semibold small" : "fw-semibold";

  return `
    <div class="${nameClass}">
      ${escapeHtml(getCancelledLeaveActionBy(request))}
    </div>
    <div class="text-secondary small mt-1">
      Cancelled by HR
    </div>
  `;
}

function getCancelledLeaveReason(request = {}) {
  return String(request.cancellation_reason || "").trim() || "No cancellation reason recorded.";
}

function getCancelledLeaveBalanceRestoredLabel(request = {}) {
  const restoredDays = Number(request.balance_restored_days || 0);

  if (!Number.isFinite(restoredDays) || restoredDays <= 0) {
    return "Not recorded";
  }

  return `${restoredDays} day(s)`;
}

function getOriginalManagerDecisionLabel(request = {}) {
  const originalStatus = request.cancelled_from_status || "Approved";
  const managerName = request.decision_by_name || "Manager / Supervisor";
  const decisionDate = request.decision_at ? formatDateTime(request.decision_at) : "";

  return decisionDate
    ? `${originalStatus} by ${managerName} on ${decisionDate}`
    : `${originalStatus} by ${managerName}`;
}

function buildEmployeeLeaveHistoryAuditHtml(request = {}) {
  if (isCancelledLeaveRequestAudit(request)) {
    return `
      <!-- EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
           HR cancellation gets its own employee-facing audit labels.
           Do not show cancellation reason as a manager comment. -->
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <div class="bg-light border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Cancellation Date</div>
            <div class="fw-semibold">${escapeHtml(getCancelledLeaveActionDate(request))}</div>
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-light border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Cancelled By</div>
            ${buildCancelledLeaveActionByHtml(request)}
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-light border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Balance Restored</div>
            <div class="fw-semibold">${escapeHtml(getCancelledLeaveBalanceRestoredLabel(request))}</div>
          </div>
        </div>

        <div class="col-12">
          <div class="bg-light border rounded-3 p-2 h-100">
            <div class="small text-secondary mb-1">Cancellation Reason</div>
            <div class="fw-semibold">${escapeHtml(getCancelledLeaveReason(request))}</div>
          </div>
        </div>

        <div class="col-12">
          <div class="small text-secondary">
            Original manager decision: ${escapeHtml(getOriginalManagerDecisionLabel(request))}
          </div>
        </div>
      </div>
    `;
  }

  const decisionAt = formatDateTime(request.decision_at);
  const comment = request.decision_comment || "No comment provided.";
  const normalizedStatus = normalizeText(request.status || "");

  const decisionLabel =
    request.decision_at ||
      normalizedStatus === "approved" ||
      normalizedStatus === "rejected" ||
      normalizedStatus === "returned for clarification" ||
      normalizedStatus === "returned"
      ? decisionAt
      : "Awaiting decision";

  return `
    <div class="row g-3">
      <div class="col-12 col-md-6">
        <div class="bg-light border rounded-3 p-2 h-100">
          <div class="small text-secondary mb-1">Decision Date</div>
          <div class="fw-semibold">${escapeHtml(decisionLabel)}</div>
        </div>
      </div>

      <div class="col-12 col-md-6">
        <div class="bg-light border rounded-3 p-2 h-100">
          <div class="small text-secondary mb-1">Manager Comment</div>
          <div class="fw-semibold">${escapeHtml(comment)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderLeaveRequests(requests) {
  const list = state.dom.leaveRequestsList;
  if (!list) return;

  list.innerHTML = "";

  if (!requests.length) {
    state.dom.leaveRequestsEmptyState?.classList.remove("d-none");
    state.dom.leaveRequestsList?.classList.add("d-none");
    return;
  }

  state.dom.leaveRequestsEmptyState?.classList.add("d-none");
  state.dom.leaveRequestsList?.classList.remove("d-none");

  requests.forEach((request) => {
    const leaveTypeName = request.leave_types?.name || "Unknown Leave Type";
    const statusText = request.status || "Pending Approval";
    const normalizedStatus = normalizeText(statusText);
    const statusBadgeClass = getDecisionStatusBadgeClass(statusText);

    const startDate = formatDate(request.start_date);
    const endDate = formatDate(request.end_date);
    const totalDays = Number(request.total_days || 0);
    const submittedAt = formatDateTime(request.submitted_at);
    // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
    // Cancelled records use HR cancellation audit display, not manager-comment display.
    const isCancelledAudit = isCancelledLeaveRequestAudit(request);

    const toneClass =
      isCancelledAudit
        ? "border-secondary"
        : normalizedStatus === "approved"
          ? "border-success"
          : normalizedStatus === "rejected"
            ? "border-danger"
            : normalizedStatus === "returned for clarification" ||
              normalizedStatus === "returned"
              ? "border-warning"
              : "border-secondary";

    const iconClass =
      isCancelledAudit
        ? "bi-x-octagon-fill text-secondary"
        : normalizedStatus === "approved"
          ? "bi-check-circle-fill text-success"
          : normalizedStatus === "rejected"
            ? "bi-x-circle-fill text-danger"
            : normalizedStatus === "returned for clarification" ||
              normalizedStatus === "returned"
              ? "bi-exclamation-circle-fill text-warning"
              : "bi-hourglass-split text-secondary";

    // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
    // Returned requests should be amendable by the employee. Other statuses
    // remain read-only to protect approved, rejected, and pending workflows.
    const canEditAndResubmit = isReturnedLeaveRequest(request);

    const editAndResubmitActionHtml = canEditAndResubmit
      ? `
        <div class="d-flex justify-content-end border-top mt-3 pt-3">
          <button
            type="button"
            class="btn btn-sm btn-outline-primary dashboard-action-btn edit-returned-leave-request-btn"
            data-leave-request-id="${escapeHtml(request.id)}"
            title="Edit and resubmit this returned leave request"
            aria-label="Edit and resubmit this returned leave request">
            <i class="bi bi-arrow-repeat me-2"></i>Edit & Resubmit
          </button>
        </div>
      `
      : "";

    const item = document.createElement("div");
    item.className = "mb-2";

    // EMPLOYEE UI CLEANUP - STEP 1O-A
    // Employee-friendly request history card.
    // This replaces the table row layout only; no leave request data is changed.
    item.innerHTML = `
            <div class="border rounded-3 bg-white p-3">
               <div class="d-flex flex-column flex-lg-row justify-content-between gap-2 mb-2">
          <div class="d-flex align-items-start gap-3">
                        <div class="fs-6 lh-1">
              <i class="bi ${iconClass}"></i>
            </div>

            <div>
              <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                ${renderEmployeeModernLeaveStatusPill(statusText)}
                <span class="fw-semibold">
                  ${escapeHtml(leaveTypeName)}
                </span>
              </div>

              <div class="small text-secondary lh-sm">
                ${escapeHtml(startDate)} to ${escapeHtml(endDate)} &bull; ${totalDays} day(s)
              </div>
            </div>
          </div>

          <div class="text-lg-end">
            <div class="small text-secondary">Submitted</div>
            <div class="fw-semibold small">${escapeHtml(submittedAt)}</div>
          </div>
        </div>

        ${buildEmployeeLeaveHistoryAuditHtml(request)}

        ${editAndResubmitActionHtml}
      </div>
    `;

    list.appendChild(item);
    // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
    // Wire the returned-request amendment action after the card is rendered.
    item
      .querySelector(".edit-returned-leave-request-btn")
      ?.addEventListener("click", () => {
        startReturnedLeaveAmendment(request.id);
      });
  });
}

function renderLatestDecisionCard(requests) {
  const decisionItems = requests
    .filter((item) => {
      const status = normalizeText(item.status);

      return (
        isCancelledLeaveRequestAudit(item) ||
        !!item.decision_at ||
        status === "approved" ||
        status === "rejected" ||
        status === "returned" ||
        status === "returned for clarification"
      );
    })
    .sort((a, b) => {
      const aValue = a.cancelled_at || a.decision_at || a.submitted_at || "";
      const bValue = b.cancelled_at || b.decision_at || b.submitted_at || "";
      return new Date(bValue) - new Date(aValue);
    });

  if (!decisionItems.length) {
    state.dom.latestDecisionEmptyState?.classList.remove("d-none");
    state.dom.latestDecisionCard?.classList.add("d-none");
    return;
  }

  const latest = decisionItems[0];
  const leaveTypeName = latest.leave_types?.name || "Unknown Leave Type";
  const statusText = latest.status || "Decision Recorded";
  const normalizedStatus = normalizeText(statusText);
  const isCancelledAudit = isCancelledLeaveRequestAudit(latest);

  const actionDate = isCancelledAudit
    ? getCancelledLeaveActionDate(latest)
    : formatDateTime(latest.decision_at || latest.submitted_at);

  const requestedPeriod = `${formatDate(latest.start_date)} to ${formatDate(
    latest.end_date,
  )}`;

  const totalDays = Number(latest.total_days || 0);

  const actionBy = isCancelledAudit
    ? getCancelledLeaveActionBy(latest)
    : latest.decision_by_name || "Manager / Supervisor";

  const actionByLabel = isCancelledAudit ? "Cancelled By" : "Decision By";
  const noteLabel = isCancelledAudit ? "Cancellation Reason" : "Manager Comment";

  const noteText = isCancelledAudit
    ? getCancelledLeaveReason(latest)
    : latest.decision_comment || "No comment provided.";

  const statusBadgeClass = getDecisionStatusBadgeClass(statusText);

  const outcomeTone =
    isCancelledAudit
      ? "border-secondary bg-light"
      : normalizedStatus === "approved"
        ? "border-success bg-success-subtle"
        : normalizedStatus === "rejected"
          ? "border-danger bg-danger-subtle"
          : normalizedStatus === "returned for clarification" ||
            normalizedStatus === "returned"
            ? "border-warning bg-warning-subtle"
            : "border-secondary bg-light";

  const outcomeIcon =
    isCancelledAudit
      ? "bi-x-octagon-fill text-secondary"
      : normalizedStatus === "approved"
        ? "bi-check-circle-fill text-success"
        : normalizedStatus === "rejected"
          ? "bi-x-circle-fill text-danger"
          : normalizedStatus === "returned for clarification" ||
            normalizedStatus === "returned"
            ? "bi-exclamation-circle-fill text-warning"
            : "bi-info-circle-fill text-secondary";

  const cancellationAuditHtml = isCancelledAudit
    ? `
      <!-- EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
           Show the original manager approval separately from HR cancellation. -->
      <div class="row g-3 mb-4">
        <div class="col-12 col-md-6">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Balance Restored</div>
            <div class="fw-semibold">${escapeHtml(getCancelledLeaveBalanceRestoredLabel(latest))}</div>
          </div>
        </div>

        <div class="col-12 col-md-6">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Original Manager Decision</div>
            <div class="fw-semibold">${escapeHtml(getOriginalManagerDecisionLabel(latest))}</div>
          </div>
        </div>
      </div>
    `
    : "";

  state.dom.latestDecisionEmptyState?.classList.add("d-none");
  state.dom.latestDecisionCard?.classList.remove("d-none");

  state.dom.latestDecisionCard.innerHTML = `
    <div class="info-tile border-start border-4 ${outcomeTone}">
      <div class="d-flex flex-column flex-lg-row justify-content-between gap-3 mb-4">
        <div class="d-flex align-items-start gap-3">
          <div class="fs-4 lh-1">
            <i class="bi ${outcomeIcon}"></i>
          </div>

          <div>
            <div class="info-tile-label mb-1">
              ${isCancelledAudit ? "Latest Leave Update" : "Latest Decision"}
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2">
              ${renderEmployeeModernLeaveStatusPill(statusText)}
              <span class="fw-semibold">
                ${escapeHtml(leaveTypeName)}
              </span>
            </div>
          </div>
        </div>

        <div class="text-lg-end">
          <div class="info-tile-label mb-1">
            ${isCancelledAudit ? "Cancellation Date & Time" : "Decision Date & Time"}
          </div>
          <div class="fw-semibold">${escapeHtml(actionDate)}</div>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Requested Period</div>
            <div class="fw-semibold">${escapeHtml(requestedPeriod)}</div>
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Total Days</div>
            <div class="fw-semibold">${totalDays} day(s)</div>
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
<div class="info-tile-label mb-1">${escapeHtml(actionByLabel)}</div>
${isCancelledAudit
      ? buildCancelledLeaveActionByHtml(latest)
      : `<div class="fw-semibold">${escapeHtml(actionBy)}</div>`
    }
          </div>
        </div>
      </div>

      ${cancellationAuditHtml}

      <div class="bg-white border rounded-3 p-3">
        <div class="info-tile-label mb-1">${escapeHtml(noteLabel)}</div>
        <div class="fw-semibold">${escapeHtml(noteText)}</div>
      </div>
    </div>
  `;
}

/* =========================================================
   Employee payroll figure privacy
========================================================= */
function readStoredEmployeePayrollFigureVisibility() {
  try {
    return (
      window.localStorage.getItem(EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY) ===
      "true"
    );
  } catch (error) {
    console.warn("Unable to read payroll figure visibility preference:", error);
    return false;
  }
}

function saveEmployeePayrollFigureVisibility(shouldHide) {
  try {
    window.localStorage.setItem(
      EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY,
      shouldHide ? "true" : "false",
    );
  } catch (error) {
    console.warn("Unable to save payroll figure visibility preference:", error);
  }
}

function restoreEmployeePayrollFigureVisibility() {
  state.isPayrollFiguresHidden = readStoredEmployeePayrollFigureVisibility();
  updateEmployeePayrollFigureVisibilityButton();
}

function setEmployeePayrollFiguresHidden(shouldHide, shouldPersist = false) {
  state.isPayrollFiguresHidden = Boolean(shouldHide);

  if (shouldPersist) {
    saveEmployeePayrollFigureVisibility(state.isPayrollFiguresHidden);
  }

  updateEmployeePayrollFigureVisibilityButton();

  // EMPLOYEE PAYROLL PRIVACY - STEP 1H
  // Re-render summary values only. This does not reload, recalculate,
  // mutate, or save any payroll data.
  renderCurrentPayrollSummary(state.payrollRecords || []);
}

function updateEmployeePayrollFigureVisibilityButton() {
  const button = state.dom.togglePayrollFiguresBtn;
  if (!button) return;

  const icon = button.querySelector("i");

  const buttonLabel = state.isPayrollFiguresHidden
    ? "Show payroll figures"
    : "Hide payroll figures";

  button.setAttribute("aria-pressed", String(state.isPayrollFiguresHidden));
  button.setAttribute("aria-label", buttonLabel);
  button.title = buttonLabel;

  if (icon) {
    icon.className = state.isPayrollFiguresHidden
      ? "bi bi-eye"
      : "bi bi-eye-slash";
  }
}

function getEmployeePayrollFigureDisplay(displayValue) {
  return state.isPayrollFiguresHidden ? "\u2022\u2022\u2022\u2022\u2022\u2022" : displayValue;
}

/* =========================================================
   Payroll helpers
========================================================= */
function getPayrollTaxValue(record) {
  const paye = Number(record?.paye_tax || 0);
  const wht = Number(record?.wht_tax || 0);
  return paye > 0 ? paye : wht;
}

function getPayrollTaxLabel(record) {
  const paye = Number(record?.paye_tax || 0);
  const wht = Number(record?.wht_tax || 0);

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-2
  // Use employee-friendly tax labels that match HR payslip preview wording.
  if (paye > 0) return "PAYE Tax";
  if (wht > 0) return "WHT Tax";
  return "No Tax";
}

function getPayrollDisplayGroup(record) {
  return (
    record?.employee_group ||
    state.employeeRecord?.employee_group ||
    state.employeeRecord?.group ||
    state.employeeRecord?.staff_group ||
    state.employeeRecord?.role ||
    "Unassigned"
  );
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-2
// Convert stored payroll group codes into employee-friendly labels.
// This keeps the employee self-service view aligned with HR wording.
function formatPayrollDisplayGroupLabel(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "Unassigned";

  if (cleanValue.toUpperCase() === "REGULAR") {
    return "Regular";
  }

  return cleanValue
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizePayrollModel(value) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized) return PAYROLL_MODEL_GENERIC;
  if (
    normalized === PAYROLL_MODEL_REGULAR ||
    normalized === "REGULAR_INCREMENT_V1" ||
    normalized === "REGULAR_V1"
  ) {
    return PAYROLL_MODEL_REGULAR;
  }

  return PAYROLL_MODEL_GENERIC;
}

function getPayrollModel(record) {
  const explicitModel = normalizePayrollModel(record?.payroll_model || "");

  if (String(record?.payroll_model || "").trim()) {
    return explicitModel;
  }

  const group = String(getPayrollDisplayGroup(record) || "").trim().toUpperCase();
  return group === "REGULAR" ? PAYROLL_MODEL_REGULAR : PAYROLL_MODEL_GENERIC;
}

function isRegularPayrollRecord(record) {
  return getPayrollModel(record) === PAYROLL_MODEL_REGULAR;
}

function formatPayrollPercent(value, fallbackPercent = null) {
  const hasValue =
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "";

  const numericValue = hasValue ? Number(value) : Number(fallbackPercent);

  if (!Number.isFinite(numericValue)) return "--";

  const resolvedPercent = numericValue > 1 ? numericValue : numericValue * 100;
  return `${resolvedPercent.toFixed(1)}%`;
}

function getRegularStructureVariantLabel(record) {
  const variant = String(
    record?.structure_variant || record?.payroll_model_version || "REGULAR_INCREMENT_V1",
  )
    .trim()
    .toUpperCase();

  if (variant === "REGULAR_INCREMENT_V1" || variant === "V1") {
    return "Regular Increment v1";
  }

  return variant
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildMoneyDisplayItem(label, value, currency, options = {}) {
  return {
    label,
    displayValue: formatCurrency(value, currency),
    emphasis: Boolean(options.emphasis),
  };
}

function buildTextDisplayItem(label, value, options = {}) {
  return {
    label,
    displayValue: value || "--",
    emphasis: Boolean(options.emphasis),
  };
}

function buildGenericPayrollBreakdownItems(record) {
  const currency = record.currency || "NGN";
  const taxValue = getPayrollTaxValue(record);
  const taxLabel = getPayrollTaxLabel(record);

  const rawItems = [
    { label: "Employee Group", value: formatPayrollDisplayGroupLabel(getPayrollDisplayGroup(record)), type: "text" },
    { label: "Monthly Gross Salary", value: Number(record.base_salary || 0), type: "money" },
    { label: "Basic Pay", value: Number(record.basic_pay || 0), type: "money" },
    { label: "Housing Allowance", value: Number(record.housing_allowance || 0), type: "money" },
    { label: "Transport Allowance", value: Number(record.transport_allowance || 0), type: "money" },
    { label: "Utility Allowance", value: Number(record.utility_allowance || 0), type: "money" },
    { label: "Medical Allowance", value: Number(record.medical_allowance || 0), type: "money" },
    { label: "Other Allowance", value: Number(record.other_allowance || 0), type: "money" },
    { label: "Bonus", value: Number(record.bonus || 0), type: "money" },
    { label: "Overtime", value: Number(record.overtime || 0), type: "money" },
    { label: "Logistics Allowance", value: Number(record.logistics_allowance || 0), type: "money" },
    { label: "Data & Airtime", value: Number(record.data_airtime_allowance || 0), type: "money" },
    { label: "Gross Pay", value: Number(record.gross_pay || 0), type: "money", emphasis: true },
    { label: taxLabel, value: Number(taxValue || 0), type: "money" },
    { label: "Employee Pension", value: Number(record.employee_pension || 0), type: "money" },
    { label: "Employer Pension", value: Number(record.employer_pension || 0), type: "money" },
    { label: "Other Deductions", value: Number(record.other_deductions || 0), type: "money" },
    { label: "Total Deductions", value: Number(record.total_deductions || 0), type: "money", emphasis: true },
    { label: "Net Pay", value: Number(record.net_pay || 0), type: "money", emphasis: true },
  ];

  return rawItems
    .filter((item) => {
      if (item.type === "text") return true;
      if (["Gross Pay", "Total Deductions", "Net Pay"].includes(item.label)) {
        return true;
      }
      if (item.label === "No Tax") return false;
      return Number(item.value) !== 0;
    })
    .map((item) => {
      if (item.type === "money") {
        return {
          ...item,
          displayValue: formatCurrency(item.value, currency),
        };
      }

      return {
        ...item,
        displayValue: item.value || "--",
      };
    });
}

function buildRegularPayrollSections(record) {
  const currency = record.currency || "NGN";
  const payeTax = Number(record.paye_tax || 0);
  const whtTax = Number(record.wht_tax || 0);
  const employeePension = Number(record.employee_pension || 0);
  const employerPension = Number(record.employer_pension || 0);
  const otherDeductions = Number(record.other_deductions || 0);
  const logisticsAllowance = Number(record.logistics_allowance || 0);
  const monthlySalaryPlusLogistics = Number(record.monthly_salary_plus_logistics || 0);

  const netSalary =
    monthlySalaryPlusLogistics !== 0 || logisticsAllowance !== 0
      ? monthlySalaryPlusLogistics - logisticsAllowance
      : Number(record.new_base_salary || 0) -
      payeTax -
      whtTax -
      employeePension -
      otherDeductions;

  const salaryStructureItems = [
    buildTextDisplayItem(
      "Employee Group",
      formatPayrollDisplayGroupLabel(getPayrollDisplayGroup(record)),
    ),
    buildTextDisplayItem("Payroll Model", "Alpatech Regular"),
    buildMoneyDisplayItem(
      "Monthly Gross Salary",
      Number(record.base_salary || 0),
      currency,
      { emphasis: true },
    ),
    buildTextDisplayItem(
      "Increment %",
      formatPayrollPercent(record.increment_percent, 5),
    ),
    buildMoneyDisplayItem(
      "Increment Amount",
      Number(record.increment_amount || 0),
      currency,
    ),
    ...(Number(record.merit_increment || 0) !== 0
      ? [
        buildMoneyDisplayItem(
          "Merit Increment",
          Number(record.merit_increment || 0),
          currency,
        ),
      ]
      : []),
    buildMoneyDisplayItem(
      "Revised Monthly Gross Salary",
      Number(record.new_base_salary || 0),
      currency,
      { emphasis: true },
    ),
    buildTextDisplayItem(
      "Basic %",
      formatPayrollPercent(record.basic_percent, 50),
    ),
    buildTextDisplayItem(
      "Housing %",
      formatPayrollPercent(record.housing_percent, 10),
    ),
    buildTextDisplayItem(
      "Transport %",
      formatPayrollPercent(record.transport_percent, 10),
    ),
    buildTextDisplayItem(
      "Utility %",
      formatPayrollPercent(record.utility_percent, 10),
    ),
    buildTextDisplayItem(
      "Other Allowance %",
      formatPayrollPercent(record.other_allowance_percent, 20),
    ),
    buildMoneyDisplayItem(
      "BHT (Basic + Housing + Transport)",
      Number(record.bht || 0),
      currency,
    ),
  ];

  const earningsItems = [];

  if (Number(record.basic_pay || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Basic Pay", Number(record.basic_pay || 0), currency),
    );
  }

  if (Number(record.housing_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Housing Allowance",
        Number(record.housing_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.transport_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Transport Allowance",
        Number(record.transport_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.utility_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Utility Allowance",
        Number(record.utility_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.medical_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Medical Allowance",
        Number(record.medical_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.other_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Other Allowance",
        Number(record.other_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.bonus || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Bonus", Number(record.bonus || 0), currency),
    );
  }

  if (Number(record.overtime || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Overtime", Number(record.overtime || 0), currency),
    );
  }

  if (logisticsAllowance !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Logistics Allowance",
        logisticsAllowance,
        currency,
      ),
    );
  }

  if (Number(record.data_airtime_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Data & Airtime",
        Number(record.data_airtime_allowance || 0),
        currency,
      ),
    );
  }

  earningsItems.push(
    buildMoneyDisplayItem(
      "Gross Pay",
      Number(record.gross_pay || 0),
      currency,
      { emphasis: true },
    ),
  );

  const deductionItems = [];

  if (payeTax !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("PAYE Tax", payeTax, currency),
    );
  }

  if (whtTax !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("WHT Tax", whtTax, currency),
    );
  }

  if (employeePension !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("Employee Pension", employeePension, currency),
    );
  }

  if (otherDeductions !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("Other Deductions", otherDeductions, currency),
    );
  }

  deductionItems.push(
    buildMoneyDisplayItem(
      "Total Deductions",
      Number(record.total_deductions || 0),
      currency,
      { emphasis: true },
    ),
  );

  const employerContributionItems = [];
  if (employerPension !== 0) {
    employerContributionItems.push(
      buildMoneyDisplayItem("Employer Pension", employerPension, currency),
    );
  }

  const netSummaryItems = [
    buildMoneyDisplayItem(
      "Net Salary before Logistics",
      netSalary,
      currency,
    ),
  ];

  if (monthlySalaryPlusLogistics !== 0) {
    netSummaryItems.push(
      buildMoneyDisplayItem(
        "Monthly Salary + Logistics",
        monthlySalaryPlusLogistics,
        currency,
      ),
    );
  }

  netSummaryItems.push(
    buildMoneyDisplayItem(
      "Net Pay",
      Number(record.net_pay || 0),
      currency,
      { emphasis: true },
    ),
  );

  return [
    { title: "Salary Structure", items: salaryStructureItems },
    { title: "Earnings", items: earningsItems },
    { title: "Deductions", items: deductionItems },
    ...(employerContributionItems.length
      ? [{ title: "Employer Contribution", items: employerContributionItems }]
      : []),
    { title: "Net Pay Summary", items: netSummaryItems },
  ];
}

function buildPayrollBreakdownSections(record) {
  if (isRegularPayrollRecord(record)) {
    return buildRegularPayrollSections(record);
  }

  return [
    {
      title: "Payroll Breakdown",
      items: buildGenericPayrollBreakdownItems(record),
    },
  ];
}

// ALPATECH EMPLOYEE PAYSLIP PREVIEW BRANDING - STEP 1C-FIX 2
// Match the HR Alpatech document header exactly:
// compact flame, tight ALPATECH wordmark spacing, subtitle aligned under
// the wordmark, and no large logo tile.
// Branding only; no payroll values, calculations, PDF, Supabase, or access logic changes.
function buildEmployeeAlpatechDocumentBrandHeaderHtml({
  documentLabel = "Confidential employee payslip",
  rightTitle = "",
  rightLine1 = "",
  rightLine2 = "",
} = {}) {
  const rightPanelHtml = rightTitle || rightLine1 || rightLine2
    ? `
      <div style="text-align:right;color:#667085;font-size:0.82rem;line-height:1.45;">
        ${rightTitle ? `<div style="color:#08446d;font-weight:700;font-size:0.95rem;">${escapeHtml(rightTitle)}</div>` : ""}
        ${rightLine1 ? `<div>${escapeHtml(rightLine1)}</div>` : ""}
        ${rightLine2 ? `<div>${escapeHtml(rightLine2)}</div>` : ""}
      </div>
    `
    : "";

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;padding:16px;border:1px solid #d8e5ee;border-radius:16px;background:linear-gradient(135deg,#f7fbfd 0%,#ffffff 100%);">
      <!-- ALPATECH EMPLOYEE PAYSLIP PREVIEW BRANDING - STEP 1C-FIX 2
           Same compact logo composition used by HR payslip/employee record previews. -->
      <div style="display:flex;flex-direction:column;align-items:flex-start;min-width:0;">
        <div style="display:flex;align-items:center;gap:4px;min-width:0;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:28px;flex:0 0 auto;">
            <img src="assets/alpatech-flame.png" alt="" style="display:block;width:18px;height:26px;object-fit:contain;" />
          </span>

          <!-- ALPATECH PAYSLIP VIEW LOGO REFINEMENT - STEP 1J
               Straight vertical divider only for Alpatech employee payslip preview.
               PDF output is intentionally not changed. -->
          <span aria-hidden="true" style="display:inline-block;width:1px;height:26px;background:rgba(148,163,184,0.62);margin:0 7px 0 5px;"></span>

          <span style="color:#0b5f95;font-size:1.18rem;font-weight:500;letter-spacing:0.16em;line-height:1;">
            ALPATECH
          </span>
        </div>

        <div style="color:#667085;font-size:0.82rem;margin-top:4px;margin-left:40px;">
          ${escapeHtml(documentLabel)}
        </div>
      </div>

      ${rightPanelHtml}
    </div>
  `;
}

// EMPLOYEE PAYSLIP PREVIEW HR SELF-SERVICE PARITY - v1.0.0
// Presentation-only parity with the approved HR/Manager self-service payslip.
// Existing authorised payroll records, PDF generation, calculations,
// permissions, tenant scope and employee identity remain unchanged.
function buildEmployeePayslipBrandHeaderHtml(record = {}) {
  const isAlpatech = isCurrentEmployeeTenantAlpatechWorkspace();
  const companyName = getEmployeePayslipCompanyName();
  const brandName = isAlpatech ? "ALPATECH" : companyName;

  const brandMarkHtml = isAlpatech
    ? `<span class="bexhr-payslip-brand-mark bexhr-payslip-brand-mark--image" aria-hidden="true">
         <img src="assets/alpatech-flame.png" alt="" />
       </span>`
    : "";

  return `
    <header class="bexhr-payslip-letterhead ${isAlpatech ? "bexhr-payslip-letterhead--alpatech" : ""}">
      <div class="bexhr-payslip-brand-block">
        <div class="bexhr-payslip-brand-line">
          ${brandMarkHtml}
          ${brandMarkHtml
      ? `<span class="bexhr-payslip-brand-divider" aria-hidden="true"></span>`
      : ""}
          <div>
            <div class="bexhr-payslip-brand-name">
              ${escapeHtml(brandName || "BexHR")}
            </div>
            <div class="bexhr-payslip-document-label">
              Confidential Payroll Payslip
            </div>
            ${!isAlpatech &&
      companyName &&
      normalizeText(companyName) !== "bexhr"
      // Keep the platform attribution readable for non-Alpatech tenant payslips.
      ? `<div class="bexhr-payslip-platform-label">Prepared securely with BexHR</div>`
      : ""}
          </div>
        </div>
      </div>

      <div class="bexhr-payslip-document-meta">
        <span class="bexhr-payslip-status-badge">
          <span aria-hidden="true"></span>
          ${escapeHtml(record.status || "Authorised")}
        </span>

        <strong>${escapeHtml(record.pay_cycle || "Payroll")}</strong>

        <span>
          Pay date: ${escapeHtml(formatDate(record.pay_date))}
        </span>
      </div>
    </header>
  `;
}

function buildEmployeePayslipPreviewRows(
  rows = [],
  emptyText = "No items recorded.",
) {
  const visibleRows = rows.filter((row) => row && row.label);

  if (!visibleRows.length) {
    return `
      <div class="bexhr-payslip-empty-line">
        ${escapeHtml(emptyText)}
      </div>
    `;
  }

  return visibleRows
    .map(
      (row) => `
        <div class="bexhr-payslip-line-item">
          <span>${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(row.value)}</strong>
        </div>
      `,
    )
    .join("");
}

function buildEmployeePayslipStructureHtml(items = []) {
  const visibleItems = items.filter((item) => {
    if (!item || !item.label) return false;

    const value = String(item.value ?? "").trim();

    return (
      value &&
      value !== "--" &&
      value !== "0.0%" &&
      value !== "NGN 0.00"
    );
  });

  if (!visibleItems.length) return "";

  return `
    <section class="bexhr-payslip-structure-card">
      <div class="bexhr-payslip-section-heading">
        <span class="bexhr-payslip-section-icon" aria-hidden="true">
          <i class="bi bi-diagram-3"></i>
        </span>

        <div>
          <span>Payroll basis</span>
          <h3>Salary Structure</h3>
        </div>
      </div>

      <div class="bexhr-payslip-structure-grid">
        ${visibleItems
      .map(
        (item) => `
              <div class="bexhr-payslip-structure-item ${item.emphasis
            ? "bexhr-payslip-structure-item--emphasis"
            : ""
          }">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>
            `,
      )
      .join("")}
      </div>
    </section>
  `;
}

function buildEmployeePayslipPreviewContent(record = {}) {
  const currency = record.currency || "NGN";
  const employee = getEmployeePayslipPdfEmployeeContext();
  const companyName = getEmployeePayslipCompanyName();

  const money = (value) => formatCurrency(value, currency);

  const percent = (value) => {
    const numericValue = Number(value || 0);

    if (!Number.isFinite(numericValue) || numericValue === 0) {
      return "0.0%";
    }

    const percentage =
      Math.abs(numericValue) <= 1
        ? numericValue * 100
        : numericValue;

    return `${percentage.toFixed(1)}%`;
  };

  const earningsRows = [
    {
      label: "Basic Pay",
      value: money(record.basic_pay),
      amount: record.basic_pay,
    },
    {
      label: "Housing Allowance",
      value: money(record.housing_allowance),
      amount: record.housing_allowance,
    },
    {
      label: "Transport Allowance",
      value: money(record.transport_allowance),
      amount: record.transport_allowance,
    },
    {
      label: "Utility Allowance",
      value: money(record.utility_allowance),
      amount: record.utility_allowance,
    },
    {
      label: "Medical Allowance",
      value: money(record.medical_allowance),
      amount: record.medical_allowance,
    },
    {
      label: "Other Allowance",
      value: money(record.other_allowance),
      amount: record.other_allowance,
    },
    {
      label: "Bonus",
      value: money(record.bonus),
      amount: record.bonus,
    },
    {
      label: "Overtime",
      value: money(record.overtime),
      amount: record.overtime,
    },
    {
      label: "Logistics Allowance",
      value: money(record.logistics_allowance),
      amount: record.logistics_allowance,
    },
    {
      label: "Data / Airtime Allowance",
      value: money(record.data_airtime_allowance),
      amount: record.data_airtime_allowance,
    },
  ].filter((row) => Number(row.amount || 0) > 0);

  const deductionRows = [
    {
      label: "PAYE Tax",
      value: money(record.paye_tax),
      amount: record.paye_tax,
    },
    {
      label: "WHT Tax",
      value: money(record.wht_tax),
      amount: record.wht_tax,
    },
    {
      label: "Employee Pension",
      value: money(record.employee_pension),
      amount: record.employee_pension,
    },
    {
      label: "Other Deductions",
      value: money(record.other_deductions),
      amount: record.other_deductions,
    },
  ].filter((row) => Number(row.amount || 0) > 0);

  const structureHtml = buildEmployeePayslipStructureHtml([
    {
      label: "Pay Type",
      value:
        record.employee_group ||
        record.payroll_model ||
        "Regular",
    },
    {
      label: "Increment",
      value: percent(record.increment_percent),
    },
    {
      label: "Monthly Gross Salary",
      value: money(record.gross_pay),
      emphasis: true,
    },
  ]);

  return `
    <article class="bexhr-payslip-document bexhr-payslip-document--self-service">
      ${buildEmployeePayslipBrandHeaderHtml(record)}

      <section class="bexhr-payslip-party-grid">
        <article class="bexhr-payslip-party-card">
          <div class="bexhr-payslip-party-label">Company</div>

          <h3>${escapeHtml(companyName || "BexHR")}</h3>

          <div class="bexhr-payslip-contact-lines">
            <span>Authorised payroll record</span>
            <span>
              ${escapeHtml(record.pay_cycle || "Payroll")} payroll cycle
            </span>
          </div>
        </article>

        <article class="bexhr-payslip-party-card bexhr-payslip-party-card--employee">
          <div class="bexhr-payslip-party-label">Employee</div>

          <h3>${escapeHtml(employee.employeeName)}</h3>

          <div class="bexhr-payslip-contact-lines">
            <span>${escapeHtml(employee.employeeEmail)}</span>
            <span>
              ${escapeHtml(employee.department)} ·
              ${escapeHtml(employee.jobTitle)}
            </span>
          </div>

          <div class="bexhr-payslip-employee-number">
            <span>Employee No.</span>
            <strong>${escapeHtml(employee.employeeId)}</strong>
          </div>
        </article>
      </section>

      <section
        class="bexhr-payslip-summary-grid"
        aria-label="Payslip totals"
      >
        <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--gross">
          <span class="bexhr-payslip-summary-icon" aria-hidden="true">
            <i class="bi bi-wallet2"></i>
          </span>

          <div>
            <span>Gross Pay</span>
            <strong>${escapeHtml(money(record.gross_pay))}</strong>
          </div>
        </article>

        <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--deductions">
          <span class="bexhr-payslip-summary-icon" aria-hidden="true">
            <i class="bi bi-dash-circle"></i>
          </span>

          <div>
            <span>Total Deductions</span>
            <strong>
              ${escapeHtml(money(record.total_deductions))}
            </strong>
          </div>
        </article>

        <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--net">
          <span class="bexhr-payslip-summary-icon" aria-hidden="true">
            <i class="bi bi-check2-circle"></i>
          </span>

          <div>
            <span>Net Pay</span>
            <strong>${escapeHtml(money(record.net_pay))}</strong>
          </div>
        </article>
      </section>

      ${structureHtml}

      <section class="bexhr-payslip-breakdown-grid">
        <article class="bexhr-payslip-breakdown-card bexhr-payslip-breakdown-card--earnings">
          <div class="bexhr-payslip-section-heading">
            <span class="bexhr-payslip-section-icon" aria-hidden="true">
              <i class="bi bi-plus-circle"></i>
            </span>

            <div>
              <span>Income</span>
              <h3>Earnings</h3>
            </div>
          </div>

          <div class="bexhr-payslip-line-items">
            ${buildEmployeePayslipPreviewRows(
    earningsRows,
    "No earnings breakdown recorded.",
  )}
          </div>

          <div class="bexhr-payslip-section-total">
            <span>Gross Pay</span>
            <strong>${escapeHtml(money(record.gross_pay))}</strong>
          </div>
        </article>

        <article class="bexhr-payslip-breakdown-card bexhr-payslip-breakdown-card--deductions">
          <div class="bexhr-payslip-section-heading">
            <span class="bexhr-payslip-section-icon" aria-hidden="true">
              <i class="bi bi-dash-circle"></i>
            </span>

            <div>
              <span>Withheld</span>
              <h3>Deductions</h3>
            </div>
          </div>

          <div class="bexhr-payslip-line-items">
            ${buildEmployeePayslipPreviewRows(
    deductionRows,
    "No deductions recorded.",
  )}
          </div>

          <div class="bexhr-payslip-section-total">
            <span>Total Deductions</span>
            <strong>
              ${escapeHtml(money(record.total_deductions))}
            </strong>
          </div>
        </article>
      </section>

      <section class="bexhr-payslip-net-panel">
        <div>
          <span>Amount payable</span>
          <strong>Net Pay</strong>
        </div>

        <div class="bexhr-payslip-net-amount">
          ${escapeHtml(money(record.net_pay))}
        </div>
      </section>

      <footer class="bexhr-payslip-footer-note">
        <span class="bexhr-payslip-footer-icon" aria-hidden="true">
          <i class="bi bi-shield-lock"></i>
        </span>

        <div>
          <strong>Confidential employee document</strong>
          <p>
            This read-only payslip is intended only for the named employee.
            Use the Download PDF action to keep an authorised copy.
          </p>
        </div>
      </footer>
    </article>
  `;
}

function ensureEmployeePayslipPreviewModal() {
  let modal = document.getElementById(
    "employeePayslipPreviewModal",
  );

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "employeePayslipPreviewModal";
  modal.className =
    "d-none position-fixed top-0 start-0 w-100 h-100 bexhr-payslip-modal employee-payslip-preview-modal";

  modal.style.zIndex = "1060";
  modal.setAttribute("aria-hidden", "true");

  modal.innerHTML = `
    <div class="container h-100 d-flex align-items-center justify-content-center py-4 bexhr-payslip-modal-container">
      <section
        class="card border-0 shadow-lg rounded-4 w-100 bexhr-payslip-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employeePayslipPreviewTitle"
      >
        <header
          id="employeePayslipPreviewHeader"
          class="card-header bg-white border-0 d-flex justify-content-between align-items-start gap-3 p-4 bexhr-payslip-modal-header"
        >
          <div>
            <h2
              id="employeePayslipPreviewTitle"
              class="h4 mb-1"
            >
              Payslip Preview
            </h2>

            <p
              id="employeePayslipPreviewSubtitle"
              class="text-secondary mb-0"
            >
              Review your authorised payroll document or download a PDF copy.
            </p>
          </div>

          <button
            type="button"
            id="closeEmployeePayslipPreviewBtn"
            class="btn btn-sm btn-outline-secondary"
            aria-label="Close payslip preview"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <div
          id="employeePayslipPreviewContent"
          class="card-body p-4 bexhr-payslip-modal-content"
        >
          <div class="text-center text-secondary py-4">
            Select a payroll record to view payslip details.
          </div>
        </div>

        <footer
          class="card-footer bg-light border-0 d-flex flex-wrap justify-content-end gap-2 p-4 bexhr-payslip-modal-footer"
        >
          <button
            type="button"
            id="downloadEmployeePayslipPreviewBtn"
            class="btn btn-primary dashboard-action-btn"
          >
            <i class="bi bi-file-earmark-pdf me-2"></i>
            Download PDF
          </button>

          <button
            type="button"
            id="closeEmployeePayslipPreviewFooterBtn"
            class="btn btn-outline-secondary dashboard-action-btn"
          >
            Close Preview
          </button>
        </footer>
      </section>
    </div>
  `;

  document.body.appendChild(modal);

  modal
    .querySelector("#closeEmployeePayslipPreviewBtn")
    ?.addEventListener(
      "click",
      closeEmployeePayslipPreviewModal,
    );

  modal
    .querySelector("#closeEmployeePayslipPreviewFooterBtn")
    ?.addEventListener(
      "click",
      closeEmployeePayslipPreviewModal,
    );

  modal
    .querySelector("#downloadEmployeePayslipPreviewBtn")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const payrollId = button?.dataset?.payrollId || "";

      if (!payrollId) {
        showPageAlert(
          "warning",
          "Select an authorised payroll record before downloading a payslip PDF.",
        );

        return;
      }

      await downloadPayslipPdf(payrollId, button);
    });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeEmployeePayslipPreviewModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !modal.classList.contains("d-none")
    ) {
      closeEmployeePayslipPreviewModal();
    }
  });

  return modal;
}

function showEmployeePayslipPreviewModal() {
  const modal = ensureEmployeePayslipPreviewModal();

  modal.classList.remove("d-none");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("overflow-hidden");
}

function closeEmployeePayslipPreviewModal() {
  const modal = document.getElementById(
    "employeePayslipPreviewModal",
  );

  if (!modal) return;

  modal.classList.add("d-none");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("overflow-hidden");
}

function openEmployeePayslipPreview(payrollId) {
  const payrollRecord = (state.payrollRecords || []).find(
    (record) => String(record.id) === String(payrollId),
  );

  if (!payrollRecord) {
    showPageAlert(
      "warning",
      "The selected payroll record could not be found. Please refresh payroll history and try again.",
    );

    return;
  }

  if (
    normalizeText(payrollRecord.status) !== "authorised" ||
    !payrollRecord.is_finalised
  ) {
    showPageAlert(
      "warning",
      "Payslip details are only available for authorised payroll records.",
    );

    return;
  }

  clearPageAlert();

  const modal = ensureEmployeePayslipPreviewModal();
  const title = modal.querySelector(
    "#employeePayslipPreviewTitle",
  );
  const subtitle = modal.querySelector(
    "#employeePayslipPreviewSubtitle",
  );
  const content = modal.querySelector(
    "#employeePayslipPreviewContent",
  );
  const downloadButton = modal.querySelector(
    "#downloadEmployeePayslipPreviewBtn",
  );

  if (title) {
    title.textContent =
      `Payslip Preview - ${payrollRecord.pay_cycle || "Payroll"}`;
  }

  if (subtitle) {
    subtitle.textContent =
      "Review your authorised payroll document or download a PDF copy.";
  }

  if (content) {
    content.innerHTML =
      buildEmployeePayslipPreviewContent(payrollRecord);
  }

  if (downloadButton) {
    downloadButton.dataset.payrollId = String(
      payrollRecord.id || payrollId,
    );
  }

  showEmployeePayslipPreviewModal();
}

/* =========================================================
   Payroll
========================================================= */
async function loadEmployeePayroll() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    state.payrollRecords = [];
    renderPayroll([]);
    renderEmployeeOverviewMetrics();
    return;
  }

  let query = supabase.from("payroll_records").select(`
      id,
      employee_id,
      pay_cycle,
      pay_date,
      employee_group,

      payroll_model,
      payroll_model_version,
      structure_variant,
      payslip_layout,

      base_salary,
      increment_percent,
      increment_amount,
      merit_increment,
      new_base_salary,
      basic_percent,
      housing_percent,
      transport_percent,
      utility_percent,
      other_allowance_percent,
      bht,
      monthly_salary_plus_logistics,

      basic_pay,
      housing_allowance,
      transport_allowance,
      utility_allowance,
      medical_allowance,
      other_allowance,
      bonus,
      overtime,
      logistics_allowance,
      data_airtime_allowance,

      gross_pay,
      paye_tax,
      wht_tax,
      employee_pension,
      employer_pension,
      other_deductions,
      total_deductions,
      net_pay,

      currency,
      status,
      is_finalised,
      created_at,
      updated_at
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query
    .eq("status", "Authorised")
    .eq("is_finalised", true)
    .order("pay_date", { ascending: false });

  if (error) {
    console.error("Error loading payroll records:", error);
    showPageAlert("danger", "Unable to load payroll history.");
    return;
  }

  const records = Array.isArray(data)
    ? data.filter(
      (record, index, array) =>
        array.findIndex((item) => item.id === record.id) === index,
    )
    : [];

  state.payrollRecords = records;
  applyPayrollFilters();
  renderEmployeeOverviewMetrics();
}
function renderPayroll(records) {
  const historyRecords = Array.isArray(records) ? records : [];
  renderCurrentPayrollSummary(state.payrollRecords);
  renderPayrollHistory(historyRecords);
}

function getFilteredPayrollRecords() {
  const records = Array.isArray(state.payrollRecords) ? state.payrollRecords : [];

  const searchValue = normalizeText(state.dom.payrollSearchInput?.value || "");
  const fromDateValue = state.dom.payrollDateFromInput?.value || "";
  const toDateValue = state.dom.payrollDateToInput?.value || "";

  return records.filter((record) => {
    const payCycle = normalizeText(record?.pay_cycle || "");
    const matchesSearch = !searchValue || payCycle.includes(searchValue);

    if (!matchesSearch) {
      return false;
    }

    const recordDateValue = String(record?.pay_date || "").trim();
    if (!recordDateValue) {
      return !fromDateValue && !toDateValue;
    }

    const recordDate = new Date(recordDateValue);
    if (Number.isNaN(recordDate.getTime())) {
      return false;
    }

    if (fromDateValue) {
      const fromDate = new Date(fromDateValue);
      if (!Number.isNaN(fromDate.getTime()) && recordDate < fromDate) {
        return false;
      }
    }

    if (toDateValue) {
      const toDate = new Date(toDateValue);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        if (recordDate > toDate) {
          return false;
        }
      }
    }

    return true;
  });
}

function applyPayrollFilters() {
  renderPayroll(getFilteredPayrollRecords());
}

function clearPayrollFilters() {
  if (state.dom.payrollSearchInput) state.dom.payrollSearchInput.value = "";
  if (state.dom.payrollDateFromInput) state.dom.payrollDateFromInput.value = "";
  if (state.dom.payrollDateToInput) state.dom.payrollDateToInput.value = "";

  applyPayrollFilters();
}

function renderCurrentPayrollSummary(records) {
  const payrollRecords = Array.isArray(records) ? records : [];

  if (!payrollRecords.length) {
    state.dom.currentPayrollEmptyState?.classList.remove("d-none");
    state.dom.currentPayrollSummaryGrid?.classList.add("d-none");
    return;
  }

  const latest = payrollRecords[0];

  state.dom.currentPayrollEmptyState?.classList.add("d-none");
  state.dom.currentPayrollSummaryGrid?.classList.remove("d-none");

  if (state.dom.currentPayCycle) {
    state.dom.currentPayCycle.textContent = latest.pay_cycle || "--";
  }

  if (state.dom.currentGrossPay) {
    state.dom.currentGrossPay.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.gross_pay, latest.currency || "NGN"),
    );
  }

  if (state.dom.currentTotalDeductions) {
    state.dom.currentTotalDeductions.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.total_deductions, latest.currency || "NGN"),
    );
  }

  if (state.dom.currentNetPay) {
    state.dom.currentNetPay.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.net_pay, latest.currency || "NGN"),
    );
  }
}

// SYSTEM-WIDE SELF-SERVICE PAYROLL HISTORY CARDS - v1.0.0
// Employee Dashboard equivalent of the shared HR/Manager payroll-history card.
// Existing filtering, authorised-record loading, preview, PDF, privacy, tenant
// branding, and payroll calculations remain unchanged.
function renderPayrollHistory(records) {
  const tbody = state.dom.payrollHistoryTableBody;
  if (!tbody) return;

  const payrollRecords = Array.isArray(records) ? records : [];
  tbody.innerHTML = "";

  if (!payrollRecords.length) {
    state.dom.payrollHistoryEmptyState?.classList.remove("d-none");
    state.dom.payrollHistoryTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.payrollHistoryEmptyState?.classList.add("d-none");
  state.dom.payrollHistoryTableWrapper?.classList.remove("d-none");

  payrollRecords.forEach((record) => {
    const currency = record.currency || "NGN";
    const taxValue = getPayrollTaxValue(record);
    const taxLabel = getPayrollTaxLabel(record);
    const employeePension = Number(record.employee_pension || 0);
    const employeeGroup = formatPayrollDisplayGroupLabel(
      getPayrollDisplayGroup(record),
    );
    const statusLabel = String(record.status || "Authorised").trim() || "Authorised";
    const normalizedStatus = normalizeText(statusLabel);
    const statusTone =
      normalizedStatus.includes("author") || normalizedStatus.includes("final")
        ? "is-success"
        : normalizedStatus.includes("pending")
          ? "is-warning"
          : "is-neutral";
    const statusIcon =
      statusTone === "is-success"
        ? "bi-check-circle-fill"
        : statusTone === "is-warning"
          ? "bi-clock-fill"
          : "bi-circle-fill";

    const row = document.createElement("tr");
    row.className = "payroll-summary-row bexhr-self-service-payroll-row";
    row.dataset.payrollId = record.id;

    row.innerHTML = `
      <td colspan="10" class="bexhr-self-service-payroll-cell">
        <article class="bexhr-self-service-payroll-card">
          <header class="bexhr-self-service-payroll-header">
            <div class="bexhr-self-service-payroll-identity">
              <span class="bexhr-self-service-payroll-icon" aria-hidden="true">
                <i class="bi bi-receipt-cutoff"></i>
              </span>

              <div class="bexhr-self-service-payroll-title-group">
                <span class="bexhr-self-service-payroll-eyebrow">Authorised pay cycle</span>
                <strong class="bexhr-self-service-payroll-cycle">
                  ${escapeHtml(record.pay_cycle || "--")}
                </strong>
                <span class="bexhr-self-service-payroll-group">
                  ${escapeHtml(employeeGroup || "Regular")}
                </span>
              </div>
            </div>

            <div class="bexhr-self-service-payroll-date">
              <span>Pay date</span>
              <strong>${escapeHtml(formatDate(record.pay_date))}</strong>
            </div>

            <span class="bexhr-self-service-payroll-status ${statusTone}">
              <i class="bi ${statusIcon}" aria-hidden="true"></i>
              ${escapeHtml(statusLabel)}
            </span>
          </header>

          <section class="bexhr-self-service-payroll-metrics" aria-label="Payroll summary">
            <div class="bexhr-self-service-payroll-metric">
              <span>Gross Pay</span>
              <strong>${escapeHtml(formatCurrency(record.gross_pay, currency))}</strong>
            </div>

            <div class="bexhr-self-service-payroll-metric">
              <span>${escapeHtml(taxLabel || "Tax")}</span>
              <strong class="${taxValue > 0 ? "" : "is-muted"}">
                ${taxValue > 0 ? escapeHtml(formatCurrency(taxValue, currency)) : "No tax"}
              </strong>
            </div>

            <div class="bexhr-self-service-payroll-metric">
              <span>Employee Pension</span>
              <strong>${escapeHtml(formatCurrency(employeePension, currency))}</strong>
            </div>

            <div class="bexhr-self-service-payroll-metric">
              <span>Total Deductions</span>
              <strong>${escapeHtml(formatCurrency(record.total_deductions, currency))}</strong>
            </div>

            <div class="bexhr-self-service-payroll-metric is-net-pay">
              <span>Net Pay</span>
              <strong>${escapeHtml(formatCurrency(record.net_pay, currency))}</strong>
            </div>
          </section>

          <footer class="bexhr-self-service-payroll-footer">
            <div class="bexhr-self-service-payroll-note">
              <i class="bi bi-shield-check" aria-hidden="true"></i>
              Read-only authorised payroll record
            </div>

            <div class="bexhr-self-service-payroll-actions">
              <button type="button"
                class="btn btn-outline-secondary payroll-breakdown-btn bexhr-self-service-payroll-action"
                data-payroll-id="${escapeHtml(record.id)}"
                data-expanded="false"
                title="View payslip details"
                aria-label="View payslip details">
                <i class="bi bi-eye" aria-hidden="true"></i>
                <span>View payslip</span>
              </button>

              <button type="button"
                class="btn btn-outline-primary download-payslip-btn bexhr-self-service-payroll-action"
                data-payroll-id="${escapeHtml(record.id)}"
                title="Download payslip PDF"
                aria-label="Download payslip PDF">
                <i class="bi bi-file-earmark-pdf" aria-hidden="true"></i>
                <span>Download PDF</span>
              </button>
            </div>
          </footer>
        </article>
      </td>
    `;

    tbody.appendChild(row);

    // Preserve the existing tenant-aware employee PDF action.
    const downloadButton = row.querySelector(".download-payslip-btn");
    downloadButton?.addEventListener("click", async () => {
      const payrollId = downloadButton.getAttribute("data-payroll-id");
      await downloadPayslipPdf(payrollId, downloadButton);
    });

    // Preserve the existing read-only payslip preview action.
    const breakdownButton = row.querySelector(".payroll-breakdown-btn");
    breakdownButton?.addEventListener("click", () => {
      const payrollId = breakdownButton.getAttribute("data-payroll-id");
      openEmployeePayslipPreview(payrollId);
    });
  });
}

// EMPLOYEE PAYSLIP PDF HR PARITY - v1.0.0
// Uses the confirmed HR/Manager payslip PDF document system.
// Payroll values, authorisation, queries and tenant boundaries are unchanged.
function getEmployeePayslipPdfEmployeeContext() {
  const employeeName =
    `${state.employeeRecord?.first_name || ""} ${state.employeeRecord?.last_name || ""}`.trim() ||
    state.currentProfile?.full_name ||
    "Employee";

  return {
    employeeName,
    employeeEmail:
      state.employeeRecord?.work_email ||
      state.currentProfile?.email ||
      state.currentUser?.email ||
      "--",
    employeeId: getEmployeeIdDisplayValue(state.employeeRecord || {}),
    department: state.employeeRecord?.department || "--",
    jobTitle:
      state.employeeRecord?.job_title ||
      state.employeeRecord?.position ||
      "Employee",
  };
}

function getEmployeePayslipCompanyName() {
  let tenantContext = null;

  try {
    const rawContext = window.localStorage.getItem("hrPayrollTenantContext");
    tenantContext = rawContext ? JSON.parse(rawContext) : null;
  } catch (error) {
    console.warn(
      "Employee payslip tenant context could not be read.",
      error,
    );
  }

  const isAlpatech =
    typeof isCurrentEmployeeTenantAlpatechWorkspace === "function" &&
    isCurrentEmployeeTenantAlpatechWorkspace();

  return String(
    tenantContext?.companyName ||
    tenantContext?.company_name ||
    tenantContext?.tenantName ||
    tenantContext?.tenant_name ||
    state.currentProfile?.company_name ||
    state.currentProfile?.organization_name ||
    state.currentProfile?.tenant_name ||
    state.employeeRecord?.company_name ||
    state.employeeRecord?.organization_name ||
    state.employeeRecord?.tenant_name ||
    (isAlpatech ? "ALPATECH" : "BexHR")
  ).trim() || (isAlpatech ? "ALPATECH" : "BexHR");
}
// -----------------------------------------------------------------------
// Payslip PDF
// -----------------------------------------------------------------------

// ALPATECH PDF BRANDING - STEP 4A
// Tenant-safe detection for HR/Manager My Self-Service payslip downloads.
// This only changes the generated PDF branding when the active company
// workspace is Alpatech. Other tenants keep the existing BexHR PDF output.
function isCurrentEmployeeTenantAlpatechWorkspace() {
  let tenantContext = null;

  try {
    const rawContext = window.localStorage.getItem("hrPayrollTenantContext");
    tenantContext = rawContext ? JSON.parse(rawContext) : null;
  } catch (error) {
    console.warn("[SS] Tenant context could not be read for PDF branding.", error);
  }

  const searchableTenantText = [
    tenantContext?.tenantCode,
    tenantContext?.tenantName,
    tenantContext?.companyName,
    tenantContext?.company_name,
    state.currentProfile?.tenant_code,
    state.currentProfile?.tenant_name,
    state.currentProfile?.company_name,
    state.currentProfile?.organization_name,
    state.employeeRecord?.tenant_code,
    state.employeeRecord?.tenant_name,
    state.employeeRecord?.company_name,
    state.employeeRecord?.organization_name,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  return searchableTenantText.includes("alpatech");
}

// ALPATECH PDF BRANDING - STEP 4A
// Central PDF brand settings. Non-Alpatech values intentionally match the
// existing BexHR PDF output so shared product behaviour is preserved.
// PAYSLIP DOCUMENT SYSTEM - STEP 3
// Tenant-safe A4 PDF presentation for Self-Service. The PDF is generated
// from the already-loaded authorised payroll record; no payroll values,
// calculations, status rules, queries, or permissions are changed.
function getEmployeePayslipPdfBranding(record = {}) {
  const isAlpatech = isCurrentEmployeeTenantAlpatechWorkspace();
  const companyName = getEmployeePayslipCompanyName();

  return {
    isAlpatech,
    brandName: isAlpatech ? "ALPATECH" : companyName || "BexHR",
    companyName: companyName || (isAlpatech ? "ALPATECH" : "BexHR"),
    documentLabel: "Confidential Payroll Payslip",
    // PAYSLIP TENANT-SCOPED PDF FOOTER - v1.0.0
    // Use the resolved tenant/company name throughout the generated PDF.
    // BexHR is used only when no tenant company name can be resolved.
    footerText: `Generated from an authorised payroll record for ${isAlpatech ? "ALPATECH" : companyName || "BexHR"}.`,
    filePrefix: isAlpatech ? "Alpatech" : "",
    primaryRgb: isAlpatech ? [11, 95, 149] : [15, 118, 110],
    primaryDarkRgb: isAlpatech ? [8, 68, 109] : [17, 94, 89],
    accentRgb: isAlpatech ? [54, 185, 207] : [45, 212, 191],
    successRgb: [21, 128, 61],
    warningRgb: [217, 119, 6],
    textRgb: [16, 35, 63],
    mutedRgb: [100, 116, 139],
    borderRgb: [217, 227, 236],
    softRgb: isAlpatech ? [244, 250, 252] : [242, 251, 249],
    payCycle: record.pay_cycle || "Payroll",
    payDate: formatDate(record.pay_date),
    status: record.status || "Authorised",
  };
}

async function loadEmployeePayslipImageAsDataUrl(assetPath) {
  try {
    const response = await fetch(assetPath, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
    const blob = await response.blob();

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("[SS] PDF logo asset could not be loaded.", error);
    return "";
  }
}

function drawEmployeePdfRoundedRect(doc, x, y, width, height, radius = 3, style = "S") {
  if (typeof doc.roundedRect === "function") {
    doc.roundedRect(x, y, width, height, radius, radius, style);
  } else {
    doc.rect(x, y, width, height, style);
  }
}

// SHARED PAYSLIP PDF GENERIC B REMOVAL - v1.0.0
// Preserve Alpatech tenant-owned branding. Other tenants receive
// a clean company-name letterhead without a generic B badge.
function drawEmployeePayslipPdfHeader(doc, branding = {}, alpatechLogoDataUrl = "") {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const width = pageWidth - margin * 2;
  const primary = branding.primaryRgb || [15, 118, 110];

  doc.setFillColor(primary[0], primary[1], primary[2]);
  drawEmployeePdfRoundedRect(doc, margin, 10, width, 28, 4, "F");

  if (branding.isAlpatech) {
    doc.setFillColor(255, 255, 255);
    drawEmployeePdfRoundedRect(doc, margin + 5, 15, 17, 18, 3, "F");

    if (alpatechLogoDataUrl) {
      try {
        doc.addImage(alpatechLogoDataUrl, "PNG", margin + 10, 17.5, 7, 13);
      } catch (error) {
        console.warn("[SS] Alpatech PDF logo could not be added.", error);
      }
    } else {
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("A", margin + 13.5, 26.8, { align: "center" });
    }
  }

  const brandTextX = branding.isAlpatech ? margin + 27 : margin + 5;

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(
    String(branding.brandName || branding.companyName || "BexHR"),
    brandTextX,
    20.5,
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    String(branding.documentLabel || "Confidential Payroll Payslip"),
    brandTextX,
    27,
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(
    String(branding.payCycle || "Payroll"),
    pageWidth - margin - 5,
    19,
    { align: "right" },
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    `Pay date: ${branding.payDate || "--"}`,
    pageWidth - margin - 5,
    24.5,
    { align: "right" },
  );
  doc.text(
    `Status: ${branding.status || "Authorised"}`,
    pageWidth - margin - 5,
    29.5,
    { align: "right" },
  );
}
function drawEmployeePayslipPdfInfoCard(doc, x, y, width, height, title, rows, branding, options = {}) {
  const border = branding.borderRgb;
  const soft = options.softRgb || branding.softRgb;

  doc.setFillColor(soft[0], soft[1], soft[2]);
  doc.setDrawColor(border[0], border[1], border[2]);
  drawEmployeePdfRoundedRect(doc, x, y, width, height, 3, "FD");

  doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(String(title || "Details").toUpperCase(), x + 5, y + 7);

  let rowY = y + 13;
  rows.filter(Boolean).forEach((row) => {
    const label = String(row.label || "");
    const value = String(row.value || "--");

    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.text(label, x + 5, rowY);

    doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 9 : 8);
    const valueLines = doc.splitTextToSize(value, width - 35);
    doc.text(valueLines, x + width - 5, rowY, { align: "right" });
    rowY += Math.max(5.2, valueLines.length * 4.1);
  });
}

function drawEmployeePayslipPdfSummaryCard(doc, x, y, width, label, value, branding, type = "default") {
  const fills = {
    default: branding.softRgb,
    warning: [255, 248, 235],
    success: [238, 250, 244],
  };
  const borders = {
    default: branding.borderRgb,
    warning: [245, 205, 138],
    success: [167, 220, 196],
  };
  const fill = fills[type] || fills.default;
  const border = borders[type] || borders.default;

  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(border[0], border[1], border[2]);
  drawEmployeePdfRoundedRect(doc, x, y, width, 22, 3, "FD");

  doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.text(String(label || "").toUpperCase(), x + 5, y + 7);

  doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(String(value || "--"), x + 5, y + 16);
}

function drawEmployeePayslipPdfStructureCard(doc, x, y, width, items, allocationText, branding) {
  const visible = items.filter((item) => item && item.label);
  const rowCount = Math.ceil(visible.length / 2);
  const height = 16 + rowCount * 7 + (allocationText ? 10 : 0);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
  drawEmployeePdfRoundedRect(doc, x, y, width, height, 3, "FD");

  doc.setTextColor(branding.primaryDarkRgb[0], branding.primaryDarkRgb[1], branding.primaryDarkRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Salary Structure", x + 5, y + 9);

  const columnWidth = (width - 15) / 2;
  visible.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const itemX = x + 5 + column * (columnWidth + 5);
    const itemY = y + 17 + row * 7;

    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(String(item.label), itemX, itemY);

    doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    const value = doc.splitTextToSize(String(item.value || "--"), columnWidth - 2);
    doc.text(value, itemX, itemY + 3.6);
  });

  if (allocationText) {
    const allocationY = y + 17 + rowCount * 7;
    doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
    doc.line(x + 5, allocationY - 2.5, x + width - 5, allocationY - 2.5);
    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.7);
    doc.text("ALLOCATION SPLIT", x + 5, allocationY + 1.5);
    doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
    doc.setFont("helvetica", "normal");
    doc.text(String(allocationText), x + 5, allocationY + 5.3);
  }

  return height;
}

function drawEmployeePayslipPdfBreakdownCard(doc, x, y, width, title, rows, totalLabel, totalValue, branding, accentRgb) {
  const visibleRows = rows.length ? rows : [{ label: "No items recorded", value: "--", muted: true }];
  const rowHeight = 5.2;
  const height = 18 + visibleRows.length * rowHeight + 10;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
  drawEmployeePdfRoundedRect(doc, x, y, width, height, 3, "FD");
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  drawEmployeePdfRoundedRect(doc, x, y, width, 3, 3, "F");

  doc.setTextColor(branding.primaryDarkRgb[0], branding.primaryDarkRgb[1], branding.primaryDarkRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(String(title), x + 5, y + 11);

  let rowY = y + 18;
  visibleRows.forEach((row, index) => {
    doc.setTextColor(
      row.muted ? branding.mutedRgb[0] : branding.textRgb[0],
      row.muted ? branding.mutedRgb[1] : branding.textRgb[1],
      row.muted ? branding.mutedRgb[2] : branding.textRgb[2],
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.4);
    doc.text(String(row.label || ""), x + 5, rowY);
    doc.setFont("helvetica", "bold");
    doc.text(String(row.value || "--"), x + width - 5, rowY, { align: "right" });

    if (index < visibleRows.length - 1) {
      doc.setDrawColor(234, 240, 245);
      doc.line(x + 5, rowY + 1.7, x + width - 5, rowY + 1.7);
    }
    rowY += rowHeight;
  });

  doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
  doc.line(x + 5, rowY - 1.5, x + width - 5, rowY - 1.5);
  doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(String(totalLabel), x + 5, rowY + 3.5);
  doc.text(String(totalValue), x + width - 5, rowY + 3.5, { align: "right" });

  return height;
}

function drawEmployeePayslipPdfPageFooter(doc, branding, employeeName) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
    doc.line(12, pageHeight - 12, pageWidth - 12, pageHeight - 12);
    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(`${branding.footerText} Employee: ${employeeName}.`, 12, pageHeight - 7);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 12, pageHeight - 7, { align: "right" });
  }
}

async function downloadPayslipPdf(payrollId, buttonElement) {
  const originalButtonHtml = buttonElement?.innerHTML || "";

  try {
    clearPageAlert();

    const record = state.payrollRecords.find((row) => String(row.id) === String(payrollId));
    if (!record) {
      showPageAlert("danger", "Payroll record not found.");
      return;
    }

    if (!window.jspdf?.jsPDF) {
      showPageAlert("danger", "PDF library (jsPDF) is not available. Please refresh the page.");
      return;
    }

    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Preparing PDF...`;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const employee = getEmployeePayslipPdfEmployeeContext();
    const currency = (record.currency || "NGN").toUpperCase();
    const money = (value) => formatCurrency(value, currency);
    const branding = getEmployeePayslipPdfBranding(record);
    const logoDataUrl = branding.isAlpatech
      ? await loadEmployeePayslipImageAsDataUrl("assets/alpatech-flame.png")
      : "";

    drawEmployeePayslipPdfHeader(doc, branding, logoDataUrl);

    const margin = 12;
    const usableWidth = 186;
    const gap = 4;
    const halfWidth = (usableWidth - gap) / 2;

    drawEmployeePayslipPdfInfoCard(
      doc,
      margin,
      44,
      halfWidth,
      38,
      "Employee",
      [
        { label: "Name", value: employee.employeeName, bold: true },
        { label: "Employee No.", value: employee.employeeId },
        { label: "Department", value: employee.department },
        { label: "Job Title", value: employee.jobTitle },
      ],
      branding,
    );

    drawEmployeePayslipPdfInfoCard(
      doc,
      margin + halfWidth + gap,
      44,
      halfWidth,
      38,
      "Pay Details",
      [
        { label: "Pay Cycle", value: record.pay_cycle || "--", bold: true },
        { label: "Pay Date", value: formatDate(record.pay_date) },
        { label: "Status", value: record.status || "Authorised" },
        { label: "Currency", value: currency },
      ],
      branding,
      { softRgb: [248, 250, 252] },
    );

    const summaryWidth = (usableWidth - gap * 2) / 3;
    drawEmployeePayslipPdfSummaryCard(doc, margin, 87, summaryWidth, "Gross Pay", money(record.gross_pay), branding, "default");
    drawEmployeePayslipPdfSummaryCard(doc, margin + summaryWidth + gap, 87, summaryWidth, "Total Deductions", money(record.total_deductions), branding, "warning");
    drawEmployeePayslipPdfSummaryCard(doc, margin + (summaryWidth + gap) * 2, 87, summaryWidth, "Net Pay", money(record.net_pay), branding, "success");

    const percent = (value) => {
      const numericValue = Number(value || 0);
      if (!Number.isFinite(numericValue) || numericValue === 0) return "0.0%";
      return `${(Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue).toFixed(1)}%`;
    };

    // EMPLOYEE-FACING PAYSLIP DATA MINIMISATION - STEP 3
    // Keep the PDF business-readable and exclude technical model/version,
    // structure-variant, layout, and allocation-configuration identifiers.
    const structureHeight = drawEmployeePayslipPdfStructureCard(
      doc,
      margin,
      114,
      usableWidth,
      [
        {
          label: "Pay Type",
          value: record.employee_group || record.payroll_model || "Regular",
        },
        { label: "Increment", value: percent(record.increment_percent) },
        { label: "Monthly Gross", value: money(record.gross_pay) },
      ],
      "",
      branding,
    );

    const earningsRows = [
      ["Basic Pay", record.basic_pay],
      ["Housing Allowance", record.housing_allowance],
      ["Transport Allowance", record.transport_allowance],
      ["Utility Allowance", record.utility_allowance],
      ["Medical Allowance", record.medical_allowance],
      ["Other Allowance", record.other_allowance],
      ["Bonus", record.bonus],
      ["Overtime", record.overtime],
      ["Logistics Allowance", record.logistics_allowance],
      ["Data / Airtime", record.data_airtime_allowance],
    ]
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([label, value]) => ({ label, value: money(value) }));

    const deductionRows = [
      ["PAYE Tax", record.paye_tax],
      ["WHT Tax", record.wht_tax],
      ["Employee Pension", record.employee_pension],
      ["Other Deductions", record.other_deductions],
    ]
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([label, value]) => ({ label, value: money(value) }));

    const breakdownY = 114 + structureHeight + 5;
    const earningsHeight = 18 + Math.max(earningsRows.length, 1) * 5.2 + 10;
    const deductionsHeight = 18 + Math.max(deductionRows.length, 1) * 5.2 + 10;
    const breakdownHeight = Math.max(earningsHeight, deductionsHeight);

    drawEmployeePayslipPdfBreakdownCard(
      doc,
      margin,
      breakdownY,
      halfWidth,
      "Earnings",
      earningsRows,
      "Gross Pay",
      money(record.gross_pay),
      branding,
      branding.accentRgb,
    );

    drawEmployeePayslipPdfBreakdownCard(
      doc,
      margin + halfWidth + gap,
      breakdownY,
      halfWidth,
      "Deductions",
      deductionRows,
      "Total Deductions",
      money(record.total_deductions),
      branding,
      branding.warningRgb,
    );

    const netY = breakdownY + breakdownHeight + 5;
    doc.setFillColor(branding.successRgb[0], branding.successRgb[1], branding.successRgb[2]);
    drawEmployeePdfRoundedRect(doc, margin, netY, usableWidth, 18, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("AMOUNT PAYABLE", margin + 6, netY + 6.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Net Pay", margin + 6, netY + 13);
    doc.setFontSize(15);
    doc.text(money(record.net_pay), margin + usableWidth - 6, netY + 11.5, { align: "right" });

    const noteY = netY + 23;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
    drawEmployeePdfRoundedRect(doc, margin, noteY, usableWidth, 14, 3, "FD");
    doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.3);
    doc.text("Confidential employee document", margin + 5, noteY + 5.5);
    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.7);
    doc.text(
      "This payslip is intended only for the named employee and must be shared through approved company channels.",
      margin + 5,
      noteY + 10.2,
    );

    drawEmployeePayslipPdfPageFooter(doc, branding, employee.employeeName);

    const safePayCycle = (record.pay_cycle || "Payslip").replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    const safeName = employee.employeeName.replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "Staff";
    const prefix = branding.filePrefix ? `${branding.filePrefix}-` : "";

    doc.save(`${prefix}${safeName}-Payslip-${safePayCycle}.pdf`);
    showPageAlert("success", "Payslip PDF downloaded successfully.");
  } catch (error) {
    console.error("[SS] PDF generation error:", error);
    showPageAlert("danger", "Payslip PDF could not be generated.");
  } finally {
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.innerHTML = originalButtonHtml || `<i class="bi bi-file-earmark-pdf"></i>`;
    }
  }
}




// EMPLOYEE PAYROLL TEXT AND ACTION REPAIR - v1.0.0
// Encoding-safe masking, payslip metadata separator, and action restoration.
// Payroll queries, calculations, authorisation, tenant filtering and PDF
// generation behaviour remain unchanged.
function setPayslipDownloadLoading(buttonElement, isLoading) {
  if (!buttonElement) return;

  buttonElement.disabled = isLoading;

  if (isLoading) {
    buttonElement.innerHTML = `
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
    `;
    buttonElement.title = "Generating payslip PDF";
    buttonElement.setAttribute("aria-label", "Generating payslip PDF");
    return;
  }

  // EMPLOYEE UI CLEANUP - STEP 1E
  // Restore icon-only PDF action after payslip generation completes.
  buttonElement.innerHTML = `<i class="bi bi-file-earmark-pdf" aria-hidden="true"></i><span>Download PDF</span>`;
  buttonElement.title = "Download payslip PDF";
  buttonElement.setAttribute("aria-label", "Download payslip PDF");
}

/* =========================================================
   Common helpers
========================================================= */
// EMPLOYEE LEAVE DYNAMIC RENDER PARITY - v1.0.0
// Match the approved HR/Manager outlined self-service status pill.
// Presentation only. No leave status or workflow logic changes.
function renderEmployeeModernLeaveStatusPill(status = "") {
  const label = String(status || "Pending Approval").trim();
  const normalized = normalizeText(label);

  const successStates = new Set([
    "active",
    "approved",
    "authorised",
    "available",
    "completed",
    "finalised",
    "paid",
  ]);

  const warningStates = new Set([
    "low balance",
    "pending",
    "pending approval",
    "returned",
    "returned for clarification",
  ]);

  const dangerStates = new Set([
    "cancelled",
    "declined",
    "failed",
    "fully used",
    "rejected",
  ]);

  const iconByStatus = {
    active: "bi-check-circle-fill",
    approved: "bi-check-circle-fill",
    authorised: "bi-check-circle-fill",
    available: "bi-check-circle-fill",
    cancelled: "bi-x-circle-fill",
    completed: "bi-check-circle-fill",
    declined: "bi-x-circle-fill",
    failed: "bi-x-circle-fill",
    finalised: "bi-lock-fill",
    "fully used": "bi-x-circle-fill",
    "low balance": "bi-exclamation-circle-fill",
    paid: "bi-cash-coin",
    pending: "bi-clock-fill",
    "pending approval": "bi-clock-fill",
    rejected: "bi-x-circle-fill",
    returned: "bi-arrow-return-left",
    "returned for clarification": "bi-arrow-return-left",
  };

  let toneClass = "bexhr-status-pill--neutral";

  if (successStates.has(normalized)) {
    toneClass = "bexhr-status-pill--success";
  } else if (warningStates.has(normalized)) {
    toneClass = "bexhr-status-pill--warning";
  } else if (dangerStates.has(normalized)) {
    toneClass = "bexhr-status-pill--danger";
  }

  return `
    <span class="bexhr-status-pill ${toneClass}">
      <i
        class="bi ${iconByStatus[normalized] || "bi-circle-fill"}"
        aria-hidden="true"
      ></i>
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}
function getDecisionStatusBadgeClass(status) {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "text-bg-success";
    case "cancelled":
      return "text-bg-secondary";
    case "rejected":
      return "text-bg-danger";
    case "returned":
    case "returned for clarification":
      return "text-bg-warning";
    case "pending approval":
    default:
      return "text-bg-secondary";
  }
}

function showPageAlert(type, message) {
  if (!state.dom.pageAlert) return;
  state.dom.pageAlert.className = `alert alert-${type} mb-4`;
  state.dom.pageAlert.textContent = message;
  state.dom.pageAlert.classList.remove("d-none");
}

function clearPageAlert() {
  if (!state.dom.pageAlert) return;
  state.dom.pageAlert.className = "alert d-none mb-4";
  state.dom.pageAlert.textContent = "";
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Creates a lightweight bottom-right toast from JS so employee-dashboard.html
// does not need a structural patch. This is notification-only.
function ensureEmployeeDashboardToast() {
  let toast = document.getElementById("employeeDashboardToast");

  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = "employeeDashboardToast";
  toast.className =
    "position-fixed bottom-0 end-0 m-4 bg-white border shadow-lg rounded-4 overflow-hidden d-none";
  toast.style.zIndex = "1080";
  toast.style.width = "calc(100% - 2rem)";
  toast.style.maxWidth = "360px";

  toast.innerHTML = `
    <div id="employeeDashboardToastAccent" class="bg-primary" style="height: 4px;"></div>

    <div class="d-flex align-items-start gap-3 p-3">
      <div id="employeeDashboardToastIcon"
        class="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-bg-primary"
        style="width: 36px; height: 36px;">
        <i class="bi bi-info-circle"></i>
      </div>

      <div class="flex-grow-1">
        <div id="employeeDashboardToastTitle" class="fw-semibold">
          Notification
        </div>
        <div id="employeeDashboardToastMessage" class="small text-secondary mt-1">
        </div>
      </div>

      <button type="button" id="employeeDashboardToastCloseBtn"
        class="btn btn-sm btn-link text-secondary p-0"
        aria-label="Close notification">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  `;

  document.body.appendChild(toast);

  toast
    .querySelector("#employeeDashboardToastCloseBtn")
    ?.addEventListener("click", hideEmployeeDashboardToast);

  return toast;
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Bottom-right employee feedback. Used after successful leave submission so
// the employee sees confirmation even when the top alert is out of view.
function showEmployeeDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = ensureEmployeeDashboardToast();

  const accent = toast.querySelector("#employeeDashboardToastAccent");
  const icon = toast.querySelector("#employeeDashboardToastIcon");
  const titleEl = toast.querySelector("#employeeDashboardToastTitle");
  const messageEl = toast.querySelector("#employeeDashboardToastMessage");

  const themeMap = {
    success: {
      accentClass: "bg-success",
      iconClass: "text-bg-success",
      iconHtml: '<i class="bi bi-check-circle"></i>',
    },
    warning: {
      accentClass: "bg-warning",
      iconClass: "text-bg-warning",
      iconHtml: '<i class="bi bi-exclamation-triangle"></i>',
    },
    danger: {
      accentClass: "bg-danger",
      iconClass: "text-bg-danger",
      iconHtml: '<i class="bi bi-x-octagon"></i>',
    },
    info: {
      accentClass: "bg-primary",
      iconClass: "text-bg-primary",
      iconHtml: '<i class="bi bi-info-circle"></i>',
    },
  };

  const theme = themeMap[type] || themeMap.info;

  if (accent) {
    accent.className = theme.accentClass;
    accent.style.height = "4px";
  }

  if (icon) {
    icon.className =
      `rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 ${theme.iconClass}`;
    icon.style.width = "36px";
    icon.style.height = "36px";
    icon.innerHTML = theme.iconHtml;
  }

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message || "";

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideEmployeeDashboardToast();
  }, 8000);
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Hide the toast without touching leave form, history, balance, or payroll data.
function hideEmployeeDashboardToast() {
  const toast = document.getElementById("employeeDashboardToast");
  toast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

function formatDate(dateValue) {
  if (!dateValue) return "--";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateValue) {
  if (!dateValue) return "--";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value, currency = "NGN") {
  const numericValue = Number(value || 0);
  const resolvedCurrency = String(currency || "NGN").toUpperCase();

  if (resolvedCurrency === "NGN") {
    return `NGN ${numericValue.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
  } catch (error) {
    return `${resolvedCurrency} ${numericValue.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
