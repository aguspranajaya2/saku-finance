const assert = require("node:assert/strict");
const { test } = require("node:test");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const { NextRequest, NextResponse } = require("next/server");
const { securityHeaders, contentSecurityPolicy } = loadTypeScript("lib/security-headers.ts");

test("production CSP permits only the configured database and nonce-authorized scripts", () => {
  const policy = contentSecurityPolicy("random-nonce", "https://project.supabase.co", false, true);
  assert.ok(policy.includes("'nonce-random-nonce'"));
  assert.ok(policy.includes("'strict-dynamic'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(policy.includes("connect-src 'self' https://project.supabase.co wss://project.supabase.co"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("upgrade-insecure-requests"));
  assert.ok(!policy.split(";").find(part => part.trim().startsWith("script-src ")).includes("'unsafe-inline'"));
});

test("development CSP supports HMR while local HTTP production remains usable", () => {
  const development = contentSecurityPolicy("nonce", "http://localhost:54321", true, false);
  assert.ok(development.includes("'unsafe-eval'"));
  assert.ok(development.includes("ws://localhost:54321"));
  assert.ok(!development.includes("upgrade-insecure-requests"));
  assert.ok(!contentSecurityPolicy("nonce", undefined, false, false).includes("upgrade-insecure-requests"));
  assert.throws(() => contentSecurityPolicy("nonce", "http://database.example", false, true));
});

test("baseline browser protections include anti-framing, nosniff, and referrer privacy", () => {
  const headers = Object.fromEntries(securityHeaders.map(header => [header.key, header.value]));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.ok(headers["Permissions-Policy"].includes("camera=()"));
});

test("proxy generates a fresh nonce and replaces client-supplied security headers", async () => {
  const forwarded = [];
  const { proxy } = loadTypeScript("proxy.ts", {
    modules: {
      "@/lib/security-headers": { contentSecurityPolicy },
      "@/lib/supabase/proxy": { updateSession: async (request, headers) => { forwarded.push(headers); return NextResponse.next({ request: { headers } }); } },
    },
    globals: { process: { env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } } },
  });
  const responses = [];
  for (let i = 0; i < 2; i++) responses.push(await proxy(new NextRequest("https://saku.example/login", { headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" } })));
  assert.notEqual(forwarded[0].get("x-nonce"), "attacker");
  assert.notEqual(forwarded[0].get("x-nonce"), forwarded[1].get("x-nonce"));
  assert.ok(responses[0].headers.get("content-security-policy").includes("'nonce-" + forwarded[0].get("x-nonce") + "'"));
  assert.equal(responses[0].headers.get("cache-control"), "private, no-store, max-age=0");
});

test("Supabase session refresh preserves nonce headers and forwards refreshed cookies", async () => {
  const { updateSession } = loadTypeScript("lib/supabase/proxy.ts", {
    modules: {
      "next/server": { NextResponse },
      "@supabase/ssr": { createServerClient: (url, key, options) => ({ auth: { getClaims: async () => { options.cookies.setAll([{ name: "sb-token", value: "new-session", options: { path: "/" } }]); } } }) },
    },
    globals: { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key" } } },
  });
  const request = new NextRequest("https://saku.example/settings", { headers: { cookie: "sb-token=old-session" } });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", "test-nonce");
  headers.set("content-security-policy", "script-src 'nonce-test-nonce'");
  const response = await updateSession(request, headers);
  assert.equal(response.cookies.get("sb-token").value, "new-session");
  assert.equal(response.headers.get("x-middleware-request-x-nonce"), "test-nonce");
  assert.ok(response.headers.get("x-middleware-request-cookie").includes("new-session"));
});
