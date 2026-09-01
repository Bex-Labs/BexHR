"use strict";

/**
 * BexHR Performance Appraisal
 * Standalone module behaviour.
 *
 * No Supabase, authentication or existing BexHR dashboard state
 * is used during the standalone phase.
 */

(() => {
  const BEX_PA_CYCLE_STORAGE_KEY =
    "bexhr:performance-appraisal:standalone-cycles:v1";

  const bexPaState = {
    cycles: [],
    editingCycleId: null,
    activatingCycleId: null,
  };

  function bexPaLoadStoredCycles() {
    try {
      const storedCycles = window.localStorage.getItem(
        BEX_PA_CYCLE_STORAGE_KEY,
      );

      if (!storedCycles) {
        return [];
      }

      const parsedCycles = JSON.parse(storedCycles);

      return Array.isArray(parsedCycles) ? parsedCycles : [];
    } catch (error) {
      console.warn(
        "Stored appraisal cycles could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveCycles() {
    try {
      window.localStorage.setItem(
        BEX_PA_CYCLE_STORAGE_KEY,
        JSON.stringify(bexPaState.cycles),
      );
    } catch (error) {
      console.warn(
        "Appraisal cycles could not be saved locally.",
        error,
      );
    }
  }

  const bexPaElements = {
    overviewSection: document.getElementById("bexPaOverviewSection"),
    cyclesSection: document.getElementById("bexPaCyclesSection"),

    overviewNavLink: document.querySelector(
      '#bexPaPrimaryNavigation a[href="#bexPaOverviewSection"]',
    ),
    cyclesNavButton: document.getElementById("bexPaCyclesNavButton"),

    overviewCreateButton: document.getElementById(
      "bexPaOpenCycleFormButton",
    ),
    cyclesCreateButton: document.getElementById(
      "bexPaCyclesCreateButton",
    ),

    cycleFormCard: document.getElementById("bexPaCycleFormCard"),
    cycleForm: document.getElementById("bexPaCycleForm"),
    cycleFormTitle: document.getElementById(
      "bexPaCycleFormTitle",
    ),
    cycleSubmitButton: document.getElementById(
      "bexPaCycleSubmitButton",
    ),
    closeCycleFormButton: document.getElementById(
      "bexPaCloseCycleFormButton",
    ),
    cancelCycleButton: document.getElementById(
      "bexPaCancelCycleButton",
    ),
    cycleFormError: document.getElementById("bexPaCycleFormError"),

    cycleName: document.getElementById("bexPaCycleName"),
    cycleStartDate: document.getElementById("bexPaCycleStartDate"),
    cycleEndDate: document.getElementById("bexPaCycleEndDate"),
    goalDeadline: document.getElementById("bexPaGoalDeadline"),
    employeeReviewDeadline: document.getElementById(
      "bexPaEmployeeReviewDeadline",
    ),
    managerReviewDeadline: document.getElementById(
      "bexPaManagerReviewDeadline",
    ),
    hrReviewDeadline: document.getElementById("bexPaHrReviewDeadline"),

    cycleTableBody: document.getElementById("bexPaCycleTableBody"),
    activateCycleDialog: document.getElementById(
      "bexPaActivateCycleDialog",
    ),
    activateCycleName: document.getElementById(
      "bexPaActivateCycleName",
    ),
    confirmActivateCycleButton: document.getElementById(
      "bexPaConfirmActivateCycleButton",
    ),
    announcement: document.getElementById("bexPaAnnouncement"),

    activeCycleSummary: document.querySelector(
      '[data-bex-pa-summary="active-cycles"] .display-6',
    ),
  };

  function bexPaShowSection(sectionName) {
    const isCyclesSection = sectionName === "cycles";

    bexPaElements.overviewSection?.classList.toggle(
      "d-none",
      isCyclesSection,
    );

    bexPaElements.cyclesSection?.classList.toggle(
      "d-none",
      !isCyclesSection,
    );

    bexPaElements.overviewNavLink?.classList.toggle(
      "active",
      !isCyclesSection,
    );

    bexPaElements.cyclesNavButton?.classList.toggle(
      "active",
      isCyclesSection,
    );

    if (isCyclesSection) {
      bexPaElements.overviewNavLink?.removeAttribute("aria-current");
      bexPaElements.cyclesNavButton?.setAttribute(
        "aria-current",
        "page",
      );
    } else {
      bexPaElements.cyclesNavButton?.removeAttribute("aria-current");
      bexPaElements.overviewNavLink?.setAttribute(
        "aria-current",
        "page",
      );
    }
  }

  function bexPaShowCycleForm() {
    bexPaShowSection("cycles");

    bexPaElements.cycleFormCard?.classList.remove("d-none");

    window.requestAnimationFrame(() => {
      bexPaElements.cycleName?.focus();
    });
  }

  function bexPaHideCycleForm() {
    bexPaElements.cycleForm?.reset();
    bexPaClearCycleError();
    bexPaElements.cycleFormCard?.classList.add("d-none");
  }

  function bexPaShowCycleError(message) {
    if (!bexPaElements.cycleFormError) {
      return;
    }

    bexPaElements.cycleFormError.textContent = message;
    bexPaElements.cycleFormError.classList.remove("d-none");
  }

  function bexPaClearCycleError() {
    if (!bexPaElements.cycleFormError) {
      return;
    }

    bexPaElements.cycleFormError.textContent = "";
    bexPaElements.cycleFormError.classList.add("d-none");
  }

  function bexPaParseDate(dateValue) {
    if (!dateValue) {
      return null;
    }

    const parsedDate = new Date(`${dateValue}T00:00:00`);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  function bexPaValidateCycle(cycle) {
    const requiredValues = [
      cycle.name,
      cycle.startDate,
      cycle.endDate,
      cycle.goalDeadline,
      cycle.employeeReviewDeadline,
      cycle.managerReviewDeadline,
      cycle.hrReviewDeadline,
    ];

    if (requiredValues.some((value) => !value)) {
      return "Complete all appraisal cycle fields before creating the cycle.";
    }

    const startDate = bexPaParseDate(cycle.startDate);
    const endDate = bexPaParseDate(cycle.endDate);
    const goalDeadline = bexPaParseDate(cycle.goalDeadline);
    const employeeDeadline = bexPaParseDate(
      cycle.employeeReviewDeadline,
    );
    const managerDeadline = bexPaParseDate(
      cycle.managerReviewDeadline,
    );
    const hrDeadline = bexPaParseDate(cycle.hrReviewDeadline);

    if (
      !startDate ||
      !endDate ||
      !goalDeadline ||
      !employeeDeadline ||
      !managerDeadline ||
      !hrDeadline
    ) {
      return "Enter valid dates for the appraisal cycle.";
    }

    if (endDate < startDate) {
      return "The appraisal end date cannot be earlier than the start date.";
    }

    const deadlines = [
      goalDeadline,
      employeeDeadline,
      managerDeadline,
      hrDeadline,
    ];

    const deadlineOutsideCycle = deadlines.some(
      (deadline) => deadline < startDate || deadline > endDate,
    );

    if (deadlineOutsideCycle) {
      return "All appraisal deadlines must fall within the cycle start and end dates.";
    }

    if (employeeDeadline < goalDeadline) {
      return "The employee self-appraisal deadline cannot be earlier than the goal-setting deadline.";
    }

    if (managerDeadline < employeeDeadline) {
      return "The manager review deadline cannot be earlier than the employee self-appraisal deadline.";
    }

    if (hrDeadline < managerDeadline) {
      return "The HR review deadline cannot be earlier than the manager review deadline.";
    }

    const duplicateName = bexPaState.cycles.some(
      (existingCycle) =>
        existingCycle.name.toLowerCase() === cycle.name.toLowerCase(),
    );

    if (duplicateName) {
      return "An appraisal cycle with this name already exists.";
    }

    return "";
  }

  function bexPaFormatDate(dateValue) {
    const date = bexPaParseDate(dateValue);

    if (!date) {
      return "—";
    }

    return new Intl.DateTimeFormat("en-NG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function bexPaCreateTableCell(text, className = "") {
    const cell = document.createElement("td");

    cell.textContent = text;

    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function bexPaRenderCycles() {
    if (!bexPaElements.cycleTableBody) {
      return;
    }

    bexPaElements.cycleTableBody.replaceChildren();

    if (bexPaState.cycles.length === 0) {
      const emptyRow = document.createElement("tr");
      emptyRow.id = "bexPaCycleEmptyRow";

      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 7;
      emptyCell.className = "py-5 text-center text-body-secondary";
      emptyCell.textContent =
        "No appraisal cycles have been created yet.";

      emptyRow.appendChild(emptyCell);
      bexPaElements.cycleTableBody.appendChild(emptyRow);
    } else {
      bexPaState.cycles.forEach((cycle) => {
        const row = document.createElement("tr");

        row.appendChild(
          bexPaCreateTableCell(cycle.name, "bex-pa-cycle-name"),
        );

        row.appendChild(
          bexPaCreateTableCell(
            `${bexPaFormatDate(cycle.startDate)} – ${bexPaFormatDate(
              cycle.endDate,
            )}`,
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(cycle.goalDeadline),
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(cycle.employeeReviewDeadline),
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(cycle.managerReviewDeadline),
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(cycle.hrReviewDeadline),
          ),
        );

        const statusCell = document.createElement("td");
        const statusBadge = document.createElement("span");

        statusBadge.className = "bex-pa-cycle-status";
        statusBadge.textContent = cycle.status;

        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);

        bexPaElements.cycleTableBody.appendChild(row);
      });
    }

    if (bexPaElements.activeCycleSummary) {
      bexPaElements.activeCycleSummary.textContent = String(
        bexPaState.cycles.length,
      );
    }
  }

  function bexPaHandleCycleSubmit(event) {
    event.preventDefault();
    bexPaClearCycleError();

    const cycle = {
      id: `BEX-PA-CYCLE-${Date.now()}`,
      name: bexPaElements.cycleName.value.trim(),
      startDate: bexPaElements.cycleStartDate.value,
      endDate: bexPaElements.cycleEndDate.value,
      goalDeadline: bexPaElements.goalDeadline.value,
      employeeReviewDeadline:
        bexPaElements.employeeReviewDeadline.value,
      managerReviewDeadline:
        bexPaElements.managerReviewDeadline.value,
      hrReviewDeadline: bexPaElements.hrReviewDeadline.value,
      status: "Draft",
    };

    const validationError = bexPaValidateCycle(cycle);

    if (validationError) {
      bexPaShowCycleError(validationError);
      return;
    }

    bexPaState.cycles.push(cycle);
    bexPaSaveCycles();

    bexPaRenderCycles();
    bexPaHideCycleForm();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        `${cycle.name} was created successfully.`;
    }
  }

  function bexPaInitialiseAppraisalCycles() {
    bexPaState.cycles = bexPaLoadStoredCycles();

    bexPaElements.cyclesNavButton?.addEventListener(
      "click",
      () => bexPaShowSection("cycles"),
    );

    bexPaElements.overviewNavLink?.addEventListener(
      "click",
      () => bexPaShowSection("overview"),
    );

    bexPaElements.overviewCreateButton?.addEventListener(
      "click",
      bexPaShowCycleForm,
    );

    bexPaElements.cyclesCreateButton?.addEventListener(
      "click",
      bexPaShowCycleForm,
    );

    bexPaElements.closeCycleFormButton?.addEventListener(
      "click",
      bexPaHideCycleForm,
    );

    bexPaElements.cancelCycleButton?.addEventListener(
      "click",
      bexPaHideCycleForm,
    );

    bexPaElements.cycleForm?.addEventListener(
      "submit",
      bexPaHandleCycleSubmit,
    );

    bexPaRenderCycles();
  }

  document.addEventListener(
    "DOMContentLoaded",
    bexPaInitialiseAppraisalCycles,
  );
})();