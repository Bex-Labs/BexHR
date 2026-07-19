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

  const toggleNewPasswordBtn = document.getElementById("toggleNewPasswordBtn");
  const toggleNewPasswordIcon = document.getElementById("toggleNewPasswordIcon");
  const toggleConfirmPasswordBtn = document.getElementById("toggleConfirmPasswordBtn");
  const toggleConfirmPasswordIcon = document.getElementById("toggleConfirmPasswordIcon");

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "recovery";

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

  async function ensureSessionExistsForReset() {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session check error:", error);
      return null;
    }

    return data?.session || null;
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
        `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Updating...`;

      try {
        const session = await ensureSessionExistsForReset();

        if (!session || !session.user) {
          showAlert(
            "Your reset session is not valid or has expired. Please restart the password reset process.",
            "danger",
          );
          return;
        }

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
