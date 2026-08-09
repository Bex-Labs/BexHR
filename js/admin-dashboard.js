// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the previous scroll position on long Admin pages.
// Keep restoration manual so refresh always lands at the top of the restored workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Admin dashboard scroll restoration could not be set to manual.", error);
}
// ADMIN WORKSPACE LOADER - v1.0.2
// Presentation only. Releases the first-paint gate after the
// existing authenticated Admin startup sequence completes.
function releaseAdminWorkspaceLoader() {
  const body = document.body;
  const loader = document.getElementById("bexhrWorkspaceLoader");
  const firstPaintGate = document.getElementById(
    "adminWorkspaceFirstPaintGate",
  );

  body?.classList.remove("admin-workspace-booting");
  body?.removeAttribute("aria-busy");

  firstPaintGate?.remove();

  if (!loader) return;

  loader.setAttribute("aria-hidden", "true");
  loader.style.opacity = "0";
  loader.style.pointerEvents = "none";

  window.setTimeout(() => {
    loader.remove();
  }, 220);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindEvents();

    const access = await window.SessionManager.protectPage("admin");

    if (!access) return;

    state.currentUser = access.session.user;
    state.currentProfile = access.profile;

    // ADMIN UI CLEANUP - STEP 1D
    // Reload the latest Admin profile so profile_image_path is available
    // before rendering the avatar/photo preview.
    await loadLatestAdminProfile();

    renderAdminProfile(state.currentProfile, access.session.user);

    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Restore the remembered Admin workspace before long company/user-access
    // refreshes continue. Fresh login still opens Profile because logout clears memory.
    restoreAdminWorkspaceAfterRefresh();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Load tenant/company records after Admin access is confirmed.
    await refreshTenantWorkspace();

    // ADMIN EMAIL SETUP - STEP 1D
    // Load Admin-owned approved validation recipients after companies are loaded,
    // because each recipient is scoped to a company workspace.
    await refreshAdminEmailSetupWorkspace();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Load profiles so Admin can manage company-scoped user access.
    await refreshProfileTenantLinkingWorkspace();

    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Workspace was already restored early. Re-assert top after async startup loads.
    forceAdminDashboardToTopAfterRefresh();

    // ADMIN WORKSPACE LOADER - v1.0.2
    // Existing authenticated Admin startup data is now ready.
    releaseAdminWorkspaceLoader();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Expose tenant edit action for the Tenant Records table.
    window.adminEditTenantRecord = (tenantId) => {
      startTenantEdit(tenantId);
    };
    // ADMIN DELETE ACTIONS - STEP 1
    // Company delete is guarded by a Supabase RPC so Admin cannot accidentally
    // remove a company that already has operational HR/payroll data.
    window.adminDeleteTenantRecord = async (tenantId) => {
      await deleteTenantRecord(tenantId);
    };

    // ADMIN RESET WORKSPACE - v1.0.0
    // Opens the controlled Reset Workspace confirmation flow.
    // The protected PostgreSQL RPC remains the destructive boundary.
    window.adminResetTenantWorkspace = (tenantId) => {
      openResetWorkspaceModal(tenantId);
    };

    // ADMIN EMAIL SETUP - STEP 1D
    // Expose approved validation recipient edit action for the records table.
    window.adminEditEmailRecipientRecord = (recipientId) => {
      startAdminEmailRecipientEdit(recipientId);
    };

    // ADMIN DELETE ACTIONS - STEP 1
    // Approved validation recipients are Admin-created setup records and can be deleted.
    window.adminDeleteEmailRecipientRecord = async (recipientId) => {
      await deleteAdminEmailRecipientRecord(recipientId);
    };
    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Expose user access setup edit action for the records table.
    window.adminEditProfileTenantLink = (profileId) => {
      startProfileTenantLinkEdit(profileId);
    };
    // ADMIN DELETE ACTIONS - STEP 1
    // This removes company access. It does not delete the Supabase Auth user.
    window.adminRemoveProfileTenantAccess = async (profileId) => {
      await removeProfileTenantAccess(profileId);
    };
    // ADMIN COMPLETE USER REMOVAL
    // Exposes the permanent-delete action. The actual privileged deletion
    // happens securely inside the delete-company-user Edge Function.
    window.adminPermanentlyDeleteCompanyUser = async (profileId) => {
      await permanentlyDeleteCompanyUser(profileId);
    };
    // ADMIN PASSWORD RESET
    // Expose reset password action for the user access records table.
    window.adminResetUserPassword = (profileId) => {
      openResetPasswordModal(profileId);
    };
    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
    // Expose HR MFA reset action for the user access records table.
    // This only opens the Admin confirmation modal; privileged reset happens
    // server-side through the reset-user-mfa Edge Function.
    window.adminResetUserMfa = (profileId) => {
      openResetMfaModal(profileId);
    };

    // HR TENANT ADMIN ACCESS - PHASE 2D
    // The browser only requests the change. The protected RPC performs the
    // Platform Admin authorization and writes the access level server-side.
    window.adminSetHrAccessLevel = async (
      profileId,
      targetAccessLevel,
      actionButton = null,
    ) => {
      await setHrAccessLevel(profileId, targetAccessLevel, actionButton);
    };

    // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
    // UI-only navigation inside the already authenticated Admin page.
    window.adminOpenCompanyIdentityWorkspace = () => {
      rememberAdminWorkspace("tenants");
      switchAdminWorkspace("tenants");
      openAdminCompanyIdentityPanel();
    };

    window.adminOpenEmailSetupWorkspace = () => {
      rememberAdminWorkspace("tenants");
      switchAdminWorkspace("tenants");
      openAdminEmailSetupPanel();
    };

    window.adminOpenUserAccessWorkspace = () => {
      rememberAdminWorkspace("tenants");
      switchAdminWorkspace("tenants");
      openAdminUserCompanyAssignmentPanel();
    };
  } catch (error) {
    // ADMIN WORKSPACE LOADER - v1.0.2
    // Reveal the existing Admin error state instead of leaving
    // the browser trapped behind the first-paint loader.
    releaseAdminWorkspaceLoader();
    console.error("Error initialising admin dashboard:", error);
    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the admin dashboard.",
    );
  }
});

// ADMIN UI CLEANUP - STEP 1D
// Reuse the existing profile image storage bucket already used by HR profile photos.
const PROFILE_IMAGES_BUCKET = "profile-images";

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Admin workspace tab for refresh recovery.
// No company, user access, password reset, or profile data is stored.
const ADMIN_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastAdminWorkspace";

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by admin-dashboard.html to avoid first-paint
// Profile flash before admin-dashboard.js completes authentication startup.
const ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastAdminWorkspace:last";

const state = {
  currentUser: null,
  currentProfile: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Holds tenant/company records created by Admin.
  tenants: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Tracks the tenant currently being edited.
  currentEditingTenant: null,
  // ADMIN RESET WORKSPACE - v1.0.0
  // Holds only the company currently selected for workspace reset.
  // The tenant/company and employee records themselves are preserved.
  currentResetWorkspaceTarget: null,
  // ADMIN EMAIL SETUP - STEP 1D
  // Admin-owned approved validation recipients and company-scoped email history.
  // HR Setup > Email Integration reads these tenant-scoped recipient records.
  adminEmailSetupRecipients: [],
  adminEmailSetupLogs: [],
  currentEditingAdminEmailRecipient: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Holds user profiles for Admin access setup.
  profilesForTenantLinking: [],

  // HR TENANT ADMIN ACCESS - PHASE 2D
  // Dedicated protected-RPC result used only to display and change the
  // standard / tenant_admin tier for HR Dashboard profiles.
  hrAccessProfiles: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Tracks the profile currently being edited for company access.
  currentEditingProfileTenantLink: null,

  // ADMIN UI CLEANUP - STEP 1D
  // Holds the Admin profile image selected in the browser before upload.
  pendingProfileImageFile: null,

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Stores the last clean Admin profile form values.
  // Save Profile Changes should stay grey until Admin changes an editable value.
  currentProfileEditableBaseline: null,

  // ADMIN UI CLEANUP - STEP 1H
  // Timer id for floating dashboard notification auto-hide.
  dashboardToastTimeoutId: null,

  // ADMIN REMOVE COMPANY ACCESS MODAL - v1.0.0
  // Holds only the profile selected for company-access removal.
  currentRemoveCompanyAccessTarget: null,

  // ADMIN FORCE DELETE USER MODAL - v1.0.0
  // Holds only the profile currently selected for permanent deletion.
  // The actual destructive operation remains inside delete-company-user.
  currentPermanentDeleteTarget: null,


  // ADMIN PASSWORD RESET
  // Holds the profile currently targeted for a password reset.

  currentResetTarget: null,

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
  // Holds the HR profile currently targeted for MFA reset.
  // The actual MFA factor deletion happens in the reset-user-mfa Edge Function.
  currentMfaResetTarget: null,

  dom: {},
};

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these Admin top-level workspaces are safe to restore after refresh.
function isValidAdminWorkspaceKey(workspace = "") {
  return ["profile", "overview", "tenants"].includes(
    String(workspace || "").trim(),
  );
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope workspace memory to the signed-in Admin user.
// Admin is platform-level, so tenant scoping is intentionally not used here.
function getAdminWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();

  return `${ADMIN_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}`;
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active Admin workspace key. Do not store company,
// user-access, password-reset, or profile form data in browser storage.
function rememberAdminWorkspace(workspace = "") {
  if (!isValidAdminWorkspaceKey(workspace)) return;

  try {
    sessionStorage.setItem(getAdminWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to admin-dashboard.js.
    sessionStorage.setItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Admin workspace memory could not be saved.", error);
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered Admin workspace for this browser session.
// Fresh login falls back to Overview after logout clears the keys.
function getRememberedAdminWorkspace() {
  try {
    const scopedWorkspace = sessionStorage.getItem(getAdminWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY);
    // ADMIN AUTHORITATIVE OVERVIEW LANDING - v1.0.0
    // A fresh Admin session opens the operational Overview.
    // A remembered workspace still wins during normal browser refresh.
    const workspace =
      scopedWorkspace ||
      bootWorkspace ||
      "overview";

    return isValidAdminWorkspaceKey(workspace)
      ? workspace
      : "overview";
  } catch (error) {
    console.warn("Admin workspace memory could not be read.", error);
    return "overview";
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout clears workspace memory so the next Admin session opens Overview.
function clearRememberedAdminWorkspace() {
  try {
    sessionStorage.removeItem(getAdminWorkspaceMemoryKey());
    sessionStorage.removeItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Admin workspace memory could not be cleared.", error);
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceAdminDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateBackToTopButtonVisibility();
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Admin workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long Admin pages.
function restoreAdminWorkspaceAfterRefresh() {
  const workspace = getRememberedAdminWorkspace();

  switchAdminWorkspace(workspace);
  forceAdminDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceAdminDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceAdminDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceAdminDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceAdminDashboardToTopAfterRefresh, 150);
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

    // ADMIN UI CLEANUP - STEP 1H
    // Floating Admin UX controls copied from the HR dashboard pattern.
    backToTopBtn: document.getElementById("backToTopBtn"),
    dashboardToast: document.getElementById("dashboardToast"),
    dashboardToastAccent: document.getElementById("dashboardToastAccent"),
    dashboardToastIcon: document.getElementById("dashboardToastIcon"),
    dashboardToastTitle: document.getElementById("dashboardToastTitle"),
    dashboardToastMessage: document.getElementById("dashboardToastMessage"),
    dashboardToastCloseBtn: document.getElementById("dashboardToastCloseBtn"),

    adminTabProfileBtn: document.getElementById("adminTabProfileBtn"),
    adminTabOverviewBtn: document.getElementById("adminTabOverviewBtn"),


    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Tenant workspace tab and section.
    adminTabTenantsBtn: document.getElementById("adminTabTenantsBtn"),

    adminProfileSection: document.getElementById("adminProfileSection"),
    adminOverviewSection: document.getElementById("adminOverviewSection"),

    adminTenantsSection: document.getElementById("adminTenantsSection"),

    // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
    // Presentation-only references for the three Companies operational areas.
    adminCompanyIdentityWorkspace: document.getElementById("adminCompanyIdentityWorkspace"),
    adminEmailSetupWorkspace: document.getElementById("adminEmailSetupWorkspace"),
    adminUserAccessWorkspace: document.getElementById("adminUserAccessWorkspace"),
    sidebarAdminCompanyIdentityBtn: document.getElementById("sidebarAdminCompanyIdentityBtn"),
    sidebarAdminEmailSetupBtn: document.getElementById("sidebarAdminEmailSetupBtn"),
    sidebarAdminUserAccessBtn: document.getElementById("sidebarAdminUserAccessBtn"),

    // ADMIN UI CLEANUP - STEP 1I
    // Collapse controls for long Admin Company Setup panels.
    toggleAdminCompanyIdentityCardBtn: document.getElementById("toggleAdminCompanyIdentityCardBtn"),
    adminCompanyIdentityCollapse: document.getElementById("adminCompanyIdentityCollapse"),
    // ADMIN USER ACCESS COLLAPSE CONTROL - v1.0.2
    // Controls only the operational User Access cards beneath the persistent header.
    toggleAdminUserCompanyAssignmentCardBtn: document.getElementById(
      "toggleAdminUserCompanyAssignmentCardBtn",
    ),
    adminUserCompanyAssignmentCollapse: document.getElementById("adminUserCompanyAssignmentCollapse"),

    adminInitials: document.getElementById("adminInitials"),

    // ADMIN UI CLEANUP - STEP 1D
    // Hero profile image used when Admin uploads a profile photo.
    adminHeroImage: document.getElementById("adminHeroImage"),

    adminEmail: document.getElementById("adminEmail"),
    adminRole: document.getElementById("adminRole"),
    adminModuleValue: document.getElementById("adminModuleValue"),

    adminFullName: document.getElementById("adminFullName"),
    adminEmailTile: document.getElementById("adminEmailTile"),
    adminRoleTile: document.getElementById("adminRoleTile"),
    adminDepartment: document.getElementById("adminDepartment"),

    // ADMIN UI CLEANUP - STEP 1E
    // Admin Overview summary values are calculated from already-loaded
    // company and user/company assignment data.
    adminOverviewCompanyCount: document.getElementById("adminOverviewCompanyCount"),
    adminOverviewActiveCompanyCount: document.getElementById("adminOverviewActiveCompanyCount"),
    adminOverviewLinkedUserCount: document.getElementById("adminOverviewLinkedUserCount"),
    adminOverviewUnlinkedUserCount: document.getElementById("adminOverviewUnlinkedUserCount"),

    // ADMIN UI CLEANUP - STEP 1G
    // Access-health panel shown on the Admin Overview tab.
    adminOverviewAccessHealthPanel: document.getElementById("adminOverviewAccessHealthPanel"),
    adminOverviewAccessHealthTitle: document.getElementById("adminOverviewAccessHealthTitle"),
    adminOverviewAccessHealthMessage: document.getElementById("adminOverviewAccessHealthMessage"),

    adminProfileAvatar: document.getElementById("adminProfileAvatar"),
    adminProfileCardName: document.getElementById("adminProfileCardName"),
    adminProfileCardEmail: document.getElementById("adminProfileCardEmail"),

    // ADMIN UI CLEANUP - STEP 1D
    // Admin profile image upload controls.
    adminProfileImageInput: document.getElementById("adminProfileImageInput"),
    adminProfileImagePreview: document.getElementById("adminProfileImagePreview"),
    saveAdminProfileImageBtn: document.getElementById("saveAdminProfileImageBtn"),

    // ADMIN PROFILE PHOTO PARITY - REMOVE PICTURE
    // Enabled only when the signed-in Admin has a saved profile image.
    removeAdminProfileImageBtn: document.getElementById("removeAdminProfileImageBtn"),

    adminProfileForm: document.getElementById("adminProfileForm"),
    adminProfileFullName: document.getElementById("adminProfileFullName"),
    adminProfileEmail: document.getElementById("adminProfileEmail"),
    adminProfileRole: document.getElementById("adminProfileRole"),
    adminProfileDepartment: document.getElementById("adminProfileDepartment"),
    saveAdminProfileBtn: document.getElementById("saveAdminProfileBtn"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Tenant / Company setup form and records table.
    tenantCreateForm: document.getElementById("tenantCreateForm"),
    editingTenantId: document.getElementById("editingTenantId"),
    tenantCompanyName: document.getElementById("tenantCompanyName"),
    tenantCode: document.getElementById("tenantCode"),
    tenantStatus: document.getElementById("tenantStatus"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
    // Notes was removed from the first tenant setup UI to keep the feature lean.
    saveTenantBtn: document.getElementById("saveTenantBtn"),
    saveTenantBtnText: document.getElementById("saveTenantBtnText"),
    cancelTenantEditBtn: document.getElementById("cancelTenantEditBtn"),
    refreshTenantsBtn: document.getElementById("refreshTenantsBtn"),
    tenantRecordsHeader: document.getElementById("tenantRecordsHeader"),
    tenantRecordsEmptyState: document.getElementById("tenantRecordsEmptyState"),
    tenantRecordsTableWrapper: document.getElementById("tenantRecordsTableWrapper"),
    tenantRecordsTableBody: document.getElementById("tenantRecordsTableBody"),
    // ADMIN RESET WORKSPACE MODAL - v1.0.0
    // Two-stage controlled confirmation for tenant operational reset.
    resetWorkspaceModal: document.getElementById("resetWorkspaceModal"),
    resetWorkspaceStageOne: document.getElementById("resetWorkspaceStageOne"),
    resetWorkspaceStageTwo: document.getElementById("resetWorkspaceStageTwo"),
    resetWorkspaceTargetName: document.getElementById("resetWorkspaceTargetName"),
    resetWorkspaceTargetCode: document.getElementById("resetWorkspaceTargetCode"),
    resetWorkspaceFinalName: document.getElementById("resetWorkspaceFinalName"),
    resetWorkspaceFinalCode: document.getElementById("resetWorkspaceFinalCode"),
    resetWorkspaceConfirmationInput: document.getElementById("resetWorkspaceConfirmationInput"),
    resetWorkspaceAlert: document.getElementById("resetWorkspaceAlert"),
    resetWorkspaceBackBtn: document.getElementById("resetWorkspaceBackBtn"),
    resetWorkspaceContinueBtn: document.getElementById("resetWorkspaceContinueBtn"),
    resetWorkspaceConfirmBtn: document.getElementById("resetWorkspaceConfirmBtn"),
    // ADMIN EMAIL SETUP - STEP 1D
    // Admin controls company-scoped validation recipients used by HR Email Integration.
    toggleAdminEmailSetupCardBtn: document.getElementById("toggleAdminEmailSetupCardBtn"),
    adminEmailSetupCollapse: document.getElementById("adminEmailSetupCollapse"),
    adminEmailRecipientCountValue: document.getElementById("adminEmailRecipientCountValue"),
    adminEmailActiveRecipientCountValue: document.getElementById("adminEmailActiveRecipientCountValue"),
    adminEmailDeliveryLogCountValue: document.getElementById("adminEmailDeliveryLogCountValue"),
    adminEmailLastResultValue: document.getElementById("adminEmailLastResultValue"),
    adminEmailRecipientForm: document.getElementById("adminEmailRecipientForm"),
    editingAdminEmailRecipientId: document.getElementById("editingAdminEmailRecipientId"),
    adminEmailSetupCompanyId: document.getElementById("adminEmailSetupCompanyId"),
    adminEmailRecipientDisplayName: document.getElementById("adminEmailRecipientDisplayName"),
    adminEmailRecipientEmail: document.getElementById("adminEmailRecipientEmail"),
    adminEmailRecipientStatus: document.getElementById("adminEmailRecipientStatus"),
    saveAdminEmailRecipientBtn: document.getElementById("saveAdminEmailRecipientBtn"),
    saveAdminEmailRecipientBtnText: document.getElementById("saveAdminEmailRecipientBtnText"),
    cancelAdminEmailRecipientEditBtn: document.getElementById("cancelAdminEmailRecipientEditBtn"),
    refreshAdminEmailSetupBtn: document.getElementById("refreshAdminEmailSetupBtn"),
    clearAdminEmailHistoryBtn: document.getElementById("clearAdminEmailHistoryBtn"),
    adminEmailRecipientsHeader: document.getElementById("adminEmailRecipientsHeader"),
    adminEmailRecipientsEmptyState: document.getElementById("adminEmailRecipientsEmptyState"),
    adminEmailRecipientsTableWrapper: document.getElementById("adminEmailRecipientsTableWrapper"),
    adminEmailRecipientsTableBody: document.getElementById("adminEmailRecipientsTableBody"),
    adminEmailDeliveryLogsEmptyState: document.getElementById("adminEmailDeliveryLogsEmptyState"),
    adminEmailDeliveryLogsTableWrapper: document.getElementById("adminEmailDeliveryLogsTableWrapper"),
    adminEmailDeliveryLogsTableBody: document.getElementById("adminEmailDeliveryLogsTableBody"),

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Platform Admin invites a company-scoped HR/payroll/manager/employee user
    // into a selected company workspace through the secure invite-company-user
    // Edge Function. This does not create employee records.
    companyUserInviteForm: document.getElementById("companyUserInviteForm"),
    companyUserFullName: document.getElementById("companyUserFullName"),
    companyUserEmail: document.getElementById("companyUserEmail"),
    companyUserRole: document.getElementById("companyUserRole"),
    companyUserTenantId: document.getElementById("companyUserTenantId"),
    companyUserDepartment: document.getElementById("companyUserDepartment"),
    companyUserInviteAlert: document.getElementById("companyUserInviteAlert"),
    inviteCompanyUserBtn: document.getElementById("inviteCompanyUserBtn"),
    inviteCompanyUserBtnText: document.getElementById("inviteCompanyUserBtnText"),
    clearCompanyUserInviteBtn: document.getElementById("clearCompanyUserInviteBtn"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // User access setup controls.
    profileTenantLinkForm: document.getElementById("profileTenantLinkForm"),
    editingProfileTenantLinkProfileId: document.getElementById("editingProfileTenantLinkProfileId"),
    profileTenantProfileId: document.getElementById("profileTenantProfileId"),
    profileTenantTenantId: document.getElementById("profileTenantTenantId"),
    saveProfileTenantLinkBtn: document.getElementById("saveProfileTenantLinkBtn"),
    saveProfileTenantLinkBtnText: document.getElementById("saveProfileTenantLinkBtnText"),
    cancelProfileTenantLinkEditBtn: document.getElementById("cancelProfileTenantLinkEditBtn"),
    refreshProfileTenantLinksBtn: document.getElementById("refreshProfileTenantLinksBtn"),
    profileTenantLinksHeader: document.getElementById("profileTenantLinksHeader"),
    profileTenantLinksEmptyState: document.getElementById("profileTenantLinksEmptyState"),
    profileTenantLinksTableWrapper: document.getElementById("profileTenantLinksTableWrapper"),
    profileTenantLinksTableBody: document.getElementById("profileTenantLinksTableBody"),

    // ADMIN REMOVE COMPANY ACCESS MODAL - v1.0.0
    // Controlled replacement for the old browser confirm dialog.
    // The existing protected RPC remains the authoritative removal path.
    removeCompanyAccessModal: document.getElementById("removeCompanyAccessModal"),
    removeCompanyAccessTargetName: document.getElementById("removeCompanyAccessTargetName"),
    removeCompanyAccessTargetEmail: document.getElementById("removeCompanyAccessTargetEmail"),
    removeCompanyAccessTargetCompany: document.getElementById("removeCompanyAccessTargetCompany"),
    removeCompanyAccessAlert: document.getElementById("removeCompanyAccessAlert"),
    removeCompanyAccessConfirmBtn: document.getElementById("removeCompanyAccessConfirmBtn"),

    // ADMIN FORCE DELETE USER MODAL - v1.0.0
    // Controlled two-stage replacement for the old browser prompt/confirm flow.
    permanentDeleteUserModal: document.getElementById("permanentDeleteUserModal"),
    permanentDeleteUserStageOne: document.getElementById("permanentDeleteUserStageOne"),
    permanentDeleteUserStageTwo: document.getElementById("permanentDeleteUserStageTwo"),
    permanentDeleteUserTargetName: document.getElementById("permanentDeleteUserTargetName"),
    permanentDeleteUserTargetEmail: document.getElementById("permanentDeleteUserTargetEmail"),
    permanentDeleteUserFinalName: document.getElementById("permanentDeleteUserFinalName"),
    permanentDeleteUserFinalEmail: document.getElementById("permanentDeleteUserFinalEmail"),
    permanentDeleteUserEmailInput: document.getElementById("permanentDeleteUserEmailInput"),
    permanentDeleteUserAlert: document.getElementById("permanentDeleteUserAlert"),
    permanentDeleteUserBackBtn: document.getElementById("permanentDeleteUserBackBtn"),
    permanentDeleteUserContinueBtn: document.getElementById("permanentDeleteUserContinueBtn"),
    permanentDeleteUserConfirmBtn: document.getElementById("permanentDeleteUserConfirmBtn"),


    // ADMIN PASSWORD RESET
    // Modal controls for the admin-initiated temporary password flow.
    resetPasswordModal: document.getElementById("resetPasswordModal"),
    resetPasswordTargetName: document.getElementById("resetPasswordTargetName"),
    resetPasswordTargetEmail: document.getElementById("resetPasswordTargetEmail"),
    resetPasswordTempInput: document.getElementById("resetPasswordTempInput"),
    resetPasswordToggleBtn: document.getElementById("resetPasswordToggleBtn"),
    resetPasswordToggleIcon: document.getElementById("resetPasswordToggleIcon"),
    resetPasswordSubmitBtn: document.getElementById("resetPasswordSubmitBtn"),
    resetPasswordAlert: document.getElementById("resetPasswordAlert"),

    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
    // Admin HR MFA reset modal controls.
    resetMfaModal: document.getElementById("resetMfaModal"),
    resetMfaTargetName: document.getElementById("resetMfaTargetName"),
    resetMfaTargetEmail: document.getElementById("resetMfaTargetEmail"),
    resetMfaTargetRole: document.getElementById("resetMfaTargetRole"),
    resetMfaConfirmCheckbox: document.getElementById("resetMfaConfirmCheckbox"),
    resetMfaSubmitBtn: document.getElementById("resetMfaSubmitBtn"),
    resetMfaAlert: document.getElementById("resetMfaAlert"),
  };
}

function setAdminActionButtonLoading(button, isLoading, loadingText = "Working...") {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    if (!button.dataset.originalClass) {
      button.dataset.originalClass = button.className;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
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

  button.disabled = false;
  button.className = button.dataset.originalClass || "btn btn-outline-primary dashboard-action-btn";
  delete button.dataset.originalClass;
}

function updateBackToTopButtonVisibility() {
  const button = state.dom.backToTopBtn;
  if (!button) return;

  // ADMIN UI CLEANUP - STEP 1H
  // Show the shortcut only after Admin has scrolled down.
  const shouldShow = window.scrollY > 420;
  button.classList.toggle("d-none", !shouldShow);
}

function scrollDashboardBackToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function hideDashboardToast() {
  state.dom.dashboardToast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

function showDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = state.dom.dashboardToast;
  if (!toast) return;

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

  if (state.dom.dashboardToastAccent) {
    state.dom.dashboardToastAccent.className = theme.accentClass;
    state.dom.dashboardToastAccent.style.height = "4px";
  }

  if (state.dom.dashboardToastIcon) {
    state.dom.dashboardToastIcon.className =
      `rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 ${theme.iconClass}`;
    state.dom.dashboardToastIcon.style.width = "36px";
    state.dom.dashboardToastIcon.style.height = "36px";
    state.dom.dashboardToastIcon.innerHTML = theme.iconHtml;
  }

  if (state.dom.dashboardToastTitle) {
    state.dom.dashboardToastTitle.textContent = title;
  }

  if (state.dom.dashboardToastMessage) {
    state.dom.dashboardToastMessage.textContent = message || "";
  }

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideDashboardToast();
  }, 8000);
}

function bindAdminCardCollapseToggle(button, panel) {
  if (!button || !panel) return;

  button.addEventListener("click", () => {
    const isNowHidden = panel.classList.toggle("d-none");
    button.setAttribute("aria-expanded", String(!isNowHidden));

    const icon = button.querySelector("i");
    const label = button.querySelector("span");

    if (icon) {
      icon.className = isNowHidden
        ? "bi bi-chevron-down me-2"
        : "bi bi-chevron-up me-2";
    }

    if (label) {
      label.textContent = isNowHidden ? "Expand" : "Collapse";
    }
  });

  // ADMIN COMPANY IDENTITY COLLAPSE RECOVERY - v1.0.0
  // Company Identity now uses its authoritative custom card shell instead
  // of the old Bootstrap .border wrapper.
  //
  // Keep .border as the fallback so Email Setup and User Access retain their
  // existing double-click behaviour until their own visual refreshes are done.
  const card = button.closest(
    ".admin-company-identity-card, .border",
  );

  if (!card) return;

  // ADMIN UI CLEANUP - STEP 1K RECOVERY
  // Double-clicking a card closes it, but form controls and tables must not
  // accidentally collapse while Admin is editing or selecting records.
  card.addEventListener("dblclick", (event) => {
    const interactiveTarget = event.target.closest(
      "input, select, textarea, button, a, label, table",
    );

    if (interactiveTarget) return;

    const isExpanded = !panel.classList.contains("d-none");

    if (isExpanded) {
      setAdminDashboardCardExpanded(button, panel, false);
    }
  });
}

function setAdminDashboardCardExpanded(button, panel, shouldExpand) {
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

// =========================================================
// ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
//
// Presentation only.
// Authentication remains at admin-dashboard.html through protectPage("admin").
// Existing Company, Email and User Access workflows remain unchanged.
// =========================================================
function switchAdminCompaniesSubWorkspace(subWorkspace = "identity") {
  const validWorkspace = ["identity", "email", "access"].includes(
    String(subWorkspace || "").trim(),
  )
    ? String(subWorkspace || "").trim()
    : "identity";

  const workspaceMap = {
    identity: {
      panel: state.dom.adminCompanyIdentityWorkspace,
      button: state.dom.sidebarAdminCompanyIdentityBtn,
    },
    email: {
      panel: state.dom.adminEmailSetupWorkspace,
      button: state.dom.sidebarAdminEmailSetupBtn,
    },
    access: {
      panel: state.dom.adminUserAccessWorkspace,
      button: state.dom.sidebarAdminUserAccessBtn,
    },
  };

  Object.entries(workspaceMap).forEach(([key, config]) => {
    const isActive = key === validWorkspace;

    config.panel?.classList.toggle("d-none", !isActive);
    config.button?.classList.toggle("active", isActive);

    if (config.button) {
      config.button.setAttribute("aria-current", isActive ? "page" : "false");
    }
  });
}
function openAdminCompanyIdentityPanel() {
  // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
  switchAdminCompaniesSubWorkspace("identity");

  setAdminDashboardCardExpanded(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    true,
  );
}

function openAdminCompanyRecordsPanel() {
  // ADMIN UI CLEANUP - STEP 1K RECOVERY
  // Company Records now live inside the main Company Setup card,
  // so opening records means opening the Company Setup collapse panel.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    true,
  );
}

function openAdminUserCompanyAssignmentPanel() {
  // ADMIN USER ACCESS COLLAPSE CONTROL - v1.0.2
  // Opening User Access must expose the operational cards.
  switchAdminCompaniesSubWorkspace("access");

  setAdminDashboardCardExpanded(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
    true,
  );
}

function collapseAdminDashboardWorkingCardsByDefault() {
  // ADMIN COMPANIES DEFAULT CARD STATE - v1.0.0
  //
  // Operational setup cards should be immediately available when Admin
  // opens their workspace. Only the potentially long User Access Records
  // history starts collapsed to keep the initial page focused.
  // User Access working area starts open so Invite Company User and
  // Reassign Existing User are immediately available.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
    true,
  );

  // Email Setup starts open when its sub-workspace is selected.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    true,
  );
}

function scrollToAdminDashboardTarget(target, offset = 96) {
  if (!target) return;

  const targetTop =
    target.getBoundingClientRect().top + window.pageYOffset - offset;

  window.scrollTo({
    top: Math.max(targetTop, 0),
    behavior: "smooth",
  });
}

function redirectToAdminCompanyRecordsAfterSave() {
  // ADMIN UI CLEANUP - STEP 1J
  // After company create/update, open the records panel and land on the
  // Company Records header without cutting it off.
  // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
  // Programmatic navigation to Companies should also survive refresh.
  rememberAdminWorkspace("tenants");
  switchAdminWorkspace("tenants");
  openAdminCompanyRecordsPanel();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      openAdminCompanyRecordsPanel();

      // ADMIN UI CLEANUP - STEP 1L
      // Company Records now lives inside the Company Identity card.
      // Removed stale adminCompanyRecordsCollapse fallback.
      scrollToAdminDashboardTarget(
        state.dom.tenantRecordsHeader ||
        state.dom.tenantRecordsTableWrapper ||
        state.dom.adminCompanyIdentityCollapse,
        96,
      );
    });
  });
}

function scrollToAdminOpenedPanel(button, panel, offset = 150) {
  // ADMIN UI CLEANUP - STEP 1K
  // Scroll to the full card/panel wrapper so the panel header is visible
  // instead of landing halfway inside the form.
  const target =
    button?.closest(".border") ||
    panel ||
    button;

  if (!target) return;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollToAdminDashboardTarget(target, offset);
    });
  });
}

