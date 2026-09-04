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

  const BEX_PA_ORGANISATION_GOAL_STORAGE_KEY =
    "bexhr:performance-appraisal:organisation-goals:v1";

  const BEX_PA_DELIVERABLE_STORAGE_KEY =
    "bexhr:performance-appraisal:organisational-deliverables:v1";

  const BEX_PA_DEPARTMENT_GOAL_STORAGE_KEY =
    "bexhr:performance-appraisal:department-goals:v1";

  const BEX_PA_INDIVIDUAL_GOAL_STORAGE_KEY =
    "bexhr:performance-appraisal:individual-goals:v1";

  const bexPaState = {
    cycles: [],
    organisationGoals: [],
    deliverables: [],
    departmentGoals: [],
    individualGoals: [],
    editingCycleId: null,
    activatingCycleId: null,
    editingOrganisationGoalId: null,
    editingDeliverableId: null,
    editingDepartmentGoalId: null,
    editingIndividualGoalId: null,
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

  function bexPaLoadOrganisationGoals() {
    try {
      const storedGoals = window.localStorage.getItem(
        BEX_PA_ORGANISATION_GOAL_STORAGE_KEY,
      );

      if (!storedGoals) {
        return [];
      }

      const parsedGoals = JSON.parse(storedGoals);

      return Array.isArray(parsedGoals) ? parsedGoals : [];
    } catch (error) {
      console.warn(
        "Organisation goals could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveOrganisationGoals() {
    try {
      window.localStorage.setItem(
        BEX_PA_ORGANISATION_GOAL_STORAGE_KEY,
        JSON.stringify(bexPaState.organisationGoals),
      );
    } catch (error) {
      console.warn(
        "Organisation goals could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadDeliverables() {
    try {
      const storedDeliverables = window.localStorage.getItem(
        BEX_PA_DELIVERABLE_STORAGE_KEY,
      );

      if (!storedDeliverables) {
        return [];
      }

      const parsedDeliverables = JSON.parse(
        storedDeliverables,
      );

      return Array.isArray(parsedDeliverables)
        ? parsedDeliverables
        : [];
    } catch (error) {
      console.warn(
        "Organisational deliverables could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveDeliverables() {
    try {
      window.localStorage.setItem(
        BEX_PA_DELIVERABLE_STORAGE_KEY,
        JSON.stringify(bexPaState.deliverables),
      );
    } catch (error) {
      console.warn(
        "Organisational deliverables could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadDepartmentGoals() {
    try {
      const storedDepartmentGoals =
        window.localStorage.getItem(
          BEX_PA_DEPARTMENT_GOAL_STORAGE_KEY,
        );

      if (!storedDepartmentGoals) {
        return [];
      }

      const parsedDepartmentGoals = JSON.parse(
        storedDepartmentGoals,
      );

      return Array.isArray(parsedDepartmentGoals)
        ? parsedDepartmentGoals
        : [];
    } catch (error) {
      console.warn(
        "Department goals could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveDepartmentGoals() {
    try {
      window.localStorage.setItem(
        BEX_PA_DEPARTMENT_GOAL_STORAGE_KEY,
        JSON.stringify(bexPaState.departmentGoals),
      );
    } catch (error) {
      console.warn(
        "Department goals could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadIndividualGoals() {
    try {
      const storedIndividualGoals =
        window.localStorage.getItem(
          BEX_PA_INDIVIDUAL_GOAL_STORAGE_KEY,
        );

      if (!storedIndividualGoals) {
        return [];
      }

      const parsedIndividualGoals = JSON.parse(
        storedIndividualGoals,
      );

      return Array.isArray(parsedIndividualGoals)
        ? parsedIndividualGoals
        : [];
    } catch (error) {
      console.warn(
        "Individual employee goals could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveIndividualGoals() {
    try {
      window.localStorage.setItem(
        BEX_PA_INDIVIDUAL_GOAL_STORAGE_KEY,
        JSON.stringify(bexPaState.individualGoals),
      );
    } catch (error) {
      console.warn(
        "Individual employee goals could not be saved.",
        error,
      );
    }
  }

  const bexPaElements = {
    overviewSection: document.getElementById("bexPaOverviewSection"),
    cyclesSection: document.getElementById("bexPaCyclesSection"),
    goalsSection: document.getElementById("bexPaGoalsSection"),

    overviewNavLink: document.querySelector(
      '#bexPaPrimaryNavigation a[href="#bexPaOverviewSection"]',
    ),
    cyclesNavButton: document.getElementById("bexPaCyclesNavButton"),
    goalsNavButton: document.getElementById("bexPaGoalsNavButton"),
    createOrganisationGoalButton: document.getElementById(
      "bexPaCreateOrganisationGoalButton",
    ),
    organisationGoalsList: document.getElementById(
      "bexPaOrganisationGoalsList",
    ),
    organisationGoalDialog: document.getElementById(
      "bexPaOrganisationGoalDialog",
    ),
    organisationGoalForm: document.getElementById(
      "bexPaOrganisationGoalForm",
    ),
    organisationGoalDialogTitle: document.getElementById(
      "bexPaOrganisationGoalDialogTitle",
    ),
    organisationGoalFormError: document.getElementById(
      "bexPaOrganisationGoalFormError",
    ),
    closeOrganisationGoalDialogButton: document.getElementById(
      "bexPaCloseOrganisationGoalDialogButton",
    ),
    cancelOrganisationGoalButton: document.getElementById(
      "bexPaCancelOrganisationGoalButton",
    ),
    organisationGoalSubmitButton: document.getElementById(
      "bexPaOrganisationGoalSubmitButton",
    ),
    organisationGoalCycle: document.getElementById(
      "bexPaOrganisationGoalCycle",
    ),
    organisationGoalTitle: document.getElementById(
      "bexPaOrganisationGoalTitle",
    ),
    organisationGoalDescription: document.getElementById(
      "bexPaOrganisationGoalDescription",
    ),
    organisationGoalTarget: document.getElementById(
      "bexPaOrganisationGoalTarget",
    ),
    organisationGoalOwner: document.getElementById(
      "bexPaOrganisationGoalOwner",
    ),
    organisationGoalStatus: document.getElementById(
      "bexPaOrganisationGoalStatus",
    ),
    organisationGoalStartDate: document.getElementById(
      "bexPaOrganisationGoalStartDate",
    ),
    organisationGoalDueDate: document.getElementById(
      "bexPaOrganisationGoalDueDate",
    ),

    createDeliverableButton: document.getElementById(
      "bexPaCreateDeliverableButton",
    ),
    deliverablesList: document.getElementById(
      "bexPaDeliverablesList",
    ),
    deliverableDialog: document.getElementById(
      "bexPaDeliverableDialog",
    ),
    deliverableForm: document.getElementById(
      "bexPaDeliverableForm",
    ),
    deliverableDialogTitle: document.getElementById(
      "bexPaDeliverableDialogTitle",
    ),
    deliverableFormError: document.getElementById(
      "bexPaDeliverableFormError",
    ),
    closeDeliverableDialogButton: document.getElementById(
      "bexPaCloseDeliverableDialogButton",
    ),
    cancelDeliverableButton: document.getElementById(
      "bexPaCancelDeliverableButton",
    ),
    deliverableSubmitButton: document.getElementById(
      "bexPaDeliverableSubmitButton",
    ),
    deliverableOrganisationGoal: document.getElementById(
      "bexPaDeliverableOrganisationGoal",
    ),
    deliverableCycle: document.getElementById(
      "bexPaDeliverableCycle",
    ),
    deliverableTitle: document.getElementById(
      "bexPaDeliverableTitle",
    ),
    deliverableDescription: document.getElementById(
      "bexPaDeliverableDescription",
    ),
    deliverableTarget: document.getElementById(
      "bexPaDeliverableTarget",
    ),
    deliverableOwner: document.getElementById(
      "bexPaDeliverableOwner",
    ),
    deliverableStatus: document.getElementById(
      "bexPaDeliverableStatus",
    ),
    deliverableStartDate: document.getElementById(
      "bexPaDeliverableStartDate",
    ),
    deliverableDueDate: document.getElementById(
      "bexPaDeliverableDueDate",
    ),

    createDepartmentGoalButton: document.getElementById(
      "bexPaCreateDepartmentGoalButton",
    ),
    departmentGoalsList: document.getElementById(
      "bexPaDepartmentGoalsList",
    ),
    departmentGoalDialog: document.getElementById(
      "bexPaDepartmentGoalDialog",
    ),
    departmentGoalForm: document.getElementById(
      "bexPaDepartmentGoalForm",
    ),
    departmentGoalDialogTitle: document.getElementById(
      "bexPaDepartmentGoalDialogTitle",
    ),
    departmentGoalFormError: document.getElementById(
      "bexPaDepartmentGoalFormError",
    ),
    closeDepartmentGoalDialogButton: document.getElementById(
      "bexPaCloseDepartmentGoalDialogButton",
    ),
    cancelDepartmentGoalButton: document.getElementById(
      "bexPaCancelDepartmentGoalButton",
    ),
    departmentGoalSubmitButton: document.getElementById(
      "bexPaDepartmentGoalSubmitButton",
    ),
    departmentGoalOrganisationGoal: document.getElementById(
      "bexPaDepartmentGoalOrganisationGoal",
    ),
    departmentGoalCycle: document.getElementById(
      "bexPaDepartmentGoalCycle",
    ),
    departmentGoalDepartment: document.getElementById(
      "bexPaDepartmentGoalDepartment",
    ),
    departmentGoalTitle: document.getElementById(
      "bexPaDepartmentGoalTitle",
    ),
    departmentGoalDescription: document.getElementById(
      "bexPaDepartmentGoalDescription",
    ),
    departmentGoalTarget: document.getElementById(
      "bexPaDepartmentGoalTarget",
    ),
    departmentGoalOwner: document.getElementById(
      "bexPaDepartmentGoalOwner",
    ),
    departmentGoalStatus: document.getElementById(
      "bexPaDepartmentGoalStatus",
    ),
    departmentGoalStartDate: document.getElementById(
      "bexPaDepartmentGoalStartDate",
    ),
    departmentGoalDueDate: document.getElementById(
      "bexPaDepartmentGoalDueDate",
    ),

    createIndividualGoalButton: document.getElementById(
      "bexPaCreateIndividualGoalButton",
    ),
    individualGoalsList: document.getElementById(
      "bexPaIndividualGoalsList",
    ),
    individualGoalDialog: document.getElementById(
      "bexPaIndividualGoalDialog",
    ),
    individualGoalForm: document.getElementById(
      "bexPaIndividualGoalForm",
    ),
    individualGoalDialogTitle: document.getElementById(
      "bexPaIndividualGoalDialogTitle",
    ),
    individualGoalFormError: document.getElementById(
      "bexPaIndividualGoalFormError",
    ),
    closeIndividualGoalDialogButton: document.getElementById(
      "bexPaCloseIndividualGoalDialogButton",
    ),
    cancelIndividualGoalButton: document.getElementById(
      "bexPaCancelIndividualGoalButton",
    ),
    individualGoalSubmitButton: document.getElementById(
      "bexPaIndividualGoalSubmitButton",
    ),
    individualGoalEmployee: document.getElementById(
      "bexPaIndividualGoalEmployee",
    ),
    individualGoalDepartmentGoal: document.getElementById(
      "bexPaIndividualGoalDepartmentGoal",
    ),
    individualGoalDepartment: document.getElementById(
      "bexPaIndividualGoalDepartment",
    ),
    individualGoalCycle: document.getElementById(
      "bexPaIndividualGoalCycle",
    ),
    individualGoalTitle: document.getElementById(
      "bexPaIndividualGoalTitle",
    ),
    individualGoalDescription: document.getElementById(
      "bexPaIndividualGoalDescription",
    ),
    individualGoalTarget: document.getElementById(
      "bexPaIndividualGoalTarget",
    ),
    individualGoalStatus: document.getElementById(
      "bexPaIndividualGoalStatus",
    ),
    individualGoalStartDate: document.getElementById(
      "bexPaIndividualGoalStartDate",
    ),
    individualGoalDueDate: document.getElementById(
      "bexPaIndividualGoalDueDate",
    ),

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
    const sectionMap = {
      overview: bexPaElements.overviewSection,
      cycles: bexPaElements.cyclesSection,
      goals: bexPaElements.goalsSection,
    };

    const navMap = {
      overview: bexPaElements.overviewNavLink,
      cycles: bexPaElements.cyclesNavButton,
      goals: bexPaElements.goalsNavButton,
    };

    Object.entries(sectionMap).forEach(
      ([name, section]) => {
        section?.classList.toggle(
          "d-none",
          name !== sectionName,
        );
      },
    );

    Object.entries(navMap).forEach(
      ([name, navItem]) => {
        const isActive = name === sectionName;

        navItem?.classList.toggle(
          "active",
          isActive,
        );

        if (isActive) {
          navItem?.setAttribute(
            "aria-current",
            "page",
          );
        } else {
          navItem?.removeAttribute(
            "aria-current",
          );
        }
      },
    );
  }

  function bexPaPopulateCycleForm(cycle) {
    bexPaElements.cycleName.value = cycle.name;
    bexPaElements.cycleStartDate.value = cycle.startDate;
    bexPaElements.cycleEndDate.value = cycle.endDate;
    bexPaElements.goalDeadline.value = cycle.goalDeadline;
    bexPaElements.employeeReviewDeadline.value =
      cycle.employeeReviewDeadline;
    bexPaElements.managerReviewDeadline.value =
      cycle.managerReviewDeadline;
    bexPaElements.hrReviewDeadline.value =
      cycle.hrReviewDeadline;
  }

  function bexPaSetCycleFormReadOnly(isReadOnly) {
    const fields = bexPaElements.cycleForm?.querySelectorAll(
      "input, select, textarea",
    );

    fields?.forEach((field) => {
      field.disabled = isReadOnly;
    });
  }

  function bexPaShowCycleForm(cycleId = null, mode = "create") {
    bexPaShowSection("cycles");
    bexPaClearCycleError();

    const cycle = cycleId
      ? bexPaState.cycles.find(
        (existingCycle) => existingCycle.id === cycleId,
      )
      : null;

    if (cycleId && !cycle) {
      return;
    }

    bexPaElements.cycleForm?.reset();
    bexPaState.editingCycleId = null;

    if (mode === "create") {
      bexPaElements.cycleFormTitle.textContent =
        "New Appraisal Cycle";
      bexPaElements.cycleSubmitButton.textContent =
        "Create Cycle";
      bexPaElements.cycleSubmitButton.classList.remove("d-none");
      bexPaSetCycleFormReadOnly(false);
    }

    if (mode === "edit" && cycle) {
      if (cycle.status !== "Draft") {
        return;
      }

      bexPaState.editingCycleId = cycle.id;

      bexPaElements.cycleFormTitle.textContent =
        "Edit Appraisal Cycle";
      bexPaElements.cycleSubmitButton.textContent =
        "Save Changes";
      bexPaElements.cycleSubmitButton.classList.remove("d-none");

      bexPaSetCycleFormReadOnly(false);
      bexPaPopulateCycleForm(cycle);
    }

    if (mode === "view" && cycle) {
      bexPaElements.cycleFormTitle.textContent =
        "Appraisal Cycle Details";
      bexPaElements.cycleSubmitButton.classList.add("d-none");

      bexPaPopulateCycleForm(cycle);
      bexPaSetCycleFormReadOnly(true);
    }

    bexPaElements.cycleFormCard?.classList.remove("d-none");

    window.requestAnimationFrame(() => {
      bexPaElements.cycleFormCard?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      if (mode !== "view") {
        bexPaElements.cycleName?.focus();
      }
    });
  }

  function bexPaHideCycleForm() {
    bexPaState.editingCycleId = null;

    bexPaElements.cycleForm?.reset();
    bexPaClearCycleError();

    bexPaSetCycleFormReadOnly(false);

    if (bexPaElements.cycleSubmitButton) {
      bexPaElements.cycleSubmitButton.textContent =
        "Create Cycle";
      bexPaElements.cycleSubmitButton.classList.remove("d-none");
    }

    if (bexPaElements.cycleFormTitle) {
      bexPaElements.cycleFormTitle.textContent =
        "New Appraisal Cycle";
    }

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
        existingCycle.id !== bexPaState.editingCycleId &&
        existingCycle.name.toLowerCase() ===
        cycle.name.toLowerCase(),
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

  function bexPaCreateCycleActionButton({
    label,
    icon,
    action,
    cycleId,
    variant = "outline-secondary",
  }) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `btn btn-sm btn-${variant} bex-pa-cycle-action-button`;

    button.dataset.bexPaCycleAction = action;
    button.dataset.bexPaCycleId = cycleId;
    button.title = label;
    button.setAttribute("aria-label", label);

    const iconElement = document.createElement("i");
    iconElement.className = `bi ${icon}`;
    iconElement.setAttribute("aria-hidden", "true");

    button.appendChild(iconElement);

    return button;
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
      emptyCell.colSpan = 8;
      emptyCell.className =
        "py-5 text-center text-body-secondary";
      emptyCell.textContent =
        "No appraisal cycles have been created yet.";

      emptyRow.appendChild(emptyCell);
      bexPaElements.cycleTableBody.appendChild(emptyRow);
    } else {
      bexPaState.cycles.forEach((cycle) => {
        const row = document.createElement("tr");

        row.appendChild(
          bexPaCreateTableCell(
            cycle.name,
            "bex-pa-cycle-name",
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            `${bexPaFormatDate(
              cycle.startDate,
            )} – ${bexPaFormatDate(cycle.endDate)}`,
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(cycle.goalDeadline),
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(
              cycle.employeeReviewDeadline,
            ),
          ),
        );

        row.appendChild(
          bexPaCreateTableCell(
            bexPaFormatDate(
              cycle.managerReviewDeadline,
            ),
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
        statusBadge.dataset.status =
          cycle.status.toLowerCase();
        statusBadge.textContent = cycle.status;

        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);

        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");

        actions.className = "bex-pa-cycle-actions";

        actions.appendChild(
          bexPaCreateCycleActionButton({
            label: `View ${cycle.name}`,
            icon: "bi-eye",
            action: "view",
            cycleId: cycle.id,
          }),
        );

        if (cycle.status === "Draft") {
          actions.appendChild(
            bexPaCreateCycleActionButton({
              label: `Edit ${cycle.name}`,
              icon: "bi-pencil",
              action: "edit",
              cycleId: cycle.id,
            }),
          );

          actions.appendChild(
            bexPaCreateCycleActionButton({
              label: `Activate ${cycle.name}`,
              icon: "bi-play-fill",
              action: "activate",
              cycleId: cycle.id,
              variant: "outline-primary",
            }),
          );
        }

        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);

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
      id:
        bexPaState.editingCycleId ||
        `BEX-PA-CYCLE-${Date.now()}`,
      name: bexPaElements.cycleName.value.trim(),
      startDate: bexPaElements.cycleStartDate.value,
      endDate: bexPaElements.cycleEndDate.value,
      goalDeadline: bexPaElements.goalDeadline.value,
      employeeReviewDeadline:
        bexPaElements.employeeReviewDeadline.value,
      managerReviewDeadline:
        bexPaElements.managerReviewDeadline.value,
      hrReviewDeadline:
        bexPaElements.hrReviewDeadline.value,
      status: "Draft",
    };

    const validationError = bexPaValidateCycle(cycle);

    if (validationError) {
      bexPaShowCycleError(validationError);
      return;
    }

    if (bexPaState.editingCycleId) {
      const existingIndex = bexPaState.cycles.findIndex(
        (existingCycle) =>
          existingCycle.id === bexPaState.editingCycleId,
      );

      if (existingIndex === -1) {
        bexPaShowCycleError(
          "The appraisal cycle could not be found.",
        );
        return;
      }

      const existingCycle =
        bexPaState.cycles[existingIndex];

      if (existingCycle.status !== "Draft") {
        bexPaShowCycleError(
          "Only draft appraisal cycles can be edited.",
        );
        return;
      }

      bexPaState.cycles[existingIndex] = {
        ...existingCycle,
        ...cycle,
        status: existingCycle.status,
      };
    } else {
      bexPaState.cycles.push(cycle);
    }

    const wasEditing = Boolean(bexPaState.editingCycleId);

    bexPaSaveCycles();
    bexPaRenderCycles();
    bexPaHideCycleForm();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${cycle.name} was updated successfully.`
          : `${cycle.name} was created successfully.`;
    }
  }

  function bexPaOpenActivationDialog(cycleId) {
    const cycle = bexPaState.cycles.find(
      (existingCycle) => existingCycle.id === cycleId,
    );

    if (!cycle || cycle.status !== "Draft") {
      return;
    }

    bexPaState.activatingCycleId = cycle.id;

    if (bexPaElements.activateCycleName) {
      bexPaElements.activateCycleName.textContent =
        cycle.name;
    }

    bexPaElements.activateCycleDialog?.showModal();
  }

  function bexPaActivateCycle() {
    if (!bexPaState.activatingCycleId) {
      return;
    }

    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id ===
        bexPaState.activatingCycleId,
    );

    if (!cycle || cycle.status !== "Draft") {
      bexPaState.activatingCycleId = null;
      bexPaElements.activateCycleDialog?.close();
      return;
    }

    cycle.status = "Active";

    bexPaSaveCycles();
    bexPaRenderCycles();

    bexPaElements.activateCycleDialog?.close();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        `${cycle.name} is now active.`;
    }
  }

  function bexPaHandleCycleTableAction(event) {
    const actionButton = event.target.closest(
      "[data-bex-pa-cycle-action]",
    );

    if (!actionButton) {
      return;
    }

    const cycleId = actionButton.dataset.bexPaCycleId;
    const action =
      actionButton.dataset.bexPaCycleAction;

    if (!cycleId || !action) {
      return;
    }

    if (action === "view") {
      bexPaShowCycleForm(cycleId, "view");
      return;
    }

    if (action === "edit") {
      bexPaShowCycleForm(cycleId, "edit");
      return;
    }

    if (action === "activate") {
      bexPaOpenActivationDialog(cycleId);
    }
  }

  function bexPaPopulateOrganisationGoalCycles() {
    if (!bexPaElements.organisationGoalCycle) {
      return;
    }

    const currentValue =
      bexPaElements.organisationGoalCycle.value;

    bexPaElements.organisationGoalCycle.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select appraisal cycle";

    bexPaElements.organisationGoalCycle.appendChild(
      placeholder,
    );

    bexPaState.cycles.forEach((cycle) => {
      const option = document.createElement("option");

      option.value = cycle.id;
      option.textContent = `${cycle.name} (${cycle.status})`;

      bexPaElements.organisationGoalCycle.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      bexPaState.cycles.some(
        (cycle) => cycle.id === currentValue,
      )
    ) {
      bexPaElements.organisationGoalCycle.value =
        currentValue;
    }
  }

  function bexPaClearOrganisationGoalError() {
    if (!bexPaElements.organisationGoalFormError) {
      return;
    }

    bexPaElements.organisationGoalFormError.textContent = "";
    bexPaElements.organisationGoalFormError.classList.add(
      "d-none",
    );
  }

  function bexPaShowOrganisationGoalError(message) {
    if (!bexPaElements.organisationGoalFormError) {
      return;
    }

    bexPaElements.organisationGoalFormError.textContent =
      message;

    bexPaElements.organisationGoalFormError.classList.remove(
      "d-none",
    );
  }

  function bexPaResetOrganisationGoalForm() {
    bexPaState.editingOrganisationGoalId = null;

    bexPaElements.organisationGoalForm?.reset();
    bexPaClearOrganisationGoalError();

    if (bexPaElements.organisationGoalDialogTitle) {
      bexPaElements.organisationGoalDialogTitle.textContent =
        "Add Organisation Goal";
    }

    if (bexPaElements.organisationGoalSubmitButton) {
      bexPaElements.organisationGoalSubmitButton.textContent =
        "Save Goal";
    }
  }

  function bexPaOpenOrganisationGoalDialog(goalId = null) {
    bexPaResetOrganisationGoalForm();
    bexPaPopulateOrganisationGoalCycles();

    if (goalId) {
      const goal = bexPaState.organisationGoals.find(
        (existingGoal) => existingGoal.id === goalId,
      );

      if (!goal) {
        return;
      }

      bexPaState.editingOrganisationGoalId = goal.id;

      bexPaElements.organisationGoalDialogTitle.textContent =
        "Edit Organisation Goal";

      bexPaElements.organisationGoalSubmitButton.textContent =
        "Save Changes";

      bexPaElements.organisationGoalCycle.value =
        goal.cycleId;

      bexPaElements.organisationGoalTitle.value =
        goal.title;

      bexPaElements.organisationGoalDescription.value =
        goal.description;

      bexPaElements.organisationGoalTarget.value =
        goal.target;

      bexPaElements.organisationGoalOwner.value =
        goal.owner;

      bexPaElements.organisationGoalStatus.value =
        goal.status;

      bexPaElements.organisationGoalStartDate.value =
        goal.startDate;

      bexPaElements.organisationGoalDueDate.value =
        goal.dueDate;
    }

    bexPaElements.organisationGoalDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.organisationGoalTitle?.focus();
    });
  }

  function bexPaCloseOrganisationGoalDialog() {
    bexPaElements.organisationGoalDialog?.close();
    bexPaResetOrganisationGoalForm();
  }

  function bexPaValidateOrganisationGoal(goal) {
    const requiredValues = [
      goal.cycleId,
      goal.title,
      goal.description,
      goal.target,
      goal.owner,
      goal.status,
      goal.startDate,
      goal.dueDate,
    ];

    if (requiredValues.some((value) => !value)) {
      return "Complete all organisation goal fields before saving.";
    }

    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id === goal.cycleId,
    );

    if (!cycle) {
      return "Select a valid appraisal cycle.";
    }

    const goalStartDate = bexPaParseDate(
      goal.startDate,
    );

    const goalDueDate = bexPaParseDate(
      goal.dueDate,
    );

    const cycleStartDate = bexPaParseDate(
      cycle.startDate,
    );

    const cycleEndDate = bexPaParseDate(
      cycle.endDate,
    );

    if (
      !goalStartDate ||
      !goalDueDate ||
      !cycleStartDate ||
      !cycleEndDate
    ) {
      return "Enter valid goal dates.";
    }

    if (goalDueDate < goalStartDate) {
      return "The organisation goal due date cannot be earlier than its start date.";
    }

    if (
      goalStartDate < cycleStartDate ||
      goalDueDate > cycleEndDate
    ) {
      return "The organisation goal dates must fall within the selected appraisal cycle.";
    }

    const duplicateGoal = bexPaState.organisationGoals.some(
      (existingGoal) =>
        existingGoal.id !==
        bexPaState.editingOrganisationGoalId &&
        existingGoal.cycleId === goal.cycleId &&
        existingGoal.title.toLowerCase() ===
        goal.title.toLowerCase(),
    );

    if (duplicateGoal) {
      return "An organisation goal with this title already exists in the selected cycle.";
    }

    return "";
  }

  function bexPaPopulateDeliverableOrganisationGoals() {
    if (!bexPaElements.deliverableOrganisationGoal) {
      return;
    }

    const currentValue =
      bexPaElements.deliverableOrganisationGoal.value;

    bexPaElements.deliverableOrganisationGoal.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select organisation goal';

    bexPaElements.deliverableOrganisationGoal.appendChild(
      placeholder,
    );

    bexPaState.organisationGoals.forEach((goal) => {
      const cycle = bexPaState.cycles.find(
        (existingCycle) => existingCycle.id === goal.cycleId,
      );

      const option = document.createElement('option');

      option.value = goal.id;
      option.textContent = cycle
        ? goal.title + ' (' + cycle.name + ')'
        : goal.title;

      bexPaElements.deliverableOrganisationGoal.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      bexPaState.organisationGoals.some(
        (goal) => goal.id === currentValue,
      )
    ) {
      bexPaElements.deliverableOrganisationGoal.value =
        currentValue;
    }
  }

  function bexPaUpdateDeliverableCycleDisplay() {
    if (!bexPaElements.deliverableCycle) {
      return;
    }

    const goal = bexPaState.organisationGoals.find(
      (existingGoal) =>
        existingGoal.id ===
        bexPaElements.deliverableOrganisationGoal?.value,
    );

    const cycle = goal
      ? bexPaState.cycles.find(
        (existingCycle) => existingCycle.id === goal.cycleId,
      )
      : null;

    bexPaElements.deliverableCycle.value = cycle
      ? cycle.name
      : '';

    bexPaElements.deliverableCycle.dataset.bexPaCycleId =
      goal?.cycleId || '';
  }

  function bexPaClearDeliverableError() {
    if (!bexPaElements.deliverableFormError) {
      return;
    }

    bexPaElements.deliverableFormError.textContent = '';
    bexPaElements.deliverableFormError.classList.add(
      'd-none',
    );
  }

  function bexPaShowDeliverableError(message) {
    if (!bexPaElements.deliverableFormError) {
      return;
    }

    bexPaElements.deliverableFormError.textContent =
      message;

    bexPaElements.deliverableFormError.classList.remove(
      'd-none',
    );
  }

  function bexPaResetDeliverableForm() {
    bexPaState.editingDeliverableId = null;

    bexPaElements.deliverableForm?.reset();
    bexPaClearDeliverableError();
    bexPaUpdateDeliverableCycleDisplay();

    if (bexPaElements.deliverableDialogTitle) {
      bexPaElements.deliverableDialogTitle.textContent =
        'Add Organisational Deliverable';
    }

    if (bexPaElements.deliverableSubmitButton) {
      bexPaElements.deliverableSubmitButton.textContent =
        'Save Deliverable';
    }
  }

  function bexPaOpenDeliverableDialog(deliverableId = null) {
    bexPaResetDeliverableForm();
    bexPaPopulateDeliverableOrganisationGoals();
    bexPaUpdateDeliverableCycleDisplay();

    if (deliverableId) {
      const deliverable = bexPaState.deliverables.find(
        (existingDeliverable) =>
          existingDeliverable.id === deliverableId,
      );

      if (!deliverable) {
        return;
      }

      bexPaState.editingDeliverableId = deliverable.id;

      bexPaElements.deliverableDialogTitle.textContent =
        'Edit Organisational Deliverable';

      bexPaElements.deliverableSubmitButton.textContent =
        'Save Changes';

      bexPaElements.deliverableOrganisationGoal.value =
        deliverable.organisationGoalId;

      bexPaUpdateDeliverableCycleDisplay();

      bexPaElements.deliverableTitle.value =
        deliverable.title;

      bexPaElements.deliverableDescription.value =
        deliverable.description;

      bexPaElements.deliverableTarget.value =
        deliverable.target;

      bexPaElements.deliverableOwner.value =
        deliverable.owner;

      bexPaElements.deliverableStatus.value =
        deliverable.status;

      bexPaElements.deliverableStartDate.value =
        deliverable.startDate;

      bexPaElements.deliverableDueDate.value =
        deliverable.dueDate;
    }

    bexPaElements.deliverableDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.deliverableOrganisationGoal?.focus();
    });
  }

  function bexPaCloseDeliverableDialog() {
    bexPaElements.deliverableDialog?.close();
    bexPaResetDeliverableForm();
  }

  function bexPaValidateDeliverable(deliverable) {
    const requiredValues = [
      deliverable.organisationGoalId,
      deliverable.title,
      deliverable.description,
      deliverable.target,
      deliverable.owner,
      deliverable.status,
      deliverable.startDate,
      deliverable.dueDate,
    ];

    if (requiredValues.some((value) => !value)) {
      return 'Complete all organisational deliverable fields before saving.';
    }

    const organisationGoal =
      bexPaState.organisationGoals.find(
        (goal) => goal.id === deliverable.organisationGoalId,
      );

    if (!organisationGoal) {
      return 'Select a valid organisation goal.';
    }

    const deliverableStartDate = bexPaParseDate(
      deliverable.startDate,
    );

    const deliverableDueDate = bexPaParseDate(
      deliverable.dueDate,
    );

    const goalStartDate = bexPaParseDate(
      organisationGoal.startDate,
    );

    const goalDueDate = bexPaParseDate(
      organisationGoal.dueDate,
    );

    if (
      !deliverableStartDate ||
      !deliverableDueDate ||
      !goalStartDate ||
      !goalDueDate
    ) {
      return 'Enter valid deliverable dates.';
    }

    if (deliverableDueDate < deliverableStartDate) {
      return 'The deliverable due date cannot be earlier than its start date.';
    }

    if (
      deliverableStartDate < goalStartDate ||
      deliverableDueDate > goalDueDate
    ) {
      return 'Deliverable dates must fall within the parent organisation goal dates.';
    }

    const duplicateDeliverable =
      bexPaState.deliverables.some(
        (existingDeliverable) =>
          existingDeliverable.id !==
          bexPaState.editingDeliverableId &&
          existingDeliverable.organisationGoalId ===
          deliverable.organisationGoalId &&
          existingDeliverable.title.toLowerCase() ===
          deliverable.title.toLowerCase(),
      );

    if (duplicateDeliverable) {
      return 'A deliverable with this title already exists under the selected organisation goal.';
    }

    return '';
  }

  function bexPaPopulateDepartmentGoalOrganisationGoals() {
    if (!bexPaElements.departmentGoalOrganisationGoal) {
      return;
    }

    const currentValue =
      bexPaElements.departmentGoalOrganisationGoal.value;

    bexPaElements.departmentGoalOrganisationGoal.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select organisation goal";

    bexPaElements.departmentGoalOrganisationGoal.appendChild(
      placeholder,
    );

    bexPaState.organisationGoals.forEach((goal) => {
      const cycle = bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === goal.cycleId,
      );

      const option = document.createElement("option");

      option.value = goal.id;
      option.textContent = cycle
        ? `${goal.title} (${cycle.name})`
        : goal.title;

      bexPaElements.departmentGoalOrganisationGoal.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      bexPaState.organisationGoals.some(
        (goal) => goal.id === currentValue,
      )
    ) {
      bexPaElements.departmentGoalOrganisationGoal.value =
        currentValue;
    }
  }

  function bexPaUpdateDepartmentGoalCycleDisplay() {
    if (!bexPaElements.departmentGoalCycle) {
      return;
    }

    const goal = bexPaState.organisationGoals.find(
      (existingGoal) =>
        existingGoal.id ===
        bexPaElements.departmentGoalOrganisationGoal?.value,
    );

    const cycle = goal
      ? bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === goal.cycleId,
      )
      : null;

    bexPaElements.departmentGoalCycle.value =
      cycle?.name || "";

    bexPaElements.departmentGoalCycle.dataset.bexPaCycleId =
      goal?.cycleId || "";
  }

  function bexPaClearDepartmentGoalError() {
    if (!bexPaElements.departmentGoalFormError) {
      return;
    }

    bexPaElements.departmentGoalFormError.textContent = "";
    bexPaElements.departmentGoalFormError.classList.add(
      "d-none",
    );
  }

  function bexPaShowDepartmentGoalError(message) {
    if (!bexPaElements.departmentGoalFormError) {
      return;
    }

    bexPaElements.departmentGoalFormError.textContent =
      message;

    bexPaElements.departmentGoalFormError.classList.remove(
      "d-none",
    );
  }

  function bexPaResetDepartmentGoalForm() {
    bexPaState.editingDepartmentGoalId = null;

    bexPaElements.departmentGoalForm?.reset();
    bexPaClearDepartmentGoalError();
    bexPaUpdateDepartmentGoalCycleDisplay();

    if (bexPaElements.departmentGoalDialogTitle) {
      bexPaElements.departmentGoalDialogTitle.textContent =
        "Add Department Goal";
    }

    if (bexPaElements.departmentGoalSubmitButton) {
      bexPaElements.departmentGoalSubmitButton.textContent =
        "Save Department Goal";
    }
  }

  function bexPaOpenDepartmentGoalDialog(
    departmentGoalId = null,
  ) {
    bexPaResetDepartmentGoalForm();
    bexPaPopulateDepartmentGoalOrganisationGoals();
    bexPaUpdateDepartmentGoalCycleDisplay();

    if (departmentGoalId) {
      const departmentGoal =
        bexPaState.departmentGoals.find(
          (existingDepartmentGoal) =>
            existingDepartmentGoal.id ===
            departmentGoalId,
        );

      if (!departmentGoal) {
        return;
      }

      bexPaState.editingDepartmentGoalId =
        departmentGoal.id;

      bexPaElements.departmentGoalDialogTitle.textContent =
        "Edit Department Goal";

      bexPaElements.departmentGoalSubmitButton.textContent =
        "Save Changes";

      bexPaElements.departmentGoalOrganisationGoal.value =
        departmentGoal.organisationGoalId;

      bexPaUpdateDepartmentGoalCycleDisplay();

      bexPaElements.departmentGoalDepartment.value =
        departmentGoal.department;

      bexPaElements.departmentGoalTitle.value =
        departmentGoal.title;

      bexPaElements.departmentGoalDescription.value =
        departmentGoal.description;

      bexPaElements.departmentGoalTarget.value =
        departmentGoal.target;

      bexPaElements.departmentGoalOwner.value =
        departmentGoal.owner;

      bexPaElements.departmentGoalStatus.value =
        departmentGoal.status;

      bexPaElements.departmentGoalStartDate.value =
        departmentGoal.startDate;

      bexPaElements.departmentGoalDueDate.value =
        departmentGoal.dueDate;
    }

    bexPaElements.departmentGoalDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.departmentGoalOrganisationGoal?.focus();
    });
  }

  function bexPaCloseDepartmentGoalDialog() {
    bexPaElements.departmentGoalDialog?.close();
    bexPaResetDepartmentGoalForm();
  }

  function bexPaValidateDepartmentGoal(
    departmentGoal,
  ) {
    const requiredValues = [
      departmentGoal.organisationGoalId,
      departmentGoal.department,
      departmentGoal.title,
      departmentGoal.description,
      departmentGoal.target,
      departmentGoal.owner,
      departmentGoal.status,
      departmentGoal.startDate,
      departmentGoal.dueDate,
    ];

    if (requiredValues.some((value) => !value)) {
      return "Complete all department goal fields before saving.";
    }

    const organisationGoal =
      bexPaState.organisationGoals.find(
        (goal) =>
          goal.id ===
          departmentGoal.organisationGoalId,
      );

    if (!organisationGoal) {
      return "Select a valid organisation goal.";
    }

    const departmentGoalStartDate = bexPaParseDate(
      departmentGoal.startDate,
    );

    const departmentGoalDueDate = bexPaParseDate(
      departmentGoal.dueDate,
    );

    const organisationGoalStartDate = bexPaParseDate(
      organisationGoal.startDate,
    );

    const organisationGoalDueDate = bexPaParseDate(
      organisationGoal.dueDate,
    );

    if (
      !departmentGoalStartDate ||
      !departmentGoalDueDate ||
      !organisationGoalStartDate ||
      !organisationGoalDueDate
    ) {
      return "Enter valid department goal dates.";
    }

    if (
      departmentGoalDueDate <
      departmentGoalStartDate
    ) {
      return "The department goal due date cannot be earlier than its start date.";
    }

    if (
      departmentGoalStartDate <
      organisationGoalStartDate ||
      departmentGoalDueDate >
      organisationGoalDueDate
    ) {
      return "Department goal dates must fall within the parent organisation goal dates.";
    }

    const duplicateDepartmentGoal =
      bexPaState.departmentGoals.some(
        (existingDepartmentGoal) =>
          existingDepartmentGoal.id !==
          bexPaState.editingDepartmentGoalId &&
          existingDepartmentGoal.organisationGoalId ===
          departmentGoal.organisationGoalId &&
          existingDepartmentGoal.department
            .toLowerCase() ===
          departmentGoal.department.toLowerCase() &&
          existingDepartmentGoal.title.toLowerCase() ===
          departmentGoal.title.toLowerCase(),
      );

    if (duplicateDepartmentGoal) {
      return "A department goal with this title already exists for the selected department under this organisation goal.";
    }

    return "";
  }

  function bexPaPopulateIndividualGoalDepartmentGoals() {
    if (!bexPaElements.individualGoalDepartmentGoal) {
      return;
    }

    const currentValue =
      bexPaElements.individualGoalDepartmentGoal.value;

    bexPaElements.individualGoalDepartmentGoal.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select department goal";

    bexPaElements.individualGoalDepartmentGoal.appendChild(
      placeholder,
    );

    bexPaState.departmentGoals.forEach((departmentGoal) => {
      const option = document.createElement("option");

      option.value = departmentGoal.id;
      option.textContent =
        `${departmentGoal.title} (${departmentGoal.department})`;

      bexPaElements.individualGoalDepartmentGoal.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      bexPaState.departmentGoals.some(
        (departmentGoal) =>
          departmentGoal.id === currentValue,
      )
    ) {
      bexPaElements.individualGoalDepartmentGoal.value =
        currentValue;
    }
  }

  function bexPaUpdateIndividualGoalDerivedFields() {
    const departmentGoal =
      bexPaState.departmentGoals.find(
        (existingDepartmentGoal) =>
          existingDepartmentGoal.id ===
          bexPaElements.individualGoalDepartmentGoal?.value,
      );

    const cycle = departmentGoal
      ? bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id ===
          departmentGoal.cycleId,
      )
      : null;

    if (bexPaElements.individualGoalDepartment) {
      bexPaElements.individualGoalDepartment.value =
        departmentGoal?.department || "";
    }

    if (bexPaElements.individualGoalCycle) {
      bexPaElements.individualGoalCycle.value =
        cycle?.name || "";

      bexPaElements.individualGoalCycle.dataset.bexPaCycleId =
        departmentGoal?.cycleId || "";
    }
  }

  function bexPaClearIndividualGoalError() {
    if (!bexPaElements.individualGoalFormError) {
      return;
    }

    bexPaElements.individualGoalFormError.textContent = "";
    bexPaElements.individualGoalFormError.classList.add(
      "d-none",
    );
  }

  function bexPaShowIndividualGoalError(message) {
    if (!bexPaElements.individualGoalFormError) {
      return;
    }

    bexPaElements.individualGoalFormError.textContent =
      message;

    bexPaElements.individualGoalFormError.classList.remove(
      "d-none",
    );
  }

  function bexPaResetIndividualGoalForm() {
    bexPaState.editingIndividualGoalId = null;

    bexPaElements.individualGoalForm?.reset();
    bexPaClearIndividualGoalError();
    bexPaUpdateIndividualGoalDerivedFields();

    if (bexPaElements.individualGoalDialogTitle) {
      bexPaElements.individualGoalDialogTitle.textContent =
        "Add Individual Goal";
    }

    if (bexPaElements.individualGoalSubmitButton) {
      bexPaElements.individualGoalSubmitButton.textContent =
        "Save Individual Goal";
    }
  }

  function bexPaOpenIndividualGoalDialog(
    individualGoalId = null,
  ) {
    bexPaResetIndividualGoalForm();
    bexPaPopulateIndividualGoalDepartmentGoals();
    bexPaUpdateIndividualGoalDerivedFields();

    if (individualGoalId) {
      const individualGoal =
        bexPaState.individualGoals.find(
          (existingIndividualGoal) =>
            existingIndividualGoal.id ===
            individualGoalId,
        );

      if (!individualGoal) {
        return;
      }

      bexPaState.editingIndividualGoalId =
        individualGoal.id;

      bexPaElements.individualGoalDialogTitle.textContent =
        "Edit Individual Goal";

      bexPaElements.individualGoalSubmitButton.textContent =
        "Save Changes";

      bexPaElements.individualGoalEmployee.value =
        individualGoal.employee;

      bexPaElements.individualGoalDepartmentGoal.value =
        individualGoal.departmentGoalId;

      bexPaUpdateIndividualGoalDerivedFields();

      bexPaElements.individualGoalTitle.value =
        individualGoal.title;

      bexPaElements.individualGoalDescription.value =
        individualGoal.description;

      bexPaElements.individualGoalTarget.value =
        individualGoal.target;

      bexPaElements.individualGoalStatus.value =
        individualGoal.status;

      bexPaElements.individualGoalStartDate.value =
        individualGoal.startDate;

      bexPaElements.individualGoalDueDate.value =
        individualGoal.dueDate;
    }

    bexPaElements.individualGoalDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.individualGoalEmployee?.focus();
    });
  }

  function bexPaCloseIndividualGoalDialog() {
    bexPaElements.individualGoalDialog?.close();
    bexPaResetIndividualGoalForm();
  }

  function bexPaValidateIndividualGoal(
    individualGoal,
  ) {
    const requiredValues = [
      individualGoal.employee,
      individualGoal.departmentGoalId,
      individualGoal.title,
      individualGoal.description,
      individualGoal.target,
      individualGoal.status,
      individualGoal.startDate,
      individualGoal.dueDate,
    ];

    if (requiredValues.some((value) => !value)) {
      return "Complete all individual employee goal fields before saving.";
    }

    const departmentGoal =
      bexPaState.departmentGoals.find(
        (existingDepartmentGoal) =>
          existingDepartmentGoal.id ===
          individualGoal.departmentGoalId,
      );

    if (!departmentGoal) {
      return "Select a valid department goal.";
    }

    const individualStartDate = bexPaParseDate(
      individualGoal.startDate,
    );

    const individualDueDate = bexPaParseDate(
      individualGoal.dueDate,
    );

    const departmentStartDate = bexPaParseDate(
      departmentGoal.startDate,
    );

    const departmentDueDate = bexPaParseDate(
      departmentGoal.dueDate,
    );

    if (
      !individualStartDate ||
      !individualDueDate ||
      !departmentStartDate ||
      !departmentDueDate
    ) {
      return "Enter valid individual goal dates.";
    }

    if (individualDueDate < individualStartDate) {
      return "The individual goal due date cannot be earlier than its start date.";
    }

    if (
      individualStartDate < departmentStartDate ||
      individualDueDate > departmentDueDate
    ) {
      return "Individual goal dates must fall within the parent department goal dates.";
    }

    const duplicateIndividualGoal =
      bexPaState.individualGoals.some(
        (existingIndividualGoal) =>
          existingIndividualGoal.id !==
          bexPaState.editingIndividualGoalId &&
          existingIndividualGoal.departmentGoalId ===
          individualGoal.departmentGoalId &&
          existingIndividualGoal.employee.toLowerCase() ===
          individualGoal.employee.toLowerCase() &&
          existingIndividualGoal.title.toLowerCase() ===
          individualGoal.title.toLowerCase(),
      );

    if (duplicateIndividualGoal) {
      return "An individual goal with this title already exists for this employee under the selected department goal.";
    }

    return "";
  }

  function bexPaCreateIndividualGoalActionButton(
    individualGoalId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-secondary";

    button.dataset.bexPaIndividualGoalAction = "edit";
    button.dataset.bexPaIndividualGoalId =
      individualGoalId;

    button.innerHTML =
      '<i class="bi bi-pencil" aria-hidden="true"></i>';

    button.title = "Edit individual goal";
    button.setAttribute(
      "aria-label",
      "Edit individual goal",
    );

    return button;
  }

  function bexPaRenderIndividualGoals() {
    if (!bexPaElements.individualGoalsList) {
      return;
    }

    bexPaElements.individualGoalsList.replaceChildren();

    if (bexPaState.individualGoals.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaIndividualGoalsEmpty";

      emptyState.textContent =
        "No individual employee goals have been created yet.";

      bexPaElements.individualGoalsList.appendChild(
        emptyState,
      );

      return;
    }

    bexPaState.individualGoals.forEach(
      (individualGoal) => {
        const departmentGoal =
          bexPaState.departmentGoals.find(
            (existingDepartmentGoal) =>
              existingDepartmentGoal.id ===
              individualGoal.departmentGoalId,
          );

        const cycle = departmentGoal
          ? bexPaState.cycles.find(
            (existingCycle) =>
              existingCycle.id ===
              departmentGoal.cycleId,
          )
          : null;

        const item = document.createElement("article");
        item.className = "bex-pa-goal-item";

        const header = document.createElement("div");
        header.className =
          "d-flex align-items-start justify-content-between gap-3";

        const titleArea = document.createElement("div");

        const title = document.createElement("h3");
        title.className =
          "bex-pa-goal-item-title h6";

        title.textContent = individualGoal.title;

        const meta = document.createElement("div");
        meta.className = "bex-pa-goal-meta";

        const employeeLabel =
          document.createElement("span");
        employeeLabel.textContent =
          individualGoal.employee;

        const departmentLabel =
          document.createElement("span");
        departmentLabel.textContent =
          departmentGoal?.department ||
          "Unknown department";

        const parentGoalLabel =
          document.createElement("span");
        parentGoalLabel.textContent =
          departmentGoal?.title ||
          "Unknown department goal";

        const cycleLabel =
          document.createElement("span");
        cycleLabel.textContent =
          cycle?.name || "Unknown cycle";

        meta.append(
          employeeLabel,
          departmentLabel,
          parentGoalLabel,
          cycleLabel,
        );

        titleArea.append(
          title,
          meta,
        );

        const status = document.createElement("span");
        status.className = "bex-pa-goal-status";
        status.dataset.status =
          individualGoal.status.toLowerCase();
        status.textContent =
          individualGoal.status;

        header.append(
          titleArea,
          status,
        );

        const description =
          document.createElement("p");
        description.className =
          "mt-3 mb-2 text-body-secondary";

        description.textContent =
          individualGoal.description;

        const target = document.createElement("p");
        target.className = "mb-0 small";
        target.textContent =
          `Target: ${individualGoal.target}`;

        const actions =
          document.createElement("div");
        actions.className =
          "bex-pa-goal-item-actions";

        actions.appendChild(
          bexPaCreateIndividualGoalActionButton(
            individualGoal.id,
          ),
        );

        item.append(
          header,
          description,
          target,
          actions,
        );

        bexPaElements.individualGoalsList.appendChild(
          item,
        );
      },
    );
  }

  function bexPaHandleIndividualGoalSubmit(event) {
    event.preventDefault();
    bexPaClearIndividualGoalError();

    const departmentGoal =
      bexPaState.departmentGoals.find(
        (existingDepartmentGoal) =>
          existingDepartmentGoal.id ===
          bexPaElements.individualGoalDepartmentGoal.value,
      );

    const individualGoal = {
      id:
        bexPaState.editingIndividualGoalId ||
        `BEX-PA-INDIVIDUAL-GOAL-${Date.now()}`,

      employee:
        bexPaElements.individualGoalEmployee.value.trim(),

      departmentGoalId:
        bexPaElements.individualGoalDepartmentGoal.value,

      department:
        departmentGoal?.department || "",

      cycleId:
        departmentGoal?.cycleId || "",

      title:
        bexPaElements.individualGoalTitle.value.trim(),

      description:
        bexPaElements.individualGoalDescription.value.trim(),

      target:
        bexPaElements.individualGoalTarget.value.trim(),

      status:
        bexPaElements.individualGoalStatus.value,

      startDate:
        bexPaElements.individualGoalStartDate.value,

      dueDate:
        bexPaElements.individualGoalDueDate.value,
    };

    const validationError =
      bexPaValidateIndividualGoal(
        individualGoal,
      );

    if (validationError) {
      bexPaShowIndividualGoalError(
        validationError,
      );
      return;
    }

    const wasEditing = Boolean(
      bexPaState.editingIndividualGoalId,
    );

    if (wasEditing) {
      const individualGoalIndex =
        bexPaState.individualGoals.findIndex(
          (existingIndividualGoal) =>
            existingIndividualGoal.id ===
            bexPaState.editingIndividualGoalId,
        );

      if (individualGoalIndex === -1) {
        bexPaShowIndividualGoalError(
          "The individual goal could not be found.",
        );
        return;
      }

      bexPaState.individualGoals[
        individualGoalIndex
      ] = individualGoal;
    } else {
      bexPaState.individualGoals.push(
        individualGoal,
      );
    }

    bexPaSaveIndividualGoals();
    bexPaRenderIndividualGoals();
    bexPaCloseIndividualGoalDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${individualGoal.title} was updated successfully.`
          : `${individualGoal.title} was created successfully.`;
    }
  }

  function bexPaHandleIndividualGoalListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-individual-goal-action]",
    );

    if (!button) {
      return;
    }

    const individualGoalId =
      button.dataset.bexPaIndividualGoalId;

    if (!individualGoalId) {
      return;
    }

    bexPaOpenIndividualGoalDialog(
      individualGoalId,
    );
  }

  function bexPaCreateDepartmentGoalActionButton(
    departmentGoalId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-secondary";

    button.dataset.bexPaDepartmentGoalAction = "edit";
    button.dataset.bexPaDepartmentGoalId =
      departmentGoalId;

    button.innerHTML =
      '<i class="bi bi-pencil" aria-hidden="true"></i>';

    button.title = "Edit department goal";
    button.setAttribute(
      "aria-label",
      "Edit department goal",
    );

    return button;
  }

  function bexPaRenderDepartmentGoals() {
    if (!bexPaElements.departmentGoalsList) {
      return;
    }

    bexPaElements.departmentGoalsList.replaceChildren();

    if (bexPaState.departmentGoals.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaDepartmentGoalsEmpty";

      emptyState.textContent =
        "No department goals have been created yet.";

      bexPaElements.departmentGoalsList.appendChild(
        emptyState,
      );

      return;
    }

    bexPaState.departmentGoals.forEach(
      (departmentGoal) => {
        const organisationGoal =
          bexPaState.organisationGoals.find(
            (goal) =>
              goal.id ===
              departmentGoal.organisationGoalId,
          );

        const cycle = organisationGoal
          ? bexPaState.cycles.find(
            (existingCycle) =>
              existingCycle.id ===
              organisationGoal.cycleId,
          )
          : null;

        const item = document.createElement("article");
        item.className = "bex-pa-goal-item";

        const header = document.createElement("div");
        header.className =
          "d-flex align-items-start justify-content-between gap-3";

        const titleArea = document.createElement("div");

        const title = document.createElement("h3");
        title.className =
          "bex-pa-goal-item-title h6";

        title.textContent = departmentGoal.title;

        const meta = document.createElement("div");
        meta.className = "bex-pa-goal-meta";

        const departmentLabel =
          document.createElement("span");
        departmentLabel.textContent =
          departmentGoal.department;

        const organisationGoalLabel =
          document.createElement("span");
        organisationGoalLabel.textContent =
          organisationGoal?.title ||
          "Unknown organisation goal";

        const cycleLabel =
          document.createElement("span");
        cycleLabel.textContent =
          cycle?.name || "Unknown cycle";

        const ownerLabel =
          document.createElement("span");
        ownerLabel.textContent =
          `Owner: ${departmentGoal.owner}`;

        meta.append(
          departmentLabel,
          organisationGoalLabel,
          cycleLabel,
          ownerLabel,
        );

        titleArea.append(
          title,
          meta,
        );

        const status = document.createElement("span");
        status.className = "bex-pa-goal-status";
        status.dataset.status =
          departmentGoal.status.toLowerCase();
        status.textContent =
          departmentGoal.status;

        header.append(
          titleArea,
          status,
        );

        const description =
          document.createElement("p");
        description.className =
          "mt-3 mb-2 text-body-secondary";

        description.textContent =
          departmentGoal.description;

        const target = document.createElement("p");
        target.className = "mb-0 small";
        target.textContent =
          `Target: ${departmentGoal.target}`;

        const actions =
          document.createElement("div");
        actions.className =
          "bex-pa-goal-item-actions";

        actions.appendChild(
          bexPaCreateDepartmentGoalActionButton(
            departmentGoal.id,
          ),
        );

        item.append(
          header,
          description,
          target,
          actions,
        );

        bexPaElements.departmentGoalsList.appendChild(
          item,
        );
      },
    );
  }

  function bexPaHandleDepartmentGoalSubmit(event) {
    event.preventDefault();
    bexPaClearDepartmentGoalError();

    const organisationGoal =
      bexPaState.organisationGoals.find(
        (goal) =>
          goal.id ===
          bexPaElements.departmentGoalOrganisationGoal.value,
      );

    const departmentGoal = {
      id:
        bexPaState.editingDepartmentGoalId ||
        `BEX-PA-DEPT-GOAL-${Date.now()}`,

      organisationGoalId:
        bexPaElements.departmentGoalOrganisationGoal.value,

      cycleId:
        organisationGoal?.cycleId || "",

      department:
        bexPaElements.departmentGoalDepartment.value.trim(),

      title:
        bexPaElements.departmentGoalTitle.value.trim(),

      description:
        bexPaElements.departmentGoalDescription.value.trim(),

      target:
        bexPaElements.departmentGoalTarget.value.trim(),

      owner:
        bexPaElements.departmentGoalOwner.value.trim(),

      status:
        bexPaElements.departmentGoalStatus.value,

      startDate:
        bexPaElements.departmentGoalStartDate.value,

      dueDate:
        bexPaElements.departmentGoalDueDate.value,
    };

    const validationError =
      bexPaValidateDepartmentGoal(
        departmentGoal,
      );

    if (validationError) {
      bexPaShowDepartmentGoalError(
        validationError,
      );
      return;
    }

    const wasEditing = Boolean(
      bexPaState.editingDepartmentGoalId,
    );

    if (wasEditing) {
      const departmentGoalIndex =
        bexPaState.departmentGoals.findIndex(
          (existingDepartmentGoal) =>
            existingDepartmentGoal.id ===
            bexPaState.editingDepartmentGoalId,
        );

      if (departmentGoalIndex === -1) {
        bexPaShowDepartmentGoalError(
          "The department goal could not be found.",
        );
        return;
      }

      bexPaState.departmentGoals[
        departmentGoalIndex
      ] = departmentGoal;
    } else {
      bexPaState.departmentGoals.push(
        departmentGoal,
      );
    }

    bexPaSaveDepartmentGoals();
    bexPaRenderDepartmentGoals();
    bexPaCloseDepartmentGoalDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${departmentGoal.title} was updated successfully.`
          : `${departmentGoal.title} was created successfully.`;
    }
  }

  function bexPaHandleDepartmentGoalListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-department-goal-action]",
    );

    if (!button) {
      return;
    }

    const departmentGoalId =
      button.dataset.bexPaDepartmentGoalId;

    if (!departmentGoalId) {
      return;
    }

    bexPaOpenDepartmentGoalDialog(
      departmentGoalId,
    );
  }

  function bexPaCreateDeliverableActionButton(
    deliverableId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-secondary";

    button.dataset.bexPaDeliverableAction = "edit";
    button.dataset.bexPaDeliverableId = deliverableId;

    button.innerHTML =
      '<i class="bi bi-pencil" aria-hidden="true"></i>';

    button.title = "Edit organisational deliverable";
    button.setAttribute(
      "aria-label",
      "Edit organisational deliverable",
    );

    return button;
  }

  function bexPaRenderDeliverables() {
    if (!bexPaElements.deliverablesList) {
      return;
    }

    bexPaElements.deliverablesList.replaceChildren();

    if (bexPaState.deliverables.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaDeliverablesEmpty";

      emptyState.textContent =
        "No organisational deliverables have been created yet.";

      bexPaElements.deliverablesList.appendChild(
        emptyState,
      );

      return;
    }

    bexPaState.deliverables.forEach((deliverable) => {
      const organisationGoal =
        bexPaState.organisationGoals.find(
          (goal) =>
            goal.id ===
            deliverable.organisationGoalId,
        );

      const cycle = organisationGoal
        ? bexPaState.cycles.find(
          (existingCycle) =>
            existingCycle.id ===
            organisationGoal.cycleId,
        )
        : null;

      const item = document.createElement("article");
      item.className = "bex-pa-goal-item";

      const header = document.createElement("div");
      header.className =
        "d-flex align-items-start justify-content-between gap-3";

      const titleArea = document.createElement("div");

      const title = document.createElement("h3");
      title.className =
        "bex-pa-goal-item-title h6";

      title.textContent = deliverable.title;

      const meta = document.createElement("div");
      meta.className = "bex-pa-goal-meta";

      const goalLabel = document.createElement("span");
      goalLabel.textContent =
        organisationGoal?.title || "Unknown organisation goal";

      const cycleLabel = document.createElement("span");
      cycleLabel.textContent =
        cycle?.name || "Unknown cycle";

      const ownerLabel = document.createElement("span");
      ownerLabel.textContent =
        `Owner: ${deliverable.owner}`;

      meta.append(
        goalLabel,
        cycleLabel,
        ownerLabel,
      );

      titleArea.append(
        title,
        meta,
      );

      const status = document.createElement("span");
      status.className = "bex-pa-goal-status";
      status.dataset.status =
        deliverable.status.toLowerCase();
      status.textContent = deliverable.status;

      header.append(
        titleArea,
        status,
      );

      const description = document.createElement("p");
      description.className =
        "mt-3 mb-2 text-body-secondary";

      description.textContent =
        deliverable.description;

      const target = document.createElement("p");
      target.className = "mb-0 small";
      target.textContent =
        `Target: ${deliverable.target}`;

      const actions = document.createElement("div");
      actions.className =
        "bex-pa-goal-item-actions";

      actions.appendChild(
        bexPaCreateDeliverableActionButton(
          deliverable.id,
        ),
      );

      item.append(
        header,
        description,
        target,
        actions,
      );

      bexPaElements.deliverablesList.appendChild(
        item,
      );
    });
  }

  function bexPaHandleDeliverableSubmit(event) {
    event.preventDefault();
    bexPaClearDeliverableError();

    const organisationGoal =
      bexPaState.organisationGoals.find(
        (goal) =>
          goal.id ===
          bexPaElements.deliverableOrganisationGoal.value,
      );

    const deliverable = {
      id:
        bexPaState.editingDeliverableId ||
        `BEX-PA-DELIVERABLE-${Date.now()}`,

      organisationGoalId:
        bexPaElements.deliverableOrganisationGoal.value,

      cycleId:
        organisationGoal?.cycleId || "",

      title:
        bexPaElements.deliverableTitle.value.trim(),

      description:
        bexPaElements.deliverableDescription.value.trim(),

      target:
        bexPaElements.deliverableTarget.value.trim(),

      owner:
        bexPaElements.deliverableOwner.value.trim(),

      status:
        bexPaElements.deliverableStatus.value,

      startDate:
        bexPaElements.deliverableStartDate.value,

      dueDate:
        bexPaElements.deliverableDueDate.value,
    };

    const validationError =
      bexPaValidateDeliverable(deliverable);

    if (validationError) {
      bexPaShowDeliverableError(
        validationError,
      );
      return;
    }

    const wasEditing = Boolean(
      bexPaState.editingDeliverableId,
    );

    if (wasEditing) {
      const deliverableIndex =
        bexPaState.deliverables.findIndex(
          (existingDeliverable) =>
            existingDeliverable.id ===
            bexPaState.editingDeliverableId,
        );

      if (deliverableIndex === -1) {
        bexPaShowDeliverableError(
          "The organisational deliverable could not be found.",
        );
        return;
      }

      bexPaState.deliverables[deliverableIndex] =
        deliverable;
    } else {
      bexPaState.deliverables.push(
        deliverable,
      );
    }

    bexPaSaveDeliverables();
    bexPaRenderDeliverables();
    bexPaCloseDeliverableDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${deliverable.title} was updated successfully.`
          : `${deliverable.title} was created successfully.`;
    }
  }

  function bexPaHandleDeliverableListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-deliverable-action]",
    );

    if (!button) {
      return;
    }

    const deliverableId =
      button.dataset.bexPaDeliverableId;

    if (!deliverableId) {
      return;
    }

    bexPaOpenDeliverableDialog(
      deliverableId,
    );
  }

  function bexPaCreateOrganisationGoalActionButton(
    goalId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-secondary";

    button.dataset.bexPaOrganisationGoalAction = "edit";
    button.dataset.bexPaOrganisationGoalId = goalId;

    button.innerHTML =
      '<i class="bi bi-pencil" aria-hidden="true"></i>';

    button.title = "Edit organisation goal";
    button.setAttribute(
      "aria-label",
      "Edit organisation goal",
    );

    return button;
  }

  function bexPaRenderOrganisationGoals() {
    if (!bexPaElements.organisationGoalsList) {
      return;
    }

    bexPaElements.organisationGoalsList.replaceChildren();

    if (bexPaState.organisationGoals.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaOrganisationGoalsEmpty";

      emptyState.textContent =
        "No organisation goals have been created yet.";

      bexPaElements.organisationGoalsList.appendChild(
        emptyState,
      );

      return;
    }

    bexPaState.organisationGoals.forEach((goal) => {
      const cycle = bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === goal.cycleId,
      );

      const item = document.createElement("article");
      item.className = "bex-pa-goal-item";

      const header = document.createElement("div");
      header.className =
        "d-flex align-items-start justify-content-between gap-3";

      const titleArea = document.createElement("div");

      const title = document.createElement("h3");
      title.className =
        "bex-pa-goal-item-title h6";

      title.textContent = goal.title;

      const meta = document.createElement("div");
      meta.className = "bex-pa-goal-meta";

      const cycleLabel = document.createElement("span");
      cycleLabel.textContent =
        cycle?.name || "Unknown cycle";

      const ownerLabel = document.createElement("span");
      ownerLabel.textContent = `Owner: ${goal.owner}`;

      meta.append(
        cycleLabel,
        ownerLabel,
      );

      titleArea.append(
        title,
        meta,
      );

      const status = document.createElement("span");
      status.className = "bex-pa-goal-status";
      status.dataset.status =
        goal.status.toLowerCase();
      status.textContent = goal.status;

      header.append(
        titleArea,
        status,
      );

      const description = document.createElement("p");
      description.className =
        "mt-3 mb-2 text-body-secondary";

      description.textContent =
        goal.description;

      const result = document.createElement("p");
      result.className = "mb-0 small";

      result.textContent =
        `Target: ${goal.target}`;

      const actions = document.createElement("div");
      actions.className =
        "bex-pa-goal-item-actions";

      actions.appendChild(
        bexPaCreateOrganisationGoalActionButton(
          goal.id,
        ),
      );

      item.append(
        header,
        description,
        result,
        actions,
      );

      bexPaElements.organisationGoalsList.appendChild(
        item,
      );
    });
  }

  function bexPaHandleOrganisationGoalSubmit(event) {
    event.preventDefault();
    bexPaClearOrganisationGoalError();

    const goal = {
      id:
        bexPaState.editingOrganisationGoalId ||
        `BEX-PA-ORG-GOAL-${Date.now()}`,

      cycleId:
        bexPaElements.organisationGoalCycle.value,

      title:
        bexPaElements.organisationGoalTitle.value.trim(),

      description:
        bexPaElements.organisationGoalDescription.value.trim(),

      target:
        bexPaElements.organisationGoalTarget.value.trim(),

      owner:
        bexPaElements.organisationGoalOwner.value.trim(),

      status:
        bexPaElements.organisationGoalStatus.value,

      startDate:
        bexPaElements.organisationGoalStartDate.value,

      dueDate:
        bexPaElements.organisationGoalDueDate.value,
    };

    const validationError =
      bexPaValidateOrganisationGoal(goal);

    if (validationError) {
      bexPaShowOrganisationGoalError(
        validationError,
      );
      return;
    }

    const wasEditing = Boolean(
      bexPaState.editingOrganisationGoalId,
    );

    if (wasEditing) {
      const goalIndex =
        bexPaState.organisationGoals.findIndex(
          (existingGoal) =>
            existingGoal.id ===
            bexPaState.editingOrganisationGoalId,
        );

      if (goalIndex === -1) {
        bexPaShowOrganisationGoalError(
          "The organisation goal could not be found.",
        );
        return;
      }

      bexPaState.organisationGoals[goalIndex] = goal;
    } else {
      bexPaState.organisationGoals.push(goal);
    }

    bexPaSaveOrganisationGoals();
    bexPaRenderOrganisationGoals();
    bexPaCloseOrganisationGoalDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${goal.title} was updated successfully.`
          : `${goal.title} was created successfully.`;
    }
  }

  function bexPaHandleOrganisationGoalListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-organisation-goal-action]",
    );

    if (!button) {
      return;
    }

    const goalId =
      button.dataset.bexPaOrganisationGoalId;

    if (!goalId) {
      return;
    }

    bexPaOpenOrganisationGoalDialog(goalId);
  }

  function bexPaInitialiseAppraisalCycles() {
    bexPaState.cycles = bexPaLoadStoredCycles();

    bexPaState.organisationGoals =
      bexPaLoadOrganisationGoals();

    bexPaState.deliverables =
      bexPaLoadDeliverables();

    bexPaState.departmentGoals =
      bexPaLoadDepartmentGoals();

    bexPaState.individualGoals =
      bexPaLoadIndividualGoals();

    bexPaElements.cyclesNavButton?.addEventListener(
      "click",
      () => bexPaShowSection("cycles"),
    );

    bexPaElements.goalsNavButton?.addEventListener(
      "click",
      () => bexPaShowSection("goals"),
    );

    bexPaElements.overviewNavLink?.addEventListener(
      "click",
      () => bexPaShowSection("overview"),
    );

    bexPaElements.overviewCreateButton?.addEventListener(
      "click",
      () => bexPaShowCycleForm(),
    );

    bexPaElements.cyclesCreateButton?.addEventListener(
      "click",
      () => bexPaShowCycleForm(),
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

    bexPaElements.cycleTableBody?.addEventListener(
      "click",
      bexPaHandleCycleTableAction,
    );

    bexPaElements.confirmActivateCycleButton?.addEventListener(
      "click",
      bexPaActivateCycle,
    );

    bexPaElements.activateCycleDialog?.addEventListener(
      "close",
      () => {
        bexPaState.activatingCycleId = null;
      },
    );

    bexPaElements.createOrganisationGoalButton?.addEventListener(
      "click",
      () => bexPaOpenOrganisationGoalDialog(),
    );

    bexPaElements.closeOrganisationGoalDialogButton?.addEventListener(
      "click",
      bexPaCloseOrganisationGoalDialog,
    );

    bexPaElements.cancelOrganisationGoalButton?.addEventListener(
      "click",
      bexPaCloseOrganisationGoalDialog,
    );

    bexPaElements.organisationGoalForm?.addEventListener(
      "submit",
      bexPaHandleOrganisationGoalSubmit,
    );

    bexPaElements.organisationGoalsList?.addEventListener(
      "click",
      bexPaHandleOrganisationGoalListAction,
    );

    bexPaElements.createDeliverableButton?.addEventListener(
      "click",
      () => bexPaOpenDeliverableDialog(),
    );

    bexPaElements.closeDeliverableDialogButton?.addEventListener(
      "click",
      bexPaCloseDeliverableDialog,
    );

    bexPaElements.cancelDeliverableButton?.addEventListener(
      "click",
      bexPaCloseDeliverableDialog,
    );

    bexPaElements.deliverableOrganisationGoal?.addEventListener(
      "change",
      bexPaUpdateDeliverableCycleDisplay,
    );

    bexPaElements.deliverableForm?.addEventListener(
      "submit",
      bexPaHandleDeliverableSubmit,
    );

    bexPaElements.deliverablesList?.addEventListener(
      "click",
      bexPaHandleDeliverableListAction,
    );

    bexPaElements.createDepartmentGoalButton?.addEventListener(
      "click",
      () => bexPaOpenDepartmentGoalDialog(),
    );

    bexPaElements.closeDepartmentGoalDialogButton?.addEventListener(
      "click",
      bexPaCloseDepartmentGoalDialog,
    );

    bexPaElements.cancelDepartmentGoalButton?.addEventListener(
      "click",
      bexPaCloseDepartmentGoalDialog,
    );

    bexPaElements.departmentGoalOrganisationGoal?.addEventListener(
      "change",
      bexPaUpdateDepartmentGoalCycleDisplay,
    );

    bexPaElements.departmentGoalForm?.addEventListener(
      "submit",
      bexPaHandleDepartmentGoalSubmit,
    );

    bexPaElements.departmentGoalsList?.addEventListener(
      "click",
      bexPaHandleDepartmentGoalListAction,
    );

        bexPaElements.createIndividualGoalButton?.addEventListener(
      "click",
      () => bexPaOpenIndividualGoalDialog(),
    );

    bexPaElements.closeIndividualGoalDialogButton?.addEventListener(
      "click",
      bexPaCloseIndividualGoalDialog,
    );

    bexPaElements.cancelIndividualGoalButton?.addEventListener(
      "click",
      bexPaCloseIndividualGoalDialog,
    );

    bexPaElements.individualGoalDepartmentGoal?.addEventListener(
      "change",
      bexPaUpdateIndividualGoalDerivedFields,
    );

    bexPaElements.individualGoalForm?.addEventListener(
      "submit",
      bexPaHandleIndividualGoalSubmit,
    );

    bexPaElements.individualGoalsList?.addEventListener(
      "click",
      bexPaHandleIndividualGoalListAction,
    );

    bexPaRenderCycles();

    bexPaPopulateOrganisationGoalCycles();
    bexPaRenderOrganisationGoals();

    bexPaPopulateDeliverableOrganisationGoals();
    bexPaRenderDeliverables();

    bexPaPopulateDepartmentGoalOrganisationGoals();
    bexPaRenderDepartmentGoals();

    bexPaPopulateIndividualGoalDepartmentGoals();
    bexPaRenderIndividualGoals();
  }

  document.addEventListener(
    "DOMContentLoaded",
    bexPaInitialiseAppraisalCycles,
  );
})();