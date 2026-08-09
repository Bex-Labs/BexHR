// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the old scroll position before the selected
// workspace finishes loading. Keep restoration manual so refresh always lands
// at the top of the restored Manager workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Manager dashboard scroll restoration could not be set to manual.", error);
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindEvents();

    const access = await window.SessionManager.protectPage("manager");

    if (!access) return;

    state.currentUser = access.session.user;
    state.currentProfile = access.profile;

    await loadLatestManagerProfile();

    // ALPATECH TENANT BRANDING - MANAGER STEP 1D
    // Apply final tenant-scoped Manager Dashboard branding after the signed-in
    // manager profile has loaded. Non-Alpatech tenants are reset to BexHR.
    applyManagerTenantWorkspaceShellBranding();

    renderManagerProfile(state.currentProfile, access.session.user);

    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Fresh login opens Dashboard because logout clears workspace memory.
    // Browser refresh restores the last Manager workspace and lands at the top.
    restoreManagerWorkspaceAfterRefresh();

    // MANAGER WORKSPACE FIRST PAINT FINALISATION - v1.0.2
    // Match the HR dashboard first-paint gate: reveal the exact remembered
    // Manager workspace as soon as profile, tenant branding, navigation,
    // title, and subtitle are restored. Longer team/leave loads continue progressively.


    initialiseDecisionModal();
    initialiseManagerLeaveDelegationUi();

    window.managerHandleLeaveAction = function (leaveId, action, button) {
      openDecisionModal(leaveId, action, button);
    };

    window.managerOpenEmployeeDetails = function (employeeId) {
      openManagerEmployeeDetails(employeeId);
    };

    // SYSTEM-WIDE WORKSPACE LOADER UPGRADE - MANAGER STEP 2
    // Start the existing Manager data refresh, but do not keep the entire
    // application shell hidden while team, leave, schedule, and coverage data load.
    //
    // Security and behaviour remain unchanged:
    // - protectPage("manager") has already completed;
    // - the latest authenticated Manager profile is already loaded;
    // - tenant branding and remembered navigation are already restored;
    // - existing reporting-line, leave, delegation, RLS, and Supabase logic
    //   continues through refreshManagerWorkspace().
    const managerWorkspaceRefreshPromise = refreshManagerWorkspace();

    // Reveal the authenticated Manager shell immediately after profile,
    // tenant branding, navigation, title, and subtitle are ready.
    // Dashboard values and the responsibility badge continue progressively.
    revealRestoredManagerWorkspace();

    // Wait for the existing Manager refresh to finish so startup failures
    // still flow through the surrounding error handler.
    await managerWorkspaceRefreshPromise;

    if (state.dom.managerRole) {
      state.dom.managerRole.setAttribute("aria-busy", "false");
    }
  } catch (error) {
    console.error("Error initialising manager dashboard:", error);

    // MANAGER WORKSPACE FIRST PAINT FINALISATION - v1.0.2
    // Never leave the Manager application hidden if startup fails after the
    // first-paint gate has been applied.
    document.body?.classList.remove("manager-workspace-booting");
    document.body?.setAttribute("aria-busy", "false");

    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the manager dashboard.",
    );
  }
});

const PROFILE_IMAGES_BUCKET = "profile-images";
// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Manager workspace tab for refresh recovery.
// No employee, leave, decision, comment, or team data is stored.
const MANAGER_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastManagerWorkspace";

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by manager-dashboard.html to avoid first-paint
// Profile flash before manager-dashboard.js completes authentication startup.
const MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastManagerWorkspace:last";

const state = {
  currentUser: null,
  currentProfile: null,
  currentManagerEmployeeRecord: null,

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // Stores the last loaded/saved editable profile values.
  // Save Profile Changes should only activate when the manager changes these values.
  currentProfileEditableBaseline: null,

  teamMembers: [],
  filteredTeamMembers: [],
  pendingLeaveRequests: [],
  processedLeaveRequests: [],
  teamLeaveSchedule: [],

  // LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
  // In-memory FYI tracking for additional reporting managers.
  // This prevents the same processed leave decision toast from repeating
  // continuously during the same browser session.
  seenAdditionalManagerLeaveDecisionFyiKeys: new Set(),

  pendingProfileImageFile: null,
  pendingDecisionAction: null,
  pendingDecisionRequest: null,
  pendingDecisionButton: null,
  leaveDecisionModal: null,

  // TEMPORARY DELEGATED LEAVE AUTHORITY - v1.0.0
  managerLeaveDelegationContext: {
    eligible_delegates: [],
    active_granted: [],
    active_received: [],
  },
  managerLeaveDelegationModal: null,

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Controls the temporary bottom-right manager notification.
  dashboardToastTimeoutId: null,

  // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
  // In-memory only. This compares the currently visible manager team before
  // and after a refresh/focus reload so the manager gets a toast when HR adds
  // or removes employees from their reporting line.
  // No team, employee, leave, payroll, or decision data is written to browser storage.
  hasLoadedTeamAssignmentSnapshot: false,
  isTeamAssignmentFocusRefreshInProgress: false,
  lastTeamAssignmentFocusRefreshAt: 0,

  dom: {},
};

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these top-level Manager workspaces are safe to restore after refresh.
function isValidManagerWorkspaceKey(workspace = "") {
  return ["dashboard", "profile", "team", "selfservice"].includes(String(workspace || "").trim());
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Resolve a tenant/company scope where available so one company/user context
// does not bleed into another. Manager pages do not need to store operational data.
function getManagerWorkspaceTenantScope() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    const tenantContext = rawContext ? JSON.parse(rawContext) : null;

    return String(
      tenantContext?.tenantId ||
      state.currentProfile?.tenant_id ||
      "no-tenant",
    ).trim();
  } catch (error) {
    console.warn("Manager tenant context could not be read for workspace memory.", error);

    return String(state.currentProfile?.tenant_id || "no-tenant").trim();
  }
}

// ALPATECH TENANT BRANDING - MANAGER STEP 1D
// Read the already validated tenant context created during login.
// This is used only for Manager Dashboard visual branding and does not
// change team visibility, leave approval, self-service, payroll, or access logic.
function getManagerTenantContextForBranding() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    return rawContext ? JSON.parse(rawContext) : null;
  } catch (error) {
    console.warn("Manager tenant branding context could not be read.", error);
    return null;
  }
}