function focusAdminFieldWithoutJump(field) {
  // ADMIN UI CLEANUP - STEP 1K
  // Focus the editable field without allowing browser focus to override
  // our clean panel-level scroll position.
  if (!field) return;

  try {
    field.focus({ preventScroll: true });
  } catch (error) {
    field.focus();
  }
}

function redirectToAdminUserCompanyLinksAfterSave() {
  // ADMIN UI CLEANUP - STEP 1J
  // After user/company link save, open the assignment panel and land on
  // User Company Links without cutting the header.
  // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
  // Programmatic navigation to Companies should also survive refresh.
  rememberAdminWorkspace("tenants");
  switchAdminWorkspace("tenants");
  openAdminUserCompanyAssignmentPanel();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      openAdminUserCompanyAssignmentPanel();

      scrollToAdminDashboardTarget(
        state.dom.profileTenantLinksHeader ||
        state.dom.profileTenantLinksTableWrapper ||
        state.dom.adminUserCompanyAssignmentCollapse,
        96,
      );
    });
  });
}

function bindEvents() {
  state.dom.logoutBtn?.addEventListener("click", async () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Logout must reset the next Admin session to Profile.
    clearRememberedAdminWorkspace();

    await window.SessionManager.logoutUser("logout");
  });

  // ADMIN UI CLEANUP - STEP 1H
  // Back to Top and floating notification close behaviour.
  state.dom.backToTopBtn?.addEventListener("click", () => {
    scrollDashboardBackToTop();
  });

  // ADMIN UI CLEANUP - STEP 1I
  // Bind collapse controls for long Admin Company Setup panels.
  bindAdminCardCollapseToggle(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
  );

  // ADMIN USER ACCESS COLLAPSE CONTROL - v1.0.2
  // Keep standard Expand/Collapse behaviour while the header card stays visible.
  bindAdminCardCollapseToggle(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
  );

  // ADMIN EMAIL SETUP - STEP 1D
  // Email Setup follows the same Admin collapse behaviour as Company Identity
  // and User Access Setup.
  bindAdminCardCollapseToggle(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
  );

  collapseAdminDashboardWorkingCardsByDefault();
  // ADMIN HELP GUIDE ROLE PARITY - v1.1.1
  // Guide links proxy to the existing Admin navigation controls.
  // No duplicate workspace or backend logic is introduced.
  document
    .getElementById("adminOperatingGuideModal")
    ?.addEventListener("click", (event) => {
      const route =
        event.target.closest("[data-admin-guide-target]");

      if (!route) return;

      const targetId = String(
        route.dataset.adminGuideTarget || "",
      ).trim();

      if (!targetId) return;

      const targetButton =
        document.getElementById(targetId);

      if (!targetButton) return;

      const modalElement =
        document.getElementById("adminOperatingGuideModal");

      const modalInstance =
        window.bootstrap?.Modal?.getInstance(modalElement);

      if (modalInstance && modalElement) {
        modalElement.addEventListener(
          "hidden.bs.modal",
          () => {
            targetButton.click();
          },
          { once: true },
        );

        modalInstance.hide();
        return;
      }

      targetButton.click();
    });
  // END ADMIN HELP GUIDE ROLE PARITY - v1.1.1

  state.dom.dashboardToastCloseBtn?.addEventListener("click", () => {
    hideDashboardToast();
  });

  window.addEventListener("scroll", updateBackToTopButtonVisibility);
  updateBackToTopButtonVisibility();

  state.dom.adminTabProfileBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberAdminWorkspace("profile");
    switchAdminWorkspace("profile");
  });

  state.dom.adminTabOverviewBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Overview only for refresh. No overview data is stored.
    rememberAdminWorkspace("overview");
    switchAdminWorkspace("overview");
  });

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Open tenant/company setup workspace.
  state.dom.adminTabTenantsBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Companies only for refresh. No company or user-access data is stored.
    rememberAdminWorkspace("tenants");
    switchAdminWorkspace("tenants");

    // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
    // Opening Companies directly starts from Company Identity.
    switchAdminCompaniesSubWorkspace("identity");
  });


  // =========================================================
  // ADMIN OVERVIEW OPERATIONAL NAVIGATION - v1.0.1
  //
  // Every Overview action lands on the operational area
  // responsible for that metric.
  //
  // Existing helpers continue to control:
  // - workspace memory;
  // - Companies workspace switching;
  // - panel expansion;
  // - exact scroll destination.
  // =========================================================

  // Access readiness -> User Access Records.
  state.dom.adminOverviewOpenCompaniesBtn?.addEventListener(
    "click",
    () => {
      redirectToAdminUserCompanyLinksAfterSave();
    },
  );

  // =========================================================
  // ADMIN ACTION CENTRE - v1.0.0
  // Reuse existing operational navigation helpers.
  // =========================================================

  // Company status / company management.
  [
    "adminOverviewInactiveCompaniesAction",
    "adminOverviewManageCompaniesAction",
  ].forEach((actionId) => {
    document
      .getElementById(actionId)
      ?.addEventListener("click", () => {
        redirectToAdminCompanyRecordsAfterSave();
      });
  });


  // User access exceptions / access management.
  [
    "adminOverviewCompaniesWithoutUsersAction",
    "adminOverviewUnlinkedAccessAction",
    "adminOverviewManageAccessAction",
  ].forEach((actionId) => {
    document
      .getElementById(actionId)
      ?.addEventListener("click", () => {
        redirectToAdminUserCompanyLinksAfterSave();
      });
  });


  // Email Setup.
  document
    .getElementById("adminOverviewManageEmailAction")
    ?.addEventListener("click", () => {
      rememberAdminWorkspace("tenants");
      switchAdminWorkspace("tenants");

      openAdminEmailSetupPanel();

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          openAdminEmailSetupPanel();

          scrollToAdminOpenedPanel(
            state.dom.toggleAdminEmailSetupCardBtn,
            state.dom.adminEmailSetupCollapse,
            150,
          );
        });
      });
    });

  // EXISTING COMPANY CREATE / UPDATE WORKFLOW
  // Restored after the Overview navigation block.
  // Do not change the existing saveTenantRecord() workflow.
  state.dom.tenantCreateForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      await saveTenantRecord();
    },
  );

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
  // Only the required tenant setup fields control save readiness.
  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
  // Reset only the fields still used by the lean tenant setup form.
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
  ].forEach((field) => {
    field?.addEventListener("input", updateTenantSaveButtonState);
    field?.addEventListener("change", updateTenantSaveButtonState);
  });

  state.dom.cancelTenantEditBtn?.addEventListener("click", () => {
    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // Cancel should only exit edit mode. Successful save handles redirect-to-records.
    resetTenantForm();
    showPageAlert("info", "Company edit was cancelled.");
  });

  state.dom.refreshTenantsBtn?.addEventListener("click", async () => {
    // ADMIN UI CLEANUP - STEP 1F
    // Give Admin visible feedback while company records reload.
    // Existing refresh logic is unchanged.
    try {
      setAdminActionButtonLoading(
        state.dom.refreshTenantsBtn,
        true,
        "Refreshing Companies...",
      );

      await refreshTenantWorkspace();

      // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
      // Keep the tenant assignment dropdown current after tenant refresh.
      populateProfileTenantTenantOptions();

      // ADMIN EMAIL SETUP - STEP 1D
      // Keep Email Setup company selector and records current after company refresh.
      populateAdminEmailSetupCompanyOptions();
      await refreshAdminEmailSetupWorkspace({ preserveCompany: true });
    } finally {
      setAdminActionButtonLoading(state.dom.refreshTenantsBtn, false);
    }
  });

  // =========================================================
  // ADMIN RESET WORKSPACE MODAL - v1.0.0
  //
  // Controlled two-stage destructive confirmation.
  //
  // Stage 1:
  //   Admin must type the selected company name.
  //
  // Stage 2:
  //   Admin explicitly confirms the irreversible workspace reset.
  //
  // The secure admin_reset_tenant_workspace RPC remains the
  // authoritative destructive boundary.
  // =========================================================

  ["input", "keyup", "change"].forEach((eventName) => {
    state.dom.resetWorkspaceConfirmationInput?.addEventListener(
      eventName,
      () => {
        updateResetWorkspaceContinueButtonState();
        clearResetWorkspaceAlert();
      },
    );
  });

  state.dom.resetWorkspaceContinueBtn?.addEventListener(
    "click",
    () => {
      advanceResetWorkspaceModal();
    },
  );

  state.dom.resetWorkspaceBackBtn?.addEventListener(
    "click",
    () => {
      const isOnFinalStage =
        !state.dom.resetWorkspaceStageTwo?.classList.contains(
          "d-none",
        );

      if (isOnFinalStage) {
        showResetWorkspaceStageOne();
        return;
      }

      const modalEl =
        state.dom.resetWorkspaceModal;

      if (modalEl) {
        bootstrap.Modal
          .getOrCreateInstance(modalEl)
          .hide();
      }
    },
  );

  state.dom.resetWorkspaceConfirmBtn?.addEventListener(
    "click",
    async () => {
      await submitResetWorkspace();
    },
  );

  state.dom.resetWorkspaceModal?.addEventListener(
    "hidden.bs.modal",
    () => {
      clearResetWorkspaceModal();
    },
  );

  // ADMIN EMAIL SETUP - STEP 1D-2
  // Bind Email Setup directly during page startup.
  // This must not sit inside the company-user invite submit handler,
  // otherwise the Add Approved Recipient button will never turn blue
  // until an unrelated invite form is submitted.
  state.dom.adminEmailRecipientForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAdminEmailRecipient();
  });

  [
    state.dom.adminEmailSetupCompanyId,
    state.dom.adminEmailRecipientDisplayName,
    state.dom.adminEmailRecipientEmail,
    state.dom.adminEmailRecipientStatus,
  ].forEach((field) => {
    field?.addEventListener("input", updateAdminEmailRecipientSaveButtonState);
    field?.addEventListener("keyup", updateAdminEmailRecipientSaveButtonState);
    field?.addEventListener("blur", updateAdminEmailRecipientSaveButtonState);

    field?.addEventListener("change", async () => {
      updateAdminEmailRecipientSaveButtonState();

      if (field === state.dom.adminEmailSetupCompanyId) {
        await refreshAdminEmailSetupWorkspace({ preserveCompany: true });
        updateAdminEmailRecipientSaveButtonState();
      }
    });
  });

  state.dom.cancelAdminEmailRecipientEditBtn?.addEventListener("click", () => {
    resetAdminEmailRecipientForm({ preserveCompany: true });
    showPageAlert("info", "Approved validation recipient edit was cancelled.");
  });

  state.dom.refreshAdminEmailSetupBtn?.addEventListener("click", async () => {
    await refreshAdminEmailSetupWorkspace({
      showAlert: true,
      preserveCompany: true,
    });
  });

  // ADMIN DELETE ACTIONS - CLEAR VALIDATION HISTORY
  // Clears only the selected company's email validation logs.
  // Approved recipients remain untouched.
  state.dom.clearAdminEmailHistoryBtn?.addEventListener("click", async () => {
    await clearAdminEmailValidationHistory();
  });

  window.requestAnimationFrame(() => {
    updateAdminEmailRecipientSaveButtonState();
  });

  // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
  // Invite a company-scoped user directly from Admin.
  // This is for first HR/payroll/company access setup after a company is created.
  state.dom.companyUserInviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await inviteCompanyUser();
  });

  [
    state.dom.companyUserFullName,
    state.dom.companyUserEmail,
    state.dom.companyUserRole,
    state.dom.companyUserTenantId,
    state.dom.companyUserDepartment,
  ].forEach((field) => {
    field?.addEventListener("input", updateCompanyUserInviteButtonState);
    field?.addEventListener("change", updateCompanyUserInviteButtonState);
  });

  // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
  // When the company selection changes, reload the department dropdown
  // from that company's controlled organization_departments list.
  state.dom.companyUserTenantId?.addEventListener("change", () => {
    populateCompanyUserDepartmentOptions();
  });

  state.dom.clearCompanyUserInviteBtn?.addEventListener("click", () => {
    resetCompanyUserInviteForm();
    showCompanyUserInviteAlert("info", "Company user invite form cleared.");
  });

  state.dom.profileTenantLinkForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveProfileTenantLink();
  });

  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    field?.addEventListener("input", updateProfileTenantLinkSaveButtonState);
    field?.addEventListener("change", updateProfileTenantLinkSaveButtonState);
  });

  state.dom.cancelProfileTenantLinkEditBtn?.addEventListener("click", () => {
    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // Cancel should only exit edit mode. Successful save handles redirect-to-records.
    resetProfileTenantLinkForm();
    showPageAlert("info", "User access setup edit was cancelled.");
  });

  state.dom.refreshProfileTenantLinksBtn?.addEventListener("click", async () => {
    // ADMIN UI CLEANUP - STEP 1F
    // Give Admin visible feedback while user/company links reload.
    // Existing profile-link refresh logic is unchanged.
    try {
      setAdminActionButtonLoading(
        state.dom.refreshProfileTenantLinksBtn,
        true,
        "Refreshing Access Records...",
      );

      await refreshProfileTenantLinkingWorkspace();
    } finally {
      setAdminActionButtonLoading(state.dom.refreshProfileTenantLinksBtn, false);
    }
  });

  // =========================================================
  // ADMIN REMOVE COMPANY ACCESS MODAL - v1.0.0
  //
  // Replaces only the old window.confirm() presentation.
  // The protected admin_remove_profile_tenant_access RPC is unchanged.
  // =========================================================
  state.dom.removeCompanyAccessConfirmBtn?.addEventListener(
    "click",
    async () => {
      await submitRemoveProfileTenantAccess();
    },
  );

  state.dom.removeCompanyAccessModal?.addEventListener(
    "hidden.bs.modal",
    () => {
      clearRemoveCompanyAccessModal();
    },
  );


  // =========================================================
  // ADMIN FORCE DELETE USER MODAL - v1.0.0
  //
  // Two-stage destructive confirmation:
  // 1. Admin types the selected user's full email.
  // 2. Admin explicitly confirms permanent deletion.
  //
  // The secure Edge Function remains the authoritative delete boundary.
  // =========================================================
  // ADMIN FORCE DELETE USER MODAL - INPUT STATE RECOVERY
  // Re-evaluate confirmation on typing, paste, autofill and field change.
  ["input", "keyup", "change"].forEach((eventName) => {
    state.dom.permanentDeleteUserEmailInput?.addEventListener(
      eventName,
      () => {
        updatePermanentDeleteUserContinueButtonState();
        clearPermanentDeleteUserAlert();
      },
    );
  });
  state.dom.permanentDeleteUserContinueBtn?.addEventListener("click", () => {
    advancePermanentDeleteUserModal();
  });

  state.dom.permanentDeleteUserBackBtn?.addEventListener("click", () => {
    const isOnFinalStage =
      !state.dom.permanentDeleteUserStageTwo?.classList.contains("d-none");

    if (isOnFinalStage) {
      showPermanentDeleteUserStageOne();
      return;
    }

    const modalEl = state.dom.permanentDeleteUserModal;

    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
  });

  state.dom.permanentDeleteUserConfirmBtn?.addEventListener("click", async () => {
    await submitPermanentDeleteCompanyUser();
  });

  state.dom.permanentDeleteUserModal?.addEventListener("hidden.bs.modal", () => {
    clearPermanentDeleteUserModal();
  });

  state.dom.adminProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAdminOwnProfile();
  });

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Keep Save Profile Changes grey until Admin edits the editable profile fields.
  // Department is read-only (set at account creation) and excluded.
  [
    state.dom.adminProfileFullName,
  ].forEach((field) => {
    field?.addEventListener("input", updateAdminProfileSaveButtonState);
    field?.addEventListener("change", updateAdminProfileSaveButtonState);
  });

  // ADMIN UI CLEANUP - STEP 1D
  // Match HR profile photo behaviour: validate on file selection, then upload on button click.
  state.dom.adminProfileImageInput?.addEventListener("change", (event) => {
    handlePendingAdminProfileImage(event.target.files?.[0] || null);
  });

  state.dom.saveAdminProfileImageBtn?.addEventListener("click", async () => {
    await saveAdminProfileImage();
  });

  // ADMIN PROFILE PHOTO PARITY - REMOVE PICTURE
  // Remove only the current Admin's own saved profile image.
  state.dom.removeAdminProfileImageBtn?.addEventListener("click", async () => {
    await removeAdminProfileImage();
  });

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Start the upload button greyed out until a valid file is selected.
  updateAdminProfileImageSaveButtonState();

  // ADMIN PASSWORD RESET - modal event bindings.
  state.dom.resetPasswordTempInput?.addEventListener("input", () => {
    updateResetPasswordSubmitButtonState();
    clearResetPasswordAlert();
  });

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Toggle visual masking only. The field remains type="text" to avoid
  // browser password-manager overlays inside the Admin reset modal.
  state.dom.resetPasswordToggleBtn?.addEventListener("click", () => {
    const isCurrentlyVisible =
      state.dom.resetPasswordTempInput?.dataset?.passwordVisible === "true";

    setResetPasswordVisibility(!isCurrentlyVisible);
  });

  state.dom.resetPasswordSubmitBtn?.addEventListener("click", async () => {
    await submitPasswordReset();
  });

  // Clear temp password when modal closes so it does not linger.
  state.dom.resetPasswordModal?.addEventListener("hidden.bs.modal", () => {
    clearResetPasswordModal();
  });

  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
  // Admin must explicitly confirm before resetting HR MFA.
  state.dom.resetMfaConfirmCheckbox?.addEventListener("change", () => {
    updateResetMfaSubmitButtonState();
    clearResetMfaAlert();
  });

  state.dom.resetMfaSubmitBtn?.addEventListener("click", async () => {
    await submitMfaReset();
  });

  state.dom.resetMfaModal?.addEventListener("hidden.bs.modal", () => {
    clearResetMfaModal();
  });
}

