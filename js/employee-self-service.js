// EMPLOYEE SELF-SERVICE MODULE
// ============================
// Shared self-service workspace used inside the HR Dashboard and Manager
// Dashboard so staff who hold those roles can still apply for leave, view
// their own leave balances and history, and print their own payslips.
//
// All DOM IDs in this module are prefixed with "ss" to avoid collisions
// with the host dashboard's own elements.
//
// Usage:
//   await window.EmployeeSelfService.init(currentUser, currentProfile);
//
// The init() call is idempotent — calling it again after the first load
// silently refreshes data without re-wiring event listeners.

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  const SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS = [
    "maternity",
    "paternity",
    "adoption",
  ];

  // -----------------------------------------------------------------------
  // Module-scoped state
  // -----------------------------------------------------------------------
  const ssState = {
    currentUser: null,
    currentProfile: null,
    employeeRecord: null,
    identity: {
      authUserId: null,
      employeeRowId: null,
      linkedUserId: null,
    },
    leaveRequests: [],
    payrollRecords: [],
    isPayrollFiguresHidden: false,
    returnedLeaveAmendmentRequestId: null,
    isInitialized: false,
    dom: {},
  };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function getSupabaseClient() {
    if (!window.supabaseClient) {
      throw new Error("Supabase client is not available.");
    }
    return window.supabaseClient;
  }

  function ssNormalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function ssNormalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function ssEscapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ssFormatCurrency(value, currency = "NGN") {
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
    } catch {
      return `${resolvedCurrency} ${numericValue.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }

  function ssFormatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return ssEscapeHtml(value);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function ssFormatDateTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return ssEscapeHtml(value);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function showSsAlert(type, message) {
    const el = ssState.dom.ssSelfServiceAlert;
    if (!el) return;
    el.className = `alert alert-${type} mb-4`;
    el.textContent = message;
    el.classList.remove("d-none");
  }

  function clearSsAlert() {
    const el = ssState.dom.ssSelfServiceAlert;
    if (!el) return;
    el.classList.add("d-none");
    el.textContent = "";
  }

  // -----------------------------------------------------------------------
  // Identity
  // -----------------------------------------------------------------------
  function getSsIdentityCandidates() {
    const candidates = [
      ssState.identity?.linkedUserId,
      ssState.identity?.authUserId,
      ssState.identity?.employeeRowId,
    ].filter(Boolean);
    return [...new Set(candidates)];
  }

  function getPreferredSsEmployeeId() {
    return (
      ssState.identity?.linkedUserId ||
      ssState.identity?.authUserId ||
      ssState.identity?.employeeRowId ||
      null
    );
  }

  function applySsResolvedIdentity(employee) {
    if (!employee) return;
    ssState.identity.authUserId = ssState.currentUser?.id || null;
    ssState.identity.employeeRowId = employee.id || null;
    ssState.identity.linkedUserId = employee.user_id || ssState.currentUser?.id || null;
  }

  // LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
  // Normalise the signed-in HR/Manager/Employee self-service user's gender
  // from the resolved employee record.
  function getNormalisedSsEmployeeGenderForLeaveEligibility() {
    const rawGender = ssNormalizeText(
      ssState.employeeRecord?.gender ||
      ssState.employeeRecord?.sex ||
      ssState.employeeRecord?.gender_identity ||
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
  // Hide ineligible leave types from HR/Manager My Self-Service dropdowns.
  function isSsLeaveTypeVisibleForEmployeeProfile(leaveType = {}) {
    const eligibilityRule = ssNormalizeText(
      leaveType.eligibility_rule ||
      leaveType.eligibilityRule ||
      "all_employees",
    );

    if (eligibilityRule === "all_employees" || eligibilityRule === "hr_review_only") {
      return true;
    }

    const employeeGender = getNormalisedSsEmployeeGenderForLeaveEligibility();

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

  // LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
  // Defensive guard for stale dropdown state, old browser cache, or manual DOM changes.
  function getSsLeaveTypeEligibilityBlock(leaveType = {}) {
    if (!leaveType.id) return null;

    const eligibilityRule = ssNormalizeText(
      leaveType.eligibilityRule || "all_employees",
    );

    if (eligibilityRule === "all_employees") {
      return null;
    }

    if (eligibilityRule === "hr_review_only") {
      return {
        message:
          `${leaveType.name || "This leave type"} requires HR review before it can be requested through self-service. Please contact HR for support.`,
      };
    }

    const employeeGender = getNormalisedSsEmployeeGenderForLeaveEligibility();

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

  // -----------------------------------------------------------------------
  // DOM caching
  // -----------------------------------------------------------------------
  function cacheSsDomElements() {
    ssState.dom = {
      ssSelfServiceAlert: document.getElementById("ssSelfServiceAlert"),

      ssNavLeaveBtn: document.getElementById("ssNavLeaveBtn"),
      ssNavPayrollBtn: document.getElementById("ssNavPayrollBtn"),

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-2
      // Visible shortcut from the Leave screen back to Payroll.
      ssGoToPayrollFromLeaveBtn: document.getElementById("ssGoToPayrollFromLeaveBtn"),

      ssLeaveSection: document.getElementById("ssLeaveSection"),
      ssPayrollSection: document.getElementById("ssPayrollSection"),

      // Leave balances collapse
      ssLeaveBalancesCardCollapse: document.getElementById("ssLeaveBalancesCardCollapse"),
      ssToggleLeaveBalancesCardBtn: document.getElementById("ssToggleLeaveBalancesCardBtn"),
      ssRefreshLeaveBalancesBtn: document.getElementById("ssRefreshLeaveBalancesBtn"),
      ssLeaveBalancesEmptyState: document.getElementById("ssLeaveBalancesEmptyState"),
      ssLeaveBalancesGrid: document.getElementById("ssLeaveBalancesGrid"),

      // Latest leave decision collapse
      ssLatestDecisionCardCollapse: document.getElementById("ssLatestDecisionCardCollapse"),
      ssToggleLatestDecisionCardBtn: document.getElementById("ssToggleLatestDecisionCardBtn"),
      ssRefreshLatestDecisionBtn: document.getElementById("ssRefreshLatestDecisionBtn"),
      ssLatestDecisionEmptyState: document.getElementById("ssLatestDecisionEmptyState"),
      ssLatestDecisionCard: document.getElementById("ssLatestDecisionCard"),
      ssLatestDecisionStatus: document.getElementById("ssLatestDecisionStatus"),
      ssLatestDecisionLeaveType: document.getElementById("ssLatestDecisionLeaveType"),
      ssLatestDecisionDateTime: document.getElementById("ssLatestDecisionDateTime"),
      ssLatestDecisionPeriod: document.getElementById("ssLatestDecisionPeriod"),
      ssLatestDecisionBy: document.getElementById("ssLatestDecisionBy"),
      ssLatestDecisionComment: document.getElementById("ssLatestDecisionComment"),

      // Leave request form
      ssLeaveRequestForm: document.getElementById("ssLeaveRequestForm"),
      ssLeaveType: document.getElementById("ssLeaveType"),
      ssStartDate: document.getElementById("ssStartDate"),
      ssEndDate: document.getElementById("ssEndDate"),
      ssTotalDays: document.getElementById("ssTotalDays"),
      ssLeaveReason: document.getElementById("ssLeaveReason"),
      ssSubmitLeaveBtn: document.getElementById("ssSubmitLeaveBtn"),
      ssLeaveRequestBlockNotice: document.getElementById("ssLeaveRequestBlockNotice"),

      // Leave history
      ssLeaveHistoryCardCollapse: document.getElementById("ssLeaveHistoryCardCollapse"),
      ssToggleLeaveHistoryCardBtn: document.getElementById("ssToggleLeaveHistoryCardBtn"),
      ssRefreshLeaveRequestsBtn: document.getElementById("ssRefreshLeaveRequestsBtn"),
      ssLeaveRequestsEmptyState: document.getElementById("ssLeaveRequestsEmptyState"),
      ssLeaveRequestsList: document.getElementById("ssLeaveRequestsList"),

      // Payroll summary
      ssCurrentPayrollEmptyState: document.getElementById("ssCurrentPayrollEmptyState"),
      ssCurrentPayrollSummaryGrid: document.getElementById("ssCurrentPayrollSummaryGrid"),
      ssCurrentPayCycle: document.getElementById("ssCurrentPayCycle"),
      ssCurrentGrossPay: document.getElementById("ssCurrentGrossPay"),
      ssCurrentTotalDeductions: document.getElementById("ssCurrentTotalDeductions"),
      ssCurrentNetPay: document.getElementById("ssCurrentNetPay"),
      ssTogglePayrollFiguresBtn: document.getElementById("ssTogglePayrollFiguresBtn"),

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-1
      // Visible payroll-header shortcut back to HR's own Leave Management.
      ssGoToLeaveFromPayrollBtn: document.getElementById("ssGoToLeaveFromPayrollBtn"),

      ssRefreshPayrollBtn: document.getElementById("ssRefreshPayrollBtn"),

      // Payroll history
      ssPayrollHistoryCardCollapse: document.getElementById("ssPayrollHistoryCardCollapse"),
      ssTogglePayrollHistoryCardBtn: document.getElementById("ssTogglePayrollHistoryCardBtn"),
      ssPayrollHistoryEmptyState: document.getElementById("ssPayrollHistoryEmptyState"),
      ssPayrollHistoryTableWrapper: document.getElementById("ssPayrollHistoryTableWrapper"),
      ssPayrollHistoryTableBody: document.getElementById("ssPayrollHistoryTableBody"),
      ssPayrollSearchInput: document.getElementById("ssPayrollSearchInput"),
      ssPayrollDateFromInput: document.getElementById("ssPayrollDateFromInput"),
      ssPayrollDateToInput: document.getElementById("ssPayrollDateToInput"),
      ssClearPayrollFiltersBtn: document.getElementById("ssClearPayrollFiltersBtn"),
    };
  }

  // -----------------------------------------------------------------------
  // Sub-navigation (Leave / Payroll)
  // -----------------------------------------------------------------------
  function switchSsSubSection(section) {
    const isLeave = section === "leave";
    const isPayroll = section === "payroll";

    ssState.dom.ssLeaveSection?.classList.toggle("d-none", !isLeave);
    ssState.dom.ssPayrollSection?.classList.toggle("d-none", !isPayroll);

    if (ssState.dom.ssNavLeaveBtn) {
      ssState.dom.ssNavLeaveBtn.className = isLeave
        ? "btn btn-primary dashboard-action-btn"
        : "btn btn-outline-primary dashboard-action-btn";
    }

    if (ssState.dom.ssNavPayrollBtn) {
      ssState.dom.ssNavPayrollBtn.className = isPayroll
        ? "btn btn-primary dashboard-action-btn"
        : "btn btn-outline-primary dashboard-action-btn";
    }

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3
    // Employee Dashboard behaviour:
    // - Leave Balances stays closed by default.
    // - Latest Leave Decision stays closed by default.
    // - My Leave History opens so the employee/HR user can immediately
    //   see submitted requests and manager decisions.
    if (isLeave) {
      setSsCardExpanded(
        ssState.dom.ssToggleLeaveBalancesCardBtn,
        ssState.dom.ssLeaveBalancesCardCollapse,
        false,
      );

      setSsCardExpanded(
        ssState.dom.ssToggleLatestDecisionCardBtn,
        ssState.dom.ssLatestDecisionCardCollapse,
        false,
      );

      setSsCardExpanded(
        ssState.dom.ssToggleLeaveHistoryCardBtn,
        ssState.dom.ssLeaveHistoryCardCollapse,
        true,
      );
    }

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3
    // Payroll opens with Payroll History visible because this is where HR
    // confirms their own authorised payslip records.
    if (isPayroll) {
      setSsCardExpanded(
        ssState.dom.ssTogglePayrollHistoryCardBtn,
        ssState.dom.ssPayrollHistoryCardCollapse,
        true,
      );
    }
  }

  function bindSsNavigationEvents() {
    ssState.dom.ssNavLeaveBtn?.addEventListener("click", () => {
      switchSsSubSection("leave");
    });

    ssState.dom.ssNavPayrollBtn?.addEventListener("click", () => {
      switchSsSubSection("payroll");
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-2
    // Let HR return from Leave to Payroll without refreshing the dashboard.
    ssState.dom.ssGoToPayrollFromLeaveBtn?.addEventListener("click", () => {
      switchSsSubSection("payroll");

      window.requestAnimationFrame(() => {
        ssState.dom.ssPayrollSection?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  // -----------------------------------------------------------------------
  // Card expand/collapse helper
  // -----------------------------------------------------------------------
  function setSsCardExpanded(btn, body, shouldExpand) {
    if (!btn || !body) return;

    body.classList.toggle("d-none", !shouldExpand);
    btn.querySelector("i")?.classList.toggle("bi-chevron-down", !shouldExpand);
    btn.querySelector("i")?.classList.toggle("bi-chevron-up", shouldExpand);

    const label = btn.querySelector("span");
    if (label) label.textContent = shouldExpand ? "Collapse" : "Expand";

    btn.setAttribute("aria-expanded", String(shouldExpand));

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
    // Keep Request Leave and My Leave History aligned only while history
    // is expanded. Collapsed history must shrink to header-only.
    scheduleSsLeaveMainCardHeightSync();
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Recalculate card height after the browser has applied collapse/expand
  // changes. The second delayed pass covers rendered leave-history records.
  function scheduleSsLeaveMainCardHeightSync() {
    window.setTimeout(syncSsLeaveMainCardHeights, 0);
    window.setTimeout(syncSsLeaveMainCardHeights, 120);
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Match Employee Dashboard leave behaviour:
  // - while My Leave History is expanded on desktop, align it with Request Leave
  // - when My Leave History is collapsed, remove the forced height
  // - keep leave records scrolling inside the existing inner scroll area
  function syncSsLeaveMainCardHeights() {
    window.requestAnimationFrame(() => {
      const leaveSection =
        ssState.dom.ssLeaveSection ||
        document.getElementById("ssLeaveSection");

      // MANAGER SELF-SERVICE PARITY - STEP 2C-2
      // This shared self-service module runs inside HR and Manager dashboards.
      // Resolve the active self-service host from the visible Leave section
      // instead of hardcoding #hrSelfServiceSection. This preserves HR behaviour
      // and makes Manager My Leave History use the same open/collapse/double-click
      // height handling as HR.
      const selfServiceSection =
        leaveSection?.closest(".workspace-section") ||
        document.getElementById("hrSelfServiceSection") ||
        document.getElementById("managerSelfServiceSection");

      const row = selfServiceSection?.querySelector(".ss-leave-main-row");
      const requestCard = selfServiceSection?.querySelector(
        ".dashboard-form-card.ss-leave-equal-card",
      );
      const historyPanel =
        ssState.dom.ssLeaveHistoryCardCollapse ||
        document.getElementById("ssLeaveHistoryCardCollapse");

      if (!row || !requestCard || !historyPanel) return;

      const clearHeight = () => {
        row.style.removeProperty("--ss-leave-card-height");
        row.removeAttribute("data-ss-leave-card-height");
      };

      const isDesktop = window.matchMedia("(min-width: 1200px)").matches;
      const isHistoryExpanded = !historyPanel.classList.contains("d-none");
      const isSelfServiceHidden = selfServiceSection?.classList.contains("d-none");
      const isLeaveHidden = leaveSection?.classList.contains("d-none");

      if (!isDesktop || isSelfServiceHidden || isLeaveHidden || !isHistoryExpanded) {
        clearHeight();
        return;
      }

      clearHeight();

      const measuredHeight = Math.ceil(requestCard.getBoundingClientRect().height);

      if (measuredHeight > 0) {
        row.style.setProperty("--ss-leave-card-height", `${measuredHeight}px`);
        row.setAttribute("data-ss-leave-card-height", "true");
      }
    });
  }

  // HR SELF-SERVICE REFRESH UX - STEP 1C-3D
  // Let the browser paint the spinner before the async reload starts.
  function waitForSsNextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  // HR SELF-SERVICE REFRESH UX - STEP 1C-3D
  // One shared refresh loading helper for both icon-only and labelled buttons.
  // This replaces the duplicate helper versions previously introduced.
  function setSsRefreshButtonLoading(
    button,
    isLoading,
    { iconOnly = false, loadingLabel = "Refreshing..." } = {},
  ) {
    if (!button) return;

    button.disabled = isLoading;

    if (isLoading) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }

      button.innerHTML = iconOnly
        ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>`
        : `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${loadingLabel}`;

      return;
    }

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
  // Refresh HR/Manager My Self-Service leave balances with visible feedback.
  // This is shared by HR Dashboard > My Self-Service and Manager Dashboard > My Self-Service.
  async function refreshSsLeaveBalancesManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshLeaveBalancesBtn;

    try {
      setSsRefreshButtonLoading(button, true, {
        loadingLabel: "Refreshing...",
      });

      await waitForSsNextPaint();

      // LEAVE BALANCE ELIGIBILITY VISIBILITY - STEP 1E
      // Reload the staff employee record first so HR/Manager Self-Service
      // immediately reflects gender changes after Refresh Balances.
      await loadSsEmployeeRecord();

      await loadSsLeaveBalances();
      await loadSsLeaveTypes();
      await loadSsLeaveRequests();

      clearSsAlert();
      showSsAlert("success", "Leave balances refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual leave balances refresh failed:", error);

      showSsAlert(
        "danger",
        error.message || "Unable to refresh leave balances right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false);
      scheduleSsLeaveMainCardHeightSync();
    }
  }

  // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
  // Refresh HR/Manager My Self-Service latest decision with visible feedback.
  // Latest decision is calculated from leave request decision records.
  async function refreshSsLatestDecisionManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshLatestDecisionBtn;

    try {
      setSsRefreshButtonLoading(button, true, {
        loadingLabel: "Refreshing...",
      });

      await waitForSsNextPaint();

      await loadSsLeaveRequests();
      await loadSsLeaveBalances();

      clearSsAlert();
      showSsAlert("success", "Latest leave decision refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual latest leave decision refresh failed:", error);

      showSsAlert(
        "danger",
        error.message || "Unable to refresh the latest leave decision right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false);
      scheduleSsLeaveMainCardHeightSync();
    }
  }

  // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1B
  // Keep very fast clear actions visible long enough for users to see that
  // the button responded.
  function waitForSsMinimumLoadingFeedback(startedAt, minimumMs = 350) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(minimumMs - elapsedMs, 0);

    return new Promise((resolve) => {
      window.setTimeout(resolve, remainingMs);
    });
  }

  // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1B
  // Clear the HR/Manager My Self-Service Payroll History filters with spinner
  // feedback. This only resets local filter fields; it does not reload payroll,
  // change payroll records, or alter payslip authorisation.
  async function clearSsPayrollFiltersManually() {
    const button = ssState.dom.ssClearPayrollFiltersBtn;
    const startedAt = Date.now();

    try {
      setSsRefreshButtonLoading(button, true, {
        loadingLabel: "Clearing...",
      });

      await waitForSsNextPaint();

      if (ssState.dom.ssPayrollSearchInput) {
        ssState.dom.ssPayrollSearchInput.value = "";
      }

      if (ssState.dom.ssPayrollDateFromInput) {
        ssState.dom.ssPayrollDateFromInput.value = "";
      }

      if (ssState.dom.ssPayrollDateToInput) {
        ssState.dom.ssPayrollDateToInput.value = "";
      }

      applySsPayrollFilters();
    } finally {
      await waitForSsMinimumLoadingFeedback(startedAt);
      setSsRefreshButtonLoading(button, false);
    }
  }

  // HR SELF-SERVICE PAYROLL REFRESH - STEP 1C-3D
  // Refresh the signed-in staff member's own authorised payroll records.
  // This does not run payroll and does not touch HR payroll operations.
  async function refreshSsPayrollManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshPayrollBtn;

    try {
      setSsRefreshButtonLoading(button, true, { iconOnly: true });
      await waitForSsNextPaint();

      await loadSsPayroll();

      clearSsAlert();
      showSsAlert("success", "Payroll information refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual payroll refresh failed:", error);
      showSsAlert(
        "danger",
        error.message || "Unable to refresh payroll information right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false, { iconOnly: true });
    }
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Refresh leave history using visible feedback and reload balances as well
  // because manager decisions can affect used/remaining leave figures.
  async function refreshSsLeaveHistoryManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshLeaveRequestsBtn;

    try {
      setSsRefreshButtonLoading(button, true, { loadingLabel: "Refreshing..." });
      await waitForSsNextPaint();

      await loadSsLeaveRequests();
      await loadSsLeaveBalances();

      clearSsAlert();
      showSsAlert("success", "Leave history refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual leave history refresh failed:", error);
      showSsAlert(
        "danger",
        error.message || "Unable to refresh leave history right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false);
      scheduleSsLeaveMainCardHeightSync();
    }
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Whole-card double-click collapse. Interactive controls and the existing
  // leave-history inner scroll area are ignored, so normal clicking/scrolling
  // does not accidentally collapse the card.
  function bindSsCardDoubleClickCollapse(btn, body) {
    if (!btn || !body) return;

    const card = body.closest(".dashboard-section-card");
    if (!card) return;

    if (card.dataset.ssDoubleClickCollapseBound === "true") return;
    card.dataset.ssDoubleClickCollapseBound = "true";

    card.addEventListener("dblclick", (event) => {
      const ignoredTarget = event.target.closest(
        "button, a, input, select, textarea, label, table, .employee-leave-history-scroll-area, [contenteditable='true']",
      );

      if (ignoredTarget) return;

      const isExpanded = !body.classList.contains("d-none");
      if (!isExpanded) return;

      // Use the visible button path so double-click behaves exactly like
      // pressing Collapse.
      btn.click();
    });
  }

  // -----------------------------------------------------------------------
  // Leave Balances collapse
  // -----------------------------------------------------------------------
  function bindSsLeaveBalancesCardEvents() {
    const btn = ssState.dom.ssToggleLeaveBalancesCardBtn;
    const body = ssState.dom.ssLeaveBalancesCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3A
    // One safe double-click collapse binding for Leave Balances only.
    bindSsCardDoubleClickCollapse(btn, body);

    // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
    // Give HR/Manager My Self-Service Leave Balances the same visible refresh
    // feedback as Employee Dashboard: disable button, show spinner, reload data,
    // then restore the original button text.
    ssState.dom.ssRefreshLeaveBalancesBtn?.addEventListener("click", async () => {
      await refreshSsLeaveBalancesManually();
    });
  }

  // -----------------------------------------------------------------------
  // Latest Leave Decision collapse
  // -----------------------------------------------------------------------
  function bindSsLatestDecisionCardEvents() {
    const btn = ssState.dom.ssToggleLatestDecisionCardBtn;
    const body = ssState.dom.ssLatestDecisionCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C
    // Allow whole-card shell double-click collapse on Latest Leave Decision.
    bindSsCardDoubleClickCollapse(btn, body);

    // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1A
    // Latest Leave Decision is derived from leave requests, so refresh the
    // request data with visible loading feedback instead of silently reloading.
    ssState.dom.ssRefreshLatestDecisionBtn?.addEventListener("click", async () => {
      await refreshSsLatestDecisionManually();
    });
  }

  // -----------------------------------------------------------------------
  // Leave History collapse
  // -----------------------------------------------------------------------
  function bindSsLeaveHistoryCardEvents() {
    const btn = ssState.dom.ssToggleLeaveHistoryCardBtn;
    const body = ssState.dom.ssLeaveHistoryCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
      // Use the shared helper so normal click collapse, double-click collapse,
      // and programmatic collapse all follow the same state/height behaviour.
      setSsCardExpanded(btn, body, isCollapsed);
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
    // Double-clicking the open card shell behaves exactly like pressing
    // the visible Collapse button.
    bindSsCardDoubleClickCollapse(btn, body);

    ssState.dom.ssRefreshLeaveRequestsBtn?.addEventListener("click", async () => {
      await refreshSsLeaveHistoryManually();
    });
  }

  // -----------------------------------------------------------------------
  // Payroll History collapse
  // -----------------------------------------------------------------------
  function bindSsPayrollHistoryCardEvents() {
    const btn = ssState.dom.ssTogglePayrollHistoryCardBtn;
    const body = ssState.dom.ssPayrollHistoryCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });
  }

  // -----------------------------------------------------------------------
  // Payroll figures visibility
  // -----------------------------------------------------------------------
  function updateSsPayrollFigureVisibility() {
    const btn = ssState.dom.ssTogglePayrollFiguresBtn;
    if (!btn) return;

    const isHidden = ssState.isPayrollFiguresHidden;
    const icon = btn.querySelector("i");
    if (icon) {
      icon.classList.toggle("bi-eye-slash", !isHidden);
      icon.classList.toggle("bi-eye", isHidden);
    }
    btn.setAttribute("aria-label", isHidden ? "Show payroll figures" : "Hide payroll figures");
    btn.setAttribute("title", isHidden ? "Show payroll figures" : "Hide payroll figures");
  }

  function getSsPayrollFigureDisplay(value) {
    return ssState.isPayrollFiguresHidden ? "•••••" : value;
  }

  // PAYROLL SUMMARY FINANCIAL FIGURE CLARITY - STEP 1
  // Mark only the three monetary summary values for non-breaking/tabular
  // presentation. The underlying authorised payroll record is unchanged.
  function setSsPayrollSummaryFinancialValue(element, formattedValue) {
    if (!element) return;

    element.classList.add("ss-payroll-financial-value");
    element.textContent = getSsPayrollFigureDisplay(formattedValue);

    if (ssState.isPayrollFiguresHidden) {
      element.removeAttribute("title");
      return;
    }

    element.setAttribute("title", formattedValue);
  }

  function bindSsPayrollEvents() {
    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-1
    // Payroll opens first, so provide a visible route back to Leave Management
    // from the payroll screen itself.
    ssState.dom.ssGoToLeaveFromPayrollBtn?.addEventListener("click", () => {
      switchSsSubSection("leave");

      window.requestAnimationFrame(() => {
        ssState.dom.ssLeaveSection?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
    ssState.dom.ssTogglePayrollFiguresBtn?.addEventListener("click", () => {
      ssState.isPayrollFiguresHidden = !ssState.isPayrollFiguresHidden;
      updateSsPayrollFigureVisibility();
      renderSsCurrentPayrollSummary(ssState.payrollRecords);
    });

    ssState.dom.ssRefreshPayrollBtn?.addEventListener("click", async () => {
      // HR SELF-SERVICE PAYROLL REFRESH - STEP 1C-3C
      // Use Employee Dashboard-style refresh feedback for the compact
      // Current Payslip Summary refresh icon.
      await refreshSsPayrollManually();
    });

    // REFRESH / CLEAR BUTTON UX CONSISTENCY - STEP 1B
    // Clear payroll filters with visible feedback. This shared self-service
    // module is used by both HR Dashboard > My Self-Service and
    // Manager Dashboard > My Self-Service.
    ssState.dom.ssClearPayrollFiltersBtn?.addEventListener("click", async () => {
      await clearSsPayrollFiltersManually();
    });

    ["ssPayrollSearchInput", "ssPayrollDateFromInput", "ssPayrollDateToInput"].forEach((key) => {
      ssState.dom[key]?.addEventListener("input", () => applySsPayrollFilters());
    });
  }

  // -----------------------------------------------------------------------
  // Employee record lookup
  // -----------------------------------------------------------------------
  async function loadSsEmployeeRecord() {
    const supabase = getSupabaseClient();
    const userId = ssState.currentUser?.id;
    const userEmail = ssState.currentUser?.email || ssState.currentProfile?.email;

    let employee = null;

    // First: look up by user_id
    if (userId) {
      try {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (!error && data) {
          employee = data;
        }
      } catch (err) {
        console.warn("[SS] Lookup by user_id failed:", err);
      }
    }

    // Fallback: look up by email
    if (!employee && userEmail) {
      const emails = [
        userEmail,
        ssState.currentProfile?.email,
        ssState.currentUser?.email,
      ]
        .filter(Boolean)
        .map(ssNormalizeEmail)
        .filter((e) => e.length > 0);

      const uniqueEmails = [...new Set(emails)];

      for (const email of uniqueEmails) {
        try {
          const { data, error } = await supabase
            .from("employees")
            .select("*")
            .ilike("work_email", email)
            .maybeSingle();

          if (!error && data) {
            employee = data;
            break;
          }
        } catch (err) {
          console.warn("[SS] Lookup by work_email failed:", err);
        }
      }
    }

    if (!employee) {
      showSsAlert(
        "warning",
        "Your employee record could not be found. Leave and payroll self-service may be limited.",
      );
      return;
    }

    ssState.employeeRecord = employee;
    applySsResolvedIdentity(employee);
  }

  // -----------------------------------------------------------------------
  // Leave types
  // -----------------------------------------------------------------------
  async function loadSsLeaveTypes() {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("leave_types")
      .select("id, code, name, eligibility_rule")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[SS] Error loading leave types:", error);
      return;
    }

    const select = ssState.dom.ssLeaveType;
    if (!select) return;

    select.innerHTML = `<option value="">Select leave type</option>`;

    // LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
    // Only show leave types the signed-in HR/Manager/Employee user can request.
    // This keeps the dropdown aligned with the visible leave balances.
    (data || []).filter(isSsLeaveTypeVisibleForEmployeeProfile).forEach((leaveType) => {
      const option = document.createElement("option");
      option.value = leaveType.id;
      option.textContent = leaveType.name;
      option.dataset.code = leaveType.code;
      option.dataset.eligibilityRule = leaveType.eligibility_rule || "all_employees";
      select.appendChild(option);
    });

    updateSsLeaveSubmitButtonState();
  }

  // -----------------------------------------------------------------------
  // Leave balances
  // -----------------------------------------------------------------------
  async function loadSsLeaveBalances() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      renderSsLeaveBalances([]);
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

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) {
      console.error("[SS] Error loading leave balances:", error);
      return;
    }

    const balances = Array.isArray(data)
      ? data.filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
      : [];

    renderSsLeaveBalances(balances);
  }

  function renderSsLeaveBalances(balances) {
    const grid = ssState.dom.ssLeaveBalancesGrid;
    if (!grid) return;

    grid.innerHTML = "";

    // LEAVE BALANCE ELIGIBILITY VISIBILITY - STEP 1E
    // HR/Manager My Self-Service balance cards must match the Request Leave
    // dropdown. Keep stored balance rows intact, but only display leave types
    // currently applicable to the signed-in staff member's HR profile.
    const visibleBalances = (Array.isArray(balances) ? balances : []).filter((balance) =>
      isSsLeaveTypeVisibleForEmployeeProfile(balance.leave_types || {}),
    );

    if (!visibleBalances.length) {
      ssState.dom.ssLeaveBalancesEmptyState?.classList.remove("d-none");
      grid.classList.add("d-none");
      return;
    }

    ssState.dom.ssLeaveBalancesEmptyState?.classList.add("d-none");
    grid.classList.remove("d-none");

    visibleBalances.forEach((balance) => {
      const leaveTypeName = balance.leave_types?.name || "Unknown Leave Type";
      const entitled = Number(balance.entitled_days || 0);
      const used = Number(balance.used_days || 0);
      const remaining = Number(balance.remaining_days ?? entitled - used);

      const usedPercent =
        entitled > 0
          ? Math.min(100, Math.max(0, (used / entitled) * 100))
          : 0;

      const remainingPercent =
        entitled > 0
          ? Math.min(100, Math.max(0, (remaining / entitled) * 100))
          : 0;

      const statusClass =
        remaining <= 0
          ? "text-bg-danger"
          : remainingPercent <= 25
            ? "text-bg-warning"
            : "text-bg-success";

      const statusLabel =
        remaining <= 0
          ? "Fully Used"
          : remainingPercent <= 25
            ? "Low Balance"
            : "Available";

      const progressClass =
        remaining <= 0
          ? "bg-danger"
          : remainingPercent <= 25
            ? "bg-warning"
            : "bg-success";

      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-xl-4";

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C
      // Match Employee Dashboard leave balance presentation:
      // clear leave type, availability status, entitlement breakdown,
      // and used-entitlement progress bar. This is display-only.
      col.innerHTML = `
        <div class="info-tile h-100">
          <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <div class="info-tile-label mb-1">Leave Type</div>
              <div class="fw-bold">${ssEscapeHtml(leaveTypeName)}</div>
            </div>
            ${renderSsModernStatusPill(statusLabel)}
          </div>

          <div class="row g-3 mb-3">
            <div class="col-4">
              <div class="small text-secondary">Entitled</div>
              <div class="fw-semibold">${entitled}</div>
            </div>
            <div class="col-4">
              <div class="small text-secondary">Used</div>
              <div class="fw-semibold">${used}</div>
            </div>
            <div class="col-4">
              <div class="small text-secondary">Remaining</div>
              <div class="fw-semibold ${remaining <= 0 ? "text-danger" : ""}">
                ${remaining}
              </div>
            </div>
          </div>

          <div class="progress" style="height: 0.5rem;">
            <div class="progress-bar ${progressClass}" role="progressbar"
              style="width: ${usedPercent}%"
              aria-valuenow="${usedPercent.toFixed(0)}"
              aria-valuemin="0"
              aria-valuemax="100">
            </div>
          </div>

          <div class="small text-secondary mt-2">
            ${usedPercent.toFixed(0)}% of entitlement used.
          </div>
        </div>
      `;

      grid.appendChild(col);
    });
  }

  // -----------------------------------------------------------------------
  // Leave requests + latest decision
  // -----------------------------------------------------------------------
  async function loadSsLeaveRequests() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      ssState.leaveRequests = [];
      renderSsLeaveRequests([]);
      renderSsLatestDecision([]);
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
      leave_types ( name )
    `);

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query.order("submitted_at", { ascending: false });

    if (error) {
      console.error("[SS] Error loading leave requests:", error);
      showSsAlert("danger", "Unable to load leave history.");
      return;
    }

    const requests = Array.isArray(data)
      ? data.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
      : [];

    ssState.leaveRequests = requests;
    renderSsLeaveRequests(requests);
    renderSsLatestDecision(requests);
    updateSsLeaveRequestBlockNotice();
  }

  // POST-REGRESSION STATUS POLISH - STEP 1
  // Presentation only. Status values, queries, permissions, leave decisions,
  // payroll authorisation, and tenant isolation remain unchanged.
  function renderSsModernStatusPill(status = "") {
    const label = String(status || "--").trim() || "--";
    const normalized = ssNormalizeText(label);

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
        <i class="bi ${iconByStatus[normalized] || "bi-circle-fill"}" aria-hidden="true"></i>
        <span>${ssEscapeHtml(label)}</span>
      </span>
    `;
  }

  function getSsLeaveStatusBadgeClass(status) {
    const normalized = ssNormalizeText(status || "");
    if (normalized === "approved") return "text-bg-success";
    if (normalized === "rejected" || normalized === "declined") return "text-bg-danger";
    if (normalized.includes("pending")) return "text-bg-warning";
    if (normalized === "cancelled") return "text-bg-secondary";
    if (normalized === "returned" || normalized.includes("returned")) return "text-bg-info";
    return "text-bg-secondary";
  }

  // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
  // Shared helper for HR My Self-Service and Manager My Self-Service.
  // Cancelled leave is an HR reversal/audit event, not a manager comment.
  function isSsCancelledLeaveRequestAudit(request = {}) {
    return ssNormalizeText(request.status) === "cancelled" || Boolean(request.cancelled_at);
  }

  function getSsCancelledLeaveActionDate(request = {}) {
    return ssFormatDateTime(request.cancelled_at || request.decision_at || request.submitted_at);
  }

  function getSsCancelledLeaveActionBy(request = {}) {
    return (
      request.cancelled_by_name ||
      request.cancelled_by ||
      "HR"
    );
  }

  // EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A-FIX 1
  // Shared HR/Manager self-service display: show the cancelling user's name
  // and the HR capacity so staff understand this was an HR cancellation action.
  function buildSsCancelledLeaveActionByHtml(request = {}, options = {}) {
    const compact = Boolean(options.compact);
    const nameClass = compact ? "fw-semibold small" : "fw-semibold";

    return `
      <div class="${nameClass}">
        ${ssEscapeHtml(getSsCancelledLeaveActionBy(request))}
      </div>
      <div class="text-secondary small mt-1">
        Cancelled by HR
      </div>
    `;
  }

  function getSsCancelledLeaveReason(request = {}) {
    return String(request.cancellation_reason || "").trim() || "No cancellation reason recorded.";
  }

  function getSsCancelledLeaveBalanceRestoredLabel(request = {}) {
    const restoredDays = Number(request.balance_restored_days || 0);

    if (!Number.isFinite(restoredDays) || restoredDays <= 0) {
      return "Not recorded";
    }

    return `${restoredDays} day(s)`;
  }

  function getSsOriginalManagerDecisionLabel(request = {}) {
    const originalStatus = request.cancelled_from_status || "Approved";
    const managerName = request.decision_by_name || "Manager / Supervisor";
    const decisionDate = request.decision_at ? ssFormatDateTime(request.decision_at) : "";

    return decisionDate
      ? `${originalStatus} by ${managerName} on ${decisionDate}`
      : `${originalStatus} by ${managerName}`;
  }

  function buildSsLeaveHistoryAuditHtml(request = {}) {
    if (isSsCancelledLeaveRequestAudit(request)) {
      return `
        <!-- EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
             HR/Manager self-service must show HR cancellation clearly,
             including HR's reason and the restored balance. -->
        <div class="row g-2 mt-2">
          <div class="col-12 col-md-4">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Cancellation Date</div>
              <div class="fw-semibold small">${ssEscapeHtml(getSsCancelledLeaveActionDate(request))}</div>
            </div>
          </div>

          <div class="col-12 col-md-4">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Cancelled By</div>
              ${buildSsCancelledLeaveActionByHtml(request, { compact: true })}
            </div>
          </div>

          <div class="col-12 col-md-4">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Balance Restored</div>
              <div class="fw-semibold small">${ssEscapeHtml(getSsCancelledLeaveBalanceRestoredLabel(request))}</div>
            </div>
          </div>

          <div class="col-12">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Cancellation Reason</div>
              <div class="fw-semibold small">${ssEscapeHtml(getSsCancelledLeaveReason(request))}</div>
            </div>
          </div>

          <div class="col-12">
            <div class="small text-secondary">
              Original manager decision: ${ssEscapeHtml(getSsOriginalManagerDecisionLabel(request))}
            </div>
          </div>
        </div>
      `;
    }

    if (!request.decision_comment) return "";

    return `
      <div class="small mt-2 text-secondary fst-italic">
        "${ssEscapeHtml(request.decision_comment)}"
      </div>
    `;
  }

  function renderSsLeaveRequests(requests) {
    const list = ssState.dom.ssLeaveRequestsList;
    if (!list) return;

    list.innerHTML = "";

    if (!requests.length) {
      ssState.dom.ssLeaveRequestsEmptyState?.classList.remove("d-none");
      list.classList.add("d-none");
      return;
    }

    ssState.dom.ssLeaveRequestsEmptyState?.classList.add("d-none");
    list.classList.remove("d-none");

    requests.forEach((request) => {
      const leaveTypeName = request.leave_types?.name || "Leave";
      const status = request.status || "Pending";
      const badgeClass = getSsLeaveStatusBadgeClass(status);
      const startDate = ssFormatDate(request.start_date);
      const endDate = ssFormatDate(request.end_date);
      const totalDays = request.total_days || 0;
      const submittedAt = ssFormatDate(request.submitted_at);
      const isReturned = ssNormalizeText(status).includes("returned");

      const card = document.createElement("div");
      card.className = "border rounded-3 p-3 mb-3";
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div class="fw-semibold">${ssEscapeHtml(leaveTypeName)}</div>
          ${renderSsModernStatusPill(status)}
        </div>
        <div class="small text-secondary mb-1">
          ${ssEscapeHtml(startDate)} to ${ssEscapeHtml(endDate)} • ${totalDays} day(s)
        </div>
        <div class="small text-secondary">Submitted: ${ssEscapeHtml(submittedAt)}</div>

        ${buildSsLeaveHistoryAuditHtml(request)}

        ${isReturned ? `
          <div class="mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary ss-amend-leave-btn"
              data-request-id="${ssEscapeHtml(String(request.id))}">
              <i class="bi bi-pencil me-1"></i>Edit &amp; Resubmit
            </button>
          </div>
        ` : ""}
      `;

      if (isReturned) {
        card.querySelector(".ss-amend-leave-btn")?.addEventListener("click", () => {
          startSsReturnedLeaveAmendment(request.id);
        });
      }

      list.appendChild(card);
    });
  }

  function renderSsLatestDecision(requests) {
    const decisionEmptyState = ssState.dom.ssLatestDecisionEmptyState;
    const decisionCard = ssState.dom.ssLatestDecisionCard;

    if (!decisionEmptyState || !decisionCard) return;

    const decided = (requests || [])
      .filter((request) => {
        const status = ssNormalizeText(request.status || "");

        return (
          isSsCancelledLeaveRequestAudit(request) ||
          status === "approved" ||
          status === "rejected" ||
          status === "declined" ||
          status === "returned" ||
          status === "returned for clarification"
        );
      })
      .sort((left, right) => {
        const leftDate = new Date(left.cancelled_at || left.decision_at || left.submitted_at || 0).getTime();
        const rightDate = new Date(right.cancelled_at || right.decision_at || right.submitted_at || 0).getTime();

        return rightDate - leftDate;
      });

    if (!decided.length) {
      decisionEmptyState.classList.remove("d-none");
      decisionCard.classList.add("d-none");
      return;
    }

    const latest = decided[0];
    const leaveTypeName = latest.leave_types?.name || "Leave";
    const status = latest.status || "--";
    const isCancelledAudit = isSsCancelledLeaveRequestAudit(latest);

    const actionDate = isCancelledAudit
      ? getSsCancelledLeaveActionDate(latest)
      : ssFormatDateTime(latest.decision_at);

    const actionBy = isCancelledAudit
      ? getSsCancelledLeaveActionBy(latest)
      : latest.decision_by_name || latest.decision_by || "--";

    const noteLabel = isCancelledAudit ? "Cancellation Reason" : "Manager Comment";
    const noteText = isCancelledAudit
      ? getSsCancelledLeaveReason(latest)
      : latest.decision_comment || "No comment provided.";

    const actionByLabel = isCancelledAudit ? "Cancelled By" : "Decision By";
    const actionDateLabel = isCancelledAudit ? "Cancellation Date & Time" : "Decision Date & Time";

    const cancellationAuditHtml = isCancelledAudit
      ? `
        <!-- EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
             HR/Manager self-service latest update needs restored-balance and
             original-manager-decision context for HR-safe clarity. -->
        <div class="row g-3 mt-3">
          <div class="col-12 col-md-6">
            <div class="border rounded-3 bg-light-subtle p-3 h-100">
              <div class="info-tile-label">Balance Restored</div>
              <div class="fw-semibold">${ssEscapeHtml(getSsCancelledLeaveBalanceRestoredLabel(latest))}</div>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="border rounded-3 bg-light-subtle p-3 h-100">
              <div class="info-tile-label">Original Manager Decision</div>
              <div class="fw-semibold">${ssEscapeHtml(getSsOriginalManagerDecisionLabel(latest))}</div>
            </div>
          </div>
        </div>
      `
      : "";

    decisionEmptyState.classList.add("d-none");
    decisionCard.classList.remove("d-none");

    decisionCard.innerHTML = `
      <!-- EMPLOYEE-FACING CANCELLED LEAVE AUDIT DISPLAY - STEP 1A
           Render Latest Leave Decision dynamically so static labels such as
           "Decision By" and "Comment" do not mislabel HR cancellation rows. -->
      <div class="info-tile border-start border-4 ${isCancelledAudit ? "border-secondary" : "border-primary"}">
        <div class="d-flex flex-column flex-lg-row justify-content-between gap-3 mb-3">
          <div>
            <div class="info-tile-label">${isCancelledAudit ? "Latest Leave Update" : "Latest Decision"}</div>
            <div class="d-flex flex-wrap align-items-center gap-2">
              ${renderSsModernStatusPill(status)}
              <span class="fw-semibold">${ssEscapeHtml(leaveTypeName)}</span>
            </div>
          </div>

          <div class="text-lg-end">
            <div class="info-tile-label">${ssEscapeHtml(actionDateLabel)}</div>
            <div class="fw-semibold">${ssEscapeHtml(actionDate)}</div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-12 col-md-4">
            <div class="border rounded-3 bg-light-subtle p-3 h-100">
              <div class="info-tile-label">Requested Period</div>
              <div class="fw-semibold">
                ${ssEscapeHtml(ssFormatDate(latest.start_date))} to ${ssEscapeHtml(ssFormatDate(latest.end_date))}
              </div>
            </div>
          </div>

          <div class="col-12 col-md-4">
            <div class="border rounded-3 bg-light-subtle p-3 h-100">
              <div class="info-tile-label">Total Days</div>
              <div class="fw-semibold">${ssEscapeHtml(latest.total_days || "--")} day(s)</div>
            </div>
          </div>

          <div class="col-12 col-md-4">
            <div class="border rounded-3 bg-light-subtle p-3 h-100">
<div class="info-tile-label">${ssEscapeHtml(actionByLabel)}</div>
${isCancelledAudit
        ? buildSsCancelledLeaveActionByHtml(latest)
        : `<div class="fw-semibold">${ssEscapeHtml(actionBy)}</div>`
      }
            </div>
          </div>
        </div>

        ${cancellationAuditHtml}

        <div class="border rounded-3 bg-light-subtle p-3 mt-3">
          <div class="info-tile-label">${ssEscapeHtml(noteLabel)}</div>
          <div class="fw-semibold">${ssEscapeHtml(noteText)}</div>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Leave policy block
  // -----------------------------------------------------------------------
  function getSsLeaveRequestPolicyBlock() {
    const leaveTypeId = ssState.dom.ssLeaveType?.value || "";
    const startDate = ssState.dom.ssStartDate?.value || "";
    const endDate = ssState.dom.ssEndDate?.value || "";

    if (!leaveTypeId) return null;

    const selectedOption = ssState.dom.ssLeaveType?.options[
      ssState.dom.ssLeaveType?.selectedIndex
    ];

    // LEAVE ELIGIBILITY / REQUEST LEAVE VISIBILITY - STEP 1B
    // Check eligibility before date checks so stale or manually selected
    // ineligible leave types are blocked immediately.
    const selectedLeaveType = {
      id: String(leaveTypeId || "").trim(),
      name: String(selectedOption?.textContent || "").trim(),
      code: String(selectedOption?.dataset?.code || "").trim(),
      eligibilityRule: String(
        selectedOption?.dataset?.eligibilityRule || "all_employees",
      ).trim(),
    };

    const eligibilityBlock = getSsLeaveTypeEligibilityBlock(selectedLeaveType);

    if (eligibilityBlock) {
      return eligibilityBlock;
    }

    if (!startDate || !endDate) return null;

    const leaveTypeName = ssNormalizeText(selectedOption?.textContent || "");
    const isSingleApplicationType = SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS.some((kw) =>
      leaveTypeName.includes(kw),
    );

    const activeRequests = (ssState.leaveRequests || []).filter((r) => {
      const status = ssNormalizeText(r.status || "");
      return status === "pending approval" || status === "approved";
    });

    if (isSingleApplicationType) {
      const existing = activeRequests.find(
        (r) =>
          String(r.leave_type_id) === String(leaveTypeId) &&
          (ssNormalizeText(r.status) === "pending approval" ||
            ssNormalizeText(r.status) === "approved"),
      );
      if (existing) {
        return {
          message: `You already have an active ${selectedOption?.textContent || "leave"} request. This type of leave can only be applied for once.`,
        };
      }
    }

    if (startDate && endDate) {
      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);

      const overlap = activeRequests.find((r) => {
        if (!r.start_date || !r.end_date) return false;
        const existStart = new Date(r.start_date);
        const existEnd = new Date(r.end_date);
        return newStart <= existEnd && newEnd >= existStart;
      });

      if (overlap) {
        return {
          message: `These dates overlap with an existing ${ssNormalizeText(overlap.status) === "approved" ? "approved" : "pending"} leave request (${ssFormatDate(overlap.start_date)} to ${ssFormatDate(overlap.end_date)}). Please choose different dates.`,
        };
      }
    }

    return null;
  }

  function updateSsLeaveRequestBlockNotice() {
    const notice = ssState.dom.ssLeaveRequestBlockNotice;
    if (!notice) return;

    const block = getSsLeaveRequestPolicyBlock();

    if (block) {
      notice.textContent = block.message;
      notice.classList.remove("d-none");
    } else {
      notice.classList.add("d-none");
      notice.textContent = "";
    }

    updateSsLeaveSubmitButtonState();
  }

  function updateSsLeaveSubmitButtonState() {
    const btn = ssState.dom.ssSubmitLeaveBtn;
    if (!btn) return;

    const leaveType = ssState.dom.ssLeaveType?.value || "";
    const startDate = ssState.dom.ssStartDate?.value || "";
    const endDate = ssState.dom.ssEndDate?.value || "";
    const reason = ssState.dom.ssLeaveReason?.value?.trim() || "";
    const block = getSsLeaveRequestPolicyBlock();

    const isValid = leaveType && startDate && endDate && reason && !block;

    btn.disabled = !isValid;
    btn.className = isValid
      ? "btn btn-primary dashboard-action-btn"
      : "btn btn-secondary dashboard-action-btn";
  }

  // -----------------------------------------------------------------------
  // Leave form
  // -----------------------------------------------------------------------
  function calculateSsLeaveDays() {
    const startDateValue = ssState.dom.ssStartDate?.value;
    const endDateValue = ssState.dom.ssEndDate?.value;

    if (!startDateValue || !endDateValue || !ssState.dom.ssTotalDays) return;

    const startDate = new Date(startDateValue);
    const endDate = new Date(endDateValue);

    if (endDate < startDate) {
      ssState.dom.ssTotalDays.value = "";
      return;
    }

    const totalDays =
      Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    ssState.dom.ssTotalDays.value = totalDays;
  }

  function bindSsLeaveFormEvents() {
    ssState.dom.ssLeaveType?.addEventListener("change", () => {
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssStartDate?.addEventListener("change", () => {
      calculateSsLeaveDays();
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssEndDate?.addEventListener("change", () => {
      calculateSsLeaveDays();
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssLeaveReason?.addEventListener("input", () => {
      updateSsLeaveSubmitButtonState();
    });

    ssState.dom.ssLeaveRequestForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleSsLeaveRequestSubmit();
    });
  }

  function validateSsLeaveRequestForm() {
    let isValid = true;

    const fields = [
      ssState.dom.ssLeaveType,
      ssState.dom.ssStartDate,
      ssState.dom.ssEndDate,
      ssState.dom.ssLeaveReason,
    ];

    fields.forEach((f) => f?.classList.remove("is-invalid"));

    if (!ssState.dom.ssLeaveType?.value) {
      ssState.dom.ssLeaveType?.classList.add("is-invalid");
      isValid = false;
    }
    if (!ssState.dom.ssStartDate?.value) {
      ssState.dom.ssStartDate?.classList.add("is-invalid");
      isValid = false;
    }
    if (!ssState.dom.ssEndDate?.value) {
      ssState.dom.ssEndDate?.classList.add("is-invalid");
      isValid = false;
    }

    const start = ssState.dom.ssStartDate?.value;
    const end = ssState.dom.ssEndDate?.value;
    if (start && end && new Date(end) < new Date(start)) {
      ssState.dom.ssEndDate?.classList.add("is-invalid");
      showSsAlert("warning", "End date cannot be earlier than start date.");
      isValid = false;
    }

    if (!ssState.dom.ssLeaveReason?.value?.trim()) {
      ssState.dom.ssLeaveReason?.classList.add("is-invalid");
      isValid = false;
    }

    const totalDays = Number(ssState.dom.ssTotalDays?.value || 0);
    if (!totalDays || totalDays < 1) {
      showSsAlert("warning", "Total leave days must be at least 1.");
      isValid = false;
    }

    const block = getSsLeaveRequestPolicyBlock();
    if (block) {
      ssState.dom.ssLeaveType?.classList.add("is-invalid");
      showSsAlert("warning", block.message);
      isValid = false;
    }

    return isValid;
  }

  async function handleSsLeaveRequestSubmit() {
    clearSsAlert();

    if (!ssState.currentUser) {
      showSsAlert("danger", "No active user session found.");
      return;
    }

    calculateSsLeaveDays();

    if (!validateSsLeaveRequestForm()) return;

    const supabase = getSupabaseClient();
    const employeeId = getPreferredSsEmployeeId();

    if (!employeeId) {
      showSsAlert("danger", "Employee record could not be resolved. Cannot submit leave request.");
      return;
    }

    const submitBtn = ssState.dom.ssSubmitLeaveBtn;
    const originalHtml = submitBtn?.innerHTML || "";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Submitting…`;
    }

    try {
      // Check if this is a resubmission of a returned request
      if (ssState.returnedLeaveAmendmentRequestId) {
        const { data, error } = await supabase.rpc("resubmit_returned_leave_request", {
          p_leave_request_id: ssState.returnedLeaveAmendmentRequestId,
          p_leave_type_id: ssState.dom.ssLeaveType.value,
          p_start_date: ssState.dom.ssStartDate.value,
          p_end_date: ssState.dom.ssEndDate.value,
          p_total_days: Number(ssState.dom.ssTotalDays.value),
          p_reason: ssState.dom.ssLeaveReason.value.trim(),
        });

        if (error) throw error;

        ssState.returnedLeaveAmendmentRequestId = null;
        if (submitBtn) {
          submitBtn.innerHTML = `<i class="bi bi-send-check me-2"></i>Submit for Approval`;
        }
        showSsAlert("success", "Leave request resubmitted successfully.");
      } else {
        const { error } = await supabase.from("leave_requests").insert({
          employee_id: employeeId,
          leave_type_id: ssState.dom.ssLeaveType.value,
          start_date: ssState.dom.ssStartDate.value,
          end_date: ssState.dom.ssEndDate.value,
          total_days: Number(ssState.dom.ssTotalDays.value),
          reason: ssState.dom.ssLeaveReason.value.trim(),
          status: "Pending Approval",
        });

        if (error) throw error;
        showSsAlert("success", "Leave request submitted successfully.");
      }

      // Reset form
      ssState.dom.ssLeaveType.value = "";
      ssState.dom.ssStartDate.value = "";
      ssState.dom.ssEndDate.value = "";
      ssState.dom.ssTotalDays.value = "";
      ssState.dom.ssLeaveReason.value = "";
      updateSsLeaveSubmitButtonState();
      updateSsLeaveRequestBlockNotice();

      await loadSsLeaveRequests();
      await loadSsLeaveBalances();
    } catch (error) {
      console.error("[SS] Leave submission error:", error);
      showSsAlert("danger", error.message || "Leave request could not be submitted.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        updateSsLeaveSubmitButtonState();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Returned leave amendment
  // -----------------------------------------------------------------------
  function startSsReturnedLeaveAmendment(leaveRequestId) {
    const request = (ssState.leaveRequests || []).find(
      (r) => String(r.id) === String(leaveRequestId),
    );

    if (!request) {
      showSsAlert("warning", "Returned leave request could not be found.");
      return;
    }

    ssState.returnedLeaveAmendmentRequestId = request.id;

    if (ssState.dom.ssLeaveType) ssState.dom.ssLeaveType.value = request.leave_type_id || "";
    if (ssState.dom.ssStartDate) ssState.dom.ssStartDate.value = request.start_date || "";
    if (ssState.dom.ssEndDate) ssState.dom.ssEndDate.value = request.end_date || "";
    if (ssState.dom.ssLeaveReason) ssState.dom.ssLeaveReason.value = request.reason || "";

    calculateSsLeaveDays();
    updateSsLeaveRequestBlockNotice();

    if (ssState.dom.ssSubmitLeaveBtn) {
      ssState.dom.ssSubmitLeaveBtn.innerHTML = `<i class="bi bi-arrow-repeat me-2"></i>Resubmit Returned Request`;
    }

    // Switch to leave section and scroll to form
    switchSsSubSection("leave");
    ssState.dom.ssLeaveRequestForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // -----------------------------------------------------------------------
  // Payroll
  // -----------------------------------------------------------------------
  async function loadSsPayroll() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      renderSsPayroll([]);
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

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query
      .eq("status", "Authorised")
      .eq("is_finalised", true)
      .order("pay_date", { ascending: false });

    if (error) {
      console.error("[SS] Error loading payroll:", error);
      showSsAlert("danger", "Unable to load payroll history.");
      return;
    }

    const records = Array.isArray(data)
      ? data.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
      : [];

    ssState.payrollRecords = records;
    applySsPayrollFilters();
  }

  function getFilteredSsPayrollRecords() {
    const records = Array.isArray(ssState.payrollRecords) ? ssState.payrollRecords : [];
    const searchValue = ssNormalizeText(ssState.dom.ssPayrollSearchInput?.value || "");
    const fromDateValue = ssState.dom.ssPayrollDateFromInput?.value || "";
    const toDateValue = ssState.dom.ssPayrollDateToInput?.value || "";

    return records.filter((record) => {
      const payCycle = ssNormalizeText(record?.pay_cycle || "");
      if (searchValue && !payCycle.includes(searchValue)) return false;

      const recordDateValue = String(record?.pay_date || "").trim();
      if (!recordDateValue) return !fromDateValue && !toDateValue;

      const recordDate = new Date(recordDateValue);
      if (Number.isNaN(recordDate.getTime())) return false;

      if (fromDateValue) {
        const fromDate = new Date(fromDateValue);
        if (!Number.isNaN(fromDate.getTime()) && recordDate < fromDate) return false;
      }

      if (toDateValue) {
        const toDate = new Date(toDateValue);
        if (!Number.isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          if (recordDate > toDate) return false;
        }
      }

      return true;
    });
  }

  function applySsPayrollFilters() {
    renderSsPayroll(getFilteredSsPayrollRecords());
  }

  function renderSsPayroll(records) {
    renderSsCurrentPayrollSummary(ssState.payrollRecords);
    renderSsPayrollHistory(records);
  }

  function renderSsCurrentPayrollSummary(records) {
    const payrollRecords = Array.isArray(records) ? records : [];

    if (!payrollRecords.length) {
      ssState.dom.ssCurrentPayrollEmptyState?.classList.remove("d-none");
      ssState.dom.ssCurrentPayrollSummaryGrid?.classList.add("d-none");
      return;
    }

    const latest = payrollRecords[0];

    ssState.dom.ssCurrentPayrollEmptyState?.classList.add("d-none");
    ssState.dom.ssCurrentPayrollSummaryGrid?.classList.remove("d-none");

    if (ssState.dom.ssCurrentPayCycle) {
      ssState.dom.ssCurrentPayCycle.textContent = latest.pay_cycle || "--";
    }
    setSsPayrollSummaryFinancialValue(
      ssState.dom.ssCurrentGrossPay,
      ssFormatCurrency(latest.gross_pay, latest.currency || "NGN"),
    );

    setSsPayrollSummaryFinancialValue(
      ssState.dom.ssCurrentTotalDeductions,
      ssFormatCurrency(latest.total_deductions, latest.currency || "NGN"),
    );

    setSsPayrollSummaryFinancialValue(
      ssState.dom.ssCurrentNetPay,
      ssFormatCurrency(latest.net_pay, latest.currency || "NGN"),
    );
  }

  // MANAGER SELF-SERVICE PAYSLIP VIEW - STEP 1E
  // Only show the View action when the host dashboard table has explicitly
  // declared a View column. This prevents HR/other self-service hosts from
  // getting an extra table cell before their HTML header is updated.
  function shouldRenderSsPayslipViewColumn() {
    return Boolean(
      ssState.dom.ssPayrollHistoryTableWrapper?.querySelector(
        "[data-ss-payslip-view-column='true']",
      ),
    );
  }

  // MANAGER SELF-SERVICE PAYSLIP VIEW - STEP 1E
  // Resolve one authorised payroll record from the already-loaded self-service
  // payroll collection. No extra Supabase query and no payroll recalculation.
  function getSsPayrollRecordById(payrollId) {
    return (ssState.payrollRecords || []).find(
      (record) => String(record.id) === String(payrollId),
    );
  }

  // MANAGER SELF-SERVICE PAYSLIP VIEW - STEP 1E
  // Employee identity used in the read-only payslip preview.
  // This mirrors the existing PDF context and does not expose anything new.
  function getSsPayslipEmployeeContext() {
    const employeeName =
      `${ssState.employeeRecord?.first_name || ""} ${ssState.employeeRecord?.last_name || ""}`.trim() ||
      ssState.currentProfile?.full_name ||
      "Staff Member";

    return {
      employeeName,
      employeeEmail:
        ssState.employeeRecord?.work_email ||
        ssState.currentProfile?.email ||
        ssState.currentUser?.email ||
        "--",
      employeeId:
        ssState.employeeRecord?.employee_id ||
        ssState.employeeRecord?.staff_id ||
        ssState.employeeRecord?.employee_number ||
        "--",
      department: ssState.employeeRecord?.department || "--",
      jobTitle:
        ssState.employeeRecord?.job_title ||
        ssState.employeeRecord?.position ||
        "Staff Member",
    };
  }

  // MANAGER SELF-SERVICE PAYSLIP VIEW - STEP 1E
  // Compact Alpatech letterhead matched to the HR/Employee payslip preview
  // format. Branding only; no payroll values or calculations are changed.
  // PAYSLIP DOCUMENT SYSTEM - STEP 2
  // Shared Self-Service preview used by HR and Manager dashboards. This is
  // presentation-only and keeps the existing authorised payroll query,
  // employee identity resolution, filters, and PDF action unchanged.
  function getSsPayslipCompanyName() {
    const isAlpatech = isSsAlpatechWorkspace();

    return (
      ssState.currentProfile?.company_name ||
      ssState.currentProfile?.organization_name ||
      ssState.currentProfile?.tenant_name ||
      ssState.employeeRecord?.company_name ||
      ssState.employeeRecord?.organization_name ||
      ssState.employeeRecord?.tenant_name ||
      (isAlpatech ? "ALPATECH" : "BexHR")
    );
  }

  function buildSsPayslipBrandHeaderHtml(record = {}) {
    const isAlpatech = isSsAlpatechWorkspace();
    const companyName = getSsPayslipCompanyName();
    const brandName = isAlpatech ? "ALPATECH" : companyName;
    const brandMarkHtml = isAlpatech
      ? `<span class="bexhr-payslip-brand-mark bexhr-payslip-brand-mark--image" aria-hidden="true">
           <img src="assets/alpatech-flame.png" alt="" />
         </span>`
      : `<span class="bexhr-payslip-brand-mark" aria-hidden="true">B</span>`;

    return `
      <header class="bexhr-payslip-letterhead ${isAlpatech ? "bexhr-payslip-letterhead--alpatech" : ""}">
        <div class="bexhr-payslip-brand-block">
          <div class="bexhr-payslip-brand-line">
            ${brandMarkHtml}
            <span class="bexhr-payslip-brand-divider" aria-hidden="true"></span>
            <div>
              <div class="bexhr-payslip-brand-name">${ssEscapeHtml(brandName || "BexHR")}</div>
              <div class="bexhr-payslip-document-label">Confidential Payroll Payslip</div>
            </div>
          </div>
          ${!isAlpatech && companyName && ssNormalizeText(companyName) !== "bexhr"
            ? `<div class="bexhr-payslip-platform-label">Prepared securely with BexHR</div>`
            : ""}
        </div>

        <div class="bexhr-payslip-document-meta">
          <span class="bexhr-payslip-status-badge">
            <span aria-hidden="true"></span>${ssEscapeHtml(record.status || "Authorised")}
          </span>
          <strong>${ssEscapeHtml(record.pay_cycle || "Payroll")}</strong>
          <span>Pay date: ${ssEscapeHtml(ssFormatDate(record.pay_date))}</span>
        </div>
      </header>
    `;
  }

  function buildSsPayslipPreviewRows(rows = [], emptyText = "No items recorded.") {
    const visibleRows = rows.filter((row) => row && row.label);

    if (!visibleRows.length) {
      return `<div class="bexhr-payslip-empty-line">${ssEscapeHtml(emptyText)}</div>`;
    }

    return visibleRows
      .map((row) => `
        <div class="bexhr-payslip-line-item">
          <span>${ssEscapeHtml(row.label)}</span>
          <strong>${ssEscapeHtml(row.value)}</strong>
        </div>
      `)
      .join("");
  }

  function buildSsPayslipStructureHtml(items = []) {
    const visibleItems = items.filter((item) => {
      if (!item || !item.label) return false;
      const value = String(item.value ?? "").trim();
      return value && value !== "--" && value !== "0.0%" && value !== "NGN 0.00";
    });

    if (!visibleItems.length) return "";

    return `
      <section class="bexhr-payslip-structure-card">
        <div class="bexhr-payslip-section-heading">
          <span class="bexhr-payslip-section-icon" aria-hidden="true"><i class="bi bi-diagram-3"></i></span>
          <div><span>Payroll basis</span><h3>Salary Structure</h3></div>
        </div>
        <div class="bexhr-payslip-structure-grid">
          ${visibleItems
            .map((item) => `
              <div class="bexhr-payslip-structure-item ${item.emphasis ? "bexhr-payslip-structure-item--emphasis" : ""}">
                <span>${ssEscapeHtml(item.label)}</span>
                <strong>${ssEscapeHtml(item.value)}</strong>
              </div>
            `)
            .join("")}
        </div>
      </section>
    `;
  }

  function buildSsPayslipPreviewContent(record = {}) {
    const currency = record.currency || "NGN";
    const employee = getSsPayslipEmployeeContext();
    const companyName = getSsPayslipCompanyName();
    const money = (value) => ssFormatCurrency(value, currency);
    const percent = (value) => {
      const numericValue = Number(value || 0);
      if (!Number.isFinite(numericValue) || numericValue === 0) return "0.0%";
      return `${(Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue).toFixed(1)}%`;
    };

    const earningsRows = [
      { label: "Basic Pay", value: money(record.basic_pay), amount: record.basic_pay },
      { label: "Housing Allowance", value: money(record.housing_allowance), amount: record.housing_allowance },
      { label: "Transport Allowance", value: money(record.transport_allowance), amount: record.transport_allowance },
      { label: "Utility Allowance", value: money(record.utility_allowance), amount: record.utility_allowance },
      { label: "Medical Allowance", value: money(record.medical_allowance), amount: record.medical_allowance },
      { label: "Other Allowance", value: money(record.other_allowance), amount: record.other_allowance },
      { label: "Bonus", value: money(record.bonus), amount: record.bonus },
      { label: "Overtime", value: money(record.overtime), amount: record.overtime },
      { label: "Logistics Allowance", value: money(record.logistics_allowance), amount: record.logistics_allowance },
      { label: "Data / Airtime Allowance", value: money(record.data_airtime_allowance), amount: record.data_airtime_allowance },
    ].filter((row) => Number(row.amount || 0) > 0);

    const deductionRows = [
      { label: "PAYE Tax", value: money(record.paye_tax), amount: record.paye_tax },
      { label: "WHT Tax", value: money(record.wht_tax), amount: record.wht_tax },
      { label: "Employee Pension", value: money(record.employee_pension), amount: record.employee_pension },
      { label: "Other Deductions", value: money(record.other_deductions), amount: record.other_deductions },
    ].filter((row) => Number(row.amount || 0) > 0);

    // EMPLOYEE-FACING PAYSLIP DATA MINIMISATION - STEP 2
    // Do not expose internal payroll model versions, structure variants,
    // layout identifiers, or allocation configuration to employees.
    const structureHtml = buildSsPayslipStructureHtml([
      {
        label: "Pay Type",
        value: record.employee_group || record.payroll_model || "Regular",
      },
      { label: "Increment", value: percent(record.increment_percent) },
      { label: "Monthly Gross Salary", value: money(record.gross_pay), emphasis: true },
    ]);

    return `
      <article class="bexhr-payslip-document bexhr-payslip-document--self-service">
        ${buildSsPayslipBrandHeaderHtml(record)}

        <section class="bexhr-payslip-party-grid">
          <article class="bexhr-payslip-party-card">
            <div class="bexhr-payslip-party-label">Company</div>
            <h3>${ssEscapeHtml(companyName || "BexHR")}</h3>
            <div class="bexhr-payslip-contact-lines">
              <span>Authorised payroll record</span>
              <span>${ssEscapeHtml(record.pay_cycle || "Payroll")} payroll cycle</span>
            </div>
          </article>

          <article class="bexhr-payslip-party-card bexhr-payslip-party-card--employee">
            <div class="bexhr-payslip-party-label">Employee</div>
            <h3>${ssEscapeHtml(employee.employeeName)}</h3>
            <div class="bexhr-payslip-contact-lines">
              <span>${ssEscapeHtml(employee.employeeEmail)}</span>
              <span>${ssEscapeHtml(employee.department)} · ${ssEscapeHtml(employee.jobTitle)}</span>
            </div>
            <div class="bexhr-payslip-employee-number">
              <span>Employee No.</span>
              <strong>${ssEscapeHtml(employee.employeeId)}</strong>
            </div>
          </article>
        </section>

        <section class="bexhr-payslip-summary-grid" aria-label="Payslip totals">
          <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--gross">
            <span class="bexhr-payslip-summary-icon" aria-hidden="true"><i class="bi bi-wallet2"></i></span>
            <div><span>Gross Pay</span><strong>${ssEscapeHtml(money(record.gross_pay))}</strong></div>
          </article>
          <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--deductions">
            <span class="bexhr-payslip-summary-icon" aria-hidden="true"><i class="bi bi-dash-circle"></i></span>
            <div><span>Total Deductions</span><strong>${ssEscapeHtml(money(record.total_deductions))}</strong></div>
          </article>
          <article class="bexhr-payslip-summary-card bexhr-payslip-summary-card--net">
            <span class="bexhr-payslip-summary-icon" aria-hidden="true"><i class="bi bi-check2-circle"></i></span>
            <div><span>Net Pay</span><strong>${ssEscapeHtml(money(record.net_pay))}</strong></div>
          </article>
        </section>

        ${structureHtml}

        <section class="bexhr-payslip-breakdown-grid">
          <article class="bexhr-payslip-breakdown-card bexhr-payslip-breakdown-card--earnings">
            <div class="bexhr-payslip-section-heading">
              <span class="bexhr-payslip-section-icon" aria-hidden="true"><i class="bi bi-plus-circle"></i></span>
              <div><span>Income</span><h3>Earnings</h3></div>
            </div>
            <div class="bexhr-payslip-line-items">
              ${buildSsPayslipPreviewRows(earningsRows, "No earnings breakdown recorded.")}
            </div>
            <div class="bexhr-payslip-section-total"><span>Gross Pay</span><strong>${ssEscapeHtml(money(record.gross_pay))}</strong></div>
          </article>

          <article class="bexhr-payslip-breakdown-card bexhr-payslip-breakdown-card--deductions">
            <div class="bexhr-payslip-section-heading">
              <span class="bexhr-payslip-section-icon" aria-hidden="true"><i class="bi bi-dash-circle"></i></span>
              <div><span>Withheld</span><h3>Deductions</h3></div>
            </div>
            <div class="bexhr-payslip-line-items">
              ${buildSsPayslipPreviewRows(deductionRows, "No deductions recorded.")}
            </div>
            <div class="bexhr-payslip-section-total"><span>Total Deductions</span><strong>${ssEscapeHtml(money(record.total_deductions))}</strong></div>
          </article>
        </section>

        <section class="bexhr-payslip-net-panel">
          <div><span>Amount payable</span><strong>Net Pay</strong></div>
          <div class="bexhr-payslip-net-amount">${ssEscapeHtml(money(record.net_pay))}</div>
        </section>

        <footer class="bexhr-payslip-footer-note">
          <span class="bexhr-payslip-footer-icon" aria-hidden="true"><i class="bi bi-shield-lock"></i></span>
          <div>
            <strong>Confidential employee document</strong>
            <p>This read-only payslip is intended only for the named employee. Use the Download PDF action to keep an authorised copy.</p>
          </div>
        </footer>
      </article>
    `;
  }

  function ensureSsPayslipPreviewModal() {
    let modal = document.getElementById("ssPayslipPreviewModal");

    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "ssPayslipPreviewModal";
    modal.className = "d-none position-fixed top-0 start-0 w-100 h-100 bexhr-payslip-modal ss-payslip-preview-modal";
    modal.style.zIndex = "1060";
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <div class="container h-100 d-flex align-items-center justify-content-center py-4 bexhr-payslip-modal-container">
        <section class="card border-0 shadow-lg rounded-4 w-100 bexhr-payslip-modal-shell"
          role="dialog" aria-modal="true" aria-labelledby="ssPayslipPreviewTitle">
          <header class="card-header bg-white border-0 d-flex justify-content-between align-items-start gap-3 p-4 bexhr-payslip-modal-header">
            <div>
              <h2 id="ssPayslipPreviewTitle" class="h4 mb-1">Payslip Preview</h2>
              <p class="text-secondary mb-0">Review your authorised payroll document or download a PDF copy.</p>
            </div>
            <button type="button" id="closeSsPayslipPreviewBtn" class="btn btn-sm btn-outline-secondary"
              aria-label="Close payslip preview"><i class="bi bi-x-lg"></i></button>
          </header>

          <div id="ssPayslipPreviewContent" class="card-body p-4 bexhr-payslip-modal-content">
            <div class="text-center text-secondary py-4">Select a payroll record to view payslip details.</div>
          </div>

          <footer class="card-footer bg-light border-0 d-flex flex-wrap justify-content-end gap-2 p-4 bexhr-payslip-modal-footer">
            <button type="button" id="downloadSsPayslipPreviewBtn" class="btn btn-primary dashboard-action-btn">
              <i class="bi bi-file-earmark-pdf me-2"></i>Download PDF
            </button>
            <button type="button" id="closeSsPayslipPreviewFooterBtn" class="btn btn-outline-secondary dashboard-action-btn">Close Preview</button>
          </footer>
        </section>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#closeSsPayslipPreviewBtn")?.addEventListener("click", closeSsPayslipPreviewModal);
    modal.querySelector("#closeSsPayslipPreviewFooterBtn")?.addEventListener("click", closeSsPayslipPreviewModal);
    modal.querySelector("#downloadSsPayslipPreviewBtn")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const payrollId = button?.dataset?.payrollId || "";
      if (!payrollId) {
        showSsAlert("warning", "Select an authorised payroll record before downloading a payslip PDF.");
        return;
      }
      await downloadSsPayslipPdf(payrollId, button);
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeSsPayslipPreviewModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.classList.contains("d-none")) {
        closeSsPayslipPreviewModal();
      }
    });

    return modal;
  }

  function closeSsPayslipPreviewModal() {
    const modal = document.getElementById("ssPayslipPreviewModal");
    if (!modal) return;
    modal.classList.add("d-none");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function openSsPayslipPreview(payrollId) {
    clearSsAlert();

    const record = getSsPayrollRecordById(payrollId);
    if (!record) {
      showSsAlert("danger", "Payroll record not found.");
      return;
    }

    const modal = ensureSsPayslipPreviewModal();
    const title = modal.querySelector("#ssPayslipPreviewTitle");
    const content = modal.querySelector("#ssPayslipPreviewContent");
    const downloadButton = modal.querySelector("#downloadSsPayslipPreviewBtn");

    if (title) title.textContent = `Payslip Preview - ${record.pay_cycle || "Payroll"}`;
    if (content) content.innerHTML = buildSsPayslipPreviewContent(record);
    if (downloadButton) downloadButton.dataset.payrollId = String(record.id || payrollId);

    modal.classList.remove("d-none");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }


  // SYSTEM-WIDE SELF-SERVICE PAYROLL HISTORY CARDS - v1.0.0
  // Shared by HR and Manager My Self-Service. Presentation only: existing
  // payroll filtering, preview, PDF, tenant branding, and authorised-record
  // access rules remain unchanged.
  function renderSsPayrollHistory(records) {
    const tbody = ssState.dom.ssPayrollHistoryTableBody;
    if (!tbody) return;

    const payrollRecords = Array.isArray(records) ? records : [];
    tbody.innerHTML = "";

    if (!payrollRecords.length) {
      ssState.dom.ssPayrollHistoryEmptyState?.classList.remove("d-none");
      ssState.dom.ssPayrollHistoryTableWrapper?.classList.add("d-none");
      return;
    }

    ssState.dom.ssPayrollHistoryEmptyState?.classList.add("d-none");
    ssState.dom.ssPayrollHistoryTableWrapper?.classList.remove("d-none");

    // Preserve the existing host-aware View column behaviour. HR and Manager
    // currently expose View + PDF, while any older host without View remains safe.
    const shouldShowViewAction = shouldRenderSsPayslipViewColumn();

    payrollRecords.forEach((record) => {
      const currency = record.currency || "NGN";
      const payeTax = Number(record.paye_tax || 0);
      const whtTax = Number(record.wht_tax || 0);
      const taxValue = payeTax || whtTax;
      const taxLabel = payeTax > 0 ? "PAYE Tax" : whtTax > 0 ? "WHT Tax" : "Tax";
      const employeePension = Number(record.employee_pension || 0);
      const statusLabel = String(record.status || "Authorised").trim() || "Authorised";
      const normalizedStatus = ssNormalizeText(statusLabel);
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
      const employeeGroup = String(record.employee_group || "Regular").trim() || "Regular";

      const row = document.createElement("tr");
      row.className = "payroll-summary-row bexhr-self-service-payroll-row";
      row.dataset.payrollId = record.id;

      row.innerHTML = `
        <td colspan="${shouldShowViewAction ? 10 : 9}" class="bexhr-self-service-payroll-cell">
          <article class="bexhr-self-service-payroll-card">
            <header class="bexhr-self-service-payroll-header">
              <div class="bexhr-self-service-payroll-identity">
                <span class="bexhr-self-service-payroll-icon" aria-hidden="true">
                  <i class="bi bi-receipt-cutoff"></i>
                </span>

                <div class="bexhr-self-service-payroll-title-group">
                  <span class="bexhr-self-service-payroll-eyebrow">Authorised pay cycle</span>
                  <strong class="bexhr-self-service-payroll-cycle">
                    ${ssEscapeHtml(record.pay_cycle || "--")}
                  </strong>
                  <span class="bexhr-self-service-payroll-group">
                    ${ssEscapeHtml(employeeGroup)}
                  </span>
                </div>
              </div>

              <div class="bexhr-self-service-payroll-date">
                <span>Pay date</span>
                <strong>${ssEscapeHtml(ssFormatDate(record.pay_date))}</strong>
              </div>

              <span class="bexhr-self-service-payroll-status ${statusTone}">
                <i class="bi ${statusIcon}" aria-hidden="true"></i>
                ${ssEscapeHtml(statusLabel)}
              </span>
            </header>

            <section class="bexhr-self-service-payroll-metrics" aria-label="Payroll summary">
              <div class="bexhr-self-service-payroll-metric">
                <span>Gross Pay</span>
                <strong>${ssEscapeHtml(ssFormatCurrency(record.gross_pay, currency))}</strong>
              </div>

              <div class="bexhr-self-service-payroll-metric">
                <span>${ssEscapeHtml(taxLabel)}</span>
                <strong class="${taxValue > 0 ? "" : "is-muted"}">
                  ${taxValue > 0 ? ssEscapeHtml(ssFormatCurrency(taxValue, currency)) : "No tax"}
                </strong>
              </div>

              <div class="bexhr-self-service-payroll-metric">
                <span>Employee Pension</span>
                <strong>${ssEscapeHtml(ssFormatCurrency(employeePension, currency))}</strong>
              </div>

              <div class="bexhr-self-service-payroll-metric">
                <span>Total Deductions</span>
                <strong>${ssEscapeHtml(ssFormatCurrency(record.total_deductions, currency))}</strong>
              </div>

              <div class="bexhr-self-service-payroll-metric is-net-pay">
                <span>Net Pay</span>
                <strong>${ssEscapeHtml(ssFormatCurrency(record.net_pay, currency))}</strong>
              </div>
            </section>

            <footer class="bexhr-self-service-payroll-footer">
              <div class="bexhr-self-service-payroll-note">
                <i class="bi bi-shield-check" aria-hidden="true"></i>
                Read-only authorised payroll record
              </div>

              <div class="bexhr-self-service-payroll-actions">
                ${shouldShowViewAction ? `
                  <button type="button"
                    class="btn btn-outline-secondary ss-view-payslip-btn bexhr-self-service-payroll-action"
                    data-payroll-id="${ssEscapeHtml(record.id)}"
                    title="View payslip details"
                    aria-label="View payslip details">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                    <span>View payslip</span>
                  </button>
                ` : ""}

                <button type="button"
                  class="btn btn-outline-primary ss-download-payslip-btn bexhr-self-service-payroll-action"
                  data-payroll-id="${ssEscapeHtml(record.id)}"
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

      // Preserve the existing read-only payslip preview action.
      row.querySelector(".ss-view-payslip-btn")?.addEventListener("click", (event) => {
        const button = event.currentTarget;
        openSsPayslipPreview(button.getAttribute("data-payroll-id"));
      });

      // Preserve the existing tenant-aware PDF generation and download action.
      row.querySelector(".ss-download-payslip-btn")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        await downloadSsPayslipPdf(record.id, button);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Payslip PDF
  // -----------------------------------------------------------------------

  // ALPATECH PDF BRANDING - STEP 4A
  // Tenant-safe detection for HR/Manager My Self-Service payslip downloads.
  // This only changes the generated PDF branding when the active company
  // workspace is Alpatech. Other tenants keep the existing BexHR PDF output.
  function isSsAlpatechWorkspace() {
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
      ssState.currentProfile?.tenant_code,
      ssState.currentProfile?.tenant_name,
      ssState.currentProfile?.company_name,
      ssState.currentProfile?.organization_name,
      ssState.employeeRecord?.tenant_code,
      ssState.employeeRecord?.tenant_name,
      ssState.employeeRecord?.company_name,
      ssState.employeeRecord?.organization_name,
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
  function getSsPayslipPdfBranding(record = {}) {
    const isAlpatech = isSsAlpatechWorkspace();
    const companyName = getSsPayslipCompanyName();

    return {
      isAlpatech,
      brandName: isAlpatech ? "ALPATECH" : companyName || "BexHR",
      companyName: companyName || (isAlpatech ? "ALPATECH" : "BexHR"),
      documentLabel: "Confidential Payroll Payslip",
      footerText: isAlpatech
        ? "Generated from an authorised Alpatech payroll record in BexHR."
        : "Generated from an authorised payroll record in BexHR.",
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
      payDate: ssFormatDate(record.pay_date),
      status: record.status || "Authorised",
    };
  }

  async function loadSsImageAsDataUrl(assetPath) {
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

  function drawSsPdfRoundedRect(doc, x, y, width, height, radius = 3, style = "S") {
    if (typeof doc.roundedRect === "function") {
      doc.roundedRect(x, y, width, height, radius, radius, style);
    } else {
      doc.rect(x, y, width, height, style);
    }
  }

  function drawSsPayslipPdfHeader(doc, branding = {}, alpatechLogoDataUrl = "") {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;
    const width = pageWidth - margin * 2;
    const primary = branding.primaryRgb || [15, 118, 110];

    doc.setFillColor(primary[0], primary[1], primary[2]);
    drawSsPdfRoundedRect(doc, margin, 10, width, 28, 4, "F");

    doc.setFillColor(255, 255, 255);
    drawSsPdfRoundedRect(doc, margin + 5, 15, 17, 18, 3, "F");

    if (branding.isAlpatech && alpatechLogoDataUrl) {
      try {
        doc.addImage(alpatechLogoDataUrl, "PNG", margin + 10, 17.5, 7, 13);
      } catch (error) {
        console.warn("[SS] Alpatech PDF logo could not be added.", error);
      }
    } else {
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(branding.isAlpatech ? "A" : "B", margin + 13.5, 26.8, { align: "center" });
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(String(branding.brandName || "BexHR"), margin + 27, 20.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(String(branding.documentLabel || "Confidential Payroll Payslip"), margin + 27, 27);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(String(branding.payCycle || "Payroll"), pageWidth - margin - 5, 19, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`Pay date: ${branding.payDate || "--"}`, pageWidth - margin - 5, 24.5, { align: "right" });
    doc.text(`Status: ${branding.status || "Authorised"}`, pageWidth - margin - 5, 29.5, { align: "right" });
  }

  function drawSsPayslipPdfInfoCard(doc, x, y, width, height, title, rows, branding, options = {}) {
    const border = branding.borderRgb;
    const soft = options.softRgb || branding.softRgb;

    doc.setFillColor(soft[0], soft[1], soft[2]);
    doc.setDrawColor(border[0], border[1], border[2]);
    drawSsPdfRoundedRect(doc, x, y, width, height, 3, "FD");

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

  function drawSsPayslipPdfSummaryCard(doc, x, y, width, label, value, branding, type = "default") {
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
    drawSsPdfRoundedRect(doc, x, y, width, 22, 3, "FD");

    doc.setTextColor(branding.mutedRgb[0], branding.mutedRgb[1], branding.mutedRgb[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.text(String(label || "").toUpperCase(), x + 5, y + 7);

    doc.setTextColor(branding.textRgb[0], branding.textRgb[1], branding.textRgb[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(String(value || "--"), x + 5, y + 16);
  }

  function drawSsPayslipPdfStructureCard(doc, x, y, width, items, allocationText, branding) {
    const visible = items.filter((item) => item && item.label);
    const rowCount = Math.ceil(visible.length / 2);
    const height = 16 + rowCount * 7 + (allocationText ? 10 : 0);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
    drawSsPdfRoundedRect(doc, x, y, width, height, 3, "FD");

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

  function drawSsPayslipPdfBreakdownCard(doc, x, y, width, title, rows, totalLabel, totalValue, branding, accentRgb) {
    const visibleRows = rows.length ? rows : [{ label: "No items recorded", value: "--", muted: true }];
    const rowHeight = 5.2;
    const height = 18 + visibleRows.length * rowHeight + 10;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(branding.borderRgb[0], branding.borderRgb[1], branding.borderRgb[2]);
    drawSsPdfRoundedRect(doc, x, y, width, height, 3, "FD");
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    drawSsPdfRoundedRect(doc, x, y, width, 3, 3, "F");

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

  function drawSsPayslipPdfPageFooter(doc, branding, employeeName) {
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

  async function downloadSsPayslipPdf(payrollId, buttonElement) {
    const originalButtonHtml = buttonElement?.innerHTML || "";

    try {
      clearSsAlert();

      const record = ssState.payrollRecords.find((row) => String(row.id) === String(payrollId));
      if (!record) {
        showSsAlert("danger", "Payroll record not found.");
        return;
      }

      if (!window.jspdf?.jsPDF) {
        showSsAlert("danger", "PDF library (jsPDF) is not available. Please refresh the page.");
        return;
      }

      if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Preparing PDF...`;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");
      const employee = getSsPayslipEmployeeContext();
      const currency = (record.currency || "NGN").toUpperCase();
      const money = (value) => ssFormatCurrency(value, currency);
      const branding = getSsPayslipPdfBranding(record);
      const logoDataUrl = branding.isAlpatech
        ? await loadSsImageAsDataUrl("assets/alpatech-flame.png")
        : "";

      drawSsPayslipPdfHeader(doc, branding, logoDataUrl);

      const margin = 12;
      const usableWidth = 186;
      const gap = 4;
      const halfWidth = (usableWidth - gap) / 2;

      drawSsPayslipPdfInfoCard(
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

      drawSsPayslipPdfInfoCard(
        doc,
        margin + halfWidth + gap,
        44,
        halfWidth,
        38,
        "Pay Details",
        [
          { label: "Pay Cycle", value: record.pay_cycle || "--", bold: true },
          { label: "Pay Date", value: ssFormatDate(record.pay_date) },
          { label: "Status", value: record.status || "Authorised" },
          { label: "Currency", value: currency },
        ],
        branding,
        { softRgb: [248, 250, 252] },
      );

      const summaryWidth = (usableWidth - gap * 2) / 3;
      drawSsPayslipPdfSummaryCard(doc, margin, 87, summaryWidth, "Gross Pay", money(record.gross_pay), branding, "default");
      drawSsPayslipPdfSummaryCard(doc, margin + summaryWidth + gap, 87, summaryWidth, "Total Deductions", money(record.total_deductions), branding, "warning");
      drawSsPayslipPdfSummaryCard(doc, margin + (summaryWidth + gap) * 2, 87, summaryWidth, "Net Pay", money(record.net_pay), branding, "success");

      const percent = (value) => {
        const numericValue = Number(value || 0);
        if (!Number.isFinite(numericValue) || numericValue === 0) return "0.0%";
        return `${(Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue).toFixed(1)}%`;
      };

      // EMPLOYEE-FACING PAYSLIP DATA MINIMISATION - STEP 3
      // Keep the PDF business-readable and exclude technical model/version,
      // structure-variant, layout, and allocation-configuration identifiers.
      const structureHeight = drawSsPayslipPdfStructureCard(
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

      drawSsPayslipPdfBreakdownCard(
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

      drawSsPayslipPdfBreakdownCard(
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
      drawSsPdfRoundedRect(doc, margin, netY, usableWidth, 18, 3, "F");
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
      drawSsPdfRoundedRect(doc, margin, noteY, usableWidth, 14, 3, "FD");
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

      drawSsPayslipPdfPageFooter(doc, branding, employee.employeeName);

      const safePayCycle = (record.pay_cycle || "Payslip").replace(/\s+/g, "-").replace(/[^\w-]/g, "");
      const safeName = employee.employeeName.replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "Staff";
      const prefix = branding.filePrefix ? `${branding.filePrefix}-` : "";

      doc.save(`${prefix}${safeName}-Payslip-${safePayCycle}.pdf`);
      showSsAlert("success", "Payslip PDF downloaded successfully.");
    } catch (error) {
      console.error("[SS] PDF generation error:", error);
      showSsAlert("danger", "Payslip PDF could not be generated.");
    } finally {
      if (buttonElement) {
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalButtonHtml || `<i class="bi bi-file-earmark-pdf"></i>`;
      }
    }
  }


  // -----------------------------------------------------------------------
  // Public init
  // -----------------------------------------------------------------------
  async function init(currentUser, currentProfile) {
    if (!currentUser) {
      console.warn("[SS] init() called without currentUser — aborting.");
      return;
    }

    ssState.currentUser = currentUser;
    ssState.currentProfile = currentProfile;

    cacheSsDomElements();

    if (!ssState.isInitialized) {
      // Wire up events only on first open
      bindSsNavigationEvents();
      bindSsLeaveBalancesCardEvents();
      bindSsLatestDecisionCardEvents();
      bindSsLeaveHistoryCardEvents();
      bindSsLeaveFormEvents();
      bindSsPayrollHistoryCardEvents();
      bindSsPayrollEvents();
      ssState.isInitialized = true;
    }

    // SYSTEM-WIDE SELF-SERVICE PAYROLL FIRST-PAINT FIX - STEP 1G
    // Self-Service defaults to Payroll for HR/Manager staff. Switch the visible
    // sub-section before any async data loading starts so the page does not
    // briefly show Leave Management before Payroll History appears.
    // This is UI timing only; it does not change leave, payroll, payslip,
    // authorisation, tenant filtering, or Alpatech branding logic.
    switchSsSubSection("payroll");

    // SYSTEM-WIDE SELF-SERVICE PAYROLL FIRST-PAINT FIX - STEP 1G
    // Keep Payroll History visibly open during loading. The final init block
    // below repeats this after data loads, so this only prevents first-paint flash.
    setSsCardExpanded(
      ssState.dom.ssTogglePayrollHistoryCardBtn,
      ssState.dom.ssPayrollHistoryCardCollapse,
      true,
    );

    // Load data
    clearSsAlert();

    await loadSsEmployeeRecord();
    await Promise.all([
      loadSsLeaveTypes(),
      loadSsLeaveBalances(),
      loadSsLeaveRequests(),
      loadSsPayroll(),
    ]);

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // HR users often enter My Self-Service from payslip email/payment context.
    // Show Payroll first so their own authorised payslip records are immediately visible.
    // Leave remains available through the Leave Management sub-tab.
    switchSsSubSection("payroll");

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // Keep leave cards closed by default. This avoids the Leave workspace
    // taking over the self-service page when HR is trying to check payroll.
    setSsCardExpanded(
      ssState.dom.ssToggleLeaveBalancesCardBtn,
      ssState.dom.ssLeaveBalancesCardCollapse,
      false,
    );
    setSsCardExpanded(
      ssState.dom.ssToggleLeaveHistoryCardBtn,
      ssState.dom.ssLeaveHistoryCardCollapse,
      false,
    );

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // Payroll History should be open when Payroll is the default sub-section.
    setSsCardExpanded(
      ssState.dom.ssTogglePayrollHistoryCardBtn,
      ssState.dom.ssPayrollHistoryCardCollapse,
      true,
    );
  }

  // -----------------------------------------------------------------------
  // Expose module
  // -----------------------------------------------------------------------
  window.EmployeeSelfService = {
    init,
  };
})();
