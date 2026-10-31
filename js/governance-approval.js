(function initialiseCompensationGovernanceWorkspace() {
  const state = {
    session: null,
    profile: null,
    requests: [],
    authorised: false,
  };

  const dom = {};

  function cacheDom() {
    dom.alert = document.getElementById("governanceAlert");
    dom.userName = document.getElementById("governanceUserName");
    dom.userEmail = document.getElementById("governanceUserEmail");
    dom.accessBadge = document.getElementById("governanceAccessBadge");
    dom.queueCard = document.getElementById("governanceQueueCard");
    dom.loadingState = document.getElementById("governanceLoadingState");
    dom.emptyState = document.getElementById("governanceEmptyState");
    dom.requestList = document.getElementById("governanceRequestList");
    dom.requestCount = document.getElementById("governanceRequestCount");
    dom.refreshBtn = document.getElementById("governanceRefreshBtn");
    dom.returnBtn = document.getElementById("governanceReturnBtn");
    dom.logoutBtn = document.getElementById("governanceLogoutBtn");
  }

  function getSupabaseClient() {
    if (!window.supabaseClient) {
      throw new Error("Supabase client is not available.");
    }
    return window.supabaseClient;
  }

  function escapeHtml(value = "") {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function humanizeKey(value = "") {
    return String(value || "")
      .replace(/^PAYROLL_/, "")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function showAlert(type, message) {
    if (!dom.alert) return;
    dom.alert.className = `alert alert-${type}`;
    dom.alert.innerHTML = message;
    dom.alert.classList.remove("d-none");
  }

  function clearAlert() {
    dom.alert?.classList.add("d-none");
  }

  function setLoading(isLoading) {
    dom.loadingState?.classList.toggle("d-none", !isLoading);
    if (dom.refreshBtn) dom.refreshBtn.disabled = isLoading;
  }

  function formatDate(value = "") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return date.toLocaleString();
  }

  function renderSnapshot(snapshot = {}) {
    const entries = Object.entries(snapshot || {});
    if (!entries.length) {
      return '<p class="text-secondary mb-0">No protected snapshot fields were supplied.</p>';
    }

    return `
      <div class="table-responsive governance-snapshot border">
        <table class="table table-sm align-middle mb-0">
          <tbody>
            ${entries
              .map(
                ([key, value]) => `
                  <tr>
                    <th scope="row" class="text-secondary fw-semibold ps-3">${escapeHtml(humanizeKey(key))}</th>
                    <td class="text-end pe-3">${escapeHtml(formatValue(value))}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderRequests() {
    const requests = Array.isArray(state.requests) ? state.requests : [];

    if (dom.requestCount) {
      dom.requestCount.textContent = `${requests.length} pending`;
    }

    dom.emptyState?.classList.toggle("d-none", requests.length > 0);

    if (!dom.requestList) return;
    dom.requestList.innerHTML = "";

    requests.forEach((request) => {
      const requestId = String(request.request_id || "").trim();
      if (!requestId) return;

      const employeeName = String(request.employee_name || "").trim() || "Restricted employee";
      const employeeNumber = String(request.employee_number || "").trim();
      const requester = String(request.requester_name || request.requester_email || "HR / Payroll").trim();

      const card = document.createElement("article");
      card.className = "governance-request-card bg-white p-3 p-lg-4";
      card.dataset.requestId = requestId;
      card.innerHTML = `
        <div class="d-flex flex-column flex-lg-row justify-content-between gap-3 mb-3">
          <div>
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
              <span class="badge text-bg-warning">Independent approval required</span>
              <span class="badge text-bg-light border">${escapeHtml(humanizeKey(request.target_type))}</span>
              <span class="badge text-bg-light border">${escapeHtml(humanizeKey(request.operation))}</span>
            </div>
            <h3 class="h5 fw-bold mb-1">${escapeHtml(employeeName)}</h3>
            <p class="text-secondary small mb-0">${escapeHtml(employeeNumber || request.employee_email || request.employee_id || "")}</p>
          </div>
          <div class="text-lg-end small text-secondary">
            <div><strong>Requested:</strong> ${escapeHtml(formatDate(request.requested_at))}</div>
            <div><strong>By:</strong> ${escapeHtml(requester)}</div>
            <div><strong>Reference:</strong> ${escapeHtml(request.request_reference || "—")}</div>
          </div>
        </div>

        ${request.request_notes ? `<div class="alert alert-light border py-2 small"><strong>Request note:</strong> ${escapeHtml(request.request_notes)}</div>` : ""}

        <div class="mb-3">
          <p class="fw-semibold mb-2">Exact protected values requested</p>
          ${renderSnapshot(request.requested_snapshot)}
        </div>

        <div class="mb-3">
          <label class="form-label fw-semibold" for="decision-${escapeHtml(requestId)}">Decision note</label>
          <textarea class="form-control" id="decision-${escapeHtml(requestId)}" rows="2" maxlength="1000" placeholder="Optional for approval; required for rejection."></textarea>
        </div>

        <div class="d-flex flex-wrap justify-content-end gap-2">
          <button class="btn btn-outline-danger" type="button" data-governance-action="reject" data-request-id="${escapeHtml(requestId)}">
            <i class="bi bi-x-circle me-2" aria-hidden="true"></i>Reject
          </button>
          <button class="btn btn-success" type="button" data-governance-action="approve" data-request-id="${escapeHtml(requestId)}">
            <i class="bi bi-shield-check me-2" aria-hidden="true"></i>Approve exact values
          </button>
        </div>
      `;
      dom.requestList.appendChild(card);
    });
  }

  async function refreshRequests() {
    clearAlert();
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc(
        "governance_get_compensation_requests",
      );

      if (error) throw error;

      state.authorised = true;
      state.requests = Array.isArray(data) ? data : [];

      if (dom.accessBadge) {
        dom.accessBadge.className = "badge rounded-pill text-bg-success px-3 py-2";
        dom.accessBadge.textContent = "Independent governance authority";
      }

      dom.queueCard?.classList.remove("d-none");
      renderRequests();
    } catch (error) {
      state.authorised = false;
      state.requests = [];
      renderRequests();

      const message = String(error?.message || error || "");
      const authorityDenied = message.includes("BEXHR_GOVERNANCE_AUTHORITY_REQUIRED");

      if (dom.accessBadge) {
        dom.accessBadge.className = "badge rounded-pill text-bg-danger px-3 py-2";
        dom.accessBadge.textContent = authorityDenied ? "No governance authority" : "Access check failed";
      }

      dom.queueCard?.classList.add("d-none");
      showAlert(
        authorityDenied ? "warning" : "danger",
        authorityDenied
          ? "This signed-in profile is not an active independent executive compensation governance authority. No compensation request data was shown."
          : escapeHtml(message || "Compensation governance requests could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }

  async function decideRequest(requestId, action) {
    const request = state.requests.find(
      (item) => String(item.request_id || "").trim() === requestId,
    );
    if (!request) return;

    const note = String(document.getElementById(`decision-${requestId}`)?.value || "").trim();

    if (action === "reject" && !note) {
      showAlert("warning", "Enter a rejection reason before rejecting this compensation request.");
      return;
    }

    const card = dom.requestList?.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
    const buttons = Array.from(card?.querySelectorAll("button") || []);
    buttons.forEach((button) => { button.disabled = true; });

    clearAlert();

    try {
      const supabase = getSupabaseClient();
      const rpcName = action === "approve"
        ? "governance_approve_compensation_request"
        : "governance_reject_compensation_request";
      const args = action === "approve"
        ? { p_request_id: requestId, p_notes: note || null }
        : { p_request_id: requestId, p_reason: note };

      const { error } = await supabase.rpc(rpcName, args);
      if (error) throw error;

      await refreshRequests();

      showAlert(
        "success",
        action === "approve"
          ? "Exact compensation values approved. A different active HR/Payroll user can now repeat the same save to execute them."
          : "Compensation request rejected. HR/Payroll must submit a new exact request before any restricted change can proceed.",
      );
    } catch (error) {
      showAlert(
        "danger",
        escapeHtml(error?.message || "The governance decision could not be recorded."),
      );
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function initialise() {
    cacheDom();

    dom.refreshBtn?.addEventListener("click", refreshRequests);
    dom.logoutBtn?.addEventListener("click", () => window.SessionManager?.logoutUser?.("logout"));
    dom.returnBtn?.addEventListener("click", () => {
      window.SessionManager?.redirectToRoleDashboard?.(state.profile?.role || "");
    });

    dom.requestList?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-governance-action]");
      if (!button) return;

      const requestId = String(button.dataset.requestId || "").trim();
      const action = String(button.dataset.governanceAction || "").trim();
      if (!requestId || !["approve", "reject"].includes(action)) return;

      await decideRequest(requestId, action);
    });

    if (!window.SessionManager?.requireAuth) {
      showAlert("danger", "BexHR session management is unavailable.");
      return;
    }

    const session = await window.SessionManager.requireAuth();
    if (!session) return;

    state.session = session;
    state.profile = await window.SessionManager.getProfile(session.user.id);
    window.SessionManager.startIdleTimeout?.();

    if (dom.userName) {
      dom.userName.textContent =
        state.profile?.full_name || session.user.email || "Signed-in BexHR user";
    }
    if (dom.userEmail) {
      dom.userEmail.textContent = state.profile?.email || session.user.email || "";
    }

    await refreshRequests();
  }

  document.addEventListener("DOMContentLoaded", initialise);
})();