function renderAdminOverviewSummary() {
  const companies = Array.isArray(state.tenants) ? state.tenants : [];
  const profiles = Array.isArray(state.profilesForTenantLinking)
    ? state.profilesForTenantLinking
    : [];

  // ADMIN UI CLEANUP - STEP 1E
  // Overview is display-only. It uses data already loaded for Company Setup
  // and User Access Setup, so no extra database calls are introduced here.
  const totalCompanies = companies.length;
  const activeCompanies = companies.filter(
    (company) => String(company.status || "").toLowerCase() === "active",
  ).length;

  const linkedUsers = profiles.filter(
    (profile) => String(profile.tenant_id || "").trim(),
  ).length;

  const unlinkedUsers = Math.max(profiles.length - linkedUsers, 0);

  // =========================================================
  // ADMIN OPERATIONS READINESS - v1.0.0
  //
  // Derived only from company/profile data already loaded by Admin.
  // No additional Supabase request is introduced.
  // =========================================================

  const inactiveCompanies = Math.max(
    totalCompanies - activeCompanies,
    0,
  );

  const accessCoverage =
    profiles.length > 0
      ? Math.round((linkedUsers / profiles.length) * 100)
      : 100;

  // Build a set of company IDs that currently have at least one
  // profile linked to them.
  const companyIdsWithUsers = new Set(
    profiles
      .map((profile) =>
        String(profile.tenant_id || "").trim(),
      )
      .filter(Boolean),
  );

  const companiesWithoutUsers = companies.filter(
    (company) =>
      !companyIdsWithUsers.has(
        String(company.id || "").trim(),
      ),
  ).length;


  // Update Platform Readiness presentation.
  const accessCoverageValue =
    document.getElementById(
      "adminOverviewAccessCoverageValue",
    );

  const accessCoverageTrack =
    document.getElementById(
      "adminOverviewAccessCoverageTrack",
    );

  const accessCoverageBar =
    document.getElementById(
      "adminOverviewAccessCoverageBar",
    );

  const inactiveCompanyCount =
    document.getElementById(
      "adminOverviewInactiveCompanyCount",
    );

  const companiesWithoutUsersCount =
    document.getElementById(
      "adminOverviewCompaniesWithoutUsersCount",
    );

  const readinessUnlinkedCount =
    document.getElementById(
      "adminOverviewReadinessUnlinkedCount",
    );


  if (accessCoverageValue) {
    accessCoverageValue.textContent =
      `${accessCoverage}%`;
  }

  if (accessCoverageTrack) {
    accessCoverageTrack.setAttribute(
      "aria-valuenow",
      String(accessCoverage),
    );
  }

  if (accessCoverageBar) {
    accessCoverageBar.style.width =
      `${Math.min(Math.max(accessCoverage, 0), 100)}%`;
  }

  if (inactiveCompanyCount) {
    inactiveCompanyCount.textContent =
      String(inactiveCompanies);
  }

  if (companiesWithoutUsersCount) {
    companiesWithoutUsersCount.textContent =
      String(companiesWithoutUsers);
  }

  if (readinessUnlinkedCount) {
    readinessUnlinkedCount.textContent =
      String(unlinkedUsers);
  }
  if (state.dom.adminOverviewCompanyCount) {
    state.dom.adminOverviewCompanyCount.textContent = totalCompanies;
  }

  if (state.dom.adminOverviewActiveCompanyCount) {
    state.dom.adminOverviewActiveCompanyCount.textContent = activeCompanies;
  }

  if (state.dom.adminOverviewLinkedUserCount) {
    state.dom.adminOverviewLinkedUserCount.textContent = linkedUsers;
  }

  if (state.dom.adminOverviewUnlinkedUserCount) {
    state.dom.adminOverviewUnlinkedUserCount.textContent = unlinkedUsers;
  }

  // ADMIN UI CLEANUP - STEP 1G
  // Give Admin a plain-language status for company-scoped user access readiness.
  if (state.dom.adminOverviewAccessHealthPanel) {
    const hasProfiles = profiles.length > 0;
    const hasUnlinkedUsers = unlinkedUsers > 0;

    // ADMIN OVERVIEW ACCESS READINESS - v1.0.2
    // Preserve the dedicated operational layout.
    // JavaScript changes only the health state.
    state.dom.adminOverviewAccessHealthPanel.className =
      hasUnlinkedUsers
        ? "admin-overview-access-health admin-overview-access-health-warning mt-4"
        : "admin-overview-access-health admin-overview-access-health-success mt-4";

    if (state.dom.adminOverviewAccessHealthTitle) {
      state.dom.adminOverviewAccessHealthTitle.textContent = hasUnlinkedUsers
        ? "Some users still need company access"
        : "User company access is fully linked";
    }

    if (state.dom.adminOverviewAccessHealthMessage) {
      state.dom.adminOverviewAccessHealthMessage.textContent = !hasProfiles
        ? "No user profiles are currently available for access setup."
        : hasUnlinkedUsers
          ? `${unlinkedUsers} user profile(s) still require company workspace access. Use Manage User Access below to complete setup.`
          : "All available user profiles have company workspace access.";
    }
  }
}

