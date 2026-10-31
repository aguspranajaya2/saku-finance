import { createClient as createVerifier } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeSecurityLimits, requestIp } from "@/lib/security-limits";

export const runtime = "nodejs";
function reply(value: object, status = 200, retryAfter = 60) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", ...(status === 429 ? { "Retry-After": String(retryAfter) } : {}) } });
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body || Number(request.headers.get("content-length")) > 8192) throw Error("Invalid body");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw Error("Invalid body"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid body");
  return value as Record<string, unknown>;
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "invalid_request" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return reply({ error: "invalid_request" }, 400);
  try {
    const session = await createClient();
    const { data: auth, error: authError } = await session.auth.getUser();
    if (authError || !auth.user?.email) return reply({ error: "unauthorized" }, 401);
    const admin = createAdminClient();
    const allowance = await consumeSecurityLimits(admin, [
      { scope: "books-reset-ip", value: requestIp(request), limit: 10, windowSeconds: 600 },
      { scope: "books-reset-user", value: auth.user.id, limit: 5, windowSeconds: 600 },
      { scope: "login-account", value: auth.user.email.trim().toLowerCase(), limit: 10, windowSeconds: 60 },
    ]);
    if (!allowance.allowed) return reply({ error: "rate_limited" }, 429, allowance.retryAfter);
    let body;
    try { body = await readBody(request); } catch { return reply({ error: "invalid_request" }, 400); }
    if (body.expectedUserId !== auth.user.id) return reply({ error: "stale_session" }, 403);
    if (body.confirmation !== "RESET" || typeof body.password !== "string" || !body.password || body.password.length > 1024
      || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) return reply({ error: "invalid_confirmation" }, 400);
    const requestId = body.requestId.toLowerCase();
    // A separate in-memory client never replaces the browser's session cookies.
    const verifier = createVerifier(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      const verified = await verifier.auth.signInWithPassword({ email: auth.user.email, password: body.password });
      if (verified.error || verified.data.user?.id !== auth.user.id) return reply({ error: verified.error?.status === 429 ? "rate_limited" : "invalid_password" }, verified.error?.status === 429 ? 429 : 401);
      const current = await session.auth.getUser();
      if (current.error || current.data.user?.id !== auth.user.id) return reply({ error: "unauthorized" }, 401);
      const { data, error } = await admin.rpc("reset_user_bookkeeping", { p_user_id: auth.user.id, p_request_id: requestId, p_confirmation: "RESET" });
      if (error) return reply({ error: ["PGRST202", "42P01", "42883"].includes(error.code) ? "setup_required" : "reset_failed" }, 503);
      if (data?.status !== "reset" || data.request_id !== requestId) return reply({ error: "reset_failed" }, 503);
      return reply({ ok: true, result: data });
    } finally {
      // Revoke only the short-lived verification session; keep the user's login.
      await verifier.auth.signOut({ scope: "local" }).catch(() => {});
    }
  } catch { return reply({ error: "unavailable" }, 503); }
}
