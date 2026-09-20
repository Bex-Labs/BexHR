"use strict";

(() => {
  const BEX_PA_CONTEXT_STORAGE_KEY =
    "bexhr:performance-appraisal:context:v1";

  const BEX_PA_CONTEXT_MAX_AGE_MS =
    12 * 60 * 60 * 1000;

  function bexPaIsValidIntegratedContext(context) {
    if (
      !context ||
      typeof context !== "object" ||
      context.source !== "bexhr"
    ) {
      return false;
    }

    const allowedPersonas = [
      "hr-admin",
      "primary-manager",
      "employee",
    ];

    if (!allowedPersonas.includes(context.persona)) {
      return false;
    }

    const issuedAt = new Date(context.issuedAt);

    if (Number.isNaN(issuedAt.getTime())) {
      return false;
    }

    const contextAge =
      Date.now() - issuedAt.getTime();

    if (
      contextAge < 0 ||
      contextAge > BEX_PA_CONTEXT_MAX_AGE_MS
    ) {
      return false;
    }

    if (
      context.persona === "employee" &&
      !String(context.employeeId || "").trim()
    ) {
      return false;
    }

    if (
      context.persona === "primary-manager" &&
      !String(context.managerEmployeeId || "").trim()
    ) {
      return false;
    }

    return true;
  }

  try {
    const storedContext =
      window.sessionStorage.getItem(
        BEX_PA_CONTEXT_STORAGE_KEY,
      );

    if (!storedContext) {
      return;
    }

    const parsedContext =
      JSON.parse(storedContext);

    if (!bexPaIsValidIntegratedContext(parsedContext)) {
      console.warn(
        "PA context rejected:",
        parsedContext,
      );

      return;
    }

    window.BexHrPerformanceAppraisalContext =
      parsedContext;
  } catch (error) {
    console.warn(
      "Performance appraisal context could not be restored before initialisation.",
      error,
    );
  }
})();