function switchAdminWorkspace(workspace) {
  const isProfile = workspace === "profile";
  const isOverview = workspace === "overview";
  const isTenants = workspace === "tenants";

  // ADMIN AUDIT CENTRE REMOVAL
  // Admin is platform-level across multiple companies. The central Audit Centre
  // has been removed to avoid company-wide notification overload.
  state.dom.adminProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.adminOverviewSection?.classList.toggle("d-none", !isOverview);
  state.dom.adminTenantsSection?.classList.toggle("d-none", !isTenants);

  if (state.dom.adminTabProfileBtn) {
    state.dom.adminTabProfileBtn.className = isProfile
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.adminTabOverviewBtn) {
    state.dom.adminTabOverviewBtn.className = isOverview
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.adminTabTenantsBtn) {
    state.dom.adminTabTenantsBtn.className = isTenants
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  // ADMIN AUTHORITATIVE APPLICATION HEADER - v1.0.0
  // Keep the compact application header aligned with the active workspace.
  // Presentation text only; existing section switching remains unchanged.
  const workspaceHeaderContent = {
    overview: {
      module: "Overview",
      title: "Admin Overview",
      subtitle:
        "Monitor company workspaces, platform access, and administrative setup.",
    },

    tenants: {
      module: "Companies",
      title: "Companies",
      subtitle:
        "Manage company workspaces, approved setup, and user-to-company access.",
    },

    profile: {
      module: "My Profile",
      title: "My Profile",
      subtitle:
        "Review your administrator account, profile photo, and platform profile information.",
    },
  };

  const activeHeaderContent =
    workspaceHeaderContent[workspace] ||
    workspaceHeaderContent.overview;

  if (state.dom.adminModuleValue) {
    state.dom.adminModuleValue.textContent =
      activeHeaderContent.module;
  }

  const pageTitle =
    document.getElementById("adminModernPageTitle");

  const pageSubtitle =
    document.getElementById("adminModernPageSubtitle");

  if (pageTitle) {
    pageTitle.textContent = activeHeaderContent.title;
  }

  if (pageSubtitle) {
    pageSubtitle.textContent = activeHeaderContent.subtitle;
  }

  // CROSS-DASHBOARD SIDEBAR REPLICATION - ADMIN STEP 1C-1
  // Keep the new Admin desktop sidebar active state aligned with the
  // existing Admin workspace tabs. This does not change routing logic.
  [
    { id: "sidebarAdminProfileBtn", active: isProfile },
    { id: "sidebarAdminOverviewBtn", active: isOverview },
    { id: "sidebarAdminCompaniesBtn", active: isTenants },
  ].forEach(({ id, active }) => {
    const item = document.getElementById(id);
    if (item) item.classList.toggle("active", active);
  });

  // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.1
  // Show Company Identity / Email Setup / User Access only while the
  // authenticated Admin is inside the Companies parent workspace.
  //
  // This is presentation-only. It does not change Admin authentication,
  // company access, Supabase, RPC, Edge Function, or tenant behaviour.
  const companiesSubnav = document.getElementById(
    "adminCompaniesSidebarSubnav",
  );

  companiesSubnav?.classList.toggle(
    "d-none",
    !isTenants,
  );

}

function getInitials(fullName, fallback = "AD") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return fallback;

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function showPageAlert(type, message) {
  if (!state.dom.pageAlert) return;

  state.dom.pageAlert.className = `alert alert-${type} mb-4`;
  state.dom.pageAlert.textContent = message;
  state.dom.pageAlert.classList.remove("d-none");
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
// Simple HTML escaping for tenant records rendered into table rows.
function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

// ADMIN COMPANY IDENTITY AUTHORITATIVE UI - v1.0.0
// Return Company Identity-specific status classes instead of Bootstrap badges.
function getTenantStatusBadgeClass(status = "") {
  return String(status || "").toLowerCase() === "active"
    ? "admin-company-status-pill-active"
    : "admin-company-status-pill-inactive";
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
// Tenant ID is a login code, so keep it clean and consistent.
function normaliseTenantCode(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isTenantCodeValid(value = "") {
  return /^[A-Z0-9_-]{2,40}$/.test(normaliseTenantCode(value));
}

function updateTenantSaveButtonState() {
  const canSubmit = Boolean(
    String(state.dom.tenantCompanyName?.value || "").trim() &&
    isTenantCodeValid(state.dom.tenantCode?.value || "") &&
    String(state.dom.tenantStatus?.value || "").trim(),
  );

  const button = state.dom.saveTenantBtn;
  if (!button) return;

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearTenantValidationState() {
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
    state.dom.tenantStatus,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateTenantForm() {
  clearTenantValidationState();

  const companyName = String(state.dom.tenantCompanyName?.value || "").trim();
  const tenantCode = normaliseTenantCode(state.dom.tenantCode?.value || "");
  const status = String(state.dom.tenantStatus?.value || "").trim();

  if (!companyName) {
    state.dom.tenantCompanyName?.classList.add("is-invalid");
    showPageAlert("warning", "Company name is required before creating a company.");
    state.dom.tenantCompanyName?.focus();
    return false;
  }

  if (!tenantCode || !isTenantCodeValid(tenantCode)) {
    state.dom.tenantCode?.classList.add("is-invalid");
    showPageAlert(
      "warning",
      "Tenant ID / Company ID must be 2-40 characters and can only contain letters, numbers, hyphen, or underscore.",
    );
    state.dom.tenantCode?.focus();
    return false;
  }

  if (!status) {
    state.dom.tenantStatus?.classList.add("is-invalid");
    showPageAlert("warning", "Company status is required.");
    state.dom.tenantStatus?.focus();
    return false;
  }

  return true;
}

function buildTenantPayload() {
  return {
    company_name: String(state.dom.tenantCompanyName?.value || "").trim(),
    tenant_code: normaliseTenantCode(state.dom.tenantCode?.value || ""),
    status: String(state.dom.tenantStatus?.value || "Active").trim(),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
    // Notes is not collected in the first tenant setup UI.
    // Keep saved payload focused on login segmentation fields only.
    created_by: state.currentUser?.id || null,
    updated_by: state.currentUser?.id || null,
  };
}

function setTenantSaveLoading(isLoading) {
  const button = state.dom.saveTenantBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Company...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();
}

function resetTenantForm() {
  state.currentEditingTenant = null;

  if (state.dom.editingTenantId) {
    state.dom.editingTenantId.value = "";
  }

  // ADMIN UI CLEANUP - STEP 1L
  // Only reset fields that still exist in the current Company Identity form.
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
  ].forEach((field) => {
    if (field) {
      field.value = "";
      field.classList.remove("is-invalid");
    }
  });

  if (state.dom.tenantStatus) {
    state.dom.tenantStatus.value = "Active";
    state.dom.tenantStatus.classList.remove("is-invalid");
  }

  state.dom.cancelTenantEditBtn?.classList.add("d-none");

  if (state.dom.saveTenantBtn) {
    state.dom.saveTenantBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveTenantBtnText">Create Company</span>
    `;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();
}

function renderTenantRecordsLoadingState() {
  if (!state.dom.tenantRecordsTableBody) return;

  state.dom.tenantRecordsEmptyState?.classList.add("d-none");
  state.dom.tenantRecordsTableWrapper?.classList.remove("d-none");

  state.dom.tenantRecordsTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="text-center text-secondary py-4">
        Loading company records.
      </td>
    </tr>
  `;
}

function renderTenantRecords(records = []) {
  const tbody = state.dom.tenantRecordsTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!records.length) {
    state.dom.tenantRecordsEmptyState?.classList.remove("d-none");
    state.dom.tenantRecordsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.tenantRecordsEmptyState?.classList.add("d-none");
  state.dom.tenantRecordsTableWrapper?.classList.remove("d-none");

  records.forEach((record) => {
    const row = document.createElement("tr");

    row.innerHTML = `
<td>
  <!-- HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
       Tenant Records show only the core company name for the first version. -->
  <div class="fw-semibold">${escapeHtml(record.company_name || "--")}</div>
</td>

      <td>
        <!-- ADMIN COMPANY IDENTITY AUTHORITATIVE UI - v1.0.0 -->
        <span class="admin-company-code-pill">
          ${escapeHtml(record.tenant_code || "--")}
        </span>
      </td>

      <td>
        <!-- ADMIN COMPANY IDENTITY AUTHORITATIVE UI - v1.0.0 -->
        <span class="admin-company-status-pill ${getTenantStatusBadgeClass(record.status)}">
          <span class="admin-company-status-dot" aria-hidden="true"></span>
          ${escapeHtml(record.status || "--")}
        </span>
      </td>

      <td class="text-nowrap">${formatDate(record.updated_at || record.created_at)}</td>

      <td class="text-center">
        <div class="d-flex gap-1 justify-content-center">
          <!-- ADMIN DELETE ACTIONS - STEP 1
               Existing edit action remains unchanged. -->
<!-- ADMIN COMPANY ACTIONS - RESET WORKSPACE v1.0.0
     Reset Workspace is intentionally separate from Delete Company.
     It preserves the company and employees while clearing operational data. -->
<button
  type="button"
  class="btn btn-sm btn-outline-primary"
  title="Edit company"
  onclick="window.adminEditTenantRecord('${escapeHtml(record.id)}')"
>
  <i class="bi bi-pencil-square"></i>
</button>

<button
  type="button"
  class="btn btn-sm btn-outline-warning"
  title="Reset workspace"
  onclick="window.adminResetTenantWorkspace('${escapeHtml(record.id)}')"
>
  <i class="bi bi-arrow-counterclockwise"></i>
</button>

<button
  type="button"
  class="btn btn-sm btn-outline-danger"
  title="Delete company"
  onclick="window.adminDeleteTenantRecord('${escapeHtml(record.id)}')"
>
  <i class="bi bi-trash"></i>
</button>
        </div>
      </td>
    `;

    tbody.appendChild(row);
  });
}

async function refreshTenantWorkspace() {
  renderTenantRecordsLoadingState();

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) throw error;

    state.tenants = Array.isArray(data) ? data : [];
    renderTenantRecords(state.tenants);
    updateTenantSaveButtonState();

    // ADMIN UI CLEANUP - STEP 1E
    // Keep Overview company counts in sync after tenant/company refresh.
    renderAdminOverviewSummary();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Keep tenant assignment dropdown in sync with saved tenant records.
    populateProfileTenantTenantOptions();

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Keep the company invite dropdown in sync with active company records.
    populateCompanyUserTenantOptions();
    // ADMIN EMAIL SETUP - STEP 1D
    // Keep the Email Setup company dropdown in sync with active company records.
    populateAdminEmailSetupCompanyOptions();
  } catch (error) {
    console.error("Error loading tenant records:", error);
    state.tenants = [];
    renderTenantRecords([]);

    showPageAlert(
      "danger",
      error.message || "Company records could not be loaded.",
    );
  }
}

function getTenantById(tenantId = "") {
  const id = String(tenantId || "").trim();

  if (!id) return null;

  return (state.tenants || []).find(
    (tenant) => String(tenant.id || "").trim() === id,
  ) || null;
}

function startTenantEdit(tenantId) {
  const tenant = getTenantById(tenantId);

  if (!tenant) {
    showPageAlert(
      "warning",
      "The selected company record could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingTenant = tenant;
  // ADMIN UI CLEANUP - STEP 1I
  // If Company Identity is collapsed, open it before loading the edit values.
  openAdminCompanyIdentityPanel();

  if (state.dom.editingTenantId) {
    state.dom.editingTenantId.value = tenant.id || "";
  }

  if (state.dom.tenantCompanyName) {
    state.dom.tenantCompanyName.value = tenant.company_name || "";
  }

  if (state.dom.tenantCode) {
    state.dom.tenantCode.value = tenant.tenant_code || "";
  }

  if (state.dom.tenantStatus) {
    state.dom.tenantStatus.value = tenant.status || "Active";
  }


  state.dom.cancelTenantEditBtn?.classList.remove("d-none");

  if (state.dom.saveTenantBtn) {
    state.dom.saveTenantBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveTenantBtnText">Update Company</span>
    `;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();

  // ADMIN UI CLEANUP - STEP 1K
  // Editing a company should open Company Identity and scroll to the panel
  // header cleanly without cutting it off.
  focusAdminFieldWithoutJump(state.dom.tenantCompanyName);
  scrollToAdminOpenedPanel(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    150,
  );
}

// ADMIN DELETE ACTIONS - STEP 1
// Delete a company only through the guarded Supabase RPC.
// This prevents accidental deletion of companies that already have linked HR/payroll data.
async function deleteTenantRecord(tenantId = "") {
  const tenant = getTenantById(tenantId);

  if (!tenant) {
    showPageAlert(
      "warning",
      "The selected company record could not be found. Please refresh and try again.",
    );
    return;
  }

  const companyName = String(tenant.company_name || "this company").trim();
  const companyCode = String(tenant.tenant_code || "--").trim();

  const confirmed = window.confirm(
    `Delete company "${companyName}" (${companyCode})?\n\n` +
    "This will only succeed if Supabase confirms the company has no linked operational records.\n\n" +
    "If the company has employees, users, payroll, leave, email logs, or setup records, deletion will be blocked. Use Inactive status instead."
  );

  if (!confirmed) return;

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc(
      "admin_delete_tenant_if_safe",
      {
        target_tenant_id: String(tenant.id || "").trim(),
      },
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    if (result && result.success === false) {
      throw new Error(
        result.message ||
        "Company could not be deleted because linked records still exist.",
      );
    }

    await refreshTenantWorkspace();
    await refreshAdminEmailSetupWorkspace({ preserveCompany: false });
    await refreshProfileTenantLinkingWorkspace();

    resetTenantForm();

    showPageAlert("success", `Company "${companyName}" was deleted successfully.`);

    showDashboardToast(
      "success",
      "Company deleted",
      `Company "${companyName}" was removed from Supabase.`,
    );
  } catch (error) {
    console.error("Error deleting company:", error);

    showPageAlert(
      "danger",
      error.message ||
      "Company could not be deleted. If it has linked data, set it to Inactive instead.",
    );

    showDashboardToast(
      "danger",
      "Company delete blocked",
      error.message ||
      "Company could not be deleted because linked records may still exist.",
    );
  }
}

// =========================================================
// ADMIN RESET WORKSPACE MODAL - v1.0.0
//
// Controlled Super Admin workspace reset workflow.
//
// IMPORTANT:
// - company/tenant record survives;
// - employees survive;
// - employee IDs survive;
// - profiles/Auth linkage survive;
// - operational tenant-owned data is reset by the proven
//   admin_reset_tenant_workspace(uuid) PostgreSQL RPC;
// - browser JavaScript never performs individual deletes.
// =========================================================

function normaliseResetWorkspaceConfirmation(value = "") {
  // ADMIN RESET WORKSPACE CONFIRMATION - v1.0.0
  // Keep the comparison predictable for copied/pasted company names.
  // Internal whitespace is preserved because the visible company name
  // itself is the destructive confirmation phrase.
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}


function clearResetWorkspaceAlert() {
  const alert =
    state.dom.resetWorkspaceAlert;

  if (!alert) return;

  alert.className =
    "alert d-none mt-3 mb-0";

  alert.textContent = "";
}


function showResetWorkspaceAlert(
  type,
  message,
) {
  const alert =
    state.dom.resetWorkspaceAlert;

  if (!alert) {
    showPageAlert(type, message);
    return;
  }

  alert.className =
    `alert alert-${type} mt-3 mb-0`;

  alert.textContent =
    message;
}


function updateResetWorkspaceContinueButtonState() {
  const button =
    state.dom.resetWorkspaceContinueBtn;

  if (!button) return;

  const expectedName =
    normaliseResetWorkspaceConfirmation(
      state.currentResetWorkspaceTarget
        ?.company_name,
    );

  const enteredName =
    normaliseResetWorkspaceConfirmation(
      state.dom.resetWorkspaceConfirmationInput
        ?.value,
    );

  const isMatch =
    Boolean(expectedName) &&
    Boolean(enteredName) &&
    enteredName === expectedName;

  button.disabled =
    !isMatch;

  button.className =
    isMatch
      ? "btn btn-warning dashboard-action-btn"
      : "btn btn-secondary dashboard-action-btn";
}


function showResetWorkspaceStageOne() {
  state.dom.resetWorkspaceStageOne
    ?.classList.remove("d-none");

  state.dom.resetWorkspaceStageTwo
    ?.classList.add("d-none");

  state.dom.resetWorkspaceContinueBtn
    ?.classList.remove("d-none");

  state.dom.resetWorkspaceConfirmBtn
    ?.classList.add("d-none");

  if (state.dom.resetWorkspaceBackBtn) {
    state.dom.resetWorkspaceBackBtn.textContent =
      "Cancel";
  }

  clearResetWorkspaceAlert();
  updateResetWorkspaceContinueButtonState();

  window.requestAnimationFrame(() => {
    state.dom.resetWorkspaceConfirmationInput
      ?.focus();

    updateResetWorkspaceContinueButtonState();
  });
}


function showResetWorkspaceStageTwo() {
  const tenant =
    state.currentResetWorkspaceTarget;

  if (!tenant) return;

  state.dom.resetWorkspaceStageOne
    ?.classList.add("d-none");

  state.dom.resetWorkspaceStageTwo
    ?.classList.remove("d-none");

  state.dom.resetWorkspaceContinueBtn
    ?.classList.add("d-none");

  state.dom.resetWorkspaceConfirmBtn
    ?.classList.remove("d-none");

  if (state.dom.resetWorkspaceBackBtn) {
    state.dom.resetWorkspaceBackBtn.textContent =
      "Go Back";
  }

  if (state.dom.resetWorkspaceFinalName) {
    state.dom.resetWorkspaceFinalName.textContent =
      String(
        tenant.company_name || "",
      ).trim();
  }

  if (state.dom.resetWorkspaceFinalCode) {
    state.dom.resetWorkspaceFinalCode.textContent =
      String(
        tenant.tenant_code || "--",
      ).trim();
  }

  clearResetWorkspaceAlert();
}


function clearResetWorkspaceModal() {
  state.currentResetWorkspaceTarget =
    null;

  if (
    state.dom
      .resetWorkspaceConfirmationInput
  ) {
    state.dom
      .resetWorkspaceConfirmationInput
      .value = "";
  }

  state.dom.resetWorkspaceStageOne
    ?.classList.remove("d-none");

  state.dom.resetWorkspaceStageTwo
    ?.classList.add("d-none");

  state.dom.resetWorkspaceContinueBtn
    ?.classList.remove("d-none");

  state.dom.resetWorkspaceConfirmBtn
    ?.classList.add("d-none");

  if (state.dom.resetWorkspaceBackBtn) {
    state.dom.resetWorkspaceBackBtn.textContent =
      "Cancel";
  }

  if (
    state.dom.resetWorkspaceContinueBtn
  ) {
    state.dom.resetWorkspaceContinueBtn.disabled =
      true;

    state.dom.resetWorkspaceContinueBtn.className =
      "btn btn-secondary dashboard-action-btn";
  }

  if (
    state.dom.resetWorkspaceConfirmBtn
  ) {
    state.dom.resetWorkspaceConfirmBtn.disabled =
      false;
  }

  clearResetWorkspaceAlert();
}


function openResetWorkspaceModal(
  tenantId = "",
) {
  const tenant =
    getTenantById(tenantId);

  if (!tenant) {
    showPageAlert(
      "warning",
      "The selected company record could not be found. Refresh Companies and try again.",
    );

    return;
  }

  clearResetWorkspaceModal();

  state.currentResetWorkspaceTarget =
    tenant;

  const companyName =
    String(
      tenant.company_name ||
      "Unnamed company",
    ).trim();

  const companyCode =
    String(
      tenant.tenant_code ||
      "--",
    ).trim();

  if (
    state.dom.resetWorkspaceTargetName
  ) {
    state.dom.resetWorkspaceTargetName.textContent =
      companyName;
  }

  if (
    state.dom.resetWorkspaceTargetCode
  ) {
    state.dom.resetWorkspaceTargetCode.textContent =
      companyCode;
  }

  if (
    state.dom.resetWorkspaceFinalName
  ) {
    state.dom.resetWorkspaceFinalName.textContent =
      companyName;
  }

  if (
    state.dom.resetWorkspaceFinalCode
  ) {
    state.dom.resetWorkspaceFinalCode.textContent =
      companyCode;
  }

  showResetWorkspaceStageOne();

  const modalEl =
    state.dom.resetWorkspaceModal;

  if (!modalEl) {
    showPageAlert(
      "danger",
      "Reset Workspace confirmation could not be opened.",
    );

    return;
  }

  bootstrap.Modal
    .getOrCreateInstance(modalEl)
    .show();
}


function advanceResetWorkspaceModal() {
  const tenant =
    state.currentResetWorkspaceTarget;

  if (!tenant) {
    showResetWorkspaceAlert(
      "warning",
      "The selected company could not be confirmed. Close this window and try again.",
    );

    return;
  }

  const expectedName =
    normaliseResetWorkspaceConfirmation(
      tenant.company_name,
    );

  const enteredName =
    normaliseResetWorkspaceConfirmation(
      state.dom
        .resetWorkspaceConfirmationInput
        ?.value,
    );

  if (
    !expectedName ||
    enteredName !== expectedName
  ) {
    showResetWorkspaceAlert(
      "warning",
      "Type the full company name exactly before continuing.",
    );

    updateResetWorkspaceContinueButtonState();

    return;
  }

  showResetWorkspaceStageTwo();
}


async function submitResetWorkspace() {
  const tenant =
    state.currentResetWorkspaceTarget;

  if (!tenant?.id) {
    showResetWorkspaceAlert(
      "warning",
      "The selected company could not be confirmed. Close this window and try again.",
    );

    return;
  }

  const expectedName =
    normaliseResetWorkspaceConfirmation(
      tenant.company_name,
    );

  const enteredName =
    normaliseResetWorkspaceConfirmation(
      state.dom
        .resetWorkspaceConfirmationInput
        ?.value,
    );

  // ADMIN RESET WORKSPACE - FINAL CLIENT CHECK
  // Re-check the typed company name immediately before calling
  // the secure transactional RPC.
  if (
    !expectedName ||
    enteredName !== expectedName
  ) {
    showResetWorkspaceStageOne();

    showResetWorkspaceAlert(
      "warning",
      "The company-name confirmation no longer matches the selected company.",
    );

    return;
  }

  const confirmButton =
    state.dom.resetWorkspaceConfirmBtn;

  const companyName =
    String(
      tenant.company_name ||
      "the selected company",
    ).trim();

  try {
    clearResetWorkspaceAlert();

    if (confirmButton) {
      if (
        !confirmButton.dataset.originalHtml
      ) {
        confirmButton.dataset.originalHtml =
          confirmButton.innerHTML;
      }

      confirmButton.disabled = true;

      confirmButton.innerHTML = `
        <span
          class="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        ></span>
        Resetting Workspace...
      `;
    }

    const supabase =
      getSupabaseClient();

    // ADMIN RESET WORKSPACE - SECURE TRANSACTIONAL RPC
    //
    // Browser does not delete individual records.
    // PostgreSQL performs the complete reset transactionally.
    const {
      data,
      error,
    } = await supabase.rpc(
      "admin_reset_tenant_workspace",
      {
        target_tenant_id:
          String(
            tenant.id || "",
          ).trim(),
      },
    );

    if (error) {
      throw error;
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      result &&
      result.success === false
    ) {
      throw new Error(
        result.message ||
        "The company workspace could not be reset.",
      );
    }

    const modalEl =
      state.dom.resetWorkspaceModal;

    if (modalEl) {
      bootstrap.Modal
        .getOrCreateInstance(modalEl)
        .hide();
    }

    // Refresh only Admin-owned workspace views that can be
    // affected by the reset.
    await refreshTenantWorkspace();

    await refreshAdminEmailSetupWorkspace({
      preserveCompany: true,
    });

    await refreshProfileTenantLinkingWorkspace();

    resetTenantForm();
    openAdminCompanyIdentityPanel();

    const employeesPreserved =
      Number(
        result?.employees_preserved || 0,
      );

    const successMessage =
      result?.message ||
      `Workspace reset completed for ${companyName}. ${employeesPreserved} employee record(s) were preserved.`;

    showPageAlert(
      "success",
      successMessage,
    );

    showDashboardToast(
      "success",
      "Workspace reset complete",
      successMessage,
    );
  } catch (error) {
    console.error(
      "Error resetting company workspace:",
      error,
    );

    const message =
      String(
        error?.message || "",
      ).trim() ||
      "The company workspace could not be reset.";

    // Keep the modal open so Admin retains the company context.
    showResetWorkspaceAlert(
      "danger",
      message,
    );

    showDashboardToast(
      "danger",
      "Workspace reset failed",
      message,
    );
  } finally {
    if (
      confirmButton?.dataset.originalHtml
    ) {
      confirmButton.innerHTML =
        confirmButton.dataset.originalHtml;

      delete confirmButton
        .dataset.originalHtml;
    }

    if (confirmButton) {
      confirmButton.disabled = false;
    }
  }
}

async function saveTenantRecord() {
  if (!validateTenantForm()) {
    updateTenantSaveButtonState();
    return;
  }

  const payload = buildTenantPayload();
  const editingId = String(
    state.currentEditingTenant?.id || state.dom.editingTenantId?.value || "",
  ).trim();

  try {
    setTenantSaveLoading(true);

    const supabase = getSupabaseClient();

    let response;

    if (editingId) {
      const updatePayload = {
        ...payload,
        updated_by: state.currentUser?.id || null,
      };

      delete updatePayload.created_by;

      response = await supabase
        .from("tenants")
        .update(updatePayload)
        .eq("id", editingId)
        .select("*")
        .maybeSingle();
    } else {
      response = await supabase
        .from("tenants")
        .insert([payload])
        .select("*")
        .maybeSingle();
    }

    if (response.error) throw response.error;

    await refreshTenantWorkspace();

    showPageAlert(
      "success",
      `Company record was ${editingId ? "updated" : "created"} successfully.`,
    );

    // ADMIN UI CLEANUP - STEP 1H
    // Mirror HR dashboard floating feedback for important Admin save actions.
    showDashboardToast(
      "success",
      editingId ? "Company updated" : "Company created",
      `Company record was ${editingId ? "updated" : "created"} successfully.`,
    );

    resetTenantForm();

    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // After successful company create/update, open Company Records and scroll there cleanly.
    redirectToAdminCompanyRecordsAfterSave();
  } catch (error) {
    console.error("Error saving tenant record:", error);

    const message = String(error.message || "").toLowerCase();

    if (
      message.includes("duplicate key value") ||
      message.includes("tenants_tenant_code_lower_unique") ||
      message.includes("tenant_code")
    ) {
      showPageAlert(
        "warning",
        "This Tenant ID / Company ID already exists. Please use a different ID.",
      );
      return;
    }

    showPageAlert(
      "danger",
      error.message || "Company record could not be saved.",
    );
  } finally {
    setTenantSaveLoading(false);
  }
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Display name used throughout Admin user-access workflows.
//
// Prefer the authoritative employee name maintained by HR.
// Fall back to the existing profile name, then email, when a linked
// employee record is not available.
function getProfileDisplayName(profile = {}) {
  return (
    String(profile.employee_full_name || "").trim() ||
    String(profile.full_name || "").trim() ||
    String(profile.email || "").trim() ||
    "Unnamed profile"
  );
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Find tenant record from already-loaded Admin tenant records.
function getTenantByTenantId(tenantId = "") {
  const id = String(tenantId || "").trim();

  if (!id) return null;

  return (state.tenants || []).find(
    (tenant) => String(tenant.id || "").trim() === id,
  ) || null;
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Populate the User/Profile dropdown from loaded profiles.
function populateProfileTenantProfileOptions() {
  const select = state.dom.profileTenantProfileId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select user/profile</option>`;

  const profiles = [...(state.profilesForTenantLinking || [])].sort((a, b) =>
    getProfileDisplayName(a).localeCompare(getProfileDisplayName(b), undefined, {
      sensitivity: "base",
    }),
  );

  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    // ADMIN MOJIBAKE CLEANUP
    // Use an ASCII-safe separator for generated dropdown text.
    option.textContent = `${getProfileDisplayName(profile)} - ${profile.email || "No email"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateProfileTenantLinkSaveButtonState();
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Populate the Tenant/Company dropdown from Admin-created tenant records.
function populateProfileTenantTenantOptions() {
  const select = state.dom.profileTenantTenantId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  // ADMIN UI CLEANUP - STEP 1B FINAL
  // Admin users select a company here, although the stored value remains tenant_id.
  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(String(b.company_name || ""), undefined, {
        sensitivity: "base",
      }),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    // ADMIN USER ACCESS AUTHORITATIVE UI - v1.0.0
    // Use an ASCII separator so company labels render consistently.
    option.textContent = `${tenant.company_name || "Unnamed Company"} - ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateProfileTenantLinkSaveButtonState();
}

// ADMIN COMPANY USER BOOTSTRAP - STEP 1D
// Populate the company dropdown used by the Admin company-user invite form.
function populateCompanyUserTenantOptions() {
  const select = state.dom.companyUserTenantId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(
        String(b.company_name || ""),
        undefined,
        { sensitivity: "base" },
      ),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    // ADMIN USER ACCESS AUTHORITATIVE UI - v1.0.0
    // Keep generated company labels ASCII-safe and consistent
    // across both User Access company selectors.
    option.textContent = `${tenant.company_name || "Unnamed Company"} - ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateCompanyUserInviteButtonState();
}
// ADMIN COMPANY USER BOOTSTRAP - STEP 1D
// Fetch active departments for the selected company and populate the Department
// dropdown. Disabled with a placeholder when no company is selected.
async function populateCompanyUserDepartmentOptions() {
  const select = state.dom.companyUserDepartment;
  if (!select) return;

  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  // Reset to disabled state when no company is chosen.
  select.innerHTML = `<option value="">Select a company first</option>`;
  select.disabled = true;

  if (!tenantId) {
    updateCompanyUserInviteButtonState();
    return;
  }

  select.innerHTML = `<option value="">Loading departments...</option>`;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("organization_departments")
      .select("id, department_name, status")
      .eq("tenant_id", tenantId)
      .eq("status", "Active")
      .order("department_name", { ascending: true });

    if (error) throw error;

    const departments = Array.isArray(data) ? data : [];

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1E
    // No departments should not block first HR bootstrap.
    select.innerHTML = departments.length
      ? `<option value="">Select department</option>`
      : `<option value="">No departments set up yet - optional for invite</option>`;

    departments.forEach((dept) => {
      const option = document.createElement("option");
      option.value = dept.department_name;
      option.textContent = dept.department_name;
      select.appendChild(option);
    });

    select.disabled = departments.length === 0;
  } catch (err) {
    console.error("populateCompanyUserDepartmentOptions error:", err);

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1E
    // Department lookup failure must not block Admin from inviting the first
    // HR/Manager/Employee user. The department can be completed later in HR setup.
    select.innerHTML = `<option value="">Could not load departments - optional for invite</option>`;
    select.disabled = true;
  }

  updateCompanyUserInviteButtonState();
}

// ADMIN EMAIL SETUP - STEP 1D
// Populate the company dropdown used by Admin Email Setup.
function populateAdminEmailSetupCompanyOptions() {
  const select = state.dom.adminEmailSetupCompanyId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(
        String(b.company_name || ""),
        undefined,
        { sensitivity: "base" },
      ),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    option.textContent = `${tenant.company_name || "Unnamed Company"} - ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  const hasCurrentValue = currentValue &&
    activeTenants.some((tenant) => String(tenant.id || "") === currentValue);

  if (hasCurrentValue) {
    select.value = currentValue;
  } else if (activeTenants.length) {
    select.value = activeTenants[0].id;
  }

  updateAdminEmailRecipientSaveButtonState();
}

function getSelectedAdminEmailSetupTenant() {
  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

  if (!tenantId) return null;

  return getTenantByTenantId(tenantId);
}

function normaliseAdminEmailSetupStatus(status = "") {
  return String(status || "").trim().toLowerCase();
}

function getAdminEmailSetupStatusBadgeClass(status = "") {
  const normalisedStatus = normaliseAdminEmailSetupStatus(status);

  if (normalisedStatus === "active" || normalisedStatus === "sent") {
    return "text-bg-success";
  }

  if (normalisedStatus === "failed") {
    return "text-bg-danger";
  }

  if (normalisedStatus === "pending") {
    return "text-bg-secondary";
  }

  return "text-bg-light border text-dark";
}

function getAdminEmailSetupDisplayStatus(status = "") {
  const normalisedStatus = normaliseAdminEmailSetupStatus(status);

  if (normalisedStatus === "sent") return "Successful";
  if (normalisedStatus === "failed") return "Needs Review";
  if (normalisedStatus === "pending") return "Pending";
  if (normalisedStatus === "active") return "Active";
  if (normalisedStatus === "inactive") return "Inactive";

  return String(status || "--").trim() || "--";
}

// ADMIN DELETE ACTIONS - CLEAR VALIDATION HISTORY
// Enable Clear Validation History only when a company is selected and logs exist.
function updateAdminEmailHistoryClearButtonState() {
  const button = state.dom.clearAdminEmailHistoryBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();
  const hasLogs = Array.isArray(state.adminEmailSetupLogs) &&
    state.adminEmailSetupLogs.length > 0;

  const canClear = Boolean(tenantId && hasLogs);

  button.disabled = !canClear;
  button.className = canClear
    ? "btn btn-sm btn-outline-danger dashboard-action-btn"
    : "btn btn-sm btn-secondary dashboard-action-btn";
}

function updateAdminEmailSetupSummary() {
  const recipients = Array.isArray(state.adminEmailSetupRecipients)
    ? state.adminEmailSetupRecipients
    : [];

  const logs = Array.isArray(state.adminEmailSetupLogs)
    ? state.adminEmailSetupLogs
    : [];

  const activeRecipientCount = recipients.filter(
    (recipient) => normaliseAdminEmailSetupStatus(recipient.status) === "active",
  ).length;

  if (state.dom.adminEmailRecipientCountValue) {
    state.dom.adminEmailRecipientCountValue.textContent = String(recipients.length);
  }

  if (state.dom.adminEmailActiveRecipientCountValue) {
    state.dom.adminEmailActiveRecipientCountValue.textContent = String(activeRecipientCount);
  }

  if (state.dom.adminEmailDeliveryLogCountValue) {
    state.dom.adminEmailDeliveryLogCountValue.textContent = String(logs.length);
  }

  if (state.dom.adminEmailLastResultValue) {
    const latestLog = logs[0] || null;

    state.dom.adminEmailLastResultValue.textContent = latestLog
      ? getAdminEmailSetupDisplayStatus(latestLog.status)
      : "--";

    state.dom.adminEmailLastResultValue.className = latestLog
      ? `summary-tile-value h6 mb-0 ${normaliseAdminEmailSetupStatus(latestLog.status) === "sent"
        ? "text-success"
        : normaliseAdminEmailSetupStatus(latestLog.status) === "failed"
          ? "text-danger"
          : "text-secondary"
      }`
      : "summary-tile-value h6 mb-0";
  }

  updateAdminEmailHistoryClearButtonState();
}

function renderAdminEmailRecipients(records = []) {
  const tbody = state.dom.adminEmailRecipientsTableBody;
  if (!tbody) return;

  const tenant = getSelectedAdminEmailSetupTenant();
  const recipients = Array.isArray(records) ? records : [];

  tbody.innerHTML = "";

  if (!recipients.length) {
    state.dom.adminEmailRecipientsEmptyState?.classList.remove("d-none");
    state.dom.adminEmailRecipientsTableWrapper?.classList.add("d-none");
    updateAdminEmailSetupSummary();
    return;
  }

  state.dom.adminEmailRecipientsEmptyState?.classList.add("d-none");
  state.dom.adminEmailRecipientsTableWrapper?.classList.remove("d-none");

  recipients.forEach((recipient) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(recipient.display_name || "--")}</div>
        <div class="text-secondary small text-break">${escapeHtml(recipient.recipient_email || "--")}</div>
      </td>

      <td>
        <div class="fw-semibold">${escapeHtml(tenant?.company_name || "--")}</div>
        <div class="text-secondary small">${escapeHtml(tenant?.tenant_code || "--")}</div>
      </td>

      <td>
        <span class="admin-email-status-pill ${getAdminEmailSetupStatusBadgeClass(recipient.status)}">
          ${escapeHtml(getAdminEmailSetupDisplayStatus(recipient.status))}
        </span>
      </td>

      <td class="text-nowrap">${formatDate(recipient.updated_at || recipient.created_at)}</td>

      <td class="text-center">
        <div class="d-flex gap-1 justify-content-center">
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            title="Edit approved recipient"
            onclick="window.adminEditEmailRecipientRecord('${escapeHtml(recipient.id)}')"
          >
            <i class="bi bi-pencil-square"></i>
          </button>

          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            title="Delete approved recipient"
            onclick="window.adminDeleteEmailRecipientRecord('${escapeHtml(recipient.id)}')"
          >
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(row);
  });

  updateAdminEmailSetupSummary();
}

// ADMIN DELETE ACTIONS - CLEAR VALIDATION HISTORY
// Clears validation email logs for the selected company only.
// This does not delete approved recipients or external provider records.
async function clearAdminEmailValidationHistory() {
  const tenant = getSelectedAdminEmailSetupTenant();

  if (!tenant) {
    showPageAlert(
      "warning",
      "Select a company before clearing validation history.",
    );
    return;
  }

  const logCount = Array.isArray(state.adminEmailSetupLogs)
    ? state.adminEmailSetupLogs.length
    : 0;

  if (!logCount) {
    showPageAlert(
      "info",
      "There is no validation history to clear for the selected company.",
    );
    updateAdminEmailHistoryClearButtonState();
    return;
  }

  const companyName = String(tenant.company_name || "this company").trim();
  const companyCode = String(tenant.tenant_code || "--").trim();

  const confirmed = window.confirm(
    `Clear validation history for "${companyName}" (${companyCode})?\n\n` +
    `This will delete ${logCount} validation history record(s) from Supabase for this company only.\n\n` +
    "Approved validation recipients will not be deleted."
  );

  if (!confirmed) return;

  try {
    setAdminActionButtonLoading(
      state.dom.clearAdminEmailHistoryBtn,
      true,
      "Clearing History...",
    );

    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc(
      "admin_clear_email_validation_history",
      {
        target_tenant_id: String(tenant.id || "").trim(),
      },
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    if (result && result.success === false) {
      throw new Error(
        result.message || "Validation history could not be cleared.",
      );
    }

    await refreshAdminEmailSetupWorkspace({ preserveCompany: true });

    const deletedCount = Number(result?.deleted_count || logCount || 0);

    showPageAlert(
      "success",
      `${deletedCount} validation history record(s) were cleared for ${companyName}.`,
    );

    showDashboardToast(
      "success",
      "Validation history cleared",
      `${deletedCount} validation history record(s) were removed for ${companyName}.`,
    );
  } catch (error) {
    console.error("Error clearing validation history:", error);

    showPageAlert(
      "danger",
      error.message || "Validation history could not be cleared.",
    );

    showDashboardToast(
      "danger",
      "Clear history failed",
      error.message || "Validation history could not be cleared.",
    );
  } finally {
    setAdminActionButtonLoading(state.dom.clearAdminEmailHistoryBtn, false);
    updateAdminEmailHistoryClearButtonState();
  }
}

function renderAdminEmailDeliveryLogs(records = []) {
  const tbody = state.dom.adminEmailDeliveryLogsTableBody;
  if (!tbody) return;

  const logs = Array.isArray(records) ? records : [];

  tbody.innerHTML = "";

  if (!logs.length) {
    state.dom.adminEmailDeliveryLogsEmptyState?.classList.remove("d-none");
    state.dom.adminEmailDeliveryLogsTableWrapper?.classList.add("d-none");
    updateAdminEmailSetupSummary();
    return;
  }

  state.dom.adminEmailDeliveryLogsEmptyState?.classList.add("d-none");
  state.dom.adminEmailDeliveryLogsTableWrapper?.classList.remove("d-none");

  logs.forEach((log) => {
    const sentOrCreatedDate = log.sent_at || log.created_at;
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(log.recipient_name || "--")}</div>
        <div class="text-secondary small text-break">${escapeHtml(log.recipient_email || "--")}</div>
      </td>

      <td>
        <span class="admin-email-status-pill ${getAdminEmailSetupStatusBadgeClass(log.status)}">
          ${escapeHtml(getAdminEmailSetupDisplayStatus(log.status))}
        </span>
      </td>

      <td>${escapeHtml(log.provider_name || "--")}</td>

      <td class="text-nowrap">${formatDate(sentOrCreatedDate)}</td>
    `;

    tbody.appendChild(row);
  });

  updateAdminEmailSetupSummary();
}

function getAdminEmailRecipientById(recipientId = "") {
  const id = String(recipientId || "").trim();

  if (!id) return null;

  return (state.adminEmailSetupRecipients || []).find(
    (recipient) => String(recipient.id || "").trim() === id,
  ) || null;
}

function updateAdminEmailRecipientSaveButtonState() {
  const button = state.dom.saveAdminEmailRecipientBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();
  const displayName = String(state.dom.adminEmailRecipientDisplayName?.value || "").trim();
  const email = String(state.dom.adminEmailRecipientEmail?.value || "").trim();
  const status = String(state.dom.adminEmailRecipientStatus?.value || "").trim();

  const canSubmit = Boolean(
    tenantId &&
    displayName &&
    isCompanyUserEmailValid(email) &&
    status,
  );

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearAdminEmailRecipientValidationState() {
  [
    state.dom.adminEmailSetupCompanyId,
    state.dom.adminEmailRecipientDisplayName,
    state.dom.adminEmailRecipientEmail,
    state.dom.adminEmailRecipientStatus,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateAdminEmailRecipientForm() {
  clearAdminEmailRecipientValidationState();

  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();
  const displayName = String(state.dom.adminEmailRecipientDisplayName?.value || "").trim();
  const email = String(state.dom.adminEmailRecipientEmail?.value || "").trim();
  const status = String(state.dom.adminEmailRecipientStatus?.value || "").trim();

  if (!tenantId) {
    state.dom.adminEmailSetupCompanyId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the company before adding an approved validation recipient.");
    state.dom.adminEmailSetupCompanyId?.focus();
    return false;
  }

  if (!displayName) {
    state.dom.adminEmailRecipientDisplayName?.classList.add("is-invalid");
    // ADMIN EMAIL SETUP - STEP 1D-2
    // Recipient Label is the friendly mailbox label HR sees in Email Integration.
    showPageAlert("warning", "Enter a clear recipient label for the approved validation recipient.");
    state.dom.adminEmailRecipientDisplayName?.focus();
    return false;
  }

  if (!isCompanyUserEmailValid(email)) {
    state.dom.adminEmailRecipientEmail?.classList.add("is-invalid");
    showPageAlert("warning", "Enter a valid approved validation recipient email address.");
    state.dom.adminEmailRecipientEmail?.focus();
    return false;
  }

  if (!status) {
    state.dom.adminEmailRecipientStatus?.classList.add("is-invalid");
    showPageAlert("warning", "Select the approved validation recipient status.");
    state.dom.adminEmailRecipientStatus?.focus();
    return false;
  }

  return true;
}

function buildAdminEmailRecipientPayload() {
  return {
    tenant_id: String(state.dom.adminEmailSetupCompanyId?.value || "").trim(),
    display_name: String(state.dom.adminEmailRecipientDisplayName?.value || "").trim(),
    recipient_email: String(state.dom.adminEmailRecipientEmail?.value || "").trim().toLowerCase(),
    status: String(state.dom.adminEmailRecipientStatus?.value || "Active").trim(),
    created_by: state.currentUser?.id || null,
    updated_at: new Date().toISOString(),
  };
}

function setAdminEmailRecipientSaveLoading(isLoading) {
  const button = state.dom.saveAdminEmailRecipientBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Recipient...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  delete button.dataset.isLoading;
  updateAdminEmailRecipientSaveButtonState();
}

function resetAdminEmailRecipientForm(options = {}) {
  const { preserveCompany = false } = options;
  const selectedCompanyId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

  state.currentEditingAdminEmailRecipient = null;

  if (state.dom.editingAdminEmailRecipientId) {
    state.dom.editingAdminEmailRecipientId.value = "";
  }

  if (state.dom.adminEmailRecipientDisplayName) {
    state.dom.adminEmailRecipientDisplayName.value = "";
  }

  if (state.dom.adminEmailRecipientEmail) {
    state.dom.adminEmailRecipientEmail.value = "";
  }

  if (state.dom.adminEmailRecipientStatus) {
    state.dom.adminEmailRecipientStatus.value = "Active";
  }

  if (!preserveCompany && state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = "";
  }

  if (preserveCompany && selectedCompanyId && state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = selectedCompanyId;
  }

  state.dom.cancelAdminEmailRecipientEditBtn?.classList.add("d-none");

  if (state.dom.saveAdminEmailRecipientBtn) {
    state.dom.saveAdminEmailRecipientBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveAdminEmailRecipientBtnText">Add Approved Recipient</span>
    `;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  clearAdminEmailRecipientValidationState();
  updateAdminEmailRecipientSaveButtonState();
}

async function refreshAdminEmailSetupWorkspace(options = {}) {
  const { showAlert = false, preserveCompany = false } = options;
  const selectedCompanyIdBeforeRefresh = String(
    state.dom.adminEmailSetupCompanyId?.value || "",
  ).trim();

  try {
    setAdminActionButtonLoading(
      state.dom.refreshAdminEmailSetupBtn,
      true,
      "Refreshing Email Setup...",
    );

    populateAdminEmailSetupCompanyOptions();

    if (
      preserveCompany &&
      selectedCompanyIdBeforeRefresh &&
      state.dom.adminEmailSetupCompanyId
    ) {
      const stillExists = Array.from(state.dom.adminEmailSetupCompanyId.options)
        .some((option) => option.value === selectedCompanyIdBeforeRefresh);

      if (stillExists) {
        state.dom.adminEmailSetupCompanyId.value = selectedCompanyIdBeforeRefresh;
      }
    }

    const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

    if (!tenantId) {
      state.adminEmailSetupRecipients = [];
      state.adminEmailSetupLogs = [];
      renderAdminEmailRecipients([]);
      renderAdminEmailDeliveryLogs([]);

      if (showAlert) {
        showPageAlert("warning", "Create or activate a company before configuring Email Setup.");
      }

      return;
    }

    const supabase = getSupabaseClient();

    const [recipientsResponse, logsResponse] = await Promise.all([
      supabase
        .from("email_integration_test_recipients")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false }),

      supabase
        .from("email_delivery_logs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (recipientsResponse.error) throw recipientsResponse.error;
    if (logsResponse.error) throw logsResponse.error;

    state.adminEmailSetupRecipients = Array.isArray(recipientsResponse.data)
      ? recipientsResponse.data
      : [];

    state.adminEmailSetupLogs = Array.isArray(logsResponse.data)
      ? logsResponse.data
      : [];

    renderAdminEmailRecipients(state.adminEmailSetupRecipients);
    renderAdminEmailDeliveryLogs(state.adminEmailSetupLogs);
    updateAdminEmailRecipientSaveButtonState();

    if (showAlert) {
      showPageAlert("success", "Email Setup was refreshed successfully.");
    }
  } catch (error) {
    console.error("Error refreshing Admin Email Setup:", error);

    state.adminEmailSetupRecipients = [];
    state.adminEmailSetupLogs = [];
    renderAdminEmailRecipients([]);
    renderAdminEmailDeliveryLogs([]);

    showPageAlert(
      "danger",
      error.message || "Email Setup could not be loaded.",
    );
  } finally {
    setAdminActionButtonLoading(state.dom.refreshAdminEmailSetupBtn, false);
  }
}

function startAdminEmailRecipientEdit(recipientId) {
  const recipient = getAdminEmailRecipientById(recipientId);

  if (!recipient) {
    showPageAlert(
      "warning",
      "The selected approved validation recipient could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingAdminEmailRecipient = recipient;

  openAdminEmailSetupPanel();

  if (state.dom.editingAdminEmailRecipientId) {
    state.dom.editingAdminEmailRecipientId.value = recipient.id || "";
  }

  if (state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = recipient.tenant_id || "";
  }

  if (state.dom.adminEmailRecipientDisplayName) {
    state.dom.adminEmailRecipientDisplayName.value = recipient.display_name || "";
  }

  if (state.dom.adminEmailRecipientEmail) {
    state.dom.adminEmailRecipientEmail.value = recipient.recipient_email || "";
  }

  if (state.dom.adminEmailRecipientStatus) {
    state.dom.adminEmailRecipientStatus.value = recipient.status || "Active";
  }

  state.dom.cancelAdminEmailRecipientEditBtn?.classList.remove("d-none");

  if (state.dom.saveAdminEmailRecipientBtn) {
    state.dom.saveAdminEmailRecipientBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveAdminEmailRecipientBtnText">Update Approved Recipient</span>
    `;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  updateAdminEmailRecipientSaveButtonState();

  focusAdminFieldWithoutJump(state.dom.adminEmailRecipientDisplayName);
  scrollToAdminOpenedPanel(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    150,
  );
}

function openAdminEmailSetupPanel() {
  // ADMIN COMPANIES SUB-WORKSPACE NAVIGATION - v1.0.0
  switchAdminCompaniesSubWorkspace("email");

  setAdminDashboardCardExpanded(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    true,
  );
}

// ADMIN DELETE ACTIONS - STEP 1
// Approved validation recipients are Admin-created setup records.
// Deleting removes the row from Supabase and from HR Email Integration options.
async function deleteAdminEmailRecipientRecord(recipientId = "") {
  const recipient = getAdminEmailRecipientById(recipientId);

  if (!recipient) {
    showPageAlert(
      "warning",
      "The selected approved validation recipient could not be found. Please refresh and try again.",
    );
    return;
  }

  const displayName = String(recipient.display_name || "this recipient").trim();
  const email = String(recipient.recipient_email || "--").trim();

  const confirmed = window.confirm(
    `Delete approved validation recipient "${displayName}"?\n\n` +
    `${email}\n\n` +
    "This will remove the recipient from Supabase and from the HR Email Integration dropdown for this company."
  );

  if (!confirmed) return;

  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("email_integration_test_recipients")
      .delete()
      .eq("id", String(recipient.id || "").trim());

    if (error) throw error;

    await refreshAdminEmailSetupWorkspace({ preserveCompany: true });

    resetAdminEmailRecipientForm({ preserveCompany: true });
    openAdminEmailSetupPanel();

    showPageAlert(
      "success",
      `Approved validation recipient "${displayName}" was deleted successfully.`,
    );

    showDashboardToast(
      "success",
      "Recipient deleted",
      `${displayName} was removed from approved validation recipients.`,
    );
  } catch (error) {
    console.error("Error deleting approved validation recipient:", error);

    showPageAlert(
      "danger",
      error.message || "Approved validation recipient could not be deleted.",
    );

    showDashboardToast(
      "danger",
      "Recipient delete failed",
      error.message || "Approved validation recipient could not be deleted.",
    );
  }
}

async function saveAdminEmailRecipient() {
  if (!validateAdminEmailRecipientForm()) {
    updateAdminEmailRecipientSaveButtonState();
    return;
  }

  const payload = buildAdminEmailRecipientPayload();
  const editingId = String(
    state.currentEditingAdminEmailRecipient?.id ||
    state.dom.editingAdminEmailRecipientId?.value ||
    "",
  ).trim();

  try {
    setAdminEmailRecipientSaveLoading(true);

    const supabase = getSupabaseClient();

    let response;

    if (editingId) {
      const updatePayload = { ...payload };
      delete updatePayload.created_by;

      response = await supabase
        .from("email_integration_test_recipients")
        .update(updatePayload)
        .eq("id", editingId)
        .select("*")
        .maybeSingle();
    } else {
      response = await supabase
        .from("email_integration_test_recipients")
        .insert([payload])
        .select("*")
        .maybeSingle();
    }

    if (response.error) throw response.error;

    await refreshAdminEmailSetupWorkspace({ preserveCompany: true });

    showPageAlert(
      "success",
      `Approved validation recipient was ${editingId ? "updated" : "added"} successfully.`,
    );

    showDashboardToast(
      "success",
      editingId ? "Recipient updated" : "Recipient added",
      "HR Email Integration will now reflect the approved recipient for the selected company.",
    );

    resetAdminEmailRecipientForm({ preserveCompany: true });

    openAdminEmailSetupPanel();

    window.requestAnimationFrame(() => {
      scrollToAdminDashboardTarget(
        state.dom.adminEmailRecipientsHeader ||
        state.dom.adminEmailRecipientsTableWrapper ||
        state.dom.adminEmailSetupCollapse,
        96,
      );
    });
  } catch (error) {
    console.error("Error saving approved validation recipient:", error);

    const message = String(error.message || "").toLowerCase();

    if (
      message.includes("duplicate key value") ||
      message.includes("recipient_email") ||
      message.includes("email_integration_test_recipients")
    ) {
      showPageAlert(
        "warning",
        "This approved validation recipient email already exists. Edit the existing recipient instead.",
      );
      return;
    }

    showPageAlert(
      "danger",
      error.message || "Approved validation recipient could not be saved.",
    );
  } finally {
    setAdminEmailRecipientSaveLoading(false);
  }
}
// ADMIN COMPANY USER BOOTSTRAP - STEP 1D
// Email validation is kept lightweight and client-side only.
// The Edge Function remains the authoritative security boundary.
function isCompanyUserEmailValid(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function clearCompanyUserInviteAlert() {
  const alert = state.dom.companyUserInviteAlert;
  if (!alert) return;

  alert.className = "alert d-none mb-3";
  alert.textContent = "";
}

function showCompanyUserInviteAlert(type, message) {
  const alert = state.dom.companyUserInviteAlert;
  if (!alert) {
    showPageAlert(type, message);
    return;
  }

  alert.className = `alert alert-${type} mb-3`;
  alert.textContent = message;
}

function clearCompanyUserInviteValidationState() {
  [
    state.dom.companyUserFullName,
    state.dom.companyUserEmail,
    state.dom.companyUserRole,
    state.dom.companyUserTenantId,
    state.dom.companyUserDepartment,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function updateCompanyUserInviteButtonState() {
  const button = state.dom.inviteCompanyUserBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const fullName = String(state.dom.companyUserFullName?.value || "").trim();
  const email = String(state.dom.companyUserEmail?.value || "").trim();
  const role = String(state.dom.companyUserRole?.value || "").trim();
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();
  // ADMIN COMPANY USER BOOTSTRAP - STEP 1E
  // Department is optional during first company-user bootstrap.
  // A newly created company may not have HR departments configured yet,
  // so Admin must still be able to invite the first HR user.
  const canSubmit = Boolean(
    fullName &&
    isCompanyUserEmailValid(email) &&
    role &&
    tenantId,
  );

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function validateCompanyUserInviteForm() {
  clearCompanyUserInviteValidationState();
  clearCompanyUserInviteAlert();

  const fullName = String(state.dom.companyUserFullName?.value || "").trim();
  const email = String(state.dom.companyUserEmail?.value || "").trim();
  const role = String(state.dom.companyUserRole?.value || "").trim();
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  if (!fullName) {
    state.dom.companyUserFullName?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Enter the company user's full name.");
    state.dom.companyUserFullName?.focus();
    return false;
  }

  if (!isCompanyUserEmailValid(email)) {
    state.dom.companyUserEmail?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Enter a valid email address.");
    state.dom.companyUserEmail?.focus();
    return false;
  }

  if (!role) {
    state.dom.companyUserRole?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Select the company user role.");
    state.dom.companyUserRole?.focus();
    return false;
  }

  if (!tenantId) {
    state.dom.companyUserTenantId?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Select the company workspace.");
    state.dom.companyUserTenantId?.focus();
    return false;
  }

  // ADMIN COMPANY USER BOOTSTRAP - STEP 1E
  // Department is optional here. Admin may be creating the first HR user before
  // the company has configured departments in the HR workspace.
  return true;
}

function getSelectedCompanyUserTenant() {
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  if (!tenantId) return null;

  return getTenantByTenantId(tenantId);
}

function buildCompanyUserInvitePayload() {
  const tenant = getSelectedCompanyUserTenant();

  return {
    fullName: String(state.dom.companyUserFullName?.value || "").trim(),
    email: String(state.dom.companyUserEmail?.value || "").trim().toLowerCase(),
    role: String(state.dom.companyUserRole?.value || "hr").trim().toLowerCase(),
    tenantId: String(tenant?.id || state.dom.companyUserTenantId?.value || "").trim(),
    companyName: String(tenant?.company_name || "").trim(),
    department: String(state.dom.companyUserDepartment?.value || "").trim(),
  };
}

function setCompanyUserInviteLoading(isLoading) {
  const button = state.dom.inviteCompanyUserBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    if (!button.dataset.originalClass) {
      button.dataset.originalClass = button.className;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Sending Invite...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  button.className =
    button.dataset.originalClass || "btn btn-secondary dashboard-action-btn";

  delete button.dataset.originalClass;
  delete button.dataset.isLoading;

  updateCompanyUserInviteButtonState();
}

function resetCompanyUserInviteForm() {
  if (state.dom.companyUserInviteForm) {
    state.dom.companyUserInviteForm.reset();
  }

  clearCompanyUserInviteValidationState();
  updateCompanyUserInviteButtonState();
}

// ADMIN-CREATED COMPANY USERS TO EMPLOYEE RECORDS - STEP 3A
// After Admin successfully invites a company HR/Manager/Employee user,
// create or link the minimal employee shell via secure Supabase RPC.
// This keeps Admin from writing directly to employees in frontend code.
async function syncCompanyUserEmployeeRecord(payload = {}) {
  const role = String(payload.role || "").trim().toLowerCase();

  if (!["hr", "manager", "employee"].includes(role)) {
    return {
      success: true,
      skipped: true,
      action: "skipped_role",
      message: "This role does not require an employee record.",
    };
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc(
    "admin_sync_company_user_employee",
    {
      p_email: String(payload.email || "").trim().toLowerCase(),
      p_tenant_id: String(payload.tenantId || "").trim(),
      p_full_name: String(payload.fullName || "").trim(),
      p_role: role,
      p_department: String(payload.department || "").trim() || null,
    },
  );

  if (error) {
    console.error("Admin company user employee sync error:", error);

    return {
      success: false,
      action: "sync_failed",
      message:
        String(error?.message || "").trim() ||
        "Employee record could not be created after invite.",
    };
  }

  const result = Array.isArray(data) ? data[0] : data;

  return {
    success: Boolean(result?.success),
    skipped: false,
    action: String(result?.action || "").trim(),
    employeeId: String(result?.employee_id || "").trim(),
    employeeNumber: String(result?.employee_number || "").trim(),
    message:
      String(result?.message || "").trim() ||
      "Employee record sync completed.",
  };
}

// ADMIN EDGE FUNCTION ERROR MESSAGE FIX
// Read the structured message returned by a failed Supabase Edge Function.
// FunctionsHttpError exposes the backend Response through error.context,
// while error.message usually contains only the generic non-2xx wording.
async function getAdminEdgeFunctionErrorMessage(
  error,
  fallbackMessage = "The requested admin action could not be completed.",
) {
  const fallback =
    String(error?.message || "").trim() ||
    String(fallbackMessage || "").trim();

  const response = error?.context || null;

  if (response && typeof response.clone === "function") {
    try {
      const responseText = await response.clone().text();

      if (responseText) {
        try {
          const parsed = JSON.parse(responseText);

          return (
            String(parsed?.message || parsed?.error || "").trim() ||
            responseText.trim() ||
            fallback
          );
        } catch {
          return responseText.trim() || fallback;
        }
      }
    } catch (responseReadError) {
      console.warn(
        "Admin Edge Function error response could not be read:",
        responseReadError,
      );
    }
  }

  return fallback;
}

async function inviteCompanyUser() {
  if (!validateCompanyUserInviteForm()) {
    updateCompanyUserInviteButtonState();
    return;
  }

  const payload = buildCompanyUserInvitePayload();

  try {
    setCompanyUserInviteLoading(true);
    clearCompanyUserInviteAlert();

    const supabase = getSupabaseClient();

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Secure backend creates/invites Auth user, creates profile, and links
    // profile to the selected company tenant. Frontend never creates Auth users.
    const { data, error } = await supabase.functions.invoke(
      "invite-company-user",
      {
        body: payload,
      },
    );

    if (error) throw error;

    // ADMIN-CREATED COMPANY USERS TO EMPLOYEE RECORDS - STEP 3A
    // Invite/profile access must succeed first. Then create/link the employee
    // shell so HR, Manager, and Employee users appear in the HR Employee List
    // and can later be used for payroll, leave, and self-service.
    const employeeSyncResult = await syncCompanyUserEmployeeRecord(payload);

    const employeeSyncSucceeded = Boolean(employeeSyncResult?.success);
    const employeeSyncNumber = String(employeeSyncResult?.employeeNumber || "").trim();

    const employeeSyncNote = employeeSyncSucceeded
      ? employeeSyncNumber
        ? ` Employee record ${employeeSyncNumber} is ready for HR/payroll.`
        : " Employee record is ready for HR/payroll."
      : ` Invite succeeded, but employee record sync needs review: ${employeeSyncResult?.message || "No employee record was created."
      }`;

    showCompanyUserInviteAlert(
      employeeSyncSucceeded ? "success" : "warning",
      `${data?.message ||
      `${payload.fullName} has been invited to ${payload.companyName || "the selected company"}.`
      }${employeeSyncNote}`,
    );

    showPageAlert(
      employeeSyncSucceeded ? "success" : "warning",
      `${data?.message ||
      `${payload.fullName} has been invited successfully.`
      }${employeeSyncNote}`,
    );

    showDashboardToast(
      employeeSyncSucceeded ? "success" : "warning",
      employeeSyncSucceeded
        ? "Company user invited"
        : "Invite sent, employee sync pending",
      employeeSyncSucceeded
        ? `${payload.fullName} was invited and linked to an employee record${employeeSyncNumber ? ` (${employeeSyncNumber})` : ""}.`
        : employeeSyncNote,
    );

    resetCompanyUserInviteForm();

    // ADMIN-CREATED COMPANY USERS TO EMPLOYEE RECORDS - STEP 3A
    // Refresh access records so the newly created profile appears in the
    // existing User Access Records table. The employee record will appear
    // in the selected company's HR Employee List after HR refreshes/logs in.
    await refreshProfileTenantLinkingWorkspace();

    redirectToAdminUserCompanyLinksAfterSave();
  } catch (error) {
    console.error("Company user invite error:", error);

    const message = await getAdminEdgeFunctionErrorMessage(
      error,
      "Company user invite could not be sent.",
    );

    showCompanyUserInviteAlert("danger", message);
    showPageAlert("danger", message);

    showDashboardToast(
      "danger",
      "Invite failed",
      message,
    );
  } finally {
    setCompanyUserInviteLoading(false);
  }
}

function updateProfileTenantLinkSaveButtonState() {
  const canSubmit = Boolean(
    String(state.dom.profileTenantProfileId?.value || "").trim() &&
    String(state.dom.profileTenantTenantId?.value || "").trim(),
  );

  const button = state.dom.saveProfileTenantLinkBtn;
  if (!button) return;

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearProfileTenantLinkValidationState() {
  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateProfileTenantLinkForm() {
  clearProfileTenantLinkValidationState();

  const profileId = String(state.dom.profileTenantProfileId?.value || "").trim();
  const tenantId = String(state.dom.profileTenantTenantId?.value || "").trim();

  if (!profileId) {
    state.dom.profileTenantProfileId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the user/profile for access setup.");
    state.dom.profileTenantProfileId?.focus();
    return false;
  }

  if (!tenantId) {
    state.dom.profileTenantTenantId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the company for this user.");
    state.dom.profileTenantTenantId?.focus();
    return false;
  }

  return true;
}

function setProfileTenantLinkSaveLoading(isLoading) {
  const button = state.dom.saveProfileTenantLinkBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Access Setup...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();
}

function resetProfileTenantLinkForm() {
  state.currentEditingProfileTenantLink = null;

  if (state.dom.editingProfileTenantLinkProfileId) {
    state.dom.editingProfileTenantLinkProfileId.value = "";
  }

  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    if (field) {
      field.value = "";
      field.classList.remove("is-invalid");
    }
  });

  state.dom.cancelProfileTenantLinkEditBtn?.classList.add("d-none");

  if (state.dom.saveProfileTenantLinkBtn) {
    // ADMIN USER ACCESS AUTHORITATIVE UI - v1.0.0
    // Default state communicates the actual Admin operation.
    state.dom.saveProfileTenantLinkBtn.innerHTML = `
  <i class="bi bi-arrow-left-right me-2"></i>
  <span id="saveProfileTenantLinkBtnText">Change Company Access</span>
`;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();
}

function renderProfileTenantLinksLoadingState() {
  if (!state.dom.profileTenantLinksTableBody) return;

  state.dom.profileTenantLinksEmptyState?.classList.add("d-none");
  state.dom.profileTenantLinksTableWrapper?.classList.remove("d-none");

  state.dom.profileTenantLinksTableBody.innerHTML = `
    <tr>
      <td colspan="4" class="text-center text-secondary py-4">
        Loading user access records.
      </td>
    </tr>
  `;
}

function renderProfileTenantLinks(records = []) {
  const tbody = state.dom.profileTenantLinksTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!records.length) {
    state.dom.profileTenantLinksEmptyState?.classList.remove("d-none");
    state.dom.profileTenantLinksTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.profileTenantLinksEmptyState?.classList.add("d-none");
  state.dom.profileTenantLinksTableWrapper?.classList.remove("d-none");

  // ADMIN ACCESS RECORDS UX CLEANUP - STEP 1E-3
  // Group records by company and remove the repeated Company column from
  // user rows. The company name is shown once, boldly, in the group header.
  // Existing edit, reset password, refresh, profile, tenant, and role logic
  // is preserved.
  const groupedRecords = new Map();

  [...records]
    .sort((a, b) => {
      const tenantA = getTenantByTenantId(a.tenant_id);
      const tenantB = getTenantByTenantId(b.tenant_id);

      const companyCompare = String(tenantA?.company_name || "Not linked")
        .localeCompare(String(tenantB?.company_name || "Not linked"), undefined, {
          sensitivity: "base",
        });

      if (companyCompare !== 0) return companyCompare;

      const roleCompare = String(a.role || "--")
        .localeCompare(String(b.role || "--"), undefined, {
          sensitivity: "base",
        });

      if (roleCompare !== 0) return roleCompare;

      return getProfileDisplayName(a).localeCompare(getProfileDisplayName(b), undefined, {
        sensitivity: "base",
      });
    })
    .forEach((profile) => {
      const tenant = getTenantByTenantId(profile.tenant_id);
      const companyName = tenant?.company_name || "Not linked";
      const companyCode = tenant?.tenant_code || "--";
      const companyKey = `${companyName}|${companyCode}`;

      if (!groupedRecords.has(companyKey)) {
        groupedRecords.set(companyKey, {
          companyName,
          companyCode,
          profiles: [],
        });
      }

      groupedRecords.get(companyKey).profiles.push(profile);
    });

  Array.from(groupedRecords.values()).forEach((companyGroup, companyIndex) => {
    const companyContentRowId = `adminAccessCompanyContent${companyIndex}`;
    const companyUserCount = companyGroup.profiles.length;

    const companyHeaderRow = document.createElement("tr");
    companyHeaderRow.className = "admin-access-company-header-row";

    companyHeaderRow.innerHTML = `
      <td colspan="4" class="p-0">
        <button
          type="button"
          class="admin-access-company-toggle"
          aria-expanded="false"
          aria-controls="${escapeHtml(companyContentRowId)}"
          onclick="
            const contentRow = document.getElementById('${escapeHtml(companyContentRowId)}');
            const expanded = this.getAttribute('aria-expanded') === 'true';
            if (contentRow) contentRow.classList.toggle('d-none', expanded);
            this.setAttribute('aria-expanded', String(!expanded));
            this.querySelector('[data-company-toggle-icon]')?.classList.toggle('bi-chevron-up', !expanded);
            this.querySelector('[data-company-toggle-icon]')?.classList.toggle('bi-chevron-down', expanded);
          "
        >
          <span class="admin-access-company-title">
            <i class="bi bi-chevron-down text-secondary" data-company-toggle-icon></i>
            <span class="admin-access-company-name">${escapeHtml(companyGroup.companyName)}</span>
            <span class="admin-access-company-code">
              Company ID: ${escapeHtml(companyGroup.companyCode)}
            </span>
          </span>

          <span class="admin-access-company-count">
            ${escapeHtml(companyUserCount)} user${companyUserCount === 1 ? "" : "s"}
          </span>
        </button>
      </td>
    `;

    tbody.appendChild(companyHeaderRow);

    const companyRowsHtml = companyGroup.profiles
      .map((profile) => {
        const tenant = getTenantByTenantId(profile.tenant_id);
        const normalizedRole = String(profile.role || "").trim().toLowerCase();
        // ADMIN SYSTEM ROLE REFLECTION - v1.0.0
        // profiles.role is the secure dashboard/login route.
        // employees.system_role is the HR-selected business role shown to Admin.
        //
        // Keep both concepts separate:
        // - profile.role continues driving routing/security/MFA behaviour;
        // - employeeSystemRole is presentation-only for the User Access role pill.
        const employeeSystemRole = String(
          profile.employee_system_role || profile.role || "",
        )
          .trim()
          .toLowerCase();

        const employeeSystemRoleLabel = (() => {
          const roleLabels = {
            employee: "Employee",
            manager: "Manager",
            supervisor: "Supervisor",
            hr: "HR Standard",
            hr_manager: "HR Manager",
            payroll: "Payroll",
            payroll_manager: "Payroll Manager",
            leadership: "Leadership",
            executive: "Executive",
            auditor: "Auditor",
            qa_analyst: "QA Analyst",
            admin: "Admin",
            system_admin: "System Admin",
          };

          return (
            roleLabels[employeeSystemRole] ||
            employeeSystemRole
              .replace(/[_-]+/g, " ")
              .replace(/\b\w/g, (character) => character.toUpperCase()) ||
            "--"
          );
        })();
        const hrAccessRecord =
          normalizedRole === "hr"
            ? getHrAccessProfileById(profile.id)
            : null;
        const hrAccessLevel = String(
          hrAccessRecord?.hr_access_level || "",
        ).trim().toLowerCase();
        const isTenantAdministrator = hrAccessLevel === "tenant_admin";
        const hrAccessLabel = isTenantAdministrator
          ? "Company Admin"
          : "HR Officer";
        const hrAccessBadgeHtml =
          normalizedRole === "hr"
            ? hrAccessRecord
              ? `
                  <div class="mt-1">
                    <span class="badge rounded-pill ${isTenantAdministrator
                ? "text-bg-success"
                : "text-bg-light border text-secondary"
              }">
                      ${escapeHtml(hrAccessLabel)}
                    </span>
                  </div>
                `
              : `
                  <div class="small text-danger mt-1">
                    Access level unavailable
                  </div>
                `
            : "";
        const targetHrAccessLevel = isTenantAdministrator
          ? "standard"
          : "tenant_admin";
        const canChangeHrAccess =
          Boolean(hrAccessRecord) &&
          (
            isTenantAdministrator ||
            hrAccessRecord.is_active === true
          );
        const hrAccessActionButtonHtml =
          normalizedRole === "hr" && hrAccessRecord
            ? `
                <button
                  type="button"
                  class="btn btn-sm ${isTenantAdministrator
              ? "btn-outline-secondary"
              : "btn-outline-success"
            }"
                  title="${isTenantAdministrator
              ? "Return to standard HR Officer access"
              : canChangeHrAccess
                ? "Make Company Admin"
                : "Inactive HR profiles cannot be promoted"
            }"
                  ${canChangeHrAccess ? "" : "disabled"}
                  onclick="window.adminSetHrAccessLevel(
                    '${escapeHtml(profile.id)}',
                    '${escapeHtml(targetHrAccessLevel)}',
                    this
                  )"
                >
                  <i class="bi ${isTenantAdministrator
              ? "bi-person-dash"
              : "bi-person-badge"
            }"></i>
                </button>
              `
            : "";

        return `
          <tr>
            <td>
              <div class="fw-semibold">${escapeHtml(getProfileDisplayName(profile))}</div>
              <div class="text-secondary small text-break">${escapeHtml(profile.email || "--")}</div>
            </td>

            <td>
<!-- ADMIN SYSTEM ROLE REFLECTION - v1.0.0
     Display the authoritative HR-selected System Role.
     profile.role remains unchanged for security/routing logic. -->
<span class="admin-access-role-pill">
  ${escapeHtml(employeeSystemRoleLabel)}
</span>
              ${hrAccessBadgeHtml}
            </td>

            <td>
              <span class="admin-access-company-id-pill">
                ${escapeHtml(tenant?.tenant_code || "--")}
              </span>
            </td>

            <td class="text-center">
              <div class="d-flex gap-1 justify-content-center">
                <!-- ADMIN ACCESS RECORDS UX CLEANUP - STEP 1E-3
                     Existing edit action is preserved. -->
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary"
                  title="Edit user access setup"
                  onclick="window.adminEditProfileTenantLink('${escapeHtml(profile.id)}')"
                >
                  <i class="bi bi-pencil-square"></i>
                </button>

                <!-- ADMIN ACCESS RECORDS UX CLEANUP - STEP 1E-3
                     Existing password reset action is preserved. -->
                <button
                  type="button"
                  class="btn btn-sm btn-outline-warning"
                  title="Reset password"
                  onclick="window.adminResetUserPassword('${escapeHtml(profile.id)}')"
                >
                  <i class="bi bi-key"></i>
                </button>


                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  title="Remove company access"
                  onclick="window.adminRemoveProfileTenantAccess('${escapeHtml(profile.id)}')"
                >
                  <i class="bi bi-trash"></i>
                </button>

                ${String(profile.role || "").trim().toLowerCase() !== "admin"
            ? `
    <!-- ADMIN COMPLETE USER REMOVAL
         This is intentionally separate from Remove company access. -->
    <button
      type="button"
      class="btn btn-sm btn-danger"
      title="Permanently delete user"
      onclick="window.adminPermanentlyDeleteCompanyUser('${escapeHtml(profile.id)}')"
    >
      <i class="bi bi-person-x-fill"></i>
    </button>
  `
            : ""
          }

                ${String(profile.role || "").trim().toLowerCase() === "hr"
            ? `
                    <!-- HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
                         HR users are MFA-protected, so Admin gets a controlled
                         reset action beside the existing password reset action.
                         The browser does not delete factors directly. -->
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-danger"
                      title="Reset HR 2FA"
                      onclick="window.adminResetUserMfa('${escapeHtml(profile.id)}')"
                    >
                      <i class="bi bi-shield-lock"></i>
                    </button>
                  `
            : ""
          }

                ${hrAccessActionButtonHtml}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    const companyContentRow = document.createElement("tr");
    companyContentRow.id = companyContentRowId;
    // ADMIN USER ACCESS COMPANY GROUP DEFAULT STATE - v1.0.0
    // Keep each company header visible but hide its user rows until
    // Platform Admin explicitly expands that company group.
    companyContentRow.className =
      "admin-access-company-content-row d-none";

    companyContentRow.innerHTML = `
      <td colspan="4" class="p-0">
        <div class="admin-access-company-panel">
          <div class="admin-access-company-scroll" style="max-height: 360px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;">
            <div class="table-responsive">
              <table class="table align-middle mb-0 admin-access-company-inner-table">
                <colgroup>
                  <col style="width: 42%;">
                  <col style="width: 18%;">
                  <col style="width: 20%;">
                  <col style="width: 20%;">
                </colgroup>
                <tbody>
                  ${companyRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </td>
    `;

    tbody.appendChild(companyContentRow);
  });
}

async function refreshProfileTenantLinkingWorkspace() {
  renderProfileTenantLinksLoadingState();

  try {
    const supabase = getSupabaseClient();

    // HR TENANT ADMIN ACCESS - PHASE 2D
    // Keep existing company-link data and the dedicated HR access list behind
    // separate protected RPC contracts. The browser does not query profiles directly.
    const [
      { data: profileData, error: profileError },
      { data: hrAccessData, error: hrAccessError },
    ] = await Promise.all([
      supabase.rpc("admin_list_profiles_for_tenant_linking"),
      supabase.rpc("admin_list_hr_access_profiles"),
    ]);

    if (profileError) throw profileError;
    if (hrAccessError) throw hrAccessError;

    state.profilesForTenantLinking = Array.isArray(profileData)
      ? profileData
      : [];
    state.hrAccessProfiles = Array.isArray(hrAccessData)
      ? hrAccessData
      : [];

    populateProfileTenantProfileOptions();
    populateProfileTenantTenantOptions();
    renderProfileTenantLinks(state.profilesForTenantLinking);

    // ADMIN UI CLEANUP - STEP 1E
    // Keep Overview user/company link counts in sync after profile link refresh.
    renderAdminOverviewSummary();
  } catch (error) {
    console.error("Error loading profiles for tenant linking:", error);

    state.profilesForTenantLinking = [];
    state.hrAccessProfiles = [];
    renderProfileTenantLinks([]);

    showPageAlert(
      "danger",
      error.message || "User access records could not be loaded.",
    );
  }
}

function getProfileForTenantLinkById(profileId = "") {
  const id = String(profileId || "").trim();

  if (!id) return null;

  return (state.profilesForTenantLinking || []).find(
    (profile) => String(profile.id || "").trim() === id,
  ) || null;
}

// HR TENANT ADMIN ACCESS - PHASE 2D
// Match the dedicated access-management record returned by the protected RPC.
function getHrAccessProfileById(profileId = "") {
  const id = String(profileId || "").trim();

  if (!id) return null;

  return (state.hrAccessProfiles || []).find(
    (profile) => String(profile.profile_id || "").trim() === id,
  ) || null;
}

// HR TENANT ADMIN ACCESS - PHASE 2D
// Platform Admin may promote an active HR Officer to Tenant Administrator or
// return a Tenant Administrator to standard HR access. Authorization and the
// actual write remain inside admin_set_hr_access_level.
async function setHrAccessLevel(
  profileId,
  targetAccessLevel,
  actionButton = null,
) {
  const profile = getProfileForTenantLinkById(profileId);
  const accessRecord = getHrAccessProfileById(profileId);
  const normalizedRole = String(profile?.role || "").trim().toLowerCase();
  const normalizedTarget = String(targetAccessLevel || "").trim().toLowerCase();

  if (!profile || normalizedRole !== "hr" || !accessRecord) {
    showPageAlert(
      "warning",
      "The selected HR access record could not be found. Refresh the access records and try again.",
    );
    return;
  }

  if (!["standard", "tenant_admin"].includes(normalizedTarget)) {
    showPageAlert("warning", "The requested HR access level is not valid.");
    return;
  }

  if (
    normalizedTarget === "tenant_admin" &&
    accessRecord.is_active !== true
  ) {
    showPageAlert(
      "warning",
      "An inactive HR profile cannot be made a Company Admin.",
    );
    return;
  }

  const displayName = getProfileDisplayName(profile);
  const isPromotion = normalizedTarget === "tenant_admin";
  const confirmationMessage = isPromotion
    ? `Make ${displayName} a Company Admin?`
    : `Return ${displayName} to standard HR Officer access?`;

  if (!window.confirm(confirmationMessage)) {
    return;
  }

  const originalHtml = actionButton?.innerHTML || "";
  const originalDisabled = actionButton?.disabled === true;

  try {
    if (actionButton) {
      actionButton.disabled = true;
      actionButton.innerHTML = `
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      `;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc(
      "admin_set_hr_access_level",
      {
        target_profile_id: profileId,
        target_hr_access_level: normalizedTarget,
      },
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    const expectedAccessLevel = result?.hr_access_level || normalizedTarget;

    if (expectedAccessLevel !== normalizedTarget) {
      throw new Error("The HR access level response did not match the requested change.");
    }

    await refreshProfileTenantLinkingWorkspace();

    const successMessage = isPromotion
      ? `${displayName} is now a Company Admin.`
      : `${displayName} now has standard HR Officer access.`;

    showPageAlert("success", successMessage);
    showDashboardToast(
      "success",
      "HR access updated",
      successMessage,
    );
  } catch (error) {
    console.error("Error changing HR access level:", error);

    showPageAlert(
      "danger",
      error.message || "The HR access level could not be changed.",
    );
  } finally {
    if (actionButton?.isConnected) {
      actionButton.disabled = originalDisabled;
      actionButton.innerHTML = originalHtml;
    }
  }
}

function startProfileTenantLinkEdit(profileId) {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "The selected user/profile could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingProfileTenantLink = profile;
  // ADMIN UI CLEANUP - STEP 1I
  // If User Company Assignment is collapsed, open it before loading edit values.
  openAdminUserCompanyAssignmentPanel();

  if (state.dom.editingProfileTenantLinkProfileId) {
    state.dom.editingProfileTenantLinkProfileId.value = profile.id || "";
  }

  if (state.dom.profileTenantProfileId) {
    state.dom.profileTenantProfileId.value = profile.id || "";
  }

  if (state.dom.profileTenantTenantId) {
    state.dom.profileTenantTenantId.value = profile.tenant_id || "";
  }

  state.dom.cancelProfileTenantLinkEditBtn?.classList.remove("d-none");

  if (state.dom.saveProfileTenantLinkBtn) {
    // ADMIN USER ACCESS AUTHORITATIVE UI - v1.0.0
    // Present the business operation clearly: this changes the user's
    // assigned company rather than editing an abstract "profile link".
    state.dom.saveProfileTenantLinkBtn.innerHTML = `
  <i class="bi bi-arrow-left-right me-2"></i>
  <span id="saveProfileTenantLinkBtnText">Update Company Access</span>
`;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();

  // ADMIN USER ACCESS STANDALONE EDIT ROUTING - v1.0.0
  // The User Access workspace is now a transparent container with separate
  // operational cards. Editing access must land directly on the
  // Reassign Existing User card, not at the top of Invite Company User.
  focusAdminFieldWithoutJump(state.dom.profileTenantTenantId);

  scrollToAdminDashboardTarget(
    state.dom.profileTenantLinkForm?.closest(
      ".admin-user-access-reassign-card",
    ) || state.dom.profileTenantLinkForm,
    120,
  );
}

// =========================================================
// ADMIN REMOVE COMPANY ACCESS MODAL - v1.0.0
//
// Modern confirmation UI for removing company access.
//
// IMPORTANT:
// - This does NOT delete the Auth account.
// - This does NOT delete the employee record.
// - This does NOT alter the existing protected RPC.
// - Only the previous window.confirm() presentation is replaced.
// =========================================================

function clearRemoveCompanyAccessAlert() {
  const alert = state.dom.removeCompanyAccessAlert;

  if (!alert) return;

  alert.className = "alert d-none mt-3 mb-0";
  alert.textContent = "";
}

function showRemoveCompanyAccessAlert(type, message) {
  const alert = state.dom.removeCompanyAccessAlert;

  if (!alert) {
    showPageAlert(type, message);
    return;
  }

  alert.className = `alert alert-${type} mt-3 mb-0`;
  alert.textContent = message;
}

function clearRemoveCompanyAccessModal() {
  // Clear only modal state.
  // No company/profile data is changed here.
  state.currentRemoveCompanyAccessTarget = null;

  clearRemoveCompanyAccessAlert();

  if (state.dom.removeCompanyAccessConfirmBtn) {
    state.dom.removeCompanyAccessConfirmBtn.disabled = false;
  }
}


// Existing trash icon action.
// This now opens the controlled modal instead of window.confirm().
async function removeProfileTenantAccess(profileId = "") {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "The selected user profile could not be found. Please refresh and try again.",
    );
    return;
  }

  const profileName = getProfileDisplayName(profile);

  const profileEmail = String(
    profile.email || "--",
  ).trim();

  const tenant = getTenantByTenantId(
    profile.tenant_id,
  );

  const companyName = String(
    tenant?.company_name || "the assigned company",
  ).trim();

  // An already-unlinked user has nothing to remove.
  if (!String(profile.tenant_id || "").trim()) {
    showPageAlert(
      "info",
      `${profileName} is not currently linked to a company workspace.`,
    );
    return;
  }

  // Clear any previous modal target before assigning this one.
  clearRemoveCompanyAccessModal();

  state.currentRemoveCompanyAccessTarget = profile;

  if (state.dom.removeCompanyAccessTargetName) {
    state.dom.removeCompanyAccessTargetName.textContent =
      profileName;
  }

  if (state.dom.removeCompanyAccessTargetEmail) {
    state.dom.removeCompanyAccessTargetEmail.textContent =
      profileEmail;
  }

  if (state.dom.removeCompanyAccessTargetCompany) {
    state.dom.removeCompanyAccessTargetCompany.textContent =
      companyName;
  }

  clearRemoveCompanyAccessAlert();

  const modalEl =
    state.dom.removeCompanyAccessModal;

  if (!modalEl) {
    showPageAlert(
      "danger",
      "Remove Company Access confirmation could not be opened.",
    );
    return;
  }

  bootstrap.Modal
    .getOrCreateInstance(modalEl)
    .show();
}


// Performs the existing protected company-access removal.
//
// The backend contract is intentionally unchanged:
// admin_remove_profile_tenant_access(target_profile_id)
async function submitRemoveProfileTenantAccess() {
  const profile =
    state.currentRemoveCompanyAccessTarget;

  if (!profile?.id) {
    showRemoveCompanyAccessAlert(
      "warning",
      "The selected user could not be confirmed. Close this window and try again.",
    );
    return;
  }

  const profileName =
    getProfileDisplayName(profile);

  const tenant =
    getTenantByTenantId(profile.tenant_id);

  const companyName = String(
    tenant?.company_name || "the assigned company",
  ).trim();

  const button =
    state.dom.removeCompanyAccessConfirmBtn;

  try {
    clearRemoveCompanyAccessAlert();

    if (button) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml =
          button.innerHTML;
      }

      button.disabled = true;

      button.innerHTML = `
        <span
          class="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        ></span>
        Removing Access...
      `;
    }

    const supabase =
      getSupabaseClient();

    // EXISTING SECURE RPC - UNCHANGED
    const { data, error } =
      await supabase.rpc(
        "admin_remove_profile_tenant_access",
        {
          target_profile_id: String(
            profile.id || "",
          ).trim(),
        },
      );

    if (error) {
      throw error;
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (result && result.success === false) {
      throw new Error(
        result.message ||
        "User company access could not be removed.",
      );
    }

    // Close only after the protected RPC succeeds.
    const modalEl =
      state.dom.removeCompanyAccessModal;

    if (modalEl) {
      bootstrap.Modal
        .getOrCreateInstance(modalEl)
        .hide();
    }

    await refreshProfileTenantLinkingWorkspace();

    resetProfileTenantLinkForm();
    openAdminUserCompanyAssignmentPanel();

    showPageAlert(
      "success",
      `Company access was removed for ${profileName}.`,
    );

    showDashboardToast(
      "success",
      "Company access removed",
      `${profileName} can no longer access ${companyName}.`,
    );
  } catch (error) {
    console.error(
      "Error removing user company access:",
      error,
    );

    const message =
      String(error?.message || "").trim() ||
      "User company access could not be removed.";

    // Keep the modal open on failure.
    showRemoveCompanyAccessAlert(
      "danger",
      message,
    );

    showDashboardToast(
      "danger",
      "Access removal failed",
      message,
    );
  } finally {
    if (button?.dataset.originalHtml) {
      button.innerHTML =
        button.dataset.originalHtml;

      delete button.dataset.originalHtml;
    }

    if (button) {
      button.disabled = false;
    }
  }
}


// =========================================================
// ADMIN FORCE DELETE USER MODAL - v1.0.0
//
// Controlled replacement for the old chained window.prompt()
// and window.confirm() permanent-delete workflow.
//
// Security remains unchanged:
// - Platform Admin restrictions remain in the Edge Function;
// - the browser never receives a service-role key;
// - permanent deletion remains server-side;
// - the typed email is still sent as confirmationEmail.
// =========================================================

// ADMIN FORCE DELETE USER EMAIL NORMALISATION - v1.0.1
// Permanent-delete confirmation must compare what the Admin can actually see.
//
// Besides trimming and lowercasing, remove invisible Unicode formatting
// characters that can arrive through copied/autofilled email addresses.
//
// Important:
// - "+" aliases are preserved;
// - dots are preserved;
// - domains are preserved;
// - no Gmail-specific rewriting is performed;
// - backend confirmation remains authoritative.
function normalisePermanentDeleteConfirmationEmail(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

function clearPermanentDeleteUserAlert() {
  const alert = state.dom.permanentDeleteUserAlert;
  if (!alert) return;

  alert.className = "alert d-none mt-3 mb-0";
  alert.textContent = "";
}

function showPermanentDeleteUserAlert(type, message) {
  const alert = state.dom.permanentDeleteUserAlert;

  if (!alert) {
    showPageAlert(type, message);
    return;
  }

  alert.className = `alert alert-${type} mt-3 mb-0`;
  alert.textContent = message;
}

function updatePermanentDeleteUserContinueButtonState() {
  // ADMIN FORCE DELETE USER MODAL - CONFIRMATION MATCH FIX v1.0.1
  //
  // Use one shared normalisation rule for both stored and entered emails.
  // This prevents invisible copied/autofilled characters from leaving
  // Continue grey when the two addresses visibly match.

  const button =
    state.dom.permanentDeleteUserContinueBtn;

  if (!button) return;

  const expectedEmail =
    normalisePermanentDeleteConfirmationEmail(
      state.currentPermanentDeleteTarget?.email,
    );

  const enteredEmail =
    normalisePermanentDeleteConfirmationEmail(
      state.dom.permanentDeleteUserEmailInput?.value,
    );

  const isMatch =
    Boolean(expectedEmail) &&
    Boolean(enteredEmail) &&
    enteredEmail === expectedEmail;

  button.disabled = !isMatch;

  button.className = isMatch
    ? "btn btn-danger dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function showPermanentDeleteUserStageOne() {
  state.dom.permanentDeleteUserStageOne?.classList.remove("d-none");
  state.dom.permanentDeleteUserStageTwo?.classList.add("d-none");

  state.dom.permanentDeleteUserContinueBtn?.classList.remove("d-none");
  state.dom.permanentDeleteUserConfirmBtn?.classList.add("d-none");

  if (state.dom.permanentDeleteUserBackBtn) {
    state.dom.permanentDeleteUserBackBtn.textContent = "Cancel";
  }

  clearPermanentDeleteUserAlert();
  updatePermanentDeleteUserContinueButtonState();

  window.requestAnimationFrame(() => {
    state.dom.permanentDeleteUserEmailInput?.focus();

    // Recalculate after the modal has rendered so pasted/autofilled
    // confirmation values immediately unlock Continue when valid.
    updatePermanentDeleteUserContinueButtonState();
  });
}

function showPermanentDeleteUserStageTwo() {
  const profile = state.currentPermanentDeleteTarget;
  if (!profile) return;

  state.dom.permanentDeleteUserStageOne?.classList.add("d-none");
  state.dom.permanentDeleteUserStageTwo?.classList.remove("d-none");

  state.dom.permanentDeleteUserContinueBtn?.classList.add("d-none");
  state.dom.permanentDeleteUserConfirmBtn?.classList.remove("d-none");

  if (state.dom.permanentDeleteUserBackBtn) {
    state.dom.permanentDeleteUserBackBtn.textContent = "Go Back";
  }

  if (state.dom.permanentDeleteUserFinalName) {
    state.dom.permanentDeleteUserFinalName.textContent =
      getProfileDisplayName(profile);
  }

  if (state.dom.permanentDeleteUserFinalEmail) {
    state.dom.permanentDeleteUserFinalEmail.textContent =
      String(profile.email || "").trim().toLowerCase();
  }

  clearPermanentDeleteUserAlert();
}

function clearPermanentDeleteUserModal() {
  state.currentPermanentDeleteTarget = null;

  if (state.dom.permanentDeleteUserEmailInput) {
    state.dom.permanentDeleteUserEmailInput.value = "";
  }

  state.dom.permanentDeleteUserStageOne?.classList.remove("d-none");
  state.dom.permanentDeleteUserStageTwo?.classList.add("d-none");

  state.dom.permanentDeleteUserContinueBtn?.classList.remove("d-none");
  state.dom.permanentDeleteUserConfirmBtn?.classList.add("d-none");

  if (state.dom.permanentDeleteUserContinueBtn) {
    state.dom.permanentDeleteUserContinueBtn.disabled = true;
    state.dom.permanentDeleteUserContinueBtn.className =
      "btn btn-secondary dashboard-action-btn";
  }

  if (state.dom.permanentDeleteUserBackBtn) {
    state.dom.permanentDeleteUserBackBtn.textContent = "Cancel";
  }

  if (state.dom.permanentDeleteUserConfirmBtn) {
    state.dom.permanentDeleteUserConfirmBtn.disabled = false;
  }

  clearPermanentDeleteUserAlert();
}

function advancePermanentDeleteUserModal() {
  const profile = state.currentPermanentDeleteTarget;

  if (!profile) {
    showPermanentDeleteUserAlert(
      "warning",
      "The selected user could not be confirmed. Close this window and try again.",
    );
    return;
  }

  // ADMIN FORCE DELETE USER EMAIL NORMALISATION - v1.0.1
  // Use the exact same comparison rule as the Continue button state.
  const expectedEmail =
    normalisePermanentDeleteConfirmationEmail(
      profile.email,
    );

  const enteredEmail =
    normalisePermanentDeleteConfirmationEmail(
      state.dom.permanentDeleteUserEmailInput?.value,
    );

  if (!expectedEmail || enteredEmail !== expectedEmail) {
    showPermanentDeleteUserAlert(
      "warning",
      "Type the user's full email address exactly before continuing.",
    );
    updatePermanentDeleteUserContinueButtonState();
    return;
  }

  showPermanentDeleteUserStageTwo();
}

// Existing row action now opens the controlled modal only.
// No destructive request is made until the final red button is clicked.
async function permanentlyDeleteCompanyUser(profileId = "") {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "The selected user profile could not be found. Please refresh and try again.",
    );
    return;
  }

  const profileRole = String(profile.role || "")
    .trim()
    .toLowerCase();

  if (profileRole === "admin") {
    showPageAlert(
      "warning",
      "Platform Admin accounts cannot be permanently deleted from company user management.",
    );
    return;
  }

  const profileEmail = String(profile.email || "")
    .trim()
    .toLowerCase();

  if (!profileEmail) {
    showPageAlert(
      "warning",
      "The selected user does not have a valid email address.",
    );
    return;
  }

  clearPermanentDeleteUserModal();

  state.currentPermanentDeleteTarget = profile;

  const profileName = getProfileDisplayName(profile);

  if (state.dom.permanentDeleteUserTargetName) {
    state.dom.permanentDeleteUserTargetName.textContent = profileName;
  }

  if (state.dom.permanentDeleteUserTargetEmail) {
    state.dom.permanentDeleteUserTargetEmail.textContent = profileEmail;
  }

  if (state.dom.permanentDeleteUserFinalName) {
    state.dom.permanentDeleteUserFinalName.textContent = profileName;
  }

  if (state.dom.permanentDeleteUserFinalEmail) {
    state.dom.permanentDeleteUserFinalEmail.textContent = profileEmail;
  }

  showPermanentDeleteUserStageOne();

  const modalEl = state.dom.permanentDeleteUserModal;

  if (!modalEl) {
    showPageAlert(
      "danger",
      "Permanent delete confirmation could not be opened.",
    );
    return;
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}


// Final destructive action.
//
// IMPORTANT:
// This is the already-proven secure delete-company-user request.
// Only its trigger has moved from window.confirm() to the modal's
// Permanently Delete button.
async function submitPermanentDeleteCompanyUser() {
  const profile = state.currentPermanentDeleteTarget;

  if (!profile) {
    showPermanentDeleteUserAlert(
      "warning",
      "The selected user could not be confirmed. Close this window and try again.",
    );
    return;
  }

  const profileName = getProfileDisplayName(profile);

  // ADMIN FORCE DELETE USER EMAIL NORMALISATION - v1.0.1
  // Reuse the same canonical comparison immediately before the
  // secure destructive backend request.
  const profileEmail =
    normalisePermanentDeleteConfirmationEmail(
      profile.email,
    );

  const enteredEmail =
    normalisePermanentDeleteConfirmationEmail(
      state.dom.permanentDeleteUserEmailInput?.value,
    );

  // Re-check immediately before the destructive request.
  if (!profileEmail || enteredEmail !== profileEmail) {
    showPermanentDeleteUserStageOne();

    showPermanentDeleteUserAlert(
      "warning",
      "The confirmation email no longer matches the selected user.",
    );

    return;
  }

  const confirmButton = state.dom.permanentDeleteUserConfirmBtn;

  try {
    if (confirmButton) {
      if (!confirmButton.dataset.originalHtml) {
        confirmButton.dataset.originalHtml = confirmButton.innerHTML;
      }

      confirmButton.disabled = true;

      confirmButton.innerHTML = `
        <span
          class="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        ></span>
        Permanently Deleting...
      `;
    }

    const supabase = getSupabaseClient();

    // ADMIN COMPLETE USER REMOVAL - AUTH REPAIR v1.0.0
    // Read the current signed-in Admin bearer token explicitly.
    // Admin authority remains verified by delete-company-user.
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(
        sessionError.message ||
        "Your Admin session could not be read. Please sign out and sign in again.",
      );
    }

    const accessToken = String(
      sessionData?.session?.access_token || "",
    ).trim();

    if (!accessToken) {
      throw new Error(
        "Your Admin session has expired or could not be found. Please sign out and sign in again before deleting a user.",
      );
    }

    const { data, error } = await supabase.functions.invoke(
      "delete-company-user",
      {
        body: {
          profileId: String(profile.id || "").trim(),
          confirmationEmail: profileEmail,
        },

        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (error) {
      const message = await getAdminEdgeFunctionErrorMessage(
        error,
        "The secure permanent-delete function could not be reached.",
      );

      throw new Error(message);
    }

    if (data?.success === false) {
      throw new Error(
        data?.error ||
        "The company user could not be permanently deleted.",
      );
    }

    // Close the destructive modal only after the backend succeeds.
    const modalEl = state.dom.permanentDeleteUserModal;

    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    await refreshProfileTenantLinkingWorkspace();

    resetProfileTenantLinkForm();
    openAdminUserCompanyAssignmentPanel();

    const message =
      data?.message ||
      `${profileName} was permanently deleted. The email and employee number are now reusable.`;

    showPageAlert("success", message);

    showDashboardToast(
      "success",
      "User permanently deleted",
      message,
    );
  } catch (error) {
    console.error(
      "Error permanently deleting company user:",
      error,
    );

    const message = await getAdminEdgeFunctionErrorMessage(
      error,
      "The company user could not be permanently deleted.",
    );

    // Keep the modal open when deletion fails so Admin can review
    // the selected user instead of losing the destructive context.
    showPermanentDeleteUserAlert(
      "danger",
      message,
    );

    showDashboardToast(
      "danger",
      "Permanent deletion failed",
      message,
    );
  } finally {
    if (confirmButton?.dataset.originalHtml) {
      confirmButton.innerHTML = confirmButton.dataset.originalHtml;
      delete confirmButton.dataset.originalHtml;
    }

    if (confirmButton) {
      confirmButton.disabled = false;
    }
  }
}

async function saveProfileTenantLink() {
  if (!validateProfileTenantLinkForm()) {
    updateProfileTenantLinkSaveButtonState();
    return;
  }

  const profileId = String(state.dom.profileTenantProfileId?.value || "").trim();
  const tenantId = String(state.dom.profileTenantTenantId?.value || "").trim();

  try {
    setProfileTenantLinkSaveLoading(true);

    const supabase = getSupabaseClient();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2B
    // Use the safe Admin RPC instead of updating profiles directly.
    // This keeps tenant assignment controlled without weakening profile RLS.
    const { error } = await supabase.rpc("admin_assign_profile_to_tenant", {
      target_profile_id: profileId,
      target_tenant_id: tenantId,
    });

    if (error) throw error;

    await refreshProfileTenantLinkingWorkspace();

    showPageAlert(
      "success",
      "User access setup was saved successfully.",
    );

    // ADMIN UI CLEANUP - STEP 1H
    // Keep user/company link feedback visible even when Admin is lower on the page.
    showDashboardToast(
      "success",
      "User access setup saved",
      "User access setup was saved successfully.",
    );

    resetProfileTenantLinkForm();

    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // After successful user/company assignment, open User Company Links and scroll there cleanly.
    redirectToAdminUserCompanyLinksAfterSave();
  } catch (error) {
    console.error("Error saving user tenant link:", error);

    showPageAlert(
      "danger",
      error.message || "User access setup could not be saved.",
    );
  } finally {
    setProfileTenantLinkSaveLoading(false);
  }
}

async function loadAdminProfileImages(profileImagePath, initials) {
  // ADMIN PROFILE PHOTO PARITY - REMOVE PICTURE
  // Remove Picture is available only when a saved image path exists.
  if (state.dom.removeAdminProfileImageBtn) {
    state.dom.removeAdminProfileImageBtn.disabled = !profileImagePath;
  }
  if (!profileImagePath) {
    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.textContent = initials;
      state.dom.adminProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.textContent = initials;
      state.dom.adminInitials.classList.remove("d-none");
    }

    if (state.dom.adminProfileImagePreview) {
      state.dom.adminProfileImagePreview.src = "";
      state.dom.adminProfileImagePreview.classList.add("d-none");
    }

    if (state.dom.adminHeroImage) {
      state.dom.adminHeroImage.src = "";
      state.dom.adminHeroImage.classList.add("d-none");
    }

    return;
  }

  const signedUrl = await getSignedAdminProfileImageUrl(profileImagePath);

  if (!signedUrl) {
    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.textContent = initials;
      state.dom.adminProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.textContent = initials;
      state.dom.adminInitials.classList.remove("d-none");
    }

    return;
  }

  if (state.dom.adminProfileImagePreview) {
    state.dom.adminProfileImagePreview.src = signedUrl;
    state.dom.adminProfileImagePreview.classList.remove("d-none");
  }

  if (state.dom.adminProfileAvatar) {
    state.dom.adminProfileAvatar.classList.add("d-none");
  }

  if (state.dom.adminHeroImage) {
    state.dom.adminHeroImage.src = signedUrl;
    state.dom.adminHeroImage.classList.remove("d-none");
  }

  if (state.dom.adminInitials) {
    state.dom.adminInitials.classList.add("d-none");
  }
}

async function loadLatestAdminProfile() {
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
    console.error("Error loading latest admin profile:", error);
    return state.currentProfile;
  }
}

async function getSignedAdminProfileImageUrl(filePath) {
  if (!filePath) return null;

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) throw error;

    return data?.signedUrl || null;
  } catch (error) {
    console.error("Error creating signed admin profile image URL:", error);
    return null;
  }
}



