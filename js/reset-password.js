document.addEventListener("DOMContentLoaded", function () {
  const SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
  );

  const supabaseClient = window.supabaseClient;

  const form = document.getElementById("resetPasswordForm");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const alertContainer = document.getElementById("resetAlertContainer");
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  const submitBtn = document.getElementById("resetSubmitBtn");
  const mfaSection = document.getElementById("resetMfaSection");
  const mfaCodeInput = document.getElementById("resetMfaCode");
  // BEXHR RESET PAGE LOADER - v1.0.0
  // Presentation-only reference. Authentication behaviour remains unchanged.
  const resetPageLoader = document.getElementById("resetPageLoader");

  const toggleNewPasswordBtn = document.getElementById("toggleNewPasswordBtn");
  const toggleNewPasswordIcon = document.getElementById("toggleNewPasswordIcon");
  const toggleConfirmPasswordBtn = document.getElementById("toggleConfirmPasswordBtn");
  const toggleConfirmPasswordIcon = document.getElementById("toggleConfirmPasswordIcon");

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "recovery";

  let mfaFactorId = null;

  if (mode === "first-time") {
    pageTitle.textContent = "Complete First-Time Account Setup";
    pageSubtitle.textContent =
      "You must set a new password before accessing your dashboard.";
  } else {
    pageTitle.textContent = "Reset Your Password";
    pageSubtitle.textContent =
      "Enter a new password to regain secure access to your account.";
  }

  function showAlert(message, type) {
    alertContainer.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }

  function togglePassword(input, icon) {
    const isHidden = input.getAttribute("type") === "password";
    input.setAttribute("type", isHidden ? "text" : "password");
    icon.className = isHidden ? "bi bi-eye-slash" : "bi bi-eye";
  }

  function validatePasswordPolicy(password) {
    const hasMinLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

    return (
      hasMinLength &&
      hasUppercase &&
      hasLowercase &&
      hasNumber &&
      hasSpecialChar
    );
  }

  function normaliseMfaCode(value) {
    return String(value || "")
      .replace(/\D/g, "")
      .slice(0, 6);
  }

  function showMfaSection() {
    if (!mfaSection || !mfaCodeInput) {
      return;
    }

    mfaSection.classList.remove("d-none");
    mfaSection.setAttribute("aria-hidden", "false");
    mfaCodeInput.required = true;
  }

  function hideMfaSection() {
    if (!mfaSection || !mfaCodeInput) {
      return;
    }

    mfaSection.classList.add("d-none");
    mfaSection.setAttribute("aria-hidden", "true");
    mfaCodeInput.required = false;
    mfaCodeInput.value = "";
  }

  async function ensureSessionExistsForReset() {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session check error:", error);
      return null;
    }

    return data?.session || null;
  }

  async function getMfaRequirement() {
    const { data: aalData, error: aalError } =
      await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      throw aalError;
    }

    const requiresMfa =
      aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2";

    if (!requiresMfa) {
      mfaFactorId = null;
      hideMfaSection();
      return { required: false, factorId: null };
    }

    const { data: factorsData, error: factorsError } =
      await supabaseClient.auth.mfa.listFactors();

    if (factorsError) {
      throw factorsError;
    }

    const totpFactors = Array.isArray(factorsData?.totp)
      ? factorsData.totp
      : [];
    const totpFactor =
      totpFactors.find(function (factor) {
        return factor?.status === "verified";
      }) || totpFactors[0];

    if (!totpFactor?.id) {
      const factorError = new Error(
        "No verified authenticator factor is available for this account.",
      );
      factorError.code = "MFA_FACTOR_NOT_FOUND";
      throw factorError;
    }

    mfaFactorId = totpFactor.id;
    showMfaSection();

    return { required: true, factorId: mfaFactorId };
  }

  async function verifyMfaForPasswordReset(factorId, code) {
    const { error: verifyError } =
      await supabaseClient.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

    if (verifyError) {
      throw verifyError;
    }

    const { data: verifiedAalData, error: verifiedAalError } =
      await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

    if (verifiedAalError) {
      throw verifiedAalError;
    }

    if (verifiedAalData?.currentLevel !== "aal2") {
      const assuranceError = new Error(
        "Authenticator verification did not reach the required security level.",
      );
      assuranceError.code = "MFA_AAL2_REQUIRED";
      throw assuranceError;
    }
  }

  function getFriendlyMfaError(error) {
    if (error?.code === "MFA_FACTOR_NOT_FOUND") {
      return "Your account requires authenticator verification, but no verified authenticator factor could be loaded. Return to sign in and contact your administrator.";
    }

    if (error?.code === "MFA_AAL2_REQUIRED") {
      return "Authenticator verification could not be completed. Enter a new code from your authenticator app and try again.";
    }

    const message = String(error?.message || "").toLowerCase();

    if (
      message.includes("totp") ||
      message.includes("invalid code") ||
      message.includes("challenge")
    ) {
      return "The authenticator code is invalid or has expired. Enter the current 6-digit code and try again.";
    }

    return "Authenticator verification could not be completed. Please try again.";
  }

  async function clearFirstTimeFlag(userId) {
    const { error } = await supabaseClient
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", userId);

    if (error) {
      console.error("Failed to update must_change_password:", error);
      throw error;
    }
  }

  if (toggleNewPasswordBtn) {
    toggleNewPasswordBtn.addEventListener("click", function () {
      togglePassword(newPasswordInput, toggleNewPasswordIcon);
    });
  }

  if (toggleConfirmPasswordBtn) {
    toggleConfirmPasswordBtn.addEventListener("click", function () {
      togglePassword(confirmPasswordInput, toggleConfirmPasswordIcon);
    });
  }

  if (mfaCodeInput) {
    mfaCodeInput.addEventListener("input", function () {
      mfaCodeInput.value = normaliseMfaCode(mfaCodeInput.value);
    });
  }

