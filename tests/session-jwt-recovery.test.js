
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(
  "js/session.js",
  "utf8",
);

function memoryStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(key)
        ? store.get(key)
        : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function createContext(auth) {
  const document = {
    hidden: false,
    body: {
      appendChild() {},
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        querySelector() {
          return null;
        },
        addEventListener() {},
      };
    },
    documentElement: {
      dataset: {},
    },
  };

  const window = {
    supabaseClient: {
      auth,
      rpc() {},
    },
    location: {
      pathname: "/hr-dashboard.html",
      search: "",
      href: "",
    },
    history: {},
    addEventListener() {},
    SessionManager: null,
  };

  return {
    window,
    document,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    console,
    URLSearchParams,
    Date,
    Promise,
    TypeError,
    setTimeout,
    clearTimeout,
  };
}

(async () => {
  let session = {
    user: {
      id: "user-1",
    },
    expires_at:
      Math.floor(Date.now() / 1000) - 5,
  };

  let refreshCount = 0;

  const auth = {
    async getSession() {
      return {
        data: { session },
        error: null,
      };
    },

    async refreshSession() {
      refreshCount += 1;

      session = {
        user: {
          id: "user-1",
        },
        expires_at:
          Math.floor(Date.now() / 1000) + 3600,
      };

      return {
        data: { session },
        error: null,
      };
    },

    onAuthStateChange() {
      return {
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      };
    },

    async signOut() {
      return {
        error: null,
      };
    },

    mfa: {
      async getAuthenticatorAssuranceLevel() {
        return {
          data: {
            currentLevel: "aal2",
          },
          error: null,
        };
      },
    },
  };

  const context =
    createContext(auth);

  vm.createContext(context);

  vm.runInContext(
    source,
    context,
  );

  const manager =
    context.window.SessionManager;

  const recovered =
    await manager.getSession();

  assert.ok(
    recovered,
    "Expired local session must recover",
  );

  assert.strictEqual(
    refreshCount,
    1,
    "Expired session must refresh exactly once",
  );


  // Healthy token: read must not refresh.
  refreshCount = 0;

  session = {
    user: {
      id: "user-1",
    },
    expires_at:
      Math.floor(Date.now() / 1000) + 3600,
  };

  let readCount = 0;

  const result =
    await manager.runWithFreshSessionRead(
      async () => {
        readCount += 1;

        if (readCount === 1) {
          return {
            data: null,
            error: {
              message: "JWT expired",
            },
          };
        }

        return {
          data: ["ok"],
          error: null,
        };
      },
    );

  assert.deepStrictEqual(
    Array.from(result.data),
    ["ok"],
  );

  assert.strictEqual(
    readCount,
    2,
    "JWT-expired read must retry exactly once",
  );

  assert.strictEqual(
    refreshCount,
    1,
    "JWT-expired read must force exactly one token refresh",
  );


  // Non-auth errors must never retry.
  readCount = 0;
  refreshCount = 0;

  const nonAuthResult =
    await manager.runWithFreshSessionRead(
      async () => {
        readCount += 1;

        return {
          data: null,
          error: {
            message: "Database unavailable",
          },
        };
      },
    );

  assert.strictEqual(
    nonAuthResult.error.message,
    "Database unavailable",
  );

  assert.strictEqual(
    readCount,
    1,
    "Non-JWT errors must not retry",
  );

  assert.strictEqual(
    refreshCount,
    0,
    "Non-JWT errors must not rotate auth tokens",
  );

  console.log(
    "PASS: session JWT recovery unit and functionality QA.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