function renderAdminProfile(profile, user) {
  const fullName = profile?.full_name || "Administrator";
  const email = profile?.email || user?.email || "No email";
  const role = String(profile?.role || "admin").toLowerCase();
  const department = profile?.department || "";
  const initials = getInitials(fullName, "AD");

  // ADMIN AUTHORITATIVE APPLICATION HEADER - v1.0.0
  // Keep the compact account control aligned with the authenticated profile.
  const modernUserName =
    document.getElementById("adminModernUserName");

  const modernUserRole =
    document.getElementById("adminModernUserRole");

  if (modernUserName) {
    modernUserName.textContent = fullName;
  }

  // ADMIN OPERATIONAL OVERVIEW - v1.0.0
  // Keep the Overview greeting aligned with the authenticated Admin profile.
  const adminOverviewWelcomeName =
    document.getElementById("adminOverviewWelcomeName");

  if (adminOverviewWelcomeName) {
    const firstName =
      String(fullName || "Administrator")
        .trim()
        .split(/\s+/)
        .filter(Boolean)[0] ||
      "Administrator";

    adminOverviewWelcomeName.textContent = firstName;
  }

  if (modernUserRole) {
    modernUserRole.textContent =
      role === "admin"
        ? "Platform Admin"
        : role;
  }

  if (state.dom.adminInitials) {
    state.dom.adminInitials.textContent = initials;
    state.dom.adminInitials.classList.remove("d-none");
  }

  if (state.dom.adminHeroImage) {
    state.dom.adminHeroImage.src = "";
    state.dom.adminHeroImage.classList.add("d-none");
  }

  if (state.dom.adminEmail) {
    state.dom.adminEmail.textContent = email;
  }

  if (state.dom.adminRole) {
    state.dom.adminRole.textContent = role;
  }

  if (state.dom.adminFullName) {
    state.dom.adminFullName.textContent = fullName;
  }

  if (state.dom.adminEmailTile) {
    state.dom.adminEmailTile.textContent = email;
  }

  if (state.dom.adminRoleTile) {
    state.dom.adminRoleTile.textContent = role;
  }

  if (state.dom.adminDepartment) {
    state.dom.adminDepartment.textContent = department || "--";
  }

  if (state.dom.adminProfileAvatar) {
    state.dom.adminProfileAvatar.textContent = initials;
    state.dom.adminProfileAvatar.classList.remove("d-none");
  }

  if (state.dom.adminProfileImagePreview) {
    state.dom.adminProfileImagePreview.src = "";
    state.dom.adminProfileImagePreview.classList.add("d-none");
  }

  if (state.dom.adminProfileCardName) {
    state.dom.adminProfileCardName.textContent = fullName;
  }

  if (state.dom.adminProfileCardEmail) {
    state.dom.adminProfileCardEmail.textContent = email;
  }

  if (state.dom.adminProfileFullName) {
    state.dom.adminProfileFullName.value = fullName;
  }

  if (state.dom.adminProfileEmail) {
    state.dom.adminProfileEmail.value = email;
  }

  if (state.dom.adminProfileRole) {
    state.dom.adminProfileRole.value = role;
  }

  if (state.dom.adminProfileDepartment) {
    state.dom.adminProfileDepartment.value = department;
  }

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Render saved Admin profile photo after fallback initials are in place.
  void loadAdminProfileImages(profile?.profile_image_path, initials);

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // After profile data is rendered, capture the clean baseline and keep
  // Save Profile Changes grey until Admin edits an editable field.
  state.currentProfileEditableBaseline = getAdminProfileEditableSnapshot();
  updateAdminProfileSaveButtonState();
}