// ALPATECH TENANT BRANDING - MANAGER STEP 1D
// Detect only Alpatech from the validated tenant/company context.
// Non-Alpatech tenants must keep the shared BexHR Manager Dashboard shell.
function isCurrentManagerTenantAlpatechWorkspace() {
  const tenantContext = getManagerTenantContextForBranding();

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

// ALPATECH TENANT BRANDING - MANAGER STEP 1D
// Browser tab icon only. The icon changes only for Alpatech managers.
function applyManagerTenantFaviconBranding() {
  const favicon = document.querySelector("link[rel~='icon']");

  if (!favicon) return;

  if (isCurrentManagerTenantAlpatechWorkspace()) {
    favicon.type = "image/x-icon";
    favicon.href = "assets/favicon.ico?v=20260725-1";
    return;
  }

  favicon.type = "image/x-icon";
  favicon.href = "assets/favicon.png";
}

// MANAGER DASHBOARD VISUAL REFRESH - STEP 1
// Resolve only the display name used by the compact manager app header.
// This reads the existing validated tenant/profile context and does not change
// authentication, roles, reporting lines, leave visibility, or Supabase access.
function getManagerModernWorkspaceCompanyName() {
  if (isCurrentManagerTenantAlpatechWorkspace()) return "ALPATECH";

  const tenantContext = getManagerTenantContextForBranding();

  return String(
    tenantContext?.companyName ||
    state.currentProfile?.company_name ||
    "BexHR Workspace",
  ).trim() || "BexHR Workspace";
}

// MANAGER DASHBOARD VISUAL REFRESH - STEP 1
// Presentation-only workspace copy for the compact app header.
function getManagerModernWorkspaceHeaderContent(workspace = "dashboard") {
  if (workspace === "profile") {
    return {
      title: "My Profile",
      subtitle: "Review your account details and keep your manager profile up to date.",
    };
  }

  if (workspace === "team") {
    return {
      title: "Team Management",
      subtitle: "Review assigned employees, leave activity, approvals, and team coverage.",
    };
  }

  if (workspace === "selfservice") {
    return {
      title: "My Self-Service",
      subtitle: "Manage your own leave requests, payslips, and payroll history.",
    };
  }

  return {
    title: "Manager Overview",
    subtitle: "See team priorities, leave activity, and manager readiness at a glance.",
  };
}

// MANAGER DASHBOARD VISUAL REFRESH - STEP 1
// Keep the visible manager header aligned with the existing workspace state.
function renderManagerModernWorkspaceHeader(workspace = "dashboard") {
  const content = getManagerModernWorkspaceHeaderContent(workspace);
  const fullName = String(state.currentProfile?.full_name || "Manager").trim();

  if (state.dom.managerModernCompanyName) {
    state.dom.managerModernCompanyName.textContent = getManagerModernWorkspaceCompanyName();
  }

  if (state.dom.managerModernPageTitle) {
    state.dom.managerModernPageTitle.textContent = content.title;
  }

  if (state.dom.managerModernPageSubtitle) {
    state.dom.managerModernPageSubtitle.textContent = content.subtitle;
  }

  if (state.dom.managerModernUserName) {
    state.dom.managerModernUserName.textContent = fullName || "Manager";
  }
}

// ALPATECH TENANT BRANDING - MANAGER STEP 1D
// Tenant-scoped Manager Dashboard shell branding.
// This changes visible branding only. It does not change team records,
// reporting-line visibility, leave approval, self-service, payroll,
// payslip, Supabase, session, or role/access behaviour.
function applyManagerTenantWorkspaceShellBranding() {
  const sidebarBrand = document.getElementById("tenantSidebarBrand");
  const heroBrandingBlock = document.getElementById("tenantHeroBrandingBlock");

  applyManagerTenantFaviconBranding();

  if (isCurrentManagerTenantAlpatechWorkspace()) {
    document.body?.classList.add("alpatech-workspace");
    document.title = "Alpatech Manager Workspace | BexHR";

    if (sidebarBrand) {
      sidebarBrand.className = "bexhr-sidebar-brand alpatech-sidebar-brand";
      sidebarBrand.innerHTML = `
        <!-- ALPATECH TENANT BRANDING - MANAGER STEP 1D
             Flame icon only. CSS renders the ALPATECH wordmark beside it. -->
        <span class="alpatech-brand-mark" aria-hidden="true">
          <img src="assets/alpatech-flame.png" alt="" />
        </span>
      `;
    }

    if (heroBrandingBlock) {
      heroBrandingBlock.innerHTML = `
        <!-- ALPATECH TENANT BRANDING - MANAGER STEP 1D
             Brand only the signed-in Alpatech Manager workspace shell. -->
        <div class="alpatech-hero-content">
          <div class="alpatech-hero-kicker-row">
            <div class="alpatech-hero-brand" aria-label="Alpatech Manager Workspace">
              <span class="alpatech-brand-mark alpatech-hero-mark" aria-hidden="true">
                <img src="assets/alpatech-flame.png" alt="" />
              </span>
              <span class="alpatech-brand-wordmark">ALPATECH</span>
            </div>

            <div class="hero-badge alpatech-hero-badge">
              <i class="bi bi-diagram-3"></i>
              Manager Workspace
            </div>
          </div>

          <h1 class="display-6 fw-bold mb-2">Team Operations Dashboard</h1>
          <p class="mb-0 alpatech-hero-copy">
            Review Alpatech team records, leave activity, manager decisions, and your own self-service workspace from one secure dashboard.
          </p>
        </div>
      `;
    }

    renderManagerModernWorkspaceHeader(getRememberedManagerWorkspace());
    document.body?.classList.remove("alpatech-branding-resolving");
    return;
  }

  // ALPATECH TENANT BRANDING - MANAGER STEP 1D
  // Reset shared app branding for every non-Alpatech tenant.
  document.body?.classList.remove("alpatech-workspace", "alpatech-branding-resolving");
  document.title = "Manager Dashboard | BexHR";

  if (sidebarBrand) {
    sidebarBrand.className = "bexhr-sidebar-brand";
    sidebarBrand.innerHTML = `
      <span class="hr-brand-mark" style="width:34px;height:34px;font-size:0.8rem;">MG</span>
    `;
  }

  if (heroBrandingBlock) {
    heroBrandingBlock.innerHTML = `
      <div class="hero-badge">
        <i class="bi bi-diagram-3"></i>
        Team Management
      </div>
      <h1 class="display-6 fw-bold mb-2">Manager Dashboard</h1>
      <p class="mb-0" style="max-width: 760px">
        View assigned employees, review team leave activity, approve leave
        requests, and manage your own profile details.
      </p>
    `;
  }

  renderManagerModernWorkspaceHeader(getRememberedManagerWorkspace());
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope the stored workspace to the signed-in manager and company context.
function getManagerWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();
  const tenantScope = getManagerWorkspaceTenantScope();

  return `${MANAGER_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}:${tenantScope}`;
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active workspace key. Do not store leave, employee, team,
// decision, comment, or manager-sensitive data in browser storage.
// In-memory fallback survives the page session even when
// sessionStorage is blocked by browser tracking prevention.
let _managerWorkspaceInMemory = null;

function rememberManagerWorkspace(workspace = "") {
  if (!isValidManagerWorkspaceKey(workspace)) return;

  _managerWorkspaceInMemory = workspace;

  try {
    sessionStorage.setItem(getManagerWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to manager-dashboard.js.
    sessionStorage.setItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Manager workspace memory could not be saved.", error);
  }
}

// MANAGER PAYSLIP EMAIL DEEP LINK ROUTING - STEP 3A
// Resolve only safe Manager dashboard workspace requests from the URL.
// This allows a payslip email link to open Manager > My Self-Service > Payroll
// without putting payroll IDs, salary values, bank details, or employee IDs in the URL.
function getRequestedManagerWorkspaceFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");

    const requestedWorkspace = String(params.get("workspace") || "")
      .trim()
      .toLowerCase();

    const requestedSection = String(params.get("section") || "")
      .trim()
      .toLowerCase();

    // Payslip email safe link formats supported:
    // manager-dashboard.html?workspace=selfservice&section=payroll
    // manager-dashboard.html?section=payroll
    if (
      requestedSection === "payroll" &&
      (!requestedWorkspace || requestedWorkspace === "selfservice")
    ) {
      return "selfservice";
    }

    if (isValidManagerWorkspaceKey(requestedWorkspace)) {
      return requestedWorkspace;
    }
  } catch (error) {
    console.warn("Manager workspace URL request could not be resolved.", error);
  }

  return "";
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered workspace for this manager session.
// Fresh login naturally falls back to Dashboard after logout clears the keys.
function getRememberedManagerWorkspace() {
  // MANAGER PAYSLIP EMAIL DEEP LINK ROUTING - STEP 3A
  // URL request wins over remembered workspace so a payslip email link can
  // deliberately open Manager > My Self-Service > Payroll after login.
  const requestedWorkspace = getRequestedManagerWorkspaceFromUrl();

  if (isValidManagerWorkspaceKey(requestedWorkspace)) {
    return requestedWorkspace;
  }

  // Prefer in-memory value (set when user clicks a tab this session).
  if (isValidManagerWorkspaceKey(_managerWorkspaceInMemory)) return _managerWorkspaceInMemory;

  try {
    const scopedWorkspace = sessionStorage.getItem(getManagerWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY);
    const workspace = scopedWorkspace || bootWorkspace || "dashboard";

    return isValidManagerWorkspaceKey(workspace) ? workspace : "dashboard";
  } catch (error) {
    console.warn("Manager workspace memory could not be read.", error);
    return "dashboard";
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout must reset the next Manager session to Dashboard.
function clearRememberedManagerWorkspace() {
  try {
    sessionStorage.removeItem(getManagerWorkspaceMemoryKey());
    sessionStorage.removeItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Manager workspace memory could not be cleared.", error);
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceManagerDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateManagerBackToTopButtonVisibility();

  // MANAGER HELP GUIDE CONTEXTUAL NAVIGATION - v1.0.2
  bindManagerGuideContextualNavigation();
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Manager workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long pages.
// MANAGER WORKSPACE FIRST PAINT FINALISATION - v1.0.2
// Release the shared branded loader only after the exact Manager workspace,
// tenant branding, profile, navigation, title, and subtitle are restored.
// Longer team, leave, schedule, and self-service data loads continue progressively.
function revealRestoredManagerWorkspace() {
  document.body?.classList.remove("manager-workspace-booting");
  document.body?.setAttribute("aria-busy", "false");

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  updateManagerBackToTopButtonVisibility();
}
function restoreManagerWorkspaceAfterRefresh() {
  const workspace = getRememberedManagerWorkspace();

  switchManagerWorkspace(workspace);

  // MANAGER PAYSLIP EMAIL DEEP LINK ROUTING - STEP 3A
  // If a payslip email link or remembered workspace opens My Self-Service,
  // initialise the shared self-service module immediately. Without this,
  // the Manager workspace can show the shell but not load Payroll/Leave data.
  if (workspace === "selfservice") {
    initManagerSelfServiceOnFirstOpen();
  }

  forceManagerDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceManagerDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceManagerDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceManagerDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceManagerDashboardToTopAfterRefresh, 150);
}

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error(
      "Supabase client is not available on window.supabaseClient.",
    );
  }

  return window.supabaseClient;
}

function cacheDomElements() {
  state.dom = {
    pageAlert: document.getElementById("pageAlert"),

    logoutBtn: document.getElementById("logoutBtn"),
    refreshTeamBtn: document.getElementById("refreshTeamBtn"),
    teamSearchInput: document.getElementById("teamSearchInput"),

    managerTabProfileBtn: document.getElementById("managerTabProfileBtn"),
    managerTabDashboardBtn: document.getElementById("managerTabDashboardBtn"),
    managerTabTeamBtn: document.getElementById("managerTabTeamBtn"),

    // EMPLOYEE SELF-SERVICE - MANAGER
    // Self-Service workspace tab and section for Managers to manage their own
    // leave and payroll as if they were using the employee dashboard.
    managerTabSelfServiceBtn: document.getElementById("managerTabSelfServiceBtn"),
    managerDashboardSection: document.getElementById("managerDashboardSection"),
    managerProfileSection: document.getElementById("managerProfileSection"),
    managerTeamSection: document.getElementById("managerTeamSection"),

    // EMPLOYEE SELF-SERVICE - MANAGER
    managerSelfServiceSection: document.getElementById("managerSelfServiceSection"),

    managerEmail: document.getElementById("managerEmail"),
    managerRole: document.getElementById("managerRole"),
    managerModuleValue: document.getElementById("managerModuleValue"),
    managerInitials: document.getElementById("managerInitials"),
    managerHeroImage: document.getElementById("managerHeroImage"),

    // MANAGER DASHBOARD VISUAL REFRESH - STEP 1
    // Compact app-header presentation hooks only.
    managerModernCompanyName: document.getElementById("managerModernCompanyName"),
    managerModernPageTitle: document.getElementById("managerModernPageTitle"),
    managerModernPageSubtitle: document.getElementById("managerModernPageSubtitle"),
    managerModernUserName: document.getElementById("managerModernUserName"),

    managerFullName: document.getElementById("managerFullName"),
    managerEmailTile: document.getElementById("managerEmailTile"),
    managerRoleTile: document.getElementById("managerRoleTile"),
    managerDepartment: document.getElementById("managerDepartment"),

    managerProfileAvatar: document.getElementById("managerProfileAvatar"),
    managerProfileCardName: document.getElementById("managerProfileCardName"),
    managerProfileCardEmail: document.getElementById("managerProfileCardEmail"),
    managerProfileForm: document.getElementById("managerProfileForm"),
    managerProfileFullName: document.getElementById("managerProfileFullName"),
    managerProfileEmail: document.getElementById("managerProfileEmail"),
    managerProfileRole: document.getElementById("managerProfileRole"),
    managerProfileDepartment: document.getElementById(
      "managerProfileDepartment",
    ),
    saveManagerProfileBtn: document.getElementById("saveManagerProfileBtn"),

    managerProfileImageInput: document.getElementById(
      "managerProfileImageInput",
    ),
    managerProfileImagePreview: document.getElementById(
      "managerProfileImagePreview",
    ),
    saveManagerProfileImageBtn: document.getElementById(
      "saveManagerProfileImageBtn",
    ),

    // MANAGER PROFILE IMAGE REMOVAL - v1.0.0
    // References only the new Manager Profile controls.
    // This does not change profile access, tenant scope, or storage permissions.
    removeManagerProfileImageBtn: document.getElementById(
      "removeManagerProfileImageBtn",
    ),

    // MANAGER PROFILE AUTHORITY PARITY - v1.0.0
    // Displays the reporting-line authority already calculated for this Manager.
    // These elements are presentation-only and do not grant decision permissions.
    managerProfileAuthorityPill: document.getElementById(
      "managerProfileAuthorityPill",
    ),
    managerProfileAuthorityText: document.getElementById(
      "managerProfileAuthorityText",
    ),

    leaveDecisionModal: document.getElementById("leaveDecisionModal"),
    leaveDecisionModalLabel: document.getElementById("leaveDecisionModalLabel"),
    leaveDecisionModalSubtext: document.getElementById("leaveDecisionModalSubtext"),
    decisionEmployeeName: document.getElementById("decisionEmployeeName"),
    decisionLeaveType: document.getElementById("decisionLeaveType"),
    decisionStartDate: document.getElementById("decisionStartDate"),
    decisionEndDate: document.getElementById("decisionEndDate"),
    decisionTotalDays: document.getElementById("decisionTotalDays"),
    decisionConflictStatus: document.getElementById("decisionConflictStatus"),
    decisionActionBadge: document.getElementById("decisionActionBadge"),

    // EMPLOYEE LEAVE REASON VISIBILITY - v1.0.0
    decisionEmployeeReason: document.getElementById(
      "decisionEmployeeReason",
    ),

    decisionCommentInput: document.getElementById("decisionCommentInput"),
    decisionCommentHelpText: document.getElementById("decisionCommentHelpText"),
    decisionCommentRequiredMarker: document.getElementById("decisionCommentRequiredMarker"),
    closeDecisionModalBtn: document.getElementById("closeDecisionModalBtn"),
    confirmDecisionBtn: document.getElementById("confirmDecisionBtn"),

    // MANAGER TEAM WORKSPACE SHELL MODERNISATION - v1.0.1
    // Presentation-only summary hooks for the existing Manager Team state.
    managerTeamWorkspaceStatusText: document.getElementById("managerTeamWorkspaceStatusText"),
    managerTeamPrimaryPendingCount: document.getElementById("managerTeamPrimaryPendingCount"),
    managerTeamSecondaryPendingCount: document.getElementById("managerTeamSecondaryPendingCount"),
    managerTeamProcessedCount: document.getElementById("managerTeamProcessedCount"),
    managerTeamScheduleCount: document.getElementById("managerTeamScheduleCount"),
    managerTeamAssignedCount: document.getElementById("managerTeamAssignedCount"),

    teamCountValue: document.getElementById("teamCountValue"),
    activeCountValue: document.getElementById("activeCountValue"),
    pendingCountValue: document.getElementById("pendingCountValue"),
    departmentCountValue: document.getElementById("departmentCountValue"),

    pendingLeaveCountValue: document.getElementById("pendingLeaveCountValue"),
    upcomingLeaveCountValue: document.getElementById("upcomingLeaveCountValue"),
    overlapCountValue: document.getElementById("overlapCountValue"),
    leaveTypeCountValue: document.getElementById("leaveTypeCountValue"),

    pendingRequestsEmptyState: document.getElementById(
      "pendingRequestsEmptyState",
    ),
    pendingRequestsTableWrapper: document.getElementById(
      "pendingRequestsTableWrapper",
    ),
    pendingRequestsTableBody: document.getElementById(
      "pendingRequestsTableBody",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Pending Leave Requests now supports default collapse and safe
    // double-click collapse like the other cleaned manager cards.
    pendingRequestsCardHeader: document.getElementById(
      "pendingRequestsCardHeader",
    ),
    togglePendingRequestsCardBtn: document.getElementById(
      "togglePendingRequestsCardBtn",
    ),
    pendingRequestsCardCollapse: document.getElementById(
      "pendingRequestsCardCollapse",
    ),

    processedRequestsEmptyState: document.getElementById(
      "processedRequestsEmptyState",
    ),
    processedRequestsTableWrapper: document.getElementById(
      "processedRequestsTableWrapper",
    ),
    processedRequestsTableBody: document.getElementById(
      "processedRequestsTableBody",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
    // Processed leave decisions card supports default collapse and
    // double-click collapse like other cleaned dashboard cards.
    processedRequestsCardHeader: document.getElementById(
      "processedRequestsCardHeader",
    ),
    toggleProcessedRequestsCardBtn: document.getElementById(
      "toggleProcessedRequestsCardBtn",
    ),
    processedRequestsCardCollapse: document.getElementById(
      "processedRequestsCardCollapse",
    ),

    teamScheduleEmptyState: document.getElementById("teamScheduleEmptyState"),
    teamScheduleTableWrapper: document.getElementById(
      "teamScheduleTableWrapper",
    ),
    teamScheduleTableBody: document.getElementById("teamScheduleTableBody"),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
    // Team Leave Schedule is open by default but can be collapsed like the
    // processed audit card, without touching leave approval logic.
    teamScheduleCardHeader: document.getElementById("teamScheduleCardHeader"),
    toggleTeamScheduleCardBtn: document.getElementById(
      "toggleTeamScheduleCardBtn",
    ),
    teamScheduleCardCollapse: document.getElementById(
      "teamScheduleCardCollapse",
    ),

    teamEmptyState: document.getElementById("teamEmptyState"),
    teamTableWrapper: document.getElementById("teamTableWrapper"),
    teamTableBody: document.getElementById("teamTableBody"),

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
    // Assigned Employee Records is a default-collapsed reference panel.
    assignedEmployeeRecordsCardHeader: document.getElementById(
      "assignedEmployeeRecordsCardHeader",
    ),
    toggleAssignedEmployeeRecordsCardBtn: document.getElementById(
      "toggleAssignedEmployeeRecordsCardBtn",
    ),
    assignedEmployeeRecordsCardCollapse: document.getElementById(
      "assignedEmployeeRecordsCardCollapse",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Floating navigation and bottom-right notification controls.
    backToTopBtn: document.getElementById("backToTopBtn"),
    dashboardToast: document.getElementById("dashboardToast"),
    dashboardToastAccent: document.getElementById("dashboardToastAccent"),
    dashboardToastIcon: document.getElementById("dashboardToastIcon"),
    dashboardToastTitle: document.getElementById("dashboardToastTitle"),
    dashboardToastMessage: document.getElementById("dashboardToastMessage"),
    dashboardToastCloseBtn: document.getElementById("dashboardToastCloseBtn"),
  };
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
// Reusable card collapse behaviour for manager dashboard cards.
// Mirrors the HR dashboard pattern but keeps the implementation local
// to this file so no shared approval or RLS logic is disturbed.
// MANAGER TEAM WORKSPACE SHELL MODERNISATION - v1.0.1
// Render a concise summary from manager-scoped state already loaded by the
// existing reporting-line, leave visibility, and portal-access workflows.
// No new query or access path is introduced.
function renderManagerTeamWorkspaceSummary() {
  const teamMembers = Array.isArray(state.teamMembers) ? state.teamMembers : [];
  const pendingRequests = Array.isArray(state.pendingLeaveRequests)
    ? state.pendingLeaveRequests
    : [];
  const processedRequests = Array.isArray(state.processedLeaveRequests)
    ? state.processedLeaveRequests
    : [];
  const scheduleItems = Array.isArray(state.teamLeaveSchedule)
    ? state.teamLeaveSchedule
    : [];

  const primaryPendingCount = pendingRequests.filter((request) =>
    isPrimaryReportingManagerRelationship(request.managerRelationshipLabel),
  ).length;
  const secondaryPendingCount = Math.max(
    pendingRequests.length - primaryPendingCount,
    0,
  );
  const conflictCount = [...pendingRequests, ...scheduleItems].filter(
    (item) => item?.hasOverlap,
  ).length;
  const missingAccessCount = teamMembers.filter(
    (member) => member.teamStatusLabel === "Employees Missing Login",
  ).length;

  if (state.dom.managerTeamPrimaryPendingCount) {
    state.dom.managerTeamPrimaryPendingCount.textContent = String(primaryPendingCount);
  }
  if (state.dom.managerTeamSecondaryPendingCount) {
    state.dom.managerTeamSecondaryPendingCount.textContent = String(secondaryPendingCount);
  }
  if (state.dom.managerTeamProcessedCount) {
    state.dom.managerTeamProcessedCount.textContent = String(processedRequests.length);
  }
  if (state.dom.managerTeamScheduleCount) {
    state.dom.managerTeamScheduleCount.textContent = String(scheduleItems.length);
  }
  if (state.dom.managerTeamAssignedCount) {
    state.dom.managerTeamAssignedCount.textContent = String(teamMembers.length);
  }

  if (state.dom.managerTeamWorkspaceStatusText) {
    if (primaryPendingCount > 0) {
      state.dom.managerTeamWorkspaceStatusText.textContent =
        `${primaryPendingCount} primary leave decision${primaryPendingCount === 1 ? "" : "s"} require your review.`;
    } else if (conflictCount > 0) {
      state.dom.managerTeamWorkspaceStatusText.textContent =
        `${conflictCount} leave conflict${conflictCount === 1 ? "" : "s"} require coverage attention.`;
    } else if (missingAccessCount > 0) {
      state.dom.managerTeamWorkspaceStatusText.textContent =
        `${missingAccessCount} assigned employee${missingAccessCount === 1 ? "" : "s"} do not have linked portal access.`;
    } else {
      state.dom.managerTeamWorkspaceStatusText.textContent =
        "No immediate Manager Team actions are outstanding.";
    }
  }
}

// MANAGER TEAM WORKSPACE SHELL MODERNISATION - v1.0.1
// Open one existing Team card and place its heading near the top of the viewport.
// Existing collapse helpers and panel IDs remain the source of truth.
function openManagerTeamWorkspacePanel(panelKey = "") {
  const panelMap = {
    pending: {
      button: state.dom.togglePendingRequestsCardBtn,
      panel: state.dom.pendingRequestsCardCollapse,
      header: state.dom.pendingRequestsCardHeader,
    },
    processed: {
      button: state.dom.toggleProcessedRequestsCardBtn,
      panel: state.dom.processedRequestsCardCollapse,
      header: state.dom.processedRequestsCardHeader,
    },
    schedule: {
      button: state.dom.toggleTeamScheduleCardBtn,
      panel: state.dom.teamScheduleCardCollapse,
      header: state.dom.teamScheduleCardHeader,
    },
    employees: {
      button: state.dom.toggleAssignedEmployeeRecordsCardBtn,
      panel: state.dom.assignedEmployeeRecordsCardCollapse,
      header: state.dom.assignedEmployeeRecordsCardHeader,
    },
  };

  const target = panelMap[String(panelKey || "").trim().toLowerCase()];
  if (!target?.button || !target?.panel || !target?.header) return;

  setManagerCardExpanded(target.button, target.panel, true);

  window.requestAnimationFrame(() => {
    const card = target.header.closest(".dashboard-section-card") || target.header;
    const top = card.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
  });
}

window.managerOpenTeamWorkspacePanel = openManagerTeamWorkspacePanel;

function setManagerCardExpanded(button, panel, shouldExpand) {
  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));

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

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
// Button toggles expand/collapse.
// Double-click is collapse-only so it never accidentally opens an audit card.
// The expanded panel also listens for double-click, so managers can collapse
// the card even when they are deep inside long processed records.
function bindManagerCardCollapseToggle(button, panel, header) {
  if (!button || !panel) return;

  const toggleCardFromButton = () => {
    const shouldExpand = panel.classList.contains("d-none");
    setManagerCardExpanded(button, panel, shouldExpand);
  };

  const collapseCardFromDoubleClick = (event) => {
    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-C
    // Double-click is collapse-only. It should work on safe card surfaces
    // such as the top/header, side padding, and bottom blank area, but must
    // not collapse while the manager double-clicks inside actual records.
    const blockedTarget = event?.target?.closest(
      "button, a, input, select, textarea, label, table, thead, tbody, tr, th, td",
    );

    if (blockedTarget) return;
    if (panel.classList.contains("d-none")) return;

    setManagerCardExpanded(button, panel, false);
  };

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-C
  // Listen from the whole card, not only the header/panel. This lets the
  // manager collapse from top, side, and bottom blank areas while record cells
  // remain protected by the blockedTarget guard above.
  const cardSurface =
    header?.closest(".dashboard-section-card") ||
    panel.closest(".dashboard-section-card") ||
    panel;

  button.addEventListener("click", toggleCardFromButton);
  cardSurface.addEventListener("dblclick", collapseCardFromDoubleClick);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
// After a manager decision, show the audit-history card automatically.
// This confirms the decision moved from Pending Requests into Processed Decisions.
function openProcessedRequestsCardAfterDecision() {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-B
  // After a decision, show the processed audit card exactly from the top:
  // card heading visible, newest processed row visible, and inner scrollbar reset.
  setManagerCardExpanded(
    state.dom.toggleProcessedRequestsCardBtn,
    state.dom.processedRequestsCardCollapse,
    true,
  );

  if (state.dom.processedRequestsTableWrapper) {
    state.dom.processedRequestsTableWrapper.scrollTop = 0;
  }

  window.requestAnimationFrame(() => {
    const targetCard =
      state.dom.processedRequestsCardHeader?.closest(".dashboard-section-card") ||
      state.dom.processedRequestsCardHeader;

    if (!targetCard) return;

    const topWithBreathingRoom =
      targetCard.getBoundingClientRect().top + window.scrollY - 24;

    window.scrollTo({
      top: Math.max(topWithBreathingRoom, 0),
      behavior: "smooth",
    });
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Show the blue Back to Top button only after the manager has scrolled down.
function updateManagerBackToTopButtonVisibility() {
  const button = state.dom.backToTopBtn;
  if (!button) return;

  button.classList.toggle("d-none", window.scrollY <= 420);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Bottom-right manager toast. This mirrors the HR dashboard pattern but is
// local to Manager so no HR/payroll functions are touched.
function showManagerDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = state.dom.dashboardToast;
  if (!toast) return;

  const accent = state.dom.dashboardToastAccent;
  const icon = state.dom.dashboardToastIcon;
  const titleEl = state.dom.dashboardToastTitle;
  const messageEl = state.dom.dashboardToastMessage;

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

  if (titleEl) {
    titleEl.textContent = title;
  }

  if (messageEl) {
    messageEl.textContent = message || "";
  }

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideManagerDashboardToast();
  }, 8000);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Hide the manager toast without touching page data or leave workflow state.
function hideManagerDashboardToast() {
  state.dom.dashboardToast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

// REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
// Let the browser paint a spinner before starting Manager Dashboard reload work.
function waitForManagerNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

// REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
// Keep fast manager refresh feedback visible long enough to be noticeable.
function waitForManagerMinimumLoadingFeedback(startedAt, minimumMs = 450) {
  const elapsedMs = Date.now() - startedAt;
  const remainingMs = Math.max(minimumMs - elapsedMs, 0);

  return new Promise((resolve) => {
    window.setTimeout(resolve, remainingMs);
  });
}

// REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
// Shared Manager Dashboard button loading helper for manual refresh actions.
function setManagerRefreshButtonLoading(button, isLoading, loadingText = "Refreshing...") {
  if (!button) return;

  button.disabled = isLoading;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      ${loadingText}
    `;

    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

// REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
// Manual Team refresh with visible loading, success, and failure feedback.
// This does not change reporting-line visibility, leave approval, or RLS logic.
async function refreshManagerWorkspaceManually() {
  const button = state.dom.refreshTeamBtn;
  const startedAt = Date.now();

  try {
    setManagerRefreshButtonLoading(button, true, "Refreshing...");
    await waitForManagerNextPaint();

    await refreshManagerWorkspace();

    clearPageAlert();
    showManagerDashboardToast(
      "success",
      "Team refreshed",
      "Assigned employee records and team leave information were refreshed.",
    );
  } catch (error) {
    console.error("Manual manager team refresh failed:", error);

    const message =
      error?.message ||
      "Unable to refresh manager team information right now.";

    showPageAlert("danger", message);

    showManagerDashboardToast(
      "danger",
      "Refresh failed",
      message,
    );
  } finally {
    await waitForManagerMinimumLoadingFeedback(startedAt);
    setManagerRefreshButtonLoading(button, false);
  }
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// Stable key for comparing manager team membership before and after refresh.
// Prefer employees.id because employee_reporting_lines is keyed to employee rows.
function getManagerTeamAssignmentMemberKey(member = {}) {
  return String(
    member.id ||
    member.raw?.id ||
    member.work_email ||
    member.employeeFullName ||
    "",
  ).trim();
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// Friendly label for manager-facing assignment change notifications.
function getManagerTeamAssignmentMemberName(member = {}) {
  return String(
    member.employeeFullName ||
    member.raw?.full_name ||
    member.work_email ||
    "Employee",
  ).trim();
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// Build an in-memory lookup of visible team assignments.
function buildManagerTeamAssignmentMap(teamMembers = []) {
  const map = new Map();

  (Array.isArray(teamMembers) ? teamMembers : []).forEach((member) => {
    const key = getManagerTeamAssignmentMemberKey(member);
    if (!key) return;

    map.set(key, getManagerTeamAssignmentMemberName(member));
  });

  return map;
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// Keep toast copy short. Large teams should not produce a long notification.
function formatManagerTeamAssignmentNames(names = []) {
  const cleanNames = names
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  if (!cleanNames.length) return "employee record";

  if (cleanNames.length <= 2) {
    return cleanNames.join(", ");
  }

  return `${cleanNames.slice(0, 2).join(", ")} +${cleanNames.length - 2} more`;
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// Compare the previously visible team with the newly loaded team.
// This gives managers feedback when HR changes or removes line-manager
// assignments, without changing HR save logic, RLS, leave approval, or payroll.
function notifyManagerTeamAssignmentChanges(nextTeamMembers = []) {
  const previousTeamMembers = Array.isArray(state.teamMembers)
    ? state.teamMembers
    : [];

  const previousMap = buildManagerTeamAssignmentMap(previousTeamMembers);
  const nextMap = buildManagerTeamAssignmentMap(nextTeamMembers);

  // First successful load establishes the snapshot only. Do not show a false
  // "added" toast when the manager first opens the dashboard.
  if (!state.hasLoadedTeamAssignmentSnapshot) {
    state.hasLoadedTeamAssignmentSnapshot = true;
    return;
  }

  const removedNames = [...previousMap.entries()]
    .filter(([key]) => !nextMap.has(key))
    .map(([, name]) => name);

  const addedNames = [...nextMap.entries()]
    .filter(([key]) => !previousMap.has(key))
    .map(([, name]) => name);

  if (!removedNames.length && !addedNames.length) return;

  if (removedNames.length && addedNames.length) {
    // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N-FIX
    // HR wording: the manager is the line manager; employees are added to or
    // removed from the manager's team/reporting line.
    showManagerDashboardToast(
      "info",
      "Team assignment updated",
      `${formatManagerTeamAssignmentNames(removedNames)} removed from your team; ${formatManagerTeamAssignmentNames(addedNames)} added to your team.`,
    );
    return;
  }

  if (removedNames.length) {
    // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N-FIX
    // Use manager-facing HR wording, not "employee assigned to you as line manager".
    showManagerDashboardToast(
      "warning",
      "Employee removed from your team",
      removedNames.length === 1
        ? `You are no longer ${formatManagerTeamAssignmentNames(removedNames)}'s line manager.`
        : `${formatManagerTeamAssignmentNames(removedNames)} are no longer in your team.`,
    );
    return;
  }

  // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N-FIX
  // Added employee wording: employee joins the manager's team; manager becomes
  // their line manager.
  showManagerDashboardToast(
    "success",
    "Employee added to your team",
    addedNames.length === 1
      ? `${formatManagerTeamAssignmentNames(addedNames)} has been added to your team. You are now their line manager.`
      : `${formatManagerTeamAssignmentNames(addedNames)} have been added to your team.`,
  );
}

// MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
// When the manager returns to the Team workspace, refresh the assignment view.
// This catches HR reporting-line changes without needing a full page reload.
async function refreshManagerTeamAssignmentsOnFocus() {
  if (document.hidden) return;

  const isTeamWorkspaceVisible =
    state.dom.managerTeamSection &&
    !state.dom.managerTeamSection.classList.contains("d-none");

  if (!isTeamWorkspaceVisible) return;

  const now = Date.now();
  const minimumRefreshGapMs = 15000;

  if (
    state.isTeamAssignmentFocusRefreshInProgress ||
    now - state.lastTeamAssignmentFocusRefreshAt < minimumRefreshGapMs
  ) {
    return;
  }

  state.isTeamAssignmentFocusRefreshInProgress = true;
  state.lastTeamAssignmentFocusRefreshAt = now;

  try {
    await refreshManagerWorkspace();
  } catch (error) {
    console.warn("Manager team assignment focus refresh failed:", error);
  } finally {
    state.isTeamAssignmentFocusRefreshInProgress = false;
  }
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Business-friendly notification title for manager decisions.
function getLeaveDecisionToastTitle(status = "") {
  const normalisedStatus = normalizeText(status);

  if (normalisedStatus === "approved") return "Leave approved";
  if (normalisedStatus === "rejected") return "Leave rejected";
  if (
    normalisedStatus === "returned" ||
    normalisedStatus === "returned for clarification"
  ) {
    return "Leave returned";
  }

  return "Leave decision saved";
}

// MANAGER OPERATING GUIDE FOCUS MANAGEMENT - v1.0.1
// Move focus outside the Bootstrap modal before it becomes aria-hidden,
// then return focus to the exact desktop/mobile Help Guide trigger.
// Accessibility only: no guide content, navigation, session, role,
// reporting-line, leave, payroll, Supabase, or tenant behaviour changes.
let managerOperatingGuideTriggerElement = null;

function bindManagerOperatingGuideFocusManagement() {
  const modal = document.getElementById("managerOperatingGuideModal");

  if (!modal || modal.dataset.focusManagementBound === "true") return;

  modal.dataset.focusManagementBound = "true";

  modal.addEventListener("show.bs.modal", (event) => {
    renderAuthorityAwareManagerGuide();

    const relatedTrigger = event.relatedTarget;

    managerOperatingGuideTriggerElement =
      relatedTrigger instanceof HTMLElement
        ? relatedTrigger
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
  });

  modal.addEventListener("hide.bs.modal", () => {
    const activeElement = document.activeElement;
    const trigger = managerOperatingGuideTriggerElement;

    if (!(activeElement instanceof HTMLElement) || !modal.contains(activeElement)) {
      return;
    }

    if (
      trigger instanceof HTMLElement &&
      trigger.isConnected &&
      !trigger.hasAttribute("disabled")
    ) {
      trigger.focus({ preventScroll: true });
      return;
    }

    activeElement.blur();
  });

  modal.addEventListener("hidden.bs.modal", () => {
    const trigger = managerOperatingGuideTriggerElement;
    managerOperatingGuideTriggerElement = null;

    if (
      trigger instanceof HTMLElement &&
      trigger.isConnected &&
      !trigger.hasAttribute("disabled")
    ) {
      window.requestAnimationFrame(() => {
        trigger.focus({ preventScroll: true });
      });
    }
  });
}

function bindEvents() {
  bindManagerOperatingGuideFocusManagement();
  state.dom.logoutBtn?.addEventListener("click", async () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Logout must reset the next Manager session to Dashboard.
    clearRememberedManagerWorkspace();

    await window.SessionManager.logoutUser("logout");
  });

  state.dom.managerTabDashboardBtn?.addEventListener("click", () => {
    rememberManagerWorkspace("dashboard");
    switchManagerWorkspace("dashboard");
  });

  state.dom.managerTabProfileBtn?.addEventListener("click", () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberManagerWorkspace("profile");
    switchManagerWorkspace("profile");
  });

  state.dom.managerTabTeamBtn?.addEventListener("click", () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Team Management only for refresh. No team or leave data is stored.
    rememberManagerWorkspace("team");
    switchManagerWorkspace("team");
  });

  // EMPLOYEE SELF-SERVICE - MANAGER
  // Manager opens their own employee self-service workspace (leave + payroll).
  // Data loads lazily on first open; subsequent opens simply show the section.
  state.dom.managerTabSelfServiceBtn?.addEventListener("click", () => {
    rememberManagerWorkspace("selfservice");
    switchManagerWorkspace("selfservice");
    initManagerSelfServiceOnFirstOpen();
  });

  state.dom.managerProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveManagerOwnProfile();
  });

// SYSTEM-WIDE MANAGER EMPLOYEE IDENTITY AUTHORITY - v1.0.0
// Manager profile identity fields are read-only.
// Name changes are maintained through the HR People record.
updateManagerProfileSaveButtonState();

  updateManagerProfileSaveButtonState();

  state.dom.managerProfileImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    handlePendingProfileImage(file);
  });

state.dom.saveManagerProfileImageBtn?.addEventListener("click", async () => {
  await uploadManagerProfileImage();
});

// MANAGER PROFILE IMAGE REMOVAL - v1.0.0
// Remove only the signed-in Manager's stored profile-picture reference.
// This does not affect another employee, tenant, role, or reporting line.
state.dom.removeManagerProfileImageBtn?.addEventListener(
  "click",
  async () => {
    await removeManagerProfileImage();
  },
);

  state.dom.confirmDecisionBtn?.addEventListener("click", async () => {
    await submitLeaveDecisionFromModal();
  });

  state.dom.leaveDecisionModal?.addEventListener("hidden.bs.modal", () => {
    resetDecisionModalState();
  });

  // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
  // Manual Team refresh should show visible feedback. Without this, the button
  // looks unresponsive even when the data reload succeeds.
  state.dom.refreshTeamBtn?.addEventListener("click", async () => {
    await refreshManagerWorkspaceManually();
  });

  // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
  // Refresh the Team workspace when the manager returns to the browser tab.
  // If HR changed reporting lines while the manager was away, the dashboard
  // reloads the assignment list and shows a toast for added/removed employees.
  window.addEventListener("focus", () => {
    void refreshManagerTeamAssignmentsOnFocus();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshManagerTeamAssignmentsOnFocus();
    }
  });

  state.dom.teamSearchInput?.addEventListener("input", () => {
    applyTeamFilter();
  });

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Page-level navigation and toast controls.
  window.addEventListener("scroll", updateManagerBackToTopButtonVisibility, {
    passive: true,
  });

  state.dom.backToTopBtn?.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  state.dom.dashboardToastCloseBtn?.addEventListener("click", () => {
    hideManagerDashboardToast();
  });

  updateManagerBackToTopButtonVisibility();

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Pending Requests starts collapsed and uses safe double-click collapse.
  // Double-click does not open a collapsed card and does not fire from table cells.
  bindManagerCardCollapseToggle(
    state.dom.togglePendingRequestsCardBtn,
    state.dom.pendingRequestsCardCollapse,
    state.dom.pendingRequestsCardHeader,
  );

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
  // Processed Decisions starts collapsed by HTML default and can be toggled
  // by the button or by double-clicking the card header.
  bindManagerCardCollapseToggle(
    state.dom.toggleProcessedRequestsCardBtn,
    state.dom.processedRequestsCardCollapse,
    state.dom.processedRequestsCardHeader,
  );

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
  // Team Schedule stays open by default and can be collapsed from safe card
  // surfaces. Double-click remains collapse-only via the shared helper.
  bindManagerCardCollapseToggle(
    state.dom.toggleTeamScheduleCardBtn,
    state.dom.teamScheduleCardCollapse,
    state.dom.teamScheduleCardHeader,
  );

  // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
  // Assigned Employee Records starts collapsed and uses the same safe
  // double-click-collapse pattern as the other cleaned manager cards.
  bindManagerCardCollapseToggle(
    state.dom.toggleAssignedEmployeeRecordsCardBtn,
    state.dom.assignedEmployeeRecordsCardCollapse,
    state.dom.assignedEmployeeRecordsCardHeader,
  );
}


// =========================================================
// AUTHORITY-AWARE MANAGER HELP GUIDE - v1.0.0
// Keeps the existing HR-format modal and card layout while adapting wording
// to Primary, Secondary, delegated Acting Secondary, and Mixed coverage.
// Presentation only: no authority, leave, reporting-line, tenant, or SQL change.
// =========================================================
function setManagerGuideText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value || "");
}

function getManagerGuideAuthorityContext() {
  const teamMembers = Array.isArray(state.teamMembers) ? state.teamMembers : [];
  const delegationContext = getManagerDelegationContext();
  const primaryCount = teamMembers.filter((member) =>
    isPrimaryReportingManagerRelationship(member.relationshipLabel),
  ).length;
  const secondaryCount = teamMembers.filter((member) =>
    normalizeText(member.relationshipLabel).includes("secondary"),
  ).length;
  const activeReceived = Array.isArray(delegationContext.active_received)
    ? delegationContext.active_received
    : [];
  const canManageDelegation =
    (Array.isArray(delegationContext.eligible_delegates) &&
      delegationContext.eligible_delegates.length > 0) ||
    (Array.isArray(delegationContext.active_granted) &&
      delegationContext.active_granted.length > 0);

  let mode = "secondary";
  if (primaryCount > 0 && secondaryCount > 0) mode = "mixed";
  else if (primaryCount > 0) mode = "primary";
  else if (activeReceived.length > 0) mode = "acting";

  return {
    mode,
    primaryCount,
    secondaryCount,
    activeReceived,
    hasActingAccess: activeReceived.length > 0,
    canManageDelegation,
  };
}

function renderAuthorityAwareManagerGuide() {
  const modal = document.getElementById("managerOperatingGuideModal");
  if (!modal) return;

  const context = getManagerGuideAuthorityContext();
  const authorityCard = document.getElementById("managerGuideAuthorityCard");
  const authorityLink = document.getElementById("managerGuideAuthorityLink");

  const common = {
    history:
      "Review completed leave outcomes, decision comments, and the authority audit shown for each processed request.",
    schedule:
      "Review approved current and upcoming absences to understand availability, overlaps, and coverage requirements.",
    employees:
      "Find employees included in your reporting coverage and review the role-appropriate information available to you.",
  };

  const configs = {
    primary: {
      kicker: "Primary Manager workspace guide",
      description:
        "Use this guide to review team coverage, make accountable leave decisions, and manage temporary approval access.",
      recommended:
        "Review requests requiring your decision, current team coverage, approved absences, and assigned employee activity before opening a detailed workspace.",
      team:
        "Open the team workspace to review pending decisions, completed outcomes, approved absences, and assigned employee records.",
      pendingTitle: "Pending Leave Decisions",
      pending:
        "Check balance, eligibility, overlap, and request details before approving, rejecting, or returning a request for clarification.",
      flowTitle: "From readiness review to accountable decision",
      steps: [
        ["Review", "Start on Dashboard and identify Primary Manager decisions requiring your attention."],
        ["Validate", "Open Pending Leave Decisions and confirm balance, eligibility, dates, and coverage impact."],
        ["Decide", "Approve, reject, or return the request with a clear comment. The database performs the final authority and balance checks."],
        ["Follow through", "Review Decision History and Team Leave Schedule, then follow up on any employee or coverage action."],
      ],
      help:
        "Open Dashboard first. Primary decision indicators and Team Management shortcuts will take you to the correct request or record.",
      footer:
        "Decision controls apply only to employees assigned to you as Primary Manager.",
      authorityTitle: "Temporary Approval Access",
      authority:
        "Grant, review, or revoke time-limited approval access for one or more eligible Secondary Managers while you are unavailable.",
      authorityTarget: "delegation",
      showAuthority: true,
    },
    secondary: {
      kicker: "Secondary Manager workspace guide",
      description:
        "Use this guide to monitor assigned employees, leave activity, and operational coverage without taking Primary Manager decisions.",
      recommended:
        "Review secondary-manager visibility, current team coverage, approved absence information, and assigned employee activity before opening a detailed workspace.",
      team:
        "Open the team workspace for secondary visibility, leave coverage, decision history, and assigned employee records.",
      pendingTitle: "Pending Leave Visibility",
      pending:
        "Review requests visible through your Secondary Manager assignment for awareness and coverage planning. Decision controls remain with the Primary Manager.",
      flowTitle: "From visibility to coverage follow-up",
      steps: [
        ["Review", "Start on Dashboard and identify requests, absences, or employee changes that need awareness."],
        ["Understand", "Use Pending Leave Visibility and Decision History to understand status without taking Primary Manager actions."],
        ["Plan", "Use Team Leave Schedule to assess availability, overlaps, and operational coverage."],
        ["Follow up", "Use Assigned Employee Records or contact the responsible Primary Manager or HR team where action is required."],
      ],
      help:
        "Open Dashboard first. Secondary visibility cards and Team Management shortcuts will point you to the correct workspace.",
      footer:
        "Workspace access follows your assigned Secondary Manager reporting lines.",
      showAuthority: false,
    },
    acting: {
      kicker: "Acting Secondary Manager workspace guide",
      description:
        "Use this guide while temporary approval access is active. Your decision rights apply only to the employees and time period covered by the delegation.",
      recommended:
        "Review delegated requests, expiry details, team coverage, and employee activity before taking a temporary leave decision.",
      team:
        "Open the team workspace to identify requests covered by your temporary approval access and requests that remain view only.",
      pendingTitle: "Delegated Leave Decisions",
      pending:
        "Approve, reject, or return only requests marked with active acting authority. Requests outside the delegated scope remain Awaiting Primary Manager.",
      flowTitle: "From delegated authority to audited decision",
      steps: [
        ["Confirm scope", "Check the acting-authority label, covered employee, and access expiry before taking action."],
        ["Validate", "Review balance, eligibility, dates, overlap, and the employee's request details."],
        ["Decide", "Approve, reject, or return the covered request with a clear comment before access expires or is revoked."],
        ["Verify audit", "Review Decision History to confirm the acting Manager and the Primary Manager who granted access are recorded."],
      ],
      help:
        "Only requests showing active acting authority can be decided. All other Secondary Manager requests remain view only.",
      footer:
        "Temporary approval access is time-bound, scope-bound, independently revocable, and fully audited.",
      authorityTitle: "Temporary Approval Access Granted to You",
      authority:
        "Review the active scope and expiry shown on each covered request. The Primary Manager can revoke access at any time.",
      authorityTarget: "pending",
      showAuthority: true,
    },
    mixed: {
      kicker: "Mixed Manager Coverage workspace guide",
      description:
        "Your team includes both Primary and Secondary reporting lines. Use the authority shown on each request before taking action.",
      recommended:
        "Review Primary decisions, Secondary visibility, delegated access, approved absences, and assigned employees from one combined workspace.",
      team:
        "Open Team Management to separate Primary decisions from Secondary visibility and any temporary acting authority currently granted to you.",
      pendingTitle: "Pending Leave Requests",
      pending:
        "Decide requests for your Primary assignments and any request with active delegated authority. Other Secondary assignments remain view only.",
      flowTitle: "From mixed coverage to the correct authority path",
      steps: [
        ["Review", "Start on Dashboard and distinguish Primary decisions from Secondary visibility."],
        ["Check authority", "Use the request badge to confirm Primary, acting, or view-only status before selecting an action."],
        ["Act or plan", "Complete authorised decisions and use the schedule for requests visible only for coverage planning."],
        ["Follow through", "Review the audit trail and employee records, then coordinate with the responsible Primary Manager or HR where needed."],
      ],
      help:
        "The request card is authoritative: action buttons appear only for your Primary assignments or active delegated access.",
      footer:
        "Mixed coverage never expands authority automatically; each request follows its reporting-line or active delegation record.",
      authorityTitle: context.canManageDelegation
        ? "Temporary Approval Access"
        : "Temporary Approval Access Granted to You",
      authority: context.canManageDelegation
        ? "Grant, review, or revoke access for your Primary assignments. Any access granted to you remains limited to its own scope and expiry."
        : "Review the scope and expiry of temporary access granted to you for selected Primary Manager requests.",
      authorityTarget: context.canManageDelegation ? "delegation" : "pending",
      showAuthority: context.canManageDelegation || context.hasActingAccess,
    },
  };

  const config = configs[context.mode] || configs.secondary;

  setManagerGuideText("managerGuideModeKicker", config.kicker);
  setManagerGuideText("managerOperatingGuideModalDescription", config.description);
  setManagerGuideText("managerGuideRecommendedBody", config.recommended);
  setManagerGuideText("managerGuideTeamBody", config.team);
  setManagerGuideText("managerGuidePendingTitle", config.pendingTitle);
  setManagerGuideText("managerGuidePendingBody", config.pending);
  setManagerGuideText("managerGuideHistoryBody", common.history);
  setManagerGuideText("managerGuideScheduleBody", common.schedule);
  setManagerGuideText("managerGuideEmployeesBody", common.employees);
  setManagerGuideText("managerGuideFlowTitle", config.flowTitle);
  setManagerGuideText("managerGuideHelpBody", config.help);
  setManagerGuideText("managerGuideFooterText", config.footer);

  config.steps.forEach(([title, body], index) => {
    setManagerGuideText(`managerGuideStep${index + 1}Title`, title);
    setManagerGuideText(`managerGuideStep${index + 1}Body`, body);
  });

  if (authorityCard) {
    authorityCard.classList.toggle("d-none", !config.showAuthority);
  }
  setManagerGuideText("managerGuideAuthorityTitle", config.authorityTitle || "Temporary Approval Access");
  setManagerGuideText("managerGuideAuthorityBody", config.authority || "");
  if (authorityLink) {
    authorityLink.dataset.managerGuideTarget = config.authorityTarget || "pending";
    authorityLink.firstChild.textContent =
      config.authorityTarget === "delegation" ? "Open access controls " : "Open covered requests ";
  }

  const workspaceGrid = document.getElementById("managerGuideWorkspaceGrid");
  if (workspaceGrid) {
    workspaceGrid.setAttribute("aria-label", `${config.kicker.replace(" workspace guide", "")} workspaces`);
  }
}

