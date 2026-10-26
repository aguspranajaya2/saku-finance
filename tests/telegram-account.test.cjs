const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { NextResponse } = require("next/server");
const loadTypeScript = require("./helpers/load-typescript.cjs");

function setup(file, options = {}) {
  const writes = [];
  const rpcs = [];
  let authenticated = 0;
  const session = {
    auth: { getUser: async () => { authenticated++; return { data: { user: options.signedOut ? null : { id: "owner-id" } }, error: null }; } },
    rpc: async (...args) => { rpcs.push(args); return { data: true, error: options.rpcError ?? null }; },
  };
  const admin = { from: () => ({ upsert: async (row) => { writes.push(row); return { error: null }; } }) };
  const route = loadTypeScript(file, {
    modules: {
      "next/server": { NextResponse },
      "@/lib/supabase/server": { createClient: async () => session },
      "@/lib/supabase/admin": { createAdminClient: () => admin },
      "@/lib/security-limits": { consumeSecurityLimits: async () => ({ allowed: options.allowed !== false, retryAfter: 30 }) },
    },
    globals: { process: { env: { TELEGRAM_BOT_USERNAME: "saku_test_bot", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret" } } },
  });
  return { route, writes, rpcs, authCalls: () => authenticated };
}

function request(path, origin = "https://saku.example") {
  return new Request("https://saku.example" + path, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ user_id: "other-account" }),
  });
}

test("pairing rejects requests without an authenticated account", async () => {
  const app = setup("app/api/telegram/pair/route.ts", { signedOut: true });
  assert.equal((await app.route.POST(request("/api/telegram/pair"))).status, 401);
  assert.equal(app.writes.length, 0);
});

test("pairing stores only the hash, binds the verified owner, and disables response caching", async () => {
  const app = setup("app/api/telegram/pair/route.ts");
  const response = await app.route.POST(request("/api/telegram/pair"));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].user_id, "owner-id");
  assert.equal(app.writes[0].code_hash, createHash("sha256").update(result.code).digest("hex"));
  assert.equal(app.writes[0].code, undefined);
  assert.ok(result.link.endsWith("?start=" + result.code));
});

test("pairing obeys the shared request quota", async () => {
  const app = setup("app/api/telegram/pair/route.ts", { allowed: false });
  const response = await app.route.POST(request("/api/telegram/pair"));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(app.writes.length, 0);
});

test("pairing and disconnection reject foreign origins before checking the session", async () => {
  for (const file of ["app/api/telegram/pair/route.ts", "app/api/telegram/disconnect/route.ts"]) {
    const app = setup(file);
    assert.equal((await app.route.POST(request("/api/telegram/action", "https://untrusted.example"))).status, 403);
    assert.equal(app.authCalls(), 0);
    assert.equal(app.rpcs.length, 0);
  }
});

test("disconnect derives ownership in the authenticated database RPC, not from submitted IDs", async () => {
  const app = setup("app/api/telegram/disconnect/route.ts");
  const response = await app.route.POST(request("/api/telegram/disconnect"));
  assert.equal(response.status, 200);
  assert.equal(app.rpcs.length, 1);
  assert.equal(app.rpcs[0][0], "disconnect_telegram");
  assert.equal(app.rpcs[0].length, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("disconnect fails closed for missing sessions or unavailable migration", async () => {
  const signedOut = setup("app/api/telegram/disconnect/route.ts", { signedOut: true });
  assert.equal((await signedOut.route.POST(request("/api/telegram/disconnect"))).status, 401);
  const unavailable = setup("app/api/telegram/disconnect/route.ts", { rpcError: { code: "missing_function" } });
  assert.equal((await unavailable.route.POST(request("/api/telegram/disconnect"))).status, 503);
});