async function initialiseMfaRequirement() {
  try {
    const session = await ensureSessionExistsForReset();

    if (!session?.user) {
      return;
    }

    await getMfaRequirement();
  } catch (error) {
    console.error("Initial MFA requirement check failed:", error);
  } finally {
    // BEXHR RESET PAGE LOADER - v1.0.0
    // Hide the presentation loader when the existing initial session/MFA
    // check finishes. No authentication decision is changed here.
    if (resetPageLoader) {
      resetPageLoader.classList.add("bexhr-reset-page-loader--hidden");

      window.setTimeout(function () {
        resetPageLoader.remove();
      }, 220);
    }
  }
}

  initialiseMfaRequirement();

  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      alertContainer.innerHTML = "";

      const newPassword = newPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (!newPassword || !confirmPassword) {
        showAlert("Please complete both password fields.", "warning");
        return;
      }

      if (!validatePasswordPolicy(newPassword)) {
        showAlert(
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
          "warning",
        );
        return;
      }

      if (newPassword !== confirmPassword) {
        showAlert("Passwords do not match.", "warning");
        return;
      }

      submitBtn.disabled = true;
      const originalBtnHtml = submitBtn.innerHTML;
      submitBtn.innerHTML =
        `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Checking...`;

      try {
        const session = await ensureSessionExistsForReset();

        if (!session || !session.user) {
          showAlert(
            "Your reset session is not valid or has expired. Please restart the password reset process.",
            "danger",
          );
          return;
        }

        let mfaRequirement;

        try {
          mfaRequirement = await getMfaRequirement();
        } catch (error) {
          console.error("MFA requirement check failed:", error);
          showAlert(getFriendlyMfaError(error), "danger");
          return;
        }

        if (mfaRequirement.required) {
          const mfaCode = normaliseMfaCode(mfaCodeInput?.value);

          if (!/^\d{6}$/.test(mfaCode)) {
            showMfaSection();
            showAlert(
              "Enter the current 6-digit code from your authenticator app.",
              "warning",
            );
            mfaCodeInput?.focus();
            return;
          }

          submitBtn.innerHTML =
            `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Verifying...`;

          try {
            await verifyMfaForPasswordReset(
              mfaRequirement.factorId,
              mfaCode,
            );
          } catch (error) {
            console.error("MFA verification failed:", error);
            showAlert(getFriendlyMfaError(error), "danger");
            mfaCodeInput?.focus();
            mfaCodeInput?.select();
            return;
          }
        }

        submitBtn.innerHTML =
          `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Updating...`;

        const { error: updateError } = await supabaseClient.auth.updateUser({
          password: newPassword,
        });

        if (updateError) {
          showAlert(
            updateError.message || "Password could not be updated.",
            "danger",
          );
          return;
        }

        if (mode === "first-time") {
          await clearFirstTimeFlag(session.user.id);

          showAlert(
            "Your first-time account setup is complete. Redirecting to sign in...",
            "success",
          );

          await supabaseClient.auth.signOut();

          setTimeout(function () {
            window.location.href = "index.html?message=first-time-setup-success";
          }, 1500);

          return;
        }

        showAlert(
          "Your password has been reset successfully. Redirecting to sign in...",
          "success",
        );

        await supabaseClient.auth.signOut();

        setTimeout(function () {
          window.location.href = "index.html?message=password-reset-success";
        }, 1500);
      } catch (error) {
        console.error("Reset password error:", error);
        showAlert("An unexpected error occurred while updating password.", "danger");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    });
  }
});
