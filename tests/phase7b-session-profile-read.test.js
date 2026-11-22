"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const candidate = process.env.BEXHR_SESSION_TEST_SOURCE || path.resolve(__dirname, "..", "js", "session.js");
const source = fs.readFileSync(candidate, "utf8");

function activeProfile() {
  return {
    id: "auth-user-1", role: "hr", hr_access_level: "tenant_admin",
    is_active: true, tenant_id: "company-1", must_change_password: false,
  };
}

function environment(responses, options = {}) {
  const state = {
    signOutCount: 0, responses: [...responses],
    queryCount: 0, notices: [], warnings: [],
  };
  const elements = new Map();
  const document = {
    hidden: false,
    body: {
      appendChild(element) { state.notices.push(element); elements.set(element.id, element); },
    },
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      return {
        tagName: tag, style: {},
        setAttribute() {},
        textContent: "",
      };
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              user: { id: "auth-user-1" },
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          },
          error: null,
        };
      },
      async signOut(arg) {
        assert.deepEqual(JSON.parse(JSON.stringify(arg)), { scope: "local" });
        state.signOutCount++;
        return { error: null };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      mfa: {
        async getAuthenticatorAssuranceLevel() {
          return { data: { currentLevel: "aal2" }, error: null };
        },
      },
    },
    from(name) {
      assert.equal(name, "profiles");
      return {
        select() { return this; },
        eq() { return this; },
        async single() {
          state.queryCount++;
          const item = state.responses.shift();
          if (!item) return { data: activeProfile(), error: null };
          if (item.throw) throw new Error("transient network failure");
          return item;
        },
      };
    },
    async rpc() { return { data: [], error: null }; },
  };
  const window = {
    location: { href: "hr-dashboard.html", pathname: "/hr-dashboard.html", search: "" },
    supabaseClient: client,
    addEventListener() {},
    clearInterval() {},
    setInterval() { return 5; },
  };
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.get(key) || null; },
    removeItem(key) { storage.delete(key); },
    setItem(key, value) { storage.set(key, value); },
  };
  const context = vm.createContext({
    window, document, localStorage,
    sessionStorage: localStorage,
    setTimeout() { return 3; }, clearTimeout() {},
    console: { warn: (...args) => state.warnings.push(args), error() {}, log() {} },
  });
  vm.runInContext(source, context, { filename: "session.js" });
  return { manager: window.SessionManager, window, state, storage };
}

const ok = () => ({ data: activeProfile(), error: null });
const down = () => ({ data: null, error: { code: "PGRST503", message: "Service unavailable" } });
const missing = () => ({ data: null, error: { code: "PGRST116", message: "0 rows" } });

test("an intermittent profile API error does not revoke an active HR session", async () => {
  const e = environment([ok(), down(), ok()]);
  assert.ok(await e.manager.protectPage("hr"));
  assert.equal(await e.manager.revalidateActiveProfile(), false);
  assert.equal(e.state.signOutCount, 0);
  assert.equal(e.window.location.href, "hr-dashboard.html");
  assert.equal(await e.manager.revalidateActiveProfile(), true);
  assert.equal(e.state.signOutCount, 0);
});

test("a thrown network exception does not trigger an unauthorized signout", async () => {
  const e = environment([ok(), { throw: true }]);
  assert.ok(await e.manager.protectPage("hr"));
  assert.equal(await e.manager.revalidateActiveProfile(), false);
  assert.equal(e.state.signOutCount, 0);
});

test("an inactive profile still revokes the local session", async () => {
  const e = environment([ok(), { data: { ...activeProfile(), is_active: false }, error: null }]);
  assert.ok(await e.manager.protectPage("hr"));
  assert.equal(await e.manager.revalidateActiveProfile(), false);
  assert.equal(e.state.signOutCount, 1);
  assert.equal(e.window.location.href, "index.html?message=unauthorized");
});

test("a definitive missing profile still revokes an active browser session", async () => {
  const e = environment([ok(), missing()]);
  assert.ok(await e.manager.protectPage("hr"));
  assert.equal(await e.manager.revalidateActiveProfile(), false);
  assert.equal(e.state.signOutCount, 1);
  assert.equal(e.window.location.href, "index.html?message=unauthorized");
});

test("a startup API failure denies access but does not sign the user out", async () => {
  const e = environment([down()]);
  assert.equal(await e.manager.protectPage("hr"), null);
  assert.equal(e.state.signOutCount, 0);
  assert.equal(e.state.notices.length, 1);
  assert.match(e.state.notices[0].textContent, /not been signed out/i);
  assert.equal(e.window.location.href, "hr-dashboard.html");
});

test("the startup check still rejects an actually inactive profile", async () => {
  const e = environment([{ data: { ...activeProfile(), is_active: false }, error: null }]);
  assert.equal(await e.manager.protectPage("hr"), null);
  assert.equal(e.state.signOutCount, 1);
});

test("a valid active profile can access HR dashboard", async () => {
  const e = environment([ok()]);
  const outcome = await e.manager.protectPage("hr");
  assert.equal(outcome.profile.role, "hr");
  assert.equal(e.state.signOutCount, 0);
});

test("a startup no-row response denies HR page access and signs out", async () => {
  const e = environment([missing()]);
  assert.equal(await e.manager.protectPage("hr"), null);
  assert.equal(e.state.signOutCount, 1);
});