function updateAdminProfileImageSaveButtonState() {
  const button = state.dom.saveAdminProfileImageBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const hasValidPendingFile = Boolean(state.pendingProfileImageFile);

  button.disabled = !hasValidPendingFile;
  button.className = hasValidPendingFile
    ? "btn btn-outline-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function setAdminProfileImageSaveLoading(isLoading) {
  const button = state.dom.saveAdminProfileImageBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";
  button.disabled = true;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.className = "btn btn-secondary dashboard-action-btn";
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

  delete button.dataset.isLoading;
  updateAdminProfileImageSaveButtonState();
}

function sanitiseAdminProfileImageFileName(fileName = "") {
  return String(fileName || "profile-image")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "profile-image";
}

function handlePendingAdminProfileImage(file) {
  state.pendingProfileImageFile = null;

  if (!file) {
    if (state.currentProfile) {
      renderAdminProfile(state.currentProfile, state.currentUser);
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateAdminProfileImageSaveButtonState();

  const reader = new FileReader();

  reader.onload = () => {
    if (state.dom.adminProfileImagePreview) {
      state.dom.adminProfileImagePreview.src = reader.result;
      state.dom.adminProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.classList.add("d-none");
    }

    if (state.dom.adminHeroImage) {
      state.dom.adminHeroImage.src = reader.result;
      state.dom.adminHeroImage.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.classList.add("d-none");
    }
  };

  reader.readAsDataURL(file);
}

async function saveAdminProfileImage() {
  const file = state.pendingProfileImageFile;

  if (!file) {
    showPageAlert("warning", "Choose a profile photo before uploading.");
    return;
  }

  if (!state.currentUser?.id) {
    showPageAlert("danger", "Signed-in Admin user could not be confirmed.");
    return;
  }

  try {
    setAdminProfileImageSaveLoading(true);

    const supabase = getSupabaseClient();
    const safeFileName = sanitiseAdminProfileImageFileName(file.name);
    const filePath = `${state.currentUser.id}/${Date.now()}-${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Profile photo upload failed: ${uploadError.message}`);
    }

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

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    await loadLatestAdminProfile();
    renderAdminProfile(state.currentProfile, state.currentUser);

    showPageAlert("success", "Your profile photo was uploaded successfully.");
  } catch (error) {
    console.error("Error uploading admin profile image:", error);

    showPageAlert(
      "danger",
      error.message || "Profile photo could not be uploaded.",
    );
  } finally {
    setAdminProfileImageSaveLoading(false);
  }
}

