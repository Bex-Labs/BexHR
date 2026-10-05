"use strict";

/**
 * BexHR Performance Appraisal
 * Standalone-first module behaviour with optional BexHR identity integration.
 *
 * During standalone development, appraisal data is stored locally.
 * When mounted from an authenticated BexHR dashboard, the module can consume
 * window.BexHrPerformanceAppraisalContext for employee and manager scope.
 */

(() => {
  const BEX_PA_CONTEXT_STORAGE_KEY =
    "bexhr:performance-appraisal:context:v1";

  const BEX_PA_TENANT_CONTEXT_STORAGE_KEY =
    "hrPayrollTenantContext";

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

  const BEX_PA_PROGRESS_UPDATE_STORAGE_KEY =
    "bexhr:performance-appraisal:progress-updates:v1";

  const BEX_PA_TEMPLATE_STORAGE_KEY =
    "bexhr:performance-appraisal:templates:v1";

  const BEX_PA_EMPLOYEE_APPRAISAL_STORAGE_KEY =
    "bexhr:performance-appraisal:employee-appraisals:v1";

  const BEX_PA_SELF_APPRAISAL_STORAGE_KEY =
    "bexhr:performance-appraisal:self-appraisals:v1";

  const BEX_PA_MANAGER_APPRAISAL_STORAGE_KEY =
    "bexhr:performance-appraisal:manager-appraisals:v1";

  const BEX_PA_HR_FINALISATION_STORAGE_KEY =
    "bexhr:performance-appraisal:hr-finalisations:v1";

  const BEX_PA_EMPLOYEE_ACKNOWLEDGEMENT_STORAGE_KEY =
    "bexhr:performance-appraisal:employee-acknowledgements:v1";

  const BEX_PA_WORKSPACE_MEMORY_KEY =
    "bexhr:performance-appraisal:workspace:v1";

  const BEX_PA_SELF_APPRAISAL_TASK_MEMORY_KEY =
    "bexhr:performance-appraisal:self-appraisal-task:v1";

  const BEX_PA_HR_REVIEW_TASK_MEMORY_KEY =
    "bexhr:performance-appraisal:hr-review-task:v1";

  const BEX_PA_MANAGER_REVIEW_TASK_MEMORY_KEY =
    "bexhr:performance-appraisal:manager-review-task:v1";

  const BEX_PA_REPORT_CYCLE_MEMORY_KEY =
    "bexhr:performance-appraisal:report-cycle:v1";

  const BEX_PA_FORM_MEMORY_KEY =
    "bexhr:performance-appraisal:form-memory:v1";

  const BEX_PA_PERSISTENCE_TABLES = Object.freeze({
    cycles: "pa_cycles",
    organisationGoals: "pa_organisation_goals",
    deliverables: "pa_deliverables",
    departmentGoals: "pa_department_goals",
    templates: "pa_templates",
    individualGoals: "pa_individual_goals",
    progressUpdates: "pa_progress_updates",
    employeeAppraisals: "pa_employee_appraisals",
    selfAppraisals: "pa_self_appraisals",
    managerAppraisals: "pa_manager_appraisals",
    hrFinalisations: "pa_hr_finalisations",
    employeeAcknowledgements: "pa_employee_acknowledgements",
  });

  const BEX_PA_REMOTE_PERSISTENCE_DATASETS = Object.freeze([
    "cycles",
    "organisationGoals",
    "deliverables",
    "departmentGoals",
    "templates",
    "individualGoals",
    "progressUpdates",
    "employeeAppraisals",
    "selfAppraisals",
    "managerAppraisals",
    "hrFinalisations",
    "employeeAcknowledgements",
  ]);

  /*
   * PA-017 localStorage migration path.
   *
   * Standalone business records may be considered for an explicit,
   * HR Admin-controlled migration to integrated BexHR persistence.
   * Migration is never automatic during integrated initialisation,
   * and existing localStorage records are never deleted automatically.
   *
   * BEX_PA_FORM_MEMORY_KEY is excluded because form memory is UI state.
   * The migration dataset list deliberately reuses the canonical remote
   * persistence dataset list rather than maintaining a second list.
   *
   * Before migration, employee and department references must resolve
   * to canonical BexHR IDs. Unresolved or noncanonical references fail
   * closed. Remote BexHR data remains authoritative. progressUpdates and
   * employeeAcknowledgements remain append-only.
   */
  const BEX_PA_LOCALSTORAGE_MIGRATION_DATASETS =
    BEX_PA_REMOTE_PERSISTENCE_DATASETS;

  const bexPaPersistence = {
    mode: "standalone",
    ready: false,
    tenantId: null,
    userId: null,
    lastError: null,
  };

  function bexPaIsIntegratedPersistenceContext() {
    return Boolean(bexPaGetIntegratedContext());
  }

  function bexPaCanUseRemotePersistence() {
    return (
      bexPaIsIntegratedPersistenceContext() &&
      Boolean(window.supabaseClient) &&
      Boolean(window.SessionManager)
    );
  }
  function bexPaCreatePersistenceRow(
    datasetName,
    record,
    tenantId,
  ) {
    if (
      !BEX_PA_PERSISTENCE_TABLES[datasetName] ||
      !record ||
      typeof record !== "object" ||
      !record.id ||
      !tenantId
    ) {
      return null;
    }

    const row = {
      id: record.id,
      tenant_id: tenantId,
      payload: record,
    };

    if (record.status) {
      row.status = record.status;
    }

    switch (datasetName) {
      case "organisationGoals":
      case "deliverables":
        row.cycle_id = record.cycleId;
        break;

      case "departmentGoals":
        row.department_id = record.departmentId;
        row.cycle_id = record.cycleId;
        break;

      case "individualGoals":
        row.employee_id = record.employeeId;
        row.department_id = record.departmentId;
        row.cycle_id = record.cycleId;
        break;

      case "progressUpdates":
        row.employee_id = record.employeeId;
        row.individual_goal_id = record.individualGoalId;
        row.cycle_id = record.cycleId;
        break;

      case "employeeAppraisals":
        row.employee_id = record.employeeId;
        row.manager_employee_id = record.managerEmployeeId;
        row.cycle_id = record.cycleId;
        break;

      case "selfAppraisals":
        row.appraisal_id = record.appraisalId;
        row.employee_id = record.employeeId;
        break;

      case "managerAppraisals":
        row.appraisal_id = record.appraisalId;
        row.employee_id = record.employeeId;
        row.manager_employee_id = record.managerEmployeeId;
        break;

      case "hrFinalisations":
      case "employeeAcknowledgements":
        row.appraisal_id = record.appraisalId;
        row.employee_id = record.employeeId;
        break;

      case "cycles":
      case "templates":
        break;

      default:
        return null;
    }

    return row;
  }
  function bexPaCreatePersistenceRows(
    datasetName,
    records,
    tenantId,
  ) {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .map((record) =>
        bexPaCreatePersistenceRow(
          datasetName,
          record,
          tenantId,
        ),
      )
      .filter(Boolean);
  }

  function bexPaRestorePersistenceRecords(
    datasetName,
    rows,
  ) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => {
        const payload = row?.payload;

        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload)
        ) {
          return null;
        }

        const record = {
          ...payload,
          id: row.id,
        };

        if (row.status != null) {
          record.status = row.status;
        }

        switch (datasetName) {
          case "organisationGoals":
          case "deliverables":
            record.cycleId = row.cycle_id;
            break;

          case "departmentGoals":
            record.departmentId = row.department_id;
            record.cycleId = row.cycle_id;
            break;

          case "individualGoals":
            record.employeeId = row.employee_id;
            record.departmentId = row.department_id;
            record.cycleId = row.cycle_id;
            break;

          case "progressUpdates":
            record.employeeId = row.employee_id;
            record.individualGoalId =
              row.individual_goal_id;
            record.cycleId = row.cycle_id;
            break;

          case "employeeAppraisals":
            record.employeeId = row.employee_id;
            record.managerEmployeeId =
              row.manager_employee_id || null;
            record.cycleId = row.cycle_id;
            break;

          case "selfAppraisals":
            record.appraisalId = row.appraisal_id;
            record.employeeId = row.employee_id;
            break;

          case "managerAppraisals":
            record.appraisalId = row.appraisal_id;
            record.employeeId = row.employee_id;
            record.managerEmployeeId =
              row.manager_employee_id;
            break;

          case "hrFinalisations":
          case "employeeAcknowledgements":
            record.appraisalId = row.appraisal_id;
            record.employeeId = row.employee_id;
            break;

          case "cycles":
          case "templates":
            break;

          default:
            return null;
        }

        return record;
      })
      .filter(Boolean);
  }
  async function bexPaResolvePersistenceIdentity() {
    if (!bexPaCanUseRemotePersistence()) {
      return null;
    }

    const session =
      await window.SessionManager.getSession();

    const user = session?.user;

    if (!user?.id) {
      throw new Error(
        "Performance appraisal persistence requires an authenticated BexHR session.",
      );
    }

    const profile =
      await window.SessionManager.getProfile(user.id);

    if (!profile?.tenant_id) {
      throw new Error(
        "The authenticated BexHR profile does not have a canonical tenant.",
      );
    }

    let employeeResult = await window.supabaseClient
      .from("employees")
      .select("id, tenant_id, work_email")
      .eq("user_id", user.id)
      .eq("tenant_id", profile.tenant_id)
      .limit(1)
      .maybeSingle();

    if (
      employeeResult.error &&
      employeeResult.error.code !== "PGRST116"
    ) {
      throw employeeResult.error;
    }

    let employee = employeeResult.data;

    if (!employee && user.email) {
      employeeResult = await window.supabaseClient
        .from("employees")
        .select("id, tenant_id, work_email")
        .ilike("work_email", user.email)
        .eq("tenant_id", profile.tenant_id)
        .limit(1)
        .maybeSingle();

      if (
        employeeResult.error &&
        employeeResult.error.code !== "PGRST116"
      ) {
        throw employeeResult.error;
      }

      employee = employeeResult.data;
    }

    bexPaPersistence.mode = "remote";
    bexPaPersistence.ready = true;
    bexPaPersistence.tenantId = profile.tenant_id;
    bexPaPersistence.userId = user.id;
    bexPaPersistence.lastError = null;

    return {
      userId: user.id,
      employeeId: employee?.id || null,
      tenantId: profile.tenant_id,
    };
  }
  async function bexPaLoadRemoteDataset(datasetName) {
    const tableName =
      BEX_PA_PERSISTENCE_TABLES[datasetName];

    if (
      !tableName ||
      !bexPaPersistence.ready ||
      !bexPaPersistence.tenantId
    ) {
      return [];
    }

    const { data, error } =
      await window.supabaseClient
        .from(tableName)
        .select("*")
        .eq(
          "tenant_id",
          bexPaPersistence.tenantId,
        );

    if (error) {
      throw error;
    }

    return bexPaRestorePersistenceRecords(datasetName, data);
  }

  async function bexPaPersistRemoteRecords(
    datasetName,
    records,
  ) {
    const tableName =
      BEX_PA_PERSISTENCE_TABLES[datasetName];

    if (
      !tableName ||
      !bexPaPersistence.ready ||
      !bexPaPersistence.tenantId
    ) {
      throw new Error(
        `Remote persistence is not ready for ${datasetName}.`,
      );
    }

    const recordsToPersist = Array.isArray(records)
      ? records
      : [records];

    const rows = bexPaCreatePersistenceRows(
      datasetName,
      recordsToPersist,
      bexPaPersistence.tenantId,
    );

    if (rows.length === 0) {
      return;
    }

    const appendOnly =
      datasetName === "progressUpdates" ||
      datasetName === "employeeAcknowledgements";

    if (appendOnly && rows.length !== 1) {
      throw new Error(
        `${datasetName} persistence requires exactly one new append-only record.`,
      );
    }

    const query = appendOnly
      ? window.supabaseClient
        .from(tableName)
        .insert(rows)
      : window.supabaseClient
        .from(tableName)
        .upsert(rows, {
          onConflict: "id",
        });

    const { error } = await query;

    if (error) {
      throw error;
    }
  }
  async function bexPaPersistDatasetMutation(
    datasetName,
    record,
    standaloneSave,
  ) {
    if (
      !BEX_PA_REMOTE_PERSISTENCE_DATASETS.includes(
        datasetName,
      )
    ) {
      throw new Error(
        `Unknown performance appraisal persistence dataset: ${datasetName}.`,
      );
    }

    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      throw new Error(
        `${datasetName} persistence requires one record.`,
      );
    }

    if (bexPaIsIntegratedPersistenceContext()) {
      if (
        bexPaPersistence.mode !== "remote" ||
        !bexPaPersistence.ready
      ) {
        throw new Error(
          `Integrated persistence is unavailable for ${datasetName}.`,
        );
      }

      await bexPaPersistRemoteRecords(
        datasetName,
        record,
      );

      return;
    }

    if (typeof standaloneSave !== "function") {
      throw new Error(
        `Standalone persistence callback is missing for ${datasetName}.`,
      );
    }

    standaloneSave();
  }
  async function bexPaHydrateRemoteState() {
    const results = await Promise.all(
      BEX_PA_REMOTE_PERSISTENCE_DATASETS.map(
        async (datasetName) => [
          datasetName,
          await bexPaLoadRemoteDataset(datasetName),
        ],
      ),
    );

    results.forEach(([datasetName, records]) => {
      bexPaState[datasetName] = records;
    });
  }
  const bexPaState = {
    cycles: [],
    organisationGoals: [],
    deliverables: [],
    departmentGoals: [],
    individualGoals: [],
    progressUpdates: [],
    templates: [],
    employeeAppraisals: [],
    selfAppraisals: [],
    managerAppraisals: [],
    hrFinalisations: [],
    employeeAcknowledgements: [],
    editingSelfAppraisalId: null,
    editingManagerAppraisalId: null,
    editingHrAppraisalId: null,
    editingFinalAppraisalId: null,
    editingCycleId: null,
    activatingCycleId: null,
    editingOrganisationGoalId: null,
    editingDeliverableId: null,
    editingDepartmentGoalId: null,
    editingIndividualGoalId: null,
    editingTemplateId: null,
    templateCompetencies: [],
    editingTemplateCompetencyId: null,
  };

  function bexPaGetFormMemoryScope() {
    const context = bexPaGetIntegratedContext();
    const activeMode = bexPaGetActiveMode();
    const identity =
      activeMode === "employee"
        ? context?.employeeId || bexPaGetCurrentEmployeeId()
        : activeMode === "primary-manager"
          ? context?.managerEmployeeId || bexPaGetCurrentManagerEmployeeId()
          : "shared";

    return `${activeMode || "standalone"}:${String(identity || "shared").trim()}`;
  }

  function bexPaLoadFormMemory() {
    try {
      const storedMemory = window.localStorage.getItem(
        BEX_PA_FORM_MEMORY_KEY,
      );

      if (!storedMemory) {
        return {};
      }

      const parsedMemory = JSON.parse(storedMemory);
      return parsedMemory && typeof parsedMemory === "object"
        ? parsedMemory
        : {};
    } catch (error) {
      console.warn("Performance appraisal form memory could not be loaded.", error);
      return {};
    }
  }

  function bexPaRememberFormValues(formType, values) {
    try {
      const memory = bexPaLoadFormMemory();
      const scope = bexPaGetFormMemoryScope();

      memory[scope] = {
        ...(memory[scope] || {}),
        [formType]: {
          ...(memory[scope]?.[formType] || {}),
          ...values,
        },
      };

      window.localStorage.setItem(
        BEX_PA_FORM_MEMORY_KEY,
        JSON.stringify(memory),
      );
    } catch (error) {
      console.warn("Performance appraisal form memory could not be saved.", error);
    }
  }

  function bexPaGetRememberedFormValues(formType) {
    const memory = bexPaLoadFormMemory();
    return memory[bexPaGetFormMemoryScope()]?.[formType] || {};
  }

  function bexPaApplyRememberedValues(fields, values) {
    fields.forEach(([field, value]) => {
      if (field && !field.value && value !== undefined) {
        field.value = value;
      }
    });
  }

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

  function bexPaLoadProgressUpdates() {
    try {
      const storedProgressUpdates =
        window.localStorage.getItem(
          BEX_PA_PROGRESS_UPDATE_STORAGE_KEY,
        );

      if (!storedProgressUpdates) {
        return [];
      }

      const parsedProgressUpdates = JSON.parse(
        storedProgressUpdates,
      );

      return Array.isArray(parsedProgressUpdates)
        ? parsedProgressUpdates
        : [];
    } catch (error) {
      console.warn(
        "Progress updates could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveProgressUpdates() {
    try {
      window.localStorage.setItem(
        BEX_PA_PROGRESS_UPDATE_STORAGE_KEY,
        JSON.stringify(bexPaState.progressUpdates),
      );
    } catch (error) {
      console.warn(
        "Progress updates could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadTemplates() {
    try {
      const storedTemplates =
        window.localStorage.getItem(
          BEX_PA_TEMPLATE_STORAGE_KEY,
        );

      if (!storedTemplates) {
        return [];
      }

      const parsedTemplates =
        JSON.parse(storedTemplates);

      return Array.isArray(parsedTemplates)
        ? parsedTemplates
        : [];
    } catch (error) {
      console.warn(
        "Appraisal templates could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveTemplates() {
    try {
      window.localStorage.setItem(
        BEX_PA_TEMPLATE_STORAGE_KEY,
        JSON.stringify(bexPaState.templates),
      );
    } catch (error) {
      console.warn(
        "Appraisal templates could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadEmployeeAppraisals() {
    try {
      const storedEmployeeAppraisals =
        window.localStorage.getItem(
          BEX_PA_EMPLOYEE_APPRAISAL_STORAGE_KEY,
        );

      if (!storedEmployeeAppraisals) {
        return [];
      }

      const parsedEmployeeAppraisals =
        JSON.parse(storedEmployeeAppraisals);

      return Array.isArray(parsedEmployeeAppraisals)
        ? parsedEmployeeAppraisals
        : [];
    } catch (error) {
      console.warn(
        "Employee appraisals could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveEmployeeAppraisals() {
    try {
      window.localStorage.setItem(
        BEX_PA_EMPLOYEE_APPRAISAL_STORAGE_KEY,
        JSON.stringify(
          bexPaState.employeeAppraisals,
        ),
      );
    } catch (error) {
      console.warn(
        "Employee appraisals could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadSelfAppraisals() {
    try {
      const storedSelfAppraisals =
        window.localStorage.getItem(
          BEX_PA_SELF_APPRAISAL_STORAGE_KEY,
        );

      if (!storedSelfAppraisals) {
        return [];
      }

      const parsedSelfAppraisals =
        JSON.parse(storedSelfAppraisals);

      return Array.isArray(parsedSelfAppraisals)
        ? parsedSelfAppraisals
        : [];
    } catch (error) {
      console.warn(
        "Self-appraisal drafts could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveSelfAppraisals() {
    try {
      window.localStorage.setItem(
        BEX_PA_SELF_APPRAISAL_STORAGE_KEY,
        JSON.stringify(bexPaState.selfAppraisals),
      );
    } catch (error) {
      console.warn(
        "Self-appraisal drafts could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadManagerAppraisals() {
    try {
      const storedManagerAppraisals =
        window.localStorage.getItem(
          BEX_PA_MANAGER_APPRAISAL_STORAGE_KEY,
        );

      if (!storedManagerAppraisals) {
        return [];
      }

      const parsedManagerAppraisals =
        JSON.parse(storedManagerAppraisals);

      return Array.isArray(parsedManagerAppraisals)
        ? parsedManagerAppraisals
        : [];
    } catch (error) {
      console.warn(
        "Manager appraisal drafts could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveManagerAppraisals() {
    try {
      window.localStorage.setItem(
        BEX_PA_MANAGER_APPRAISAL_STORAGE_KEY,
        JSON.stringify(bexPaState.managerAppraisals),
      );
    } catch (error) {
      console.warn(
        "Manager appraisal drafts could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadHrFinalisations() {
    try {
      const storedHrFinalisations =
        window.localStorage.getItem(
          BEX_PA_HR_FINALISATION_STORAGE_KEY,
        );

      if (!storedHrFinalisations) {
        return [];
      }

      const parsedHrFinalisations =
        JSON.parse(storedHrFinalisations);

      return Array.isArray(parsedHrFinalisations)
        ? parsedHrFinalisations
        : [];
    } catch (error) {
      console.warn(
        "HR appraisal finalisations could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveHrFinalisations() {
    try {
      window.localStorage.setItem(
        BEX_PA_HR_FINALISATION_STORAGE_KEY,
        JSON.stringify(bexPaState.hrFinalisations),
      );
    } catch (error) {
      console.warn(
        "HR appraisal finalisations could not be saved.",
        error,
      );
    }
  }

  function bexPaLoadEmployeeAcknowledgements() {
    try {
      const storedAcknowledgements =
        window.localStorage.getItem(
          BEX_PA_EMPLOYEE_ACKNOWLEDGEMENT_STORAGE_KEY,
        );

      if (!storedAcknowledgements) {
        return [];
      }

      const parsedAcknowledgements =
        JSON.parse(storedAcknowledgements);

      return Array.isArray(parsedAcknowledgements)
        ? parsedAcknowledgements
        : [];
    } catch (error) {
      console.warn(
        "Employee appraisal acknowledgements could not be loaded.",
        error,
      );

      return [];
    }
  }

  function bexPaSaveEmployeeAcknowledgements() {
    try {
      window.localStorage.setItem(
        BEX_PA_EMPLOYEE_ACKNOWLEDGEMENT_STORAGE_KEY,
        JSON.stringify(
          bexPaState.employeeAcknowledgements,
        ),
      );
    } catch (error) {
      console.warn(
        "Employee appraisal acknowledgements could not be saved.",
        error,
      );
    }
  }

  function bexPaGetIndividualGoalEmployeeId(
    individualGoal,
  ) {
    return String(
      individualGoal?.employeeId || "",
    ).trim();
  }

  function bexPaGetIntegratedContext() {
    const liveContext =
      window.BexHrPerformanceAppraisalContext;

    if (
      liveContext &&
      typeof liveContext === "object"
    ) {
      return liveContext;
    }

    try {
      const storedContext =
        window.sessionStorage.getItem(
          BEX_PA_CONTEXT_STORAGE_KEY,
        );

      if (!storedContext) {
        return null;
      }

      const parsedContext =
        JSON.parse(storedContext);

      return (
        parsedContext &&
        typeof parsedContext === "object"
      )
        ? parsedContext
        : null;
    } catch (error) {
      console.warn(
        "Performance appraisal identity context could not be restored.",
        error,
      );

      return null;
    }
  }

  function bexPaResolveIndividualGoalEmployeeId() {
    const activeMode = bexPaGetActiveMode();

    if (activeMode === "employee") {
      return bexPaGetCurrentEmployeeId();
    }

    if (activeMode === "primary-manager") {
      const managedEmployeeIds =
        bexPaGetManagedEmployeeIds();

      if (managedEmployeeIds.length === 1) {
        return managedEmployeeIds[0];
      }
    }

    return "";
  }

  function bexPaGetCurrentEmployeeId() {
    const integratedEmployeeId =
      bexPaGetIntegratedContext()
        ?.employeeId;

    if (integratedEmployeeId) {
      return String(
        integratedEmployeeId,
      ).trim();
    }

    return String(
      document
        .querySelector("[data-bex-pa-app]")
        ?.dataset.bexPaEmployeeId || "",
    ).trim();
  }

  function bexPaHasEmployeeCapability() {
    return Boolean(
      bexPaGetCurrentEmployeeId(),
    );
  }

  function bexPaHasHrStandardCapability() {
    const context =
      bexPaGetIntegratedContext();

    return (
      context?.hrStandardCapability === true &&
      context?.hrAdminCapability !== true
    );
  }

  function bexPaHasHrAdminCapability() {
    return (
      bexPaGetIntegratedContext()
        ?.hrAdminCapability === true
    );
  }

  let bexPaActiveMode = "";

  function bexPaGetActiveMode() {
    return (
      bexPaActiveMode ||
      bexPaGetCurrentPersona()
    );
  }

  function bexPaSetActiveMode(mode) {
    const allowedModes = new Set([
      "employee",
      "primary-manager",
      "hr-standard",
      "hr-admin",
    ]);

    if (!allowedModes.has(mode)) {
      return false;
    }

    const hasCapabilityByMode = {
      employee: bexPaHasEmployeeCapability(),
      "primary-manager":
        bexPaHasManagerReviewVisibilityCapability(),
      "hr-standard":
        bexPaHasHrStandardCapability(),
      "hr-admin": bexPaHasHrAdminCapability(),
    };

    if (!hasCapabilityByMode[mode]) {
      return false;
    }

    bexPaActiveMode = mode;
    return true;
  }

  function bexPaGetWorkspaceLabelForMode(mode = bexPaGetActiveMode()) {
    return {
      employee: "My Appraisal",
      "primary-manager": "Manager Reviews",
      "hr-standard": "HR Standard View",
      "hr-admin": "HR Administration",
    }[String(mode || "").trim()] || "Performance Appraisal";
  }

  function bexPaGetAvailableWorkspaceModes() {
    const modes = [];

    if (bexPaHasEmployeeCapability()) {
      modes.push("employee");
    }
    if (bexPaHasManagerReviewVisibilityCapability()) {
      modes.push("primary-manager");
    }
    if (bexPaHasHrStandardCapability()) {
      modes.push("hr-standard");
    }
    if (bexPaHasHrAdminCapability()) {
      modes.push("hr-admin");
    }

    return modes;
  }

  function bexPaGetDefaultSectionForMode(mode = bexPaGetActiveMode()) {
    if (
      mode === "employee" ||
      mode === "primary-manager" ||
      mode === "hr-standard"
    ) {
      return "employeeAppraisals";
    }

    return "overview";
  }

  function bexPaIsEmployeeMode() {
    return (
      bexPaHasEmployeeCapability() &&
      bexPaGetActiveMode() === "employee"
    );
  }

  function bexPaIsPrimaryManagerMode() {
    return (
      bexPaHasPrimaryManagerCapability() &&
      bexPaGetActiveMode() === "primary-manager"
    );
  }

  function bexPaIsManagerReviewMode() {
    return (
      bexPaHasManagerReviewVisibilityCapability() &&
      bexPaGetActiveMode() === "primary-manager"
    );
  }

  function bexPaIsHrStandardMode() {
    return (
      bexPaHasHrStandardCapability() &&
      bexPaGetActiveMode() === "hr-standard"
    );
  }

  function bexPaIsHrAdminMode() {
    return (
      bexPaHasHrAdminCapability() &&
      bexPaGetActiveMode() === "hr-admin"
    );
  }

  function bexPaGetManagedEmployeeIds() {
    const integratedEmployeeIds =
      bexPaGetIntegratedContext()
        ?.managedEmployeeIds;

    if (Array.isArray(integratedEmployeeIds)) {
      return integratedEmployeeIds
        .map((employeeId) =>
          String(employeeId || "").trim(),
        )
        .filter(Boolean);
    }

    const rawEmployeeIds =
      document
        .querySelector("[data-bex-pa-app]")
        ?.dataset.bexPaManagedEmployeeIds || "";

    return rawEmployeeIds
      .split(",")
      .map((employeeId) => employeeId.trim())
      .filter(Boolean);
  }

  function bexPaGetCurrentManagerEmployeeId() {
    return String(
      bexPaGetIntegratedContext()
        ?.managerEmployeeId || "",
    ).trim();
  }

  function bexPaGetSecondaryEmployeeIds() {
    const integratedEmployeeIds =
      bexPaGetIntegratedContext()
        ?.secondaryEmployeeIds;

    if (!Array.isArray(integratedEmployeeIds)) {
      return [];
    }

    return integratedEmployeeIds
      .map((employeeId) =>
        String(employeeId || "").trim(),
      )
      .filter(Boolean);
  }

  function bexPaGetSecondaryEmployees() {
    const secondaryEmployees =
      bexPaGetIntegratedContext()
        ?.secondaryEmployees;

    if (!Array.isArray(secondaryEmployees)) {
      return [];
    }

    return secondaryEmployees
      .map((employee) => ({
        id: String(
          employee?.id || "",
        ).trim(),

        name: String(
          employee?.name || "",
        ).trim(),

        department: String(
          employee?.department || "",
        ).trim(),

        departmentId: String(
          employee?.departmentId || "",
        ).trim(),

        jobTitle: String(
          employee?.jobTitle || "",
        ).trim(),
      }))
      .filter(
        (employee) =>
          employee.id &&
          employee.name,
      );
  }

  function bexPaHasPrimaryManagerCapability() {
    return Boolean(
      bexPaGetCurrentManagerEmployeeId() &&
      bexPaGetManagedEmployeeIds().length > 0
    );
  }

  function bexPaHasManagerReviewVisibilityCapability() {
    return Boolean(
      bexPaGetCurrentManagerEmployeeId() &&
      (
        bexPaGetManagedEmployeeIds().length > 0 ||
        bexPaGetSecondaryEmployeeIds().length > 0
      )
    );
  }

  function bexPaGetAvailableEmployees() {
    const context = bexPaGetIntegratedContext() || {};
    const activeMode = bexPaGetActiveMode();

    let availableEmployees = context.availableEmployees;

    if (
      activeMode === "primary-manager" &&
      Array.isArray(context.managerAvailableEmployees)
    ) {
      availableEmployees = context.managerAvailableEmployees;
    } else if (
      (activeMode === "hr-standard" || activeMode === "hr-admin") &&
      Array.isArray(context.hrAvailableEmployees)
    ) {
      availableEmployees = context.hrAvailableEmployees;
    }

    if (!Array.isArray(availableEmployees)) {
      return [];
    }

    return availableEmployees
      .map((employee) => ({
        id: String(
          employee?.id || "",
        ).trim(),

        name: String(
          employee?.name || "",
        ).trim(),

        department: String(
          employee?.department || "",
        ).trim(),

        departmentId: String(
          employee?.departmentId || "",
        ).trim(),

        jobTitle: String(
          employee?.jobTitle || "",
        ).trim(),
      }))
      .filter(
        (employee) =>
          employee.id &&
          employee.name,
      );
  }

  function bexPaGetAvailableDepartments() {
    const integratedDepartments =
      bexPaGetIntegratedContext()
        ?.availableDepartments;

    if (Array.isArray(integratedDepartments)) {
      return integratedDepartments
        .map((department) => ({
          id: String(
            department?.id || "",
          ).trim(),

          name: String(
            department?.name || "",
          ).trim(),
        }))
        .filter(
          (department) =>
            department.id &&
            department.name,
        );
    }

    const departmentsById = new Map();

    bexPaGetAvailableEmployees().forEach(
      (employee) => {
        const departmentId = String(
          employee.departmentId || "",
        ).trim();

        const departmentName = String(
          employee.department || "",
        ).trim();

        if (
          !departmentId ||
          !departmentName
        ) {
          return;
        }

        departmentsById.set(
          departmentId,
          {
            id: departmentId,
            name: departmentName,
          },
        );
      },
    );

    return [
      ...departmentsById.values(),
    ];
  }

  function bexPaGetManagedDepartments() {
    if (!bexPaIsPrimaryManagerMode()) {
      return [];
    }

    const departmentsById = new Map();

    bexPaGetAvailableEmployees().forEach(
      (employee) => {
        const departmentId = String(
          employee.departmentId || "",
        ).trim();

        const departmentName = String(
          employee.department || "",
        ).trim();

        if (
          !departmentId ||
          !departmentName
        ) {
          return;
        }

        departmentsById.set(
          departmentId,
          {
            id: departmentId,
            name: departmentName,
          },
        );
      },
    );

    return [
      ...departmentsById.values(),
    ];
  }

  function bexPaCanManageDepartmentGoal(
    departmentGoal = null,
  ) {
    if (bexPaIsHrAdminMode()) {
      return true;
    }

    if (!bexPaIsPrimaryManagerMode()) {
      return false;
    }

    const managedDepartments =
      bexPaGetManagedDepartments();

    if (managedDepartments.length === 0) {
      return false;
    }

    if (!departmentGoal) {
      return true;
    }

    const goalDepartmentId = String(
      departmentGoal.departmentId || "",
    ).trim();

    if (
      bexPaIsIntegratedPersistenceContext()
    ) {
      if (!goalDepartmentId) {
        return false;
      }

      return managedDepartments.some(
        (department) =>
          department.id === goalDepartmentId,
      );
    }

    if (goalDepartmentId) {
      const matchesDepartmentId =
        managedDepartments.some(
          (department) =>
            department.id === goalDepartmentId,
        );

      if (matchesDepartmentId) {
        return true;
      }
    }

    const goalDepartmentName = String(
      departmentGoal.department || "",
    ).trim();

    return managedDepartments.some(
      (department) =>
        department.name &&
        goalDepartmentName &&
        department.name.toLowerCase() ===
        goalDepartmentName.toLowerCase(),
    );
  }

  function bexPaGetSelectedIndividualGoalEmployee() {
    const selectedEmployeeId = String(
      bexPaElements.individualGoalEmployee
        ?.querySelector(
          "#bexPaIndividualGoalEmployeeId",
        )
        ?.value || "",
    ).trim();

    if (!selectedEmployeeId) {
      return null;
    }

    return (
      bexPaGetAvailableEmployees().find(
        (employee) =>
          employee.id === selectedEmployeeId,
      ) || null
    );
  }

  function bexPaGetSelectedIndividualGoalDepartment() {
    const selectedEmployee =
      bexPaGetSelectedIndividualGoalEmployee();

    if (!selectedEmployee) {
      return null;
    }

    const departmentId = String(
      selectedEmployee.departmentId || "",
    ).trim();

    const departmentName = String(
      selectedEmployee.department || "",
    ).trim();

    if (
      bexPaIsIntegratedPersistenceContext() &&
      (!departmentId || !departmentName)
    ) {
      return null;
    }

    if (!departmentId && !departmentName) {
      return null;
    }

    return {
      id: departmentId,
      name: departmentName,
    };
  }

  function bexPaIsIndividualGoalOwnedByCurrentEmployee(
    individualGoal,
  ) {
    const currentEmployeeId =
      bexPaGetCurrentEmployeeId();

    const goalEmployeeId =
      bexPaGetIndividualGoalEmployeeId(
        individualGoal,
      );

    if (!currentEmployeeId || !goalEmployeeId) {
      return false;
    }

    return goalEmployeeId === currentEmployeeId;
  }

  function bexPaIsIndividualGoalInPrimaryManagerScope(
    individualGoal,
  ) {
    const goalEmployeeId =
      bexPaGetIndividualGoalEmployeeId(
        individualGoal,
      );

    if (!goalEmployeeId) {
      return false;
    }

    return bexPaGetManagedEmployeeIds().includes(
      goalEmployeeId,
    );
  }

  function bexPaGetVisibleIndividualGoals() {
    const activeMode = bexPaGetActiveMode();

    if (activeMode === "hr-admin") {
      return bexPaState.individualGoals;
    }

    if (activeMode === "hr-standard") {
      const visibleEmployeeIds =
        bexPaGetAvailableEmployees()
          .map((employee) =>
            String(employee?.id || "").trim(),
          )
          .filter(Boolean);

      if (visibleEmployeeIds.length === 0) {
        return [];
      }

      return bexPaState.individualGoals.filter(
        (individualGoal) =>
          visibleEmployeeIds.includes(
            bexPaGetIndividualGoalEmployeeId(
              individualGoal,
            ),
          ),
      );
    }

    if (activeMode === "primary-manager") {
      const visibleEmployeeIds = [
        ...new Set([
          ...bexPaGetManagedEmployeeIds(),
          ...bexPaGetSecondaryEmployeeIds(),
        ]),
      ];

      if (visibleEmployeeIds.length === 0) {
        return [];
      }

      return bexPaState.individualGoals.filter(
        (individualGoal) =>
          visibleEmployeeIds.includes(
            bexPaGetIndividualGoalEmployeeId(
              individualGoal,
            ),
          ),
      );
    }

    if (activeMode === "employee") {
      const currentEmployeeId =
        bexPaGetCurrentEmployeeId();

      if (!currentEmployeeId) {
        return [];
      }

      return bexPaState.individualGoals.filter(
        (individualGoal) =>
          bexPaIsIndividualGoalOwnedByCurrentEmployee(
            individualGoal,
          ),
      );
    }

    return [];
  }

  function bexPaIsDevelopmentHost() {
    const hostname = String(
      window.location.hostname || "",
    ).toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  }

  function bexPaGetCurrentPersona() {
    const integratedPersona =
      String(
        bexPaGetIntegratedContext()
          ?.persona || "",
      ).trim();

    if (
      [
        "hr-admin",
        "hr-standard",
        "primary-manager",
        "employee",
      ].includes(integratedPersona)
    ) {
      return integratedPersona;
    }

    if (bexPaIsDevelopmentHost()) {
      return (
        document
          .querySelector("[data-bex-pa-app]")
          ?.dataset.bexPaPersona || ""
      );
    }

    return "";
  }

  function bexPaSetDevelopmentPersona(persona) {
    const allowedPersonas = [
      "hr-admin",
      "primary-manager",
      "employee",
    ];

    if (!allowedPersonas.includes(persona)) {
      return;
    }

    const app = document.querySelector(
      "[data-bex-pa-app]",
    );

    if (!app) {
      return;
    }

    app.dataset.bexPaPersona = persona;

    bexPaApplyCycleAccess();
    bexPaApplyGoalAccess();
    bexPaApplyTemplateAccess();
    bexPaApplyReportAccess();
    bexPaApplyRoleWorkspaceClarity();

    bexPaRenderCycles();

    bexPaRenderOrganisationGoals();
    bexPaRenderDeliverables();
    bexPaRenderDepartmentGoals();
    bexPaRenderIndividualGoals();
    bexPaRenderProgressUpdates();
    bexPaRenderEmployeeAppraisals();
  }

  function bexPaCanManageAppraisalCycles() {
    return bexPaIsHrAdminMode();
  }

  function bexPaCanManageGoalFramework() {
    return bexPaIsHrAdminMode();
  }

  function bexPaCanManageTemplates() {
    return bexPaIsHrAdminMode();
  }

  function bexPaCanViewReports() {
    return bexPaIsHrAdminMode();
  }

  function bexPaCanManageDepartmentGoals() {
    if (bexPaIsHrAdminMode()) {
      return true;
    }

    if (bexPaIsPrimaryManagerMode()) {
      return bexPaGetManagedDepartments().length > 0;
    }

    return false;
  }

  function bexPaCanEditIndividualGoals() {
    if (bexPaIsHrAdminMode()) {
      return true;
    }

    if (bexPaIsPrimaryManagerMode()) {
      return bexPaGetManagedEmployeeIds().length > 0;
    }

    return false;
  }

  function bexPaIsIndividualGoalHistorical(
    individualGoal,
  ) {
    if (!individualGoal) {
      return false;
    }

    const appraisal =
      bexPaState.employeeAppraisals.find(
        (existingAppraisal) =>
          existingAppraisal.employeeId ===
          bexPaGetIndividualGoalEmployeeId(
            individualGoal,
          ) &&
          existingAppraisal.cycleId ===
          individualGoal.cycleId,
      );

    if (!appraisal) {
      return false;
    }

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId ===
          appraisal.id,
      );

    const acknowledgement =
      bexPaState.employeeAcknowledgements.find(
        (existingAcknowledgement) =>
          existingAcknowledgement.appraisalId ===
          appraisal.id,
      );

    return (
      hrFinalisation?.status === "Finalised" ||
      acknowledgement?.status === "Acknowledged"
    );
  }

  function bexPaCanAddProgressUpdates(
    individualGoal = null,
  ) {
    if (!bexPaIsEmployeeMode()) {
      return false;
    }

    if (!individualGoal) {
      return true;
    }

    return !bexPaIsIndividualGoalHistorical(
      individualGoal,
    );
  }

  function bexPaApplyCycleAccess() {
    const canManageCycles =
      bexPaCanManageAppraisalCycles();

    bexPaElements.cyclesCreateButton?.classList.toggle(
      "d-none",
      !canManageCycles,
    );
  }

  function bexPaApplyGoalAccess() {
    const canManageGoalFramework =
      bexPaCanManageGoalFramework();

    const canManageIndividualGoals =
      bexPaCanEditIndividualGoals();

    bexPaElements.createOrganisationGoalButton?.classList.toggle(
      "d-none",
      !canManageGoalFramework,
    );

    bexPaElements.createDeliverableButton?.classList.toggle(
      "d-none",
      !canManageGoalFramework,
    );

    bexPaElements.createDepartmentGoalButton?.classList.toggle(
      "d-none",
      !bexPaCanManageDepartmentGoals(),
    );

    bexPaElements.createIndividualGoalButton?.classList.toggle(
      "d-none",
      !canManageIndividualGoals,
    );
  }

  function bexPaApplyTemplateAccess() {
    const canManageTemplates =
      bexPaCanManageTemplates();

    bexPaElements.templatesNavButton?.classList.toggle(
      "d-none",
      !canManageTemplates,
    );

    bexPaElements.createTemplateButton?.classList.toggle(
      "d-none",
      !canManageTemplates,
    );

    if (
      !canManageTemplates &&
      bexPaElements.templatesSection &&
      !bexPaElements.templatesSection.classList.contains(
        "d-none",
      )
    ) {
      bexPaShowSection("overview");
    }
  }

  function bexPaApplyReportAccess() {
    const canViewReports =
      bexPaCanViewReports();

    bexPaElements.reportsNavButton?.classList.toggle(
      "d-none",
      !canViewReports,
    );

    if (
      !canViewReports &&
      bexPaElements.reportsSection &&
      !bexPaElements.reportsSection.classList.contains(
        "d-none",
      )
    ) {
      bexPaShowSection("overview");
    }
  }

  // BEXHR PA WORKSPACE SWITCHING - US-06 DEFECT CLOSEOUT
  // Users with more than one already-permitted PA responsibility can switch
  // workspace inside the module. This changes presentation mode only; the
  // existing capability checks continue to decide which workspaces/actions exist.
  function bexPaEnsureWorkspaceSwitcherStyles() {
    if (document.getElementById("bexPaWorkspaceSwitcherStyles")) return;

    const style = document.createElement("style");
    style.id = "bexPaWorkspaceSwitcherStyles";
    style.textContent = `
      .bex-pa-integrated-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }

      .bex-pa-workspace-switch-button {
        min-height: 34px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }

      #bexPaWorkspaceChooser {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.56);
        backdrop-filter: blur(2px);
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-dialog {
        width: min(900px, 100%);
        max-height: min(740px, calc(100vh - 48px));
        overflow: auto;
        background: #ffffff;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 24px;
        box-shadow: 0 28px 72px rgba(15, 23, 42, 0.28);
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-header {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 16px;
        align-items: start;
        padding: 22px 24px;
        border-bottom: 1px solid #e2e8f0;
        background: linear-gradient(110deg, #ffffff 0%, #f8fbfc 56%, #d9f4f2 100%);
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-icon {
        width: 46px;
        height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 14px;
        border: 1px solid #b9e7e7;
        background: #e8f8f8;
        color: #0f7f85;
        font-size: 1.15rem;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-kicker {
        margin: 0 0 4px;
        color: #0f7f85;
        font-size: .74rem;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-title {
        margin: 0;
        color: #0f172a;
        font-size: clamp(1.45rem, 3vw, 1.9rem);
        line-height: 1.15;
        font-weight: 800;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-description {
        margin: 7px 0 0;
        color: #64748b;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-close {
        width: 38px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #d9e2ec;
        border-radius: 12px;
        background: rgba(255,255,255,.9);
        color: #64748b;
        cursor: pointer;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        padding: 20px 24px 22px;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card {
        min-width: 0;
        min-height: 178px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
        padding: 18px;
        border: 1px solid #dbe4ee;
        border-radius: 18px;
        background: #ffffff;
        color: #0f172a;
        cursor: pointer;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card:hover,
      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card:focus-visible {
        border-color: #8ed8d5;
        box-shadow: 0 12px 28px rgba(15,23,42,.1);
        outline: none;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card.is-current {
        border-color: #53c7c5;
        background: #f7fdfd;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card-icon {
        width: 40px;
        height: 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 14px;
        border-radius: 12px;
        background: #e4f8fb;
        color: #0f7f85;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card-title {
        font-weight: 800;
        margin-bottom: 6px;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card-copy {
        color: #64748b;
        font-size: .9rem;
        line-height: 1.45;
        flex: 1;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-card-action {
        margin-top: 16px;
        color: #0f7f85;
        font-size: .83rem;
        font-weight: 800;
      }

      #bexPaWorkspaceChooser .bex-pa-workspace-chooser-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px 24px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        color: #64748b;
        font-size: .82rem;
      }

      @media (max-width: 760px) {
        .bex-pa-integrated-actions {
          width: 100%;
          justify-content: flex-start;
        }
        #bexPaWorkspaceChooser {
          align-items: flex-end;
          padding: 12px;
        }
        #bexPaWorkspaceChooser .bex-pa-workspace-chooser-grid {
          grid-template-columns: 1fr;
          padding: 16px 18px 18px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function bexPaUpdateIntegratedWorkspaceLabel() {
    if (bexPaElements.integratedWorkspaceLabel) {
      bexPaElements.integratedWorkspaceLabel.textContent =
        bexPaGetWorkspaceLabelForMode();
    }
  }

  function bexPaEnsureIntegratedWorkspaceSwitchButton() {
    const toolbar = bexPaElements.integratedToolbar;
    const backLink = bexPaElements.backToDashboardLink;
    if (!toolbar || !backLink) return null;

    bexPaEnsureWorkspaceSwitcherStyles();

    let actions = toolbar.querySelector(".bex-pa-integrated-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "bex-pa-integrated-actions";
      toolbar.appendChild(actions);
      actions.appendChild(backLink);
    }

    let button = document.getElementById("bexPaSwitchWorkspaceButton");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = "bexPaSwitchWorkspaceButton";
      button.className =
        "btn btn-outline-primary btn-sm bex-pa-workspace-switch-button";
      button.innerHTML =
        '<i class="bi bi-grid" aria-hidden="true"></i><span>Switch workspace</span>';
      button.addEventListener("click", bexPaShowWorkspaceChooser);
      actions.insertBefore(button, backLink);
    }

    const availableModes = bexPaGetAvailableWorkspaceModes();
    const shouldShow = availableModes.length > 1;
    button.hidden = !shouldShow;
    button.classList.toggle("d-none", !shouldShow);

    return button;
  }

  function bexPaGetWorkspaceChooserCopy(mode) {
    return {
      employee: {
        title: "My Appraisal",
        description:
          "Open your own appraisal and continue the actions assigned to you.",
        iconClass: "bi bi-person-check",
      },
      "primary-manager": {
        title: "Manager Reviews",
        description:
          "Review appraisal work for employees in your permitted reporting scope.",
        iconClass: "bi bi-people",
      },
      "hr-standard": {
        title: "HR Standard View",
        description:
          "Review appraisal progress using the visibility already assigned to your HR role.",
        iconClass: "bi bi-clipboard-data",
      },
      "hr-admin": {
        title: "HR Administration",
        description:
          "Open the HR appraisal administration and oversight workspace available to your role.",
        iconClass: "bi bi-clipboard-data",
      },
    }[mode];
  }

  function bexPaGetVisibleSectionName() {
    const sectionMap = {
      overview: bexPaElements.overviewSection,
      cycles: bexPaElements.cyclesSection,
      goals: bexPaElements.goalsSection,
      templates: bexPaElements.templatesSection,
      employeeAppraisals: bexPaElements.employeeAppraisalsSection,
      reports: bexPaElements.reportsSection,
    };

    return Object.entries(sectionMap).find(
      ([, section]) => section && !section.classList.contains("d-none"),
    )?.[0] || "";
  }

  async function bexPaSwitchWorkspaceMode(mode) {
    const nextMode = String(mode || "").trim();
    if (nextMode === bexPaGetActiveMode()) {
      bexPaUpdateIntegratedWorkspaceLabel();
      return true;
    }

    if (!bexPaSetActiveMode(nextMode)) {
      return false;
    }

    // Keep an open self-appraisal DOM intact while the user temporarily
    // switches PA workspace. No appraisal content is written to UI storage.
    bexPaState.editingManagerAppraisalId = null;
    bexPaState.editingHrAppraisalId = null;
    bexPaState.editingFinalAppraisalId = null;

    [
      bexPaElements.selfAppraisalSection,
      bexPaElements.managerAppraisalSection,
      bexPaElements.hrAppraisalReviewSection,
      bexPaElements.finalAppraisalSection,
    ].forEach((section) => section?.classList.add("d-none"));

    bexPaSetEmployeeAppraisalRegisterVisible(true);

    bexPaApplyCycleAccess();
    bexPaApplyGoalAccess();
    bexPaApplyTemplateAccess();
    bexPaApplyReportAccess();
    bexPaApplyRoleWorkspaceClarity();

    bexPaRenderCycles();
    bexPaPopulateOrganisationGoalCycles();
    bexPaRenderOrganisationGoals();
    bexPaPopulateDeliverableOrganisationGoals();
    bexPaRenderDeliverables();
    bexPaPopulateDepartmentGoalOrganisationGoals();
    bexPaRenderDepartmentGoals();
    bexPaPopulateIndividualGoalEmployees();
    bexPaPopulateIndividualGoalDepartmentGoals();
    bexPaRenderIndividualGoals();
    bexPaRenderProgressUpdates();
    bexPaRenderTemplates();
    bexPaRenderEmployeeAppraisals();

    bexPaUpdateIntegratedWorkspaceLabel();
    bexPaEnsureIntegratedWorkspaceSwitchButton();

    bexPaShowSection(
      bexPaGetRememberedSection(
        nextMode,
        bexPaGetDefaultSectionForMode(nextMode),
      ),
    );

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        `Opened ${bexPaGetWorkspaceLabelForMode(nextMode)}.`;
    }

    return true;
  }

  function bexPaShowWorkspaceChooser() {
    const availableModes = bexPaGetAvailableWorkspaceModes();
    if (availableModes.length <= 1) return;

    document.getElementById("bexPaWorkspaceChooser")?.remove();
    bexPaEnsureWorkspaceSwitcherStyles();

    const overlay = document.createElement("div");
    overlay.id = "bexPaWorkspaceChooser";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "bexPaWorkspaceChooserTitle");

    const dialog = document.createElement("section");
    dialog.className = "bex-pa-workspace-chooser-dialog";

    const header = document.createElement("div");
    header.className = "bex-pa-workspace-chooser-header";
    header.innerHTML = `
      <span class="bex-pa-workspace-chooser-icon" aria-hidden="true">
        <i class="bi bi-clipboard2-check"></i>
      </span>
      <div>
        <p class="bex-pa-workspace-chooser-kicker">Performance Appraisal</p>
        <h2 class="bex-pa-workspace-chooser-title" id="bexPaWorkspaceChooserTitle">
          Choose your appraisal workspace
        </h2>
        <p class="bex-pa-workspace-chooser-description">
          Switch between the appraisal responsibilities already available to you.
        </p>
      </div>
    `;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "bex-pa-workspace-chooser-close";
    closeButton.setAttribute("aria-label", "Close appraisal workspace chooser");
    closeButton.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    header.appendChild(closeButton);

    const grid = document.createElement("div");
    grid.className = "bex-pa-workspace-chooser-grid";
    grid.style.gridTemplateColumns =
      `repeat(${Math.min(3, availableModes.length)}, minmax(0, 1fr))`;

    const closeChooser = () => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        closeChooser();
      }
    };

    availableModes.forEach((mode) => {
      const copy = bexPaGetWorkspaceChooserCopy(mode);
      if (!copy) return;

      const button = document.createElement("button");
      const isCurrent = mode === bexPaGetActiveMode();
      button.type = "button";
      button.className =
        `bex-pa-workspace-chooser-card${isCurrent ? " is-current" : ""}`;
      button.dataset.bexPaWorkspaceMode = mode;
      button.innerHTML = `
        <span class="bex-pa-workspace-chooser-card-icon" aria-hidden="true">
          <i class="${copy.iconClass}"></i>
        </span>
        <span class="bex-pa-workspace-chooser-card-title">${copy.title}</span>
        <span class="bex-pa-workspace-chooser-card-copy">${copy.description}</span>
        <span class="bex-pa-workspace-chooser-card-action">
          ${isCurrent ? "Current workspace" : "Open workspace ↗"}
        </span>
      `;

      button.addEventListener("click", async () => {
        if (isCurrent) {
          closeChooser();
          return;
        }
        closeChooser();
        await bexPaSwitchWorkspaceMode(mode);
      });

      grid.appendChild(button);
    });

    const footer = document.createElement("div");
    footer.className = "bex-pa-workspace-chooser-footer";
    footer.innerHTML =
      '<span><i class="bi bi-shield-check me-2" aria-hidden="true"></i>Available workspaces follow your existing permissions and reporting responsibilities.</span>';

    const footerCloseButton = document.createElement("button");
    footerCloseButton.type = "button";
    footerCloseButton.className = "btn btn-outline-secondary btn-sm";
    footerCloseButton.textContent = "Close";
    footerCloseButton.addEventListener("click", closeChooser);
    footer.appendChild(footerCloseButton);

    closeButton.addEventListener("click", closeChooser);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeChooser();
    });
    document.addEventListener("keydown", handleKeydown);

    dialog.append(header, grid, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    grid.querySelector("button")?.focus({ preventScroll: true });
  }

  // BEXHR PERFORMANCE APPRAISAL ROLE CLARITY - US-05
  // Existing role permissions and next-step calculations stay authoritative.
  // This presentation layer makes each role's navigation and review workspace
  // read like the job that user is actually expected to do.
  function bexPaSetRoleNavigationLabel(button, label) {
    if (!button || !label) return;

    let labelElement = button.querySelector(
      "[data-bex-pa-role-nav-label]",
    );

    if (!labelElement) {
      Array.from(button.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.remove();
        }
      });

      labelElement = document.createElement("span");
      labelElement.dataset.bexPaRoleNavLabel = "true";
      button.appendChild(labelElement);
    }

    labelElement.textContent = label;
  }

  function bexPaGetRoleWorkspaceCopy() {
    const roleCopy = {
      employee: {
        navigationLabel: "My workspace",
        cyclesLabel: "Cycle & Deadlines",
        goalsLabel: "Goals & Progress",
        appraisalsLabel: "My Appraisal",
        headingKicker: "My review",
        headingTitle: "My Appraisal",
        headingDescription:
          "Review your appraisal status and complete only the actions currently assigned to you.",
        registerTitle: "My appraisal records",
        registerDescription:
          "Your appraisal cycles, current stage and the action currently available to you.",
      },

      "primary-manager": {
        navigationLabel: "Manager workspace",
        cyclesLabel: "Cycle & Deadlines",
        goalsLabel: "Team Goals",
        appraisalsLabel: "Manager Reviews",
        headingKicker: "Manager review",
        headingTitle: "Manager Reviews",
        headingDescription:
          "Focus on employee self-appraisals ready for manager review. Secondary-report visibility remains read-only where current permissions require it.",
        registerTitle: "Team review queue",
        registerDescription:
          "Employee appraisal status and the manager action currently available in your reporting scope.",
      },

      "hr-standard": {
        navigationLabel: "HR workspace",
        cyclesLabel: "Appraisal Cycles",
        goalsLabel: "Goals",
        appraisalsLabel: "Appraisal Review",
        headingKicker: "HR visibility",
        headingTitle: "Appraisal Review",
        headingDescription:
          "Review appraisal progress using only the permissions already assigned to your HR role.",
        registerTitle: "Appraisal review register",
        registerDescription:
          "Appraisal lifecycle status and the review actions currently available to your HR role.",
      },

      "hr-admin": {
        navigationLabel: "HR administration",
        cyclesLabel: "Appraisal Cycles",
        goalsLabel: "Goals & Deliverables",
        appraisalsLabel: "HR Appraisal Review",
        headingKicker: "HR review",
        headingTitle: "HR Appraisal Review",
        headingDescription:
          "Review appraisal progress and complete existing HR review actions without taking ownership of employee or manager work.",
        registerTitle: "HR appraisal register",
        registerDescription:
          "Employee appraisal status, review readiness and the HR action currently available.",
      },
    };

    return roleCopy[bexPaGetActiveMode()] || {
      navigationLabel: "Workspace",
      cyclesLabel: "Appraisal Cycles",
      goalsLabel: "Goals & Deliverables",
      appraisalsLabel: "Employee Appraisals",
      headingKicker: "Employee reviews",
      headingTitle: "Employee Appraisals",
      headingDescription:
        "Monitor appraisal progress and complete the actions available to your role.",
      registerTitle: "Appraisal register",
      registerDescription:
        "Employee appraisal cycles, lifecycle status and available review actions.",
    };
  }

  function bexPaApplyRoleWorkspaceClarity() {
    const copy = bexPaGetRoleWorkspaceCopy();
    const navigationHeading =
      document.getElementById(
        "bexPaPrimaryNavigation",
      )?.previousElementSibling;

    if (navigationHeading) {
      navigationHeading.textContent =
        copy.navigationLabel;
    }

    bexPaSetRoleNavigationLabel(
      bexPaElements.cyclesNavButton,
      copy.cyclesLabel,
    );
    bexPaSetRoleNavigationLabel(
      bexPaElements.goalsNavButton,
      copy.goalsLabel,
    );
    bexPaSetRoleNavigationLabel(
      bexPaElements.employeeAppraisalsNavButton,
      copy.appraisalsLabel,
    );

    const employeeAppraisalsTitle =
      document.getElementById(
        "bexPaEmployeeAppraisalsTitle",
      );
    const heading =
      employeeAppraisalsTitle?.closest(
        ".bex-pa-workspace-heading",
      );
    const headingKicker = heading?.querySelector(
      ".bex-pa-workspace-heading-kicker",
    );
    const headingDescription = heading?.querySelector(
      ".bex-pa-workspace-heading-description",
    );
    const registerTitle = document.getElementById(
      "bexPaEmployeeAppraisalsListTitle",
    );
    const registerDescription =
      registerTitle
        ?.closest(
          ".bex-pa-appraisal-register-heading",
        )
        ?.querySelector(".text-body-secondary");

    if (headingKicker) {
      headingKicker.textContent = copy.headingKicker;
    }
    if (employeeAppraisalsTitle) {
      employeeAppraisalsTitle.textContent = copy.headingTitle;
    }
    if (headingDescription) {
      headingDescription.textContent =
        copy.headingDescription;
    }
    if (registerTitle) {
      registerTitle.textContent = copy.registerTitle;
    }
    if (registerDescription) {
      registerDescription.textContent =
        copy.registerDescription;
    }

    document.body.dataset.bexPaRoleWorkspace =
      bexPaGetActiveMode() || "unknown";

    bexPaApplyFocusedGoalWorkspace();
  }


  // BEXHR PERFORMANCE APPRAISAL ROLE CLARITY - US-05 COMPLETION
  // Goals remain backed by the existing cards, dialogs, IDs, event handlers,
  // persistence and permissions. This layer only presents one role-relevant
  // goal task at a time so Employee and Manager workspaces no longer behave
  // like one long scrolling page.
  const BEX_PA_GOAL_TASK_MEMORY_KEY =
    "bexhr:performance-appraisal:goal-task:v1";

  function bexPaEnsureRoleClarityStyles() {
    if (document.getElementById("bexPaUs05RoleClarityStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "bexPaUs05RoleClarityStyles";
    style.textContent = `
      #bexPaGoalsSection .bex-pa-focused-goal-workspace {
        margin-bottom: 1rem;
      }

      #bexPaGoalsSection .bex-pa-focused-goal-switcher {
        display: grid;
        grid-template-columns: repeat(var(--bex-pa-goal-tab-count, 3), minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        margin-bottom: 16px;
        border: 1px solid #cfe0e8;
        border-radius: 16px;
        background: #f8fbfc;
      }

      #bexPaGoalsSection .bex-pa-focused-goal-tab {
        min-height: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: #475569;
        font-weight: 700;
        text-align: center;
        cursor: pointer;
      }

      #bexPaGoalsSection .bex-pa-focused-goal-tab:hover,
      #bexPaGoalsSection .bex-pa-focused-goal-tab:focus-visible {
        border-color: #a8d8dc;
        background: #ffffff;
        color: #0f6f75;
        outline: none;
      }

      #bexPaGoalsSection .bex-pa-focused-goal-tab.active {
        border-color: #7bd3d1;
        background: #ffffff;
        color: #087a80;
        box-shadow: 0 5px 14px rgba(15, 23, 42, 0.06);
      }

      #bexPaGoalsSection .bex-pa-focused-goal-panel[hidden] {
        display: none !important;
      }

      #bexPaGoalsSection .bex-pa-focused-goal-panel > .bex-pa-goal-panel {
        width: 100%;
        min-height: 0;
      }

      @media (max-width: 760px) {
        #bexPaGoalsSection .bex-pa-focused-goal-switcher {
          grid-template-columns: 1fr;
        }

        #bexPaGoalsSection .bex-pa-focused-goal-tab {
          justify-content: flex-start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function bexPaGetFocusedGoalTaskConfiguration() {
    const activeMode = bexPaGetActiveMode();

    if (activeMode === "employee") {
      return {
        headingKicker: "My goals",
        headingTitle: "Goals & Progress",
        headingDescription:
          "Review your assigned goals and submit progress updates without scrolling through organisation or manager setup work.",
        defaultKey: "individual",
        visibleKeys: ["individual", "progress"],
        labels: {
          individual: "My Goals",
          progress: "Progress Updates",
        },
      };
    }

    if (activeMode === "primary-manager") {
      return {
        headingKicker: "Team goals",
        headingTitle: "Team Goals",
        headingDescription:
          "Manage goals in your reporting scope and review employee progress one focused task at a time.",
        defaultKey: "department",
        visibleKeys: ["department", "individual", "progress"],
        labels: {
          department: "Department Goals",
          individual: "Employee Goals",
          progress: "Progress Updates",
        },
      };
    }

    if (activeMode === "hr-standard") {
      return {
        headingKicker: "Goal visibility",
        headingTitle: "Goals",
        headingDescription:
          "Review organisation, department, employee and progress information using the permissions already assigned to your HR role.",
        defaultKey: "organisation",
        visibleKeys: [
          "organisation",
          "deliverables",
          "department",
          "individual",
          "progress",
        ],
        labels: {},
      };
    }

    return {
      headingKicker: "Goal planning",
      headingTitle: "Goals & Deliverables",
      headingDescription:
        "Plan organisation priorities, translate them into department and employee goals, and track progress through the appraisal cycle.",
      defaultKey: "organisation",
      visibleKeys: [
        "organisation",
        "deliverables",
        "department",
        "individual",
        "progress",
      ],
      labels: {},
    };
  }

  function bexPaGetFocusedGoalTaskMemoryKey() {
    return `${BEX_PA_GOAL_TASK_MEMORY_KEY}:${bexPaGetActiveMode() || "unknown"}`;
  }

  function bexPaRememberFocusedGoalTask(taskKey = "") {
    const cleanTaskKey = String(taskKey || "").trim();
    if (!cleanTaskKey) return;

    try {
      window.sessionStorage.setItem(
        bexPaGetFocusedGoalTaskMemoryKey(),
        cleanTaskKey,
      );
    } catch (error) {
      console.warn(
        "Performance appraisal goal task could not be remembered.",
        error,
      );
    }
  }

  function bexPaGetRememberedFocusedGoalTask() {
    try {
      return String(
        window.sessionStorage.getItem(
          bexPaGetFocusedGoalTaskMemoryKey(),
        ) || "",
      ).trim();
    } catch (error) {
      console.warn(
        "Performance appraisal goal task could not be read.",
        error,
      );
      return "";
    }
  }

  function bexPaSetFocusedGoalTask(taskKey = "", options = {}) {
    const shell = document.getElementById("bexPaFocusedGoalWorkspace");
    if (!shell) return false;

    const config = bexPaGetFocusedGoalTaskConfiguration();
    const cleanTaskKey = String(taskKey || "").trim();

    if (!config.visibleKeys.includes(cleanTaskKey)) {
      return false;
    }

    const buttons = Array.from(
      shell.querySelectorAll("[data-bex-pa-goal-task-button]"),
    );
    const panels = Array.from(
      shell.querySelectorAll("[data-bex-pa-goal-task-panel]"),
    );

    let activeButton = null;

    buttons.forEach((button) => {
      const buttonKey = button.dataset.bexPaGoalTaskButton || "";
      const isVisible = config.visibleKeys.includes(buttonKey);
      const isActive = isVisible && buttonKey === cleanTaskKey;

      button.hidden = !isVisible;
      button.classList.toggle("d-none", !isVisible);
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");

      if (isActive) {
        activeButton = button;
      }
    });

    panels.forEach((panel) => {
      const panelKey = panel.dataset.bexPaGoalTaskPanel || "";
      const isActive = panelKey === cleanTaskKey;

      panel.hidden = !isActive;
      panel.classList.toggle("d-none", !isActive);
    });

    shell.dataset.activeGoalTask = cleanTaskKey;

    if (options.remember !== false) {
      bexPaRememberFocusedGoalTask(cleanTaskKey);
    }

    if (options.focus === true) {
      activeButton?.focus({ preventScroll: true });
    }

    return true;
  }

  function bexPaEnsureFocusedGoalWorkspace() {
    const goalsSection = bexPaElements.goalsSection;
    if (!goalsSection) return null;

    const existingShell = document.getElementById(
      "bexPaFocusedGoalWorkspace",
    );

    if (existingShell) {
      return existingShell;
    }

    const taskDefinitions = [
      {
        key: "organisation",
        label: "Organisation Goals",
        iconClass: "bi bi-building",
        list: bexPaElements.organisationGoalsList,
      },
      {
        key: "deliverables",
        label: "Deliverables",
        iconClass: "bi bi-box-seam",
        list: bexPaElements.deliverablesList,
      },
      {
        key: "department",
        label: "Department Goals",
        iconClass: "bi bi-diagram-3",
        list: bexPaElements.departmentGoalsList,
      },
      {
        key: "individual",
        label: "Individual Goals",
        iconClass: "bi bi-person-check",
        list: bexPaElements.individualGoalsList,
      },
      {
        key: "progress",
        label: "Progress Updates",
        iconClass: "bi bi-activity",
        list: bexPaElements.progressUpdatesList,
      },
    ];

    const resolvedDefinitions = taskDefinitions.map((definition) => ({
      ...definition,
      panel: definition.list?.closest(".bex-pa-goal-panel") || null,
    }));

    if (
      resolvedDefinitions.some((definition) => !definition.panel) ||
      new Set(
        resolvedDefinitions.map((definition) => definition.panel),
      ).size !== resolvedDefinitions.length
    ) {
      console.warn(
        "Performance appraisal focused goal workspace sources are incomplete.",
      );
      return null;
    }

    bexPaEnsureRoleClarityStyles();

    const heading = goalsSection.querySelector(
      ":scope > .bex-pa-goals-heading",
    );
    const shell = document.createElement("div");
    shell.id = "bexPaFocusedGoalWorkspace";
    shell.className = "bex-pa-focused-goal-workspace";

    const switcher = document.createElement("div");
    switcher.className = "bex-pa-focused-goal-switcher";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "Goal workspace sections");

    const panelHost = document.createElement("div");
    panelHost.className = "bex-pa-focused-goal-panel-host";

    shell.append(switcher, panelHost);

    if (heading?.nextSibling) {
      goalsSection.insertBefore(shell, heading.nextSibling);
    } else {
      goalsSection.appendChild(shell);
    }

    const legacyRows = new Set();

    resolvedDefinitions.forEach((definition) => {
      const formerColumn = definition.panel.closest(".col-12");
      const formerRow = formerColumn?.parentElement?.classList.contains("row")
        ? formerColumn.parentElement
        : null;

      if (formerRow) {
        legacyRows.add(formerRow);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "bex-pa-focused-goal-tab";
      button.dataset.bexPaGoalTaskButton = definition.key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      button.setAttribute("tabindex", "-1");
      button.innerHTML = `
        <i class="${definition.iconClass}" aria-hidden="true"></i>
        <span data-bex-pa-goal-task-label>${definition.label}</span>
      `;

      const panel = document.createElement("section");
      panel.className = "bex-pa-focused-goal-panel d-none";
      panel.dataset.bexPaGoalTaskPanel = definition.key;
      panel.setAttribute("role", "tabpanel");
      panel.hidden = true;

      definition.panel.classList.remove("h-100");
      panel.appendChild(definition.panel);
      switcher.appendChild(button);
      panelHost.appendChild(panel);

      button.addEventListener("click", () => {
        bexPaSetFocusedGoalTask(definition.key, {
          focus: true,
        });
      });

      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }

        event.preventDefault();

        const visibleButtons = Array.from(
          switcher.querySelectorAll("[data-bex-pa-goal-task-button]"),
        ).filter((candidate) => !candidate.hidden);
        const currentIndex = visibleButtons.indexOf(button);
        let nextIndex = currentIndex;

        if (event.key === "ArrowLeft") {
          nextIndex =
            (currentIndex - 1 + visibleButtons.length) % visibleButtons.length;
        } else if (event.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % visibleButtons.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = visibleButtons.length - 1;
        }

        const nextButton = visibleButtons[nextIndex];
        bexPaSetFocusedGoalTask(
          nextButton?.dataset.bexPaGoalTaskButton || "",
          { focus: true },
        );
      });
    });

    legacyRows.forEach((row) => {
      if (!row.querySelector(".bex-pa-goal-panel")) {
        row.remove();
      }
    });

    return shell;
  }

  function bexPaApplyFocusedGoalWorkspace() {
    const shell = bexPaEnsureFocusedGoalWorkspace();
    if (!shell) return;

    const config = bexPaGetFocusedGoalTaskConfiguration();
    const heading = bexPaElements.goalsSection?.querySelector(
      ":scope > .bex-pa-goals-heading",
    );
    const headingKicker = heading?.querySelector(
      ".bex-pa-workspace-heading-kicker",
    );
    const headingTitle = heading?.querySelector(
      ".bex-pa-workspace-heading-title",
    );
    const headingDescription = heading?.querySelector(
      ".bex-pa-workspace-heading-description",
    );

    if (headingKicker) {
      headingKicker.textContent = config.headingKicker;
    }
    if (headingTitle) {
      headingTitle.textContent = config.headingTitle;
    }
    if (headingDescription) {
      headingDescription.textContent = config.headingDescription;
    }

    const buttons = Array.from(
      shell.querySelectorAll("[data-bex-pa-goal-task-button]"),
    );

    buttons.forEach((button) => {
      const taskKey = button.dataset.bexPaGoalTaskButton || "";
      const labelElement = button.querySelector(
        "[data-bex-pa-goal-task-label]",
      );
      const fallbackLabel = {
        organisation: "Organisation Goals",
        deliverables: "Deliverables",
        department: "Department Goals",
        individual: "Individual Goals",
        progress: "Progress Updates",
      }[taskKey];

      if (labelElement) {
        labelElement.textContent =
          config.labels?.[taskKey] || fallbackLabel || taskKey;
      }
    });

    const visibleButtonCount = buttons.filter((button) =>
      config.visibleKeys.includes(
        button.dataset.bexPaGoalTaskButton || "",
      ),
    ).length;

    shell.style.setProperty(
      "--bex-pa-goal-tab-count",
      String(Math.max(1, visibleButtonCount)),
    );

    const rememberedTask = bexPaGetRememberedFocusedGoalTask();
    const nextTask = config.visibleKeys.includes(rememberedTask)
      ? rememberedTask
      : config.defaultKey;

    bexPaSetFocusedGoalTask(nextTask, {
      remember: false,
    });
  }

  function bexPaGetRememberedSelfAppraisalTask() {
    try {
      const taskKey = String(
        window.sessionStorage.getItem(
          BEX_PA_SELF_APPRAISAL_TASK_MEMORY_KEY,
        ) || "",
      ).trim();

      return ["assessment", "goals", "reflection"].includes(taskKey)
        ? taskKey
        : "assessment";
    } catch (error) {
      console.warn(
        "Performance appraisal self-appraisal task could not be read.",
        error,
      );
      return "assessment";
    }
  }

  function bexPaSetEmployeeAppraisalRegisterVisible(shouldShow = true) {
    const registerCard =
      bexPaElements.employeeAppraisalsList?.closest(
        ".bex-pa-appraisal-register-card",
      );

    registerCard?.classList.toggle("d-none", !shouldShow);
  }

  // BEXHR MANAGER APPRAISAL FOCUS - US-07 QA CORRECTION
  // A manager may have several employee appraisals, so the register remains the
  // selection surface. Once one appraisal is opened, replace the queue with one
  // focused review flow instead of stacking the detail underneath the register.
  function bexPaEnsureManagerAppraisalClarityStyles() {
    if (document.getElementById("bexPaManagerAppraisalClarityStyles")) return;

    const style = document.createElement("style");
    style.id = "bexPaManagerAppraisalClarityStyles";
    style.textContent = `
      #bexPaManagerAppraisalSection .bex-pa-manager-review-shell {
        margin-bottom: 18px;
      }

      #bexPaManagerAppraisalSection .bex-pa-manager-review-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      #bexPaManagerAppraisalSection .bex-pa-manager-review-switcher {
        flex: 1 1 620px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        border: 1px solid #cfe0e8;
        border-radius: 16px;
        background: #f8fbfc;
      }

      #bexPaManagerAppraisalSection .bex-pa-manager-review-tab {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: #475569;
        font-weight: 700;
        text-align: center;
        cursor: pointer;
      }

      #bexPaManagerAppraisalSection .bex-pa-manager-review-tab:hover,
      #bexPaManagerAppraisalSection .bex-pa-manager-review-tab:focus-visible,
      #bexPaManagerAppraisalSection .bex-pa-manager-review-tab.active {
        border-color: #7bd3d1;
        background: #ffffff;
        color: #087a80;
        outline: none;
      }

      #bexPaManagerAppraisalSection .bex-pa-manager-review-panel {
        min-width: 0;
      }

      @media (max-width: 767.98px) {
        #bexPaManagerAppraisalSection .bex-pa-manager-review-switcher {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function bexPaSetManagerReviewTask(taskKey, options = {}) {
    const section = bexPaElements.managerAppraisalSection;
    if (!section) return false;

    const normalizedTask = ["employee", "goals", "summary"].includes(taskKey)
      ? taskKey
      : "employee";

    section
      .querySelectorAll("[data-bex-pa-manager-review-task]")
      .forEach((button) => {
        const isActive =
          button.dataset.bexPaManagerReviewTask === normalizedTask;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.setAttribute("tabindex", isActive ? "0" : "-1");
      });

    section
      .querySelectorAll("[data-bex-pa-manager-review-panel]")
      .forEach((panel) => {
        const isActive =
          panel.dataset.bexPaManagerReviewPanel === normalizedTask;
        panel.classList.toggle("d-none", !isActive);
        panel.hidden = !isActive;
      });

    section.dataset.bexPaManagerReviewTask = normalizedTask;

    try {
      window.sessionStorage.setItem(
        BEX_PA_MANAGER_REVIEW_TASK_MEMORY_KEY,
        normalizedTask,
      );
    } catch (error) {
      console.warn(
        "Performance appraisal manager review task could not be remembered.",
        error,
      );
    }

    if (options.focus === true) {
      section
        .querySelector(
          `[data-bex-pa-manager-review-task="${normalizedTask}"]`,
        )
        ?.focus({ preventScroll: true });
    }

    return true;
  }

  function bexPaApplyManagerAppraisalClarity(appraisal) {
    if (!appraisal?.id) return;

    const section = bexPaElements.managerAppraisalSection;
    const form = bexPaElements.managerAppraisalForm;
    const selfAppraisalContent =
      bexPaElements.managerAppraisalSelfAppraisal;
    const goals = bexPaElements.managerAppraisalGoals;
    const summaryField = bexPaElements.managerAppraisalOverallComment;

    if (!section || !form || !selfAppraisalContent || !goals || !summaryField) {
      return;
    }

    bexPaEnsureManagerAppraisalClarityStyles();

    let shell = form.querySelector(".bex-pa-manager-review-shell");
    if (!shell) {
      const selfDetails = selfAppraisalContent.closest("details");
      const goalsIntro = goals.previousElementSibling;
      const summaryBlock = summaryField.closest(".mt-4.border-top.pt-4");
      const actionRow =
        bexPaElements.saveManagerAppraisalButton?.parentElement ||
        bexPaElements.submitManagerAppraisalButton?.parentElement ||
        bexPaElements.closeManagerAppraisalButton?.parentElement;

      if (!selfDetails || !goalsIntro || !summaryBlock || !actionRow) {
        return;
      }

      shell = document.createElement("div");
      shell.className = "bex-pa-manager-review-shell";

      const toolbar = document.createElement("div");
      toolbar.className = "bex-pa-manager-review-toolbar";

      const switcher = document.createElement("div");
      switcher.className = "bex-pa-manager-review-switcher";
      switcher.setAttribute("role", "tablist");
      switcher.setAttribute("aria-label", "Manager appraisal review sections");

      [
        ["employee", "Employee Self-Appraisal", "bi bi-person-check"],
        ["goals", "Goals & Ratings", "bi bi-bullseye"],
        ["summary", "Summary & Submit", "bi bi-chat-square-text"],
      ].forEach(([key, label, iconClass]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bex-pa-manager-review-tab";
        button.dataset.bexPaManagerReviewTask = key;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.setAttribute("tabindex", "-1");
        button.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span>${label}</span>`;
        button.addEventListener("click", () => {
          bexPaSetManagerReviewTask(key, { focus: true });
        });
        switcher.appendChild(button);
      });

      toolbar.appendChild(switcher);

      const topActions = document.createElement("div");
      topActions.className = "d-flex align-items-center gap-2 flex-wrap";
      if (bexPaElements.closeManagerAppraisalButton) {
        bexPaElements.closeManagerAppraisalButton.innerHTML =
          '<i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to Review Queue';
        topActions.appendChild(bexPaElements.closeManagerAppraisalButton);
      }
      toolbar.appendChild(topActions);

      const panelHost = document.createElement("div");
      panelHost.className = "bex-pa-manager-review-panel-host";

      const employeePanel = document.createElement("section");
      employeePanel.className = "bex-pa-manager-review-panel d-none";
      employeePanel.dataset.bexPaManagerReviewPanel = "employee";
      employeePanel.hidden = true;
      // BEXHR MANAGER APPRAISAL FOCUS - US-07 DISCLOSURE CLEANUP
      // Employee Self-Appraisal is already a dedicated focused tab. Move the
      // existing content out of the legacy <details> disclosure so the selected
      // tab opens immediately and does not present a second play/expand control.
      selfAppraisalContent.classList.remove("pt-3");
      employeePanel.appendChild(selfAppraisalContent);
      selfDetails.remove();

      const goalsPanel = document.createElement("section");
      goalsPanel.className = "bex-pa-manager-review-panel d-none";
      goalsPanel.dataset.bexPaManagerReviewPanel = "goals";
      goalsPanel.hidden = true;
      goalsPanel.append(goalsIntro, goals);

      const summaryPanel = document.createElement("section");
      summaryPanel.className = "bex-pa-manager-review-panel d-none";
      summaryPanel.dataset.bexPaManagerReviewPanel = "summary";
      summaryPanel.hidden = true;
      summaryPanel.append(summaryBlock, actionRow);

      panelHost.append(employeePanel, goalsPanel, summaryPanel);
      shell.append(toolbar, panelHost);
      form.prepend(shell);
    }

    const previousAppraisalId =
      section.dataset.bexPaManagerReviewAppraisalId || "";
    const isSameAppraisal =
      previousAppraisalId === String(appraisal.id);
    section.dataset.bexPaManagerReviewAppraisalId = String(appraisal.id);

    let task = isSameAppraisal
      ? section.dataset.bexPaManagerReviewTask || ""
      : "";

    if (!task) {
      try {
        const rememberedTask = window.sessionStorage.getItem(
          BEX_PA_MANAGER_REVIEW_TASK_MEMORY_KEY,
        );
        if (["employee", "goals", "summary"].includes(rememberedTask)) {
          task = rememberedTask;
        }
      } catch (error) {
        console.warn(
          "Performance appraisal manager review task could not be restored.",
          error,
        );
      }
    }

    if (!isSameAppraisal || !task) {
      task = "employee";
    }

    bexPaSetManagerReviewTask(task);
  }

  // BEXHR HR FINALISATION CLARITY - US-07
  // HR review is one focused workspace once an appraisal is selected.
  // Existing review content and the existing Finalise button are moved/presented
  // in one-at-a-time panels; IDs, handlers, permission checks, and persistence
  // remain unchanged.
  function bexPaEnsureHrFinalisationClarityStyles() {
    if (document.getElementById("bexPaUs07HrFinalisationStyles")) return;

    const style = document.createElement("style");
    style.id = "bexPaUs07HrFinalisationStyles";
    style.textContent = `
      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-shell {
        margin-bottom: 18px;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-switcher {
        flex: 1 1 620px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        border: 1px solid #cfe0e8;
        border-radius: 16px;
        background: #f8fbfc;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-tab {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: #475569;
        font-weight: 700;
        text-align: center;
        cursor: pointer;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-tab:hover,
      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-tab:focus-visible,
      #bexPaHrAppraisalReviewSection .bex-pa-hr-review-tab.active {
        border-color: #7bd3d1;
        background: #ffffff;
        color: #087a80;
        outline: none;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-panel {
        padding: clamp(16px, 2.5vw, 24px);
        border: 1px solid #d7e4ea;
        border-radius: 18px;
        background: linear-gradient(135deg, #f8fbfc 0%, #ffffff 100%);
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-status-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 16px 0;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-status-item {
        padding: 14px;
        border: 1px solid #dbe4ee;
        border-radius: 14px;
        background: #ffffff;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-status-label {
        display: block;
        margin-bottom: 4px;
        color: #64748b;
        font-size: .72rem;
        font-weight: 800;
        letter-spacing: .05em;
        text-transform: uppercase;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-status-value {
        color: #0f172a;
        font-weight: 800;
      }

      #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }

      @media (max-width: 760px) {
        #bexPaHrAppraisalReviewSection .bex-pa-hr-review-switcher,
        #bexPaHrAppraisalReviewSection .bex-pa-hr-finalisation-status-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function bexPaGetHrReviewDefaultTask(appraisal) {
    const selfAppraisal = bexPaState.selfAppraisals.find(
      (item) => item.appraisalId === appraisal?.id,
    );
    const managerAppraisal = bexPaState.managerAppraisals.find(
      (item) => item.appraisalId === appraisal?.id,
    );
    const hrFinalisation = bexPaState.hrFinalisations.find(
      (item) => item.appraisalId === appraisal?.id,
    );

    if (hrFinalisation?.status === "Finalised") {
      return "finalisation";
    }

    if (selfAppraisal?.status !== "Submitted") {
      return "employee";
    }

    if (managerAppraisal?.status !== "Submitted") {
      return "manager";
    }

    return "finalisation";
  }

  function bexPaSetHrReviewTask(taskKey = "", options = {}) {
    const section = bexPaElements.hrAppraisalReviewSection;
    if (!section) return false;

    const normalizedTask = ["employee", "manager", "finalisation"].includes(taskKey)
      ? taskKey
      : "employee";

    section
      .querySelectorAll("[data-bex-pa-hr-review-task]")
      .forEach((button) => {
        const isActive = button.dataset.bexPaHrReviewTask === normalizedTask;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.setAttribute("tabindex", isActive ? "0" : "-1");
      });

    bexPaElements.hrAppraisalReviewEmployee?.classList.toggle(
      "d-none",
      normalizedTask !== "employee",
    );
    bexPaElements.hrAppraisalReviewManager?.classList.toggle(
      "d-none",
      normalizedTask !== "manager",
    );

    const finalisationPanel = document.getElementById(
      "bexPaHrFinalisationFocusPanel",
    );
    finalisationPanel?.classList.toggle(
      "d-none",
      normalizedTask !== "finalisation",
    );

    bexPaElements.hrAppraisalReviewPrerequisites?.classList.toggle(
      "d-none",
      normalizedTask !== "finalisation",
    );

    const canFinalise = section.dataset.bexPaHrCanFinalise === "true";
    const isFinalised = section.dataset.bexPaHrIsFinalised === "true";
    bexPaElements.finaliseHrAppraisalButton?.classList.toggle(
      "d-none",
      normalizedTask !== "finalisation" || !canFinalise || isFinalised,
    );

    section.dataset.bexPaHrReviewTask = normalizedTask;

    try {
      window.sessionStorage.setItem(
        BEX_PA_HR_REVIEW_TASK_MEMORY_KEY,
        normalizedTask,
      );
    } catch (error) {
      console.warn(
        "Performance appraisal HR review task could not be remembered.",
        error,
      );
    }

    if (options.focus === true) {
      section
        .querySelector(
          `[data-bex-pa-hr-review-task="${normalizedTask}"]`,
        )
        ?.focus({ preventScroll: true });
    }

    return true;
  }

  function bexPaApplyHrFinalisationClarity(appraisal) {
    if (!bexPaIsHrAdminMode() || !appraisal?.id) return;

    const section = bexPaElements.hrAppraisalReviewSection;
    const employeePanel = bexPaElements.hrAppraisalReviewEmployee;
    const managerPanel = bexPaElements.hrAppraisalReviewManager;
    if (!section || !employeePanel || !managerPanel) return;

    bexPaEnsureHrFinalisationClarityStyles();

    let shell = section.querySelector(".bex-pa-hr-review-shell");
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "bex-pa-hr-review-shell";

      const toolbar = document.createElement("div");
      toolbar.className = "bex-pa-hr-review-toolbar";

      const switcher = document.createElement("div");
      switcher.className = "bex-pa-hr-review-switcher";
      switcher.setAttribute("role", "tablist");
      switcher.setAttribute("aria-label", "HR appraisal review sections");

      [
        ["employee", "Employee Self-Appraisal", "bi bi-person-check"],
        ["manager", "Manager Appraisal", "bi bi-people"],
        ["finalisation", "Finalisation", "bi bi-shield-check"],
      ].forEach(([key, label, iconClass]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bex-pa-hr-review-tab";
        button.dataset.bexPaHrReviewTask = key;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.setAttribute("tabindex", "-1");
        button.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span>${label}</span>`;
        button.addEventListener("click", () => {
          bexPaSetHrReviewTask(key, { focus: true });
        });
        switcher.appendChild(button);
      });

      toolbar.appendChild(switcher);

      const topActions = document.createElement("div");
      topActions.className = "d-flex align-items-center gap-2 flex-wrap";
      toolbar.appendChild(topActions);

      if (bexPaElements.closeHrAppraisalReviewButton) {
        bexPaElements.closeHrAppraisalReviewButton.innerHTML =
          '<i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to Appraisal Register';
        topActions.appendChild(bexPaElements.closeHrAppraisalReviewButton);
      }

      const finalisationPanel = document.createElement("section");
      finalisationPanel.id = "bexPaHrFinalisationFocusPanel";
      finalisationPanel.className = "bex-pa-hr-finalisation-panel d-none";
      finalisationPanel.innerHTML = `
        <div>
          <div id="bexPaHrFinalisationEyebrow" class="small fw-bold text-uppercase text-secondary mb-1">Finalisation readiness</div>
          <h3 id="bexPaHrFinalisationHeading" class="h5 fw-bold mb-1">Confirm both submitted reviews before finalising</h3>
          <p id="bexPaHrFinalisationSummary" class="text-body-secondary mb-0"></p>
        </div>
        <div class="bex-pa-hr-finalisation-status-grid" aria-label="Appraisal finalisation status">
          <div class="bex-pa-hr-finalisation-status-item">
            <span class="bex-pa-hr-finalisation-status-label">Employee</span>
            <span id="bexPaHrFinalisationEmployeeStatus" class="bex-pa-hr-finalisation-status-value"></span>
          </div>
          <div class="bex-pa-hr-finalisation-status-item">
            <span class="bex-pa-hr-finalisation-status-label">Manager</span>
            <span id="bexPaHrFinalisationManagerStatus" class="bex-pa-hr-finalisation-status-value"></span>
          </div>
          <div class="bex-pa-hr-finalisation-status-item">
            <span class="bex-pa-hr-finalisation-status-label">HR</span>
            <span id="bexPaHrFinalisationHrStatus" class="bex-pa-hr-finalisation-status-value"></span>
          </div>
        </div>
        <div id="bexPaHrFinalisationActions" class="bex-pa-hr-finalisation-actions"></div>
      `;

      const finalisationStatusGrid = finalisationPanel.querySelector(
        ".bex-pa-hr-finalisation-status-grid",
      );
      if (
        finalisationStatusGrid &&
        bexPaElements.hrAppraisalReviewPrerequisites
      ) {
        finalisationPanel.insertBefore(
          bexPaElements.hrAppraisalReviewPrerequisites,
          finalisationStatusGrid,
        );
      }

      shell.append(toolbar, finalisationPanel);
      employeePanel.parentElement?.insertBefore(shell, employeePanel);

      const finalisationActions = finalisationPanel.querySelector(
        "#bexPaHrFinalisationActions",
      );
      if (finalisationActions && bexPaElements.finaliseHrAppraisalButton) {
        finalisationActions.appendChild(bexPaElements.finaliseHrAppraisalButton);
      }
    }

    const selfAppraisal = bexPaState.selfAppraisals.find(
      (item) => item.appraisalId === appraisal.id,
    );
    const managerAppraisal = bexPaState.managerAppraisals.find(
      (item) => item.appraisalId === appraisal.id,
    );
    const hrFinalisation = bexPaState.hrFinalisations.find(
      (item) => item.appraisalId === appraisal.id,
    );

    const selfSubmitted = selfAppraisal?.status === "Submitted";
    const managerSubmitted = managerAppraisal?.status === "Submitted";
    const isFinalised = hrFinalisation?.status === "Finalised";
    const canFinalise = selfSubmitted && managerSubmitted && !isFinalised;

    section.dataset.bexPaHrCanFinalise = String(canFinalise);
    section.dataset.bexPaHrIsFinalised = String(isFinalised);

    const employeeStatus = document.getElementById(
      "bexPaHrFinalisationEmployeeStatus",
    );
    const managerStatus = document.getElementById(
      "bexPaHrFinalisationManagerStatus",
    );
    const hrStatus = document.getElementById(
      "bexPaHrFinalisationHrStatus",
    );
    const summary = document.getElementById(
      "bexPaHrFinalisationSummary",
    );
    const finalisationEyebrow = document.getElementById(
      "bexPaHrFinalisationEyebrow",
    );
    const finalisationHeading = document.getElementById(
      "bexPaHrFinalisationHeading",
    );

    if (finalisationEyebrow) {
      finalisationEyebrow.textContent = isFinalised
        ? "Finalisation complete"
        : "Finalisation readiness";
    }
    if (finalisationHeading) {
      finalisationHeading.textContent = isFinalised
        ? "Appraisal finalised"
        : "Confirm both submitted reviews before finalising";
    }

    if (employeeStatus) {
      employeeStatus.textContent = selfSubmitted ? "Submitted" : "Pending";
    }
    if (managerStatus) {
      managerStatus.textContent = managerSubmitted ? "Submitted" : "Pending";
    }
    if (hrStatus) {
      hrStatus.textContent = isFinalised
        ? "Finalised"
        : canFinalise
          ? "Ready to finalise"
          : "Waiting";
    }
    if (summary) {
      summary.textContent = isFinalised
        ? "This appraisal is finalised. Employee acknowledgement is the next stage."
        : canFinalise
          ? "Employee and Manager appraisals are submitted. Review both sections, then use the existing Finalise Appraisal action."
          : "Finalisation remains locked until both Employee and Manager appraisals are submitted.";
    }

    const previousAppraisalId = section.dataset.bexPaHrReviewAppraisalId || "";
    const isSameAppraisal = previousAppraisalId === String(appraisal.id);
    section.dataset.bexPaHrReviewAppraisalId = String(appraisal.id);

    let task = isSameAppraisal
      ? section.dataset.bexPaHrReviewTask || ""
      : "";

    if (!task) {
      try {
        const rememberedTask = window.sessionStorage.getItem(
          BEX_PA_HR_REVIEW_TASK_MEMORY_KEY,
        );
        if (["employee", "manager", "finalisation"].includes(rememberedTask)) {
          task = rememberedTask;
        }
      } catch (error) {
        console.warn(
          "Performance appraisal HR review task could not be restored.",
          error,
        );
      }
    }

    if (!isSameAppraisal || !task) {
      task = bexPaGetHrReviewDefaultTask(appraisal);
    }

    bexPaSetHrReviewTask(task);
  }

  function bexPaGetDirectEmployeeAppraisal() {
    if (!bexPaIsEmployeeMode()) return null;

    const eligibleAppraisals = bexPaGetEligibleEmployeeAppraisals();
    return eligibleAppraisals.length === 1
      ? eligibleAppraisals[0]
      : null;
  }

  // BEXHR EMPLOYEE APPRAISAL CLARITY - US-06
  // Reuse the existing self-appraisal fields and form submission path, but
  // present them as three focused employee sections instead of one long form.
  function bexPaEnsureEmployeeAppraisalClarityStyles() {
    if (document.getElementById("bexPaUs06EmployeeAppraisalStyles")) return;

    const style = document.createElement("style");
    style.id = "bexPaUs06EmployeeAppraisalStyles";
    style.textContent = `
      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-switcher {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        margin-bottom: 16px;
        border: 1px solid #cfe0e8;
        border-radius: 16px;
        background: #f8fbfc;
      }

      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-tab {
        min-height: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: #475569;
        font-weight: 700;
        text-align: center;
        cursor: pointer;
      }

      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-tab:hover,
      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-tab:focus-visible,
      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-tab.active {
        border-color: #7bd3d1;
        background: #ffffff;
        color: #087a80;
        outline: none;
      }

      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-panel {
        padding: 18px;
        border: 1px solid #dbe7ec;
        border-radius: 16px;
        background: #ffffff;
      }

      #bexPaSelfAppraisalSection .bex-pa-self-appraisal-panel[hidden] {
        display: none !important;
      }

      @media (max-width: 760px) {
        #bexPaSelfAppraisalSection .bex-pa-self-appraisal-switcher {
          grid-template-columns: 1fr;
        }
        #bexPaSelfAppraisalSection .bex-pa-self-appraisal-tab {
          justify-content: flex-start;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function bexPaSetFocusedSelfAppraisalTask(taskKey = "", options = {}) {
    const shell = document.getElementById("bexPaFocusedSelfAppraisalWorkspace");
    const cleanTaskKey = String(taskKey || "").trim();
    if (!shell || !["assessment", "goals", "reflection"].includes(cleanTaskKey)) {
      return false;
    }

    shell
      .querySelectorAll("[data-bex-pa-self-appraisal-task-button]")
      .forEach((button) => {
        const isActive =
          button.dataset.bexPaSelfAppraisalTaskButton === cleanTaskKey;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });

    shell
      .querySelectorAll("[data-bex-pa-self-appraisal-task-panel]")
      .forEach((panel) => {
        const isActive =
          panel.dataset.bexPaSelfAppraisalTaskPanel === cleanTaskKey;
        panel.hidden = !isActive;
        panel.classList.toggle("d-none", !isActive);
      });

    if (options.remember !== false) {
      try {
        window.sessionStorage.setItem(
          BEX_PA_SELF_APPRAISAL_TASK_MEMORY_KEY,
          cleanTaskKey,
        );
      } catch (error) {
        console.warn(
          "Performance appraisal self-appraisal task could not be remembered.",
          error,
        );
      }
    }

    return true;
  }

  function bexPaEnsureFocusedSelfAppraisalWorkspace() {
    const form = bexPaElements.selfAppraisalForm;
    const competencies = bexPaElements.selfAppraisalCompetencies;
    const goals = bexPaElements.selfAppraisalGoals;
    const reflectionRow =
      bexPaElements.selfAppraisalAchievement?.closest(".row");

    if (!form || !competencies || !goals || !reflectionRow) return null;

    const existingShell = document.getElementById(
      "bexPaFocusedSelfAppraisalWorkspace",
    );
    if (existingShell) return existingShell;

    bexPaEnsureEmployeeAppraisalClarityStyles();

    const shell = document.createElement("div");
    shell.id = "bexPaFocusedSelfAppraisalWorkspace";

    const switcher = document.createElement("div");
    switcher.className = "bex-pa-self-appraisal-switcher";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "Self-appraisal sections");

    const panelHost = document.createElement("div");

    shell.append(switcher, panelHost);
    form.insertBefore(shell, competencies);

    [
      ["assessment", "Assessment Areas", "bi bi-ui-checks-grid", competencies],
      ["goals", "Goals & Achievements", "bi bi-bullseye", goals],
      ["reflection", "Reflection & Summary", "bi bi-chat-square-text", reflectionRow],
    ].forEach(([key, label, iconClass, node]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bex-pa-self-appraisal-tab";
      button.dataset.bexPaSelfAppraisalTaskButton = key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      button.innerHTML = `
        <i class="${iconClass}" aria-hidden="true"></i>
        <span>${label}</span>
      `;

      const panel = document.createElement("section");
      panel.className = "bex-pa-self-appraisal-panel d-none";
      panel.dataset.bexPaSelfAppraisalTaskPanel = key;
      panel.setAttribute("role", "tabpanel");
      panel.hidden = true;
      panel.appendChild(node);

      button.addEventListener("click", () => {
        bexPaSetFocusedSelfAppraisalTask(key);
      });

      switcher.appendChild(button);
      panelHost.appendChild(panel);
    });

    return shell;
  }

  function bexPaApplyEmployeeSelfAppraisalClarity() {
    if (!bexPaIsEmployeeMode()) return;

    const shell = bexPaEnsureFocusedSelfAppraisalWorkspace();
    if (!shell) return;

    const sectionDescription =
      bexPaElements.selfAppraisalSection?.querySelector(
        "#bexPaSelfAppraisalMeta + p",
      );
    if (sectionDescription) {
      sectionDescription.textContent =
        "Work through Assessment Areas, Goals & Achievements, then Reflection & Summary before submitting your appraisal.";
    }

    const summaryLabel = document.querySelector(
      'label[for="bexPaSelfAppraisalAchievement"]',
    );
    const summaryHelp = summaryLabel?.nextElementSibling;

    if (summaryLabel) {
      summaryLabel.textContent =
        "Achievements, challenges & suggestions";
    }
    if (summaryHelp?.matches("p")) {
      summaryHelp.textContent =
        "Summarise your key achievements, challenges encountered, and suggestions or development needs for the next review period.";
    }
    if (bexPaElements.selfAppraisalAchievement) {
      bexPaElements.selfAppraisalAchievement.placeholder =
        "Summarise achievements, challenges, and suggestions or development needs.";
    }

    bexPaSetFocusedSelfAppraisalTask(
      bexPaGetRememberedSelfAppraisalTask(),
      { remember: false },
    );
  }

  const bexPaElements = {
    overviewSection: document.getElementById("bexPaOverviewSection"),
    cyclesSection: document.getElementById("bexPaCyclesSection"),
    goalsSection: document.getElementById("bexPaGoalsSection"),
    templatesSection: document.getElementById("bexPaTemplatesSection"),
    employeeAppraisalsSection: document.getElementById(
      "bexPaEmployeeAppraisalsSection",
    ),
    reportsSection: document.getElementById(
      "bexPaReportsSection",
    ),
    reportCycleSelect: document.getElementById(
      "bexPaReportCycleSelect",
    ),
    reportPrintButton: document.getElementById(
      "bexPaPrintReportButton",
    ),
    reportPrintCycleName: document.getElementById(
      "bexPaReportPrintCycleName",
    ),
    reportPrintCyclePeriod: document.getElementById(
      "bexPaReportPrintCyclePeriod",
    ),
    reportPrintGeneratedAt: document.getElementById(
      "bexPaReportPrintGeneratedAt",
    ),
    reportCycleSummary: document.getElementById(
      "bexPaReportCycleSummary",
    ),
    operationalReportContent: document.getElementById(
      "bexPaOperationalReportContent",
    ),
    operationalReportEmpty: document.getElementById(
      "bexPaOperationalReportEmpty",
    ),
    reportAssignedCount: document.getElementById(
      "bexPaReportAssignedCount",
    ),
    reportInProgressCount: document.getElementById(
      "bexPaReportInProgressCount",
    ),
    reportSubmittedCount: document.getElementById(
      "bexPaReportSubmittedCount",
    ),
    reportFinalisedCount: document.getElementById(
      "bexPaReportFinalisedCount",
    ),
    reportAcknowledgedCount: document.getElementById(
      "bexPaReportAcknowledgedCount",
    ),
    reportTotalCount: document.getElementById(
      "bexPaReportTotalCount",
    ),
    reportCompletionSummary: document.getElementById(
      "bexPaReportCompletionSummary",
    ),
    reportCompletionPercentage: document.getElementById(
      "bexPaReportCompletionPercentage",
    ),
    reportCompletionProgress: document.getElementById(
      "bexPaReportCompletionProgress",
    ),
    reportCompletionBar: document.getElementById(
      "bexPaReportCompletionBar",
    ),
    reportOutstandingSummary: document.getElementById(
      "bexPaReportOutstandingSummary",
    ),
    reportStatusDetail: document.getElementById(
      "bexPaReportStatusDetail",
    ),
    employeeAppraisalsList: document.getElementById(
      "bexPaEmployeeAppraisalsList",
    ),
    employeeAppraisalsEmpty: document.getElementById(
      "bexPaEmployeeAppraisalsEmpty",
    ),
    selfAppraisalSection: document.getElementById(
      "bexPaSelfAppraisalSection",
    ),
    hrAppraisalReviewSection: document.getElementById(
      "bexPaHrAppraisalReviewSection",
    ),
    hrAppraisalReviewTitle: document.getElementById(
      "bexPaHrAppraisalReviewTitle",
    ),
    hrAppraisalReviewMeta: document.getElementById(
      "bexPaHrAppraisalReviewMeta",
    ),
    hrAppraisalReviewPrerequisites: document.getElementById(
      "bexPaHrAppraisalReviewPrerequisites",
    ),
    hrAppraisalReviewEmployee: document.getElementById(
      "bexPaHrAppraisalReviewEmployee",
    ),
    hrAppraisalReviewManager: document.getElementById(
      "bexPaHrAppraisalReviewManager",
    ),
    closeHrAppraisalReviewButton: document.getElementById(
      "bexPaCloseHrAppraisalReviewButton",
    ),
    finaliseHrAppraisalButton: document.getElementById(
      "bexPaFinaliseHrAppraisalButton",
    ),
    finalAppraisalSection: document.getElementById(
      "bexPaFinalAppraisalSection",
    ),
    finalAppraisalTitle: document.getElementById(
      "bexPaFinalAppraisalTitle",
    ),
    finalAppraisalMeta: document.getElementById(
      "bexPaFinalAppraisalMeta",
    ),
    finalAppraisalEmployee: document.getElementById(
      "bexPaFinalAppraisalEmployee",
    ),
    finalAppraisalManager: document.getElementById(
      "bexPaFinalAppraisalManager",
    ),
    finalAppraisalAcknowledgement: document.getElementById(
      "bexPaFinalAppraisalAcknowledgement",
    ),
    closeFinalAppraisalButton: document.getElementById(
      "bexPaCloseFinalAppraisalButton",
    ),
    acknowledgeFinalAppraisalButton: document.getElementById(
      "bexPaAcknowledgeFinalAppraisalButton",
    ),
    managerAppraisalSection: document.getElementById(
      "bexPaManagerAppraisalSection",
    ),
    managerAppraisalTitle: document.getElementById(
      "bexPaManagerAppraisalTitle",
    ),
    managerAppraisalMeta: document.getElementById(
      "bexPaManagerAppraisalMeta",
    ),
    managerAppraisalForm: document.getElementById(
      "bexPaManagerAppraisalForm",
    ),
    managerAppraisalError: document.getElementById(
      "bexPaManagerAppraisalError",
    ),
    managerAppraisalSelfAppraisal: document.getElementById(
      "bexPaManagerAppraisalSelfAppraisal",
    ),
    managerAppraisalGoals: document.getElementById(
      "bexPaManagerAppraisalGoals",
    ),
    managerAppraisalOverallComment: document.getElementById(
      "bexPaManagerAppraisalOverallComment",
    ),
    closeManagerAppraisalButton: document.getElementById(
      "bexPaCloseManagerAppraisalButton",
    ),
    saveManagerAppraisalButton: document.getElementById(
      "bexPaSaveManagerAppraisalButton",
    ),
    submitManagerAppraisalButton: document.getElementById(
      "bexPaSubmitManagerAppraisalButton",
    ),
    selfAppraisalMeta: document.getElementById(
      "bexPaSelfAppraisalMeta",
    ),
    selfAppraisalForm: document.getElementById(
      "bexPaSelfAppraisalForm",
    ),
    selfAppraisalError: document.getElementById(
      "bexPaSelfAppraisalError",
    ),
    selfAppraisalCompetencies: document.getElementById(
      "bexPaSelfAppraisalCompetencies",
    ),
    selfAppraisalGoals: document.getElementById(
      "bexPaSelfAppraisalGoals",
    ),
    selfAppraisalAchievement: document.getElementById(
      "bexPaSelfAppraisalAchievement",
    ),
    closeSelfAppraisalButton: document.getElementById(
      "bexPaCloseSelfAppraisalButton",
    ),
    saveSelfAppraisalButton: document.getElementById(
      "bexPaSaveSelfAppraisalButton",
    ),
    submitSelfAppraisalButton: document.getElementById(
      "bexPaSubmitSelfAppraisalButton",
    ),
    developmentPersona: document.getElementById(
      "bexPaDevelopmentPersona",
    ),

    integratedToolbar: document.getElementById(
      "bexPaIntegratedToolbar",
    ),

    backToDashboardLink: document.getElementById(
      "bexPaBackToDashboardLink",
    ),

    backToDashboardLabel: document.getElementById(
      "bexPaBackToDashboardLabel",
    ),

    integratedWorkspaceLabel: document.getElementById(
      "bexPaIntegratedWorkspaceLabel",
    ),

    overviewNavLink: document.querySelector(
      '#bexPaPrimaryNavigation a[href="#bexPaOverviewSection"]',
    ),
    cyclesNavButton: document.getElementById("bexPaCyclesNavButton"),
    goalsNavButton: document.getElementById("bexPaGoalsNavButton"),
    templatesNavButton: document.getElementById("bexPaTemplatesNavButton"),
    employeeAppraisalsNavButton: document.getElementById(
      "bexPaEmployeeAppraisalsNavButton",
    ),
    reportsNavButton: document.getElementById(
      "bexPaReportsNavButton",
    ),
    createTemplateButton: document.getElementById(
      "bexPaCreateTemplateButton",
    ),
    templatesList: document.getElementById(
      "bexPaTemplatesList",
    ),
    templateDialog: document.getElementById(
      "bexPaTemplateDialog",
    ),
    templateForm: document.getElementById(
      "bexPaTemplateForm",
    ),
    templateDialogTitle: document.getElementById(
      "bexPaTemplateDialogTitle",
    ),
    templateFormError: document.getElementById(
      "bexPaTemplateFormError",
    ),
    closeTemplateDialogButton: document.getElementById(
      "bexPaCloseTemplateDialogButton",
    ),
    cancelTemplateButton: document.getElementById(
      "bexPaCancelTemplateButton",
    ),
    templateSubmitButton: document.getElementById(
      "bexPaTemplateSubmitButton",
    ),
    templateInUseWarning: document.getElementById(
      "bexPaTemplateInUseWarning",
    ),
    templateName: document.getElementById(
      "bexPaTemplateName",
    ),
    templateDescription: document.getElementById(
      "bexPaTemplateDescription",
    ),
    templateStatus: document.getElementById(
      "bexPaTemplateStatus",
    ),
    templateRatingScale: document.getElementById(
      "bexPaTemplateRatingScale",
    ),
    addTemplateRatingButton: document.getElementById(
      "bexPaAddTemplateRatingButton",
    ),
    templateRatingsList: document.getElementById(
      "bexPaTemplateRatingsList",
    ),
    templateRatingsEmpty: document.getElementById(
      "bexPaTemplateRatingsEmpty",
    ),
    addTemplateCompetencyButton: document.getElementById(
      "bexPaAddTemplateCompetencyButton",
    ),
    templateCompetenciesList: document.getElementById(
      "bexPaTemplateCompetenciesList",
    ),
    templateCompetenciesEmpty: document.getElementById(
      "bexPaTemplateCompetenciesEmpty",
    ),
    templateCompetencyEditor: document.getElementById(
      "bexPaTemplateCompetencyEditor",
    ),
    templateCompetencyName: document.getElementById(
      "bexPaTemplateCompetencyName",
    ),
    templateCompetencyDescription: document.getElementById(
      "bexPaTemplateCompetencyDescription",
    ),
    templateCompetencyApplicability: document.getElementById(
      "bexPaTemplateCompetencyApplicability",
    ),
    templateCompetencyOrder: document.getElementById(
      "bexPaTemplateCompetencyOrder",
    ),
    cancelTemplateCompetencyButton: document.getElementById(
      "bexPaCancelTemplateCompetencyButton",
    ),
    saveTemplateCompetencyButton: document.getElementById(
      "bexPaSaveTemplateCompetencyButton",
    ),
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

    progressUpdatesList: document.getElementById(
      "bexPaProgressUpdatesList",
    ),
    progressUpdatesEmpty: document.getElementById(
      "bexPaProgressUpdatesEmpty",
    ),
    progressUpdateDialog: document.getElementById(
      "bexPaProgressUpdateDialog",
    ),
    progressUpdateForm: document.getElementById(
      "bexPaProgressUpdateForm",
    ),
    progressUpdateDialogTitle: document.getElementById(
      "bexPaProgressUpdateDialogTitle",
    ),
    progressUpdateFormError: document.getElementById(
      "bexPaProgressUpdateFormError",
    ),
    closeProgressUpdateDialogButton: document.getElementById(
      "bexPaCloseProgressUpdateDialogButton",
    ),
    cancelProgressUpdateButton: document.getElementById(
      "bexPaCancelProgressUpdateButton",
    ),
    progressUpdateSubmitButton: document.getElementById(
      "bexPaProgressUpdateSubmitButton",
    ),
    progressUpdateIndividualGoal: document.getElementById(
      "bexPaProgressUpdateIndividualGoal",
    ),
    progressUpdatePercentage: document.getElementById(
      "bexPaProgressUpdatePercentage",
    ),
    progressUpdateStatus: document.getElementById(
      "bexPaProgressUpdateStatus",
    ),
    progressUpdateText: document.getElementById(
      "bexPaProgressUpdateText",
    ),
    progressUpdateEvidence: document.getElementById(
      "bexPaProgressUpdateEvidence",
    ),

    cyclesCreateButton: document.getElementById(
      "bexPaCyclesCreateButton",
    ),


    backToTopButton: document.getElementById(
      "bexPaBackToTopButton",
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
    cycleTemplate: document.getElementById(
      "bexPaCycleTemplate",
    ),
    cycleTemplateUnavailable: document.getElementById(
      "bexPaCycleTemplateUnavailable",
    ),
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

    employeesInCycleLabel: document.querySelector(
      '[data-bex-pa-summary="employees"] .small',
    ),

    employeesInCycleSummary: document.querySelector(
      '[data-bex-pa-summary="employees"] .display-6',
    ),

    awaitingHrSummary: document.querySelector(
      '[data-bex-pa-summary="awaiting-hr"] .display-6',
    ),

    completedSummary: document.querySelector(
      '[data-bex-pa-summary="completed"] .display-6',
    ),

    overviewReadiness: document.getElementById(
      "bexPaOverviewReadiness",
    ),

    overviewCompletionPercentage: document.getElementById(
      "bexPaOverviewCompletionPercentage",
    ),

    overviewCompletionProgress: document.getElementById(
      "bexPaOverviewCompletionProgress",
    ),

    overviewCompletionBar: document.getElementById(
      "bexPaOverviewCompletionBar",
    ),

    overviewCompletionMessage: document.getElementById(
      "bexPaOverviewCompletionMessage",
    ),

    overviewOperations: document.getElementById(
      "bexPaOverviewOperations",
    ),

    overviewPriorityCount: document.getElementById(
      "bexPaOverviewPriorityCount",
    ),

    overviewPriorityList: document.getElementById(
      "bexPaOverviewPriorityList",
    ),

    overviewPriorityEmpty: document.getElementById(
      "bexPaOverviewPriorityEmpty",
    ),

    overviewActiveCycleCount: document.getElementById(
      "bexPaOverviewActiveCycleCount",
    ),

    overviewActiveCycleList: document.getElementById(
      "bexPaOverviewActiveCycleList",
    ),

    overviewActiveCycleEmpty: document.getElementById(
      "bexPaOverviewActiveCycleEmpty",
    ),
  };

  function bexPaShowSection(sectionName) {
    const sectionMap = {
      overview: bexPaElements.overviewSection,
      cycles: bexPaElements.cyclesSection,
      goals: bexPaElements.goalsSection,
      templates: bexPaElements.templatesSection,
      employeeAppraisals:
        bexPaElements.employeeAppraisalsSection,
      reports: bexPaElements.reportsSection,
    };

    const navMap = {
      overview: bexPaElements.overviewNavLink,
      cycles: bexPaElements.cyclesNavButton,
      goals: bexPaElements.goalsNavButton,
      templates: bexPaElements.templatesNavButton,
      employeeAppraisals:
        bexPaElements.employeeAppraisalsNavButton,
      reports: bexPaElements.reportsNavButton,
    };

    const detailSections = [
      bexPaElements.selfAppraisalSection,
      bexPaElements.managerAppraisalSection,
      bexPaElements.hrAppraisalReviewSection,
      bexPaElements.finalAppraisalSection,
    ];

    if (!sectionMap[sectionName]) {
      return;
    }

    if (
      (sectionName === "templates" &&
        !bexPaCanManageTemplates()) ||
      (sectionName === "reports" &&
        !bexPaCanViewReports())
    ) {
      return;
    }

    try {
      window.sessionStorage.setItem(
        BEX_PA_WORKSPACE_MEMORY_KEY,
        sectionName,
      );
      window.sessionStorage.setItem(
        `${BEX_PA_WORKSPACE_MEMORY_KEY}:${bexPaGetActiveMode() || "unknown"}`,
        sectionName,
      );
    } catch (error) {
      console.warn(
        "Performance appraisal workspace section could not be saved.",
        error,
      );
    }

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

    detailSections.forEach((section) => {
      section?.classList.add("d-none");
    });

    if (sectionName === "employeeAppraisals") {
      if (bexPaIsEmployeeMode()) {
        const currentAppraisal =
          bexPaGetDirectEmployeeAppraisal();

        if (currentAppraisal) {
          bexPaOpenSelfAppraisal(
            currentAppraisal.id,
            { scroll: false },
          );
        } else {
          bexPaSetEmployeeAppraisalRegisterVisible(true);
        }
      } else {
        bexPaSetEmployeeAppraisalRegisterVisible(true);
      }
    }

    if (
      sectionName === "reports" &&
      bexPaCanViewReports()
    ) {
      bexPaRenderOperationalReport();
    }
  }

  function bexPaPopulateCycleTemplates() {
    if (!bexPaElements.cycleTemplate) {
      return;
    }

    const currentValue =
      bexPaElements.cycleTemplate.value;

    bexPaElements.cycleTemplate.replaceChildren();

    const placeholder =
      document.createElement("option");

    placeholder.value = "";
    placeholder.textContent =
      "Select appraisal template";

    bexPaElements.cycleTemplate.appendChild(
      placeholder,
    );

    const activeTemplates =
      bexPaState.templates.filter(
        (template) =>
          template.status === "Active",
      );

    if (bexPaElements.cycleTemplateUnavailable) {
      bexPaElements.cycleTemplateUnavailable.classList.toggle(
        "d-none",
        activeTemplates.length > 0,
      );
    }

    activeTemplates.forEach((template) => {
      const option =
        document.createElement("option");

      option.value = template.id;
      option.textContent = template.name;

      bexPaElements.cycleTemplate.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      bexPaState.templates.some(
        (template) =>
          template.id === currentValue,
      )
    ) {
      bexPaElements.cycleTemplate.value =
        currentValue;
    }
  }

  function bexPaPopulateCycleForm(cycle) {
    bexPaElements.cycleName.value = cycle.name;
    bexPaElements.cycleTemplate.value =
      cycle.templateId || "";
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

  function bexPaGetRememberedSection(
    mode = bexPaGetActiveMode(),
    fallbackSection = "overview",
  ) {
    const allowedSections = [
      "overview",
      "cycles",
      "goals",
      "templates",
      "employeeAppraisals",
      "reports",
    ];

    try {
      const scopedRememberedSection =
        window.sessionStorage.getItem(
          `${BEX_PA_WORKSPACE_MEMORY_KEY}:${String(mode || "unknown")}`,
        );
      const rememberedSection =
        scopedRememberedSection;

      if (!allowedSections.includes(rememberedSection)) {
        return fallbackSection;
      }

      if (
        rememberedSection === "templates" &&
        !bexPaCanManageTemplates()
      ) {
        return fallbackSection;
      }

      if (
        rememberedSection === "reports" &&
        !bexPaCanViewReports()
      ) {
        return fallbackSection;
      }

      return rememberedSection;
    } catch (error) {
      console.warn(
        "Performance appraisal workspace section could not be read.",
        error,
      );

      return fallbackSection;
    }
  }

  function bexPaShowCycleForm(cycleId = null, mode = "create") {
    if (
      mode !== "view" &&
      !bexPaCanManageAppraisalCycles()
    ) {
      return;
    }

    bexPaShowSection("cycles");
    bexPaClearCycleError();
    bexPaPopulateCycleTemplates();

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

  function bexPaValidateCycle(
    cycle,
    excludedCycleId = bexPaState.editingCycleId,
  ) {
    const requiredValues = [
      cycle.name,
      cycle.templateId,
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

    const template =
      bexPaState.templates.find(
        (existingTemplate) =>
          existingTemplate.id === cycle.templateId,
      );

    if (!template) {
      return "Select a valid appraisal template.";
    }

    if (
      cycle.status === "Draft" &&
      template.status !== "Active"
    ) {
      return "Select an active appraisal template.";
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
        existingCycle.id !== excludedCycleId &&
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
      return "\u2014";
    }

    return new Intl.DateTimeFormat("en-NG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function bexPaFormatTimestamp(dateValue) {
    if (!dateValue) {
      return "";
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

  // =========================================================
  // PA PERSONA-AWARE OVERVIEW - STAGE 7D
  // Shared Overview behavior for My Appraisal, Manager Reviews,
  // HR Standard View and HR Administration. Tenant branding stays
  // separate and continues to be controlled by the tenant workspace class.
  // =========================================================
  function bexPaSetOverviewHero({
    kicker,
    title,
    description,
    metricsLabel,
  }) {
    const overviewSection =
      bexPaElements.overviewSection;

    if (!overviewSection) {
      return;
    }

    const kickerElement =
      overviewSection.querySelector(
        ".bex-pa-overview-hero-kicker",
      );
    const titleElement =
      overviewSection.querySelector(
        ".bex-pa-overview-hero-title",
      );
    const descriptionElement =
      overviewSection.querySelector(
        ".bex-pa-overview-hero-description",
      );
    const metricsElement =
      overviewSection.querySelector(
        ".bex-pa-overview-metrics",
      );

    if (kickerElement) {
      kickerElement.textContent = kicker;
    }

    if (titleElement) {
      titleElement.textContent = title;
    }

    if (descriptionElement) {
      descriptionElement.textContent = description;
    }

    if (metricsElement) {
      metricsElement.setAttribute(
        "aria-label",
        metricsLabel,
      );
    }
  }

  function bexPaSetOverviewSummaryCard(
    summaryKey,
    {
      label,
      value,
      detail,
    },
  ) {
    const card =
      bexPaElements.overviewSection
        ?.querySelector(
          `[data-bex-pa-summary="${summaryKey}"]`,
        );

    if (!card) {
      return;
    }

    const labelElement =
      card.querySelector(
        ".bex-pa-summary-label",
      );
    const valueElement =
      card.querySelector(
        ".bex-pa-summary-value",
      );
    const detailElement =
      card.querySelector(
        ".bex-pa-summary-detail",
      );

    if (labelElement) {
      labelElement.textContent = label;
    }

    if (valueElement) {
      valueElement.textContent =
        String(value);
    }

    if (detailElement) {
      detailElement.textContent = detail;
    }
  }

  function bexPaRenderPersonaOverviewSummary() {
    const activeMode = bexPaGetActiveMode();
    const activeCycleIds = new Set(
      bexPaState.cycles
        .filter(
          (cycle) => cycle.status === "Active",
        )
        .map((cycle) => cycle.id),
    );

    const visibleEmployeeAppraisals =
      bexPaGetVisibleEmployeeAppraisals();

    const activeVisibleEmployeeAppraisals =
      visibleEmployeeAppraisals.filter(
        (appraisal) =>
          activeCycleIds.has(appraisal.cycleId),
      );

    const visibleOperationalRecords =
      visibleEmployeeAppraisals.map(
        (appraisal) => ({
          appraisal,
          status:
            bexPaGetOperationalAppraisalStatus(
              appraisal,
            ),
        }),
      );

    const activeOperationalRecords =
      activeVisibleEmployeeAppraisals.map(
        (appraisal) => ({
          appraisal,
          status:
            bexPaGetOperationalAppraisalStatus(
              appraisal,
            ),
        }),
      );

    if (activeMode === "employee") {
      const personalCycleIds = new Set(
        visibleEmployeeAppraisals
          .map((appraisal) =>
            String(
              appraisal.cycleId || "",
            ).trim(),
          )
          .filter(Boolean),
      );

      const inProgressCount =
        activeOperationalRecords.filter(
          (record) =>
            record.status === "In Progress",
        ).length;

      const completedCount =
        visibleOperationalRecords.filter(
          (record) =>
            record.status === "Acknowledged",
        ).length;

      bexPaSetOverviewHero({
        kicker: "My performance",
        title: "My Appraisal",
        description:
          "Track your appraisal cycles, active reviews, progress and completed appraisal records.",
        metricsLabel: "My appraisal summary",
      });

      bexPaSetOverviewSummaryCard(
        "active-cycles",
        {
          label: "My appraisal cycles",
          value: personalCycleIds.size,
          detail:
            "Appraisal periods linked to you",
        },
      );

      bexPaSetOverviewSummaryCard(
        "employees",
        {
          label: "My active appraisals",
          value:
            activeVisibleEmployeeAppraisals.length,
          detail:
            "Active-cycle appraisal records",
        },
      );

      bexPaSetOverviewSummaryCard(
        "awaiting-hr",
        {
          label: "In progress",
          value: inProgressCount,
          detail:
            "Appraisals currently underway",
        },
      );

      bexPaSetOverviewSummaryCard(
        "completed",
        {
          label: "Completed appraisals",
          value: completedCount,
          detail:
            "Acknowledged appraisal records",
        },
      );

      return;
    }

    if (activeMode === "primary-manager") {
      const activeReviewCycleIds = new Set(
        activeVisibleEmployeeAppraisals
          .map((appraisal) =>
            String(
              appraisal.cycleId || "",
            ).trim(),
          )
          .filter(Boolean),
      );

      const reviewScopeEmployeeIds = new Set(
        [
          ...bexPaGetManagedEmployeeIds(),
          ...bexPaGetSecondaryEmployeeIds(),
        ]
          .map((employeeId) =>
            String(employeeId || "").trim(),
          )
          .filter(Boolean),
      );

      const eligibleManagerAppraisals =
        bexPaGetEligibleManagerAppraisals();

      const awaitingManagerReviewCount =
        eligibleManagerAppraisals.filter(
          (appraisal) => {
            const managerAppraisal =
              bexPaState.managerAppraisals.find(
                (existingManagerAppraisal) =>
                  existingManagerAppraisal.appraisalId ===
                  appraisal.id,
              );

            return (
              managerAppraisal?.status !==
              "Submitted"
            );
          },
        ).length;

      const submittedManagerReviewCount =
        eligibleManagerAppraisals.filter(
          (appraisal) =>
            bexPaState.managerAppraisals.some(
              (managerAppraisal) =>
                managerAppraisal.appraisalId ===
                  appraisal.id &&
                managerAppraisal.status ===
                  "Submitted",
            ),
        ).length;

      bexPaSetOverviewHero({
        kicker: "Team performance",
        title: "Manager Reviews",
        description:
          "Review appraisal progress for employees in your reporting scope and focus on submissions ready for manager action.",
        metricsLabel: "Manager review summary",
      });

      bexPaSetOverviewSummaryCard(
        "active-cycles",
        {
          label: "Active review cycles",
          value: activeReviewCycleIds.size,
          detail:
            "Active appraisal cycles in your scope",
        },
      );

      bexPaSetOverviewSummaryCard(
        "employees",
        {
          label: "Employees in review scope",
          value: reviewScopeEmployeeIds.size,
          detail:
            "Employees visible for manager review",
        },
      );

      bexPaSetOverviewSummaryCard(
        "awaiting-hr",
        {
          label: "Awaiting manager review",
          value: awaitingManagerReviewCount,
          detail:
            "Submitted self-appraisals ready for you",
        },
      );

      bexPaSetOverviewSummaryCard(
        "completed",
        {
          label: "Manager reviews submitted",
          value: submittedManagerReviewCount,
          detail:
            "Submitted manager appraisal records",
        },
      );

      return;
    }

    // PA HR STANDARD OVERVIEW COMPLETION - STAGE 7G
    if (activeMode === "hr-standard") {
      const visibleCycleIds = new Set(
        visibleEmployeeAppraisals
          .map((appraisal) =>
            String(
              appraisal.cycleId || "",
            ).trim(),
          )
          .filter(Boolean),
      );

      const activeEmployeeIds = new Set(
        activeVisibleEmployeeAppraisals
          .map((appraisal) =>
            String(
              appraisal.employeeId || "",
            ).trim(),
          )
          .filter(Boolean),
      );

      const awaitingHrCount =
        visibleEmployeeAppraisals.filter(
          (appraisal) => {
            const managerAppraisal =
              bexPaState.managerAppraisals.find(
                (record) =>
                  record.appraisalId ===
                  appraisal.id,
              );

            const hrFinalisation =
              bexPaState.hrFinalisations.find(
                (record) =>
                  record.appraisalId ===
                  appraisal.id,
              );

            return (
              managerAppraisal?.status ===
                "Submitted" &&
              hrFinalisation?.status !==
                "Finalised"
            );
          },
        ).length;

      const completedCount =
        visibleOperationalRecords.filter(
          (record) =>
            record.status ===
            "Acknowledged",
        ).length;

      bexPaSetOverviewHero({
        kicker: "HR visibility",
        title: "HR Standard View",
        description:
          "Monitor appraisal progress across your permitted organisation scope with read-only visibility into reviews and completion.",
        metricsLabel:
          "HR Standard appraisal summary",
      });

      bexPaSetOverviewSummaryCard(
        "active-cycles",
        {
          label: "Appraisal cycles in view",
          value: visibleCycleIds.size,
          detail:
            "Appraisal periods in your permitted scope",
        },
      );

      bexPaSetOverviewSummaryCard(
        "employees",
        {
          label: "Employees in active cycles",
          value: activeEmployeeIds.size,
          detail:
            "Employees visible in active-cycle appraisal records",
        },
      );

      bexPaSetOverviewSummaryCard(
        "awaiting-hr",
        {
          label: "Awaiting HR finalisation",
          value: awaitingHrCount,
          detail:
            "Submitted manager reviews in your view",
        },
      );

      bexPaSetOverviewSummaryCard(
        "completed",
        {
          label: "Completed appraisals",
          value: completedCount,
          detail:
            "Acknowledged appraisal records in your view",
        },
      );

      return;
    }

    const activeEmployeeIds = new Set(
      activeVisibleEmployeeAppraisals
        .map((appraisal) =>
          String(
            appraisal.employeeId || "",
          ).trim(),
        )
        .filter(Boolean),
    );

    const awaitingHrCount =
      visibleEmployeeAppraisals.filter(
        (appraisal) => {
          const managerAppraisal =
            bexPaState.managerAppraisals.find(
              (existingManagerAppraisal) =>
                existingManagerAppraisal.appraisalId ===
                appraisal.id,
            );

          const hrFinalisation =
            bexPaState.hrFinalisations.find(
              (existingFinalisation) =>
                existingFinalisation.appraisalId ===
                appraisal.id,
            );

          return (
            managerAppraisal?.status ===
              "Submitted" &&
            hrFinalisation?.status !==
              "Finalised"
          );
        },
      ).length;

    const completedCount =
      visibleEmployeeAppraisals.filter(
        (appraisal) =>
          appraisal.status ===
          "Acknowledged",
      ).length;

    const isHrAdminOverview = activeMode === "hr-admin";

    bexPaSetOverviewHero({
      kicker: isHrAdminOverview
        ? "HR administration"
        : "Performance operations",
      title: isHrAdminOverview
        ? "HR Administration"
        : "Performance Appraisal",
      description: isHrAdminOverview
        ? "Monitor appraisal cycles, employee participation, HR review workload and completion across the organisation."
        : "Monitor appraisal cycles, employee participation, review workload and completion across the organisation.",
      metricsLabel: isHrAdminOverview
        ? "HR administration appraisal summary"
        : "Appraisal summary",
    });

    bexPaSetOverviewSummaryCard(
      "active-cycles",
      {
        label: "Appraisal cycles",
        value: bexPaState.cycles.length,
        detail:
          "Appraisal periods in this workspace",
      },
    );

    bexPaSetOverviewSummaryCard(
      "employees",
      {
        label:
          activeCycleIds.size === 1
            ? "Employees in active cycle"
            : "Employees in active cycles",
        value: activeEmployeeIds.size,
        detail:
          activeCycleIds.size === 1
            ? "Employees linked to the active cycle"
            : "Employees linked to active cycles",
      },
    );

    bexPaSetOverviewSummaryCard(
      "awaiting-hr",
      {
        label: "Awaiting HR review",
        value: awaitingHrCount,
        detail:
          "Appraisals requiring HR attention",
      },
    );

    bexPaSetOverviewSummaryCard(
      "completed",
      {
        label: "Completed appraisals",
        value: completedCount,
        detail:
          "Completed appraisal records",
      },
    );
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
            )} \u2013 ${bexPaFormatDate(cycle.endDate)}`,
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

        if (
          cycle.status === "Draft" &&
          bexPaCanManageAppraisalCycles()
        ) {
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

    bexPaRenderPersonaOverviewSummary();
    bexPaRenderOverviewReadiness();
    bexPaRenderOverviewOperations();
  }

  async function bexPaHandleCycleSubmit(event) {
    event.preventDefault();
    bexPaClearCycleError();

    if (!bexPaCanManageAppraisalCycles()) {
      return;
    }

    const cycle = {
      id:
        bexPaState.editingCycleId ||
        `BEX-PA-CYCLE-${Date.now()}`,
      name: bexPaElements.cycleName.value.trim(),
      templateId:
        bexPaElements.cycleTemplate.value,
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

    const persistedCycle = wasEditing
      ? bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === cycle.id,
      )
      : cycle;

    try {
      await bexPaPersistDatasetMutation(
        "cycles",
        persistedCycle,
        bexPaSaveCycles,
      );
    } catch (error) {
      console.error(
        "Performance appraisal cycle persistence failed.",
        error,
      );
      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowCycleError(
        "The appraisal cycle could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderCycles();
    // BEXHR PA LIVE CONFIGURATION SYNC - R-01
    bexPaPopulateOrganisationGoalCycles();
    bexPaRenderOperationalReport();
    bexPaHideCycleForm();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${cycle.name} was updated successfully.`
          : `${cycle.name} was created successfully.`;
    }
  }

  function bexPaOpenActivationDialog(cycleId) {
    if (!bexPaCanManageAppraisalCycles()) {
      return;
    }

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

  function bexPaGenerateEmployeeAppraisals(cycle) {
    const availableEmployees =
      bexPaGetAvailableEmployees();

    if (availableEmployees.length === 0) {
      return [];
    }

    const template = bexPaState.templates.find(
      (existingTemplate) =>
        existingTemplate.id === cycle.templateId,
    );

    if (!template) {
      return [];
    }

    const templateSnapshot = {
      id: template.id,
      name: template.name,
      description: template.description || "",
      ratingScale: Array.isArray(template.ratingScale)
        ? [...template.ratingScale]
        : [],
      competencies: Array.isArray(template.competencies)
        ? template.competencies.map((competency) => ({
          ...competency,
        }))
        : [],
    };

    const existingEmployeeIds = new Set(
      bexPaState.employeeAppraisals
        .filter(
          (appraisal) =>
            appraisal.cycleId === cycle.id,
        )
        .map((appraisal) => appraisal.employeeId),
    );

    const newAppraisals = [];

    availableEmployees.forEach((employee) => {
      if (
        !employee.id ||
        existingEmployeeIds.has(employee.id)
      ) {
        return;
      }

      existingEmployeeIds.add(employee.id);

      newAppraisals.push({
        id: `BEX-PA-EMPLOYEE-APPRAISAL-${Date.now()}-${employee.id}`,
        cycleId: cycle.id,
        templateId: cycle.templateId,
        templateSnapshot: {
          ...templateSnapshot,
          ratingScale: [...templateSnapshot.ratingScale],
          competencies: templateSnapshot.competencies.map(
            (competency) => ({
              ...competency,
            }),
          ),
        },
        employeeId: employee.id,
        employeeName: employee.name,
        status: "Draft",
      });
    });

    if (newAppraisals.length === 0) {
      return [];
    }

    bexPaState.employeeAppraisals.push(
      ...newAppraisals,
    );

    return newAppraisals;
  }

  async function bexPaActivateCycle() {
    if (!bexPaCanManageAppraisalCycles()) {
      return;
    }

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

    const validationError = bexPaValidateCycle(
      cycle,
      cycle.id,
    );

    if (validationError) {
      if (bexPaElements.announcement) {
        bexPaElements.announcement.textContent =
          validationError;
      }

      return;
    }

    cycle.status = "Active";

    const newAppraisals =
      bexPaGenerateEmployeeAppraisals(cycle);

    try {
      await bexPaPersistDatasetMutation(
        "cycles",
        cycle,
        bexPaSaveCycles,
      );

      if (newAppraisals.length > 0) {
        if (bexPaIsIntegratedPersistenceContext()) {
          await bexPaPersistRemoteRecords(
            "employeeAppraisals",
            newAppraisals,
          );
        } else {
          bexPaSaveEmployeeAppraisals();
        }
      }
    } catch (error) {
      console.error(
        "Performance appraisal cycle activation persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      if (bexPaElements.announcement) {
        bexPaElements.announcement.textContent =
          "The appraisal cycle could not be activated. Please try again.";
      }

      return;
    }

    bexPaRenderCycles();
    bexPaRenderEmployeeAppraisals();

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
    if (!bexPaCanManageGoalFramework()) {
      return;
    }

    bexPaResetOrganisationGoalForm();
    bexPaPopulateOrganisationGoalCycles();
    const rememberedValues = bexPaGetRememberedFormValues("organisationGoal");
    bexPaApplyRememberedValues([
      [bexPaElements.organisationGoalCycle, rememberedValues.cycleId],
      [bexPaElements.organisationGoalTitle, rememberedValues.title],
      [bexPaElements.organisationGoalDescription, rememberedValues.description],
      [bexPaElements.organisationGoalTarget, rememberedValues.target],
      [bexPaElements.organisationGoalOwner, rememberedValues.owner],
      [bexPaElements.organisationGoalStatus, rememberedValues.status],
      [bexPaElements.organisationGoalStartDate, rememberedValues.startDate],
      [bexPaElements.organisationGoalDueDate, rememberedValues.dueDate],
    ]);
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
    if (!bexPaCanManageGoalFramework()) {
      return;
    }

    bexPaResetDeliverableForm();
    bexPaPopulateDeliverableOrganisationGoals();
    bexPaUpdateDeliverableCycleDisplay();
    const rememberedValues = bexPaGetRememberedFormValues("deliverable");
    bexPaApplyRememberedValues([
      [bexPaElements.deliverableOrganisationGoal, rememberedValues.organisationGoalId],
      [bexPaElements.deliverableTitle, rememberedValues.title],
      [bexPaElements.deliverableDescription, rememberedValues.description],
      [bexPaElements.deliverableTarget, rememberedValues.target],
      [bexPaElements.deliverableOwner, rememberedValues.owner],
      [bexPaElements.deliverableStatus, rememberedValues.status],
      [bexPaElements.deliverableStartDate, rememberedValues.startDate],
      [bexPaElements.deliverableDueDate, rememberedValues.dueDate],
    ]);
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

  function bexPaApplyDepartmentGoalDepartmentScope() {
    const departmentField =
      bexPaElements.departmentGoalDepartment;

    if (!departmentField) {
      return;
    }

    const currentValue =
      String(departmentField.value || "").trim();

    let availableDepartments =
      bexPaGetAvailableDepartments();

    if (bexPaIsPrimaryManagerMode()) {
      const managedDepartmentIds =
        new Set(
          bexPaGetAvailableEmployees()
            .map((employee) =>
              String(
                employee.departmentId || "",
              ).trim(),
            )
            .filter(Boolean),
        );

      availableDepartments =
        availableDepartments.filter(
          (department) =>
            managedDepartmentIds.has(
              department.id,
            ),
        );
    }

    departmentField.replaceChildren();

    const placeholder =
      document.createElement("option");

    placeholder.value = "";
    placeholder.textContent =
      availableDepartments.length > 0
        ? "Select department"
        : "No departments available";

    departmentField.appendChild(
      placeholder,
    );

    availableDepartments.forEach(
      (department) => {
        const option =
          document.createElement("option");

        option.value = department.id;
        option.textContent = department.name;

        departmentField.appendChild(option);
      },
    );

    departmentField.disabled =
      availableDepartments.length === 0;

    if (
      currentValue &&
      availableDepartments.some(
        (department) =>
          department.id === currentValue,
      )
    ) {
      departmentField.value = currentValue;
      return;
    }

    if (availableDepartments.length === 1) {
      departmentField.value =
        availableDepartments[0].id;
    }
  }

  function bexPaOpenDepartmentGoalDialog(
    departmentGoalId = null,
  ) {
    if (!bexPaCanManageDepartmentGoals()) {
      return;
    }

    bexPaResetDepartmentGoalForm();
    bexPaPopulateDepartmentGoalOrganisationGoals();
    bexPaUpdateDepartmentGoalCycleDisplay();
    bexPaApplyDepartmentGoalDepartmentScope();
    const rememberedValues = bexPaGetRememberedFormValues("departmentGoal");
    bexPaApplyRememberedValues([
      [bexPaElements.departmentGoalOrganisationGoal, rememberedValues.organisationGoalId],
      [bexPaElements.departmentGoalDepartment, rememberedValues.departmentId],
      [bexPaElements.departmentGoalTitle, rememberedValues.title],
      [bexPaElements.departmentGoalDescription, rememberedValues.description],
      [bexPaElements.departmentGoalTarget, rememberedValues.target],
      [bexPaElements.departmentGoalOwner, rememberedValues.owner],
      [bexPaElements.departmentGoalStatus, rememberedValues.status],
      [bexPaElements.departmentGoalStartDate, rememberedValues.startDate],
      [bexPaElements.departmentGoalDueDate, rememberedValues.dueDate],
    ]);
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

      if (!bexPaCanManageDepartmentGoal(departmentGoal)) {
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
        departmentGoal.departmentId || "";

      bexPaApplyDepartmentGoalDepartmentScope();

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

    if (
      !departmentGoal.cycleId ||
      departmentGoal.cycleId !==
      organisationGoal.cycleId
    ) {
      return "The department goal appraisal cycle must match the selected organisation goal.";
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

  function bexPaPopulateIndividualGoalEmployees() {
    if (!bexPaElements.individualGoalEmployee) {
      return;
    }

    const employeeField =
      bexPaElements.individualGoalEmployee;

    const searchInput =
      employeeField.querySelector(
        "#bexPaIndividualGoalEmployeeSearch",
      );

    const employeeIdField =
      employeeField.querySelector(
        "#bexPaIndividualGoalEmployeeId",
      );

    const resultsField =
      employeeField.querySelector(
        "#bexPaIndividualGoalEmployeeResults",
      );

    if (
      !searchInput ||
      !employeeIdField ||
      !resultsField
    ) {
      return;
    }

    const availableEmployees =
      bexPaGetAvailableEmployees();

    const renderResults = (
      searchTerm = "",
    ) => {
      const normalizedSearchTerm = String(
        searchTerm || "",
      )
        .trim()
        .toLowerCase();

      const matchingEmployees =
        availableEmployees.filter(
          (employee) => {
            if (!normalizedSearchTerm) {
              return true;
            }

            return [
              employee.name,
              employee.department,
              employee.jobTitle,
            ].some((value) =>
              String(value || "")
                .toLowerCase()
                .includes(
                  normalizedSearchTerm,
                ),
            );
          },
        );

      resultsField.replaceChildren();

      if (matchingEmployees.length === 0) {
        const emptyState =
          document.createElement("p");

        emptyState.className =
          "mb-0 small text-body-secondary p-2";

        emptyState.textContent =
          availableEmployees.length === 0
            ? "No eligible employees are available."
            : "No matching employees found.";

        resultsField.appendChild(
          emptyState,
        );

        resultsField.classList.remove(
          "d-none",
        );

        searchInput.setAttribute(
          "aria-expanded",
          "true",
        );

        return;
      }

      matchingEmployees.forEach(
        (employee) => {
          const option =
            document.createElement("button");

          option.type = "button";
          option.className =
            "btn w-100 text-start border-0 rounded-2 p-2";

          option.dataset.bexPaIndividualGoalEmployee =
            employee.id;

          option.setAttribute(
            "role",
            "option",
          );

          option.setAttribute(
            "aria-selected",
            employee.id ===
              employeeIdField.value
              ? "true"
              : "false",
          );

          const employeeDetails =
            document.createElement("span");

          employeeDetails.className =
            "d-flex flex-column";

          const employeeName =
            document.createElement("span");

          employeeName.className =
            "fw-semibold";

          employeeName.textContent =
            employee.name;

          const employeeContext =
            document.createElement("small");

          employeeContext.className =
            "text-body-secondary";

          employeeContext.textContent = [
            employee.department,
            employee.jobTitle,
          ]
            .filter(Boolean)
            .join(" • ") ||
            "Department and job title not specified";

          employeeDetails.append(
            employeeName,
            employeeContext,
          );

          option.appendChild(
            employeeDetails,
          );

          resultsField.appendChild(
            option,
          );
        },
      );

      resultsField.classList.remove(
        "d-none",
      );

      searchInput.setAttribute(
        "aria-expanded",
        "true",
      );
    };

    searchInput.onfocus = () => {
      renderResults(searchInput.value);
    };

    searchInput.oninput = () => {
      employeeIdField.value = "";

      renderResults(searchInput.value);
    };

    resultsField.onclick = (event) => {
      const option =
        event.target.closest(
          "[data-bex-pa-individual-goal-employee]",
        );

      if (!option) {
        return;
      }

      const employee =
        availableEmployees.find(
          (availableEmployee) =>
            availableEmployee.id ===
            option.dataset
              .bexPaIndividualGoalEmployee,
        );

      if (!employee) {
        return;
      }

      employeeIdField.value =
        employee.id;

      searchInput.value =
        employee.name;

      resultsField.classList.add(
        "d-none",
      );

      searchInput.setAttribute(
        "aria-expanded",
        "false",
      );

      employeeField.dispatchEvent(
        new CustomEvent(
          "bexpaemployeechange",
          {
            bubbles: true,
            detail: {
              employeeId:
                employee.id,
            },
          },
        ),
      );
    };
  }

  function bexPaPopulateIndividualGoalDepartmentGoals() {
    if (!bexPaElements.individualGoalDepartmentGoal) {
      return;
    }

    const currentValue =
      bexPaElements.individualGoalDepartmentGoal.value;

    const selectedDepartment =
      bexPaGetSelectedIndividualGoalDepartment();

    bexPaElements.individualGoalDepartmentGoal.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = selectedDepartment
      ? "Select department goal"
      : "Select employee first";

    bexPaElements.individualGoalDepartmentGoal.appendChild(
      placeholder,
    );

    const scopedDepartmentGoals =
      bexPaIsPrimaryManagerMode()
        ? bexPaState.departmentGoals.filter(
          (departmentGoal) =>
            bexPaCanManageDepartmentGoal(
              departmentGoal,
            ),
        )
        : bexPaState.departmentGoals;

    const availableDepartmentGoals =
      selectedDepartment
        ? scopedDepartmentGoals.filter(
          (departmentGoal) => {
            const goalDepartmentId = String(
              departmentGoal.departmentId || "",
            ).trim();

            const goalDepartmentName = String(
              departmentGoal.department || "",
            ).trim();

            if (
              bexPaIsIntegratedPersistenceContext()
            ) {
              return Boolean(
                selectedDepartment.id &&
                goalDepartmentId &&
                selectedDepartment.id ===
                goalDepartmentId,
              );
            }

            if (
              selectedDepartment.id &&
              goalDepartmentId
            ) {
              return (
                selectedDepartment.id ===
                goalDepartmentId
              );
            }

            return (
              selectedDepartment.name &&
              goalDepartmentName &&
              selectedDepartment.name.toLowerCase() ===
              goalDepartmentName.toLowerCase()
            );
          },
        )
        : [];

    availableDepartmentGoals.forEach(
      (departmentGoal) => {
        const option =
          document.createElement("option");

        option.value = departmentGoal.id;
        option.textContent =
          `${departmentGoal.title} (${departmentGoal.department})`;

        bexPaElements.individualGoalDepartmentGoal.appendChild(
          option,
        );
      },
    );

    if (
      currentValue &&
      availableDepartmentGoals.some(
        (departmentGoal) =>
          departmentGoal.id === currentValue,
      )
    ) {
      bexPaElements.individualGoalDepartmentGoal.value =
        currentValue;
    }
  }

  function bexPaUpdateIndividualGoalDerivedFields() {
    const selectedDepartment =
      bexPaGetSelectedIndividualGoalDepartment();

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
        selectedDepartment?.name || "";

      bexPaElements.individualGoalDepartment.dataset.bexPaDepartmentId =
        selectedDepartment?.id || "";
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
    if (bexPaElements.individualGoalEmployee) {
      const employeeSearch =
        bexPaElements.individualGoalEmployee.querySelector(
          "#bexPaIndividualGoalEmployeeSearch",
        );

      const employeeIdField =
        bexPaElements.individualGoalEmployee.querySelector(
          "#bexPaIndividualGoalEmployeeId",
        );

      const employeeResults =
        bexPaElements.individualGoalEmployee.querySelector(
          "#bexPaIndividualGoalEmployeeResults",
        );

      if (employeeSearch) {
        employeeSearch.value = "";
        employeeSearch.disabled = false;
        employeeSearch.setAttribute(
          "aria-expanded",
          "false",
        );
      }

      if (employeeIdField) {
        employeeIdField.value = "";
      }

      if (employeeResults) {
        employeeResults.replaceChildren();
        employeeResults.classList.add(
          "d-none",
        );
      }
    }
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
    if (!bexPaCanEditIndividualGoals()) {
      return;
    }

    bexPaResetIndividualGoalForm();
    bexPaPopulateIndividualGoalEmployees();
    bexPaPopulateIndividualGoalDepartmentGoals();
    bexPaUpdateIndividualGoalDerivedFields();
    const rememberedValues = bexPaGetRememberedFormValues("individualGoal");
    bexPaApplyRememberedValues([
      [bexPaElements.individualGoalTitle, rememberedValues.title],
      [bexPaElements.individualGoalDescription, rememberedValues.description],
      [bexPaElements.individualGoalTarget, rememberedValues.target],
      [bexPaElements.individualGoalStatus, rememberedValues.status],
      [bexPaElements.individualGoalStartDate, rememberedValues.startDate],
      [bexPaElements.individualGoalDueDate, rememberedValues.dueDate],
    ]);
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

      if (
        bexPaIsIndividualGoalHistorical(
          individualGoal,
        )
      ) {
        return;
      }

      if (
        bexPaIsPrimaryManagerMode() &&
        !bexPaIsIndividualGoalInPrimaryManagerScope(
          individualGoal,
        )
      ) {
        return;
      }

      bexPaState.editingIndividualGoalId =
        individualGoal.id;

      bexPaElements.individualGoalDialogTitle.textContent =
        "Edit Individual Goal";

      bexPaElements.individualGoalSubmitButton.textContent =
        "Save Changes";

      const employeeId =
        bexPaGetIndividualGoalEmployeeId(individualGoal);

      const employeeSearch =
        bexPaElements.individualGoalEmployee
          ?.querySelector(
            "#bexPaIndividualGoalEmployeeSearch",
          );

      const employeeIdField =
        bexPaElements.individualGoalEmployee
          ?.querySelector(
            "#bexPaIndividualGoalEmployeeId",
          );

      const employeeResults =
        bexPaElements.individualGoalEmployee
          ?.querySelector(
            "#bexPaIndividualGoalEmployeeResults",
          );

      const selectedEmployee =
        bexPaGetAvailableEmployees().find(
          (employee) =>
            employee.id === employeeId,
        );

      if (
        !selectedEmployee ||
        !employeeSearch ||
        !employeeIdField
      ) {
        return;
      }

      employeeIdField.value =
        selectedEmployee.id;

      employeeSearch.value =
        selectedEmployee.name;

      employeeSearch.disabled = true;

      employeeSearch.setAttribute(
        "aria-expanded",
        "false",
      );

      employeeResults?.classList.add(
        "d-none",
      );

      bexPaPopulateIndividualGoalDepartmentGoals();

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
      bexPaElements.individualGoalEmployee
        ?.querySelector(
          "#bexPaIndividualGoalEmployeeSearch",
        )
        ?.focus();
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

    if (
      bexPaGetAvailableEmployees().length > 0 &&
      !individualGoal.employeeId
    ) {
      return "Select a valid employee.";
    }

    if (
      bexPaIsPrimaryManagerMode() &&
      !bexPaGetManagedEmployeeIds().includes(
        individualGoal.employeeId,
      )
    ) {
      return "You can only manage individual goals for employees within your Primary Manager reporting scope.";
    }

    if (
      bexPaIsIndividualGoalHistorical(
        individualGoal,
      )
    ) {
      return "Individual goals cannot be changed for a finalised or acknowledged appraisal.";
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

    if (
      bexPaIsPrimaryManagerMode() &&
      !bexPaCanManageDepartmentGoal(
        departmentGoal,
      )
    ) {
      return "You can only assign individual goals within departments in your Primary reporting scope.";
    }

    if (
      !individualGoal.cycleId ||
      individualGoal.cycleId !==
      departmentGoal.cycleId
    ) {
      return "The individual goal appraisal cycle must match the selected department goal.";
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

  function bexPaCreateGoalIdentityMeta(labelText, valueText) {
    const identity = document.createElement("span");
    identity.className = "bex-pa-goal-meta-identity";

    const label = document.createElement("span");
    label.className = "bex-pa-goal-meta-identity-label";
    label.textContent = String(labelText ?? "");

    const value = document.createElement("strong");
    value.className = "bex-pa-goal-meta-identity-value";
    value.textContent = String(valueText ?? "");

    identity.append(label, value);
    return identity;
  }

  function bexPaRenderProgressUpdates() {
    if (!bexPaElements.progressUpdatesList) {
      return;
    }

    const visibleIndividualGoalIds = new Set(
      bexPaGetVisibleIndividualGoals().map(
        (individualGoal) => individualGoal.id,
      ),
    );

    const visibleProgressUpdates =
      bexPaState.progressUpdates.filter(
        (progressUpdate) =>
          visibleIndividualGoalIds.has(
            progressUpdate.individualGoalId,
          ),
      );

    bexPaElements.progressUpdatesList.replaceChildren();

    if (visibleProgressUpdates.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaProgressUpdatesEmpty";

      emptyState.textContent =
        "No employee progress updates have been submitted yet.";

      bexPaElements.progressUpdatesList.appendChild(
        emptyState,
      );

      return;
    }

    visibleProgressUpdates.forEach(
      (progressUpdate) => {
        const individualGoal =
          bexPaState.individualGoals.find(
            (existingIndividualGoal) =>
              existingIndividualGoal.id ===
              progressUpdate.individualGoalId,
          );

        const departmentGoal = individualGoal
          ? bexPaState.departmentGoals.find(
            (existingDepartmentGoal) =>
              existingDepartmentGoal.id ===
              individualGoal.departmentGoalId,
          )
          : null;

        const cycle = individualGoal
          ? bexPaState.cycles.find(
            (existingCycle) =>
              existingCycle.id ===
              individualGoal.cycleId,
          )
          : null;

        const isHistorical =
          bexPaIsIndividualGoalHistorical(
            individualGoal,
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

        title.textContent =
          individualGoal?.title ||
          "Unknown individual goal";

        const meta = document.createElement("div");
        meta.className = "bex-pa-goal-meta";

        const employeeLabel =
          bexPaCreateGoalIdentityMeta(
            "Employee",
            individualGoal?.employee || "Unknown employee",
          );

        const cycleLabel =
          document.createElement("span");
        cycleLabel.textContent =
          `Cycle: ${cycle?.name || "Unknown cycle"}`;

        const historyLabel =
          document.createElement("span");

        historyLabel.textContent =
          isHistorical
            ? `Historical | Last status: ${progressUpdate.status}`
            : "Active";

        const departmentLabel =
          document.createElement("span");
        departmentLabel.textContent =
          `Progress: ${progressUpdate.progressPercentage}%`;

        const dateLabel =
          document.createElement("span");

        const submittedDate =
          progressUpdate.createdAt
            ? new Date(progressUpdate.createdAt)
            : null;

        dateLabel.textContent =
          submittedDate &&
            !Number.isNaN(submittedDate.getTime())
            ? `Timestamp: ${new Intl.DateTimeFormat("en-NG", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(submittedDate)}`
            : "Timestamp: Unknown submission date";

        meta.append(
          employeeLabel,
          cycleLabel,
          historyLabel,
          departmentLabel,
          dateLabel,
        );

        titleArea.append(
          title,
          meta,
        );

        const status = document.createElement("span");
        status.className = "bex-pa-goal-status";

        status.dataset.status =
          isHistorical
            ? "historical"
            : progressUpdate.status
              .toLowerCase()
              .replaceAll(" ", "-");

        status.textContent =
          isHistorical
            ? "Historical"
            : progressUpdate.status;

        header.append(
          titleArea,
          status,
        );

        const updateText =
          document.createElement("p");

        updateText.className =
          "mt-3 mb-0 text-body-secondary";

        updateText.textContent =
          `Update: ${progressUpdate.updateText}`;

        const evidence = document.createElement("p");
        evidence.className = "mb-0 text-body-secondary";
        evidence.textContent = progressUpdate.evidence
          ? `Evidence: ${progressUpdate.evidence}`
          : "Evidence: Not provided";

        item.append(
          header,
          updateText,
          evidence,
        );

        bexPaElements.progressUpdatesList.appendChild(
          item,
        );
      },
    );
  }

  function bexPaPopulateProgressUpdateIndividualGoals() {
    if (!bexPaElements.progressUpdateIndividualGoal) {
      return;
    }

    const currentValue =
      bexPaElements.progressUpdateIndividualGoal.value;

    bexPaElements.progressUpdateIndividualGoal.replaceChildren();

    const visibleIndividualGoals =
      bexPaGetVisibleIndividualGoals().filter(
        (individualGoal) =>
          !bexPaIsIndividualGoalHistorical(
            individualGoal,
          ),
      );

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select individual goal";

    bexPaElements.progressUpdateIndividualGoal.appendChild(
      placeholder,
    );

    visibleIndividualGoals.forEach((individualGoal) => {
      const option = document.createElement("option");

      option.value = individualGoal.id;
      option.textContent =
        `${individualGoal.title} (${individualGoal.employee})`;

      bexPaElements.progressUpdateIndividualGoal.appendChild(
        option,
      );
    });

    if (
      currentValue &&
      visibleIndividualGoals.some(
        (individualGoal) =>
          individualGoal.id === currentValue,
      )
    ) {
      bexPaElements.progressUpdateIndividualGoal.value =
        currentValue;
    }
  }

  function bexPaClearProgressUpdateError() {
    if (!bexPaElements.progressUpdateFormError) {
      return;
    }

    bexPaElements.progressUpdateFormError.textContent = "";
    bexPaElements.progressUpdateFormError.classList.add(
      "d-none",
    );
  }

  function bexPaShowProgressUpdateError(message) {
    if (!bexPaElements.progressUpdateFormError) {
      return;
    }

    bexPaElements.progressUpdateFormError.textContent =
      message;

    bexPaElements.progressUpdateFormError.classList.remove(
      "d-none",
    );
  }

  function bexPaResetProgressUpdateForm() {
    bexPaElements.progressUpdateForm?.reset();
    bexPaClearProgressUpdateError();

    if (bexPaElements.progressUpdateDialogTitle) {
      bexPaElements.progressUpdateDialogTitle.textContent =
        "Add Progress Update";
    }

    if (bexPaElements.progressUpdateSubmitButton) {
      bexPaElements.progressUpdateSubmitButton.textContent =
        "Submit Progress Update";
    }
  }

  function bexPaOpenProgressUpdateDialog(
    individualGoalId = null,
  ) {
    bexPaResetProgressUpdateForm();
    bexPaPopulateProgressUpdateIndividualGoals();

    const rememberedValues =
      bexPaGetRememberedFormValues(
        "progressUpdate",
      );

    if (individualGoalId) {
      const individualGoal =
        bexPaState.individualGoals.find(
          (existingIndividualGoal) =>
            existingIndividualGoal.id ===
            individualGoalId,
        );

      const canUseIndividualGoal =
        individualGoal &&
        (
          !bexPaIsEmployeeMode() ||
          bexPaIsIndividualGoalOwnedByCurrentEmployee(
            individualGoal,
          )
        );

      if (canUseIndividualGoal) {
        bexPaElements.progressUpdateIndividualGoal.value =
          individualGoalId;
      }
    }

    bexPaApplyRememberedValues([
      [
        bexPaElements.progressUpdatePercentage,
        rememberedValues.progressPercentage,
      ],
      [bexPaElements.progressUpdateStatus, rememberedValues.status],
      [bexPaElements.progressUpdateText, rememberedValues.updateText],
      [bexPaElements.progressUpdateEvidence, rememberedValues.evidence],
    ]);

    bexPaElements.progressUpdateDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.progressUpdateIndividualGoal?.focus();
    });
  }

  function bexPaCloseProgressUpdateDialog() {
    bexPaElements.progressUpdateDialog?.close();
    bexPaResetProgressUpdateForm();
  }

  function bexPaValidateProgressUpdate(
    progressUpdate,
  ) {
    const requiredValues = [
      progressUpdate.individualGoalId,
      progressUpdate.status,
      progressUpdate.updateText,
    ];

    if (requiredValues.some((value) => !value)) {
      return "Complete all progress update fields before submitting.";
    }

    const individualGoal =
      bexPaState.individualGoals.find(
        (existingIndividualGoal) =>
          existingIndividualGoal.id ===
          progressUpdate.individualGoalId,
      );

    if (!individualGoal) {
      return "Select a valid individual goal.";
    }

    if (!bexPaCanAddProgressUpdates()) {
      return "Only employees can submit progress updates.";
    }

    if (
      !bexPaCanAddProgressUpdates(
        individualGoal,
      )
    ) {
      return "Progress updates cannot be submitted for a finalised or acknowledged appraisal.";
    }

    if (!progressUpdate.employeeId) {
      return "Your employee identity could not be resolved.";
    }

    if (
      bexPaIsEmployeeMode() &&
      !bexPaIsIndividualGoalOwnedByCurrentEmployee(
        individualGoal,
      )
    ) {
      return "You can only submit progress updates for your own individual goals.";
    }

    const allowedStatuses = [
      "Not Started",
      "In Progress",
      "Completed",
    ];

    if (!allowedStatuses.includes(progressUpdate.status)) {
      return "Select a valid progress status.";
    }

    if (
      !Number.isFinite(progressUpdate.progressPercentage) ||
      progressUpdate.progressPercentage < 0 ||
      progressUpdate.progressPercentage > 100
    ) {
      return "Progress percentage must be a number between 0 and 100.";
    }

    const allowedProgressPercentages = [
      0,
      10,
      20,
      30,
      40,
      50,
      60,
      70,
      80,
      90,
      100,
    ];

    if (
      !allowedProgressPercentages.includes(
        progressUpdate.progressPercentage,
      )
    ) {
      return "Select a valid progress percentage in 10% increments.";
    }

    const expectedProgressStatus =
      progressUpdate.progressPercentage === 0
        ? "Not Started"
        : progressUpdate.progressPercentage === 100
          ? "Completed"
          : "In Progress";

    if (progressUpdate.status !== expectedProgressStatus) {
      return `${progressUpdate.progressPercentage}% progress must use the "${expectedProgressStatus}" status.`;
    }

    if (progressUpdate.evidence.length > 1000) {
      return "Evidence note cannot exceed 1000 characters.";
    }

    if (progressUpdate.updateText.length > 1000) {
      return "Progress update cannot exceed 1000 characters.";
    }

    return "";
  }

  async function bexPaHandleProgressUpdateSubmit(event) {
    event.preventDefault();
    bexPaClearProgressUpdateError();

    if (!bexPaCanAddProgressUpdates()) {
      return;
    }

    const individualGoal =
      bexPaState.individualGoals.find(
        (existingIndividualGoal) =>
          existingIndividualGoal.id ===
          bexPaElements.progressUpdateIndividualGoal.value,
      );

    const progressUpdate = {
      id:
        `BEX-PA-PROGRESS-${Date.now()}`,

      individualGoalId:
        bexPaElements.progressUpdateIndividualGoal.value,

      employeeId:
        bexPaGetCurrentEmployeeId(),

      progressPercentage:
        bexPaElements.progressUpdatePercentage.value.trim() === ""
          ? NaN
          : Number(
            bexPaElements.progressUpdatePercentage.value,
          ),

      status:
        bexPaElements.progressUpdateStatus.value,

      updateText:
        bexPaElements.progressUpdateText.value.trim(),

      evidence:
        bexPaElements.progressUpdateEvidence.value.trim(),

      createdAt:
        new Date().toISOString(),
    };

    const validationError =
      bexPaValidateProgressUpdate(
        progressUpdate,
      );

    if (validationError) {
      bexPaShowProgressUpdateError(
        validationError,
      );
      return;
    }

    bexPaRememberFormValues(
      "progressUpdate",
      {
        progressPercentage:
          String(
            progressUpdate.progressPercentage,
          ),

        status:
          progressUpdate.status,

        updateText:
          progressUpdate.updateText,

        evidence:
          progressUpdate.evidence,
      },
    );

    bexPaState.progressUpdates.push(
      progressUpdate,
    );

    try {
      await bexPaPersistDatasetMutation(
        "progressUpdates",
        progressUpdate,
        bexPaSaveProgressUpdates,
      );
    } catch (error) {
      console.error(
        "Performance appraisal progress-update persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowProgressUpdateError(
        "The progress update could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderProgressUpdates();
    bexPaCloseProgressUpdateDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        `Progress update for ${individualGoal.title} was submitted successfully.`;
    }
  }

  function bexPaCreateIndividualGoalProgressButton(
    individualGoalId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-primary";

    button.dataset.bexPaIndividualGoalAction =
      "progress";

    button.dataset.bexPaIndividualGoalId =
      individualGoalId;

    button.innerHTML =
      '<i class="bi bi-arrow-up-right-circle" aria-hidden="true"></i>';

    button.title = "Add progress update";
    button.setAttribute(
      "aria-label",
      "Add progress update",
    );

    return button;
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

    const visibleIndividualGoals =
      bexPaGetVisibleIndividualGoals();

    bexPaElements.individualGoalsList.replaceChildren();

    if (visibleIndividualGoals.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id = "bexPaIndividualGoalsEmpty";

      const activeMode =
        bexPaGetActiveMode();

      emptyState.textContent =
        activeMode === "employee"
          ? "No individual goals are available for your employee account."
          : activeMode === "primary-manager"
            ? "No individual goals are available within your current reporting scope."
            : "No individual employee goals have been created yet.";

      bexPaElements.individualGoalsList.appendChild(
        emptyState,
      );

      return;
    }

    visibleIndividualGoals.forEach(
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
          bexPaCreateGoalIdentityMeta(
            "Employee",
            individualGoal.employee,
          );

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

        const isHistorical =
          bexPaIsIndividualGoalHistorical(
            individualGoal,
          );

        const status = document.createElement("span");
        status.className = "bex-pa-goal-status";

        status.dataset.status =
          isHistorical
            ? "historical"
            : individualGoal.status.toLowerCase();

        status.textContent =
          isHistorical
            ? "Historical"
            : individualGoal.status;

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

        if (
          bexPaCanEditIndividualGoals() &&
          !bexPaIsIndividualGoalHistorical(
            individualGoal,
          )
        ) {
          actions.appendChild(
            bexPaCreateIndividualGoalActionButton(
              individualGoal.id,
            ),
          );
        }

        if (
          bexPaCanAddProgressUpdates(
            individualGoal,
          )
        ) {
          actions.appendChild(
            bexPaCreateIndividualGoalProgressButton(
              individualGoal.id,
            ),
          );
        }

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

  async function bexPaHandleIndividualGoalSubmit(event) {
    event.preventDefault();

    if (!bexPaCanEditIndividualGoals()) {
      return;
    }

    bexPaClearIndividualGoalError();

    bexPaRememberFormValues("individualGoal", {
      departmentGoalId: bexPaElements.individualGoalDepartmentGoal.value,
      department: bexPaElements.individualGoalDepartment.value,
      cycle: bexPaElements.individualGoalCycle.value,
      title: bexPaElements.individualGoalTitle.value,
      description: bexPaElements.individualGoalDescription.value,
      target: bexPaElements.individualGoalTarget.value,
      status: bexPaElements.individualGoalStatus.value,
      startDate: bexPaElements.individualGoalStartDate.value,
      dueDate: bexPaElements.individualGoalDueDate.value,
    });

    const departmentGoal =
      bexPaState.departmentGoals.find(
        (existingDepartmentGoal) =>
          existingDepartmentGoal.id ===
          bexPaElements.individualGoalDepartmentGoal.value,
      );

    const wasEditing = Boolean(
      bexPaState.editingIndividualGoalId,
    );

    const selectedEmployee =
      bexPaGetSelectedIndividualGoalEmployee();

    if (!selectedEmployee) {
      bexPaShowIndividualGoalError(
        "Select one valid employee.",
      );
      return;
    }

    const selectedDepartment =
      bexPaGetSelectedIndividualGoalDepartment();

    if (!selectedDepartment) {
      bexPaShowIndividualGoalError(
        "The selected employee does not have a valid department.",
      );
      return;
    }

    const sharedGoalFields = {
      departmentGoalId:
        bexPaElements.individualGoalDepartmentGoal.value,

      department:
        selectedDepartment.name,

      departmentId:
        selectedDepartment.id,

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

    const individualGoal = {
      id:
        wasEditing
          ? bexPaState.editingIndividualGoalId
          : `BEX-PA-INDIVIDUAL-GOAL-${Date.now()}-${selectedEmployee.id}`,

      employee:
        selectedEmployee.name,

      employeeId:
        selectedEmployee.id,

      ...sharedGoalFields,
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

    try {
      if (bexPaIsIntegratedPersistenceContext()) {
        if (
          bexPaPersistence.mode !== "remote" ||
          !bexPaPersistence.ready
        ) {
          throw new Error(
            "Integrated appraisal persistence is unavailable.",
          );
        }

        await bexPaPersistRemoteRecords(
          "individualGoals",
          individualGoal,
        );
      } else {
        bexPaSaveIndividualGoals();
      }
    } catch (error) {
      console.error(
        "Performance appraisal individual-goal persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowIndividualGoalError(
        "The individual goal could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderIndividualGoals();
    // BEXHR PA LIVE CONFIGURATION SYNC - R-01
    bexPaPopulateProgressUpdateIndividualGoals();
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

    const action =
      button.dataset.bexPaIndividualGoalAction;

    if (action === "edit") {
      bexPaOpenIndividualGoalDialog(
        individualGoalId,
      );

      return;
    }

    if (action === "progress") {
      bexPaOpenProgressUpdateDialog(
        individualGoalId,
      );
    }
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
          bexPaCreateGoalIdentityMeta(
            "Owner",
            departmentGoal.owner,
          );

        meta.append(
          ownerLabel,
          departmentLabel,
          organisationGoalLabel,
          cycleLabel,
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

        if (bexPaCanManageDepartmentGoal(departmentGoal)) {
          actions.appendChild(
            bexPaCreateDepartmentGoalActionButton(
              departmentGoal.id,
            ),
          );
        }

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

  async function bexPaHandleDepartmentGoalSubmit(event) {
    event.preventDefault();

    if (!bexPaCanManageDepartmentGoals()) {
      return;
    }
    bexPaClearDepartmentGoalError();

    bexPaRememberFormValues("departmentGoal", {
      organisationGoalId: bexPaElements.departmentGoalOrganisationGoal.value,
      departmentId: bexPaElements.departmentGoalDepartment.value,
      title: bexPaElements.departmentGoalTitle.value,
      description: bexPaElements.departmentGoalDescription.value,
      target: bexPaElements.departmentGoalTarget.value,
      owner: bexPaElements.departmentGoalOwner.value,
      status: bexPaElements.departmentGoalStatus.value,
      startDate: bexPaElements.departmentGoalStartDate.value,
      dueDate: bexPaElements.departmentGoalDueDate.value,
    });

    const organisationGoal =
      bexPaState.organisationGoals.find(
        (goal) =>
          goal.id ===
          bexPaElements.departmentGoalOrganisationGoal.value,
      );

    const selectedDepartmentId =
      bexPaElements.departmentGoalDepartment.value
        .trim();

    const selectedDepartment =
      bexPaGetAvailableDepartments().find(
        (department) =>
          department.id === selectedDepartmentId,
      );

    if (!selectedDepartment) {
      bexPaShowDepartmentGoalError(
        "Select one valid BexHR department.",
      );
      return;
    }

    const departmentGoal = {
      id:
        bexPaState.editingDepartmentGoalId ||
        `BEX-PA-DEPT-GOAL-${Date.now()}`,

      organisationGoalId:
        bexPaElements.departmentGoalOrganisationGoal.value,

      cycleId:
        organisationGoal?.cycleId || "",

      department:
        selectedDepartment.name,

      departmentId:
        selectedDepartment.id,

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

    if (!bexPaCanManageDepartmentGoal(departmentGoal)) {
      bexPaShowDepartmentGoalError(
        "You can only manage goals for departments within your Primary reporting scope.",
      );
      return;
    }

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

    try {
      await bexPaPersistDatasetMutation(
        "departmentGoals",
        departmentGoal,
        bexPaSaveDepartmentGoals,
      );
    } catch (error) {
      console.error(
        "Performance appraisal department-goal persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowDepartmentGoalError(
        "The department goal could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderDepartmentGoals();
    // BEXHR PA LIVE CONFIGURATION SYNC - R-01
    bexPaPopulateIndividualGoalDepartmentGoals();
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

      const ownerLabel = bexPaCreateGoalIdentityMeta(
        "Owner",
        deliverable.owner,
      );

      meta.append(
        ownerLabel,
        goalLabel,
        cycleLabel,
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

      if (bexPaCanManageGoalFramework()) {
        actions.appendChild(
          bexPaCreateDeliverableActionButton(
            deliverable.id,
          ),
        );
      }

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

  async function bexPaHandleDeliverableSubmit(event) {
    event.preventDefault();

    if (!bexPaCanManageGoalFramework()) {
      return;
    }
    bexPaClearDeliverableError();

    bexPaRememberFormValues("deliverable", {
      organisationGoalId: bexPaElements.deliverableOrganisationGoal.value,
      title: bexPaElements.deliverableTitle.value,
      description: bexPaElements.deliverableDescription.value,
      target: bexPaElements.deliverableTarget.value,
      owner: bexPaElements.deliverableOwner.value,
      status: bexPaElements.deliverableStatus.value,
      startDate: bexPaElements.deliverableStartDate.value,
      dueDate: bexPaElements.deliverableDueDate.value,
    });

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

    try {
      await bexPaPersistDatasetMutation(
        "deliverables",
        deliverable,
        bexPaSaveDeliverables,
      );
    } catch (error) {
      console.error(
        "BexHR Performance Appraisal could not persist the deliverable.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
          bexPaRenderDeliverables();
        } catch (recoveryError) {
          console.error(
            "BexHR Performance Appraisal could not restore deliverables after the persistence failure.",
            recoveryError,
          );
        }
      }

      bexPaShowDeliverableError(
        "The organisational deliverable could not be saved. Please try again.",
      );
      return;
    }
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

      const ownerLabel = bexPaCreateGoalIdentityMeta(
        "Owner",
        goal.owner,
      );

      meta.append(
        ownerLabel,
        cycleLabel,
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

      if (bexPaCanManageGoalFramework()) {
        actions.appendChild(
          bexPaCreateOrganisationGoalActionButton(
            goal.id,
          ),
        );
      }

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

  async function bexPaHandleOrganisationGoalSubmit(event) {
    event.preventDefault();

    if (!bexPaCanManageGoalFramework()) {
      return;
    }
    bexPaClearOrganisationGoalError();

    bexPaRememberFormValues("organisationGoal", {
      cycleId: bexPaElements.organisationGoalCycle.value,
      title: bexPaElements.organisationGoalTitle.value,
      description: bexPaElements.organisationGoalDescription.value,
      target: bexPaElements.organisationGoalTarget.value,
      owner: bexPaElements.organisationGoalOwner.value,
      status: bexPaElements.organisationGoalStatus.value,
      startDate: bexPaElements.organisationGoalStartDate.value,
      dueDate: bexPaElements.organisationGoalDueDate.value,
    });

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

    try {
      await bexPaPersistDatasetMutation(
        "organisationGoals",
        goal,
        bexPaSaveOrganisationGoals,
      );
    } catch (error) {
      console.error(
        "Performance appraisal organisation-goal persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowOrganisationGoalError(
        "The organisation goal could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderOrganisationGoals();
    // BEXHR PA LIVE CONFIGURATION SYNC - R-01
    bexPaPopulateDeliverableOrganisationGoals();
    bexPaPopulateDepartmentGoalOrganisationGoals();
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

  function bexPaClearTemplateError() {
    if (!bexPaElements.templateFormError) {
      return;
    }

    bexPaElements.templateFormError.textContent = "";
    bexPaElements.templateFormError.classList.add(
      "d-none",
    );
  }

  function bexPaShowTemplateError(message) {
    if (!bexPaElements.templateFormError) {
      return;
    }

    bexPaElements.templateFormError.textContent =
      message;

    bexPaElements.templateFormError.classList.remove(
      "d-none",
    );
  }

  function bexPaResetTemplateCompetencyEditor() {
    bexPaState.editingTemplateCompetencyId = null;

    if (bexPaElements.templateCompetencyName) {
      bexPaElements.templateCompetencyName.value = "";
    }

    if (bexPaElements.templateCompetencyDescription) {
      bexPaElements.templateCompetencyDescription.value = "";
    }

    if (bexPaElements.templateCompetencyApplicability) {
      bexPaElements.templateCompetencyApplicability.value =
        "All Employees";
    }

    if (bexPaElements.templateCompetencyOrder) {
      bexPaElements.templateCompetencyOrder.value =
        String(
          bexPaState.templateCompetencies.length + 1,
        );
    }

    if (bexPaElements.saveTemplateCompetencyButton) {
      bexPaElements.saveTemplateCompetencyButton.textContent =
        "Add Assessment Area";
    }
  }

  function bexPaOpenTemplateCompetencyEditor() {
    if (!bexPaCanManageTemplates()) {
      return;
    }

    bexPaResetTemplateCompetencyEditor();

    bexPaElements.templateCompetencyEditor?.classList.remove(
      "d-none",
    );

    window.requestAnimationFrame(() => {
      bexPaElements.templateCompetencyName?.focus();
    });
  }

  function bexPaCloseTemplateCompetencyEditor() {
    bexPaElements.templateCompetencyEditor?.classList.add(
      "d-none",
    );

    bexPaResetTemplateCompetencyEditor();
  }

  function bexPaValidateTemplateCompetency(
    competency,
  ) {
    if (
      !competency.name ||
      !competency.description ||
      !competency.applicability ||
      !competency.order
    ) {
      return "Complete all assessment area fields before adding.";
    }

    const allowedApplicability = [
      "All Employees",
      "Supervisors & Managers",
    ];

    if (
      !allowedApplicability.includes(
        competency.applicability,
      )
    ) {
      return "Select who this assessment area applies to.";
    }

    if (
      !Number.isInteger(competency.order) ||
      competency.order < 1
    ) {
      return "Display order must be a whole number greater than 0.";
    }

    const duplicateName =
      bexPaState.templateCompetencies.some(
        (existingCompetency) =>
          existingCompetency.id !==
          bexPaState.editingTemplateCompetencyId &&
          existingCompetency.name.toLowerCase() ===
          competency.name.toLowerCase(),
      );

    if (duplicateName) {
      return "An assessment area with this name already exists.";
    }

    return "";
  }

  function bexPaHandleTemplateCompetencySave() {
    if (!bexPaCanManageTemplates()) {
      return;
    }

    bexPaClearTemplateError();

    const competency = {
      id:
        bexPaState.editingTemplateCompetencyId ||
        `BEX-PA-COMPETENCY-${Date.now()}`,

      name:
        bexPaElements.templateCompetencyName.value.trim(),

      description:
        bexPaElements.templateCompetencyDescription.value.trim(),

      applicability:
        bexPaElements.templateCompetencyApplicability.value,

      order:
        Number(
          bexPaElements.templateCompetencyOrder.value,
        ),
    };

    const validationError =
      bexPaValidateTemplateCompetency(
        competency,
      );

    if (validationError) {
      bexPaShowTemplateError(
        validationError,
      );
      return;
    }

    if (bexPaState.editingTemplateCompetencyId) {
      const competencyIndex =
        bexPaState.templateCompetencies.findIndex(
          (existingCompetency) =>
            existingCompetency.id ===
            bexPaState.editingTemplateCompetencyId,
        );

      if (competencyIndex === -1) {
        bexPaShowTemplateError(
          "The assessment area could not be found."
        );
        return;
      }

      bexPaState.templateCompetencies[
        competencyIndex
      ] = competency;
    } else {
      bexPaState.templateCompetencies.push(
        competency,
      );
    }

    bexPaState.templateCompetencies.sort(
      (firstCompetency, secondCompetency) =>
        firstCompetency.order -
        secondCompetency.order,
    );

    bexPaRenderTemplateCompetencies();
    bexPaCloseTemplateCompetencyEditor();
  }

  function bexPaRenderTemplateCompetencies() {
    if (!bexPaElements.templateCompetenciesList) {
      return;
    }

    bexPaElements.templateCompetenciesList.replaceChildren();

    const competencies =
      [...bexPaState.templateCompetencies].sort(
        (firstCompetency, secondCompetency) =>
          firstCompetency.order -
          secondCompetency.order,
      );

    if (bexPaElements.templateCompetenciesEmpty) {
      bexPaElements.templateCompetenciesEmpty.classList.toggle(
        "d-none",
        competencies.length > 0,
      );
    }

    competencies.forEach((competency) => {
      const item = document.createElement("div");

      item.className =
        "border rounded-3 p-3";

      const header =
        document.createElement("div");

      header.className =
        "d-flex align-items-start justify-content-between gap-3";

      const titleArea =
        document.createElement("div");

      const title =
        document.createElement("h4");

      title.className =
        "h6 mb-1";

      title.textContent =
        `${competency.order}. ${competency.name}`;

      const applicability =
        document.createElement("p");

      applicability.className =
        "mb-1 small text-body-secondary";

      applicability.textContent =
        competency.applicability;

      const description =
        document.createElement("p");

      description.className =
        "mb-0 small text-body-secondary";

      description.textContent =
        competency.description;

      titleArea.append(
        title,
        applicability,
        description,
      );

      const actions =
        document.createElement("div");

      actions.className =
        "d-flex align-items-center gap-2";

      const editButton =
        document.createElement("button");

      editButton.type = "button";
      editButton.className =
        "btn btn-sm btn-outline-secondary";

      editButton.dataset.bexPaTemplateCompetencyAction =
        "edit";

      editButton.dataset.bexPaTemplateCompetencyId =
        competency.id;

      editButton.innerHTML =
        '<i class="bi bi-pencil" aria-hidden="true"></i>';

      editButton.title =
        `Edit ${competency.name}`;

      editButton.setAttribute(
        "aria-label",
        `Edit ${competency.name}`,
      );

      const removeButton =
        document.createElement("button");

      removeButton.type = "button";
      removeButton.className =
        "btn btn-sm btn-outline-danger";

      removeButton.dataset.bexPaTemplateCompetencyAction =
        "remove";

      removeButton.dataset.bexPaTemplateCompetencyId =
        competency.id;

      removeButton.innerHTML =
        '<i class="bi bi-trash" aria-hidden="true"></i>';

      removeButton.title =
        `Remove ${competency.name}`;

      removeButton.setAttribute(
        "aria-label",
        `Remove ${competency.name}`,
      );

      actions.append(
        editButton,
        removeButton,
      );

      header.append(
        titleArea,
        actions,
      );

      item.appendChild(
        header,
      );

      bexPaElements.templateCompetenciesList.appendChild(
        item,
      );
    });
  }

  function bexPaHandleTemplateCompetencyListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-template-competency-action]",
    );

    if (!button) {
      return;
    }

    const competencyId =
      button.dataset.bexPaTemplateCompetencyId;

    if (!competencyId) {
      return;
    }

    const action =
      button.dataset.bexPaTemplateCompetencyAction;

    if (action === "remove") {
      bexPaState.templateCompetencies =
        bexPaState.templateCompetencies.filter(
          (existingCompetency) =>
            existingCompetency.id !== competencyId,
        );

      bexPaRenderTemplateCompetencies();
      bexPaCloseTemplateCompetencyEditor();

      return;
    }

    const competency =
      bexPaState.templateCompetencies.find(
        (existingCompetency) =>
          existingCompetency.id === competencyId,
      );

    if (!competency) {
      return;
    }

    if (action !== "edit") {
      return;
    }

    bexPaState.editingTemplateCompetencyId =
      competency.id;

    bexPaElements.templateCompetencyName.value =
      competency.name;

    bexPaElements.templateCompetencyDescription.value =
      competency.description;

    bexPaElements.templateCompetencyApplicability.value =
      competency.applicability;

    bexPaElements.templateCompetencyOrder.value =
      String(competency.order);

    bexPaElements.saveTemplateCompetencyButton.textContent =
      "Save Assessment Area";

    bexPaElements.templateCompetencyEditor?.classList.remove(
      "d-none",
    );

    window.requestAnimationFrame(() => {
      bexPaElements.templateCompetencyName?.focus();
    });
  }

  function bexPaSyncTemplateRatingScale() {
    if (
      !bexPaElements.templateRatingsList ||
      !bexPaElements.templateRatingScale
    ) {
      return;
    }

    const ratings = [
      ...bexPaElements.templateRatingsList.querySelectorAll(
        "[data-bex-pa-template-rating]",
      ),
    ]
      .map((input) => input.value.trim())
      .filter(Boolean);

    bexPaElements.templateRatingScale.value =
      ratings.join("\n");

    bexPaElements.templateRatingsEmpty?.classList.toggle(
      "d-none",
      ratings.length > 0,
    );
  }

  function bexPaAddTemplateRatingRow(
    ratingValue = "",
  ) {
    if (!bexPaElements.templateRatingsList) {
      return null;
    }

    const row = document.createElement("div");
    row.className =
      "d-flex align-items-center gap-2";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.maxLength = 120;
    input.placeholder =
      "e.g. Meets Expectations";
    input.value = ratingValue;
    input.dataset.bexPaTemplateRating = "";

    const removeButton =
      document.createElement("button");

    removeButton.type = "button";
    removeButton.className =
      "btn btn-outline-danger";

    removeButton.innerHTML =
      '<i class="bi bi-trash" aria-hidden="true"></i>';

    removeButton.title =
      "Remove rating option";

    removeButton.setAttribute(
      "aria-label",
      "Remove rating option",
    );

    input.addEventListener(
      "input",
      bexPaSyncTemplateRatingScale,
    );

    removeButton.addEventListener(
      "click",
      () => {
        row.remove();
        bexPaSyncTemplateRatingScale();
      },
    );

    row.append(
      input,
      removeButton,
    );

    bexPaElements.templateRatingsList.appendChild(
      row,
    );

    bexPaSyncTemplateRatingScale();

    return input;
  }

  function bexPaRenderTemplateRatings() {
    if (
      !bexPaElements.templateRatingsList ||
      !bexPaElements.templateRatingScale
    ) {
      return;
    }

    const ratings =
      bexPaElements.templateRatingScale.value
        .split("\n")
        .map((rating) => rating.trim())
        .filter(Boolean);

    bexPaElements.templateRatingsList.replaceChildren();

    ratings.forEach((rating) => {
      bexPaAddTemplateRatingRow(rating);
    });

    bexPaElements.templateRatingsEmpty?.classList.toggle(
      "d-none",
      ratings.length > 0,
    );
  }

  function bexPaResetTemplateForm() {
    bexPaState.editingTemplateId = null;

    bexPaElements.templateForm?.reset();
    bexPaClearTemplateError();

    bexPaRenderTemplateRatings();

    bexPaState.templateCompetencies = [];
    bexPaRenderTemplateCompetencies();
    bexPaCloseTemplateCompetencyEditor();

    if (bexPaElements.templateDialogTitle) {
      bexPaElements.templateDialogTitle.textContent =
        "Add Appraisal Template";
    }

    if (bexPaElements.templateSubmitButton) {
      bexPaElements.templateSubmitButton.textContent =
        "Save Template";
    }
  }

  function bexPaOpenTemplateDialog(
    templateId = null,
  ) {
    if (!bexPaCanManageTemplates()) {
      return;
    }

    bexPaResetTemplateForm();

    const rememberedValues =
      bexPaGetRememberedFormValues(
        "template",
      );

    if (!templateId) {
      bexPaApplyRememberedValues([
        [
          bexPaElements.templateName,
          rememberedValues.name,
        ],
        [
          bexPaElements.templateDescription,
          rememberedValues.description,
        ],
        [
          bexPaElements.templateStatus,
          rememberedValues.status,
        ],
      ]);

      if (
        Array.isArray(
          rememberedValues.ratingScale,
        ) &&
        rememberedValues.ratingScale.length > 0
      ) {
        bexPaElements.templateRatingScale.value =
          rememberedValues.ratingScale.join("\n");

        bexPaRenderTemplateRatings();
      }

      if (
        Array.isArray(
          rememberedValues.competencies,
        )
      ) {
        bexPaState.templateCompetencies =
          rememberedValues.competencies.map(
            (competency) => ({
              ...competency,
            }),
          );

        bexPaRenderTemplateCompetencies();
      }
    }

    if (bexPaElements.templateInUseWarning) {
      const templateIsInUse =
        Boolean(templateId) &&
        bexPaState.cycles.some(
          (cycle) =>
            cycle.templateId === templateId &&
            cycle.status !== "Draft",
        );

      bexPaElements.templateInUseWarning.classList.toggle(
        "d-none",
        !templateIsInUse,
      );
    }

    if (templateId) {
      const template =
        bexPaState.templates.find(
          (existingTemplate) =>
            existingTemplate.id === templateId,
        );

      if (!template) {
        return;
      }

      bexPaState.editingTemplateId =
        template.id;

      bexPaElements.templateDialogTitle.textContent =
        "Edit Appraisal Template";

      bexPaElements.templateSubmitButton.textContent =
        "Save Changes";

      bexPaElements.templateName.value =
        template.name;

      bexPaElements.templateDescription.value =
        template.description;

      bexPaElements.templateStatus.value =
        template.status;

      bexPaElements.templateRatingScale.value =
        Array.isArray(template.ratingScale)
          ? template.ratingScale.join("\n")
          : "";

      bexPaRenderTemplateRatings();

      bexPaState.templateCompetencies =
        Array.isArray(template.competencies)
          ? template.competencies.map(
            (competency) => ({
              ...competency,
            }),
          )
          : [];

      bexPaRenderTemplateCompetencies();
    }

    bexPaElements.templateDialog?.showModal();

    window.requestAnimationFrame(() => {
      bexPaElements.templateName?.focus();
    });
  }

  function bexPaCloseTemplateDialog() {
    bexPaElements.templateDialog?.close();
    bexPaResetTemplateForm();
  }

  function bexPaValidateTemplate(template) {
    if (
      !template.name ||
      !template.description ||
      !template.status ||
      !Array.isArray(template.ratingScale) ||
      template.ratingScale.length === 0
    ) {
      return "Complete all appraisal template fields before saving.";
    }

    const allowedStatuses = [
      "Draft",
      "Active",
      "Inactive",
    ];

    if (!allowedStatuses.includes(template.status)) {
      return "Select a valid template status.";
    }

    if (template.ratingScale.length < 2) {
      return "Add at least two rating levels.";
    }

    const duplicateRating =
      template.ratingScale.some(
        (rating, index) =>
          template.ratingScale.findIndex(
            (existingRating) =>
              existingRating.toLowerCase() ===
              rating.toLowerCase(),
          ) !== index,
      );

    if (duplicateRating) {
      return "Rating levels must be unique.";
    }

    const duplicateTemplate =
      bexPaState.templates.some(
        (existingTemplate) =>
          existingTemplate.id !==
          bexPaState.editingTemplateId &&
          existingTemplate.name.toLowerCase() ===
          template.name.toLowerCase(),
      );

    if (duplicateTemplate) {
      return "An appraisal template with this name already exists.";
    }

    return "";
  }

  function bexPaCreateTemplateActionButton(
    templateId,
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "btn btn-sm btn-outline-secondary bex-pa-template-edit-button";

    button.dataset.bexPaTemplateAction = "edit";
    button.dataset.bexPaTemplateId =
      templateId;

    button.innerHTML =
      '<i class="bi bi-pencil" aria-hidden="true"></i>';

    button.title = "Edit appraisal template";
    button.setAttribute(
      "aria-label",
      "Edit appraisal template",
    );

    return button;
  }

  function bexPaRenderTemplates() {
    if (!bexPaElements.templatesList) {
      return;
    }

    bexPaElements.templatesList.replaceChildren();

    if (bexPaState.templates.length === 0) {
      const emptyState =
        document.createElement("p");

      emptyState.className =
        "bex-pa-template-empty mb-0 text-body-secondary";

      emptyState.id = "bexPaTemplatesEmpty";

      emptyState.textContent =
        "No appraisal templates have been created yet.";

      bexPaElements.templatesList.appendChild(
        emptyState,
      );

      return;
    }

    bexPaState.templates.forEach((template) => {
      const item =
        document.createElement("article");

      item.className = "bex-pa-template-item";

      const header =
        document.createElement("div");

      header.className =
        "bex-pa-template-item-header";

      const titleArea =
        document.createElement("div");

      titleArea.className =
        "bex-pa-template-item-heading";

      const title =
        document.createElement("h3");

      title.className =
        "bex-pa-template-item-title";

      title.textContent =
        template.name;

      const status =
        document.createElement("span");

      status.className =
        "bex-pa-template-status";

      status.dataset.status =
        template.status.toLowerCase();

      status.textContent =
        template.status;

      const description =
        document.createElement("p");

      description.className =
        "bex-pa-template-description";

      description.textContent =
        template.description;

      const detailGrid =
        document.createElement("div");

      detailGrid.className =
        "bex-pa-template-detail-grid";

      const ratingDetail =
        document.createElement("section");

      ratingDetail.className =
        "bex-pa-template-detail-block";

      const ratingHeading =
        document.createElement("p");

      ratingHeading.className =
        "bex-pa-template-detail-label";

      ratingHeading.textContent =
        "Rating scale";

      const ratingScale =
        document.createElement("ol");

      ratingScale.className =
        "bex-pa-template-rating-list";

      const templateRatings =
        Array.isArray(template.ratingScale)
          ? template.ratingScale
          : [];

      templateRatings.forEach((rating) => {
        const ratingItem =
          document.createElement("li");

        ratingItem.className =
          "bex-pa-template-rating-item";

        ratingItem.textContent = rating;

        ratingScale.appendChild(
          ratingItem,
        );
      });

      ratingDetail.append(
        ratingHeading,
        ratingScale,
      );

      const competencyDetail =
        document.createElement("section");

      competencyDetail.className =
        "bex-pa-template-detail-block bex-pa-template-competency-detail";

      const competencyHeading =
        document.createElement("p");

      competencyHeading.className =
        "bex-pa-template-detail-label";

      competencyHeading.textContent =
        "Assessment areas";

      const templateCompetencies =
        Array.isArray(template.competencies)
          ? template.competencies
          : [];

      const competencySummary =
        document.createElement("div");

      competencySummary.className =
        "bex-pa-template-competency-summary";

      const competencyIcon =
        document.createElement("span");

      competencyIcon.className =
        "bex-pa-template-competency-icon";

      competencyIcon.setAttribute(
        "aria-hidden",
        "true",
      );

      competencyIcon.innerHTML =
        '<i class="bi bi-ui-checks-grid"></i>';

      const competencyValue =
        document.createElement("strong");

      competencyValue.textContent =
        `${templateCompetencies.length} ${templateCompetencies.length === 1
          ? "area"
          : "areas"
        } configured`;

      competencySummary.append(
        competencyIcon,
        competencyValue,
      );

      competencyDetail.append(
        competencyHeading,
        competencySummary,
      );

      detailGrid.append(
        ratingDetail,
        competencyDetail,
      );

      const actions =
        document.createElement("div");

      actions.className =
        "bex-pa-template-item-actions";

      if (bexPaCanManageTemplates()) {
        actions.appendChild(
          bexPaCreateTemplateActionButton(
            template.id,
          ),
        );
      }

      titleArea.appendChild(title);

      header.append(
        titleArea,
        status,
      );

      item.append(
        header,
        description,
        detailGrid,
        actions,
      );

      bexPaElements.templatesList.appendChild(
        item,
      );
    });
  }

  async function bexPaHandleTemplateSubmit(event) {
    event.preventDefault();

    if (!bexPaCanManageTemplates()) {
      return;
    }

    bexPaClearTemplateError();

    const template = {
      id:
        bexPaState.editingTemplateId ||
        `BEX-PA-TEMPLATE-${Date.now()}`,

      name:
        bexPaElements.templateName.value.trim(),

      description:
        bexPaElements.templateDescription.value.trim(),

      status:
        bexPaElements.templateStatus.value,

      ratingScale:
        bexPaElements.templateRatingScale.value
          .split("\n")
          .map((rating) => rating.trim())
          .filter(Boolean),

      competencies:
        bexPaState.templateCompetencies.map(
          (competency) => ({
            ...competency,
          }),
        ),
    };

    const validationError =
      bexPaValidateTemplate(template);

    if (validationError) {
      bexPaShowTemplateError(
        validationError,
      );
      return;
    }

    bexPaRememberFormValues(
      "template",
      {
        name:
          template.name,

        description:
          template.description,

        status:
          template.status,

        ratingScale:
          [...template.ratingScale],

        competencies:
          template.competencies.map(
            (competency) => ({
              ...competency,
            }),
          ),
      },
    );

    const wasEditing = Boolean(
      bexPaState.editingTemplateId,
    );

    if (wasEditing) {
      const templateIndex =
        bexPaState.templates.findIndex(
          (existingTemplate) =>
            existingTemplate.id ===
            bexPaState.editingTemplateId,
        );

      if (templateIndex === -1) {
        bexPaShowTemplateError(
          "The appraisal template could not be found.",
        );
        return;
      }

      bexPaState.templates[
        templateIndex
      ] = template;
    } else {
      bexPaState.templates.push(template);
    }

    try {
      await bexPaPersistDatasetMutation(
        "templates",
        template,
        bexPaSaveTemplates,
      );
    } catch (error) {
      console.error(
        "Performance appraisal template persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowTemplateError(
        "The appraisal template could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderTemplates();
    // BEXHR PA LIVE CONFIGURATION SYNC - R-01
    bexPaPopulateCycleTemplates();
    bexPaCloseTemplateDialog();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        wasEditing
          ? `${template.name} was updated successfully.`
          : `${template.name} was created successfully.`;
    }
  }

  function bexPaHandleTemplateListAction(
    event,
  ) {
    const button = event.target.closest(
      "[data-bex-pa-template-action]",
    );

    if (!button) {
      return;
    }

    const templateId =
      button.dataset.bexPaTemplateId;

    if (!templateId) {
      return;
    }

    bexPaOpenTemplateDialog(
      templateId,
    );
  }

  function bexPaGetAppraisalTemplate(appraisal) {
    if (
      appraisal?.templateSnapshot &&
      typeof appraisal.templateSnapshot === "object"
    ) {
      return appraisal.templateSnapshot;
    }

    return bexPaState.templates.find(
      (existingTemplate) =>
        existingTemplate.id === appraisal?.templateId,
    ) || null;
  }

  function bexPaGetEligibleEmployeeAppraisals() {
    const currentEmployeeId =
      bexPaGetCurrentEmployeeId();

    if (!currentEmployeeId) {
      return [];
    }

    return bexPaState.employeeAppraisals.filter(
      (appraisal) => {
        const cycle = bexPaState.cycles.find(
          (existingCycle) =>
            existingCycle.id === appraisal.cycleId,
        );

        const template =
          bexPaGetAppraisalTemplate(appraisal);

        return (
          appraisal.employeeId === currentEmployeeId &&
          appraisal.status === "Draft" &&
          cycle?.status === "Active" &&
          Boolean(template)
        );
      },
    );
  }

  function bexPaGetEligibleManagerAppraisals() {
    if (!bexPaIsPrimaryManagerMode()) {
      return [];
    }

    const managedEmployeeIds =
      bexPaGetManagedEmployeeIds();

    if (managedEmployeeIds.length === 0) {
      return [];
    }

    return bexPaState.employeeAppraisals.filter(
      (appraisal) => {
        const cycle = bexPaState.cycles.find(
          (existingCycle) =>
            existingCycle.id === appraisal.cycleId,
        );

        const template =
          bexPaGetAppraisalTemplate(appraisal);

        const selfAppraisal =
          bexPaState.selfAppraisals.find(
            (existingSelfAppraisal) =>
              existingSelfAppraisal.appraisalId ===
              appraisal.id,
          );

        return (
          managedEmployeeIds.includes(appraisal.employeeId) &&
          Boolean(cycle) &&
          Boolean(template) &&
          selfAppraisal?.status === "Submitted"
        );
      },
    );
  }

  function bexPaGetVisibleEmployeeAppraisals() {
    const activeMode = bexPaGetActiveMode();

    if (activeMode === "employee") {
      const currentEmployeeId =
        bexPaGetCurrentEmployeeId();

      if (!currentEmployeeId) {
        return [];
      }

      return bexPaState.employeeAppraisals.filter(
        (appraisal) =>
          appraisal.employeeId === currentEmployeeId,
      );
    }

    if (activeMode === "hr-standard") {
      const visibleEmployeeIds =
        bexPaGetAvailableEmployees()
          .map((employee) =>
            String(employee?.id || "").trim(),
          )
          .filter(Boolean);

      if (visibleEmployeeIds.length === 0) {
        return [];
      }

      return bexPaState.employeeAppraisals.filter(
        (appraisal) =>
          visibleEmployeeIds.includes(
            String(
              appraisal?.employeeId || "",
            ).trim(),
          ),
      );
    }

    if (activeMode === "primary-manager") {
      const visibleEmployeeIds = [
        ...new Set([
          ...bexPaGetManagedEmployeeIds(),
          ...bexPaGetSecondaryEmployeeIds(),
        ]),
      ];

      if (visibleEmployeeIds.length === 0) {
        return [];
      }

      return bexPaState.employeeAppraisals.filter(
        (appraisal) =>
          visibleEmployeeIds.includes(
            appraisal.employeeId,
          ),
      );
    }

    if (activeMode === "hr-admin") {
      return bexPaState.employeeAppraisals;
    }

    return [];
  }

  function bexPaHasSavedDraft(draft) {
    return Boolean(
      draft &&
      draft.status === "Draft" &&
      (
        draft.updatedAt ||
        draft.competencyResponses?.some(
          (response) =>
            response.rating ||
            response.comment,
        ) ||
        draft.goalResponses?.some(
          (response) =>
            response.achievement ||
            response.rating ||
            response.comment,
        ) ||
        draft.employeeAchievement ||
        draft.overallSummary ||
        draft.overallComment
      ),
    );
  }

  function bexPaGetDraftDisplayStatus(draft) {
    if (draft?.status === "Submitted") {
      return "Submitted";
    }

    return bexPaHasSavedDraft(draft)
      ? "In Progress"
      : "Not Started";
  }

  function bexPaGetOperationalAppraisalStatus(
    appraisal,
  ) {
    if (!appraisal?.id) {
      return "";
    }

    const selfAppraisal =
      bexPaState.selfAppraisals.find(
        (existingSelfAppraisal) =>
          existingSelfAppraisal.appraisalId ===
          appraisal.id,
      );

    const managerAppraisal =
      bexPaState.managerAppraisals.find(
        (existingManagerAppraisal) =>
          existingManagerAppraisal.appraisalId ===
          appraisal.id,
      );

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId ===
          appraisal.id,
      );

    const acknowledgement =
      bexPaState.employeeAcknowledgements.find(
        (existingAcknowledgement) =>
          existingAcknowledgement.appraisalId ===
          appraisal.id,
      );

    if (
      acknowledgement?.status ===
      "Acknowledged"
    ) {
      return "Acknowledged";
    }

    if (
      hrFinalisation?.status ===
      "Finalised"
    ) {
      return "Finalised";
    }

    if (
      selfAppraisal?.status === "Submitted" &&
      managerAppraisal?.status === "Submitted"
    ) {
      return "Submitted";
    }

    if (
      selfAppraisal?.status === "Submitted" ||
      managerAppraisal?.status === "Submitted" ||
      bexPaHasSavedDraft(selfAppraisal) ||
      bexPaHasSavedDraft(managerAppraisal)
    ) {
      return "In Progress";
    }

    return "Assigned";
  }

  function bexPaGetOperationalReportRecords() {
    return bexPaState.employeeAppraisals.map(
      (appraisal) => ({
        appraisal,
        cycle: bexPaState.cycles.find(
          (cycle) =>
            cycle.id === appraisal.cycleId,
        ) || null,
        status:
          bexPaGetOperationalAppraisalStatus(
            appraisal,
          ),
      }),
    );
  }

  function bexPaGetOperationalReportCounts(
    records,
  ) {
    const counts = {
      assigned: 0,
      inProgress: 0,
      submitted: 0,
      finalised: 0,
      acknowledged: 0,
      total: 0,
    };

    records.forEach((record) => {
      switch (record.status) {
        case "Assigned":
          counts.assigned += 1;
          break;

        case "In Progress":
          counts.inProgress += 1;
          break;

        case "Submitted":
          counts.submitted += 1;
          break;

        case "Finalised":
          counts.finalised += 1;
          break;

        case "Acknowledged":
          counts.acknowledged += 1;
          break;

        default:
          break;
      }
    });

    counts.total =
      counts.assigned +
      counts.inProgress +
      counts.submitted +
      counts.finalised +
      counts.acknowledged;

    return counts;
  }

  // =========================================================
  // PA EMPLOYEE OVERVIEW COMPLETION - STAGE 7E
  // Extend the approved Overview structure for My Appraisal only.
  // Uses existing employee-scoped appraisal state and cycle milestones.
  // HR Administration behavior remains unchanged.
  // =========================================================
  // PA MANAGER OVERVIEW COMPLETION - STAGE 7F
  // Extend the same approved Overview structure for Manager Reviews.
  // Manager action metrics use primary-manager eligibility while
  // team visibility continues to include the existing secondary scope.
  // =========================================================
  function bexPaRenderOverviewReadiness() {
    const readiness =
      bexPaElements.overviewReadiness;

    if (!readiness) {
      return;
    }

    const isEmployeeOverview =
      bexPaIsEmployeeMode();
    const isManagerOverview =
      bexPaIsManagerReviewMode();
    const isHrStandardOverview =
      bexPaIsHrStandardMode();

    const canShowReadiness =
      bexPaIsHrAdminMode() ||
      isEmployeeOverview ||
      isManagerOverview ||
      isHrStandardOverview;

    readiness.classList.toggle(
      "d-none",
      !canShowReadiness,
    );

    if (!canShowReadiness) {
      return;
    }

    const readinessKicker =
      readiness.querySelector(
        ".bex-pa-overview-section-kicker",
      );
    const readinessTitle =
      document.getElementById(
        "bexPaOverviewReadinessTitle",
      );

    if (isEmployeeOverview) {
      if (readinessKicker) {
        readinessKicker.textContent =
          "My appraisal progress";
      }

      if (readinessTitle) {
        readinessTitle.textContent =
          "Active-cycle completion";
      }

      bexPaElements.overviewCompletionProgress
        ?.setAttribute(
          "aria-label",
          "My active-cycle appraisal completion",
        );
    } else if (isManagerOverview) {
      if (readinessKicker) {
        readinessKicker.textContent =
          "Manager review progress";
      }

      if (readinessTitle) {
        readinessTitle.textContent =
          "Review queue completion";
      }

      bexPaElements.overviewCompletionProgress
        ?.setAttribute(
          "aria-label",
          "Manager review queue completion",
        );
    } else if (isHrStandardOverview) {
      if (readinessKicker) {
        readinessKicker.textContent =
          "Read-only progress";
      }

      if (readinessTitle) {
        readinessTitle.textContent =
          "Appraisal completion";
      }

      bexPaElements.overviewCompletionProgress
        ?.setAttribute(
          "aria-label",
          "Visible active-cycle appraisal completion",
        );
    } else {
      if (readinessKicker) {
        readinessKicker.textContent =
          "Appraisal progress";
      }

      if (readinessTitle) {
        readinessTitle.textContent =
          "Overall appraisal completion";
      }

      bexPaElements.overviewCompletionProgress
        ?.setAttribute(
          "aria-label",
          "Active-cycle appraisal completion",
        );
    }

    const activeCycleIds = new Set(
      bexPaState.cycles
        .filter(
          (cycle) => cycle.status === "Active",
        )
        .map((cycle) => cycle.id),
    );

    if (isManagerOverview) {
      const visibleActiveAppraisals =
        bexPaGetVisibleEmployeeAppraisals().filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        );

      const activeManagerReviewAppraisals =
        bexPaGetEligibleManagerAppraisals().filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        );

      const submittedManagerReviewCount =
        activeManagerReviewAppraisals.filter(
          (appraisal) =>
            bexPaState.managerAppraisals.some(
              (managerAppraisal) =>
                managerAppraisal.appraisalId ===
                  appraisal.id &&
                managerAppraisal.status ===
                  "Submitted",
            ),
        ).length;

      const managerReviewTotal =
        activeManagerReviewAppraisals.length;

      const managerReviewPercentage =
        managerReviewTotal > 0
          ? Math.round(
            (
              submittedManagerReviewCount /
              managerReviewTotal
            ) * 100,
          )
          : 0;

      if (
        bexPaElements
          .overviewCompletionPercentage
      ) {
        bexPaElements
          .overviewCompletionPercentage
          .textContent =
          `${managerReviewPercentage}%`;
      }

      if (
        bexPaElements
          .overviewCompletionProgress
      ) {
        bexPaElements
          .overviewCompletionProgress
          .setAttribute(
            "aria-valuenow",
            String(managerReviewPercentage),
          );

        bexPaElements
          .overviewCompletionProgress
          .setAttribute(
            "aria-valuetext",
            managerReviewTotal > 0
              ? `${submittedManagerReviewCount} of ${managerReviewTotal} manager reviews submitted`
              : "No manager reviews currently ready",
          );
      }

      if (
        bexPaElements.overviewCompletionBar
      ) {
        bexPaElements
          .overviewCompletionBar
          .style.width =
          `${managerReviewPercentage}%`;
      }

      if (
        !bexPaElements.overviewCompletionMessage
      ) {
        return;
      }

      if (visibleActiveAppraisals.length === 0) {
        bexPaElements
          .overviewCompletionMessage
          .textContent =
          "No active appraisals are currently in your manager review scope.";
        return;
      }

      if (bexPaGetManagedEmployeeIds().length === 0) {
        bexPaElements
          .overviewCompletionMessage
          .textContent =
          "Your current manager scope is read-only for secondary-report appraisals.";
        return;
      }

      if (managerReviewTotal === 0) {
        bexPaElements
          .overviewCompletionMessage
          .textContent =
          "No submitted self-appraisals are currently ready for manager review.";
        return;
      }

      const managerReviewPending =
        managerReviewTotal -
        submittedManagerReviewCount;

      bexPaElements
        .overviewCompletionMessage
        .textContent =
        managerReviewPending === 0
          ? "All manager-ready appraisals in your active queue have been reviewed."
          : `${submittedManagerReviewCount} of ${managerReviewTotal} manager reviews submitted. ${managerReviewPending} ready for action.`;

      return;
    }

    const readinessAppraisals =
      isEmployeeOverview ||
      isHrStandardOverview
        ? bexPaGetVisibleEmployeeAppraisals()
        : bexPaState.employeeAppraisals;

    const activeCycleRecords =
      readinessAppraisals
        .filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        )
        .map((appraisal) => ({
          appraisal,
          status:
            bexPaGetOperationalAppraisalStatus(
              appraisal,
            ),
        }));

    const counts =
      bexPaGetOperationalReportCounts(
        activeCycleRecords,
      );

    const completionPercentage =
      counts.total > 0
        ? Math.round(
          (
            counts.acknowledged /
            counts.total
          ) * 100,
        )
        : 0;

    if (
      bexPaElements
        .overviewCompletionPercentage
    ) {
      bexPaElements
        .overviewCompletionPercentage
        .textContent =
        `${completionPercentage}%`;
    }

    if (
      bexPaElements
        .overviewCompletionProgress
    ) {
      bexPaElements
        .overviewCompletionProgress
        .setAttribute(
          "aria-valuenow",
          String(completionPercentage),
        );

      bexPaElements
        .overviewCompletionProgress
        .setAttribute(
          "aria-valuetext",
          counts.total > 0
            ? `${counts.acknowledged} of ${counts.total} appraisals acknowledged`
            : "No active-cycle appraisals",
        );
    }

    if (
      bexPaElements.overviewCompletionBar
    ) {
      bexPaElements
        .overviewCompletionBar
        .style.width =
        `${completionPercentage}%`;
    }

    if (
      !bexPaElements.overviewCompletionMessage
    ) {
      return;
    }

    if (activeCycleIds.size === 0) {
      bexPaElements
        .overviewCompletionMessage
        .textContent =
        isEmployeeOverview
          ? "You do not have an active appraisal cycle right now."
          : "No active appraisal cycle is currently running.";
      return;
    }

    if (counts.total === 0) {
      bexPaElements
        .overviewCompletionMessage
        .textContent =
        isEmployeeOverview
          ? "No active-cycle appraisal is currently assigned to you."
          : isHrStandardOverview
            ? "No active-cycle appraisals are currently visible in your permitted HR scope."
            : activeCycleIds.size === 1
              ? "The active appraisal cycle has no assigned appraisals yet."
              : "The active appraisal cycles have no assigned appraisals yet.";
      return;
    }

    if (isEmployeeOverview) {
      const personalStatusSummary = [
        [counts.assigned, "not started"],
        [counts.inProgress, "in progress"],
        [counts.submitted, "awaiting HR finalisation"],
        [counts.finalised, "awaiting your acknowledgement"],
      ]
        .filter(([count]) => count > 0)
        .map(([count, label]) =>
          `${count} ${label}`,
        )
        .join("; ");

      bexPaElements
        .overviewCompletionMessage
        .textContent =
        counts.acknowledged === counts.total
          ? "Your active-cycle appraisal is complete and acknowledged."
          : `${counts.acknowledged} of ${counts.total} active-cycle appraisal${counts.total === 1 ? "" : "s"} acknowledged${personalStatusSummary ? `. ${personalStatusSummary}.` : "."}`;
      return;
    }

    const appraisalLabel =
      counts.total === 1
        ? "appraisal"
        : "appraisals";

    bexPaElements
      .overviewCompletionMessage
      .textContent =
      `${counts.acknowledged} of ${counts.total} active-cycle ${appraisalLabel} acknowledged. ` +
      `${counts.submitted} awaiting HR finalisation; ` +
      `${counts.finalised} awaiting employee acknowledgement.`;
  }

  function bexPaCreateOverviewOperationItem({
    title,
    metaItems = [],
    badgeText = "",
    badgeKind = "",
  }) {
    const item = document.createElement("article");
    item.className = "bex-pa-overview-operation-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className =
      "bex-pa-overview-operation-item-header";

    const main = document.createElement("div");
    main.className =
      "bex-pa-overview-operation-item-main";

    const titleElement = document.createElement("h3");
    titleElement.className =
      "bex-pa-overview-operation-item-title";
    titleElement.textContent = title;

    const meta = document.createElement("div");
    meta.className =
      "bex-pa-overview-operation-item-meta";

    metaItems
      .filter(Boolean)
      .forEach((text) => {
        const metaItem = document.createElement("span");
        metaItem.textContent = text;
        meta.appendChild(metaItem);
      });

    main.append(titleElement, meta);
    header.appendChild(main);

    if (badgeText) {
      const badge = document.createElement("span");
      badge.className =
        "bex-pa-overview-operation-badge";
      badge.textContent = badgeText;

      if (badgeKind) {
        badge.dataset.kind = badgeKind;
      }

      header.appendChild(badge);
    }

    item.appendChild(header);
    return item;
  }

  function bexPaCreateOverviewCycleItem(cycle) {
    const report =
      bexPaGetCycleOperationalReport(cycle);

    const participantIds = new Set(
      report.records
        .map((record) =>
          String(
            record.appraisal.employeeId || "",
          ).trim(),
        )
        .filter(Boolean),
    );

    const item = document.createElement("article");
    item.className = "bex-pa-overview-operation-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className =
      "bex-pa-overview-operation-item-header";

    const main = document.createElement("div");
    main.className =
      "bex-pa-overview-operation-item-main";

    const title = document.createElement("h3");
    title.className =
      "bex-pa-overview-operation-item-title";
    title.textContent =
      cycle.name || "Unnamed appraisal cycle";

    const dateMeta = document.createElement("div");
    dateMeta.className =
      "bex-pa-overview-operation-item-meta";

    const dateRange = document.createElement("span");
    dateRange.textContent =
      `${bexPaFormatDate(cycle.startDate)} - ${bexPaFormatDate(cycle.endDate)}`;

    const participantSummary = document.createElement("span");
    participantSummary.textContent =
      `${participantIds.size} participant${participantIds.size === 1 ? "" : "s"}`;

    const completionSummary = document.createElement("span");
    completionSummary.textContent =
      `${report.counts.acknowledged} acknowledged`;

    dateMeta.append(
      dateRange,
      participantSummary,
      completionSummary,
    );

    main.append(title, dateMeta);

    const badge = document.createElement("span");
    badge.className =
      "bex-pa-overview-operation-badge";
    badge.dataset.kind = "active";
    badge.textContent = "Active";

    header.append(main, badge);

    const milestones = document.createElement("div");
    milestones.className =
      "bex-pa-overview-cycle-milestones";

    const milestoneData = [
      ["Goal setting", cycle.goalDeadline],
      ["Self appraisal", cycle.employeeReviewDeadline],
      ["Manager review", cycle.managerReviewDeadline],
      ["HR review", cycle.hrReviewDeadline],
    ];

    milestoneData.forEach(([label, value]) => {
      const milestone = document.createElement("div");
      milestone.className =
        "bex-pa-overview-cycle-milestone";

      const milestoneLabel = document.createElement("span");
      milestoneLabel.className =
        "bex-pa-overview-cycle-milestone-label";
      milestoneLabel.textContent = label;

      const milestoneValue = document.createElement("span");
      milestoneValue.className =
        "bex-pa-overview-cycle-milestone-value";
      milestoneValue.textContent =
        bexPaFormatDate(value);

      milestone.append(
        milestoneLabel,
        milestoneValue,
      );

      milestones.appendChild(milestone);
    });

    item.append(header, milestones);
    return item;
  }

  function bexPaRenderOverviewOperations() {
    const operations =
      bexPaElements.overviewOperations;

    if (!operations) {
      return;
    }

    const isEmployeeOverview =
      bexPaIsEmployeeMode();
    const isManagerOverview =
      bexPaIsManagerReviewMode();
    const isHrStandardOverview =
      bexPaIsHrStandardMode();

    const canShowOperations =
      bexPaIsHrAdminMode() ||
      isEmployeeOverview ||
      isManagerOverview ||
      isHrStandardOverview;

    operations.classList.toggle(
      "d-none",
      !canShowOperations,
    );

    if (!canShowOperations) {
      return;
    }

    const visibleAppraisals =
      bexPaGetVisibleEmployeeAppraisals();

    if (isEmployeeOverview) {
      const activeCycleIds = new Set(
        bexPaState.cycles
          .filter(
            (cycle) => cycle.status === "Active",
          )
          .map((cycle) => cycle.id),
      );

      const activePersonalAppraisals =
        visibleAppraisals.filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        );

      const priorityTitle =
        document.getElementById(
          "bexPaOverviewPriorityTitle",
        );
      const priorityPanel =
        priorityTitle?.closest(
          ".bex-pa-overview-panel",
        );
      const priorityKicker =
        priorityPanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );
      const priorityDescription =
        priorityPanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      if (priorityKicker) {
        priorityKicker.textContent =
          "Current review";
      }

      if (priorityTitle) {
        priorityTitle.textContent =
          "My current appraisal";
      }

      if (priorityDescription) {
        priorityDescription.textContent =
          "Your active appraisal status and the next step in your review.";
      }

      if (bexPaElements.overviewPriorityCount) {
        bexPaElements.overviewPriorityCount.textContent =
          String(activePersonalAppraisals.length);
      }

      if (bexPaElements.overviewPriorityList) {
        bexPaElements.overviewPriorityList.replaceChildren();

        activePersonalAppraisals.forEach(
          (appraisal) => {
            const cycle =
              bexPaState.cycles.find(
                (existingCycle) =>
                  existingCycle.id ===
                  appraisal.cycleId,
              );
            const template =
              bexPaGetAppraisalTemplate(appraisal);
            const selfAppraisal =
              bexPaState.selfAppraisals.find(
                (existingSelfAppraisal) =>
                  existingSelfAppraisal.appraisalId ===
                  appraisal.id,
              );
            const managerAppraisal =
              bexPaState.managerAppraisals.find(
                (existingManagerAppraisal) =>
                  existingManagerAppraisal.appraisalId ===
                  appraisal.id,
              );
            const hrFinalisation =
              bexPaState.hrFinalisations.find(
                (existingFinalisation) =>
                  existingFinalisation.appraisalId ===
                  appraisal.id,
              );
            const acknowledgement =
              bexPaState.employeeAcknowledgements.find(
                (existingAcknowledgement) =>
                  existingAcknowledgement.appraisalId ===
                  appraisal.id,
              );
            const status =
              bexPaGetOperationalAppraisalStatus(
                appraisal,
              );

            let nextStep =
              "Review your appraisal record";

            if (
              acknowledgement?.status ===
              "Acknowledged"
            ) {
              nextStep =
                "Appraisal complete";
            } else if (
              hrFinalisation?.status ===
              "Finalised"
            ) {
              nextStep =
                "Review and acknowledge final appraisal";
            } else if (
              selfAppraisal?.status !==
              "Submitted"
            ) {
              nextStep =
                bexPaHasSavedDraft(
                  selfAppraisal,
                )
                  ? "Continue self-appraisal"
                  : "Start self-appraisal";
            } else if (
              managerAppraisal?.status !==
              "Submitted"
            ) {
              nextStep =
                "Awaiting manager review";
            } else {
              nextStep =
                "Awaiting HR finalisation";
            }

            const badgeKind =
              status === "Finalised"
                ? "acknowledgement"
                : status === "Submitted"
                  ? "hr"
                  : "active";

            bexPaElements.overviewPriorityList.appendChild(
              bexPaCreateOverviewOperationItem({
                title:
                  cycle?.name ||
                  "Current appraisal",
                metaItems: [
                  template?.name
                    ? `Template: ${template.name}`
                    : "",
                  `Next: ${nextStep}`,
                  cycle?.employeeReviewDeadline
                    ? `Self appraisal due ${bexPaFormatDate(cycle.employeeReviewDeadline)}`
                    : "",
                ],
                badgeText: status,
                badgeKind,
              }),
            );
          },
        );
      }

      if (bexPaElements.overviewPriorityEmpty) {
        bexPaElements.overviewPriorityEmpty.textContent =
          "No active appraisal is currently assigned to you.";
        bexPaElements.overviewPriorityEmpty.classList.toggle(
          "d-none",
          activePersonalAppraisals.length > 0,
        );
      }

      const linkedActiveCycleIds = new Set(
        activePersonalAppraisals
          .map((appraisal) =>
            appraisal.cycleId,
          )
          .filter(Boolean),
      );

      const linkedActiveCycles =
        bexPaState.cycles.filter(
          (cycle) =>
            linkedActiveCycleIds.has(
              cycle.id,
            ),
        );

      const activeCycleTitle =
        document.getElementById(
          "bexPaOverviewActiveCycleTitle",
        );
      const activeCyclePanel =
        activeCycleTitle?.closest(
          ".bex-pa-overview-panel",
        );
      const activeCycleKicker =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );
      const activeCycleDescription =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      if (activeCycleKicker) {
        activeCycleKicker.textContent =
          "My timeline";
      }

      if (activeCycleTitle) {
        activeCycleTitle.textContent =
          "Active cycle milestones";
      }

      if (activeCycleDescription) {
        activeCycleDescription.textContent =
          "Key dates for appraisal cycles currently assigned to you.";
      }

      if (bexPaElements.overviewActiveCycleCount) {
        bexPaElements.overviewActiveCycleCount.textContent =
          String(linkedActiveCycles.length);
      }

      if (bexPaElements.overviewActiveCycleList) {
        bexPaElements.overviewActiveCycleList.replaceChildren();

        linkedActiveCycles.forEach((cycle) => {
          const item =
            bexPaCreateOverviewCycleItem(cycle);
          const meta =
            item.querySelector(
              ".bex-pa-overview-operation-item-meta",
            );

          if (meta) {
            const dateRange =
              document.createElement("span");
            dateRange.textContent =
              `${bexPaFormatDate(cycle.startDate)} - ${bexPaFormatDate(cycle.endDate)}`;

            const selfDeadline =
              document.createElement("span");
            selfDeadline.textContent =
              `Self appraisal due ${bexPaFormatDate(cycle.employeeReviewDeadline)}`;

            meta.replaceChildren(
              dateRange,
              selfDeadline,
            );
          }

          bexPaElements.overviewActiveCycleList.appendChild(
            item,
          );
        });
      }

      if (bexPaElements.overviewActiveCycleEmpty) {
        bexPaElements.overviewActiveCycleEmpty.textContent =
          "You do not have an active appraisal cycle right now.";
        bexPaElements.overviewActiveCycleEmpty.classList.toggle(
          "d-none",
          linkedActiveCycles.length > 0,
        );
      }

      return;
    }

    if (isManagerOverview) {
      const activeCycleIds = new Set(
        bexPaState.cycles
          .filter(
            (cycle) => cycle.status === "Active",
          )
          .map((cycle) => cycle.id),
      );

      const activeVisibleAppraisals =
        visibleAppraisals.filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        );

      const activeEligibleManagerAppraisals =
        bexPaGetEligibleManagerAppraisals().filter(
          (appraisal) =>
            activeCycleIds.has(
              appraisal.cycleId,
            ),
        );

      const actionableManagerAppraisals =
        activeEligibleManagerAppraisals.filter(
          (appraisal) =>
            !bexPaState.managerAppraisals.some(
              (managerAppraisal) =>
                managerAppraisal.appraisalId ===
                  appraisal.id &&
                managerAppraisal.status ===
                  "Submitted",
            ),
        );

      const priorityTitle =
        document.getElementById(
          "bexPaOverviewPriorityTitle",
        );
      const priorityPanel =
        priorityTitle?.closest(
          ".bex-pa-overview-panel",
        );
      const priorityKicker =
        priorityPanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );
      const priorityDescription =
        priorityPanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      if (priorityKicker) {
        priorityKicker.textContent =
          "Review queue";
      }

      if (priorityTitle) {
        priorityTitle.textContent =
          "Ready for review";
      }

      if (priorityDescription) {
        priorityDescription.textContent =
          "Submitted self-appraisals currently waiting for your manager action.";
      }

      if (bexPaElements.overviewPriorityCount) {
        bexPaElements.overviewPriorityCount.textContent =
          String(actionableManagerAppraisals.length);
      }

      if (bexPaElements.overviewPriorityList) {
        bexPaElements.overviewPriorityList.replaceChildren();

        actionableManagerAppraisals.forEach(
          (appraisal) => {
            const cycle =
              bexPaState.cycles.find(
                (existingCycle) =>
                  existingCycle.id ===
                  appraisal.cycleId,
              );
            const managerAppraisal =
              bexPaState.managerAppraisals.find(
                (existingManagerAppraisal) =>
                  existingManagerAppraisal.appraisalId ===
                  appraisal.id,
              );
            const hasManagerDraft =
              bexPaHasSavedDraft(
                managerAppraisal,
              );

            bexPaElements.overviewPriorityList.appendChild(
              bexPaCreateOverviewOperationItem({
                title:
                  appraisal.employeeName ||
                  "Employee",
                metaItems: [
                  cycle?.name
                    ? `Cycle: ${cycle.name}`
                    : "",
                  hasManagerDraft
                    ? "Next: Continue manager appraisal"
                    : "Next: Start manager appraisal",
                  cycle?.managerReviewDeadline
                    ? `Manager review due ${bexPaFormatDate(cycle.managerReviewDeadline)}`
                    : "",
                ],
                badgeText:
                  hasManagerDraft
                    ? "In progress"
                    : "Ready",
                badgeKind:
                  hasManagerDraft
                    ? "active"
                    : "hr",
              }),
            );
          },
        );
      }

      if (bexPaElements.overviewPriorityEmpty) {
        const hasPrimaryScope =
          bexPaGetManagedEmployeeIds().length > 0;

        bexPaElements.overviewPriorityEmpty.textContent =
          hasPrimaryScope
            ? "No submitted self-appraisals are currently waiting for your review."
            : "Your visible manager scope is read-only; no primary manager reviews are assigned to you.";
        bexPaElements.overviewPriorityEmpty.classList.toggle(
          "d-none",
          actionableManagerAppraisals.length > 0,
        );
      }

      const linkedActiveCycleIds = new Set(
        activeVisibleAppraisals
          .map((appraisal) =>
            appraisal.cycleId,
          )
          .filter(Boolean),
      );

      const linkedActiveCycles =
        bexPaState.cycles.filter(
          (cycle) =>
            linkedActiveCycleIds.has(
              cycle.id,
            ),
        );

      const activeCycleTitle =
        document.getElementById(
          "bexPaOverviewActiveCycleTitle",
        );
      const activeCyclePanel =
        activeCycleTitle?.closest(
          ".bex-pa-overview-panel",
        );
      const activeCycleKicker =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );
      const activeCycleDescription =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      if (activeCycleKicker) {
        activeCycleKicker.textContent =
          "Team timeline";
      }

      if (activeCycleTitle) {
        activeCycleTitle.textContent =
          "Active review cycles";
      }

      if (activeCycleDescription) {
        activeCycleDescription.textContent =
          "Active cycle dates and manager-review progress across your reporting scope.";
      }

      if (bexPaElements.overviewActiveCycleCount) {
        bexPaElements.overviewActiveCycleCount.textContent =
          String(linkedActiveCycles.length);
      }

      if (bexPaElements.overviewActiveCycleList) {
        bexPaElements.overviewActiveCycleList.replaceChildren();

        const managedEmployeeIds = new Set(
          bexPaGetManagedEmployeeIds(),
        );

        linkedActiveCycles.forEach((cycle) => {
          const item =
            bexPaCreateOverviewCycleItem(cycle);
          const meta =
            item.querySelector(
              ".bex-pa-overview-operation-item-meta",
            );
          const cycleScopeAppraisals =
            activeVisibleAppraisals.filter(
              (appraisal) =>
                appraisal.cycleId ===
                cycle.id,
            );
          const cycleScopeEmployeeIds = new Set(
            cycleScopeAppraisals
              .map((appraisal) =>
                String(
                  appraisal.employeeId || "",
                ).trim(),
              )
              .filter(Boolean),
          );
          const submittedManagerReviews =
            cycleScopeAppraisals.filter(
              (appraisal) =>
                managedEmployeeIds.has(
                  appraisal.employeeId,
                ) &&
                bexPaState.managerAppraisals.some(
                  (managerAppraisal) =>
                    managerAppraisal.appraisalId ===
                      appraisal.id &&
                    managerAppraisal.status ===
                      "Submitted",
                ),
            ).length;

          if (meta) {
            const dateRange =
              document.createElement("span");
            dateRange.textContent =
              `${bexPaFormatDate(cycle.startDate)} - ${bexPaFormatDate(cycle.endDate)}`;

            const scopeSummary =
              document.createElement("span");
            scopeSummary.textContent =
              `${cycleScopeEmployeeIds.size} employee${cycleScopeEmployeeIds.size === 1 ? "" : "s"} in scope`;

            const reviewSummary =
              document.createElement("span");
            reviewSummary.textContent =
              `${submittedManagerReviews} manager review${submittedManagerReviews === 1 ? "" : "s"} submitted`;

            meta.replaceChildren(
              dateRange,
              scopeSummary,
              reviewSummary,
            );
          }

          bexPaElements.overviewActiveCycleList.appendChild(
            item,
          );
        });
      }

      if (bexPaElements.overviewActiveCycleEmpty) {
        bexPaElements.overviewActiveCycleEmpty.textContent =
          "No active appraisal cycle is currently linked to your manager review scope.";
        bexPaElements.overviewActiveCycleEmpty.classList.toggle(
          "d-none",
          linkedActiveCycles.length > 0,
        );
      }

      return;
    }

    if (isHrStandardOverview) {
      const priorityTitle =
        document.getElementById(
          "bexPaOverviewPriorityTitle",
        );

      const priorityPanel =
        priorityTitle?.closest(
          ".bex-pa-overview-panel",
        );

      const priorityKicker =
        priorityPanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );

      const priorityDescription =
        priorityPanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      const activeCycleTitle =
        document.getElementById(
          "bexPaOverviewActiveCycleTitle",
        );

      const activeCyclePanel =
        activeCycleTitle?.closest(
          ".bex-pa-overview-panel",
        );

      const activeCycleKicker =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-section-kicker",
        );

      const activeCycleDescription =
        activeCyclePanel?.querySelector(
          ".bex-pa-overview-panel-description",
        );

      if (priorityKicker) {
        priorityKicker.textContent =
          "Read-only status";
      }

      if (priorityTitle) {
        priorityTitle.textContent =
          "Review status watch";
      }

      if (priorityDescription) {
        priorityDescription.textContent =
          "Appraisals at HR finalisation or employee acknowledgement within your permitted view.";
      }

      if (activeCycleKicker) {
        activeCycleKicker.textContent =
          "Cycle visibility";
      }

      if (activeCycleTitle) {
        activeCycleTitle.textContent =
          "Active cycle snapshot";
      }

      if (activeCycleDescription) {
        activeCycleDescription.textContent =
          "Active appraisal cycles linked to employees in your permitted HR view.";
      }
    }

    const priorityRecords =
      visibleAppraisals
        .map((appraisal) => ({
          appraisal,
          status:
            bexPaGetOperationalAppraisalStatus(
              appraisal,
            ),
        }))
        .filter((record) =>
          record.status === "Submitted" ||
          record.status === "Finalised",
        );

    const awaitingHrCount =
      priorityRecords.filter(
        (record) => record.status === "Submitted",
      ).length;

    const awaitingAcknowledgementCount =
      priorityRecords.filter(
        (record) => record.status === "Finalised",
      ).length;

    if (bexPaElements.overviewPriorityCount) {
      bexPaElements.overviewPriorityCount.textContent =
        String(priorityRecords.length);
    }

    if (bexPaElements.overviewPriorityList) {
      bexPaElements.overviewPriorityList.replaceChildren();

      if (awaitingHrCount > 0) {
        bexPaElements.overviewPriorityList.appendChild(
          bexPaCreateOverviewOperationItem({
            title: "HR finalisation",
            metaItems: [
              `${awaitingHrCount} appraisal${awaitingHrCount === 1 ? "" : "s"} ready for HR finalisation`,
            ],
            badgeText: String(awaitingHrCount),
            badgeKind: "hr",
          }),
        );
      }

      if (awaitingAcknowledgementCount > 0) {
        bexPaElements.overviewPriorityList.appendChild(
          bexPaCreateOverviewOperationItem({
            title: "Employee acknowledgement",
            metaItems: [
              `${awaitingAcknowledgementCount} finalised appraisal${awaitingAcknowledgementCount === 1 ? "" : "s"} awaiting acknowledgement`,
            ],
            badgeText:
              String(awaitingAcknowledgementCount),
            badgeKind: "acknowledgement",
          }),
        );
      }
    }

    bexPaElements.overviewPriorityEmpty?.classList.toggle(
      "d-none",
      priorityRecords.length > 0,
    );

    const visibleCycleIds = new Set(
      visibleAppraisals
        .map((appraisal) =>
          appraisal.cycleId,
        )
        .filter(Boolean),
    );

    const activeCycles =
      bexPaState.cycles.filter(
        (cycle) =>
          cycle.status === "Active" &&
          (
            !isHrStandardOverview ||
            visibleCycleIds.has(cycle.id)
          ),
      );

    if (bexPaElements.overviewActiveCycleCount) {
      bexPaElements.overviewActiveCycleCount.textContent =
        String(activeCycles.length);
    }

    if (bexPaElements.overviewActiveCycleList) {
      bexPaElements.overviewActiveCycleList.replaceChildren();

      activeCycles.forEach((cycle) => {
        const item =
          bexPaCreateOverviewCycleItem(cycle);

        if (isHrStandardOverview) {
          const meta =
            item.querySelector(
              ".bex-pa-overview-operation-item-meta",
            );

          const scopedAppraisals =
            visibleAppraisals.filter(
              (appraisal) =>
                appraisal.cycleId ===
                cycle.id,
            );

          const scopedEmployeeIds =
            new Set(
              scopedAppraisals
                .map((appraisal) =>
                  String(
                    appraisal.employeeId || "",
                  ).trim(),
                )
                .filter(Boolean),
            );

          const acknowledgedCount =
            scopedAppraisals.filter(
              (appraisal) =>
                bexPaGetOperationalAppraisalStatus(
                  appraisal,
                ) === "Acknowledged",
            ).length;

          if (meta) {
            const dateRange =
              document.createElement("span");

            dateRange.textContent =
              `${bexPaFormatDate(cycle.startDate)} - ${bexPaFormatDate(cycle.endDate)}`;

            const scopeSummary =
              document.createElement("span");

            scopeSummary.textContent =
              `${scopedEmployeeIds.size} employee${scopedEmployeeIds.size === 1 ? "" : "s"} in view`;

            const completionSummary =
              document.createElement("span");

            completionSummary.textContent =
              `${acknowledgedCount} acknowledged`;

            meta.replaceChildren(
              dateRange,
              scopeSummary,
              completionSummary,
            );
          }
        }

        bexPaElements
          .overviewActiveCycleList
          .appendChild(item);
      });
    }

    if (
      isHrStandardOverview &&
      bexPaElements.overviewActiveCycleEmpty
    ) {
      bexPaElements
        .overviewActiveCycleEmpty
        .textContent =
        "No active appraisal cycle is currently visible in your permitted HR scope.";
    }

    bexPaElements.overviewActiveCycleEmpty?.classList.toggle(
      "d-none",
      activeCycles.length > 0,
    );
  }

  function bexPaGetCycleOperationalReport(
    cycle,
  ) {
    const records =
      bexPaGetOperationalReportRecords().filter(
        (record) =>
          record.appraisal.cycleId === cycle.id,
      );

    return {
      cycle,
      records,
      counts:
        bexPaGetOperationalReportCounts(records),
    };
  }

  function bexPaGetCycleOperationalReports() {
    return bexPaState.cycles.map((cycle) =>
      bexPaGetCycleOperationalReport(cycle),
    );
  }

  function bexPaPrepareOperationalReportPrintMetadata(cycle) {
    if (!cycle) {
      return;
    }

    if (bexPaElements.reportPrintCycleName) {
      bexPaElements.reportPrintCycleName.textContent =
        cycle.name || "Unnamed appraisal cycle";
    }

    if (bexPaElements.reportPrintCyclePeriod) {
      bexPaElements.reportPrintCyclePeriod.textContent =
        `${bexPaFormatDate(cycle.startDate)} - ${bexPaFormatDate(cycle.endDate)}`;
    }

    if (bexPaElements.reportPrintGeneratedAt) {
      bexPaElements.reportPrintGeneratedAt.textContent =
        bexPaFormatTimestamp(new Date().toISOString());
    }
  }

  function bexPaHandleOperationalReportPrint() {
    if (
      !bexPaCanViewReports() ||
      !bexPaElements.reportCycleSelect
    ) {
      return;
    }

    const cycleId =
      bexPaElements.reportCycleSelect.value;

    const cycle =
      bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === cycleId,
      );

    if (!cycle) {
      return;
    }

    bexPaPrepareOperationalReportPrintMetadata(cycle);

    const originalTitle = document.title;
    const printableCycleName = String(
      cycle.name || "Appraisal Cycle",
    )
      .replace(/[\\/:*?"<>|]+/g, "-")
      .trim();

    document.title =
      `Performance Appraisal Report - ${printableCycleName} | BexHR`;
    document.body.classList.add(
      "bex-pa-printing-report",
    );

    try {
      window.print();
    } finally {
      document.title = originalTitle;
      document.body.classList.remove(
        "bex-pa-printing-report",
      );
    }
  }

  function bexPaRenderOperationalReport() {
    if (
      !bexPaCanViewReports() ||
      !bexPaElements.reportCycleSelect
    ) {
      return;
    }

    const reports =
      bexPaGetCycleOperationalReports();

    let previousCycleId =
      bexPaElements.reportCycleSelect.value;

    if (!previousCycleId) {
      try {
        previousCycleId =
          window.sessionStorage.getItem(
            BEX_PA_REPORT_CYCLE_MEMORY_KEY,
          ) || "";
      } catch (error) {
        console.warn(
          "BexHR Performance Appraisal could not restore the selected report cycle.",
          error,
        );
      }
    }

    bexPaElements.reportCycleSelect.innerHTML =
      '<option value="">Select an appraisal cycle</option>';

    reports.forEach((report) => {
      const option =
        document.createElement("option");

      option.value = report.cycle.id;
      option.textContent =
        report.cycle.name ||
        "Unnamed appraisal cycle";

      bexPaElements.reportCycleSelect.appendChild(
        option,
      );
    });

    const selectedCycleId =
      reports.some(
        (report) =>
          report.cycle.id === previousCycleId,
      )
        ? previousCycleId
        : "";

    bexPaElements.reportCycleSelect.value =
      selectedCycleId;

    if (!selectedCycleId) {
      if (bexPaElements.reportPrintButton) {
        bexPaElements.reportPrintButton.disabled = true;
      }
      bexPaElements.operationalReportContent?.classList.add(
        "d-none",
      );
      bexPaElements.operationalReportEmpty?.classList.add(
        "d-none",
      );

      if (bexPaElements.reportCycleSummary) {
        bexPaElements.reportCycleSummary.textContent =
          reports.length
            ? "Select a cycle to view its operational status."
            : "No appraisal cycles are available.";
      }

      return;
    }

    bexPaRenderSelectedOperationalReport();
  }

  function bexPaRenderSelectedOperationalReport() {
    if (
      !bexPaCanViewReports() ||
      !bexPaElements.reportCycleSelect
    ) {
      return;
    }

    const cycleId =
      bexPaElements.reportCycleSelect.value;

    const cycle =
      bexPaState.cycles.find(
        (existingCycle) =>
          existingCycle.id === cycleId,
      );

    if (!cycle) {
      if (bexPaElements.reportPrintButton) {
        bexPaElements.reportPrintButton.disabled = true;
      }

      bexPaElements.operationalReportContent?.classList.add(
        "d-none",
      );
      bexPaElements.operationalReportEmpty?.classList.add(
        "d-none",
      );

      if (bexPaElements.reportCycleSummary) {
        bexPaElements.reportCycleSummary.textContent =
          "Select a cycle to view its operational status.";
      }

      return;
    }

    if (bexPaElements.reportPrintButton) {
      bexPaElements.reportPrintButton.disabled = false;
    }

    const report =
      bexPaGetCycleOperationalReport(cycle);

    const { counts, records } = report;

    if (bexPaElements.reportCycleSummary) {
      bexPaElements.reportCycleSummary.textContent =
        `${counts.total} assigned appraisal${counts.total === 1 ? "" : "s"
        } in this cycle.`;
    }

    if (bexPaElements.reportAssignedCount) {
      bexPaElements.reportAssignedCount.textContent =
        String(counts.assigned);
    }

    if (bexPaElements.reportInProgressCount) {
      bexPaElements.reportInProgressCount.textContent =
        String(counts.inProgress);
    }

    if (bexPaElements.reportSubmittedCount) {
      bexPaElements.reportSubmittedCount.textContent =
        String(counts.submitted);
    }

    if (bexPaElements.reportFinalisedCount) {
      bexPaElements.reportFinalisedCount.textContent =
        String(counts.finalised);
    }

    if (bexPaElements.reportAcknowledgedCount) {
      bexPaElements.reportAcknowledgedCount.textContent =
        String(counts.acknowledged);
    }

    if (bexPaElements.reportTotalCount) {
      bexPaElements.reportTotalCount.textContent =
        String(counts.total);
    }

    const completionPercentage =
      counts.total > 0
        ? Math.round(
          (counts.acknowledged / counts.total) * 100,
        )
        : 0;

    if (bexPaElements.reportCompletionSummary) {
      bexPaElements.reportCompletionSummary.textContent =
        `${counts.acknowledged} of ${counts.total} acknowledged`;
    }

    if (bexPaElements.reportCompletionPercentage) {
      bexPaElements.reportCompletionPercentage.textContent =
        `${completionPercentage}% complete`;
    }

    if (bexPaElements.reportCompletionProgress) {
      bexPaElements.reportCompletionProgress.setAttribute(
        "aria-valuenow",
        String(completionPercentage),
      );
      bexPaElements.reportCompletionProgress.setAttribute(
        "aria-valuetext",
        counts.total > 0
          ? `${counts.acknowledged} of ${counts.total} appraisals acknowledged`
          : "No assigned appraisals",
      );
    }

    if (bexPaElements.reportCompletionBar) {
      bexPaElements.reportCompletionBar.style.width =
        `${completionPercentage}%`;
    }

    if (bexPaElements.reportOutstandingSummary) {
      bexPaElements.reportOutstandingSummary.replaceChildren();

      const outstandingItems = [
        `${counts.assigned} appraisal${counts.assigned === 1 ? "" : "s"
        } not started`,
        `${counts.inProgress} appraisal${counts.inProgress === 1 ? "" : "s"
        } progressing through employee or manager review`,
        `${counts.submitted} appraisal${counts.submitted === 1 ? "" : "s"
        } awaiting HR finalisation`,
        `${counts.finalised} appraisal${counts.finalised === 1 ? "" : "s"
        } awaiting employee acknowledgement`,
      ];

      outstandingItems.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        bexPaElements.reportOutstandingSummary.appendChild(
          item,
        );
      });
    }

    if (bexPaElements.reportStatusDetail) {
      bexPaElements.reportStatusDetail.replaceChildren();

      records.forEach((record) => {
        const row = document.createElement("tr");
        row.className = "bex-pa-report-detail-row";

        const employeeCell =
          document.createElement("td");
        employeeCell.className =
          "bex-pa-report-employee-cell";
        employeeCell.textContent =
          record.appraisal.employeeName ||
          "Unnamed employee";

        const statusCell =
          document.createElement("td");
        statusCell.className =
          "bex-pa-report-status-cell";

        const statusBadge =
          document.createElement("span");
        statusBadge.className =
          "bex-pa-report-status";
        statusBadge.dataset.status =
          String(record.status || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-");
        statusBadge.textContent = record.status;
        statusCell.appendChild(statusBadge);

        const actionCell =
          document.createElement("td");
        actionCell.className =
          "bex-pa-report-action-cell";

        const outstandingAction = {
          Assigned: "Employee self-appraisal",
          "In Progress": "Employee or manager review",
          Submitted: "HR finalisation",
          Finalised: "Employee acknowledgement",
          Acknowledged: "Complete",
        };

        actionCell.textContent =
          outstandingAction[record.status] ||
          "Review appraisal";

        row.append(
          employeeCell,
          statusCell,
          actionCell,
        );

        bexPaElements.reportStatusDetail.appendChild(
          row,
        );
      });
    }

    const hasRecords =
      counts.total > 0;

    bexPaElements.operationalReportContent?.classList.toggle(
      "d-none",
      !hasRecords,
    );

    bexPaElements.operationalReportEmpty?.classList.toggle(
      "d-none",
      hasRecords,
    );
  }

  function bexPaGetAppraisalDisplayStatus(
    appraisal,
    selfAppraisal,
    managerAppraisal,
    hrFinalisation,
    acknowledgement,
  ) {
    if (acknowledgement?.status === "Acknowledged") {
      return "Acknowledged";
    }

    if (hrFinalisation?.status === "Finalised") {
      return "Finalised";
    }

    if (bexPaIsHrStandardMode()) {
      const parentStatus = String(
        appraisal?.status || "",
      ).trim();

      if (
        parentStatus === "Finalised" ||
        parentStatus === "Acknowledged"
      ) {
        return parentStatus;
      }

      return parentStatus === "Draft"
        ? "Not Started"
        : parentStatus || "Not Started";
    }

    if (bexPaIsManagerReviewMode()) {
      const isPrimaryManagerAppraisal =
        bexPaGetManagedEmployeeIds().includes(
          String(
            appraisal?.employeeId || "",
          ).trim(),
        );

      if (isPrimaryManagerAppraisal) {
        return bexPaGetDraftDisplayStatus(
          managerAppraisal,
        );
      }

      const parentStatus = String(
        appraisal?.status || "",
      ).trim();

      if (
        parentStatus === "Finalised" ||
        parentStatus === "Acknowledged"
      ) {
        return parentStatus;
      }

      if (managerAppraisal?.status === "Submitted") {
        return "Awaiting HR Review";
      }

      if (selfAppraisal?.status === "Submitted") {
        return "Manager Review";
      }

      return bexPaHasSavedDraft(selfAppraisal)
        ? "Self-Appraisal In Progress"
        : "Not Started";
    }

    if (bexPaIsHrAdminMode()) {
      if (managerAppraisal?.status === "Submitted") {
        return "Submitted";
      }

      return selfAppraisal?.status === "Submitted" ||
        bexPaHasSavedDraft(selfAppraisal)
        ? "In Progress"
        : "Not Started";
    }

    return bexPaGetDraftDisplayStatus(selfAppraisal);
  }

  function bexPaRenderHrAppraisalReview(appraisal) {
    if (!bexPaIsHrAdminMode()) {
      return;
    }

    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id === appraisal.cycleId,
    );

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const selfAppraisal = bexPaState.selfAppraisals.find(
      (existingSelfAppraisal) =>
        existingSelfAppraisal.appraisalId === appraisal.id,
    );

    const managerAppraisal =
      bexPaState.managerAppraisals.find(
        (existingManagerAppraisal) =>
          existingManagerAppraisal.appraisalId === appraisal.id,
      );

    const selfSubmitted =
      selfAppraisal?.status === "Submitted";

    const managerSubmitted =
      managerAppraisal?.status === "Submitted";

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId === appraisal.id,
      );

    const isFinalised =
      hrFinalisation?.status === "Finalised";

    const canFinalise =
      selfSubmitted &&
      managerSubmitted &&
      !isFinalised;

    bexPaElements.finaliseHrAppraisalButton?.classList.toggle(
      "d-none",
      !canFinalise,
    );

    bexPaElements.hrAppraisalReviewMeta.replaceChildren();

    const reviewIdentityLabel =
      document.createElement("span");

    reviewIdentityLabel.className =
      "bex-pa-review-identity-label";
    reviewIdentityLabel.textContent = "Employee";

    const reviewIdentityName =
      document.createElement("span");

    reviewIdentityName.className =
      "bex-pa-review-identity-name";
    reviewIdentityName.textContent =
      appraisal.employeeName || "Employee";

    const reviewIdentityMeta =
      document.createElement("span");

    reviewIdentityMeta.className =
      "bex-pa-review-identity-meta";

    const reviewIdentityMetaParts = [
      cycle?.name || "Unknown cycle",
      template?.name || "Unknown template",
    ];

    if (isFinalised) {
      reviewIdentityMetaParts.push("Finalised");

      if (hrFinalisation?.finalisedAt) {
        reviewIdentityMetaParts.push(
          `Finalised: ${bexPaFormatTimestamp(hrFinalisation.finalisedAt)}`,
        );
      }
    }

    reviewIdentityMeta.textContent =
      reviewIdentityMetaParts.join(" | ");

    bexPaElements.hrAppraisalReviewMeta.append(
      reviewIdentityLabel,
      reviewIdentityName,
      reviewIdentityMeta,
    );

    const missingPrerequisites = [];

    if (!selfSubmitted) {
      missingPrerequisites.push(
        "Employee Self-Appraisal has not been submitted.",
      );
    }

    if (!managerSubmitted) {
      missingPrerequisites.push(
        "Manager Appraisal has not been submitted.",
      );
    }

    if (missingPrerequisites.length > 0) {
      bexPaElements.hrAppraisalReviewPrerequisites.textContent =
        missingPrerequisites.join(" ");

      bexPaElements.hrAppraisalReviewPrerequisites.classList.remove(
        "d-none",
        "alert-success",
      );
      bexPaElements.hrAppraisalReviewPrerequisites.classList.add(
        "alert-warning",
      );
    } else if (isFinalised) {
      bexPaElements.hrAppraisalReviewPrerequisites.textContent =
        "Finalisation complete. Employee acknowledgement is the next stage.";

      bexPaElements.hrAppraisalReviewPrerequisites.classList.remove(
        "d-none",
        "alert-warning",
      );
      bexPaElements.hrAppraisalReviewPrerequisites.classList.add(
        "alert-success",
      );
    } else {
      bexPaElements.hrAppraisalReviewPrerequisites.textContent =
        "Employee Self-Appraisal and Manager Appraisal have both been submitted.";

      bexPaElements.hrAppraisalReviewPrerequisites.classList.remove(
        "d-none",
        "alert-success",
      );
      bexPaElements.hrAppraisalReviewPrerequisites.classList.add(
        "alert-warning",
      );
    }

    bexPaElements.hrAppraisalReviewEmployee.replaceChildren();

    const employeeHeading =
      document.createElement("h3");

    employeeHeading.className =
      "h6 fw-bold";

    employeeHeading.textContent =
      "Employee Self-Appraisal";

    bexPaElements.hrAppraisalReviewEmployee.appendChild(
      employeeHeading,
    );

    const employeeStatus =
      document.createElement("p");

    employeeStatus.className =
      "small text-body-secondary";

    const selfReviewDisplayStatus =
      bexPaGetDraftDisplayStatus(selfAppraisal);

    employeeStatus.textContent =
      `Status: ${selfReviewDisplayStatus}${selfSubmitted && selfAppraisal?.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(selfAppraisal.submittedAt)}` : ""}`;

    bexPaElements.hrAppraisalReviewEmployee.appendChild(
      employeeStatus,
    );

    if (selfSubmitted) {
      const competencyResponses =
        Array.isArray(selfAppraisal.competencyResponses)
          ? selfAppraisal.competencyResponses
          : [];

      competencyResponses.forEach((response) => {
        const competency =
          template?.competencies?.find(
            (existingCompetency) =>
              existingCompetency.id ===
              response.competencyId,
          );

        const item = document.createElement("div");

        item.className =
          "border rounded-3 p-3 mb-3 bg-body-tertiary";

        const title = document.createElement("p");

        title.className =
          "mb-2 fw-semibold";

        title.textContent =
          competency?.name || response.competencyId;

        const ratingLabel =
          document.createElement("p");

        ratingLabel.className =
          "small fw-semibold mb-1";

        ratingLabel.textContent =
          "Employee rating";

        const ratingText =
          document.createElement("p");

        ratingText.className =
          "small mb-2 text-body-secondary";

        ratingText.textContent =
          response.rating || "Not provided";

        const commentLabel =
          document.createElement("p");

        commentLabel.className =
          "small fw-semibold mb-1";

        commentLabel.textContent =
          "Employee comment";

        const commentText =
          document.createElement("p");

        commentText.className =
          "small mb-0 text-body-secondary";

        commentText.textContent =
          response.comment || "Not provided";

        item.append(
          title,
          ratingLabel,
          ratingText,
          commentLabel,
          commentText,
        );

        bexPaElements.hrAppraisalReviewEmployee.appendChild(
          item,
        );
      });

      const employeeAchievementBlock =
        document.createElement("div");

      employeeAchievementBlock.className =
        "border rounded-3 p-3 mb-3 bg-body-tertiary";

      const employeeAchievementLabel =
        document.createElement("p");

      employeeAchievementLabel.className =
        "fw-semibold mb-1";

      employeeAchievementLabel.textContent =
        "Overall Employee Summary";

      const employeeAchievementText =
        document.createElement("p");

      employeeAchievementText.className =
        "small mb-0 text-body-secondary";

      employeeAchievementText.textContent =
        selfAppraisal.employeeAchievement ||
        selfAppraisal.overallSummary ||
        "Not provided";

      employeeAchievementBlock.append(
        employeeAchievementLabel,
        employeeAchievementText,
      );

      bexPaElements.hrAppraisalReviewEmployee.appendChild(
        employeeAchievementBlock,
      );

      const goals =
        bexPaGetSelfAppraisalGoals(appraisal);

      goals.forEach((individualGoal) => {
        const employeeResponse =
          selfAppraisal.goalResponses?.find(
            (response) =>
              response.individualGoalId ===
              individualGoal.id,
          );

        const goalItem =
          document.createElement("article");

        goalItem.className =
          "bex-pa-goal-item border rounded-3 p-3 mb-4";

        const title =
          document.createElement("h4");

        title.className =
          "h6 fw-bold mb-3";

        title.textContent =
          individualGoal.title;

        const targetBlock =
          document.createElement("div");

        targetBlock.className =
          "mb-3";

        const targetLabel =
          document.createElement("p");

        targetLabel.className =
          "small fw-semibold mb-1";

        targetLabel.textContent =
          "Target";

        const targetText =
          document.createElement("p");

        targetText.className =
          "small mb-0 text-body-secondary";

        targetText.textContent =
          individualGoal.target || "Not provided";

        targetBlock.append(
          targetLabel,
          targetText,
        );

        const progress =
          bexPaState.progressUpdates.filter(
            (progressUpdate) =>
              progressUpdate.individualGoalId ===
              individualGoal.id,
          );

        const progressBlock =
          document.createElement("div");

        progressBlock.className =
          "border rounded-3 p-3 mb-3 bg-body-tertiary";

        const progressLabel =
          document.createElement("p");

        progressLabel.className =
          "small fw-semibold mb-1";

        progressLabel.textContent =
          "Progress";

        const progressText =
          document.createElement("p");

        progressText.className =
          "small mb-0 text-body-secondary";

        progressText.textContent =
          progress.length === 0
            ? "No progress evidence submitted yet."
            : progress
              .map(
                (progressUpdate) =>
                  `${progressUpdate.progressPercentage}% - ${progressUpdate.status}: ${progressUpdate.updateText}${progressUpdate.evidence ? ` (${progressUpdate.evidence})` : ""}`,
              )
              .join(" | ");

        progressBlock.append(
          progressLabel,
          progressText,
        );

        const achievementBlock =
          document.createElement("div");

        achievementBlock.className =
          "border rounded-3 p-3 bg-body-tertiary";

        const achievementLabel =
          document.createElement("p");

        achievementLabel.className =
          "small fw-semibold mb-1";

        achievementLabel.textContent =
          "Employee achievement";

        const achievementText =
          document.createElement("p");

        achievementText.className =
          "small mb-0 text-body-secondary";

        achievementText.textContent =
          employeeResponse?.achievement ||
          "Not provided";

        achievementBlock.append(
          achievementLabel,
          achievementText,
        );

        goalItem.append(
          title,
          targetBlock,
          progressBlock,
          achievementBlock,
        );

        bexPaElements.hrAppraisalReviewEmployee.appendChild(
          goalItem,
        );
      });
    }

    bexPaElements.hrAppraisalReviewManager.replaceChildren();

    const managerHeading =
      document.createElement("h3");

    managerHeading.className =
      "h6 fw-bold";

    managerHeading.textContent =
      "Manager Appraisal";

    bexPaElements.hrAppraisalReviewManager.appendChild(
      managerHeading,
    );

    const managerStatus =
      document.createElement("p");

    managerStatus.className =
      "small text-body-secondary";

    const managerReviewDisplayStatus =
      bexPaGetDraftDisplayStatus(managerAppraisal);

    managerStatus.textContent =
      `Status: ${managerReviewDisplayStatus}${managerSubmitted && managerAppraisal?.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(managerAppraisal.submittedAt)}` : ""}`;

    bexPaElements.hrAppraisalReviewManager.appendChild(
      managerStatus,
    );

    if (managerSubmitted) {
      const goals =
        bexPaGetSelfAppraisalGoals(appraisal);

      goals.forEach((individualGoal) => {
        const managerResponse =
          managerAppraisal.goalResponses?.find(
            (response) =>
              response.individualGoalId ===
              individualGoal.id,
          );

        const item =
          document.createElement("article");

        item.className =
          "bex-pa-goal-item border rounded-3 p-3 mt-3";

        const title =
          document.createElement("h4");

        title.className =
          "h6 fw-bold mb-3";

        title.textContent =
          individualGoal.title;

        const ratingBlock =
          document.createElement("div");

        ratingBlock.className =
          "border rounded-3 p-3 bg-body-tertiary mb-3";

        const ratingLabel =
          document.createElement("p");

        ratingLabel.className =
          "small fw-semibold mb-1";

        ratingLabel.textContent =
          "Manager rating";

        const ratingText =
          document.createElement("p");

        ratingText.className =
          "small mb-0 text-body-secondary";

        ratingText.textContent =
          managerResponse?.rating ||
          "Not provided";

        ratingBlock.append(
          ratingLabel,
          ratingText,
        );

        const commentBlock =
          document.createElement("div");

        commentBlock.className =
          "border rounded-3 p-3 bg-body-tertiary";

        const commentLabel =
          document.createElement("p");

        commentLabel.className =
          "small fw-semibold mb-1";

        commentLabel.textContent =
          "Manager comment";

        const commentText =
          document.createElement("p");

        commentText.className =
          "small mb-0 text-body-secondary";

        commentText.textContent =
          managerResponse?.comment ||
          "Not provided";

        commentBlock.append(
          commentLabel,
          commentText,
        );

        item.append(
          title,
          ratingBlock,
          commentBlock,
        );

        bexPaElements.hrAppraisalReviewManager.appendChild(
          item,
        );
      });

      const overallCommentBlock =
        document.createElement("div");

      overallCommentBlock.className =
        "border rounded-3 p-3 mt-3 bg-body-tertiary";

      const overallCommentLabel =
        document.createElement("p");

      overallCommentLabel.className =
        "fw-semibold mb-1";

      overallCommentLabel.textContent =
        "Overall Manager Summary";

      const overallCommentText =
        document.createElement("p");

      overallCommentText.className =
        "small mb-0 text-body-secondary";

      overallCommentText.textContent =
        managerAppraisal.overallComment ||
        "Not provided";

      overallCommentBlock.append(
        overallCommentLabel,
        overallCommentText,
      );

      bexPaElements.hrAppraisalReviewManager.appendChild(
        overallCommentBlock,
      );
    }

    // BEXHR HR FINALISATION CLARITY - US-07
    // Present one review task at a time and keep the existing Finalise action
    // in the dedicated finalisation panel.
    bexPaApplyHrFinalisationClarity(appraisal);

    bexPaElements.hrAppraisalReviewSection.classList.remove(
      "d-none",
    );
  }

  function bexPaOpenHrAppraisalReview(appraisalId) {
    if (!bexPaIsHrAdminMode()) {
      return;
    }

    const appraisal =
      bexPaState.employeeAppraisals.find(
        (existingAppraisal) =>
          existingAppraisal.id === appraisalId,
      );

    if (!appraisal) {
      return;
    }

    bexPaState.editingHrAppraisalId = appraisal.id;

    // BEXHR HR FINALISATION CLARITY - US-07
    // Once HR selects an appraisal, the register becomes navigation rather
    // than a second copy of the active task. Keep only the focused review visible.
    bexPaSetEmployeeAppraisalRegisterVisible(false);

    bexPaElements.selfAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaElements.managerAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaRenderHrAppraisalReview(appraisal);

    bexPaElements.hrAppraisalReviewSection?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function bexPaCloseHrAppraisalReview() {
    bexPaState.editingHrAppraisalId = null;
    bexPaElements.hrAppraisalReviewSection?.classList.add(
      "d-none",
    );
    bexPaSetEmployeeAppraisalRegisterVisible(true);

    const registerCard =
      bexPaElements.employeeAppraisalsList?.closest(
        ".bex-pa-appraisal-register-card",
      );

    window.requestAnimationFrame(() => {
      registerCard?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    if (bexPaElements.hrAppraisalReviewPrerequisites) {
      bexPaElements.hrAppraisalReviewPrerequisites.textContent =
        "";

      bexPaElements.hrAppraisalReviewPrerequisites.classList.add(
        "d-none",
      );
    }
  }

  function bexPaRenderFinalAppraisal(appraisal) {
    if (!bexPaIsEmployeeMode()) {
      return;
    }

    const currentEmployeeId =
      bexPaGetCurrentEmployeeId();

    if (appraisal.employeeId !== currentEmployeeId) {
      return;
    }

    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id === appraisal.cycleId,
    );

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const selfAppraisal =
      bexPaState.selfAppraisals.find(
        (existingSelfAppraisal) =>
          existingSelfAppraisal.appraisalId === appraisal.id,
      );

    const managerAppraisal =
      bexPaState.managerAppraisals.find(
        (existingManagerAppraisal) =>
          existingManagerAppraisal.appraisalId === appraisal.id,
      );

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId === appraisal.id,
      );

    if (
      selfAppraisal?.status !== "Submitted" ||
      managerAppraisal?.status !== "Submitted" ||
      hrFinalisation?.status !== "Finalised"
    ) {
      return;
    }

    const acknowledgement =
      bexPaState.employeeAcknowledgements.find(
        (existingAcknowledgement) =>
          existingAcknowledgement.appraisalId === appraisal.id,
      );

    bexPaState.editingFinalAppraisalId =
      appraisal.id;

    const finalDisplayStatus =
      acknowledgement?.status === "Acknowledged"
        ? "Acknowledged"
        : "Finalised";

    bexPaElements.finalAppraisalMeta.textContent =
      `${appraisal.employeeName || "Employee"} | ${cycle?.name || "Unknown cycle"} | ${template?.name || "Unknown template"} | Status: ${finalDisplayStatus}${hrFinalisation.finalisedAt ? ` | Finalised: ${bexPaFormatTimestamp(hrFinalisation.finalisedAt)}` : ""}`;

    bexPaElements.finalAppraisalEmployee.replaceChildren();

    const employeeHeading =
      document.createElement("h3");

    employeeHeading.className =
      "h6 fw-bold";

    employeeHeading.textContent =
      "Employee Self-Appraisal";

    bexPaElements.finalAppraisalEmployee.appendChild(
      employeeHeading,
    );

    const employeeStatus =
      document.createElement("p");

    employeeStatus.className =
      "small text-body-secondary";

    employeeStatus.textContent =
      `Status: Submitted${selfAppraisal.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(selfAppraisal.submittedAt)}` : ""}`;

    bexPaElements.finalAppraisalEmployee.appendChild(
      employeeStatus,
    );

    const competencyResponses =
      Array.isArray(selfAppraisal.competencyResponses)
        ? selfAppraisal.competencyResponses
        : [];

    competencyResponses.forEach((response) => {
      const competency =
        template?.competencies?.find(
          (existingCompetency) =>
            existingCompetency.id ===
            response.competencyId,
        );

      const item =
        document.createElement("div");

      item.className =
        "border rounded-3 p-3 mb-3 bg-body-tertiary";

      const title =
        document.createElement("h4");

      title.className =
        "h6 fw-bold mb-3";

      title.textContent =
        competency?.name || response.competencyId;

      const ratingBlock =
        document.createElement("div");

      ratingBlock.className =
        "border rounded-3 p-3 bg-white mb-3";

      const ratingLabel =
        document.createElement("p");

      ratingLabel.className =
        "small fw-semibold mb-1";

      ratingLabel.textContent =
        "Employee rating";

      const rating =
        document.createElement("p");

      rating.className =
        "small mb-0 text-body-secondary";

      rating.textContent =
        response.rating || "Not provided";

      ratingBlock.append(
        ratingLabel,
        rating,
      );

      const commentBlock =
        document.createElement("div");

      commentBlock.className =
        "border rounded-3 p-3 bg-white";

      const commentLabel =
        document.createElement("p");

      commentLabel.className =
        "small fw-semibold mb-1";

      commentLabel.textContent =
        "Employee comment";

      const comment =
        document.createElement("p");

      comment.className =
        "small mb-0 text-body-secondary";

      comment.textContent =
        response.comment || "Not provided";

      item.append(
        title,
        ratingBlock,
        commentBlock,
      );

      commentBlock.append(
        commentLabel,
        comment,
      );

      bexPaElements.finalAppraisalEmployee.appendChild(
        item,
      );
    });

    const employeeSummary =
      document.createElement("div");

    employeeSummary.className =
      "border rounded-3 p-3 mb-3 bg-body-tertiary";

    const employeeSummaryLabel =
      document.createElement("p");

    employeeSummaryLabel.className =
      "fw-semibold mb-1";

    employeeSummaryLabel.textContent =
      "Overall Employee Summary";

    const employeeSummaryText =
      document.createElement("p");

    employeeSummaryText.className =
      "small mb-0 text-body-secondary";

    employeeSummaryText.textContent =
      selfAppraisal.employeeAchievement ||
      selfAppraisal.overallSummary ||
      "Not provided";

    employeeSummary.append(
      employeeSummaryLabel,
      employeeSummaryText,
    );

    bexPaElements.finalAppraisalEmployee.appendChild(
      employeeSummary,
    );

    const goals =
      bexPaGetSelfAppraisalGoals(appraisal);

    goals.forEach((individualGoal) => {
      const employeeResponse =
        selfAppraisal.goalResponses?.find(
          (response) =>
            response.individualGoalId ===
            individualGoal.id,
        );

      const goalItem =
        document.createElement("article");

      goalItem.className =
        "bex-pa-goal-item border rounded-3 p-3 mt-3";

      const title =
        document.createElement("h4");

      title.className =
        "h6 fw-bold mb-3";

      title.textContent =
        individualGoal.title;

      const targetBlock =
        document.createElement("div");

      targetBlock.className =
        "border rounded-3 p-3 bg-body-tertiary mb-3";

      const targetLabel =
        document.createElement("p");

      targetLabel.className =
        "small fw-semibold mb-1";

      targetLabel.textContent =
        "Target";

      const targetText =
        document.createElement("p");

      targetText.className =
        "small mb-0 text-body-secondary";

      targetText.textContent =
        individualGoal.target ||
        "Not provided";

      targetBlock.append(
        targetLabel,
        targetText,
      );

      const progress =
        bexPaState.progressUpdates.filter(
          (progressUpdate) =>
            progressUpdate.individualGoalId ===
            individualGoal.id,
        );

      const progressBlock =
        document.createElement("div");

      progressBlock.className =
        "border rounded-3 p-3 bg-body-tertiary mb-3";

      const progressLabel =
        document.createElement("p");

      progressLabel.className =
        "small fw-semibold mb-1";

      progressLabel.textContent =
        "Progress";

      const progressText =
        document.createElement("p");

      progressText.className =
        "small mb-0 text-body-secondary";

      progressText.textContent =
        progress.length === 0
          ? "No progress evidence submitted yet."
          : progress
            .map(
              (progressUpdate) =>
                `${progressUpdate.progressPercentage}% - ${progressUpdate.status}: ${progressUpdate.updateText}${progressUpdate.evidence ? ` (${progressUpdate.evidence})` : ""}`,
            )
            .join(" | ");

      progressBlock.append(
        progressLabel,
        progressText,
      );

      const achievementBlock =
        document.createElement("div");

      achievementBlock.className =
        "border rounded-3 p-3 bg-body-tertiary";

      const achievementLabel =
        document.createElement("p");

      achievementLabel.className =
        "small fw-semibold mb-1";

      achievementLabel.textContent =
        "Employee achievement";

      const achievement =
        document.createElement("p");

      achievement.className =
        "small mb-0 text-body-secondary";

      achievement.textContent =
        employeeResponse?.achievement ||
        "Not provided";

      achievementBlock.append(
        achievementLabel,
        achievement,
      );

      goalItem.append(
        title,
        targetBlock,
        progressBlock,
        achievementBlock,
      );

      bexPaElements.finalAppraisalEmployee.appendChild(
        goalItem,
      );
    });

    bexPaElements.finalAppraisalManager.replaceChildren();

    const managerHeading =
      document.createElement("h3");

    managerHeading.className =
      "h6 fw-bold";

    managerHeading.textContent =
      "Manager Appraisal";

    bexPaElements.finalAppraisalManager.appendChild(
      managerHeading,
    );

    const managerStatus =
      document.createElement("p");

    managerStatus.className =
      "small text-body-secondary";

    managerStatus.textContent =
      `Status: Submitted${managerAppraisal.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(managerAppraisal.submittedAt)}` : ""}`;

    bexPaElements.finalAppraisalManager.appendChild(
      managerStatus,
    );

    goals.forEach((individualGoal) => {
      const managerResponse =
        managerAppraisal.goalResponses?.find(
          (response) =>
            response.individualGoalId ===
            individualGoal.id,
        );

      const item =
        document.createElement("article");

      item.className =
        "bex-pa-goal-item border rounded-3 p-3 mt-3";

      const title =
        document.createElement("h4");

      title.className =
        "h6 fw-bold mb-3";

      title.textContent =
        individualGoal.title;

      const ratingBlock =
        document.createElement("div");

      ratingBlock.className =
        "border rounded-3 p-3 bg-body-tertiary mb-3";

      const ratingLabel =
        document.createElement("p");

      ratingLabel.className =
        "small fw-semibold mb-1";

      ratingLabel.textContent =
        "Manager rating";

      const rating =
        document.createElement("p");

      rating.className =
        "small mb-0 text-body-secondary";

      rating.textContent =
        managerResponse?.rating ||
        "Not provided";

      ratingBlock.append(
        ratingLabel,
        rating,
      );

      const commentBlock =
        document.createElement("div");

      commentBlock.className =
        "border rounded-3 p-3 bg-body-tertiary";

      const commentLabel =
        document.createElement("p");

      commentLabel.className =
        "small fw-semibold mb-1";

      commentLabel.textContent =
        "Manager comment";

      const comment =
        document.createElement("p");

      comment.className =
        "small mb-0 text-body-secondary";

      comment.textContent =
        managerResponse?.comment ||
        "Not provided";

      commentBlock.append(
        commentLabel,
        comment,
      );

      item.append(
        title,
        ratingBlock,
        commentBlock,
      );

      bexPaElements.finalAppraisalManager.appendChild(
        item,
      );
    });

    const overallComment =
      document.createElement("div");

    overallComment.className =
      "border rounded-3 p-3 mt-3 bg-body-tertiary";

    const overallCommentLabel =
      document.createElement("p");

    overallCommentLabel.className =
      "fw-semibold mb-1";

    overallCommentLabel.textContent =
      "Overall Manager Summary";

    const overallCommentText =
      document.createElement("p");

    overallCommentText.className =
      "small mb-0 text-body-secondary";

    overallCommentText.textContent =
      managerAppraisal.overallComment ||
      "Not provided";

    overallComment.append(
      overallCommentLabel,
      overallCommentText,
    );

    bexPaElements.finalAppraisalManager.appendChild(
      overallComment,
    );

    if (acknowledgement?.status === "Acknowledged") {
      bexPaElements.finalAppraisalAcknowledgement.textContent =
        `Status: Acknowledged${acknowledgement.acknowledgedAt ? ` | Acknowledged: ${bexPaFormatTimestamp(acknowledgement.acknowledgedAt)}` : ""}`;

      bexPaElements.finalAppraisalAcknowledgement.classList.remove(
        "d-none",
      );

      bexPaElements.acknowledgeFinalAppraisalButton?.classList.add(
        "d-none",
      );
    } else {
      bexPaElements.finalAppraisalAcknowledgement.textContent =
        "";

      bexPaElements.finalAppraisalAcknowledgement.classList.add(
        "d-none",
      );

      bexPaElements.acknowledgeFinalAppraisalButton?.classList.remove(
        "d-none",
      );
    }

    bexPaElements.finalAppraisalSection?.classList.remove(
      "d-none",
    );
  }

  function bexPaOpenFinalAppraisal(appraisalId) {
    if (!bexPaIsEmployeeMode()) {
      return;
    }

    const currentEmployeeId =
      bexPaGetCurrentEmployeeId();

    const appraisal =
      bexPaState.employeeAppraisals.find(
        (existingAppraisal) =>
          existingAppraisal.id === appraisalId &&
          existingAppraisal.employeeId === currentEmployeeId,
      );

    if (!appraisal) {
      return;
    }

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId === appraisal.id,
      );

    if (hrFinalisation?.status !== "Finalised") {
      return;
    }

    // BEXHR R-07 EMPLOYEE FINAL APPRAISAL FOCUS PARITY
    // Reuse the shared focused-workspace register behaviour already used by
    // Self-Appraisal, Manager Review and HR Review. Do not stack the completed
    // appraisal detail underneath the employee register.
    bexPaSetEmployeeAppraisalRegisterVisible(false);

    bexPaElements.selfAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaElements.managerAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaElements.hrAppraisalReviewSection?.classList.add(
      "d-none",
    );

    bexPaRenderFinalAppraisal(appraisal);

    bexPaElements.finalAppraisalSection?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function bexPaCloseFinalAppraisal() {
    bexPaState.editingFinalAppraisalId = null;

    bexPaElements.finalAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaSetEmployeeAppraisalRegisterVisible(true);
  }

  async function bexPaCompleteEligibleCycles() {
    if (
      bexPaIsIntegratedPersistenceContext() &&
      !bexPaIsHrAdminMode()
    ) {
      return false;
    }

    const completedCycles = [];

    bexPaState.cycles.forEach((cycle) => {
      if (cycle.status !== "Active") {
        return;
      }

      const cycleAppraisals =
        bexPaState.employeeAppraisals.filter(
          (appraisal) =>
            appraisal.cycleId === cycle.id,
        );

      if (cycleAppraisals.length === 0) {
        return;
      }

      const acknowledgements =
        cycleAppraisals.map((appraisal) =>
          bexPaState.employeeAcknowledgements.find(
            (acknowledgement) =>
              acknowledgement.appraisalId ===
              appraisal.id,
          ),
        );

      const allAcknowledged =
        acknowledgements.every(
          (acknowledgement) =>
            acknowledgement?.status ===
            "Acknowledged",
        );

      if (!allAcknowledged) {
        return;
      }

      const acknowledgementTimestamps =
        acknowledgements
          .map(
            (acknowledgement) =>
              acknowledgement?.acknowledgedAt ||
              acknowledgement?.updatedAt ||
              "",
          )
          .filter(Boolean)
          .sort();

      cycle.status = "Completed";
      cycle.completedAt =
        acknowledgementTimestamps[
        acknowledgementTimestamps.length - 1
        ] || new Date().toISOString();

      completedCycles.push(cycle);
    });

    if (completedCycles.length === 0) {
      return false;
    }

    if (bexPaIsIntegratedPersistenceContext()) {
      if (
        bexPaPersistence.mode !== "remote" ||
        !bexPaPersistence.ready
      ) {
        throw new Error(
          "Integrated cycle completion persistence is unavailable.",
        );
      }

      await bexPaPersistRemoteRecords(
        "cycles",
        completedCycles,
      );
    } else {
      bexPaSaveCycles();
    }

    return true;
  }
  async function bexPaAcknowledgeFinalAppraisal() {
    if (!bexPaIsEmployeeMode()) {
      return;
    }

    const currentEmployeeId =
      bexPaGetCurrentEmployeeId();

    const appraisal =
      bexPaState.employeeAppraisals.find(
        (existingAppraisal) =>
          existingAppraisal.id ===
          bexPaState.editingFinalAppraisalId &&
          existingAppraisal.employeeId ===
          currentEmployeeId,
      );

    if (!appraisal) {
      return;
    }

    const hrFinalisation =
      bexPaState.hrFinalisations.find(
        (existingFinalisation) =>
          existingFinalisation.appraisalId ===
          appraisal.id,
      );

    if (hrFinalisation?.status !== "Finalised") {
      return;
    }

    const existingAcknowledgement =
      bexPaState.employeeAcknowledgements.find(
        (acknowledgement) =>
          acknowledgement.appraisalId ===
          appraisal.id,
      );

    if (
      existingAcknowledgement?.status ===
      "Acknowledged"
    ) {
      return;
    }

    const timestamp =
      new Date().toISOString();

    const previousAppraisalStatus =
      appraisal.status;

    const previousAppraisalUpdatedAt =
      appraisal.updatedAt;

    appraisal.status = "Acknowledged";
    appraisal.updatedAt = timestamp;

    const acknowledgement = {
      id:
        `BEX-PA-ACKNOWLEDGEMENT-${appraisal.id}`,
      appraisalId: appraisal.id,
      employeeId: currentEmployeeId,
      status: "Acknowledged",
      acknowledgedAt: timestamp,
      updatedAt: timestamp,
    };

    const existingIndex =
      bexPaState.employeeAcknowledgements.findIndex(
        (existingAcknowledgement) =>
          existingAcknowledgement.appraisalId ===
          appraisal.id,
      );

    if (existingIndex === -1) {
      bexPaState.employeeAcknowledgements.push(
        acknowledgement,
      );
    } else {
      bexPaState.employeeAcknowledgements[
        existingIndex
      ] = acknowledgement;
    }

    try {
      await bexPaPersistDatasetMutation(
        "employeeAcknowledgements",
        acknowledgement,
        bexPaSaveEmployeeAcknowledgements,
      );

      await bexPaPersistDatasetMutation(
        "employeeAppraisals",
        appraisal,
        bexPaSaveEmployeeAppraisals,
      );
    } catch (error) {
      appraisal.status =
        previousAppraisalStatus;

      appraisal.updatedAt =
        previousAppraisalUpdatedAt;

      console.error(
        "Performance appraisal acknowledgement persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      if (bexPaElements.announcement) {
        bexPaElements.announcement.textContent =
          "The appraisal acknowledgement could not be saved. Please try again.";
      }

      return;
    }

    await bexPaCompleteEligibleCycles();

    bexPaCloseFinalAppraisal();
    bexPaRenderEmployeeAppraisals();
    bexPaRenderCycles();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        "Appraisal acknowledged successfully.";
    }
  }

  async function bexPaFinaliseHrAppraisal() {
    if (!bexPaIsHrAdminMode()) {
      return;
    }

    const appraisal =
      bexPaState.employeeAppraisals.find(
        (existingAppraisal) =>
          existingAppraisal.id ===
          bexPaState.editingHrAppraisalId,
      );

    if (!appraisal) {
      return;
    }

    const selfAppraisal =
      bexPaState.selfAppraisals.find(
        (existingSelfAppraisal) =>
          existingSelfAppraisal.appraisalId === appraisal.id,
      );

    const managerAppraisal =
      bexPaState.managerAppraisals.find(
        (existingManagerAppraisal) =>
          existingManagerAppraisal.appraisalId === appraisal.id,
      );

    if (
      selfAppraisal?.status !== "Submitted" ||
      managerAppraisal?.status !== "Submitted"
    ) {
      if (bexPaElements.announcement) {
        bexPaElements.announcement.textContent =
          "Employee and Manager appraisals must both be submitted before HR can finalise the appraisal.";
      }

      return;
    }

    const existingFinalisation =
      bexPaState.hrFinalisations.find(
        (finalisation) =>
          finalisation.appraisalId === appraisal.id,
      );

    if (existingFinalisation?.status === "Finalised") {
      return;
    }

    const timestamp = new Date().toISOString();

    const previousAppraisalStatus =
      appraisal.status;

    const previousAppraisalUpdatedAt =
      appraisal.updatedAt;

    appraisal.status = "Finalised";
    appraisal.updatedAt = timestamp;

    const hrFinalisation = {
      id:
        `BEX-PA-HR-FINALISATION-${appraisal.id}`,
      appraisalId: appraisal.id,
      employeeId: appraisal.employeeId,
      status: "Finalised",
      finalisedAt: timestamp,
      updatedAt: timestamp,
    };

    const existingIndex =
      bexPaState.hrFinalisations.findIndex(
        (finalisation) =>
          finalisation.appraisalId === appraisal.id,
      );

    if (existingIndex === -1) {
      bexPaState.hrFinalisations.push(
        hrFinalisation,
      );
    } else {
      bexPaState.hrFinalisations[existingIndex] =
        hrFinalisation;
    }

    try {
      await bexPaPersistDatasetMutation(
        "hrFinalisations",
        hrFinalisation,
        bexPaSaveHrFinalisations,
      );

      await bexPaPersistDatasetMutation(
        "employeeAppraisals",
        appraisal,
        bexPaSaveEmployeeAppraisals,
      );
    } catch (error) {
      appraisal.status =
        previousAppraisalStatus;

      appraisal.updatedAt =
        previousAppraisalUpdatedAt;
      console.error(
        "Performance appraisal HR finalisation persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      if (bexPaElements.announcement) {
        bexPaElements.announcement.textContent =
          "The appraisal finalisation could not be saved. Please try again.";
      }

      return;
    }

    bexPaRenderHrAppraisalReview(appraisal);
    bexPaRenderEmployeeAppraisals();
    bexPaRenderCycles();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        "Appraisal finalised successfully.";
    }
  }

  function bexPaShowManagerAppraisalError(message) {
    if (!bexPaElements.managerAppraisalError) {
      return;
    }

    bexPaElements.managerAppraisalError.textContent = message;
    bexPaElements.managerAppraisalError.classList.remove(
      "d-none",
    );
  }

  function bexPaClearManagerAppraisalError() {
    if (!bexPaElements.managerAppraisalError) {
      return;
    }

    bexPaElements.managerAppraisalError.textContent = "";
    bexPaElements.managerAppraisalError.classList.add(
      "d-none",
    );
  }

  function bexPaCreateManagerRatingField(
    individualGoal,
    ratingScale,
    response,
    isReadOnly = false,
  ) {
    const wrapper = document.createElement("div");
    wrapper.className = "mt-3";

    const ratingLabel = document.createElement("label");
    ratingLabel.className = "form-label small fw-semibold";
    ratingLabel.textContent = "Manager Rating";
    ratingLabel.htmlFor =
      `bexPaManagerRating-${individualGoal.id}`;

    const rating = document.createElement("select");
    rating.className = "form-select";
    rating.required = true;
    rating.id = ratingLabel.htmlFor;
    rating.dataset.bexPaManagerRating = individualGoal.id;
    rating.disabled = isReadOnly;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select rating";
    rating.appendChild(placeholder);

    ratingScale.forEach((configuredRating) => {
      const option = document.createElement("option");
      option.value = configuredRating;
      option.textContent = configuredRating;
      rating.appendChild(option);
    });

    rating.value = response?.rating || "";

    const commentLabel = document.createElement("label");
    commentLabel.className = "form-label small fw-semibold mt-3";
    commentLabel.textContent = "Manager Comment";
    commentLabel.htmlFor =
      `bexPaManagerComment-${individualGoal.id}`;

    const comment = document.createElement("textarea");
    comment.className = "form-control";
    comment.rows = 3;
    comment.maxLength = 1500;
    comment.id = commentLabel.htmlFor;
    comment.dataset.bexPaManagerComment = individualGoal.id;
    comment.value = response?.comment || "";
    comment.readOnly = isReadOnly;

    wrapper.append(
      ratingLabel,
      rating,
      commentLabel,
      comment,
    );

    return wrapper;
  }

  function bexPaRenderManagerAppraisalDetail(appraisal) {
    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id === appraisal.cycleId,
    );

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const selfAppraisal = bexPaState.selfAppraisals.find(
      (existingSelfAppraisal) =>
        existingSelfAppraisal.appraisalId === appraisal.id,
    );

    const managerAppraisal =
      bexPaState.managerAppraisals.find(
        (existingManagerAppraisal) =>
          existingManagerAppraisal.appraisalId === appraisal.id,
      );

    const isSubmitted =
      managerAppraisal?.status === "Submitted";
    const managerDisplayStatus =
      bexPaGetAppraisalDisplayStatus(
        appraisal,
        selfAppraisal,
        managerAppraisal,
        null,
        null,
      );

    if (bexPaElements.managerAppraisalTitle) {
      bexPaElements.managerAppraisalTitle.textContent =
        isSubmitted
          ? "Manager Appraisal"
          : "Complete Manager Appraisal";
    }

    const ratingScale = Array.isArray(template?.ratingScale)
      ? template.ratingScale
      : [];

    const goals = bexPaGetSelfAppraisalGoals(appraisal);

    bexPaState.editingManagerAppraisalId = appraisal.id;
    bexPaElements.managerAppraisalMeta.textContent =
      `${appraisal.employeeName || "Employee"} | ${cycle?.name || "Unknown cycle"} | ${template?.name || "Unknown template"} | Employee Self-Appraisal: Submitted${selfAppraisal?.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(selfAppraisal.submittedAt)}` : ""}`;

    bexPaElements.managerAppraisalSelfAppraisal.replaceChildren();

    const selfAppraisalHeading = document.createElement("h3");
    selfAppraisalHeading.className = "h6 fw-bold";
    selfAppraisalHeading.textContent = "Employee Self-Appraisal";
    bexPaElements.managerAppraisalSelfAppraisal.appendChild(
      selfAppraisalHeading,
    );

    const selfCompetencies = Array.isArray(
      selfAppraisal?.competencyResponses,
    )
      ? selfAppraisal.competencyResponses
      : [];

    selfCompetencies.forEach((response) => {
      const competency = template?.competencies?.find(
        (existingCompetency) =>
          existingCompetency.id === response.competencyId,
      );

      const item = document.createElement("div");
      item.className =
        "border rounded-3 p-3 mb-3 bg-body-tertiary";

      const title = document.createElement("p");
      title.className = "mb-1 fw-semibold";
      title.textContent = competency?.name || response.competencyId;

      const rating = document.createElement("p");
      rating.className = "mb-1 small";
      rating.textContent = `Employee Rating: ${response.rating || "Not provided"}`;

      const comment = document.createElement("p");
      comment.className = "mb-0 small text-body-secondary";
      comment.textContent = `Employee Comment: ${response.comment || "Not provided"}`;

      item.append(title, rating, comment);
      bexPaElements.managerAppraisalSelfAppraisal.appendChild(item);
    });

    const employeeAchievement = document.createElement("div");

    employeeAchievement.className =
      "border rounded-3 p-3 bg-body-tertiary";

    const employeeAchievementTitle =
      document.createElement("p");

    employeeAchievementTitle.className =
      "mb-1 fw-semibold";

    employeeAchievementTitle.textContent =
      "Overall Employee Summary";

    const employeeAchievementText =
      document.createElement("p");

    employeeAchievementText.className =
      "mb-0 small text-body-secondary";

    employeeAchievementText.textContent =
      selfAppraisal?.employeeAchievement ||
      selfAppraisal?.overallSummary ||
      "Not provided";

    employeeAchievement.append(
      employeeAchievementTitle,
      employeeAchievementText,
    );

    bexPaElements.managerAppraisalSelfAppraisal.appendChild(
      employeeAchievement,
    );

    bexPaElements.managerAppraisalGoals.replaceChildren();

    const goalsHeading = document.createElement("h3");
    goalsHeading.className = "h6 fw-bold";
    goalsHeading.textContent = "Goals and Progress";
    bexPaElements.managerAppraisalGoals.appendChild(goalsHeading);

    goals.forEach((individualGoal) => {
      const response = selfAppraisal?.goalResponses?.find(
        (existingResponse) =>
          existingResponse.individualGoalId === individualGoal.id,
      );

      const managerResponse = managerAppraisal?.goalResponses?.find(
        (existingResponse) =>
          existingResponse.individualGoalId === individualGoal.id,
      );

      const goalItem = document.createElement("article");
      goalItem.className =
        "bex-pa-goal-item border rounded-3 p-3 mb-4";

      const title = document.createElement("h4");
      title.className = "h6 fw-bold";
      title.textContent = individualGoal.title;

      const target = document.createElement("p");
      target.className = "small mb-2";
      target.textContent = `Target: ${individualGoal.target}`;

      const progress = bexPaState.progressUpdates.filter(
        (progressUpdate) =>
          progressUpdate.individualGoalId === individualGoal.id,
      );

      const progressHistory = document.createElement("div");
      progressHistory.className = "small text-body-secondary mb-3";
      progressHistory.textContent = progress.length === 0
        ? "No progress evidence submitted yet."
        : progress
          .map(
            (progressUpdate) =>
              `${progressUpdate.progressPercentage}% - ${progressUpdate.status}: ${progressUpdate.updateText}${progressUpdate.evidence ? ` (${progressUpdate.evidence})` : ""}`,
          )
          .join(" | ");

      const achievementBlock = document.createElement("div");
      achievementBlock.className =
        "border rounded-3 p-3 mt-3 bg-body-tertiary";

      const achievementLabel = document.createElement("p");
      achievementLabel.className =
        "small fw-semibold mb-1";
      achievementLabel.textContent =
        "Employee achievement";

      const achievementText = document.createElement("p");
      achievementText.className =
        "small mb-0 text-body-secondary";
      achievementText.textContent =
        response?.achievement || "Not provided";

      achievementBlock.append(
        achievementLabel,
        achievementText,
      );

      goalItem.append(
        title,
        target,
        progressHistory,
        achievementBlock,
        bexPaCreateManagerRatingField(
          individualGoal,
          ratingScale,
          managerResponse,
          isSubmitted,
        ),
      );

      bexPaElements.managerAppraisalGoals.appendChild(goalItem);
    });

    const rememberedValues =
      bexPaGetRememberedFormValues(
        `managerAppraisal:${appraisal.id}`,
      );

    bexPaElements.managerAppraisalOverallComment.value =
      managerAppraisal?.overallComment ||
      "";

    if (!managerAppraisal) {
      if (Array.isArray(rememberedValues.goalResponses)) {
        rememberedValues.goalResponses.forEach(
          (response) => {
            bexPaApplyRememberedValues([
              [
                bexPaElements.managerAppraisalGoals.querySelector(
                  `[data-bex-pa-manager-rating="${CSS.escape(response.individualGoalId)}"]`,
                ),
                response.rating,
              ],
              [
                bexPaElements.managerAppraisalGoals.querySelector(
                  `[data-bex-pa-manager-comment="${CSS.escape(response.individualGoalId)}"]`,
                ),
                response.comment,
              ],
            ]);
          },
        );
      }

      bexPaApplyRememberedValues([
        [
          bexPaElements.managerAppraisalOverallComment,
          rememberedValues.overallComment,
        ],
      ]);
    }
    bexPaElements.managerAppraisalOverallComment.readOnly =
      isSubmitted;
    bexPaElements.saveManagerAppraisalButton?.classList.toggle(
      "d-none",
      isSubmitted,
    );

    bexPaElements.submitManagerAppraisalButton?.classList.toggle(
      "d-none",
      isSubmitted,
    );

    if (isSubmitted) {
      bexPaElements.managerAppraisalMeta.textContent +=
        ` | Manager Appraisal: Submitted${managerAppraisal?.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(managerAppraisal.submittedAt)}` : ""}`;
    } else {
      bexPaElements.managerAppraisalMeta.textContent +=
        ` | Manager Appraisal: ${managerDisplayStatus}`;
    }

    // BEXHR MANAGER APPRAISAL FOCUS - US-07 QA CORRECTION
    // Keep the existing form fields/actions but present them as one focused
    // manager-review task at a time.
    bexPaApplyManagerAppraisalClarity(appraisal);

    bexPaElements.managerAppraisalSection.classList.remove(
      "d-none",
    );
  }

  function bexPaCloseManagerAppraisalDetail() {
    bexPaState.editingManagerAppraisalId = null;
    bexPaElements.managerAppraisalSection?.classList.add(
      "d-none",
    );
    bexPaSetEmployeeAppraisalRegisterVisible(true);
    bexPaClearManagerAppraisalError();

    const registerCard =
      bexPaElements.employeeAppraisalsList?.closest(
        ".bex-pa-appraisal-register-card",
      );

    window.requestAnimationFrame(() => {
      registerCard?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function bexPaOpenManagerAppraisal(appraisalId) {
    const appraisal =
      bexPaGetEligibleManagerAppraisals().find(
        (existingAppraisal) =>
          existingAppraisal.id === appraisalId,
      );

    if (!appraisal) {
      return;
    }

    bexPaClearManagerAppraisalError();

    // BEXHR MANAGER APPRAISAL FOCUS - US-07 QA CORRECTION
    // The queue selects an employee; it must not remain stacked above the
    // active manager review once that employee has been opened.
    bexPaSetEmployeeAppraisalRegisterVisible(false);

    bexPaElements.selfAppraisalSection?.classList.add(
      "d-none",
    );
    bexPaElements.hrAppraisalReviewSection?.classList.add(
      "d-none",
    );
    bexPaElements.finalAppraisalSection?.classList.add(
      "d-none",
    );

    bexPaRenderManagerAppraisalDetail(appraisal);
    bexPaElements.managerAppraisalSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function bexPaValidateManagerAppraisalDraft(
    managerAppraisal,
    appraisal,
    goals,
    ratingScale,
  ) {
    if (
      !bexPaGetEligibleManagerAppraisals().some(
        (eligibleAppraisal) =>
          eligibleAppraisal.id === appraisal.id,
      )
    ) {
      return "Only an eligible submitted self-appraisal for your direct report can be saved.";
    }

    if (
      managerAppraisal.goalResponses.length !== goals.length ||
      managerAppraisal.goalResponses.some(
        (response) =>
          !response.rating ||
          !ratingScale.includes(response.rating) ||
          !goals.some(
            (individualGoal) =>
              individualGoal.id === response.individualGoalId,
          ),
      )
    ) {
      return "Select a manager rating for every displayed goal.";
    }

    if (!managerAppraisal.overallComment.trim()) {
      return "Enter Manager's Overall Comments before saving the draft.";
    }

    return "";
  }

  async function bexPaHandleManagerAppraisalSave(
    event,
    isFinalSubmission = false,
  ) {
    event.preventDefault();
    bexPaClearManagerAppraisalError();

    const appraisal =
      bexPaGetEligibleManagerAppraisals().find(
        (existingAppraisal) =>
          existingAppraisal.id ===
          bexPaState.editingManagerAppraisalId,
      );

    if (!appraisal) {
      bexPaShowManagerAppraisalError(
        "Only an eligible submitted self-appraisal for your direct report can be saved.",
      );
      return;
    }

    const existingManagerAppraisal =
      bexPaState.managerAppraisals.find(
        (managerAppraisal) =>
          managerAppraisal.appraisalId === appraisal.id,
      );

    if (existingManagerAppraisal?.status === "Submitted") {
      bexPaShowManagerAppraisalError(
        "This manager appraisal has already been submitted.",
      );
      return;
    }

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const ratingScale = Array.isArray(template?.ratingScale)
      ? template.ratingScale
      : [];

    const goals = bexPaGetSelfAppraisalGoals(appraisal);

    const managerAppraisal = {
      id:
        `BEX-PA-MANAGER-APPRAISAL-${appraisal.id}`,
      appraisalId: appraisal.id,
      employeeId: appraisal.employeeId,
      managerEmployeeId: bexPaGetCurrentManagerEmployeeId(),
      status: isFinalSubmission ? "Submitted" : "Draft",
      goalResponses: goals.map((individualGoal) => ({
        individualGoalId: individualGoal.id,
        rating:
          bexPaElements.managerAppraisalGoals.querySelector(
            `[data-bex-pa-manager-rating="${CSS.escape(individualGoal.id)}"]`,
          )?.value || "",
        comment:
          bexPaElements.managerAppraisalGoals.querySelector(
            `[data-bex-pa-manager-comment="${CSS.escape(individualGoal.id)}"]`,
          )?.value.trim() || "",
      })),
      overallComment:
        bexPaElements.managerAppraisalOverallComment.value.trim(),
      updatedAt: new Date().toISOString(),
    };

    if (isFinalSubmission) {
      managerAppraisal.submittedAt =
        new Date().toISOString();
    }

    const validationError =
      bexPaValidateManagerAppraisalDraft(
        managerAppraisal,
        appraisal,
        goals,
        ratingScale,
      );

    if (validationError) {
      bexPaShowManagerAppraisalError(validationError);
      return;
    }

    bexPaRememberFormValues(
      `managerAppraisal:${appraisal.id}`,
      {
        goalResponses: managerAppraisal.goalResponses.map(
          (response) => ({ ...response }),
        ),
        overallComment: managerAppraisal.overallComment,
      },
    );

    const existingIndex =
      bexPaState.managerAppraisals.findIndex(
        (storedManagerAppraisal) =>
          storedManagerAppraisal.appraisalId === appraisal.id,
      );

    if (existingIndex === -1) {
      bexPaState.managerAppraisals.push(managerAppraisal);
    } else {
      bexPaState.managerAppraisals[existingIndex] =
        managerAppraisal;
    }

    try {
      await bexPaPersistDatasetMutation(
        "managerAppraisals",
        managerAppraisal,
        bexPaSaveManagerAppraisals,
      );
    } catch (error) {
      console.error(
        "Performance appraisal manager persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowManagerAppraisalError(
        "The manager appraisal could not be saved. Please try again.",
      );
      return;
    }
    bexPaRenderManagerAppraisalDetail(appraisal);
    bexPaRenderEmployeeAppraisals();
    bexPaRenderCycles();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        isFinalSubmission
          ? "Manager appraisal submitted successfully."
          : "Manager appraisal draft saved successfully.";
    }
  }

  function bexPaGetSelfAppraisalGoals(appraisal) {
    return bexPaState.individualGoals.filter(
      (individualGoal) =>
        individualGoal.employeeId === appraisal.employeeId &&
        individualGoal.cycleId === appraisal.cycleId,
    );
  }

  function bexPaGetApplicableSelfAppraisalCompetencies(
    template,
  ) {
    return (
      Array.isArray(template?.competencies)
        ? template.competencies
        : []
    )
      .filter(
        (competency) =>
          competency.applicability === "All Employees",
      )
      .sort(
        (firstCompetency, secondCompetency) =>
          firstCompetency.order - secondCompetency.order,
      );
  }

  function bexPaShowSelfAppraisalError(message) {
    if (!bexPaElements.selfAppraisalError) {
      return;
    }

    bexPaElements.selfAppraisalError.textContent = message;
    bexPaElements.selfAppraisalError.classList.remove(
      "d-none",
    );
  }

  function bexPaClearSelfAppraisalError() {
    if (!bexPaElements.selfAppraisalError) {
      return;
    }

    bexPaElements.selfAppraisalError.textContent = "";
    bexPaElements.selfAppraisalError.classList.add(
      "d-none",
    );
  }

  function bexPaCreateSelfAppraisalRatingField(
    competency,
    ratingScale,
    response,
  ) {
    const wrapper = document.createElement("div");
    wrapper.className = "mb-4";

    const label = document.createElement("label");
    label.className = "form-label fw-semibold";
    label.textContent = competency.name;

    const select = document.createElement("select");
    select.className = "form-select";
    select.required = true;
    select.dataset.bexPaSelfAppraisalCompetencyRating =
      competency.id;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select rating";
    select.appendChild(placeholder);

    ratingScale.forEach((rating) => {
      const option = document.createElement("option");
      option.value = rating;
      option.textContent = rating;
      select.appendChild(option);
    });

    select.value = response?.rating || "";
    label.htmlFor = select.id =
      `bexPaSelfAppraisalRating-${competency.id}`;

    const description = document.createElement("p");
    description.className = "mb-2 small text-body-secondary";
    description.textContent = competency.description;

    const commentLabel = document.createElement("label");
    commentLabel.className = "form-label small fw-semibold";
    commentLabel.textContent = "Your comments";
    commentLabel.htmlFor =
      `bexPaSelfAppraisalCompetencyComment-${competency.id}`;

    const comment = document.createElement("textarea");
    comment.className = "form-control";
    comment.rows = 3;
    comment.maxLength = 1000;
    comment.id = commentLabel.htmlFor;
    comment.dataset.bexPaSelfAppraisalCompetencyComment =
      competency.id;
    comment.value = response?.comment || "";

    wrapper.append(
      label,
      description,
      select,
      commentLabel,
      comment,
    );

    return wrapper;
  }

  function bexPaRenderSelfAppraisalDetail(appraisal) {
    const cycle = bexPaState.cycles.find(
      (existingCycle) =>
        existingCycle.id === appraisal.cycleId,
    );

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const selfAppraisal = bexPaState.selfAppraisals.find(
      (existingSelfAppraisal) =>
        existingSelfAppraisal.appraisalId === appraisal.id,
    );

    const competencies =
      bexPaGetApplicableSelfAppraisalCompetencies(
        template,
      );

    const ratingScale = Array.isArray(template?.ratingScale)
      ? template.ratingScale
      : [];

    const goals = bexPaGetSelfAppraisalGoals(appraisal);
    const isSubmitted = selfAppraisal?.status === "Submitted";
    const selfDisplayStatus =
      bexPaGetAppraisalDisplayStatus(
        appraisal,
        selfAppraisal,
        null,
        null,
        null,
      );

    bexPaState.editingSelfAppraisalId = appraisal.id;
    bexPaElements.selfAppraisalMeta.textContent =
      `${cycle?.name || "Unknown cycle"} | ${template?.name || "Unknown template"} | Status: ${selfDisplayStatus}${isSubmitted && selfAppraisal.submittedAt ? ` | Submitted: ${bexPaFormatTimestamp(selfAppraisal.submittedAt)}` : ""}`;

    bexPaElements.selfAppraisalCompetencies.replaceChildren();

    const competencyHeading = document.createElement("h3");
    competencyHeading.className = "h6 fw-bold";
    competencyHeading.textContent = "Assessment Areas";
    bexPaElements.selfAppraisalCompetencies.appendChild(
      competencyHeading,
    );

    if (competencies.length === 0) {
      const emptyCompetencies = document.createElement("p");
      emptyCompetencies.className = "text-body-secondary";
      emptyCompetencies.textContent =
        "No employee-applicable competencies are configured for this template.";
      bexPaElements.selfAppraisalCompetencies.appendChild(
        emptyCompetencies,
      );
    } else {
      competencies.forEach((competency) => {
        const response = selfAppraisal?.competencyResponses?.find(
          (existingResponse) =>
            existingResponse.competencyId === competency.id,
        );

        bexPaElements.selfAppraisalCompetencies.appendChild(
          bexPaCreateSelfAppraisalRatingField(
            competency,
            ratingScale,
            response,
          ),
        );
      });
    }

    bexPaElements.selfAppraisalGoals.replaceChildren();

    const goalsHeading = document.createElement("h3");
    goalsHeading.className = "h6 fw-bold";
    goalsHeading.textContent = "Your Goals & Progress";
    bexPaElements.selfAppraisalGoals.appendChild(goalsHeading);

    if (goals.length === 0) {
      const emptyGoals = document.createElement("p");
      emptyGoals.className = "text-body-secondary";
      emptyGoals.textContent =
        "No individual goals are assigned for this appraisal cycle.";
      bexPaElements.selfAppraisalGoals.appendChild(emptyGoals);
    }

    goals.forEach((individualGoal) => {
      const response = selfAppraisal?.goalResponses?.find(
        (existingResponse) =>
          existingResponse.individualGoalId ===
          individualGoal.id,
      );

      const goalItem = document.createElement("article");
      goalItem.className = "bex-pa-goal-item mb-3";

      const title = document.createElement("h4");
      title.className = "h6 fw-bold";
      title.textContent = individualGoal.title;

      const target = document.createElement("p");
      target.className = "small mb-2";
      target.textContent = `Target: ${individualGoal.target}`;

      const progress = bexPaState.progressUpdates.filter(
        (progressUpdate) =>
          progressUpdate.individualGoalId === individualGoal.id,
      );

      const progressHistory = document.createElement("div");
      progressHistory.className = "small text-body-secondary mb-3";
      progressHistory.textContent = progress.length === 0
        ? "No progress evidence submitted yet."
        : progress
          .map(
            (progressUpdate) =>
              `${progressUpdate.progressPercentage}% - ${progressUpdate.status}: ${progressUpdate.updateText}${progressUpdate.evidence ? ` (${progressUpdate.evidence})` : ""}`,
          )
          .join(" | ");

      const achievementLabel = document.createElement("label");
      achievementLabel.className = "form-label small fw-semibold";
      achievementLabel.textContent =
        "What did you achieve?";
      achievementLabel.htmlFor =
        `bexPaSelfAppraisalAchievement-${individualGoal.id}`;

      const achievement = document.createElement("textarea");
      achievement.className = "form-control mb-2";
      achievement.rows = 3;
      achievement.maxLength = 1500;
      achievement.required = true;
      achievement.id = achievementLabel.htmlFor;
      achievement.dataset.bexPaSelfAppraisalAchievement =
        individualGoal.id;
      achievement.value = response?.achievement || "";

      goalItem.append(
        title,
        target,
        progressHistory,
        achievementLabel,
        achievement,
      );

      bexPaElements.selfAppraisalGoals.appendChild(goalItem);
    });

    const rememberedValues =
      bexPaGetRememberedFormValues(
        `selfAppraisal:${appraisal.id}`,
      );

    bexPaElements.selfAppraisalAchievement.value =
      selfAppraisal?.employeeAchievement ||
      selfAppraisal?.overallSummary ||
      "";

    if (!selfAppraisal) {
      if (Array.isArray(rememberedValues.competencyResponses)) {
        rememberedValues.competencyResponses.forEach(
          (response) => {
            bexPaApplyRememberedValues([
              [
                bexPaElements.selfAppraisalCompetencies.querySelector(
                  `[data-bex-pa-self-appraisal-competency-rating="${CSS.escape(response.competencyId)}"]`,
                ),
                response.rating,
              ],
              [
                bexPaElements.selfAppraisalCompetencies.querySelector(
                  `[data-bex-pa-self-appraisal-competency-comment="${CSS.escape(response.competencyId)}"]`,
                ),
                response.comment,
              ],
            ]);
          },
        );
      }

      if (Array.isArray(rememberedValues.goalResponses)) {
        rememberedValues.goalResponses.forEach(
          (response) => {
            bexPaApplyRememberedValues([
              [
                bexPaElements.selfAppraisalGoals.querySelector(
                  `[data-bex-pa-self-appraisal-achievement="${CSS.escape(response.individualGoalId)}"]`,
                ),
                response.achievement,
              ],
            ]);
          },
        );
      }

      bexPaApplyRememberedValues([
        [
          bexPaElements.selfAppraisalAchievement,
          rememberedValues.employeeAchievement,
        ],
      ]);
    }
    bexPaElements.selfAppraisalForm
      .querySelectorAll("select, textarea")
      .forEach((field) => {
        field.disabled = isSubmitted;
      });
    bexPaElements.saveSelfAppraisalButton.classList.toggle(
      "d-none",
      isSubmitted,
    );

    bexPaElements.submitSelfAppraisalButton.classList.toggle(
      "d-none",
      isSubmitted,
    );

    // BEXHR EMPLOYEE APPRAISAL CLARITY - US-06
    bexPaApplyEmployeeSelfAppraisalClarity();

    bexPaElements.selfAppraisalSection.classList.remove(
      "d-none",
    );
  }

  function bexPaCloseSelfAppraisalDetail() {
    bexPaState.editingSelfAppraisalId = null;
    bexPaElements.selfAppraisalSection?.classList.add(
      "d-none",
    );
    bexPaSetEmployeeAppraisalRegisterVisible(true);
    bexPaClearSelfAppraisalError();
  }

  function bexPaOpenSelfAppraisal(appraisalId, options = {}) {
    const appraisal =
      bexPaGetEligibleEmployeeAppraisals().find(
        (existingAppraisal) =>
          existingAppraisal.id === appraisalId,
      );

    if (!appraisal) {
      return;
    }

    bexPaClearSelfAppraisalError();
    bexPaSetEmployeeAppraisalRegisterVisible(false);

    const isAlreadyOpen =
      bexPaState.editingSelfAppraisalId === appraisal.id &&
      bexPaElements.selfAppraisalSection &&
      bexPaElements.selfAppraisalForm;

    if (isAlreadyOpen) {
      bexPaElements.selfAppraisalSection.classList.remove("d-none");
      bexPaApplyEmployeeSelfAppraisalClarity();
    } else {
      bexPaRenderSelfAppraisalDetail(appraisal);
    }

    if (options.scroll !== false) {
      bexPaElements.selfAppraisalSection.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

  function bexPaValidateSelfAppraisalDraft(
    selfAppraisal,
    appraisal,
    competencies,
    goals,
    ratingScale,
  ) {
    if (!selfAppraisal.employeeAchievement.trim()) {
      return "Complete your achievements, challenges and suggestions summary before saving the draft.";
    }

    if (
      selfAppraisal.competencyResponses.length !==
      competencies.length
    ) {
      return "Complete every applicable competency rating.";
    }

    if (
      selfAppraisal.competencyResponses.some(
        (response) =>
          !response.rating ||
          !ratingScale.includes(response.rating) ||
          !competencies.some(
            (competency) =>
              competency.id === response.competencyId,
          ),
      )
    ) {
      return "Complete every applicable competency rating.";
    }

    if (
      selfAppraisal.goalResponses.length !== goals.length ||
      selfAppraisal.goalResponses.some(
        (response) =>
          !response.achievement.trim() ||
          !goals.some(
            (individualGoal) =>
              individualGoal.id === response.individualGoalId,
          ),
      )
    ) {
      return "Complete the achievement response for every assigned goal.";
    }

    if (
      selfAppraisal.employeeId !== appraisal.employeeId
    ) {
      return "This self-appraisal does not belong to the authenticated employee.";
    }

    return "";
  }

  async function bexPaHandleSelfAppraisalSubmit(
    event,
    isFinalSubmission = false,
  ) {
    event.preventDefault();
    bexPaClearSelfAppraisalError();

    const appraisal =
      bexPaGetEligibleEmployeeAppraisals().find(
        (existingAppraisal) =>
          existingAppraisal.id ===
          bexPaState.editingSelfAppraisalId,
      );

    if (!appraisal) {
      bexPaShowSelfAppraisalError(
        isFinalSubmission
          ? "Only your own eligible appraisal can be submitted."
          : "Only your own eligible appraisal can be edited.",
      );
      return;
    }

    const existingSelfAppraisal =
      bexPaState.selfAppraisals.find(
        (selfAppraisal) =>
          selfAppraisal.appraisalId === appraisal.id,
      );

    if (existingSelfAppraisal?.status === "Submitted") {
      bexPaShowSelfAppraisalError(
        "This self-appraisal has already been submitted.",
      );
      return;
    }

    const template =
      bexPaGetAppraisalTemplate(appraisal);

    const ratingScale = Array.isArray(template?.ratingScale)
      ? template.ratingScale
      : [];

    const competencies =
      bexPaGetApplicableSelfAppraisalCompetencies(
        template,
      );
    const goals = bexPaGetSelfAppraisalGoals(appraisal);

    const selfAppraisal = {
      id:
        `BEX-PA-SELF-APPRAISAL-${appraisal.id}`,
      appraisalId: appraisal.id,
      employeeId: bexPaGetCurrentEmployeeId(),
      status: isFinalSubmission ? "Submitted" : "Draft",
      competencyResponses: competencies.map(
        (competency) => ({
          competencyId: competency.id,
          rating:
            bexPaElements.selfAppraisalCompetencies
              .querySelector(
                `[data-bex-pa-self-appraisal-competency-rating="${CSS.escape(competency.id)}"]`,
              )?.value || "",
          comment:
            bexPaElements.selfAppraisalCompetencies
              .querySelector(
                `[data-bex-pa-self-appraisal-competency-comment="${CSS.escape(competency.id)}"]`,
              )?.value.trim() || "",
        }),
      ),
      goalResponses: goals.map((individualGoal) => ({
        individualGoalId: individualGoal.id,
        achievement:
          bexPaElements.selfAppraisalGoals
            .querySelector(
              `[data-bex-pa-self-appraisal-achievement="${CSS.escape(individualGoal.id)}"]`,
            )?.value.trim() || "",
      })),
      employeeAchievement:
        bexPaElements.selfAppraisalAchievement.value.trim(),
      updatedAt: new Date().toISOString(),
    };

    if (isFinalSubmission) {
      selfAppraisal.submittedAt = new Date().toISOString();
    }

    const validationError =
      bexPaValidateSelfAppraisalDraft(
        selfAppraisal,
        appraisal,
        competencies,
        goals,
        ratingScale,
      );

    if (validationError) {
      bexPaShowSelfAppraisalError(validationError);
      return;
    }

    bexPaRememberFormValues(
      `selfAppraisal:${appraisal.id}`,
      {
        competencyResponses:
          selfAppraisal.competencyResponses.map(
            (response) => ({
              ...response,
            }),
          ),
        goalResponses:
          selfAppraisal.goalResponses.map(
            (response) => ({
              ...response,
            }),
          ),
        employeeAchievement:
          selfAppraisal.employeeAchievement,
      },
    );

    const existingIndex =
      bexPaState.selfAppraisals.findIndex(
        (existingSelfAppraisal) =>
          existingSelfAppraisal.appraisalId ===
          appraisal.id,
      );

    if (existingIndex === -1) {
      bexPaState.selfAppraisals.push(selfAppraisal);
    } else {
      bexPaState.selfAppraisals[existingIndex] =
        selfAppraisal;
    }

    try {
      await bexPaPersistDatasetMutation(
        "selfAppraisals",
        selfAppraisal,
        bexPaSaveSelfAppraisals,
      );
    } catch (error) {
      console.error(
        "Performance appraisal self-appraisal persistence failed.",
        error,
      );

      if (bexPaIsIntegratedPersistenceContext()) {
        try {
          await bexPaHydrateRemoteState();
        } catch (hydrateError) {
          console.error(
            "Performance appraisal state recovery failed.",
            hydrateError,
          );
        }
      }

      bexPaShowSelfAppraisalError(
        "The self-appraisal could not be saved. Please try again.",
      );
      return;
    }

    bexPaRenderSelfAppraisalDetail(appraisal);
    bexPaRenderEmployeeAppraisals();
    bexPaRenderCycles();

    if (bexPaElements.announcement) {
      bexPaElements.announcement.textContent =
        isFinalSubmission
          ? "Self-appraisal submitted successfully."
          : "Self-appraisal draft saved successfully.";
    }
  }

  function bexPaRenderEmployeeAppraisals() {
    if (!bexPaElements.employeeAppraisalsList) {
      return;
    }

    bexPaElements.employeeAppraisalsList.replaceChildren();

    const appraisals =
      bexPaGetVisibleEmployeeAppraisals();

    if (appraisals.length === 0) {
      const emptyState =
        document.createElement("p");

      emptyState.className =
        "mb-0 text-body-secondary";

      emptyState.id =
        "bexPaEmployeeAppraisalsEmpty";

      emptyState.textContent =
        "No employee appraisals are available yet.";

      bexPaElements.employeeAppraisalsList.appendChild(
        emptyState,
      );

      return;
    }

    const employeeGroups = new Map();

    appraisals.forEach(
      (appraisal) => {
        const employeeKey =
          String(
            appraisal.employeeId ||
            appraisal.employeeName ||
            appraisal.id,
          ).trim();

        let employeeGroupBody =
          employeeGroups.get(employeeKey);

        if (!employeeGroupBody) {
          const employeeGroup =
            document.createElement("section");

          employeeGroup.className =
            "bex-pa-appraisal-employee-group";

          const employeeHeader =
            document.createElement("div");

          employeeHeader.className =
            "bex-pa-appraisal-employee-header";

          const employeeLabel =
            document.createElement("span");

          employeeLabel.className =
            "bex-pa-appraisal-employee-label";

          employeeLabel.textContent =
            "Employee";

          const employeeName =
            document.createElement("h3");

          employeeName.className =
            "bex-pa-appraisal-employee-name";

          employeeName.textContent =
            appraisal.employeeName ||
            "Employee";

          employeeGroupBody =
            document.createElement("div");

          employeeGroupBody.className =
            "bex-pa-appraisal-employee-body";

          employeeHeader.append(
            employeeLabel,
            employeeName,
          );

          employeeGroup.append(
            employeeHeader,
            employeeGroupBody,
          );

          bexPaElements.employeeAppraisalsList.appendChild(
            employeeGroup,
          );

          employeeGroups.set(
            employeeKey,
            employeeGroupBody,
          );
        }

        const cycle =
          bexPaState.cycles.find(
            (existingCycle) =>
              existingCycle.id === appraisal.cycleId,
          );

        const template =
          bexPaGetAppraisalTemplate(appraisal);

        const selfAppraisal =
          bexPaState.selfAppraisals.find(
            (existingSelfAppraisal) =>
              existingSelfAppraisal.appraisalId === appraisal.id,
          );

        const managerAppraisal =
          bexPaState.managerAppraisals.find(
            (existingManagerAppraisal) =>
              existingManagerAppraisal.appraisalId === appraisal.id,
          );

        const hrFinalisation =
          bexPaState.hrFinalisations.find(
            (existingFinalisation) =>
              existingFinalisation.appraisalId === appraisal.id,
          );

        const acknowledgement =
          bexPaState.employeeAcknowledgements.find(
            (existingAcknowledgement) =>
              existingAcknowledgement.appraisalId === appraisal.id,
          );

        const displayStatus =
          bexPaGetAppraisalDisplayStatus(
            appraisal,
            selfAppraisal,
            managerAppraisal,
            hrFinalisation,
            acknowledgement,
          );

        const item =
          document.createElement("article");

        item.className =
          "bex-pa-goal-item bex-pa-appraisal-item";

        const header =
          document.createElement("div");

        header.className =
          "bex-pa-appraisal-item-header";

        const titleArea =
          document.createElement("div");

        titleArea.className =
          "bex-pa-appraisal-item-copy";

        const cycleLabel =
          document.createElement("span");

        cycleLabel.className =
          "bex-pa-appraisal-cycle-label";

        cycleLabel.textContent =
          "Appraisal cycle";

        const title =
          document.createElement("h3");

        title.className =
          "bex-pa-goal-item-title h6";

        title.textContent =
          cycle?.name ||
          "Unknown appraisal cycle";

        const meta =
          document.createElement("div");

        meta.className =
          "bex-pa-goal-meta";

        const templateLabel =
          document.createElement("span");

        templateLabel.className =
          "bex-pa-appraisal-template";

        templateLabel.textContent =
          `Template: ${template?.name || "Unknown template"}`;

        meta.append(
          templateLabel,
        );

        titleArea.append(
          cycleLabel,
          title,
          meta,
        );

        const status =
          document.createElement("span");

        status.className =
          "bex-pa-goal-status";

        status.dataset.status =
          String(displayStatus)
            .toLowerCase()
            .replaceAll(" ", "-");

        status.textContent =
          displayStatus;

        header.append(
          titleArea,
          status,
        );

        item.appendChild(
          header,
        );

        const actions =
          document.createElement("div");

        actions.className =
          "bex-pa-appraisal-actions";

        if (
          bexPaIsEmployeeMode() &&
          (
            hrFinalisation?.status === "Finalised" ||
            bexPaGetEligibleEmployeeAppraisals().some(
              (eligibleAppraisal) =>
                eligibleAppraisal.id === appraisal.id,
            )
          )
        ) {
          const openButton = document.createElement("button");
          openButton.type = "button";
          openButton.className =
            "btn btn-sm btn-outline-primary";
          openButton.dataset.bexPaEmployeeAppraisalId =
            appraisal.id;

          if (hrFinalisation?.status === "Finalised") {
            openButton.dataset.bexPaEmployeeAppraisalAction =
              "open-final";
            openButton.textContent = "View Final Appraisal";
            openButton.setAttribute(
              "aria-label",
              `View final appraisal for ${appraisal.employeeName}`,
            );
          } else {
            openButton.dataset.bexPaEmployeeAppraisalAction =
              "open";

            const selfAppraisalIsSubmitted =
              selfAppraisal?.status === "Submitted";

            const hasSelfAppraisalDraft =
              bexPaHasSavedDraft(selfAppraisal);

            openButton.textContent =
              selfAppraisalIsSubmitted
                ? "View Self-Appraisal"
                : hasSelfAppraisalDraft
                  ? "Continue Self-Appraisal"
                  : "Start Self-Appraisal";

            openButton.setAttribute(
              "aria-label",
              selfAppraisalIsSubmitted
                ? `View self-appraisal for ${appraisal.employeeName}`
                : hasSelfAppraisalDraft
                  ? `Continue self-appraisal for ${appraisal.employeeName}`
                  : `Start self-appraisal for ${appraisal.employeeName}`,
            );
          }

          actions.appendChild(openButton);
        }

        if (bexPaIsHrAdminMode()) {
          const reviewButton = document.createElement("button");

          reviewButton.type = "button";
          reviewButton.className =
            "btn btn-sm btn-outline-primary";

          reviewButton.dataset.bexPaEmployeeAppraisalAction =
            "open-hr-review";

          reviewButton.dataset.bexPaEmployeeAppraisalId =
            appraisal.id;

          reviewButton.textContent =
            "Review Appraisal";

          reviewButton.setAttribute(
            "aria-label",
            `Review appraisal for ${appraisal.employeeName}`,
          );

          actions.appendChild(reviewButton);
        }

        if (
          bexPaIsPrimaryManagerMode() &&
          bexPaGetEligibleManagerAppraisals().some(
            (eligibleAppraisal) =>
              eligibleAppraisal.id === appraisal.id,
          )
        ) {
          const openButton = document.createElement("button");
          openButton.type = "button";
          openButton.className =
            "btn btn-sm btn-outline-primary";
          openButton.dataset.bexPaEmployeeAppraisalAction =
            "open-manager";
          openButton.dataset.bexPaEmployeeAppraisalId =
            appraisal.id;
          const managerAppraisalIsSubmitted =
            managerAppraisal?.status === "Submitted";
          const hasManagerAppraisalDraft =
            bexPaHasSavedDraft(managerAppraisal);

          openButton.textContent =
            managerAppraisalIsSubmitted
              ? "View Manager Appraisal"
              : hasManagerAppraisalDraft
                ? "Continue Manager Appraisal"
                : "Start Manager Appraisal";
          openButton.setAttribute(
            "aria-label",
            managerAppraisalIsSubmitted
              ? `View manager appraisal for ${appraisal.employeeName}`
              : hasManagerAppraisalDraft
                ? `Continue manager appraisal for ${appraisal.employeeName}`
                : `Start manager appraisal for ${appraisal.employeeName}`,
          );
          actions.appendChild(openButton);
        }

        if (actions.childElementCount > 0) {
          item.appendChild(actions);
        }

        employeeGroupBody.appendChild(
          item,
        );
      },
    );
  }

  function bexPaHydrateStandaloneState() {
    bexPaState.cycles = bexPaLoadStoredCycles();

    bexPaState.organisationGoals =
      bexPaLoadOrganisationGoals();

    bexPaState.deliverables =
      bexPaLoadDeliverables();

    bexPaState.departmentGoals =
      bexPaLoadDepartmentGoals();

    bexPaState.individualGoals =
      bexPaLoadIndividualGoals();

    bexPaState.progressUpdates =
      bexPaLoadProgressUpdates();

    bexPaState.templates =
      bexPaLoadTemplates();

    bexPaState.employeeAppraisals =
      bexPaLoadEmployeeAppraisals();

    bexPaState.selfAppraisals =
      bexPaLoadSelfAppraisals();

    bexPaState.managerAppraisals =
      bexPaLoadManagerAppraisals();

    bexPaState.hrFinalisations =
      bexPaLoadHrFinalisations();

    bexPaState.employeeAcknowledgements =
      bexPaLoadEmployeeAcknowledgements();
  }

  function bexPaApplyTenantWorkspaceBranding(
    hasIntegratedContext,
  ) {
    document.body.classList.remove(
      "alpatech-workspace",
    );

    if (!hasIntegratedContext) {
      return;
    }

    try {
      const rawTenantContext =
        window.localStorage.getItem(
          BEX_PA_TENANT_CONTEXT_STORAGE_KEY,
        ) || "";

      const tenantContext = rawTenantContext
        ? JSON.parse(rawTenantContext)
        : null;

      const tenantSignals = [
        tenantContext?.tenantCode,
        tenantContext?.tenantName,
        tenantContext?.companyName,
      ]
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);

      const isAlpatechTenant =
        tenantSignals.some((value) =>
          value.includes("alpatech"),
        );

      document.body.classList.toggle(
        "alpatech-workspace",
        isAlpatechTenant,
      );
    } catch (error) {
      document.body.classList.remove(
        "alpatech-workspace",
      );

      console.warn(
        "Performance Appraisal tenant branding could not be resolved.",
        error,
      );
    }
  }

  async function bexPaInitialiseAppraisalCycles() {
    const hasIntegratedContext =
      Boolean(bexPaGetIntegratedContext());
    if (bexPaElements.developmentPersona) {
      bexPaElements.developmentPersona.classList.toggle(
        "d-none",
        !bexPaIsDevelopmentHost() ||
        hasIntegratedContext,
      );
    }

    document.body.classList.toggle(
      "bex-pa-integrated",
      hasIntegratedContext,
    );

    bexPaApplyTenantWorkspaceBranding(
      hasIntegratedContext,
    );

    bexPaElements.integratedToolbar?.classList.toggle(
      "d-none",
      !hasIntegratedContext,
    );

    if (hasIntegratedContext) {
      const persona = bexPaGetCurrentPersona();
      const context = bexPaGetIntegratedContext() || {};
      const sourceDashboard = String(
        context.sourceDashboard || "",
      ).trim();

      const dashboardByPersona = {
        employee: {
          href: "../../employee-dashboard.html",
          label: "Back to Employee Dashboard",
        },

        "primary-manager": {
          href: "../../manager-dashboard.html",
          label: "Back to Manager Dashboard",
        },

        "hr-standard": {
          href: "../../hr-dashboard.html",
          label: "Back to HR Dashboard",
        },

        "hr-admin": {
          href: "../../hr-dashboard.html",
          label: "Back to HR Dashboard",
        },
      };

      const workspaceByPersona = {
        employee: "My Appraisal",
        "primary-manager": "Manager Reviews",
        "hr-standard": "HR Standard View",
        "hr-admin": "HR Administration",
      };

      const dashboardBySource = {
        "employee-dashboard": dashboardByPersona.employee,
        "manager-dashboard": dashboardByPersona["primary-manager"],
        "hr-dashboard": dashboardByPersona["hr-admin"],
      };

      const dashboard =
        dashboardBySource[sourceDashboard] ||
        dashboardByPersona[persona];

      const workspace =
        workspaceByPersona[persona] ||
        "Performance Appraisal";

      if (
        dashboard &&
        bexPaElements.backToDashboardLink
      ) {
        bexPaElements.backToDashboardLink.href =
          dashboard.href;

        bexPaElements.backToDashboardLink.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            window.location.assign(
              dashboard.href,
            );
          },
        );

        if (
          bexPaElements.backToDashboardLabel
        ) {
          bexPaElements.backToDashboardLabel.textContent =
            dashboard.label;
        }

        if (
          bexPaElements.integratedWorkspaceLabel
        ) {
          bexPaElements.integratedWorkspaceLabel.textContent =
            workspace;
        }

        bexPaUpdateIntegratedWorkspaceLabel();
        bexPaEnsureIntegratedWorkspaceSwitchButton();
      }
    }

    bexPaApplyTemplateAccess();
    bexPaApplyReportAccess();

    if (hasIntegratedContext) {
      try {
        await bexPaResolvePersistenceIdentity();
        await bexPaHydrateRemoteState();
      } catch (error) {
        bexPaPersistence.mode = "remote-error";
        bexPaPersistence.ready = false;
        bexPaPersistence.lastError = error;

        console.error(
          "Performance appraisal production persistence could not initialise.",
          error,
        );
      }
    } else {
      bexPaHydrateStandaloneState();
      bexPaPersistence.mode = "standalone";
      bexPaPersistence.ready = true;
      bexPaPersistence.lastError = null;
    }

    await bexPaCompleteEligibleCycles();


    bexPaElements.createTemplateButton?.addEventListener(
      "click",
      () => bexPaOpenTemplateDialog(),
    );

    bexPaElements.closeTemplateDialogButton?.addEventListener(
      "click",
      bexPaCloseTemplateDialog,
    );

    bexPaElements.cancelTemplateButton?.addEventListener(
      "click",
      bexPaCloseTemplateDialog,
    );

    bexPaElements.templateForm?.addEventListener(
      "submit",
      bexPaHandleTemplateSubmit,
    );

    bexPaElements.templatesList?.addEventListener(
      "click",
      bexPaHandleTemplateListAction,
    );

    bexPaElements.addTemplateRatingButton?.addEventListener(
      "click",
      () => {
        const input =
          bexPaAddTemplateRatingRow();

        input?.focus();
      },
    );

    bexPaElements.addTemplateCompetencyButton?.addEventListener(
      "click",
      bexPaOpenTemplateCompetencyEditor,
    );

    bexPaElements.cancelTemplateCompetencyButton?.addEventListener(
      "click",
      bexPaCloseTemplateCompetencyEditor,
    );

    bexPaElements.saveTemplateCompetencyButton?.addEventListener(
      "click",
      bexPaHandleTemplateCompetencySave,
    );

    bexPaElements.templateCompetenciesList?.addEventListener(
      "click",
      bexPaHandleTemplateCompetencyListAction,
    );

    bexPaElements.cyclesNavButton?.addEventListener(
      "click",
      () => bexPaShowSection("cycles"),
    );

    bexPaElements.goalsNavButton?.addEventListener(
      "click",
      () => bexPaShowSection("goals"),
    );

    bexPaElements.templatesNavButton?.addEventListener(
      "click",
      () => {
        if (!bexPaCanManageTemplates()) {
          return;
        }

        bexPaShowSection("templates");
      },
    );

    bexPaElements.employeeAppraisalsNavButton?.addEventListener(
      "click",
      () => {
        bexPaShowSection("employeeAppraisals");
      },
    );

    bexPaElements.reportsNavButton?.addEventListener(
      "click",
      () => {
        if (!bexPaCanViewReports()) {
          return;
        }

        bexPaShowSection("reports");
      },
    );

    bexPaElements.reportCycleSelect?.addEventListener(
      "change",
      () => {
        try {
          const cycleId =
            bexPaElements.reportCycleSelect.value;

          if (cycleId) {
            window.sessionStorage.setItem(
              BEX_PA_REPORT_CYCLE_MEMORY_KEY,
              cycleId,
            );
          } else {
            window.sessionStorage.removeItem(
              BEX_PA_REPORT_CYCLE_MEMORY_KEY,
            );
          }
        } catch (error) {
          console.warn(
            "BexHR Performance Appraisal could not remember the selected report cycle.",
            error,
          );
        }

        bexPaRenderSelectedOperationalReport();
      },
    );

    bexPaElements.reportPrintButton?.addEventListener(
      "click",
      bexPaHandleOperationalReportPrint,
    );

    bexPaElements.employeeAppraisalsList?.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          "[data-bex-pa-employee-appraisal-action]",
        );

        if (!button) {
          return;
        }

        if (
          button.dataset.bexPaEmployeeAppraisalAction ===
          "open"
        ) {
          bexPaOpenSelfAppraisal(
            button.dataset.bexPaEmployeeAppraisalId,
          );
          return;
        }

        if (
          button.dataset.bexPaEmployeeAppraisalAction ===
          "open-final"
        ) {
          bexPaOpenFinalAppraisal(
            button.dataset.bexPaEmployeeAppraisalId,
          );
          return;
        }

        if (
          button.dataset.bexPaEmployeeAppraisalAction ===
          "open-manager"
        ) {
          bexPaOpenManagerAppraisal(
            button.dataset.bexPaEmployeeAppraisalId,
          );
          return;
        }

        if (
          button.dataset.bexPaEmployeeAppraisalAction ===
          "open-hr-review"
        ) {
          bexPaOpenHrAppraisalReview(
            button.dataset.bexPaEmployeeAppraisalId,
          );
        }
      },
    );

    bexPaElements.closeFinalAppraisalButton?.addEventListener(
      "click",
      bexPaCloseFinalAppraisal,
    );

    bexPaElements.acknowledgeFinalAppraisalButton?.addEventListener(
      "click",
      bexPaAcknowledgeFinalAppraisal,
    );

    bexPaElements.closeSelfAppraisalButton?.addEventListener(
      "click",
      bexPaCloseSelfAppraisalDetail,
    );

    bexPaElements.selfAppraisalForm?.addEventListener(
      "submit",
      bexPaHandleSelfAppraisalSubmit,
    );

    bexPaElements.submitSelfAppraisalButton?.addEventListener(
      "click",
      (event) =>
        bexPaHandleSelfAppraisalSubmit(event, true),
    );

    bexPaElements.closeHrAppraisalReviewButton?.addEventListener(
      "click",
      bexPaCloseHrAppraisalReview,
    );

    bexPaElements.finaliseHrAppraisalButton?.addEventListener(
      "click",
      bexPaFinaliseHrAppraisal,
    );

    bexPaElements.closeManagerAppraisalButton?.addEventListener(
      "click",
      bexPaCloseManagerAppraisalDetail,
    );

    bexPaElements.managerAppraisalForm?.addEventListener(
      "submit",
      bexPaHandleManagerAppraisalSave,
    );

    bexPaElements.submitManagerAppraisalButton?.addEventListener(
      "click",
      (event) =>
        bexPaHandleManagerAppraisalSave(event, true),
    );

    bexPaElements.overviewNavLink?.addEventListener(
      "click",
      () => bexPaShowSection("overview"),
    );

    bexPaElements.developmentPersona?.addEventListener(
      "change",
      (event) => {
        bexPaSetDevelopmentPersona(
          event.target.value,
        );
      },
    );

    bexPaElements.cyclesCreateButton?.addEventListener(
      "click",
      () => bexPaShowCycleForm(),
    );

    bexPaElements.backToTopButton?.addEventListener(
      "click",
      () => {
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      },
    );

    window.addEventListener(
      "scroll",
      () => {
        bexPaElements.backToTopButton?.classList.toggle(
          "d-none",
          window.scrollY <= 320,
        );
      },
      { passive: true },
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

    bexPaElements.individualGoalEmployee?.addEventListener(
      "bexpaemployeechange",
      () => {
        bexPaClearIndividualGoalError();
        bexPaPopulateIndividualGoalDepartmentGoals();
        bexPaUpdateIndividualGoalDerivedFields();
      },
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

    bexPaElements.closeProgressUpdateDialogButton?.addEventListener(
      "click",
      bexPaCloseProgressUpdateDialog,
    );

    bexPaElements.cancelProgressUpdateButton?.addEventListener(
      "click",
      bexPaCloseProgressUpdateDialog,
    );

    bexPaElements.progressUpdateForm?.addEventListener(
      "submit",
      bexPaHandleProgressUpdateSubmit,
    );

    bexPaApplyCycleAccess();
    bexPaApplyGoalAccess();
    bexPaApplyTemplateAccess();
    bexPaApplyReportAccess();
    bexPaApplyRoleWorkspaceClarity();

    bexPaRenderCycles();

    bexPaPopulateOrganisationGoalCycles();
    bexPaRenderOrganisationGoals();

    bexPaPopulateDeliverableOrganisationGoals();
    bexPaRenderDeliverables();

    bexPaPopulateDepartmentGoalOrganisationGoals();
    bexPaRenderDepartmentGoals();

    bexPaPopulateIndividualGoalEmployees();
    bexPaPopulateIndividualGoalDepartmentGoals();
    bexPaRenderIndividualGoals();

    bexPaRenderProgressUpdates();
    bexPaRenderTemplates();
    bexPaRenderEmployeeAppraisals();

    if (bexPaElements.developmentPersona) {
      bexPaElements.developmentPersona.value =
        bexPaGetCurrentPersona();
    }

    const navigationEntry =
      window.performance
        .getEntriesByType("navigation")[0];

    const isPageRefresh =
      navigationEntry?.type === "reload";

    const initialMode = bexPaGetActiveMode();
    const defaultSection =
      bexPaGetDefaultSectionForMode(initialMode);

    bexPaShowSection(
      isPageRefresh
        ? bexPaGetRememberedSection(
          initialMode,
          defaultSection,
        )
        : defaultSection,
    );

    // BEXHR UNIVERSAL WORKSPACE LOADER - US-01 TIMING
    // First entry and refresh both use the same deliberate minimum duration.
    const workspaceLoader =
      document.getElementById(
        "bexPaWorkspaceLoader",
      );

    const loaderStartedAt =
      Number(
        window.BexPaRefreshLoaderStartedAt,
      ) || window.performance.now();

    const loaderElapsed =
      window.performance.now() -
      loaderStartedAt;

    const minimumLoaderTime = 650;

    const remainingLoaderTime =
      Math.max(
        0,
        minimumLoaderTime - loaderElapsed,
      );

    window.setTimeout(() => {
      document.documentElement.classList.remove(
        "bex-pa-refreshing",
      );

      workspaceLoader?.setAttribute(
        "aria-hidden",
        "true",
      );

      workspaceLoader?.setAttribute(
        "aria-busy",
        "false",
      );
    }, remainingLoaderTime);
  }

  document.addEventListener(
    "DOMContentLoaded",
    bexPaInitialiseAppraisalCycles,
  );
})();