// =========================================================
// MANAGER HELP GUIDE CONTEXTUAL NAVIGATION - v1.0.2
// Close the guide, reuse existing workspace controls, and open the requested
// Manager panel. No data query, role, authority, session, or persistence change.
// =========================================================
function openManagerGuideDestinationPanel(toggleButton, collapsePanel) {
  if (!toggleButton || !collapsePanel) return;

  if (collapsePanel.classList.contains("d-none")) {
    toggleButton.click();
  }
}

function navigateFromManagerGuide(target = "dashboard") {
  const guideModalElement = document.getElementById("managerOperatingGuideModal");
  const guideModal = guideModalElement && window.bootstrap?.Modal
    ? window.bootstrap.Modal.getOrCreateInstance(guideModalElement)
    : null;

  guideModal?.hide();

  window.setTimeout(() => {
    if (target === "dashboard") {
      state.dom.managerTabDashboardBtn?.click();
      return;
    }

    if (target === "profile") {
      state.dom.managerTabProfileBtn?.click();
      return;
    }

    if (target === "selfservice") {
      state.dom.managerTabSelfServiceBtn?.click();
      return;
    }

    state.dom.managerTabTeamBtn?.click();

    if (target === "delegation") {
      window.setTimeout(() => {
        const delegationButton = document.getElementById("managerLeaveDelegationOpenBtn");
        if (delegationButton && !delegationButton.classList.contains("d-none")) {
          delegationButton.click();
        }
      }, 80);
      return;
    }

    const destinationMap = {
      pending: {
        toggle: state.dom.togglePendingRequestsCardBtn,
        panel: state.dom.pendingRequestsCardCollapse,
        header: state.dom.pendingRequestsCardHeader,
      },
      processed: {
        toggle: state.dom.toggleProcessedRequestsCardBtn,
        panel: state.dom.processedRequestsCardCollapse,
        header: state.dom.processedRequestsCardHeader,
      },
      schedule: {
        toggle: state.dom.toggleTeamScheduleCardBtn,
        panel: state.dom.teamScheduleCardCollapse,
        header: state.dom.teamScheduleCardHeader,
      },
      employees: {
        toggle: state.dom.toggleAssignedEmployeeRecordsCardBtn,
        panel: state.dom.assignedEmployeeRecordsCardCollapse,
        header: state.dom.assignedEmployeeRecordsCardHeader,
      },
    };

    const destination = destinationMap[target];
    if (!destination) return;

    openManagerGuideDestinationPanel(destination.toggle, destination.panel);

    window.requestAnimationFrame(() => {
      const card = destination.header?.closest(".dashboard-section-card") || destination.header;
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
      destination.toggle?.focus({ preventScroll: true });
    });
  }, 220);
}

function bindManagerGuideContextualNavigation() {
  document
    .querySelectorAll("[data-manager-guide-target]")
    .forEach((button) => {
      if (button.dataset.managerGuideBound === "true") return;

      button.dataset.managerGuideBound = "true";
      button.addEventListener("click", () => {
        navigateFromManagerGuide(button.dataset.managerGuideTarget || "dashboard");
      });
    });
}
function initialiseDecisionModal() {
  if (!state.dom.leaveDecisionModal || !window.bootstrap?.Modal) return;
  state.leaveDecisionModal = new window.bootstrap.Modal(state.dom.leaveDecisionModal);
}

function resetDecisionModalState() {
  state.pendingDecisionAction = null;
  state.pendingDecisionRequest = null;
  state.pendingDecisionButton = null;

  if (state.dom.decisionEmployeeName) {
    state.dom.decisionEmployeeName.textContent = "--";
  }

  if (state.dom.decisionLeaveType) {
    state.dom.decisionLeaveType.textContent = "--";
  }

  if (state.dom.decisionStartDate) {
    state.dom.decisionStartDate.textContent = "--";
  }

  if (state.dom.decisionEndDate) {
    state.dom.decisionEndDate.textContent = "--";
  }

  if (state.dom.decisionTotalDays) {
    state.dom.decisionTotalDays.textContent = "--";
  }

  if (state.dom.decisionConflictStatus) {
    state.dom.decisionConflictStatus.innerHTML = "--";
  }

  if (state.dom.decisionActionBadge) {
    state.dom.decisionActionBadge.innerHTML = "--";
  }

  if (state.dom.decisionEmployeeReason) {
    state.dom.decisionEmployeeReason.textContent =
      "No reason provided.";
  }

  if (state.dom.decisionCommentInput) {
    state.dom.decisionCommentInput.value = "";
  }

  if (state.dom.decisionCommentRequiredMarker) {
    state.dom.decisionCommentRequiredMarker.classList.add(
      "d-none",
    );
  }

  if (state.dom.decisionCommentHelpText) {
    state.dom.decisionCommentHelpText.textContent =
      "Approval comments are optional. Reject and return actions require a comment.";
  }

  setDecisionModalLoading(false);
}

function getDecisionActionConfig(action) {
  switch (action) {
    case "approve":
      return {
        label: "Approve Request",
        buttonClass: "btn btn-success dashboard-action-btn",
        badgeClass: "badge text-bg-success",
        badgeLabel: "Approve",
        helpText: "Approval comments are optional.",
        commentRequired: false,
      };
    case "reject":
      return {
        label: "Reject Request",
        buttonClass: "btn btn-danger dashboard-action-btn",
        badgeClass: "badge text-bg-danger",
        badgeLabel: "Reject",
        helpText: "A rejection comment is required.",
        commentRequired: true,
      };
    case "return":
      return {
        label: "Return for Clarification",
        buttonClass: "btn btn-warning dashboard-action-btn",
        badgeClass: "badge text-bg-warning",
        badgeLabel: "Return",
        helpText: "A clarification comment is required before returning the request.",
        commentRequired: true,
      };
    default:
      return {
        label: "Confirm Decision",
        buttonClass: "btn btn-primary dashboard-action-btn",
        badgeClass: "badge text-bg-primary",
        badgeLabel: "Decision",
        helpText: "Add your comment here.",
        commentRequired: false,
      };
  }
}

function openDecisionModal(leaveId, action, buttonElement) {
  clearPageAlert();

  const request = state.pendingLeaveRequests.find(
    (item) => String(item.id) === String(leaveId),
  );

  if (!request) {
    showPageAlert(
      "warning",
      "The selected leave request could not be resolved. Please refresh and try again.",
    );
    return;
  }

  // SECONDARY MANAGER PENDING LEAVE VISIBILITY - STEP 1
  // Defence in depth: do not open a decision workflow for a Secondary Manager,
  // even if a stale element or manual browser call reaches this function.
  if (!canManagerDecideLeaveRequest(request)) {
    showPageAlert(
      "info",
      "This request is visible for team planning. Only the Primary Manager or an actively delegated Secondary Manager can make this decision.",
    );
    return;
  }

  const config = getDecisionActionConfig(action);
  state.pendingDecisionAction = action;
  state.pendingDecisionRequest = request;
  state.pendingDecisionButton = buttonElement || null;

  if (state.dom.decisionEmployeeName) {
    state.dom.decisionEmployeeName.textContent =
      request.employeeName || "--";
  }

  if (state.dom.decisionLeaveType) {
    state.dom.decisionLeaveType.textContent =
      request.leaveTypeName || "--";
  }

  if (state.dom.decisionStartDate) {
    state.dom.decisionStartDate.textContent =
      formatDate(request.start_date);
  }

  if (state.dom.decisionEndDate) {
    state.dom.decisionEndDate.textContent =
      formatDate(request.end_date);
  }

  if (state.dom.decisionTotalDays) {
    state.dom.decisionTotalDays.textContent =
      String(request.total_days || "--");
  }

  // EMPLOYEE LEAVE REASON VISIBILITY - v1.0.0
  if (state.dom.decisionEmployeeReason) {
    const employeeReason = String(
      request.reason || "",
    ).trim();

    state.dom.decisionEmployeeReason.textContent =
      employeeReason || "No reason provided.";
  }

  if (state.dom.decisionConflictStatus) {
    state.dom.decisionConflictStatus.innerHTML =
      buildOverlapCellHtml(request);
  }
  if (state.dom.decisionActionBadge) {
    state.dom.decisionActionBadge.innerHTML = `<span class="${config.badgeClass}">${config.badgeLabel}</span>`;
  }
  if (state.dom.decisionCommentInput) {
    state.dom.decisionCommentInput.value = "";
    state.dom.decisionCommentInput.placeholder = config.commentRequired
      ? "Enter your required comment here"
      : "Optional comment";
  }
  if (state.dom.decisionCommentHelpText) {
    state.dom.decisionCommentHelpText.textContent = config.helpText;
  }
  if (state.dom.decisionCommentRequiredMarker) {
    state.dom.decisionCommentRequiredMarker.classList.toggle("d-none", !config.commentRequired);
  }
  if (state.dom.confirmDecisionBtn) {
    state.dom.confirmDecisionBtn.textContent = config.label;
    state.dom.confirmDecisionBtn.className = config.buttonClass;
  }
  if (state.dom.leaveDecisionModalLabel) {
    state.dom.leaveDecisionModalLabel.textContent = config.label;
  }
  if (state.dom.leaveDecisionModalSubtext) {
    state.dom.leaveDecisionModalSubtext.textContent =
      `Review ${request.employeeName}'s ${request.leaveTypeName} request before you continue.`;
  }

  state.leaveDecisionModal?.show();
}