// ADMIN PROFILE PHOTO PARITY - REMOVE PICTURE
// Clears the signed-in Admin's saved image reference first.
// Storage cleanup is best-effort so a storage cleanup failure does not
// restore a picture the Admin has already removed from their profile.
async function removeAdminProfileImage() {
  if (!state.currentUser?.id) {
    showPageAlert(
      "danger",
      "Signed-in Admin user could not be confirmed.",
    );
    return;
  }

  const currentImagePath = String(
    state.currentProfile?.profile_image_path || "",
  ).trim();

  if (!currentImagePath) {
    showPageAlert(
      "info",
      "There is no saved profile picture to remove.",
    );

    if (state.dom.removeAdminProfileImageBtn) {
      state.dom.removeAdminProfileImageBtn.disabled = true;
    }

    return;
  }

  const confirmed = window.confirm(
    "Remove your current profile picture?\n\nYour initials will be shown instead.",
  );

  if (!confirmed) return;

  const button = state.dom.removeAdminProfileImageBtn;

  try {
    if (button) {
      button.disabled = true;
      button.dataset.originalHtml = button.innerHTML;
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
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
      profile_image_path: null,
    };

    state.pendingProfileImageFile = null;

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    // Storage cleanup is secondary to clearing the profile reference.
    try {
      const { error: storageError } = await supabase.storage
        .from(PROFILE_IMAGES_BUCKET)
        .remove([currentImagePath]);

      if (storageError) {
        console.warn(
          "Admin profile image reference was cleared, but storage cleanup failed:",
          storageError,
        );
      }
    } catch (storageCleanupError) {
      console.warn(
        "Admin profile image reference was cleared, but storage cleanup could not complete:",
        storageCleanupError,
      );
    }

    await loadLatestAdminProfile();
    renderAdminProfile(state.currentProfile, state.currentUser);

    showPageAlert(
      "success",
      "Your profile picture was removed successfully.",
    );
  } catch (error) {
    console.error("Error removing admin profile image:", error);

    showPageAlert(
      "danger",
      error.message || "Profile picture could not be removed.",
    );
  } finally {
    if (button) {
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }

      button.disabled = !state.currentProfile?.profile_image_path;
    }
  }
}

