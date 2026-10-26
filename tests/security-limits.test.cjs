const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHmac } = require("node:crypto");
const { NextResponse } = require("next/server");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const secret = "isolated-test-secret-never-a-real-key";
function loadLimits(env = { SUPABASE_SECRET_KEY: secret }) {
  return loadTypeScript("lib/security-limits.ts", { globals: { process: { env } } });
}
const limits = loadLimits();

test("durable limits store scoped HMACs without raw identifiers", async () => {
  const calls = [];
  const admin = { rpc: async (...args) => { calls.push(args); return { data: { allowed: true, retry_after: 0 }, error: null }; } };
  const value = "private@example.test";
  assert.deepEqual(JSON.parse(JSON.stringify(await limits.consumeSecurityLimits(admin, [{ scope: "login-account", value, limit: 10, windowSeconds: 60 }]))), { allowed: true, retryAfter: 0 });
  const item = calls[0][1].p_limits[0];
  assert.equal(calls[0][0], "consume_security_limits");
  assert.equal(item.key, createHmac("sha256", secret).update(JSON.stringify(["login-account", value])).digest("hex"));
  assert.equal(JSON.stringify(calls).includes(value), false);
  assert.equal(item.limit, 10);
  assert.equal(item.window_seconds, 60);
});

test("limits fail closed for missing configuration, invalid responses, and RPC failures", async () => {
  const input = [{ scope: "test", value: "account", limit: 1, windowSeconds: 60 }];
  await assert.rejects(loadLimits({}).consumeSecurityLimits({ rpc() { assert.fail("must not call RPC"); } }, input), { name: "SecurityLimitsUnavailable" });
  for (const response of [{ data: null }, { data: { allowed: true } }, { data: { allowed: false, retry_after: -1 } }, { error: { message: "private database details" } }]) {
    await assert.rejects(limits.consumeSecurityLimits({ rpc: async () => response }, input), { name: "SecurityLimitsUnavailable", message: "Security limits are unavailable." });
  }
  await assert.rejects(limits.consumeSecurityLimits({ rpc: async () => { throw new Error("private details"); } }, input), { name: "SecurityLimitsUnavailable", message: "Security limits are unavailable." });
  const denied = await limits.consumeSecurityLimits({ rpc: async () => ({ data: { allowed: false, retry_after: 42 } }) }, input);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfter, 42);
});

test("invalid limits are rejected before any database call", async () => {
  const admin = { rpc() { assert.fail("invalid limits must not reach the database"); } };
  const valid = { scope: "test", value: "account", limit: 1, windowSeconds: 60 };
  for (const input of [[], Array(9).fill(valid), [{ ...valid, limit: 0 }], [{ ...valid, windowSeconds: 86401 }], [{ ...valid, value: "" }]]) {
    await assert.rejects(limits.consumeSecurityLimits(admin, input), { name: "SecurityLimitsUnavailable" });
  }
});

function loginHarness({ deniedCall = 0, rpcFailure = false, resolvedEmail = "Owner@Example.Test" } = {}) {
  const calls = [];
  const authCalls = [];
  let rateCalls = 0;
  const admin = { rpc: async (name, input) => {
    calls.push({ name, input });
    if (name === "resolve_username_email") return { data: resolvedEmail, error: null };
    rateCalls += 1;
    if (rpcFailure) return { data: null, error: { message: "database details" } };
    return { data: { allowed: rateCalls !== deniedCall, retry_after: rateCalls === deniedCall ? 27 : 0 }, error: null };
  } };
  const route = loadTypeScript("app/api/auth/login/route.ts", { modules: {
    "next/server": { NextResponse },
    "@/lib/security-limits": limits,
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithPassword: async credentials => { authCalls.push(credentials); return { error: null }; } } }) },
    "@/lib/username": loadTypeScript("lib/username.ts"),
  } });
  return { ...route, calls, authCalls };
}
function loginRequest(identifier = "owner", extraHeaders = {}, body) {
  return new Request("https://saku.example.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...extraHeaders }, body: body ?? JSON.stringify({ identifier, password: "test-only-password" }) });
}

test("username and email login share their canonical account allowance", async () => {
  const username = loginHarness();
  const email = loginHarness();
  const userResponse = await username.POST(loginRequest(" Owner "));
  const emailResponse = await email.POST(loginRequest(" OWNER@example.test "));
  assert.equal(userResponse.status, 200);
  assert.equal(emailResponse.status, 200);
  const accountKey = calls => calls.filter(call => call.name === "consume_security_limits").at(-1).input.p_limits[0].key;
  assert.equal(accountKey(username.calls), accountKey(email.calls));
  assert.equal(username.authCalls[0].email, "owner@example.test");
  assert.deepEqual(await userResponse.json(), { ok: true });
  assert.equal(userResponse.headers.get("cache-control"), "no-store");
});

test("IP limits run before username lookup or provider authentication", async () => {
  const app = loginHarness({ deniedCall: 1 });
  const response = await app.POST(loginRequest());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "27");
  assert.equal(app.calls.length, 1);
  assert.equal(app.authCalls.length, 0);
});

test("a missing durable limiter prevents authentication and hides database errors", async () => {
  const app = loginHarness({ rpcFailure: true });
  const response = await app.POST(loginRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  assert.equal(app.authCalls.length, 0);
});

test("cross-site and malformed login requests cannot reach account lookup", async () => {
  for (const headers of [{ origin: "https://attacker.test" }, { "sec-fetch-site": "cross-site" }]) {
    const app = loginHarness();
    const response = await app.POST(loginRequest("owner", headers));
    assert.equal(response.status, 403);
    assert.equal(app.calls.length, 0);
  }
  const app = loginHarness();
  const response = await app.POST(loginRequest("owner", {}, JSON.stringify({ identifier: "owner", password: "x".repeat(9000) })));
  assert.equal(response.status, 400);
  assert.equal(app.calls.length, 1);
  assert.equal(app.authCalls.length, 0);
});

test("unknown usernames return generic credentials errors without resolved emails", async () => {
  const app = loginHarness({ resolvedEmail: null });
  const response = await app.POST(loginRequest("missing_username"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  assert.equal(app.authCalls.length, 0);
});