function setDecisionModalLoading(isLoading) {
  if (state.dom.confirmDecisionBtn) {
    state.dom.confirmDecisionBtn.disabled = isLoading;

    if (isLoading) {
      state.dom.confirmDecisionBtn.dataset.originalHtml = state.dom.confirmDecisionBtn.innerHTML;
      state.dom.confirmDecisionBtn.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Saving...
      `;
    } else if (state.dom.confirmDecisionBtn.dataset.originalHtml) {
      state.dom.confirmDecisionBtn.innerHTML = state.dom.confirmDecisionBtn.dataset.originalHtml;
      delete state.dom.confirmDecisionBtn.dataset.originalHtml;
    }
  }

  if (state.dom.closeDecisionModalBtn) {
    state.dom.closeDecisionModalBtn.disabled = isLoading;
  }
}

async function submitLeaveDecisionFromModal() {
  clearPageAlert();

  const request = state.pendingDecisionRequest;
  const action = state.pendingDecisionAction;

  if (!request || !action) {
    showPageAlert("warning", "No leave decision is currently selected.");
    return;
  }

  // SECONDARY MANAGER PENDING LEAVE VISIBILITY - STEP 1
  // Submission remains Primary-Manager-only in the browser as well as in the
  // existing database decision RPC.
  if (!canManagerDecideLeaveRequest(request)) {
    showPageAlert(
      "warning",
      "Only the Primary Manager or an actively delegated Secondary Manager can make this leave decision.",
    );
    return;
  }

  const status = getDecisionStatusFromAction(action);
  const comment = String(state.dom.decisionCommentInput?.value || "").trim();
  const { commentRequired } = getDecisionActionConfig(action);

  if (commentRequired && !comment) {
    showPageAlert("warning", "A comment is required for this leave decision.");
    state.dom.decisionCommentInput?.focus();
    return;
  }

  try {
    setDecisionModalLoading(true);
    setActionButtonLoading(state.pendingDecisionButton, true);

    if (status === "Approved") {
      // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
      // Defensive manager-side eligibility check. This blocks old bad pending
      // rows such as an ineligible Maternity/Paternity request before the
      // transactional database decision function is called.
      assertLeaveTypeEligibleForManagerApproval(request);

      // LEAVE APPROVAL IDEMPOTENCY / DOUBLE-DEDUCTION PROTECTION - STEP 1C
      // Keep the friendly same-employee overlap pre-check for manager feedback.
      // The database RPC also enforces this under row lock before saving.
      await assertNoOverlappingApprovedLeaveForEmployee(request);
    }

    // LEAVE APPROVAL IDEMPOTENCY / DOUBLE-DEDUCTION PROTECTION - STEP 1C
    // Balance deduction and decision audit are now handled together by the
    // database function. Do not call applyApprovedLeaveToBalance() here,
    // otherwise a retry/double-click could deduct entitlement more than once.
    await persistLeaveDecision(request.id, status, comment);

    notifyLeaveDecisionChanged();

    const successMessage =
      `${request.employeeName}'s leave request was ${status.toLowerCase()} successfully.`;

    showPageAlert("success", successMessage);

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Show a bottom-right notification immediately after approve/reject/return
    // so the manager gets feedback even when the top alert is out of view.
    showManagerDashboardToast(
      "success",
      getLeaveDecisionToastTitle(status),
      successMessage,
    );

    state.leaveDecisionModal?.hide();
    await loadTeamLeaveVisibility();

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
    // A completed decision belongs in audit history, so open and focus the
    // Processed Leave Decisions card immediately after the workspace refreshes.
    openProcessedRequestsCardAfterDecision();
  } catch (error) {
    console.error("Error saving leave decision:", error);

    const errorMessage =
      error?.message ||
      error?.details ||
      error?.hint ||
      "The leave decision could not be saved. Please try again.";

    showPageAlert("danger", errorMessage);

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Keep failure feedback visible near the manager's current viewport.
    showManagerDashboardToast(
      "danger",
      "Leave decision failed",
      errorMessage,
    );

    window.alert(`Leave decision save failed:

${errorMessage}`);
  } finally {
    setDecisionModalLoading(false);
    setActionButtonLoading(state.pendingDecisionButton, false);
  }
}

function switchManagerWorkspace(workspace) {
  const isDashboard = workspace === "dashboard";
  const isProfile = workspace === "profile";
  const isTeam = workspace === "team";
  const isSelfService = workspace === "selfservice";

  state.dom.managerDashboardSection?.classList.toggle("d-none", !isDashboard);
  state.dom.managerProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.managerTeamSection?.classList.toggle("d-none", !isTeam);
  state.dom.managerSelfServiceSection?.classList.toggle("d-none", !isSelfService);

  if (state.dom.managerTabDashboardBtn) {
    state.dom.managerTabDashboardBtn.className = isDashboard
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.managerTabTeamBtn) {
    state.dom.managerTabTeamBtn.className = isTeam
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.managerTabSelfServiceBtn) {
    state.dom.managerTabSelfServiceBtn.className = isSelfService
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.managerModuleValue) {
    state.dom.managerModuleValue.textContent = isProfile
      ? "Profile"
      : isTeam
        ? "Team Management"
        : isSelfService
          ? "My Self-Service"
          : "Dashboard";
  }

  renderManagerModernWorkspaceHeader(workspace);

  // Profile is opened from the account control, not the desktop sidebar.
  [
    { id: "sidebarManagerDashboardBtn", active: isDashboard },
    { id: "sidebarManagerTeamBtn", active: isTeam },
    { id: "sidebarManagerSelfServiceBtn", active: isSelfService },
  ].forEach(({ id, active }) => {
    const item = document.getElementById(id);
    if (item) item.classList.toggle("active", active);
  });
}

// EMPLOYEE SELF-SERVICE - MANAGER
// Lazily initialises the self-service module on the first time the Manager opens
// the Self-Service tab. Subsequent clicks only remember/switch the workspace.
let _managerSelfServiceInitialised = false;

function initManagerSelfServiceOnFirstOpen() {
  if (_managerSelfServiceInitialised) return;

  if (!window.EmployeeSelfService) {
    console.warn("EmployeeSelfService module is not loaded.");
    return;
  }

  _managerSelfServiceInitialised = true;
  window.EmployeeSelfService.init(state.currentUser, state.currentProfile).catch((err) => {
    console.error("Manager self-service init error:", err);
    _managerSelfServiceInitialised = false; // allow retry on next open
  });
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Date-only leave fields should display without timezone drift.
// This keeps manager approval dates compact and predictable.
function getDashboardDisplayDate(value) {
  if (!value) return null;

  const rawValue = String(value || "").trim();
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

  const date = dateOnlyPattern.test(rawValue)
    ? new Date(`${rawValue}T00:00:00`)
    : new Date(rawValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Format as "Jul 1" so Leave Period can show "Jul 1 - Jul 5"
// with the year stacked underneath.
function formatShortMonthDayFromDate(date) {
  if (!date) return "--";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Split submitted timestamp into date and time, matching the cleaner HR-style
// stacked timestamp pattern used elsewhere in the dashboards.
function formatSubmittedDateTimeParts(value) {
  const date = getDashboardDisplayDate(value);

  if (!date) {
    return {
      dateLabel: "--",
      timeLabel: "--",
    };
  }

  return {
    dateLabel: date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    timeLabel: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function getInitials(fullName, fallback = "MG") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return fallback;

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

// MANAGER PROFILE DEPARTMENT SEEDING
// Resolves the manager's department from their employees record (set by HR
// from the controlled organization_departments list). Syncs the value into
// profiles.department if the profile department is blank or out of date.
// Does not insert into organization_departments because department setup is owned
// by HR/Admin through Manage Organization.
async function ensureManagerProfileDepartment(supabase, profileData) {
  if (!profileData) return profileData;

  try {
    const userId = String(state.currentUser?.id || "").trim();
    const email = normalizeText(
      profileData.email || state.currentUser?.email,
    );

    // Look up the manager's employee record to get their HR-assigned department.
    let employeeDept = "";

    if (userId) {
      const { data: empByUser } = await supabase
        .from("employees")
        .select("department")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      employeeDept = String(empByUser?.department || "").trim();
    }

    if (!employeeDept && email) {
      const { data: empByEmail } = await supabase
        .from("employees")
        .select("department")
        .ilike("work_email", email)
        .limit(1)
        .maybeSingle();

      employeeDept = String(empByEmail?.department || "").trim();
    }

    // Nothing to sync if no employee record department was found.
    if (!employeeDept) return profileData;

    // CROSS-DASHBOARD SIDEBAR REPLICATION - MANAGER STEP 1C-2B
    // Manager dashboard must not create controlled organization setup values.
    // Department setup is owned by HR/Admin through Manage Organization.
    // The manager profile can still display/sync the department assigned on
    // the employee record, but it must not insert into organization_departments.
    // Sync into profiles.department if blank or different from employee record.
    const profileDept = String(profileData.department || "").trim();
    if (profileDept !== employeeDept) {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({ department: employeeDept })
        .eq("id", profileData.id)
        .select("*")
        .maybeSingle();

      if (updateError) {
        console.warn("Manager department seed: profile update failed:", updateError);
      } else if (updatedProfile) {
        return updatedProfile;
      }
    }
  } catch (err) {
    console.error("ensureManagerProfileDepartment unexpected error:", err);
  }

  return profileData;
}

async function loadLatestManagerProfile() {
  if (!state.currentUser?.id) return state.currentProfile;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", state.currentUser.id)
      .maybeSingle();

    if (error) throw error;

    // MANAGER PROFILE DEPARTMENT SEEDING
    // Sync department from the manager's employee record (HR-assigned, controlled list).
    const profile = await ensureManagerProfileDepartment(supabase, data);

    if (profile) state.currentProfile = profile;
    return state.currentProfile;
  } catch (error) {
    console.error("Error loading latest manager profile:", error);
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

// MANAGER HEADER RESPONSIBILITY BADGE - v1.0.0
function renderManagerHeaderResponsibilityBadge(
  label = "Manager",
  mode = "manager",
) {
  const container = state.dom.managerRole;
  if (!container) return;

  container.innerHTML = "";

  const badge = document.createElement("span");
  badge.className =
    "manager-modern-account-responsibility-pill " +
    `manager-modern-account-responsibility-pill--${mode}`;

  badge.textContent = label;

  container.appendChild(badge);
  container.setAttribute("aria-label", label);
}

function renderManagerProfile(profile, user) {
  const fullName = profile?.full_name || "Manager";
  const email = profile?.email || user?.email || "No email";
  const role = String(profile?.role || "manager").toLowerCase();
  const department = profile?.department || "";
  const initials = getInitials(fullName, "MG");

  if (state.dom.managerEmail) state.dom.managerEmail.textContent = email;
  // MANAGER HEADER COVERAGE FIRST PAINT - v1.0.0
  // Keep the account responsibility area neutral while the authenticated
  // manager's Primary and Secondary coverage is being resolved.
  if (state.dom.managerRole) {
    state.dom.managerRole.innerHTML = "";
    state.dom.managerRole.setAttribute(
      "aria-label",
      "Manager coverage loading",
    );
    state.dom.managerRole.setAttribute("aria-busy", "true");
  }
  if (state.dom.managerInitials) {
    state.dom.managerInitials.textContent = initials;
    state.dom.managerInitials.classList.remove("d-none");
  }
  if (state.dom.managerFullName) state.dom.managerFullName.textContent = fullName;
  if (state.dom.managerEmailTile) state.dom.managerEmailTile.textContent = email;
  if (state.dom.managerRoleTile) state.dom.managerRoleTile.textContent = role;
  if (state.dom.managerDepartment) {
    state.dom.managerDepartment.textContent = department || "--";
  }

  renderManagerModernWorkspaceHeader(getRememberedManagerWorkspace());

  if (state.dom.managerProfileAvatar) {
    state.dom.managerProfileAvatar.textContent = initials;
    state.dom.managerProfileAvatar.classList.remove("d-none");
  }

  if (state.dom.managerProfileCardName) {
    state.dom.managerProfileCardName.textContent = fullName;
  }

  if (state.dom.managerProfileCardEmail) {
    state.dom.managerProfileCardEmail.textContent = email;
  }

  if (state.dom.managerProfileFullName) {
    state.dom.managerProfileFullName.value = fullName;
  }

  if (state.dom.managerProfileEmail) {
    state.dom.managerProfileEmail.value = email;
  }

  if (state.dom.managerProfileRole) {
    state.dom.managerProfileRole.value = role;
  }

  if (state.dom.managerProfileDepartment) {
    state.dom.managerProfileDepartment.value = department;
  }

  if (state.dom.managerProfileImagePreview) {
    state.dom.managerProfileImagePreview.src = "";
    state.dom.managerProfileImagePreview.classList.add("d-none");
  }

  if (state.dom.managerHeroImage) {
    state.dom.managerHeroImage.src = "";
    state.dom.managerHeroImage.classList.add("d-none");
  }

  void loadManagerProfileImages(profile?.profile_image_path, initials);

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // After rendering loaded/saved profile data, treat it as the clean baseline.
  state.currentProfileEditableBaseline = getManagerProfileEditableSnapshot();
  updateManagerProfileSaveButtonState();
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Shared button readiness behaviour for this manager page.
// Incomplete or unchanged form = grey and disabled.
// Changed and valid form = blue and enabled.
function setPrimaryActionButtonReadyState(button, canSubmit) {
  if (!button) return;

  button.disabled = !canSubmit;
  button.classList.toggle("btn-primary", canSubmit);
  button.classList.toggle("btn-secondary", !canSubmit);
}

// SYSTEM-WIDE MANAGER EMPLOYEE IDENTITY AUTHORITY - v1.0.0
// Manager My Profile no longer owns employee-name changes.
//
// The authoritative name comes from the linked employees record and is
// synchronised into profiles.full_name by the shared database name sync.
//
// This applies to every Manager tenant, including Alpatech.
function getManagerProfileEditableSnapshot() {
  return {};
}

function hasManagerProfileEditableChanges() {
  return false;
}

function isManagerProfileFormReadyForSubmit() {
  return false;
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Full Name remains required; Department is optional.
function isManagerProfileFormReadyForSubmit() {
  const hasFullName = Boolean(
    String(state.dom.managerProfileFullName?.value || "").trim(),
  );

  return hasFullName && hasManagerProfileEditableChanges();
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Keep Save Profile Changes aligned with the HR/Admin profile behaviour.
function updateManagerProfileSaveButtonState() {
  setPrimaryActionButtonReadyState(
    state.dom.saveManagerProfileBtn,
    isManagerProfileFormReadyForSubmit(),
  );
}

// SYSTEM-WIDE MANAGER EMPLOYEE IDENTITY AUTHORITY - v1.0.0
// Prevent My Profile from creating a second employee-name source.
// The structured HR People record remains authoritative.
async function saveManagerOwnProfile() {
  showPageAlert(
    "info",
    "Your name is maintained from your HR employee record.",
  );

  updateManagerProfileSaveButtonState();
}

function setProfileImageSaveLoading(isLoading) {
  const button = state.dom.saveManagerProfileImageBtn;
  if (!button) return;

  button.disabled = isLoading;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.dataset.originalClass = button.className;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Uploading...
    `;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    button.className = button.dataset.originalClass || "btn btn-outline-primary dashboard-action-btn";
    delete button.dataset.originalHtml;
    delete button.dataset.originalClass;
    // Re-evaluate: keep disabled if no file is pending
    button.disabled = !state.pendingProfileImageFile;
    button.className = state.pendingProfileImageFile
      ? "btn btn-outline-primary dashboard-action-btn"
      : "btn btn-secondary dashboard-action-btn";
  }
}

function updateManagerProfileImageButtonState() {
  const button = state.dom.saveManagerProfileImageBtn;
  if (!button) return;

  const hasFile = Boolean(state.pendingProfileImageFile);
  button.disabled = !hasFile;
  button.className = hasFile
    ? "btn btn-outline-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function handlePendingProfileImage(file) {
  state.pendingProfileImageFile = null;

  if (!file) {
    if (state.currentProfile) {
      renderManagerProfile(state.currentProfile, state.currentUser);
    }
    updateManagerProfileImageButtonState();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }
    updateManagerProfileImageButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }
    updateManagerProfileImageButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateManagerProfileImageButtonState();

  const reader = new FileReader();
  reader.onload = () => {
    if (state.dom.managerProfileImagePreview) {
      state.dom.managerProfileImagePreview.src = reader.result;
      state.dom.managerProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.classList.add("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = reader.result;
      state.dom.managerHeroImage.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.classList.add("d-none");
    }
  };
  reader.readAsDataURL(file);
}

async function loadManagerProfileImages(profileImagePath, initials) {
  // MANAGER PROFILE IMAGE REMOVAL - v1.0.0
  // Enable Remove Picture only when the current profile has a stored image.
  if (state.dom.removeManagerProfileImageBtn) {
    state.dom.removeManagerProfileImageBtn.disabled =
      !String(profileImagePath || "").trim();
  }

  if (!profileImagePath) {
    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.textContent = initials;
      state.dom.managerProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.textContent = initials;
      state.dom.managerInitials.classList.remove("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = "";
      state.dom.managerHeroImage.classList.add("d-none");
    }

    return;
  }

  try {
    const signedImageUrl = await getSignedProfileImageUrl(profileImagePath);
    if (!signedImageUrl) return;

    if (state.dom.managerProfileImagePreview) {
      state.dom.managerProfileImagePreview.src = signedImageUrl;
      state.dom.managerProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.classList.add("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = signedImageUrl;
      state.dom.managerHeroImage.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.classList.add("d-none");
    }
  } catch (error) {
    console.error("Error lazy-loading manager profile image:", error);
  }
}

async function uploadManagerProfileImage() {
  if (!state.pendingProfileImageFile) {
    showPageAlert("warning", "Please choose an image before uploading.");
    return;
  }

  try {
    setProfileImageSaveLoading(true);

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

    state.pendingProfileImageFile = null;
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }

    await loadLatestManagerProfile();
    renderManagerProfile(state.currentProfile, state.currentUser);

    showPageAlert("success", "Your profile photo was uploaded successfully.");
  } catch (error) {
    console.error("Error uploading manager profile image:", error);
    showPageAlert(
      "danger",
      error.message || "Profile photo could not be uploaded.",
    );
  } finally {
    setProfileImageSaveLoading(false);
  }
}

// MANAGER PROFILE IMAGE REMOVAL - v1.0.0
// Clears the signed-in Manager's profile-image reference first, restores the
// initials fallback, then attempts best-effort storage cleanup.
async function removeManagerProfileImage() {
  if (!state.currentUser?.id) {
    showPageAlert(
      "warning",
      "Your Manager profile is not ready yet.",
    );
    return;
  }

  const existingImagePath = String(
    state.currentProfile?.profile_image_path || "",
  ).trim();

  if (!existingImagePath) {
    await loadManagerProfileImages(
      "",
      getInitials(
        state.currentProfile?.full_name || "Manager",
        "MG",
      ),
    );
    return;
  }

  const button = state.dom.removeManagerProfileImageBtn;
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

    // Clear the profile reference first so refresh cannot restore the image.
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

    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }

    if (state.dom.managerProfileImagePreview) {
      state.dom.managerProfileImagePreview.src = "";
      state.dom.managerProfileImagePreview.classList.add("d-none");
    }

    const initials = getInitials(
      state.currentProfile?.full_name || "Manager",
      "MG",
    );

    await loadManagerProfileImages("", initials);
    updateManagerProfileImageButtonState();

    // Storage deletion is best-effort. The profile reference has already
    // been cleared safely even if object cleanup is unavailable.
    const { error: storageError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .remove([existingImagePath]);

    if (storageError) {
      console.warn(
        "Manager profile image reference was cleared, but storage cleanup failed:",
        storageError,
      );
    }

    showPageAlert(
      "success",
      "Profile picture removed successfully.",
    );
  } catch (error) {
    console.error(
      "Error removing Manager profile image:",
      error,
    );

    showPageAlert(
      "danger",
      error.message ||
        "Profile picture could not be removed.",
    );
  } finally {
    if (button) {
      button.innerHTML = originalHtml;
      button.disabled = !String(
        state.currentProfile?.profile_image_path || "",
      ).trim();
    }
  }
}

function setProfileSaveLoading(isLoading) {
  const button = state.dom.saveManagerProfileBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // After saving/loading ends, recalculate whether editable profile changes still exist.
  updateManagerProfileSaveButtonState();
}

function getFirstAvailableValue(row, keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }
  }

  return "";
}

function getEmployeeFullName(row) {
  const firstName = getFirstAvailableValue(row, ["first_name", "firstname"]);
  const lastName = getFirstAvailableValue(row, ["last_name", "lastname"]);
  const combined = `${firstName} ${lastName}`.trim();

  if (combined) return combined;

  return (
    getFirstAvailableValue(row, ["full_name", "name"]) || "Unnamed Employee"
  );
}

function rowMatchesManager(row, managerEmail, managerFullName) {
  const possibleManagerEmailFields = [
    "approver_email",
    "manager_email",
    "line_manager_email",
    "supervisor_email",
    "reports_to_email",
    "reporting_manager_email",
  ];

  const possibleManagerNameFields = [
    "line_manager",
    "line_manager_name",
    "manager_name",
    "supervisor_name",
    "reports_to_name",
    "reporting_manager",
    "approver_name",
  ];

  const emailMatch = possibleManagerEmailFields.some((fieldName) => {
    const value = normalizeText(row[fieldName]);
    return value && managerEmail && value === managerEmail;
  });

  const nameMatch = possibleManagerNameFields.some((fieldName) => {
    const value = normalizeText(row[fieldName]);
    return value && managerFullName && value === managerFullName;
  });

  return emailMatch || nameMatch;
}

function getManagerRelationshipLabel(row, managerEmail, managerFullName) {
  const relationshipLabels = [];

  const emailFieldMap = [
    { field: "approver_email", label: "Approver" },
    { field: "manager_email", label: "Manager" },
    { field: "line_manager_email", label: "Line Manager" },
    { field: "supervisor_email", label: "Supervisor" },
    { field: "reports_to_email", label: "Reports To" },
    { field: "reporting_manager_email", label: "Reporting Manager" },
  ];

  const nameFieldMap = [
    { field: "line_manager", label: "Line Manager" },
    { field: "line_manager_name", label: "Line Manager" },
    { field: "manager_name", label: "Manager" },
    { field: "supervisor_name", label: "Supervisor" },
    { field: "reports_to_name", label: "Reports To" },
    { field: "reporting_manager", label: "Reporting Manager" },
    { field: "approver_name", label: "Approver" },
  ];

  emailFieldMap.forEach((item) => {
    const value = normalizeText(row[item.field]);
    if (value && managerEmail && value === managerEmail) {
      relationshipLabels.push(item.label);
    }
  });

  nameFieldMap.forEach((item) => {
    const value = normalizeText(row[item.field]);
    if (value && managerFullName && value === managerFullName) {
      relationshipLabels.push(item.label);
    }
  });

  const uniqueLabels = [...new Set(relationshipLabels)];

  // MANAGER APPROVAL WIRING HARDENING - STEP 1B
  // When RLS has already scoped the employee through employee_reporting_lines,
  // old free-text manager fields may be blank or different. Show a stable
  // HR-facing relationship label instead of implying the row is unassigned.
  return uniqueLabels.length ? uniqueLabels.join(" / ") : "Primary Manager";
}

function getEmploymentDate(row) {
  return getFirstAvailableValue(row, [
    "employment_date",
    "hire_date",
    "date_of_employment",
    "start_date",
    "joining_date",
  ]);
}

function getDepartment(row) {
  return getFirstAvailableValue(row, ["department", "department_name"]) || "--";
}

function getJobTitle(row) {
  return (
    getFirstAvailableValue(row, ["job_title", "position", "role_title"]) || "--"
  );
}

function getWorkEmail(row) {
  return getFirstAvailableValue(row, [
    "work_email",
    "email",
    "official_email",
    "employee_email",
  ]);
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Resolve the logged-in manager to their employee master record.
// The reporting-line table uses employees.id as manager_employee_id, so the
// dashboard must not rely on free-text manager names or global employee RLS.
async function loadCurrentManagerEmployeeRecord() {
  const supabase = getSupabaseClient();
  const managerUserId = String(state.currentUser?.id || "").trim();
  const managerEmail = normalizeText(
    state.currentProfile?.email || state.currentUser?.email,
  );

  if (managerUserId) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", managerUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Manager employee lookup by user_id failed:", error);
    } else if (data) {
      return data;
    }
  }

  if (managerEmail) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .ilike("work_email", managerEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Load active employee_reporting_lines rows for the resolved manager employee.
// This is the source of truth for the manager's assigned team.
async function loadActiveManagerReportingLineRows(managerEmployeeId) {
  const supabase = getSupabaseClient();

  // MANAGER DASHBOARD WIRING - STEP 2A FIX
  // Use the manager-safe RPC first. Direct frontend reads from
  // employee_reporting_lines can return 0 rows under RLS even when the
  // reporting-line data exists. The RPC resolves the logged-in manager from
  // auth.uid()/auth email and returns only that manager's active assignments.
  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "get_manager_reporting_line_assignments",
  );

  if (!rpcError && Array.isArray(rpcRows)) {
    return rpcRows.filter(
      (row) => normalizeText(row.status) === "active",
    );
  }

  console.warn(
    "Manager reporting-line RPC failed; falling back to direct table read:",
    rpcError,
  );

  // MANAGER DASHBOARD WIRING - STEP 2A FIX
  // Fallback only. This keeps the page usable in local/dev environments where
  // the RPC has not yet been deployed, but production should use the RPC path.
  if (!managerEmployeeId) return [];

  const { data, error } = await supabase
    .from("employee_reporting_lines")
    .select("id, employee_id, manager_employee_id, manager_type, status, effective_date")
    .eq("manager_employee_id", managerEmployeeId)
    .order("effective_date", { ascending: false });

  if (error) throw error;

  return (Array.isArray(data) ? data : []).filter(
    (row) => normalizeText(row.status) === "active",
  );
}

// MANAGER DASHBOARD WIRING - STEP 2A
// If an employee has more than one active row for the same manager, keep the
// most HR-relevant row: Primary first, then latest effective date.
function compareReportingLinePriority(left = {}, right = {}) {
  const leftPrimaryRank = normalizeText(left.manager_type) === "primary" ? 0 : 1;
  const rightPrimaryRank = normalizeText(right.manager_type) === "primary" ? 0 : 1;

  if (leftPrimaryRank !== rightPrimaryRank) {
    return leftPrimaryRank - rightPrimaryRank;
  }

  const leftDate = new Date(left.effective_date || 0).getTime();
  const rightDate = new Date(right.effective_date || 0).getTime();

  return rightDate - leftDate;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Build a quick lookup so employee records, leave requests, and relationship
// labels are all tied back to employee_reporting_lines rather than hardcoded
// names such as a single test employee.
function buildReportingLineByEmployeeId(reportingLineRows = []) {
  const reportingLineByEmployeeId = new Map();

  [...reportingLineRows]
    .sort(compareReportingLinePriority)
    .forEach((row) => {
      const employeeId = String(row.employee_id || "").trim();
      if (!employeeId || reportingLineByEmployeeId.has(employeeId)) return;

      reportingLineByEmployeeId.set(employeeId, row);
    });

  return reportingLineByEmployeeId;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Display-only relationship text. The security/wiring decision is still made
// by employee_reporting_lines and Supabase RLS.
function getReportingLineRelationshipLabel(reportingLineRow = {}) {
  const managerType = String(reportingLineRow.manager_type || "").trim();

  if (managerType) {
    return `${managerType} Manager`;
  }

  return "Reporting Line Manager";
}

// LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
// HR-safe default: only the Primary Manager owns approval.
// Additional managers receive processed-decision visibility for cover planning.
function isPrimaryReportingManagerRelationship(relationshipLabel = "") {
  return normalizeText(relationshipLabel).includes("primary");
}

// LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
// A decision is FYI for this manager when the employee is visible through an
// additional reporting line and the decision was made by another manager.
function isAdditionalManagerProcessedDecisionFyi(item = {}) {
  const status = normalizeText(item.status);

  const isProcessedDecision = [
    "approved",
    "rejected",
    "returned",
    "returned for clarification",
  ].includes(status);

  if (!isProcessedDecision) return false;

  if (isPrimaryReportingManagerRelationship(item.managerRelationshipLabel)) {
    return false;
  }

  const decisionBy = String(item.decision_by || "").trim();
  const currentUserId = String(state.currentUser?.id || "").trim();

  return Boolean(!decisionBy || decisionBy !== currentUserId);
}

// LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
// Stable in-memory key for preventing repeated FYI toasts in the same session.
function getAdditionalManagerLeaveDecisionFyiKey(item = {}) {
  return [
    item.id || "",
    item.status || "",
    item.decision_at || "",
    item.decision_by || "",
  ].join("|");
}

// LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
// Short manager-facing wording for processed leave decisions.
function getProcessedDecisionVerb(status = "") {
  const normalizedStatus = normalizeText(status);

  if (normalizedStatus === "approved") return "approved";
  if (normalizedStatus === "rejected") return "rejected";
  if (
    normalizedStatus === "returned" ||
    normalizedStatus === "returned for clarification"
  ) {
    return "returned";
  }

  return "updated";
}

// LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
// Notify additional managers that a primary manager has acted.
// This is intentionally in-app only. It does not send email, does not create
// approval rights, and does not write notification data to the database.
function notifyAdditionalManagersOfProcessedLeaveDecisions(processedRequests = []) {
  const fyiItems = processedRequests.filter(isAdditionalManagerProcessedDecisionFyi);

  const unseenItems = fyiItems.filter((item) => {
    const key = getAdditionalManagerLeaveDecisionFyiKey(item);

    if (!key || state.seenAdditionalManagerLeaveDecisionFyiKeys.has(key)) {
      return false;
    }

    state.seenAdditionalManagerLeaveDecisionFyiKeys.add(key);
    return true;
  });

  if (!unseenItems.length) return;

  if (unseenItems.length === 1) {
    const item = unseenItems[0];
    const decisionBy = item.decision_by_name || "The primary manager";
    const decisionVerb = getProcessedDecisionVerb(item.status);

    showManagerDashboardToast(
      "info",
      "Leave decision FYI",
      `${decisionBy} ${decisionVerb} ${item.employeeName || "an employee"}'s leave request. No action is required from you.`,
    );

    return;
  }

  showManagerDashboardToast(
    "info",
    "Team leave decisions updated",
    `${unseenItems.length} leave decisions for employees in your reporting line have been updated. Review Processed Leave Decisions for details.`,
  );
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
// Employee portal access should be resolved by linked profile/user ID where
// available, not email only. This keeps manually seeded/Supabase-created
// employee records from showing "No login" when a real profile exists.
function getEmployeeProfileIdCandidates(row = {}) {
  const candidates = [
    row.user_id,
    row.profile_id,
    row.auth_user_id,
    row.profile_user_id,
    row.employee_user_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(candidates)];
}

function getTeamStatusLabel(profile) {
  if (!profile) return "Employees Missing Login";
  if (profile.is_active === false) return "Inactive";
  return "Active";
}

function getTeamStatusBadgeClass(profile) {
  if (!profile) return "bexhr-status-pill--warning";
  if (profile.is_active === false) return "bexhr-status-pill--neutral";
  return "bexhr-status-pill--success";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Read portal access from a manager-safe RPC instead of relying on direct
// frontend reads from profiles, which can be blocked by RLS for other employees.
async function loadManagerTeamPortalAccessStatusRows() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc(
      "get_manager_team_portal_access_status",
    );

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Unable to load manager team portal access status:", error);
    return [];
  }
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Portal Access is not live presence. It means the employee has a linked
// auth user and profile account for employee self-service.
function getTeamStatusLabelFromPortalAccess(portalAccessRow, fallbackProfile) {
  if (!portalAccessRow) {
    return getTeamStatusLabel(fallbackProfile);
  }

  if (portalAccessRow.has_portal_access && portalAccessRow.portal_is_active) {
    return "Active";
  }

  if (portalAccessRow.has_portal_access && !portalAccessRow.portal_is_active) {
    return "Inactive";
  }

  return "Employees Missing Login";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Keep badge styling consistent with the existing manager table.
function getTeamStatusBadgeClassFromPortalAccess(portalAccessRow, fallbackProfile) {
  if (!portalAccessRow) {
    return getTeamStatusBadgeClass(fallbackProfile);
  }

  if (portalAccessRow.has_portal_access && portalAccessRow.portal_is_active) {
    return "bexhr-status-pill--success";
  }

  if (portalAccessRow.has_portal_access && !portalAccessRow.portal_is_active) {
    return "bexhr-status-pill--neutral";
  }

  return "bexhr-status-pill--warning";
}

function getLeaveIdentityCandidatesForMember(member) {
  const candidates = [
    member?.id,
    member?.raw?.id,
    member?.raw?.user_id,
    member?.matchedProfile?.id,
  ].filter(Boolean);

  return [...new Set(candidates.map((value) => String(value)))];
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA);
  const aEnd = new Date(endA);
  const bStart = new Date(startB);
  const bEnd = new Date(endB);

  if (
    Number.isNaN(aStart.getTime()) ||
    Number.isNaN(aEnd.getTime()) ||
    Number.isNaN(bStart.getTime()) ||
    Number.isNaN(bEnd.getTime())
  ) {
    return false;
  }

  return aStart <= bEnd && bStart <= aEnd;
}

function addOverlapFlagsToLeaveItems(items) {
  return items.map((currentItem) => {
    const overlappingItems = items.filter((otherItem) => {
      if (String(currentItem.id) === String(otherItem.id)) return false;
      if (currentItem.employeeName === otherItem.employeeName) return false;

      return rangesOverlap(
        currentItem.start_date,
        currentItem.end_date,
        otherItem.start_date,
        otherItem.end_date,
      );
    });

    const overlappingEmployees = [
      ...new Set(
        overlappingItems
          .map((item) => String(item.employeeName || "").trim())
          .filter(Boolean),
      ),
    ];

    return {
      ...currentItem,
      hasOverlap: overlappingEmployees.length > 0,
      overlapCount: overlappingEmployees.length,
      overlappingEmployees,
    };
  });
}

function getOverlapSummaryText(item) {
  const names = Array.isArray(item?.overlappingEmployees)
    ? item.overlappingEmployees.filter(Boolean)
    : [];

  if (!names.length) {
    return "Clear";
  }

  if (names.length <= 3) {
    return `Conflict with ${names.join(", ")}`;
  }

  return `Conflict with ${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function buildOverlapCellHtml(item) {
  if (!item?.hasOverlap) {
    return '<span class="badge text-bg-success">Clear</span>';
  }

  return `
    <div>
      <span class="badge text-bg-warning">Conflict (${escapeHtml(item.overlapCount)})</span>
    </div>
    <div class="small text-secondary mt-1">
      ${escapeHtml(getOverlapSummaryText(item))}
    </div>
  `;
}

// MANAGER DASHBOARD WIRING - STEP 2G
// Pending approval rows should tell the manager when approval cannot succeed
// because the employee has no remaining balance for the requested leave type.
// This is display/readiness logic only; applyApprovedLeaveToBalance() remains
// the final save-time control.
function getPendingRequestBalanceWarning(request = {}) {
  if (!request.leave_type_id) {
    return "Leave type is missing, so approval cannot be completed.";
  }

  if (request.leaveBalanceMissing) {
    return `No ${request.leaveTypeName || "leave"} balance record exists for this employee.`;
  }

  const requestedDays = Number(request.total_days || 0);
  const remainingDays = Number(request.leaveBalanceRemainingDays);

  if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
    return "Requested days are invalid, so approval cannot be completed.";
  }

  if (!Number.isFinite(remainingDays)) {
    return null;
  }

  if (remainingDays < requestedDays) {
    return `Remaining ${request.leaveTypeName || "leave"} balance is ${remainingDays}; requested days is ${requestedDays}.`;
  }

  return null;
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Normalise employee gender from the HR employee record for manager-side
// eligibility checks. This mirrors the Employee Dashboard rule but uses
// the enriched manager request item.
function getNormalisedEmployeeGenderForManagerEligibility(request = {}) {
  const rawGender = normalizeText(
    request.employeeGender ||
    request.gender ||
    request.sex ||
    request.gender_identity ||
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

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Manager-facing eligibility warning. Keep wording professional and neutral;
// do not expose blunt gender wording in the approval queue.
function getPendingRequestEligibilityWarning(request = {}) {
  const eligibilityRule = normalizeText(
    request.leaveTypeEligibilityRule || "all_employees",
  );

  if (!request.leave_type_id || eligibilityRule === "all_employees") {
    return null;
  }

  const leaveTypeName = request.leaveTypeName || "This leave type";
  const employeeName = request.employeeName || "this employee";

  if (eligibilityRule === "hr_review_only") {
    return `${leaveTypeName} requires HR review before manager approval. Return or reject the request, or contact HR for special handling.`;
  }

  const employeeGender = getNormalisedEmployeeGenderForManagerEligibility(request);

  if (eligibilityRule === "female_only" && employeeGender === "female") {
    return null;
  }

  if (eligibilityRule === "male_only" && employeeGender === "male") {
    return null;
  }

  if (eligibilityRule === "female_only" || eligibilityRule === "male_only") {
    return `${leaveTypeName} is not available for ${employeeName}'s employee profile. Return or reject the request, or contact HR if special handling is required.`;
  }

  return null;
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Save-time defensive check. This protects against old pending rows, direct
// database inserts, stale browser DOM, or any route that bypasses the visible
// disabled Approve button.
function assertLeaveTypeEligibleForManagerApproval(request = {}) {
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);

  if (eligibilityWarning) {
    throw new Error(eligibilityWarning);
  }
}

// MANAGER DASHBOARD WIRING - STEP 2G
// Keep this as a small wrapper so future HR controls can block approval
// without disabling reject/return actions.
function getPendingRequestApproveBlockReason(request = {}) {
  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
  // Eligibility is checked before balance. If the employee profile is not
  // eligible for the leave type, approval must not proceed regardless of
  // remaining entitlement.
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);

  if (eligibilityWarning) {
    return eligibilityWarning;
  }

  return getPendingRequestBalanceWarning(request);
}

// MANAGER DASHBOARD WIRING - STEP 2F FIX
// HR control: an employee can hold multiple future leave bookings, but they
// must not have two approved leave records covering the same calendar days.
// This check must query leave_requests using the leave-request identity
// candidates, not only employees.id, because leave_requests.employee_id is
// linked to the user/profile identity in this build.
async function assertNoOverlappingApprovedLeaveForEmployee(request = {}) {
  const supabase = getSupabaseClient();

  const leaveRequestEmployeeIds = [
    request.employee_id,
    request.employeeRecordId,
    ...(Array.isArray(request.employeeLeaveIdentityCandidates)
      ? request.employeeLeaveIdentityCandidates
      : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const uniqueLeaveRequestEmployeeIds = [...new Set(leaveRequestEmployeeIds)];

  if (
    !uniqueLeaveRequestEmployeeIds.length ||
    !request.start_date ||
    !request.end_date
  ) {
    throw new Error(
      "Employee or leave dates could not be resolved, so overlap validation could not be completed.",
    );
  }

  const { data, error } = await supabase
    .from("leave_requests")
    .select(`
      id,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      total_days,
      status,
      leave_types (
        id,
        code,
        name
      )
    `)
    .in("employee_id", uniqueLeaveRequestEmployeeIds)
    .neq("id", request.id);

  if (error) throw error;

  const overlappingApprovedLeave = (Array.isArray(data) ? data : []).find(
    (existingLeave) =>
      normalizeText(existingLeave.status) === "approved" &&
      rangesOverlap(
        request.start_date,
        request.end_date,
        existingLeave.start_date,
        existingLeave.end_date,
      ),
  );

  if (!overlappingApprovedLeave) return;

  const existingLeaveType =
    overlappingApprovedLeave.leave_types?.name || "approved leave";

  throw new Error(
    `${request.employeeName} already has approved ${existingLeaveType} from ${formatDate(overlappingApprovedLeave.start_date)} to ${formatDate(overlappingApprovedLeave.end_date)}. Return, reject, or amend the duplicate/overlapping request before approving another leave for the same period.`,
  );
}

function getStatusBadgeClass(status) {
  switch (normalizeText(status)) {
    case "approved":
      return "bexhr-status-pill--success";
    case "cancelled":
      return "bexhr-status-pill--neutral";
    case "rejected":
      return "bexhr-status-pill--danger";
    case "returned":
    case "returned for clarification":
      return "bexhr-status-pill--warning";
    default:
      return "bexhr-status-pill--neutral";
  }
}

function getStatusPillIconClass(status) {
  switch (normalizeText(status)) {
    case "approved":
      return "bi-check-circle-fill";
    case "cancelled":
      return "bi-x-circle-fill";
    case "rejected":
      return "bi-slash-circle-fill";
    case "returned":
    case "returned for clarification":
      return "bi-arrow-return-left";
    default:
      return "bi-dash-circle-fill";
  }
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
// Keep long workflow labels compact in audit tables.
// The saved status remains unchanged; this only affects display text.
function getCompactDecisionStatusLabel(status) {
  const normalizedStatus = normalizeText(status);

  if (
    normalizedStatus === "returned for clarification" ||
    normalizedStatus === "returned"
  ) {
    return "Returned";
  }

  // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
  // Keep HR cancellation compact in the manager audit table.
  if (normalizedStatus === "cancelled") {
    return "Cancelled";
  }

  return status || "--";
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Keep pending approval rows readable by grouping identity, period,
// review signals, and actions. These helpers are display-only and do
// not change approval, RLS, employee_reporting_lines, or balance logic.
function getPendingRequestStableEmployeeKey(request = {}) {
  return String(
    request.employeeRecordId ||
    request.employee_id ||
    request.employeeEmail ||
    request.employeeName ||
    "",
  ).trim();
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Detect other pending requests for the same employee in the visible manager queue.
// This gives the manager a review signal without changing the saved leave data.
function getSameEmployeePendingRequestCount(request = {}, requests = []) {
  const currentId = String(request.id || "").trim();
  const currentEmployeeKey = getPendingRequestStableEmployeeKey(request);

  if (!currentEmployeeKey) return 0;

  return requests.filter((item) => {
    return (
      String(item.id || "").trim() !== currentId &&
      getPendingRequestStableEmployeeKey(item) === currentEmployeeKey
    );
  }).length;
}

// MANAGER PENDING REQUEST EMPLOYEE IDENTITY - v1.0.1
// Displays a compact employee identity and opens a restricted,
// read-only Manager Employee Details view.
//
// Security:
// - no new Supabase query;
// - no arbitrary employee lookup;
// - employee must already exist in state.teamMembers;
// - no salary, bank, tax, personal-address, document, or medical fields.
function buildPendingRequestIdentityHtml(request = {}) {
  const employeeName = String(
    request.employeeName || "Unknown Employee",
  ).trim();

  const employeeRecordId = String(
    request.employeeRecordId || "",
  ).trim();

  const employeeInitials =
    employeeName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((namePart) => namePart.charAt(0).toUpperCase())
      .join("") || "TM";

  const employeeNameControl = employeeRecordId
    ? `
      <button type="button"
        class="manager-pending-employee-name-link"
        data-manager-employee-id="${escapeHtml(employeeRecordId)}"
        onclick="window.managerOpenEmployeeDetails?.(
          this.dataset.managerEmployeeId
        )"
        aria-label="View work details for ${escapeHtml(employeeName)}">
        ${escapeHtml(employeeName)}
      </button>
    `
    : `
      <strong class="manager-pending-employee-name">
        ${escapeHtml(employeeName)}
      </strong>
    `;

  return `
    <div class="manager-pending-employee">
      <span class="manager-pending-employee-avatar"
        aria-hidden="true">
        ${escapeHtml(employeeInitials)}
      </span>

      <span class="manager-pending-employee-copy">
        ${employeeNameControl}

        <span class="manager-pending-employee-department">
          <i class="bi bi-building"
            aria-hidden="true"></i>
          ${escapeHtml(request.employeeDepartment || "--")}
        </span>
      </span>
    </div>
  `;
}

// MANAGER-SAFE EMPLOYEE DETAILS - v1.0.0
// The selected employee must already be present in the active manager's
// reporting-line-scoped state.teamMembers collection.
function getManagerVisibleEmployeeById(employeeId = "") {
  const normalizedEmployeeId = String(employeeId || "").trim();

  if (!normalizedEmployeeId) return null;

  const visibleTeamMembers = Array.isArray(state.teamMembers)
    ? state.teamMembers
    : [];

  return (
    visibleTeamMembers.find(
      (member) =>
        String(member?.id || "").trim() === normalizedEmployeeId,
    ) || null
  );
}

function setManagerEmployeeDetailsText(elementId, value) {
  const element = document.getElementById(elementId);

  if (element) {
    element.textContent = String(value || "--");
  }
}

function ensureManagerEmployeeDetailsModal() {
  let modalElement = document.getElementById(
    "managerEmployeeDetailsModal",
  );

  if (modalElement) return modalElement;

  const modalContainer = document.createElement("div");

  modalContainer.innerHTML = `
    <div class="modal fade manager-employee-details-modal"
      id="managerEmployeeDetailsModal"
      tabindex="-1"
      aria-labelledby="managerEmployeeDetailsTitle"
      aria-hidden="true">

      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content manager-employee-details-panel">

          <div class="manager-employee-details-header">
            <div>
              <span class="manager-employee-details-kicker">
                Manager read-only view
              </span>

              <h2 id="managerEmployeeDetailsTitle">
                Employee work details
              </h2>

              <p>
                Role-appropriate employment information for an employee
                currently assigned to your reporting scope.
              </p>
            </div>

            <button type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close">
            </button>
          </div>

          <div class="manager-employee-details-body">
            <section class="manager-employee-details-hero">
              <span id="managerEmployeeDetailsAvatar"
                class="manager-employee-details-avatar"
                aria-hidden="true">
                TM
              </span>

              <div class="manager-employee-details-identity">
                <h3 id="managerEmployeeDetailsName">
                  Employee
                </h3>

                <p id="managerEmployeeDetailsRoleDepartment">
                  Role and department
                </p>
              </div>

              <span id="managerEmployeeDetailsRelationship"
                class="manager-employee-details-relationship">
                Reporting relationship
              </span>
            </section>

            <div class="manager-employee-details-grid">
              <article class="manager-employee-details-field">
                <span>Work email</span>
                <strong id="managerEmployeeDetailsWorkEmail">--</strong>
              </article>

              <article class="manager-employee-details-field">
                <span>Job title</span>
                <strong id="managerEmployeeDetailsJobTitle">--</strong>
              </article>

              <article class="manager-employee-details-field">
                <span>Department</span>
                <strong id="managerEmployeeDetailsDepartment">--</strong>
              </article>

              <article class="manager-employee-details-field">
                <span>Employment date</span>
                <strong id="managerEmployeeDetailsEmploymentDate">--</strong>
              </article>

              <article class="manager-employee-details-field">
                <span>Portal access</span>
                <strong id="managerEmployeeDetailsPortalAccess">--</strong>
              </article>

              <article class="manager-employee-details-field">
                <span>Manager relationship</span>
                <strong id="managerEmployeeDetailsManagerRelationship">--</strong>
              </article>
            </div>

            <div class="manager-employee-details-privacy-note">
              <i class="bi bi-shield-lock"
                aria-hidden="true"></i>

              <span>
                This view intentionally excludes private personal,
                payroll, banking, tax, document and sensitive HR data.
              </span>
            </div>
          </div>

          <div class="manager-employee-details-footer">
            <button type="button"
              class="btn btn-outline-secondary dashboard-action-btn"
              data-bs-dismiss="modal">
              Close
            </button>
          </div>

        </div>
      </div>
    </div>
  `.trim();

  modalElement = modalContainer.firstElementChild;

  if (!modalElement) {
    throw new Error(
      "Manager employee details modal could not be created.",
    );
  }

  document.body.appendChild(modalElement);

  return modalElement;
}

function openManagerEmployeeDetails(employeeId = "") {
  const employee = getManagerVisibleEmployeeById(employeeId);

  if (!employee) {
    showPageAlert(
      "warning",
      "This employee is no longer in your active reporting scope.",
    );

    return;
  }

  const employeeName = String(
    employee.employeeFullName || "Employee",
  ).trim();

  const employeeInitials =
    employeeName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((namePart) => namePart.charAt(0).toUpperCase())
      .join("") || "TM";

  const jobTitle = String(employee.job_title || "--").trim();
  const department = String(employee.department || "--").trim();
  const relationship = String(
    employee.relationshipLabel || "Reporting relationship",
  ).trim();

  const modalElement = ensureManagerEmployeeDetailsModal();

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsAvatar",
    employeeInitials,
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsName",
    employeeName,
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsRoleDepartment",
    `${jobTitle} - ${department}`,
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsWorkEmail",
    employee.work_email || "--",
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsJobTitle",
    jobTitle,
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsDepartment",
    department,
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsEmploymentDate",
    formatDate(employee.employment_date),
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsPortalAccess",
    employee.teamStatusLabel || "--",
  );

  setManagerEmployeeDetailsText(
    "managerEmployeeDetailsManagerRelationship",
    relationship,
  );

  const relationshipElement = document.getElementById(
    "managerEmployeeDetailsRelationship",
  );

  if (relationshipElement) {
    relationshipElement.textContent = relationship;

    relationshipElement.className =
      "manager-employee-details-relationship";

    const normalizedRelationship = normalizeText(relationship);

    if (normalizedRelationship.includes("primary")) {
      relationshipElement.classList.add(
        "manager-employee-details-relationship--primary",
      );
    } else if (normalizedRelationship.includes("secondary")) {
      relationshipElement.classList.add(
        "manager-employee-details-relationship--secondary",
      );
    }
  }

  const modalController =
    window.bootstrap?.Modal?.getOrCreateInstance(modalElement);

  if (!modalController) {
    throw new Error(
      "Bootstrap Modal is unavailable for Manager Employee Details.",
    );
  }

  modalController.show();
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Compact leave-period block keeps the table narrower than separate
// Start Date and End Date columns.
function buildPendingRequestPeriodHtml(request = {}) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
  // Show compact period first, then the year underneath:
  // "Jul 1 - Jul 5" / "2026".
  const startDate = getDashboardDisplayDate(request.start_date);
  const endDate = getDashboardDisplayDate(request.end_date);

  const startLabel = formatShortMonthDayFromDate(startDate);
  const endLabel = formatShortMonthDayFromDate(endDate);

  const startYear = startDate ? String(startDate.getFullYear()) : "";
  const endYear = endDate ? String(endDate.getFullYear()) : "";

  const yearLabel =
    startYear && endYear && startYear !== endYear
      ? `${startYear} - ${endYear}`
      : startYear || endYear || "--";

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(startLabel)} - ${escapeHtml(endLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(yearLabel)}
    </div>
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(request.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Submitted date should be readable at a glance:
// "May 19, 2026" with the time underneath.
function buildPendingRequestSubmittedHtml(value) {
  const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(value);

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(dateLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(timeLabel)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Review signals combine workflow status, team conflict, and same-employee
// duplicate pending-request warning. Balance is still enforced on approval
// by applyApprovedLeaveToBalance().
function buildPendingRequestReviewSignalsHtml(request = {}, requests = []) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1E
  // HR behaviour is exception-first:
  // - pending status is already implied by the Pending Leave Requests queue;
  // - clear rows should show one readiness badge;
  // - warning badges appear only when the manager should pause before deciding.
  const duplicateCount = getSameEmployeePendingRequestCount(request, requests);
  const hasTeamConflict = Boolean(request?.hasOverlap);
  const hasDuplicatePendingRequest = duplicateCount > 0;

  // MANAGER DASHBOARD WIRING - STEP 2G
  // Approval readiness must include leave balance, otherwise managers see a
  // false "Ready for decision" badge for requests that the system will later
  // reject because the remaining balance is too low.
  const balanceWarning = getPendingRequestBalanceWarning(request);
  const hasBalanceWarning = Boolean(balanceWarning);

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
  // Existing ineligible pending rows should be visible to the manager as
  // profile-eligibility exceptions, not as "Ready for decision".
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);
  const hasEligibilityWarning = Boolean(eligibilityWarning);

  if (
    !hasTeamConflict &&
    !hasDuplicatePendingRequest &&
    !hasBalanceWarning &&
    !hasEligibilityWarning
  ) {
    return `
      <span class="badge text-bg-success">
        Ready for decision
      </span>
    `;
  }

  const warningBadges = [];

  if (hasTeamConflict) {
    warningBadges.push(`
      <span class="badge text-bg-warning">
        Team conflict (${escapeHtml(request.overlapCount || 0)})
      </span>
    `);
  }

  if (hasDuplicatePendingRequest) {
    warningBadges.push(`
      <span class="badge text-bg-warning">
        Duplicate request (${escapeHtml(duplicateCount)})
      </span>
    `);
  }

  if (hasBalanceWarning) {
    warningBadges.push(`
      <span class="badge text-bg-danger">
        Insufficient balance
      </span>
    `);
  }

  if (hasEligibilityWarning) {
    warningBadges.push(`
      <span class="badge text-bg-danger">
        Profile eligibility
      </span>
    `);
  }

  const warningDetails = [];

  if (hasTeamConflict) {
    warningDetails.push(getOverlapSummaryText(request));
  }

  if (hasDuplicatePendingRequest) {
    warningDetails.push(
      `Same employee has ${duplicateCount} other pending request${duplicateCount === 1 ? "" : "s"}.`,
    );
  }

  if (hasBalanceWarning) {
    warningDetails.push(balanceWarning);
  }

  if (hasEligibilityWarning) {
    warningDetails.push(eligibilityWarning);
  }

  return `
    <div class="d-flex flex-column gap-2">
      <div class="d-inline-flex flex-wrap gap-2 align-items-center">
        ${warningBadges.join("")}
      </div>

      <div class="small text-secondary">
        ${escapeHtml(warningDetails.join(" "))}
      </div>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Keep the existing window.managerHandleLeaveAction wiring intact.
// This only groups the decision buttons into a cleaner manager action area.
function buildPendingRequestDecisionActionsHtml(request = {}) {
  // SECONDARY MANAGER PENDING LEAVE VISIBILITY - STEP 1
  // Every active reporting manager may see a pending request, but only the
  // Primary Manager may decide it until delegated approval is implemented.
  if (!canManagerDecideLeaveRequest(request)) {
    return `
      <div class="d-inline-flex flex-column align-items-end gap-1">
        <span class="bexhr-status-pill bexhr-status-pill--warning"
          title="Only the Primary Manager or an actively delegated Secondary Manager can make this leave decision.">
          <i class="bi bi-eye-fill" aria-hidden="true"></i>
          <span>Awaiting Primary Manager</span>
        </span>
        <span class="small text-secondary">View only</span>
      </div>
    `;
  }
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
  // Keep action buttons inline and icon-only, but preserve title/aria-label
  // so the controls remain understandable and accessible.
  const safeLeaveId = String(request.id || "").replaceAll("'", "\\'");
  const delegatedAuthorityHtml = request.decisionAuthority === "delegated"
    ? `<div class="small text-success text-end mb-2"><i class="bi bi-person-check me-1"></i>Acting authority until ${escapeHtml(formatDelegationDateTime(request.delegationEndsAt))}</div>`
    : "";
  const approveBlockReason = getPendingRequestApproveBlockReason(request);
  const approveBlockedTitle = approveBlockReason
    ? `Cannot approve: ${approveBlockReason}`
    : "Approve request";

  return `
    <div class="d-flex flex-column align-items-end">
      ${delegatedAuthorityHtml}
      <div class="d-inline-flex justify-content-end gap-2">
      <button
        type="button"
        class="btn btn-sm ${approveBlockReason ? "btn-secondary" : "btn-success"} dashboard-action-btn px-2"
        title="${escapeHtml(approveBlockedTitle)}"
        aria-label="${escapeHtml(approveBlockedTitle)}"
        ${approveBlockReason ? "disabled" : `onclick="window.managerHandleLeaveAction('${safeLeaveId}','approve',this)"`}
      >
        <i class="bi bi-check-circle"></i>
      </button>

      <button
        type="button"
        class="btn btn-sm btn-danger dashboard-action-btn px-2"
        title="Reject request"
        aria-label="Reject request"
        onclick="window.managerHandleLeaveAction('${safeLeaveId}','reject',this)"
      >
        <i class="bi bi-x-circle"></i>
      </button>

      <button
        type="button"
        class="btn btn-sm btn-warning dashboard-action-btn px-2"
        title="Return for clarification"
        aria-label="Return for clarification"
        onclick="window.managerHandleLeaveAction('${safeLeaveId}','return',this)"
      >
        <i class="bi bi-arrow-return-left"></i>
      </button>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Processed leave decisions are audit records. These helpers format the
// existing data only; they do not change workflow, RLS, or decision persistence.
function buildProcessedRequestIdentityHtml(request = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(request.employeeName || "Unknown Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(request.employeeEmail || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(request.employeeDepartment || "--")}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Keep processed leave period consistent with the pending queue format.
function buildProcessedRequestPeriodHtml(request = {}) {
  const startDate = getDashboardDisplayDate(request.start_date);
  const endDate = getDashboardDisplayDate(request.end_date);

  const startLabel = formatShortMonthDayFromDate(startDate);
  const endLabel = formatShortMonthDayFromDate(endDate);

  const startYear = startDate ? String(startDate.getFullYear()) : "";
  const endYear = endDate ? String(endDate.getFullYear()) : "";

  const yearLabel =
    startYear && endYear && startYear !== endYear
      ? `${startYear} - ${endYear}`
      : startYear || endYear || "--";

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(startLabel)} - ${escapeHtml(endLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(yearLabel)}
    </div>
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(request.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Stack decision maker and timestamp so the audit trail is readable.
function buildProcessedDecisionAuditHtml(request = {}) {
  const isCancelled = normalizeText(request.status) === "cancelled" || Boolean(request.cancelled_at);

  // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
  // Manager audit table should show who cancelled the approved leave,
  // not only the original manager decision owner.
  if (isCancelled) {
    const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(
      request.cancelled_at || request.decision_at,
    );

    return `
      <div class="fw-semibold lh-sm">
        ${escapeHtml(request.cancelled_by_name || request.cancelled_by || "HR")}
      </div>
      <div class="text-secondary small mt-1">
        Cancelled by HR
      </div>
      <div class="text-secondary small mt-1">
        ${escapeHtml(dateLabel)}
      </div>
      <div class="text-secondary small mt-1">
        ${escapeHtml(timeLabel)}
      </div>
    `;
  }

  const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(request.decision_at);

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(request.decision_by_name || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(dateLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(timeLabel)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Keep comments readable without making empty comments look like missing rows.
function buildProcessedDecisionCommentHtml(request = {}) {
  const isCancelled = normalizeText(request.status) === "cancelled" || Boolean(request.cancelled_at);

  // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
  // For HR-cancelled leave, the important note is the HR cancellation reason.
  if (isCancelled) {
    const reason = String(request.cancellation_reason || "").trim();
    const restoredDays = Number(request.balance_restored_days || 0);
    const restoredLabel =
      Number.isFinite(restoredDays) && restoredDays > 0
        ? `${restoredDays} day(s) restored`
        : "Balance restoration not recorded";

    return `
      <div class="small text-break">
        ${escapeHtml(reason || "No cancellation reason recorded.")}
      </div>
      <div class="small text-secondary mt-2">
        ${escapeHtml(restoredLabel)}
      </div>
      <div class="small text-secondary mt-1">
        Original manager decision: ${escapeHtml(request.cancelled_from_status || "Approved")}
        ${request.decision_by_name ? ` by ${escapeHtml(request.decision_by_name)}` : ""}
      </div>
    `;
  }

  const comment = String(request.decision_comment || "").trim();

  if (!comment) {
    return `
      <span class="text-secondary small">
        No comment recorded
      </span>
    `;
  }

  return `
    <div class="small text-break">
      ${escapeHtml(comment)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Team schedule is a coverage-planning view. These helpers format existing
// approved leave records only; they do not change approval or RLS logic.
// MANAGER TEAM SCHEDULE EMPLOYEE IDENTITY - v1.0.0
// Reuse the approved pending-request employee identity pattern for the
// Team Leave Schedule. This is presentation-only and performs no new query.
function buildTeamScheduleIdentityHtml(item = {}) {
  const employeeName = String(
    item.employeeName || "Unknown Employee",
  ).trim();

  const employeeRecordId = String(
    item.employeeRecordId || "",
  ).trim();

  const employeeInitials =
    employeeName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((namePart) => namePart.charAt(0).toUpperCase())
      .join("") || "TM";

  const employeeNameControl = employeeRecordId
    ? `
      <button type="button"
        class="manager-pending-employee-name-link"
        data-manager-employee-id="${escapeHtml(employeeRecordId)}"
        onclick="window.managerOpenEmployeeDetails?.(this.dataset.managerEmployeeId)"
        aria-label="View work details for ${escapeHtml(employeeName)}">
        ${escapeHtml(employeeName)}
      </button>
    `
    : `
      <strong class="manager-pending-employee-name">
        ${escapeHtml(employeeName)}
      </strong>
    `;

  return `
    <div class="manager-pending-employee manager-schedule-employee">
      <span class="manager-pending-employee-avatar"
        aria-hidden="true">
        ${escapeHtml(employeeInitials)}
      </span>

      <span class="manager-pending-employee-copy">
        ${employeeNameControl}

        <span class="manager-pending-employee-department">
          <i class="bi bi-building"
            aria-hidden="true"></i>
          ${escapeHtml(item.employeeDepartment || "--")}
        </span>
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Same-year leave remains compact. Cross-year leave is explicit so managers
// do not have to infer which date belongs to which year.
function buildTeamSchedulePeriodHtml(item = {}) {
  const startDate = getDashboardDisplayDate(item.start_date);
  const endDate = getDashboardDisplayDate(item.end_date);

  if (!startDate || !endDate) {
    return `
      <div class="fw-semibold lh-sm">
        ${escapeHtml(formatDate(item.start_date))} - ${escapeHtml(formatDate(item.end_date))}
      </div>
      <div class="mt-2">
        <span class="badge rounded-pill text-bg-light border text-dark">
          ${escapeHtml(item.leaveTypeName || "--")}
        </span>
      </div>
    `;
  }

  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  const periodHtml =
    startYear === endYear
      ? `
        <div class="fw-semibold lh-sm">
          ${escapeHtml(formatShortMonthDayFromDate(startDate))} - ${escapeHtml(formatShortMonthDayFromDate(endDate))}
        </div>
        <div class="text-secondary small mt-1">
          ${escapeHtml(startYear)}
        </div>
      `
      : `
        <div class="fw-semibold lh-sm">
          ${escapeHtml(formatDate(item.start_date))}
        </div>
        <div class="text-secondary small mt-1">
          to ${escapeHtml(formatDate(item.end_date))}
        </div>
      `;

  return `
    ${periodHtml}
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(item.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J-C
// Display-only timing signal for approved team leave.
// This does not change approval logic or the leave schedule query.
function buildTeamScheduleTimingHtml(item = {}) {
  const startDate = getDashboardDisplayDate(item.start_date);
  const endDate = getDashboardDisplayDate(item.end_date);

  if (!startDate || !endDate) {
    return `
      <span class="badge text-bg-light border text-dark">
        Date unclear
      </span>
    `;
  }

  const today = new Date();
  const todayDateOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const startDateOnly = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  const endDateOnly = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilStart = Math.round(
    (startDateOnly.getTime() - todayDateOnly.getTime()) / dayMs,
  );

  if (todayDateOnly >= startDateOnly && todayDateOnly <= endDateOnly) {
    return `
      <div class="d-flex flex-column gap-1">
        <span class="badge text-bg-primary align-self-start">
          In progress
        </span>
        <span class="small text-secondary">
          Ends ${escapeHtml(formatShortMonthDayFromDate(endDate))}
        </span>
      </div>
    `;
  }

  if (daysUntilStart === 0) {
    return `
      <span class="badge text-bg-primary">
        Starts today
      </span>
    `;
  }

  if (daysUntilStart > 0) {
    return `
      <div class="d-flex flex-column gap-1">
        <span class="badge text-bg-light border text-dark align-self-start">
          Upcoming
        </span>
        <span class="small text-secondary">
          Starts in ${escapeHtml(daysUntilStart)} day${daysUntilStart === 1 ? "" : "s"}
        </span>
      </div>
    `;
  }

  return `
    <span class="badge text-bg-secondary">
      Current schedule
    </span>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Replace raw "Conflict Details" with HR-facing coverage status.
function buildTeamScheduleCoverageHtml(item = {}) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J-B
  // This is an overlap signal, not a full workforce coverage calculation.
  // Keep the label HR-accurate: no overlap unless another approved team
  // leave item intersects this period.
  if (!item?.hasOverlap) {
    return `
      <span class="badge text-bg-success">
        No overlap
      </span>
    `;
  }

  return `
    <div class="d-flex flex-column gap-2">
      <div>
        <span class="badge text-bg-warning">
          Overlap risk (${escapeHtml(item.overlapCount || 0)})
        </span>
      </div>
      <div class="small text-secondary">
        ${escapeHtml(getOverlapSummaryText(item))}
      </div>
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Assigned employee rows are display-only. Do not change the RLS-trusted
// employee list returned by loadAssignedTeamMembers().
function buildAssignedEmployeeIdentityHtml(member = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(member.employeeFullName || "Unnamed Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(member.work_email || "--")}
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Combine role and department so the table reads like a people-management view,
// not a raw employee export.
function buildAssignedEmployeeRoleDepartmentHtml(member = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(member.job_title || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(member.department || "--")}
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Keep long technical status values compact while preserving meaning.
function getCompactAssignedEmployeeStatusLabel(statusLabel) {
  const normalizedStatus = normalizeText(statusLabel);

  if (normalizedStatus === "employees missing login") {
    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-C
    // Shorter HR-facing badge label. Full meaning remains available through
    // the helper text and title/aria-label.
    return "No login";
  }

  return statusLabel || "--";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Add a small explanation only for missing-login records so managers understand
// the warning without expanding the table width.
function buildAssignedEmployeeStatusHtml(member = {}) {
  const statusLabel = member.teamStatusLabel || "--";
  const compactLabel = getCompactAssignedEmployeeStatusLabel(statusLabel);

  const helpText =
    normalizeText(statusLabel) === "employees missing login"
      ? "No linked user login"
      : "";

  const normalizedStatus = normalizeText(statusLabel);
  const iconClass = normalizedStatus === "active"
    ? "bi-check-circle-fill"
    : normalizedStatus === "inactive"
      ? "bi-pause-circle-fill"
      : "bi-exclamation-triangle-fill";

  return `
    <div class="d-flex flex-column gap-1">
      <span class="bexhr-status-pill ${member.teamStatusBadgeClass || "bexhr-status-pill--neutral"} align-self-start"
        title="${escapeHtml(statusLabel)}"
        aria-label="${escapeHtml(statusLabel)}">
        <i class="bi ${iconClass}" aria-hidden="true"></i>
        <span>${escapeHtml(compactLabel)}</span>
      </span>
      ${helpText
      ? `<span class="small text-secondary">${escapeHtml(helpText)}</span>`
      : ""
    }
    </div>
  `;
}

function notifyLeaveDecisionChanged() {
  try {
    localStorage.setItem(
      "hrPayrollLeaveDecisionSync",
      JSON.stringify({
        changedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.warn("Unable to broadcast leave decision change:", error);
  }
}

async function refreshManagerWorkspace() {
  setManagerCoverageModeLoading(true);

  renderPendingRequestsLoadingState();
  renderProcessedRequestsLoadingState();
  renderTeamScheduleLoadingState();
  renderTeamLoadingState();

  const teamLoaded = await loadAssignedTeamMembers();

  if (!teamLoaded) {
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];

    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
    return;
  }

  await loadManagerLeaveDelegationContext();
  await loadTeamLeaveVisibility();
}

async function loadAssignedTeamMembers() {
  const managerEmail = normalizeText(
    state.currentProfile?.email || state.currentUser?.email,
  );

  if (!state.currentUser?.id && !managerEmail) {
    showPageAlert(
      "warning",
      "Your manager profile is missing a login identity and email, so assigned team members could not be resolved.",
    );
    renderTeamTable([]);
    renderSummaryTiles([]);
    return false;
  }

  try {
    const supabase = getSupabaseClient();

    // MANAGER DASHBOARD WIRING - STEP 2A
    // Resolve the logged-in manager to employees.id first, then use that ID
    // against employee_reporting_lines.manager_employee_id. This prevents the
    // dashboard from showing all employees or behaving as if only one test
    // employee is wired.
    const managerEmployeeRecord = await loadCurrentManagerEmployeeRecord();

    state.currentManagerEmployeeRecord = managerEmployeeRecord;

    if (!managerEmployeeRecord?.id) {
      showPageAlert(
        "warning",
        "Your login could not be matched to an employee manager record. Please check employees.user_id or employees.work_email for this manager.",
      );
      renderTeamTable([]);
      renderSummaryTiles([]);
      return false;
    }

    const reportingLineRows = await loadActiveManagerReportingLineRows(
      managerEmployeeRecord.id,
    );

    const reportingLineByEmployeeId =
      buildReportingLineByEmployeeId(reportingLineRows);

    const assignedEmployeeIds = [...reportingLineByEmployeeId.keys()];

    if (!assignedEmployeeIds.length) {
      // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
      // If HR removes all reporting-line assignments while the manager has the
      // dashboard open, show a manager-facing toast and clear the visible team.
      notifyManagerTeamAssignmentChanges([]);

      state.teamMembers = [];
      state.filteredTeamMembers = [];

      showPageAlert(
        "warning",
        "No active reporting-line employees were found for this manager.",
      );
      renderTeamTable([]);
      renderSummaryTiles([]);
      return false;
    }

    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .in("id", assignedEmployeeIds)
      .order("created_at", { ascending: false });

    if (employeeError) throw employeeError;

    // MANAGER REPORTING LINE VISIBILITY - STEP 1O-B
    // Build the manager-visible employee list from direct employee rows where
    // RLS allows them, and from the manager-safe reporting-line RPC where a
    // secondary manager's direct employees lookup is restricted.
    //
    // HR behaviour:
    // - Primary manager visibility remains unchanged.
    // - Secondary manager visibility is preserved.
    // - The dashboard must not drop a valid reporting-line employee just
    //   because the second employees table lookup returned fewer rows.
    const employeeRowsById = new Map(
      (Array.isArray(employeeRows) ? employeeRows : []).map((employee) => [
        String(employee.id || "").trim(),
        employee,
      ]),
    );

    const matchedEmployees = Array.from(reportingLineByEmployeeId.values())
      .map((reportingLineRow) => {
        const employeeId = String(reportingLineRow.employee_id || "").trim();
        const directEmployeeRow = employeeRowsById.get(employeeId);

        if (directEmployeeRow) {
          return directEmployeeRow;
        }

        return {
          id: employeeId,
          employee_number: reportingLineRow.employee_number || "",
          first_name: reportingLineRow.first_name || "",
          last_name: reportingLineRow.last_name || "",
          work_email: reportingLineRow.work_email || "",
          department: reportingLineRow.department || "",
          job_title: reportingLineRow.job_title || "",
          employment_date: reportingLineRow.employment_date || "",
          user_id: reportingLineRow.user_id || "",
          status: reportingLineRow.employee_status || "active",

          // MANAGER REPORTING LINE VISIBILITY - STEP 1O-B
          // Marker only for debugging/future support. Rendering uses the same
          // normal employee helper functions below.
          __fromReportingLineRpc: true,
        };
      })
      .filter((employee) => String(employee.id || "").trim());

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
    // Load manager-safe portal access status for all employees currently in
    // this manager's reporting scope. This fixes false "No login" values
    // caused by profiles RLS blocking direct frontend reads.
    const portalAccessRows = await loadManagerTeamPortalAccessStatusRows();
    const portalAccessByEmployeeId = new Map(
      portalAccessRows.map((row) => [String(row.employee_id), row]),
    );

    const workEmails = matchedEmployees
      .map((employee) => normalizeText(getWorkEmail(employee)))
      .filter(Boolean);

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
    // Resolve linked portal profiles by both email and known profile/user ID.
    // This fixes cases where an employee can sign in from another browser
    // but the manager table still shows "No login" because email-only matching
    // did not resolve the profile row.
    const profileIdCandidates = matchedEmployees.flatMap((employee) =>
      getEmployeeProfileIdCandidates(employee),
    );

    let profilesByEmail = new Map();
    let profilesById = new Map();

    if (workEmails.length) {
      const uniqueEmails = [...new Set(workEmails)];

      const { data: profileRowsByEmail, error: profileEmailError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .in("email", uniqueEmails);

      if (profileEmailError) throw profileEmailError;

      (profileRowsByEmail || []).forEach((profile) => {
        if (profile?.email) {
          profilesByEmail.set(normalizeText(profile.email), profile);
        }

        if (profile?.id) {
          profilesById.set(String(profile.id), profile);
        }
      });
    }

    if (profileIdCandidates.length) {
      const uniqueProfileIds = [...new Set(profileIdCandidates)];

      const { data: profileRowsById, error: profileIdError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .in("id", uniqueProfileIds);

      if (profileIdError) throw profileIdError;

      (profileRowsById || []).forEach((profile) => {
        if (profile?.id) {
          profilesById.set(String(profile.id), profile);
        }

        if (profile?.email) {
          profilesByEmail.set(normalizeText(profile.email), profile);
        }
      });
    }

    const enrichedTeamMembers = matchedEmployees.map((employee) => {
      const workEmail = getWorkEmail(employee);
      const reportingLineRow =
        reportingLineByEmployeeId.get(String(employee.id)) || null;

      // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
      // Portal access is now resolved by employee_id from the safe RPC.
      const portalAccessRow =
        portalAccessByEmployeeId.get(String(employee.id)) || null;
      const profileIdMatch = getEmployeeProfileIdCandidates(employee).find(
        (profileId) => profilesById.has(profileId),
      );

      // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
      // Prefer email match where it exists, then fall back to linked profile/user ID.
      const matchedProfile =
        profilesByEmail.get(normalizeText(workEmail)) ||
        (profileIdMatch ? profilesById.get(profileIdMatch) : null) ||
        null;

      return {
        id: employee.id,
        raw: employee,
        employeeFullName: getEmployeeFullName(employee),
        work_email: workEmail || "--",
        department: getDepartment(employee),
        job_title: getJobTitle(employee),
        employment_date: getEmploymentDate(employee),
        matchedProfile,
        // MANAGER DASHBOARD WIRING - STEP 2A
        // Relationship now comes from employee_reporting_lines, not legacy
        // text columns or a hardcoded fallback.
        relationshipLabel: getReportingLineRelationshipLabel(reportingLineRow),
        // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
        // Use the RPC status first. Fall back to the old profile match only
        // if the RPC does not return this employee.
        teamStatusLabel: getTeamStatusLabelFromPortalAccess(
          portalAccessRow,
          matchedProfile,
        ),
        teamStatusBadgeClass: getTeamStatusBadgeClassFromPortalAccess(
          portalAccessRow,
          matchedProfile,
        ),
      };
    });

    // MANAGER REPORTING-LINE CHANGE VISIBILITY - STEP 1N
    // Compare before overwriting state.teamMembers so added/removed employees
    // can be reported to the manager via toast.
    notifyManagerTeamAssignmentChanges(enrichedTeamMembers);

    state.teamMembers = enrichedTeamMembers;
    applyTeamFilter();

    if (!enrichedTeamMembers.length) {
      showPageAlert(
        "warning",
        "No assigned employee records were returned for the active reporting lines. Please check employees RLS for manager team visibility.",
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error loading assigned team members:", error);
    showPageAlert(
      "danger",
      error.message || "Assigned team members could not be loaded.",
    );
    renderTeamTable([]);
    renderSummaryTiles([]);
    return false;
  }
}

function applyTeamFilter() {
  const searchTerm = normalizeText(state.dom.teamSearchInput?.value || "");

  if (!searchTerm) {
    state.filteredTeamMembers = [...state.teamMembers];
  } else {
    state.filteredTeamMembers = state.teamMembers.filter((member) => {
      const searchableText = [
        member.employeeFullName,
        member.work_email,
        member.department,
        member.job_title,
        member.relationshipLabel,
        member.teamStatusLabel,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });
  }

  renderSummaryTiles(state.teamMembers);
  renderTeamTable(state.filteredTeamMembers);
}

// MANAGER COVERAGE BADGE STARTUP FLASH FIX
// Show a neutral loading state until reporting-line assignments are resolved.
function setManagerCoverageModeLoading(isLoading) {
  const modeBadge = document.getElementById(
    "managerCoverageModeBadge",
  );

  if (!modeBadge) return;

  if (isLoading) {
    modeBadge.className =
      "manager-coverage-mode-badge manager-coverage-mode-badge--loading";

    modeBadge.innerHTML = `
      <span
        class="spinner-border spinner-border-sm me-2"
        aria-hidden="true"
      ></span>
      Checking coverage
    `;

    modeBadge.setAttribute("aria-busy", "true");
    return;
  }

  modeBadge.setAttribute("aria-busy", "false");
}

// MANAGER ACTION AND COVERAGE CENTRE - v1.0.0
// Presentation-only aggregation of data already loaded for this manager.
// No new Supabase query, permission, session, or decision path is introduced.
function setManagerActionCentreText(elementId, value) {
  const element = document.getElementById(elementId);

  if (element) {
    element.textContent = String(value ?? "");
  }
}

function formatManagerActionCentreDate(value) {
  const normalisedValue = String(value || "").trim();

  if (!normalisedValue) return "";

  const date = new Date(`${normalisedValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return normalisedValue;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function renderManagerActionCoverageCentre() {
  const teamMembers = Array.isArray(state.teamMembers)
    ? state.teamMembers
    : [];

  const pendingRequests = Array.isArray(state.pendingLeaveRequests)
    ? state.pendingLeaveRequests
    : [];

  const scheduleItems = Array.isArray(state.teamLeaveSchedule)
    ? state.teamLeaveSchedule
    : [];

  const primaryRelationshipCount = teamMembers.filter((member) =>
    isPrimaryReportingManagerRelationship(member.relationshipLabel),
  ).length;

  const secondaryRelationshipCount = teamMembers.filter((member) =>
    normalizeText(member.relationshipLabel).includes("secondary"),
  ).length;

  const primaryPendingCount = pendingRequests.filter((request) =>
    isPrimaryReportingManagerRelationship(
      request.managerRelationshipLabel,
    ),
  ).length;

  const secondaryPendingCount = pendingRequests.filter(
    (request) =>
      !isPrimaryReportingManagerRelationship(
        request.managerRelationshipLabel,
      ),
  ).length;

  const conflictCount = [
    ...pendingRequests,
    ...scheduleItems,
  ].filter((item) => Boolean(item.hasOverlap)).length;

  const accessAttentionCount = teamMembers.filter(
    (member) =>
      member.teamStatusLabel === "Employees Missing Login",
  ).length;

  let coverageMode = "Manager";
  let coverageModeKey = "default";
  let coverageDescription =
    "Review team activity and reporting-line responsibilities.";
  let decisionAuthority = "Reporting-line rules apply";

  if (
    primaryRelationshipCount > 0 &&
    secondaryRelationshipCount > 0
  ) {
    coverageMode = "Mixed Manager Coverage";
    coverageModeKey = "mixed";
    coverageDescription =
      "Your scope contains Primary and Secondary reporting lines. Decision rights apply only to employees assigned to you as Primary Manager.";
    decisionAuthority = "Primary assignments only";
  } else if (secondaryRelationshipCount > 0) {
    coverageMode = "Secondary Manager";
    coverageModeKey = "secondary";
    coverageDescription =
      "You can monitor leave activity and team coverage. Pending decisions remain with each employee's Primary Manager.";
    decisionAuthority = "Primary Manager action required";
  } else if (primaryRelationshipCount > 0) {
    coverageMode = "Primary Manager";
    coverageModeKey = "primary";
    coverageDescription =
      "You can review team coverage and decide pending requests for employees assigned to you as Primary Manager.";
    decisionAuthority = "You can review and decide";
  }

  const modeBadge = document.getElementById(
    "managerCoverageModeBadge",
  );

  if (modeBadge) {
    modeBadge.textContent = coverageMode;
    modeBadge.className =
      `manager-coverage-mode-badge ` +
      `manager-coverage-mode-badge--${coverageModeKey}`;

    setManagerCoverageModeLoading(false);
  }

  let headerCoverageLabel = "Manager";

  if (coverageModeKey === "mixed") {
    headerCoverageLabel = "Mixed Manager Coverage";
  } else if (coverageModeKey === "primary") {
    headerCoverageLabel = "Primary Manager";
  } else if (coverageModeKey === "secondary") {
    headerCoverageLabel = "Secondary Manager";
  } else if (coverageModeKey === "acting") {
    headerCoverageLabel = "Acting Manager";
  }

renderManagerHeaderResponsibilityBadge(
  headerCoverageLabel,
  coverageModeKey || "manager",
);

// MANAGER PROFILE AUTHORITY PARITY - v1.0.0
// Show the reporting-line authority already calculated for this Manager.
// Display-only: this does not grant roles, decision rights, or delegation.
if (state.dom.managerProfileAuthorityText) {
  state.dom.managerProfileAuthorityText.textContent =
    `${coverageMode} workspace member`;
}

if (state.dom.managerProfileAuthorityPill) {
  state.dom.managerProfileAuthorityPill.dataset.managerAuthority =
    coverageModeKey;
}

// Keep the read-only Profile Role field aligned with the Manager's resolved
// responsibility rather than showing only the generic stored "manager" role.
if (state.dom.managerProfileRole) {
  state.dom.managerProfileRole.value = coverageMode;
  state.dom.managerProfileRole.removeAttribute("placeholder");
}

setManagerActionCentreText(
  "managerCoverageModeDescription",
  coverageDescription,
);

  setManagerActionCentreText(
    "managerDecisionAuthority",
    decisionAuthority,
  );

  setManagerActionCentreText(
    "managerPrimaryActionCount",
    primaryPendingCount,
  );

  setManagerActionCentreText(
    "managerSecondaryVisibilityCount",
    secondaryPendingCount,
  );

  setManagerActionCentreText(
    "managerActionConflictCount",
    conflictCount,
  );

  setManagerActionCentreText(
    "managerActionAccessCount",
    accessAttentionCount,
  );

  renderAuthorityAwareManagerGuide();

  const nextAbsence = [...scheduleItems]
    .filter((item) => String(item.start_date || "").trim())
    .sort((left, right) =>
      String(left.start_date || "").localeCompare(
        String(right.start_date || ""),
      ),
    )[0];

  if (!nextAbsence) {
    setManagerActionCentreText(
      "managerNextAbsenceName",
      "No upcoming approved leave",
    );

    setManagerActionCentreText(
      "managerNextAbsencePeriod",
      "Your team schedule is currently clear.",
    );

    return;
  }

  const startDate = formatManagerActionCentreDate(
    nextAbsence.start_date,
  );

  const endDate = formatManagerActionCentreDate(
    nextAbsence.end_date,
  );

  const period =
    startDate && endDate && startDate !== endDate
      ? `${startDate} to ${endDate}`
      : startDate || endDate || "Date unavailable";

  setManagerActionCentreText(
    "managerNextAbsenceName",
    nextAbsence.employeeName || "Team member",
  );

  setManagerActionCentreText(
    "managerNextAbsencePeriod",
    `${period} | ${nextAbsence.leaveTypeName || "Approved leave"}`,
  );
}

// =========================================================
// MANAGER ACTION CENTRE TARGET LINKS - v1.0.1
// Routes each Overview operational card to the exact existing Manager panel.
// Uses data already held in state and existing expand/collapse controls.
// No Supabase query, authority, decision, reporting-line, or session change.
// =========================================================
let managerActionCentreFocusTimeoutId = null;

function clearManagerActionCentreDestinationFocus() {
  document
    .querySelectorAll(
      ".manager-action-destination-focus, .manager-action-row-focus",
    )
    .forEach((element) => {
      element.classList.remove(
        "manager-action-destination-focus",
        "manager-action-row-focus",
      );
    });

  if (managerActionCentreFocusTimeoutId) {
    window.clearTimeout(managerActionCentreFocusTimeoutId);
    managerActionCentreFocusTimeoutId = null;
  }
}

function expandManagerActionCentreDestination({ collapseId, toggleId }) {
  const collapseElement = document.getElementById(collapseId);
  const toggleButton = document.getElementById(toggleId);

  if (!collapseElement || !toggleButton) return false;

  if (collapseElement.classList.contains("d-none")) {
    toggleButton.click();
  }

  return true;
}

function getManagerActionCentrePendingMatches(targetKey) {
  const pendingRequests = Array.isArray(state.pendingLeaveRequests)
    ? state.pendingLeaveRequests
    : [];

  return pendingRequests.map((request) => {
    if (targetKey === "primary") {
      return isPrimaryReportingManagerRelationship(
        request.managerRelationshipLabel,
      );
    }

    if (targetKey === "secondary") {
      return !isPrimaryReportingManagerRelationship(
        request.managerRelationshipLabel,
      );
    }

    if (targetKey === "conflicts") {
      return Boolean(request.hasOverlap);
    }

    return false;
  });
}

function focusManagerActionCentreRows({
  cardHeaderId,
  wrapperId,
  tableBodyId,
  rowMatches,
}) {
  const cardHeader = document.getElementById(cardHeaderId);
  const wrapper = document.getElementById(wrapperId);
  const tableBody = document.getElementById(tableBodyId);
  const card = cardHeader?.closest("section.card") || cardHeader;

  if (card) {
    card.classList.add("manager-action-destination-focus");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const rows = Array.from(tableBody?.querySelectorAll("tr") || []);
  const matchingRows = rows.filter((row, index) => Boolean(rowMatches[index]));

  matchingRows.forEach((row) => {
    row.classList.add("manager-action-row-focus");
  });

  const firstMatch = matchingRows[0];

  if (firstMatch && wrapper) {
    const headerHeight =
      wrapper.querySelector("thead")?.getBoundingClientRect().height || 44;

    wrapper.scrollTop = Math.max(
      0,
      firstMatch.offsetTop - headerHeight - 8,
    );
  }

  managerActionCentreFocusTimeoutId = window.setTimeout(() => {
    clearManagerActionCentreDestinationFocus();
  }, 4200);
}

function navigateManagerActionCentre(targetKey = "") {
  const normalizedTarget = String(targetKey || "")
    .trim()
    .toLowerCase();

  const supportedTargets = [
    "primary",
    "secondary",
    "conflicts",
    "access",
  ];

  if (!supportedTargets.includes(normalizedTarget)) return;

  clearManagerActionCentreDestinationFocus();

  document.getElementById("managerTabTeamBtn")?.click();

  window.setTimeout(() => {
    if (normalizedTarget === "access") {
      const searchInput = document.getElementById("teamSearchInput");

      if (searchInput && searchInput.value) {
        searchInput.value = "";
        applyTeamFilter();
      }

      expandManagerActionCentreDestination({
        collapseId: "assignedEmployeeRecordsCardCollapse",
        toggleId: "toggleAssignedEmployeeRecordsCardBtn",
      });

      window.setTimeout(() => {
        const visibleTeamMembers = Array.isArray(state.filteredTeamMembers)
          ? state.filteredTeamMembers
          : [];

        focusManagerActionCentreRows({
          cardHeaderId: "assignedEmployeeRecordsCardHeader",
          wrapperId: "teamTableWrapper",
          tableBodyId: "teamTableBody",
          rowMatches: visibleTeamMembers.map(
            (member) =>
              member.teamStatusLabel === "Employees Missing Login",
          ),
        });
      }, 120);

      return;
    }

    expandManagerActionCentreDestination({
      collapseId: "pendingRequestsCardCollapse",
      toggleId: "togglePendingRequestsCardBtn",
    });

    window.setTimeout(() => {
      focusManagerActionCentreRows({
        cardHeaderId: "pendingRequestsCardHeader",
        wrapperId: "pendingRequestsTableWrapper",
        tableBodyId: "pendingRequestsTableBody",
        rowMatches:
          getManagerActionCentrePendingMatches(normalizedTarget),
      });
    }, 120);
  }, 80);
}

window.managerNavigateActionCentre = navigateManagerActionCentre;
function renderSummaryTiles(teamMembers) {
  const activeCount = teamMembers.filter(
    (member) => member.teamStatusLabel === "Active",
  ).length;

  const pendingCount = teamMembers.filter(
    (member) => member.teamStatusLabel === "Employees Missing Login",
  ).length;

  const uniqueDepartments = new Set(
    teamMembers
      .map((member) => String(member.department || "").trim())
      .filter(Boolean),
  );

  if (state.dom.teamCountValue) {
    state.dom.teamCountValue.textContent = String(teamMembers.length);
  }

  if (state.dom.activeCountValue) {
    state.dom.activeCountValue.textContent = String(activeCount);
  }

  if (state.dom.pendingCountValue) {
    state.dom.pendingCountValue.textContent = String(pendingCount);
  }

  if (state.dom.departmentCountValue) {
    state.dom.departmentCountValue.textContent = String(uniqueDepartments.size);
  }
  renderManagerActionCoverageCentre();
  renderManagerTeamWorkspaceSummary();
}

// MANAGER ASSIGNED EMPLOYEE RECORDS COMPACT CARDS - v1.0.0
// Presentation-only rendering of the manager-scoped team already loaded into
// state.teamMembers. Search, refresh, RLS, reporting lines and session logic
// remain unchanged.
function renderTeamLoadingState() {
  if (!state.dom.teamTableBody) return;

  state.dom.teamEmptyState.classList.add("d-none");
  state.dom.teamTableWrapper.classList.remove("d-none");
  state.dom.teamTableBody.innerHTML = `
    <tr class="manager-assigned-employee-card-row">
      <td colspan="4" class="manager-assigned-employee-card-cell">
        <div class="manager-assigned-employee-loading" role="status">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
          <span>Loading assigned employee records...</span>
        </div>
      </td>
    </tr>
  `;
}

function renderTeamTable(teamMembers) {
  const tbody = state.dom.teamTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!teamMembers.length) {
    state.dom.teamEmptyState.classList.remove("d-none");
    state.dom.teamTableWrapper.classList.add("d-none");
    return;
  }

  state.dom.teamEmptyState.classList.add("d-none");
  state.dom.teamTableWrapper.classList.remove("d-none");

  teamMembers.forEach((member) => {
    const row = document.createElement("tr");
    row.className = "manager-assigned-employee-card-row";

    const employeeName = String(
      member.employeeFullName || "Unnamed Employee",
    ).trim();

    const employeeRecordId = String(member.id || "").trim();

    const employeeInitials =
      employeeName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((namePart) => namePart.charAt(0).toUpperCase())
        .join("") || "TM";

    const employeeNameControl = employeeRecordId
      ? `
        <button type="button"
          class="manager-assigned-employee-name-link"
          data-manager-employee-id="${escapeHtml(employeeRecordId)}"
          onclick="window.managerOpenEmployeeDetails?.(this.dataset.managerEmployeeId)"
          title="View employee work details"
          aria-label="View work details for ${escapeHtml(employeeName)}">
          ${escapeHtml(employeeName)}
        </button>
      `
      : `
        <strong class="manager-assigned-employee-name">
          ${escapeHtml(employeeName)}
        </strong>
      `;

    const workEmail = String(member.work_email || "--").trim();
    const jobTitle = String(member.job_title || "--").trim();
    const department = String(member.department || "--").trim();
    const statusKey = normalizeText(member.teamStatusLabel || "");

    row.dataset.managerEmployeeId = employeeRecordId;
    row.dataset.managerTeamStatus = statusKey;

    row.innerHTML = `
      <td colspan="4" class="manager-assigned-employee-card-cell">
        <article class="manager-assigned-employee-card"
          aria-label="${escapeHtml(employeeName)} employee record">

          <header class="manager-assigned-employee-card-header">
            <div class="manager-assigned-employee-identity">
              <span class="manager-assigned-employee-avatar"
                aria-hidden="true">
                ${escapeHtml(employeeInitials)}
              </span>

              <div class="manager-assigned-employee-copy">
                ${employeeNameControl}
                <span class="manager-assigned-employee-role">
                  ${escapeHtml(jobTitle)}
                </span>
              </div>
            </div>

            <div class="manager-assigned-employee-access">
              <span class="manager-assigned-employee-access-label">
                Portal access
              </span>
              ${buildAssignedEmployeeStatusHtml(member)}
            </div>
          </header>

          <div class="manager-assigned-employee-meta-band">
            <div class="manager-assigned-employee-meta-item">
              <span>Work email</span>
              <strong>${escapeHtml(workEmail)}</strong>
            </div>

            <div class="manager-assigned-employee-meta-item">
              <span>Department</span>
              <strong>${escapeHtml(department)}</strong>
            </div>

            <div class="manager-assigned-employee-meta-item">
              <span>Start date</span>
              <strong>${escapeHtml(formatDate(member.employment_date))}</strong>
            </div>
          </div>
        </article>
      </td>
    `;

    tbody.appendChild(row);
  });
}
// TEMPORARY DELEGATED LEAVE AUTHORITY - v1.0.0
// Decision controls remain request-scoped. A Secondary Manager receives action
// controls only when the protected readiness RPC confirms an active delegation.
function canManagerDecideLeaveRequest(request = {}) {
  return (
    isPrimaryReportingManagerRelationship(request.managerRelationshipLabel) ||
    request.canDecideLeaveRequest === true
  );
}

function getManagerDelegationContext() {
  const context = state.managerLeaveDelegationContext || {};
  return {
    eligible_delegates: Array.isArray(context.eligible_delegates)
      ? context.eligible_delegates
      : [],
    active_granted: Array.isArray(context.active_granted)
      ? context.active_granted
      : [],
    active_received: Array.isArray(context.active_received)
      ? context.active_received
      : [],
  };
}

async function loadManagerLeaveDelegationContext() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc(
      "get_manager_leave_delegation_context",
    );
    if (error) throw error;

    state.managerLeaveDelegationContext = {
      eligible_delegates: Array.isArray(data?.eligible_delegates)
        ? data.eligible_delegates
        : [],
      active_granted: Array.isArray(data?.active_granted)
        ? data.active_granted
        : [],
      active_received: Array.isArray(data?.active_received)
        ? data.active_received
        : [],
    };
  } catch (error) {
    console.warn("Unable to load manager leave delegations:", error);
    state.managerLeaveDelegationContext = {
      eligible_delegates: [],
      active_granted: [],
      active_received: [],
    };
  }

  renderManagerLeaveDelegationUi();
  renderAuthorityAwareManagerGuide();
}

function ensureManagerLeaveDelegationStyles() {
  if (document.getElementById("managerLeaveDelegationStyles")) return;

  const style = document.createElement("style");
  style.id = "managerLeaveDelegationStyles";
  style.textContent = `
    #managerLeaveDelegationModal .modal-dialog {
      width: min(900px, calc(100vw - 1.5rem));
      max-width: 900px;
      margin: 0.75rem auto;
    }

    #managerLeaveDelegationModal .modal-content {
      max-height: calc(100dvh - 1.5rem);
    }

    #managerLeaveDelegationModal .modal-body {
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    #managerLeaveDelegationModal .modal-content {
      background: linear-gradient(180deg, #ffffff 0%, #fbfdfc 100%);
    }

    .manager-delegation-hero {
      background:
        radial-gradient(circle at top right, rgba(15, 157, 123, 0.13), transparent 42%),
        linear-gradient(135deg, #f4fffb 0%, #ffffff 72%);
      border-bottom: 1px solid rgba(15, 157, 123, 0.14);
    }

    .manager-delegation-kicker {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.35rem 0.65rem;
      border-radius: 999px;
      background: rgba(15, 157, 123, 0.1);
      color: #087f63;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .manager-delegation-panel,
    .manager-delegation-summary,
    .manager-delegation-record {
      border: 1px solid #dce9e5;
      border-radius: 1rem;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(15, 45, 38, 0.05);
    }

    .manager-delegation-selector {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
    }

    .manager-delegation-person {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 74px;
      padding: 0.9rem;
      border: 1px solid #dce6e3;
      border-radius: 0.9rem;
      background: #ffffff;
      cursor: pointer;
      transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }

    .manager-delegation-person:hover {
      border-color: #70cdb6;
      transform: translateY(-1px);
      box-shadow: 0 8px 20px rgba(15, 157, 123, 0.08);
    }

    .manager-delegation-person:has(input:checked) {
      border-color: #0f9d7b;
      background: #f1fcf8;
      box-shadow: 0 0 0 3px rgba(15, 157, 123, 0.1);
    }

    .manager-delegation-person input {
      width: 1.1rem;
      height: 1.1rem;
      accent-color: #0f9d7b;
      flex: 0 0 auto;
    }

    .manager-delegation-avatar {
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 0.75rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #dff8f0;
      color: #087f63;
      font-weight: 800;
      flex: 0 0 auto;
    }

    .manager-delegation-summary {
      background: #f7fbfa;
      border-style: dashed;
    }

    .manager-delegation-summary strong {
      color: #123b32;
    }

    .manager-delegation-record {
      padding: 1rem;
    }

    .manager-delegation-record-status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      background: #eaf9f3;
      color: #087f63;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .manager-delegation-empty {
      padding: 1rem;
      border: 1px dashed #cfded9;
      border-radius: 0.9rem;
      background: #fbfdfc;
      color: #63756f;
    }

    .manager-delegation-footer {
      position: sticky;
      bottom: -1px;
      z-index: 2;
      margin-inline: -0.25rem;
      padding: 1rem 0.25rem 0.25rem;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0), #ffffff 30%);
      border-top: 1px solid #e4eeeb;
    }

    .manager-delegation-footer .btn {
      min-height: 46px;
    }

    .manager-delegation-record-status--scheduled {
      background: #fff7df;
      color: #946200;
    }

    .manager-delegation-record-status--expired {
      background: #f1f5f9;
      color: #526176;
    }

    .manager-delegation-record-status--revoked {
      background: #fff0f1;
      color: #b42334;
    }

    @media (max-width: 767.98px) {
      #managerLeaveDelegationModal .modal-dialog {
        width: calc(100vw - 1rem);
        margin: 0.5rem auto;
      }

      #managerLeaveDelegationModal .modal-content {
        max-height: calc(100dvh - 1rem);
        border-radius: 1rem !important;
      }

      #managerLeaveDelegationModal .modal-header,
      #managerLeaveDelegationModal .modal-body {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }

      .manager-delegation-footer .btn {
        width: 100%;
      }

      .manager-delegation-selector {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureManagerLeaveDelegationModalMarkup() {
  if (document.getElementById("managerLeaveDelegationModal")) return;

  ensureManagerLeaveDelegationStyles();

  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="modal fade" id="managerLeaveDelegationModal" tabindex="-1"
        aria-labelledby="managerLeaveDelegationModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
            <div class="modal-header manager-delegation-hero border-0 px-4 px-lg-5 pt-4 pb-4 align-items-start">
              <div class="pe-3">
                <div class="manager-delegation-kicker mb-3">
                  <i class="bi bi-person-check"></i>
                  Temporary approval access
                </div>
                <h2 class="modal-title h3 fw-bold mb-2" id="managerLeaveDelegationModalLabel">Temporary Approval Access</h2>
                <p class="text-secondary mb-0">Give trusted Secondary Managers temporary permission to review and decide leave requests while you are unavailable.</p>
              </div>
              <button type="button" class="btn-close mt-1" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body px-4 px-lg-5 py-4">
              <div id="managerLeaveDelegationNotice" class="alert d-none" role="alert"></div>
              <form id="managerLeaveDelegationForm" class="manager-delegation-panel p-3 p-lg-4 mb-4">
                <div class="d-flex align-items-start gap-3 mb-4">
                  <div class="manager-delegation-avatar"><i class="bi bi-people"></i></div>
                  <div>
                    <h3 class="h5 fw-bold mb-1">Choose who can act for you</h3>
                    <p class="text-secondary mb-0">Select one or more Secondary Managers. Each person receives a separate access record that you can revoke independently.</p>
                  </div>
                </div>

                <div id="managerLeaveDelegates" class="manager-delegation-selector mb-4" role="group" aria-label="Secondary Managers"></div>

                <div class="row g-3">
                  <div class="col-md-6">
                    <label for="managerLeaveDelegationScope" class="form-label fw-semibold">Who can they approve leave for?</label>
                    <select id="managerLeaveDelegationScope" class="form-select">
                      <option value="team">All employees I manage</option>
                      <option value="employee">Selected employee only</option>
                    </select>
                    <div class="form-text">Choose whether access applies to your full team or one selected employee.</div>
                  </div>
                  <div class="col-md-6 d-none" id="managerLeaveDelegationEmployeeWrap">
                    <label for="managerLeaveDelegationEmployee" class="form-label fw-semibold">Selected employee</label>
                    <select id="managerLeaveDelegationEmployee" class="form-select"></select>
                  </div>
                  <div class="col-md-6">
                    <label for="managerLeaveDelegationStartsAt" class="form-label fw-semibold">Access starts</label>
                    <input id="managerLeaveDelegationStartsAt" type="datetime-local" class="form-control" required />
                  </div>
                  <div class="col-md-6">
                    <label for="managerLeaveDelegationEndsAt" class="form-label fw-semibold">Access ends</label>
                    <input id="managerLeaveDelegationEndsAt" type="datetime-local" class="form-control" required />
                    <div class="form-text">Access ends automatically at this time.</div>
                  </div>
                  <div class="col-12">
                    <label for="managerLeaveDelegationReason" class="form-label fw-semibold">Why is this access needed?</label>
                    <textarea id="managerLeaveDelegationReason" class="form-control" rows="3" maxlength="500" required placeholder="For example: Annual leave cover from Monday to Friday"></textarea>
                  </div>
                </div>

                <div class="manager-delegation-summary p-3 mt-4" id="managerLeaveDelegationSummary" aria-live="polite">
                  <strong>Access summary</strong>
                  <div class="small text-secondary mt-1">Select a Secondary Manager and complete the dates to preview this temporary access.</div>
                </div>

                <div class="manager-delegation-footer d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3 mt-4 pt-3">
                  <div class="small text-secondary"><i class="bi bi-shield-check me-1"></i>You remain the Primary Manager and can revoke access at any time.</div>
                  <button id="managerLeaveDelegationSubmit" type="submit" class="btn btn-success px-4">
                    <i class="bi bi-person-check me-2"></i>Grant temporary approval access
                  </button>
                </div>
              </form>
              <section>
                <div class="d-flex align-items-center justify-content-between gap-3 mb-2">
                  <h3 class="h5 fw-bold mb-0">Active access you granted</h3>
                  <span class="small text-secondary">Each person can be revoked separately</span>
                </div>
                <div id="managerLeaveDelegationGrantedList" class="d-grid gap-3 mb-4"></div>
                <h3 class="h5 fw-bold mb-2">Temporary access granted to you</h3>
                <div id="managerLeaveDelegationReceivedList" class="d-grid gap-3"></div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `,
  );
}

function formatDelegationDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getManagerDelegationStatus(item = {}) {
  const rawStatus = String(item.status || "").trim().toLowerCase();
  const now = Date.now();
  const startsAt = new Date(item.starts_at || 0).getTime();
  const endsAt = new Date(item.ends_at || 0).getTime();

  if (item.revoked_at || rawStatus === "revoked") {
    return { label: "Revoked", tone: "revoked", icon: "bi-x-circle" };
  }
  if (
    rawStatus === "expired" ||
    (Number.isFinite(endsAt) && endsAt > 0 && endsAt <= now)
  ) {
    return { label: "Expired", tone: "expired", icon: "bi-clock-history" };
  }
  if (
    rawStatus === "scheduled" ||
    (Number.isFinite(startsAt) && startsAt > now)
  ) {
    return { label: "Scheduled", tone: "scheduled", icon: "bi-calendar-event" };
  }
  return { label: "Active", tone: "active", icon: "bi-shield-check" };
}

function buildManagerDelegationStatusHtml(item = {}) {
  const status = getManagerDelegationStatus(item);
  return `
    <span class="manager-delegation-record-status manager-delegation-record-status--${status.tone}">
      <i class="bi ${status.icon}"></i>${status.label}
    </span>
  `;
}

function toDelegationDateTimeLocalValue(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const offsetMs = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function getSelectedManagerLeaveDelegateIds() {
  return [...document.querySelectorAll('input[name="managerLeaveDelegate"]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
}

function getManagerLeaveDelegateInitials(item = {}) {
  const name = String(item.delegate_name || item.delegate_email || "SM").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

function updateManagerLeaveDelegationSummary() {
  const summary = document.getElementById("managerLeaveDelegationSummary");
  if (!summary) return;

  const selectedIds = getSelectedManagerLeaveDelegateIds();
  const context = getManagerDelegationContext();
  const selectedNames = context.eligible_delegates
    .filter((item) => selectedIds.includes(String(item.delegate_employee_id)))
    .map((item) => item.delegate_name || item.delegate_email || "Secondary Manager");
  const scopeType = document.getElementById("managerLeaveDelegationScope")?.value || "team";
  const employeeSelect = document.getElementById("managerLeaveDelegationEmployee");
  const coverageText = scopeType === "employee"
    ? employeeSelect?.selectedOptions?.[0]?.textContent || "the selected employee"
    : "all employees you manage";
  const startsAt = document.getElementById("managerLeaveDelegationStartsAt")?.value;
  const endsAt = document.getElementById("managerLeaveDelegationEndsAt")?.value;

  if (!selectedNames.length || !startsAt || !endsAt) {
    summary.innerHTML = `
      <strong>Access summary</strong>
      <div class="small text-secondary mt-1">Select a Secondary Manager and complete the dates to preview this temporary access.</div>
    `;
    return;
  }

  summary.innerHTML = `
    <strong>${escapeHtml(selectedNames.join(", "))}</strong>
    <div class="small text-secondary mt-1">
      Can review and decide leave requests for <strong>${escapeHtml(coverageText)}</strong>
      from ${escapeHtml(formatDelegationDateTime(startsAt))}
      until ${escapeHtml(formatDelegationDateTime(endsAt))}.
    </div>
  `;
}

function renderManagerLeaveDelegationUi() {
  ensureManagerLeaveDelegationModalMarkup();
  const context = getManagerDelegationContext();
  const intro = document.querySelector(".manager-team-workspace-intro");
  if (!intro) return;

  const actionHost = document.getElementById("managerLeaveDelegationActionHost");
  const actionControls = document.getElementById("managerLeaveDelegationActionControls");
  if (!actionHost || !actionControls) return;

  let button = document.getElementById("managerLeaveDelegationOpenBtn");
  if (!button) {
    button = document.createElement("button");
    button.id = "managerLeaveDelegationOpenBtn";
    button.type = "button";
    button.className = "btn btn-success dashboard-action-btn manager-delegation-action-button";
    button.innerHTML = '<i class="bi bi-person-check me-2"></i>Temporary Approval Access';
    button.addEventListener("click", () => {
      populateManagerLeaveDelegationModal();
      state.managerLeaveDelegationModal?.show();
    });
    actionControls.appendChild(button);
  }

  // Only a manager with Primary assignments may grant temporary approval access.
  // Delegated Secondary Managers receive request-level action controls but never
  // the authority-management control itself.
  const hasPrimaryAssignments = (
    Array.isArray(state.teamMembers) ? state.teamMembers : []
  ).some((member) =>
    isPrimaryReportingManagerRelationship(member.relationshipLabel),
  );
  const canManageDelegation = hasPrimaryAssignments;
  actionHost.classList.toggle("d-none", !canManageDelegation);
  button.classList.toggle("d-none", !canManageDelegation);
}

function populateManagerLeaveDelegationModal() {
  const context = getManagerDelegationContext();
  const delegateContainer = document.getElementById("managerLeaveDelegates");
  const employeeSelect = document.getElementById("managerLeaveDelegationEmployee");
  const form = document.getElementById("managerLeaveDelegationForm");

  if (delegateContainer) {
    delegateContainer.innerHTML = context.eligible_delegates.length
      ? context.eligible_delegates.map((item) => `
          <label class="manager-delegation-person">
            <input type="checkbox" name="managerLeaveDelegate" value="${escapeHtml(item.delegate_employee_id)}" />
            <span class="manager-delegation-avatar">${escapeHtml(getManagerLeaveDelegateInitials(item))}</span>
            <span class="min-w-0">
              <span class="d-block fw-semibold text-truncate">${escapeHtml(item.delegate_name || item.delegate_email || "Secondary Manager")}</span>
              <span class="d-block small text-secondary text-truncate">Secondary Manager</span>
            </span>
          </label>`).join("")
      : '<div class="manager-delegation-empty">No eligible Secondary Managers are available for your Primary Manager assignments.</div>';
  }

  if (employeeSelect) {
    employeeSelect.innerHTML = state.teamMembers
      .filter((member) => isPrimaryReportingManagerRelationship(member.relationshipLabel))
      .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.employeeFullName || member.work_email || "Employee")}</option>`)
      .join("");
  }

  if (form) form.classList.toggle("d-none", !context.eligible_delegates.length);

  const startsInput = document.getElementById("managerLeaveDelegationStartsAt");
  const endsInput = document.getElementById("managerLeaveDelegationEndsAt");
  if (startsInput && !startsInput.value) {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    startsInput.value = toDelegationDateTimeLocalValue(now);
  }
  if (endsInput && !endsInput.value) {
    const end = new Date(startsInput?.value || Date.now());
    end.setHours(end.getHours() + 8);
    endsInput.value = toDelegationDateTimeLocalValue(end);
  }

  const grantedList = document.getElementById("managerLeaveDelegationGrantedList");
  if (grantedList) {
    grantedList.innerHTML = context.active_granted.length
      ? context.active_granted.map((item) => `
          <div class="manager-delegation-record d-flex flex-column flex-md-row justify-content-between gap-3">
            <div>
              <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <strong>${escapeHtml(item.delegate_name || "Secondary Manager")}</strong>
                ${buildManagerDelegationStatusHtml(item)}
              </div>
              <div class="small text-secondary mb-1">${escapeHtml(item.scope_label || "All employees I manage")}</div>
              <div class="small text-secondary mb-2">${escapeHtml(formatDelegationDateTime(item.starts_at))} to ${escapeHtml(formatDelegationDateTime(item.ends_at))}</div>
              <div class="small">${escapeHtml(item.reason || "No reason provided")}</div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-danger align-self-start" data-revoke-delegation-id="${escapeHtml(item.id)}">
              <i class="bi bi-x-circle me-1"></i>Revoke access
            </button>
          </div>`).join("")
      : '<div class="manager-delegation-empty">You have not granted any active temporary approval access.</div>';
  }

  const receivedList = document.getElementById("managerLeaveDelegationReceivedList");
  if (receivedList) {
    receivedList.innerHTML = context.active_received.length
      ? context.active_received.map((item) => `
          <div class="manager-delegation-record">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
              <strong>Approval access from ${escapeHtml(item.primary_manager_name || "Primary Manager")}</strong>
              ${buildManagerDelegationStatusHtml(item)}
            </div>
            <div class="small text-secondary">${escapeHtml(item.scope_label || "All employees managed by the Primary Manager")}</div>
            <div class="small text-secondary">Available until ${escapeHtml(formatDelegationDateTime(item.ends_at))}</div>
          </div>`).join("")
      : '<div class="manager-delegation-empty">No temporary approval access has been granted to you.</div>';
  }

  updateManagerLeaveDelegationSummary();
}

function showManagerLeaveDelegationNotice(type, message) {
  const notice = document.getElementById("managerLeaveDelegationNotice");
  if (!notice) return;
  notice.className = `alert alert-${type}`;
  notice.textContent = message;
}

async function submitManagerLeaveDelegations(event) {
  event.preventDefault();
  const selectedDelegateIds = getSelectedManagerLeaveDelegateIds();
  const scopeType = document.getElementById("managerLeaveDelegationScope")?.value || "team";
  const coveredEmployeeId = scopeType === "employee"
    ? document.getElementById("managerLeaveDelegationEmployee")?.value || null
    : null;
  const startsAt = document.getElementById("managerLeaveDelegationStartsAt")?.value;
  const endsAt = document.getElementById("managerLeaveDelegationEndsAt")?.value;
  const reason = String(document.getElementById("managerLeaveDelegationReason")?.value || "").trim();

  if (!selectedDelegateIds.length || !startsAt || !endsAt || !reason) {
    showManagerLeaveDelegationNotice("warning", "Select at least one Secondary Manager and complete all required fields.");
    return;
  }
  if (scopeType === "employee" && !coveredEmployeeId) {
    showManagerLeaveDelegationNotice("warning", "Select the employee this temporary access should cover.");
    return;
  }
  if (new Date(endsAt) <= new Date(startsAt)) {
    showManagerLeaveDelegationNotice("warning", "The access end time must be after its start time.");
    return;
  }

  const button = document.getElementById("managerLeaveDelegationSubmit");
  const originalButtonHtml = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Granting access...';
  }
  try {
    const supabase = getSupabaseClient();
    for (const delegateEmployeeId of selectedDelegateIds) {
      const { error } = await supabase.rpc("create_manager_leave_delegation", {
        p_delegate_employee_id: delegateEmployeeId,
        p_scope_type: scopeType,
        p_covered_employee_id: coveredEmployeeId,
        p_starts_at: new Date(startsAt).toISOString(),
        p_ends_at: new Date(endsAt).toISOString(),
        p_reason: reason,
      });
      if (error) throw error;
    }
    showManagerLeaveDelegationNotice("success", `${selectedDelegateIds.length} temporary approval access record${selectedDelegateIds.length === 1 ? "" : "s"} created.`);
    document.getElementById("managerLeaveDelegationForm")?.reset();
    await loadManagerLeaveDelegationContext();
    await loadTeamLeaveVisibility();
    populateManagerLeaveDelegationModal();
  } catch (error) {
    showManagerLeaveDelegationNotice("danger", error?.message || "Temporary approval access could not be created.");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalButtonHtml || '<i class="bi bi-person-check me-2"></i>Grant temporary approval access';
    }
  }
}

async function revokeManagerLeaveDelegation(delegationId) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("revoke_manager_leave_delegation", {
      p_delegation_id: delegationId,
    });
    if (error) throw error;
    showManagerLeaveDelegationNotice("success", "Temporary approval access revoked.");
    await loadManagerLeaveDelegationContext();
    await loadTeamLeaveVisibility();
    populateManagerLeaveDelegationModal();
  } catch (error) {
    showManagerLeaveDelegationNotice("danger", error?.message || "Temporary approval access could not be revoked.");
  }
}

function initialiseManagerLeaveDelegationUi() {
  ensureManagerLeaveDelegationModalMarkup();
  const modalElement = document.getElementById("managerLeaveDelegationModal");
  if (modalElement && window.bootstrap?.Modal) {
    state.managerLeaveDelegationModal = new window.bootstrap.Modal(modalElement);
  }

  document.getElementById("managerLeaveDelegationForm")?.addEventListener("submit", submitManagerLeaveDelegations);
  document.getElementById("managerLeaveDelegationScope")?.addEventListener("change", (event) => {
    document.getElementById("managerLeaveDelegationEmployeeWrap")?.classList.toggle("d-none", event.target.value !== "employee");
    updateManagerLeaveDelegationSummary();
  });
  document.getElementById("managerLeaveDelegationEmployee")?.addEventListener("change", updateManagerLeaveDelegationSummary);
  document.getElementById("managerLeaveDelegationStartsAt")?.addEventListener("change", updateManagerLeaveDelegationSummary);
  document.getElementById("managerLeaveDelegationEndsAt")?.addEventListener("change", updateManagerLeaveDelegationSummary);
  document.getElementById("managerLeaveDelegates")?.addEventListener("change", updateManagerLeaveDelegationSummary);
  document.getElementById("managerLeaveDelegationGrantedList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-revoke-delegation-id]");
    if (button) revokeManagerLeaveDelegation(button.dataset.revokeDelegationId);
  });
}


// MANAGER LEAVE READINESS IDENTITY RESOLUTION - v1.0.0
// Read the minimum tenant-scoped readiness data through a protected RPC.
// This avoids treating RLS-restricted Secondary Manager balance/profile reads
// as missing data. The existing Primary-Manager-only decision RPC remains the
// final authority for approve, reject, and return actions.
async function loadManagerLeaveReadinessRows() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc(
      "get_manager_leave_readiness",
    );

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(
      "Unable to load protected manager leave readiness; using direct-read fallback:",
      error,
    );
    return [];
  }
}

async function loadManagerLeaveDecisionAuthorityAuditRows() {
  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase.rpc(
      "get_manager_leave_decision_authority_history",
    );

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(
      "Unable to load delegated leave decision authority history:",
      error,
    );
    return [];
  }
}

async function loadTeamLeaveVisibility() {
  const supabase = getSupabaseClient();

  const leaveIdentityCandidates = state.teamMembers.flatMap((member) =>
    getLeaveIdentityCandidatesForMember(member),
  );

  const uniqueLeaveIds = [...new Set(leaveIdentityCandidates)];

  if (!uniqueLeaveIds.length) {
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];
    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
    return;
  }

  try {
    const today = new Date();
    const todayIso = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    )
      .toISOString()
      .split("T")[0];

    const { data: leaveRows, error: leaveError } = await supabase
      .from("leave_requests")
      .select(
        `
        id,
        employee_id,
        leave_type_id,
        start_date,
        end_date,
        total_days,
        status,
        reason,
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
          id,
          code,
          name,
          eligibility_rule
        )
      `,
      )
      .in("employee_id", uniqueLeaveIds)
      .order("start_date", { ascending: true });

    if (leaveError) throw leaveError;

    const leaveRowsArray = Array.isArray(leaveRows) ? leaveRows : [];

    // MANAGER LEAVE READINESS IDENTITY RESOLUTION - v1.0.0
    // Prefer the protected same-tenant readiness RPC. It resolves leave request
    // employee identities to the canonical employees.id record and returns only
    // the minimum balance, eligibility, and manager-relationship fields needed
    // by this page. Direct balance reads remain a safe compatibility fallback.
    const readinessRows = await loadManagerLeaveReadinessRows();
    const readinessByRequestId = new Map();

    readinessRows.forEach((readinessRow) => {
      const requestId = String(readinessRow?.request_id || "").trim();
      if (requestId) readinessByRequestId.set(requestId, readinessRow);
    });

    const authorityAuditRows =
      await loadManagerLeaveDecisionAuthorityAuditRows();
    const authorityAuditByRequestId = new Map();

    authorityAuditRows.forEach((auditRow) => {
      const requestId = String(auditRow?.leave_request_id || "").trim();
      if (requestId) authorityAuditByRequestId.set(requestId, auditRow);
    });

    const leaveBalanceByEmployeeAndType = new Map();

    const leaveBalanceEmployeeIds = [
      ...new Set(
        state.teamMembers
          .map((member) =>
            String(member.id || member.raw?.id || "").trim(),
          )
          .filter(Boolean),
      ),
    ];

    const leaveBalanceTypeIds = [
      ...new Set(
        leaveRowsArray
          .map((row) => String(row.leave_type_id || "").trim())
          .filter(Boolean),
      ),
    ];

    if (leaveBalanceEmployeeIds.length && leaveBalanceTypeIds.length) {
      const { data: balanceRows, error: balanceError } = await supabase
        .from("employee_leave_balances")
        .select("id, employee_id, leave_type_id, entitled_days, used_days, remaining_days")
        .in("employee_id", leaveBalanceEmployeeIds)
        .in("leave_type_id", leaveBalanceTypeIds);

      if (balanceError) {
        console.warn(
          "Direct manager balance fallback was unavailable under RLS:",
          balanceError,
        );
      } else {
        (balanceRows || []).forEach((balanceRow) => {
          const balanceKey = `${balanceRow.employee_id}|${balanceRow.leave_type_id}`;
          leaveBalanceByEmployeeAndType.set(balanceKey, balanceRow);
        });
      }
    }

    const teamMembersByIdentity = new Map();

    state.teamMembers.forEach((member) => {
      getLeaveIdentityCandidatesForMember(member).forEach((candidate) => {
        teamMembersByIdentity.set(String(candidate), member);
      });
    });

    const enrichedLeaveItems = leaveRowsArray
      .map((leaveRow) => {
        const owner = teamMembersByIdentity.get(String(leaveRow.employee_id));
        if (!owner) return null;

        // MANAGER LEAVE READINESS IDENTITY RESOLUTION - v1.0.0
        // The RPC resolves employees.id, employees.user_id, and profile-linked
        // request identities inside the signed-in manager's tenant. Prefer that
        // canonical result; use the existing direct-read map only as fallback.
        const readiness =
          readinessByRequestId.get(String(leaveRow.id || "")) || null;
        const canonicalEmployeeId = String(
          readiness?.canonical_employee_id || owner.id || "",
        ).trim();
        const balanceKey = `${canonicalEmployeeId}|${leaveRow.leave_type_id}`;
        const leaveBalance = readiness?.has_balance
          ? readiness
          : leaveBalanceByEmployeeAndType.get(balanceKey) || null;
        const authorityAudit =
          authorityAuditByRequestId.get(String(leaveRow.id || "")) || null;

        return {
          ...leaveRow,
          employeeName: owner.employeeFullName,
          employeeEmail: owner.work_email,
          employeeDepartment: owner.department,
          leaveTypeName: leaveRow.leave_types?.name || "Unknown",

          // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
          // Manager approval must respect the same leave-type eligibility
          // rule used by Employee Self Service. Keep these values on the
          // request item so pending readiness and save-time approval checks
          // can block ineligible requests without affecting reject/return.
          leaveTypeCode: leaveRow.leave_types?.code || "",
          leaveTypeEligibilityRule:
            leaveRow.leave_types?.eligibility_rule || "all_employees",
          employeeGender:
            readiness?.employee_gender ||
            owner.raw?.gender ||
            owner.raw?.sex ||
            owner.raw?.gender_identity ||
            "",

          employeeRecordId: canonicalEmployeeId || owner.id,

          // LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
          // Preserve this manager's relationship to the employee on each leave
          // item so processed decisions can show FYI behaviour for additional
          // managers without giving them approval rights.
          managerRelationshipLabel: readiness?.manager_type
            ? `${readiness.manager_type} Manager`
            : owner.relationshipLabel || "",
          canDecideLeaveRequest: readiness?.can_decide === true,
          decisionAuthority: readiness?.decision_authority || "view_only",
          activeDelegationId: readiness?.delegation_id || null,
          delegationEndsAt: readiness?.delegation_ends_at || null,
          delegatedByName: readiness?.delegated_by_name || "",
          decisionAuthorityType: authorityAudit?.authority_type || "",
          decisionAuthorityActorName: authorityAudit?.actor_manager_name || "",
          decisionAuthorityPrimaryName:
            authorityAudit?.primary_manager_name || "",
          decisionAuthorityDelegationId: authorityAudit?.delegation_id || null,

          // MANAGER DASHBOARD WIRING - STEP 2F FIX
          // leave_requests.employee_id can be the linked user/profile ID,
          // while balances use employees.id. Keep all known identity values
          // so overlap validation checks the correct leave_request owner.
          employeeLeaveIdentityCandidates: getLeaveIdentityCandidatesForMember(owner),

          // MANAGER DASHBOARD WIRING - STEP 2G
          // Balance values support manager-facing readiness badges and disabled
          // approval buttons for impossible approvals. They do not replace the
          // final save-time balance validation.
          leaveBalanceMissing: !leaveBalance,
          leaveBalanceEntitledDays: leaveBalance
            ? Number(leaveBalance.entitled_days || 0)
            : null,
          leaveBalanceUsedDays: leaveBalance
            ? Number(leaveBalance.used_days || 0)
            : null,
          leaveBalanceRemainingDays: leaveBalance
            ? Number(leaveBalance.remaining_days || 0)
            : null,
        };
      })
      .filter(Boolean);

    const pendingRequests = enrichedLeaveItems
      .filter((item) => normalizeText(item.status) === "pending approval")
      .sort((left, right) => {
        // MANAGER DASHBOARD WIRING - STEP 2C
        // Pending approval is a manager action queue, not a leave calendar.
        // Show the newest submitted request first so managers review current
        // requests before older pending items.
        const leftSubmittedDate = new Date(
          left.submitted_at || left.start_date || 0,
        ).getTime();

        const rightSubmittedDate = new Date(
          right.submitted_at || right.start_date || 0,
        ).getTime();

        return rightSubmittedDate - leftSubmittedDate;
      });

    const processedRequests = enrichedLeaveItems
      .filter((item) =>
        // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
        // HR-cancelled leave must remain visible to managers as processed
        // audit history, but it must not appear in the approved team schedule.
        ["approved", "rejected", "returned", "returned for clarification", "cancelled"].includes(
          normalizeText(item.status),
        ),
      )
      .sort((left, right) => {
        const leftDate = new Date(
          left.cancelled_at || left.decision_at || left.submitted_at || left.start_date || 0,
        ).getTime();
        const rightDate = new Date(
          right.cancelled_at || right.decision_at || right.submitted_at || right.start_date || 0,
        ).getTime();
        return rightDate - leftDate;
      });

    const upcomingScheduleItems = enrichedLeaveItems.filter((item) => {
      const normalizedStatus = normalizeText(item.status);

      if (normalizedStatus !== "approved") {
        return false;
      }

      return String(item.end_date || "") >= todayIso;
    });

    state.pendingLeaveRequests = addOverlapFlagsToLeaveItems(pendingRequests);
    state.processedLeaveRequests = processedRequests;
    state.teamLeaveSchedule = addOverlapFlagsToLeaveItems(
      upcomingScheduleItems,
    ).sort((left, right) => {
      const leftDate = new Date(left.start_date || 0).getTime();
      const rightDate = new Date(right.start_date || 0).getTime();
      return leftDate - rightDate;
    });

    renderPendingLeaveRequests(state.pendingLeaveRequests);
    renderProcessedLeaveRequests(state.processedLeaveRequests);
    renderTeamLeaveSchedule(state.teamLeaveSchedule);
    renderLeaveSummaryTiles(
      state.pendingLeaveRequests,
      state.teamLeaveSchedule,
    );

    // LINE MANAGER LEAVE APPROVAL AUTHORITY - STEP 1I
    // Additional managers receive an FYI toast for processed decisions only.
    // Pending approvals remain primary-manager only.
    notifyAdditionalManagersOfProcessedLeaveDecisions(state.processedLeaveRequests);
  } catch (error) {
    console.error("Error loading team leave visibility:", error);
    showPageAlert(
      "danger",
      error.message ||
      "Team leave requests and leave schedule could not be loaded.",
    );
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];
    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
  }
}

function renderLeaveSummaryTiles(pendingRequests, scheduleItems) {
  const overlapCount = [...pendingRequests, ...scheduleItems].filter(
    (item) => item.hasOverlap,
  ).length;

  const uniqueLeaveTypes = new Set(
    [...pendingRequests, ...scheduleItems]
      .map((item) => String(item.leaveTypeName || "").trim())
      .filter(Boolean),
  );

  if (state.dom.pendingLeaveCountValue) {
    state.dom.pendingLeaveCountValue.textContent = String(pendingRequests.length);
  }

  if (state.dom.upcomingLeaveCountValue) {
    state.dom.upcomingLeaveCountValue.textContent = String(scheduleItems.length);
  }

  if (state.dom.overlapCountValue) {
    state.dom.overlapCountValue.textContent = String(overlapCount);
  }

  if (state.dom.leaveTypeCountValue) {
    state.dom.leaveTypeCountValue.textContent = String(uniqueLeaveTypes.size);
  }
  renderManagerActionCoverageCentre();
  renderManagerTeamWorkspaceSummary();
}

function renderPendingRequestsLoadingState() {
  if (!state.dom.pendingRequestsTableBody) return;

  state.dom.pendingRequestsEmptyState.classList.add("d-none");
  state.dom.pendingRequestsTableWrapper.classList.remove("d-none");
  state.dom.pendingRequestsTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
           Pending approval table now has six manager-facing review columns. -->
      <td colspan="6" class="text-center text-secondary py-4">
        Loading pending leave requests...
      </td>
    </tr>
  `;
}

// MANAGER PENDING LEAVE REQUEST MODERN CARDS - v1.0.1
// Direct renderer replacement for the already loaded, manager-scoped queue.
// No query, RLS, reporting-line, balance, authority, modal, or session change.
function renderPendingLeaveRequests(requests) {
  const tbody = state.dom.pendingRequestsTableBody;
  if (!tbody) return;

  const visibleRequests = Array.isArray(requests) ? requests : [];
  tbody.innerHTML = "";

  if (!visibleRequests.length) {
    state.dom.pendingRequestsEmptyState?.classList.remove("d-none");
    state.dom.pendingRequestsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.pendingRequestsEmptyState?.classList.add("d-none");
  state.dom.pendingRequestsTableWrapper?.classList.remove("d-none");

  visibleRequests.forEach((request) => {
    const row = document.createElement("tr");
    row.className = "manager-pending-modern-row";

    const startDate = getDashboardDisplayDate(request.start_date);
    const endDate = getDashboardDisplayDate(request.end_date);
    const startLabel = startDate
      ? formatShortMonthDayFromDate(startDate)
      : formatDate(request.start_date);
    const endLabel = endDate
      ? formatShortMonthDayFromDate(endDate)
      : formatDate(request.end_date);
    const startYear = startDate ? String(startDate.getFullYear()) : "";
    const endYear = endDate ? String(endDate.getFullYear()) : "";

    const periodLabel =
      startYear && endYear && startYear === endYear
        ? `${startLabel} - ${endLabel}, ${endYear}`
        : `${startLabel}${startYear ? `, ${startYear}` : ""} - ${endLabel}${endYear ? `, ${endYear}` : ""}`;

    const numericDays = Number(request.total_days || 0);
    const durationLabel = numericDays > 0
      ? `${numericDays} day${numericDays === 1 ? "" : "s"}`
      : "--";

    const employeeName = String(
      request.employeeName || "Unknown Employee",
    ).trim();

    row.innerHTML = `
      <td colspan="6" class="manager-pending-modern-cell">
        <article class="manager-pending-modern-card"
          aria-label="Pending leave request for ${escapeHtml(employeeName)}">

          <header class="manager-pending-modern-header">
            <div class="manager-pending-modern-identity">
              ${buildPendingRequestIdentityHtml(request)}
            </div>

            <div class="manager-pending-modern-header-side">
              <div class="manager-pending-modern-submitted">
                <span class="manager-pending-modern-label">Submitted</span>
                ${buildPendingRequestSubmittedHtml(request.submitted_at)}
              </div>

              <div class="manager-pending-modern-actions">
                <span class="manager-pending-modern-label">Decision actions</span>
                ${buildPendingRequestDecisionActionsHtml(request)}
              </div>
            </div>
          </header>

          <div class="manager-pending-modern-meta-grid">
            <div class="manager-pending-modern-meta-item">
              <span>Leave type</span>
              <strong>${escapeHtml(request.leaveTypeName || "--")}</strong>
            </div>

            <div class="manager-pending-modern-meta-item manager-pending-modern-meta-item--period">
              <span>Leave period</span>
              <strong>${escapeHtml(periodLabel)}</strong>
            </div>

            <div class="manager-pending-modern-meta-item">
              <span>Duration</span>
              <strong>${escapeHtml(durationLabel)}</strong>
            </div>
          </div>

          <section class="manager-pending-modern-readiness">
            <span class="manager-pending-modern-label">Decision readiness</span>
            <div class="manager-pending-modern-readiness-content">
              ${buildPendingRequestReviewSignalsHtml(request, visibleRequests)}
            </div>
          </section>
        </article>
      </td>
    `;

    tbody.appendChild(row);
  });
}

function renderProcessedRequestsLoadingState() {
  if (!state.dom.processedRequestsTableBody) return;

  state.dom.processedRequestsEmptyState?.classList.add("d-none");
  state.dom.processedRequestsTableWrapper?.classList.remove("d-none");
  state.dom.processedRequestsTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
           Processed decisions now render in six audit-focused columns. -->
      <td colspan="6" class="text-center text-secondary py-4">
        Loading processed leave decisions...
      </td>
    </tr>
  `;
}

// MANAGER PROCESSED DECISION AUDIT CARDS - v1.0.1
// Presentation-only helpers for the existing processed leave data.
// No query, RLS, reporting-line, authority, decision, balance, or session logic changes.
function getProcessedDecisionAuditCardTone(request = {}) {
  const status = normalizeText(request.status);

  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "returned" || status === "returned for clarification") {
    return "returned";
  }
  if (status === "cancelled" || request.cancelled_at) return "cancelled";

  return "neutral";
}

function getProcessedDecisionAuditCardInitials(employeeName = "") {
  return (
    String(employeeName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "TM"
  );
}

function getProcessedDecisionAuditCardPeriod(request = {}) {
  const startDate = getDashboardDisplayDate(request.start_date);
  const endDate = getDashboardDisplayDate(request.end_date);

  if (!startDate || !endDate) {
    return `${formatDate(request.start_date)} - ${formatDate(request.end_date)}`;
  }

  const startLabel = formatShortMonthDayFromDate(startDate);
  const endLabel = formatShortMonthDayFromDate(endDate);
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  if (startYear === endYear) {
    return `${startLabel} - ${endLabel}, ${startYear}`;
  }

  return `${startLabel}, ${startYear} - ${endLabel}, ${endYear}`;
}

function buildProcessedDecisionAuditCardCommentHtml(request = {}) {
  const isCancelled =
    normalizeText(request.status) === "cancelled" ||
    Boolean(request.cancelled_at);

  const comment = String(
    isCancelled
      ? request.cancellation_reason || "No cancellation reason recorded."
      : request.decision_comment || "No comment recorded.",
  ).trim();

  if (comment.length <= 180) {
    return `
      <div class="manager-processed-card-comment-text">
        ${escapeHtml(comment)}
      </div>
    `;
  }

  const preview = `${comment.slice(0, 177).trimEnd()}...`;

  return `
    <div class="manager-processed-card-comment-text manager-processed-card-comment-preview">
      ${escapeHtml(preview)}
    </div>
    <details class="manager-processed-card-comment-details">
      <summary>Show full comment</summary>
      <div>${escapeHtml(comment)}</div>
    </details>
  `;
}

function formatLeaveDurationDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return "--";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function buildProcessedDecisionAuditCardHtml(request = {}) {
  const employeeName = String(
    request.employeeName || "Unknown Employee",
  ).trim();
  const employeeRecordId = String(request.employeeRecordId || "").trim();
  const initials = getProcessedDecisionAuditCardInitials(employeeName);
  const tone = getProcessedDecisionAuditCardTone(request);
  const isCancelled = tone === "cancelled";
  const statusLabel = isCancelled
    ? "Cancelled by HR"
    : getCompactDecisionStatusLabel(request.status);
  const eventValue = isCancelled
    ? request.cancelled_at || request.decision_at
    : request.decision_at;
  const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(eventValue);
  const actor = String(
    isCancelled
      ? request.cancelled_by_name || request.cancelled_by || "HR"
      : request.decision_by_name || "Decision owner unavailable",
  ).trim();
  const actionVerb = isCancelled
    ? "cancelled"
    : getProcessedDecisionVerb(request.status);
  const restoredDays = Number(request.balance_restored_days || 0);
  const hasRestoredDays = Number.isFinite(restoredDays) && restoredDays > 0;
  const employeeNameHtml = employeeRecordId
    ? `
      <button type="button"
        class="manager-processed-card-name-link"
        data-manager-employee-id="${escapeHtml(employeeRecordId)}"
        onclick="window.managerOpenEmployeeDetails?.(this.dataset.managerEmployeeId)"
        aria-label="View work details for ${escapeHtml(employeeName)}">
        ${escapeHtml(employeeName)}
      </button>
    `
    : `<strong class="manager-processed-card-name">${escapeHtml(employeeName)}</strong>`;

  const originalDecisionHtml = isCancelled
    ? `
      <span class="manager-processed-card-audit-chip">
        <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
        Original decision: ${escapeHtml(request.cancelled_from_status || "Approved")}
        ${request.decision_by_name ? ` by ${escapeHtml(request.decision_by_name)}` : ""}
      </span>
    `
    : "";

  const restoredBalanceHtml = isCancelled
    ? `
      <span class="manager-processed-card-audit-chip">
        <i class="bi bi-calendar2-check" aria-hidden="true"></i>
        ${escapeHtml(
      hasRestoredDays
        ? `${restoredDays} day(s) restored`
        : "Balance restoration not recorded",
    )}
      </span>
    `
    : "";

  const relationshipLabel =
    request.decisionAuthorityType === "delegated"
      ? "Acting Secondary Manager"
      : request.managerRelationshipLabel;
  const relationshipHtml = relationshipLabel
    ? `
      <span class="manager-processed-card-relationship">
        ${escapeHtml(relationshipLabel)}
      </span>
    `
    : "";

  const delegatedAuthorityHtml =
    !isCancelled && request.decisionAuthorityType === "delegated"
      ? `
        <div class="manager-processed-card-audit-chips">
          <span class="manager-processed-card-audit-chip">
            <i class="bi bi-person-check" aria-hidden="true"></i>
            ${escapeHtml(
        `${request.decisionAuthorityActorName || actor} acted using temporary approval access granted by ${request.decisionAuthorityPrimaryName || "the Primary Manager"}.`,
      )}
          </span>
        </div>
      `
      : "";

  return `
    <article class="manager-processed-audit-card manager-processed-audit-card--${escapeHtml(tone)}">
      <header class="manager-processed-card-header">
        <div class="manager-processed-card-identity">
          <span class="manager-processed-card-avatar" aria-hidden="true">
            ${escapeHtml(initials)}
          </span>

          <div class="manager-processed-card-person">
            ${employeeNameHtml}
            <span class="manager-processed-card-department">
              <i class="bi bi-building" aria-hidden="true"></i>
              ${escapeHtml(request.employeeDepartment || "Department unavailable")}
            </span>
          </div>
        </div>

        <div class="manager-processed-card-status-area">
          ${relationshipHtml}
          <span class="manager-processed-card-status manager-processed-card-status--${escapeHtml(tone)}">
            ${escapeHtml(statusLabel || request.status || "Updated")}
          </span>
        </div>
      </header>

      <div class="manager-processed-card-meta" role="list" aria-label="Leave decision summary">
        <div class="manager-processed-card-meta-item" role="listitem">
          <span>Leave type</span>
          <strong>${escapeHtml(request.leaveTypeName || "Unknown")}</strong>
        </div>

        <div class="manager-processed-card-meta-item" role="listitem">
          <span>Leave period</span>
          <strong>${escapeHtml(getProcessedDecisionAuditCardPeriod(request))}</strong>
        </div>

        <div class="manager-processed-card-meta-item" role="listitem">
          <span>Duration</span>
          <strong>${escapeHtml(formatLeaveDurationDays(request.total_days))}</strong>
        </div>

        <div class="manager-processed-card-meta-item" role="listitem">
          <span>Decision date</span>
          <strong>${escapeHtml(dateLabel)}</strong>
        </div>
      </div>

      <div class="manager-processed-card-audit-line">
        <span class="manager-processed-card-audit-icon" aria-hidden="true">
          <i class="bi bi-shield-check"></i>
        </span>
        <div>
          <strong>${escapeHtml(actor)} ${escapeHtml(actionVerb)} this leave request</strong>
          <span>${escapeHtml(dateLabel)} at ${escapeHtml(timeLabel)}</span>
        </div>
      </div>

      ${delegatedAuthorityHtml}

      ${isCancelled
      ? `
          <div class="manager-processed-card-audit-chips">
            ${originalDecisionHtml}
            ${restoredBalanceHtml}
          </div>
        `
      : ""}

      <section class="manager-processed-card-comment" aria-label="Decision comment">
        <span class="manager-processed-card-comment-label">Comment</span>
        ${buildProcessedDecisionAuditCardCommentHtml(request)}
      </section>
    </article>
  `;
}

function renderProcessedLeaveRequests(requests) {
  const tbody = state.dom.processedRequestsTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!requests.length) {
    state.dom.processedRequestsEmptyState?.classList.remove("d-none");
    state.dom.processedRequestsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.processedRequestsEmptyState?.classList.add("d-none");
  state.dom.processedRequestsTableWrapper?.classList.remove("d-none");

  requests.forEach((request) => {
    const row = document.createElement("tr");
    row.className = "manager-processed-audit-row";
    row.innerHTML = `
      <td colspan="6" class="manager-processed-audit-cell">
        ${buildProcessedDecisionAuditCardHtml(request)}
      </td>
    `;

    tbody.appendChild(row);
  });
}
function renderTeamScheduleLoadingState() {
  if (!state.dom.teamScheduleTableBody) return;

  state.dom.teamScheduleEmptyState.classList.add("d-none");
  state.dom.teamScheduleTableWrapper.classList.remove("d-none");
  state.dom.teamScheduleTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
           Team schedule now renders in four coverage-planning columns. -->
      <td colspan="5" class="text-center text-secondary py-4">
        Loading team leave schedule...
      </td>
    </tr>
  `;
}

// MANAGER TEAM LEAVE SCHEDULE FULL-WIDTH RECORDS - v1.0.2
// Presentation-only replacement of the previous compact-card renderer.
// Existing manager-scoped data, timing, overlap, employee-details links,
// leave status rules, RLS, permissions, queries, and session behaviour remain unchanged.
function renderTeamLeaveSchedule(scheduleItems) {
  const tbody = state.dom.teamScheduleTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!scheduleItems.length) {
    state.dom.teamScheduleEmptyState.classList.remove("d-none");
    state.dom.teamScheduleTableWrapper.classList.add("d-none");
    return;
  }

  state.dom.teamScheduleEmptyState.classList.add("d-none");
  state.dom.teamScheduleTableWrapper.classList.remove("d-none");

  scheduleItems.forEach((item) => {
    const row = document.createElement("tr");
    row.className = "manager-team-schedule-record-row";

    const startDate = getDashboardDisplayDate(item.start_date);
    const endDate = getDashboardDisplayDate(item.end_date);
    const startLabel = formatShortMonthDayFromDate(startDate);
    const endLabel = formatShortMonthDayFromDate(endDate);

    const startYear = startDate ? String(startDate.getFullYear()) : "";
    const endYear = endDate ? String(endDate.getFullYear()) : "";
    const yearLabel =
      startYear && endYear && startYear !== endYear
        ? `${startYear} - ${endYear}`
        : startYear || endYear || "";

    const periodLabel =
      startLabel && endLabel
        ? `${startLabel} - ${endLabel}${yearLabel ? `, ${yearLabel}` : ""}`
        : `${formatDate(item.start_date)} - ${formatDate(item.end_date)}`;

    const durationValue = Number(item.total_days || 0);
    const durationLabel =
      Number.isFinite(durationValue) && durationValue > 0
        ? `${durationValue} day${durationValue === 1 ? "" : "s"}`
        : "--";

    const employeeName = String(
      item.employeeName || "Unknown Employee",
    ).trim();

    row.innerHTML = `
      <td colspan="5" class="manager-team-schedule-record-cell">
        <article class="manager-team-schedule-record"
          aria-label="${escapeHtml(employeeName)} team leave schedule item">

          <div class="manager-team-schedule-record-main">
            <div class="manager-team-schedule-record-identity">
              ${buildTeamScheduleIdentityHtml(item)}
            </div>

            <div class="manager-team-schedule-record-signals">
              <section class="manager-team-schedule-signal"
                aria-label="Leave timing">
                <span class="manager-team-schedule-signal-label">
                  Timing
                </span>
                <div class="manager-team-schedule-signal-value">
                  ${buildTeamScheduleTimingHtml(item)}
                </div>
              </section>

              <section class="manager-team-schedule-signal"
                aria-label="Team overlap">
                <span class="manager-team-schedule-signal-label">
                  Team overlap
                </span>
                <div class="manager-team-schedule-signal-value">
                  ${buildTeamScheduleCoverageHtml(item)}
                </div>
              </section>
            </div>
          </div>

          <dl class="manager-team-schedule-record-meta">
            <div>
              <dt>Leave type</dt>
              <dd>${escapeHtml(item.leaveTypeName || "--")}</dd>
            </div>

            <div>
              <dt>Leave period</dt>
              <dd>${escapeHtml(periodLabel)}</dd>
            </div>

            <div>
              <dt>Duration</dt>
              <dd>${escapeHtml(durationLabel)}</dd>
            </div>
          </dl>
        </article>
      </td>
    `;

    tbody.appendChild(row);
  });
}

function getDecisionStatusFromAction(action) {
  switch (action) {
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    case "return":
      return "Returned for Clarification";
    default:
      return "Pending Approval";
  }
}

async function handleDecisionAction(leaveId, action, buttonElement) {
  openDecisionModal(leaveId, action, buttonElement);
}

function setActionButtonLoading(buttonElement, isLoading) {
  if (!buttonElement) return;

  buttonElement.disabled = isLoading;

  if (isLoading) {
    buttonElement.dataset.originalHtml = buttonElement.innerHTML;
    buttonElement.innerHTML = `
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
    `;
  } else if (buttonElement.dataset.originalHtml) {
    buttonElement.innerHTML = buttonElement.dataset.originalHtml;
    delete buttonElement.dataset.originalHtml;
  }
}

async function applyApprovedLeaveToBalance(request) {
  const supabase = getSupabaseClient();

  if (!request?.employeeRecordId) {
    throw new Error(
      "Employee record could not be resolved for this leave request, so the leave balance could not be updated.",
    );
  }

  if (!request?.leave_type_id) {
    throw new Error(
      "Leave type could not be resolved for this leave request, so the leave balance could not be updated.",
    );
  }

  const approvedDays = Number(request.total_days || 0);

  if (!approvedDays || approvedDays <= 0) {
    throw new Error(
      "Approved leave days are invalid, so the leave balance could not be updated.",
    );
  }

  const { data: balanceRow, error: balanceError } = await supabase
    .from("employee_leave_balances")
    .select("id, employee_id, leave_type_id, entitled_days, used_days, remaining_days")
    .eq("employee_id", request.employeeRecordId)
    .eq("leave_type_id", request.leave_type_id)
    .maybeSingle();

  if (balanceError) throw balanceError;

  if (!balanceRow) {
    throw new Error(
      `No leave balance record exists for ${request.employeeName} under ${request.leaveTypeName}.`,
    );
  }

  const entitledDays = Number(balanceRow.entitled_days || 0);
  const usedDays = Number(balanceRow.used_days || 0);
  const remainingDays = Number(balanceRow.remaining_days || 0);

  if (remainingDays < approvedDays) {
    throw new Error(
      `${request.employeeName} does not have enough remaining ${request.leaveTypeName} balance. Remaining: ${remainingDays}, requested: ${approvedDays}.`,
    );
  }

  const nextUsedDays = usedDays + approvedDays;
  const nextRemainingDays = Math.max(entitledDays - nextUsedDays, 0);

  const { error: updateBalanceError } = await supabase
    .from("employee_leave_balances")
    .update({
      used_days: nextUsedDays,
      remaining_days: nextRemainingDays,
    })
    .eq("id", balanceRow.id);

  if (updateBalanceError) throw updateBalanceError;
}

// LEAVE APPROVAL IDEMPOTENCY / DOUBLE-DEDUCTION PROTECTION - STEP 1C
// Persist manager leave decisions through the transactional Supabase RPC.
// The RPC locks the leave request, confirms it is still Pending Approval,
// deducts balance once for approvals, saves decision audit fields, and refuses
// any second decision attempt. Frontend code must not update balance separately.
async function persistLeaveDecision(leaveRequestId, status, comment) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc(
    "hrp_apply_leave_decision_once",
    {
      p_leave_request_id: leaveRequestId,
      p_decision_status: status,
      p_decision_comment: comment || null,
    },
  );

  if (error) {
    throw error;
  }

  const savedDecision = Array.isArray(data) ? data[0] : data;

  if (!savedDecision) {
    throw new Error(
      "Leave decision was not saved. The database did not return a decision confirmation.",
    );
  }

  const expectedStatus = normalizeText(status);
  const savedStatus = normalizeText(savedDecision.status);

  if (savedStatus !== expectedStatus) {
    throw new Error(
      `Leave decision save verification failed. Expected status "${status}" but Supabase returned "${savedDecision.status || "--"}".`,
    );
  }

  const requiresAuditComment = [
    "rejected",
    "returned for clarification",
    "returned",
  ].includes(expectedStatus);

  if (!savedDecision.decision_at || !savedDecision.decision_by_name) {
    throw new Error(
      "Leave decision save verification failed. Decision audit fields were not saved.",
    );
  }

  if (requiresAuditComment && !String(savedDecision.decision_comment || "").trim()) {
    throw new Error(
      "Leave decision save verification failed. A rejection or clarification comment was required but was not saved.",
    );
  }

  return savedDecision;
}
// MANAGER PROFILE SIDEBAR ACCESS BRIDGE - v1.0.1
// Adds one isolated desktop-sidebar proxy for the existing Profile workspace.
// This deliberately avoids replacing the dashboard's current workspace map,
// routing, profile form, save logic, self-service logic, or session behaviour.
(function initialiseManagerProfileSidebarAccess() {
  const bindProfileSidebarAccess = () => {
    const sidebarProfileButton = document.getElementById(
      "sidebarManagerProfileBtn",
    );
    const profileWorkspaceButton = document.getElementById(
      "managerTabProfileBtn",
    );
    const profileSection = document.getElementById("managerProfileSection");

    if (
      !sidebarProfileButton ||
      !profileWorkspaceButton ||
      !profileSection
    ) {
      return;
    }

    if (sidebarProfileButton.dataset.profileAccessBound === "true") {
      return;
    }

    sidebarProfileButton.dataset.profileAccessBound = "true";

    const syncProfileSidebarState = () => {
      const isProfileActive = !profileSection.classList.contains("d-none");

      sidebarProfileButton.classList.toggle("active", isProfileActive);

      if (isProfileActive) {
        sidebarProfileButton.setAttribute("aria-current", "page");
      } else {
        sidebarProfileButton.removeAttribute("aria-current");
      }
    };

    sidebarProfileButton.addEventListener("click", () => {
      profileWorkspaceButton.click();
      window.requestAnimationFrame(syncProfileSidebarState);
    });

    const profileSectionObserver = new MutationObserver(
      syncProfileSidebarState,
    );

    profileSectionObserver.observe(profileSection, {
      attributes: true,
      attributeFilter: ["class"],
    });

    syncProfileSidebarState();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      bindProfileSidebarAccess,
      { once: true },
    );
  } else {
    bindProfileSidebarAccess();
  }
})();