// Department is read-only (set at account creation) and excluded from the snapshot.
function getAdminProfileEditableSnapshot() {
  return {
    fullName: String(state.dom.adminProfileFullName?.value || "").trim(),
  };
}

function updateAdminProfileSaveButtonState() {
  const button = state.dom.saveAdminProfileBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const currentValues = getAdminProfileEditableSnapshot();
  const baseline = state.currentProfileEditableBaseline;

  const hasBaseline = Boolean(baseline);
  const hasValidName = Boolean(currentValues.fullName);

  const hasChanged = hasBaseline && (
    currentValues.fullName !== baseline.fullName
  );

  const canSave = hasValidName && hasChanged;

  button.disabled = !canSave;
  button.className = canSave
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

async function saveAdminOwnProfile() {
  const fullName = String(state.dom.adminProfileFullName?.value || "").trim();

  if (!fullName) {
    showPageAlert(
      "warning",
      "Full name is required before saving your profile.",
    );
    state.dom.adminProfileFullName?.focus();
    return;
  }

  try {
    setProfileSaveLoading(true);

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      full_name: fullName,
    };

    renderAdminProfile(state.currentProfile, state.currentUser);
    showPageAlert("success", "Your profile was updated successfully.");
  } catch (error) {
    console.error("Error updating admin profile:", error);
    showPageAlert(
      "danger",
      error.message || "Your profile could not be updated.",
    );
  } finally {
    setProfileSaveLoading(false);
  }
}

function setProfileSaveLoading(isLoading) {
  const button = state.dom.saveAdminProfileBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";
  button.disabled = true;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.className = "btn btn-secondary dashboard-action-btn";
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

  delete button.dataset.isLoading;
  updateAdminProfileSaveButtonState();
}

/* =========================================================
   ADMIN PASSWORD RESET
   ========================================================= */

function updateResetPasswordSubmitButtonState() {
  const btn = state.dom.resetPasswordSubmitBtn;
  if (!btn) return;

  const pw = String(state.dom.resetPasswordTempInput?.value || "").trim();
  const ready = pw.length >= 8;

  btn.disabled = !ready;
  btn.className = ready
    ? "btn btn-warning dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearResetPasswordAlert() {
  const el = state.dom.resetPasswordAlert;
  if (!el) return;
  el.className = "alert d-none mb-0";
  el.textContent = "";
}

function showResetPasswordAlert(type, message) {
  const el = state.dom.resetPasswordAlert;
  if (!el) return;
  el.className = `alert alert-${type} mb-0`;
  el.textContent = message;
}

// ADMIN PASSWORD RESET VISIBILITY - STEP 1H
// Keep the temporary password visually masked without using type="password".
// This avoids browser password-manager dropdowns covering the reset modal.
// The typed value is unchanged and is still sent only through submitPasswordReset().
function setResetPasswordVisibility(isVisible = false) {
  const input = state.dom.resetPasswordTempInput;
  const icon = state.dom.resetPasswordToggleIcon;
  const button = state.dom.resetPasswordToggleBtn;

  if (!input) return;

  input.type = "text";
  input.dataset.passwordVisible = isVisible ? "true" : "false";

  input.style.setProperty(
    "-webkit-text-security",
    isVisible ? "none" : "disc",
  );

  input.style.setProperty(
    "text-security",
    isVisible ? "none" : "disc",
  );

  if (icon) {
    icon.className = isVisible ? "bi bi-eye-slash" : "bi bi-eye";
  }

  if (button) {
    button.title = isVisible ? "Hide temporary password" : "Show temporary password";
    button.setAttribute(
      "aria-label",
      isVisible ? "Hide temporary password" : "Show temporary password",
    );
  }
}

function clearResetPasswordModal() {
  state.currentResetTarget = null;

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Clear the temporary password and return the field to masked display.
  // Do not switch back to type="password"; that reopens browser password-manager prompts.
  if (state.dom.resetPasswordTempInput) {
    state.dom.resetPasswordTempInput.value = "";
  }

  setResetPasswordVisibility(false);

  clearResetPasswordAlert();
  updateResetPasswordSubmitButtonState();
}

function openResetPasswordModal(profileId) {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "User profile not found. Please refresh the page and try again.",
    );
    return;
  }

  state.currentResetTarget = profile;

  if (state.dom.resetPasswordTargetName) {
    state.dom.resetPasswordTargetName.textContent =
      getProfileDisplayName(profile);
  }

  if (state.dom.resetPasswordTargetEmail) {
    state.dom.resetPasswordTargetEmail.textContent =
      profile.email || "No email on record";
  }

  clearResetPasswordModal();
  state.currentResetTarget = profile;

  const modalEl = state.dom.resetPasswordModal;
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Ensure every fresh modal open starts masked, then focus the input.
  modalEl.addEventListener(
    "shown.bs.modal",
    () => {
      setResetPasswordVisibility(false);
      state.dom.resetPasswordTempInput?.focus();
    },
    { once: true },
  );
}

async function submitPasswordReset() {
  const profile = state.currentResetTarget;
  if (!profile) return;

  const tempPassword = String(
    state.dom.resetPasswordTempInput?.value || "",
  ).trim();

  if (tempPassword.length < 8) {
    showResetPasswordAlert(
      "warning",
      "Temporary password must be at least 8 characters.",
    );
    return;
  }

  const btn = state.dom.resetPasswordSubmitBtn;

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalHtml = btn.innerHTML;
      btn.className = "btn btn-secondary dashboard-action-btn";
      btn.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Resetting...
      `;
    }

    clearResetPasswordAlert();

    const supabase = getSupabaseClient();

    const { data, error } = await supabase.functions.invoke(
      "reset-employee-password",
      {
        body: {
          targetEmail: String(profile.email || "").toLowerCase().trim(),
          tempPassword,
        },
      },
    );

    if (error) throw error;

    // Close the modal on success.
    const modalEl = state.dom.resetPasswordModal;
    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    showPageAlert(
      "success",
      data?.message ||
      `Password reset successfully for ${profile.email || "user"}.`,
    );

    showDashboardToast(
      "success",
      "Password reset",
      `Temporary password set for ${getProfileDisplayName(profile)}.`,
    );
  } catch (error) {
    console.error("Password reset error:", error);
    showResetPasswordAlert(
      "danger",
      String(error?.message || "Password could not be reset. Please try again."),
    );
  } finally {
    if (btn && btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
    updateResetPasswordSubmitButtonState();
  }
}

/* =========================================================
   HR MFA RESET
   ========================================================= */

function isHrMfaResetEligibleProfile(profile = {}) {
  // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
  // Only HR users are eligible because HR Dashboard is the MFA-protected workspace.
  return String(profile.role || "").trim().toLowerCase() === "hr";
}

function updateResetMfaSubmitButtonState() {
  const btn = state.dom.resetMfaSubmitBtn;
  if (!btn) return;

  const isConfirmed = Boolean(state.dom.resetMfaConfirmCheckbox?.checked);
  const hasTarget = Boolean(state.currentMfaResetTarget?.id);
  const ready = isConfirmed && hasTarget;

  btn.disabled = !ready;
  btn.className = ready
    ? "btn btn-danger dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearResetMfaAlert() {
  const el = state.dom.resetMfaAlert;
  if (!el) return;

  el.className = "alert d-none mt-3 mb-0";
  el.textContent = "";
}

function showResetMfaAlert(type, message) {
  const el = state.dom.resetMfaAlert;

  if (!el) {
    showPageAlert(type, message);
    return;
  }

  el.className = `alert alert-${type} mt-3 mb-0`;
  el.textContent = message;
}

function clearResetMfaModal() {
  state.currentMfaResetTarget = null;

  if (state.dom.resetMfaConfirmCheckbox) {
    state.dom.resetMfaConfirmCheckbox.checked = false;
  }

  clearResetMfaAlert();
  updateResetMfaSubmitButtonState();
}

function openResetMfaModal(profileId) {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "User profile not found. Please refresh the page and try again.",
    );
    return;
  }

  if (!isHrMfaResetEligibleProfile(profile)) {
    showPageAlert(
      "warning",
      "Only HR users can have HR Dashboard two-factor authentication reset from this action.",
    );
    return;
  }

  state.currentMfaResetTarget = profile;

  if (state.dom.resetMfaTargetName) {
    state.dom.resetMfaTargetName.textContent = getProfileDisplayName(profile);
  }

  if (state.dom.resetMfaTargetEmail) {
    state.dom.resetMfaTargetEmail.textContent =
      profile.email || "No email on record";
  }

  if (state.dom.resetMfaTargetRole) {
    state.dom.resetMfaTargetRole.textContent =
      String(profile.role || "HR").trim().toUpperCase();
  }

  if (state.dom.resetMfaConfirmCheckbox) {
    state.dom.resetMfaConfirmCheckbox.checked = false;
  }

  clearResetMfaAlert();
  updateResetMfaSubmitButtonState();

  const modalEl = state.dom.resetMfaModal;
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function setResetMfaLoading(isLoading) {
  const btn = state.dom.resetMfaSubmitBtn;
  if (!btn) return;

  btn.dataset.isLoading = isLoading ? "true" : "false";

  if (isLoading) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }

    btn.disabled = true;
    btn.className = "btn btn-secondary dashboard-action-btn";
    btn.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Resetting HR 2FA...
    `;
    return;
  }

  if (btn.dataset.originalHtml) {
    btn.innerHTML = btn.dataset.originalHtml;
    delete btn.dataset.originalHtml;
  }

  delete btn.dataset.isLoading;
  updateResetMfaSubmitButtonState();
}

async function submitMfaReset() {
  const profile = state.currentMfaResetTarget;

  if (!profile?.id) {
    showResetMfaAlert("warning", "Select an HR user before resetting MFA.");
    return;
  }

  if (!isHrMfaResetEligibleProfile(profile)) {
    showResetMfaAlert("warning", "Only HR users can be reset from this workflow.");
    return;
  }

  if (!state.dom.resetMfaConfirmCheckbox?.checked) {
    showResetMfaAlert(
      "warning",
      "Confirm the HR MFA reset before continuing.",
    );
    return;
  }

  try {
    setResetMfaLoading(true);
    clearResetMfaAlert();

    const supabase = getSupabaseClient();

    // HR DASHBOARD TWO-FACTOR AUTHENTICATION - STEP 2C-2
    // Privileged MFA reset is server-side only. The Edge Function validates
    // the caller is an active Admin and deletes the target HR user's TOTP factors.
    const { data, error } = await supabase.functions.invoke(
      "reset-user-mfa",
      {
        body: {
          targetUserId: String(profile.id || "").trim(),
          targetEmail: String(profile.email || "").trim().toLowerCase(),
        },
      },
    );

    if (error) throw error;

    if (data && data.success === false) {
      throw new Error(data.message || "HR MFA reset was not completed.");
    }

    const modalEl = state.dom.resetMfaModal;
    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    const message =
      data?.message ||
      `HR two-factor authentication was reset for ${getProfileDisplayName(profile)}.`;

    showPageAlert("success", message);

    showDashboardToast(
      "success",
      "HR 2FA reset",
      message,
    );

    await refreshProfileTenantLinkingWorkspace();
  } catch (error) {
    console.error("HR MFA reset error:", error);

    const message =
      String(error?.message || "").trim() ||
      "HR MFA reset could not be completed. Please try again.";

    showResetMfaAlert("danger", message);

    showDashboardToast(
      "danger",
      "HR 2FA reset failed",
      message,
    );
  } finally {
    setResetMfaLoading(false);
  }
}
