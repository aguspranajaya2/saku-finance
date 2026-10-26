import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { consumeSecurityLimits, requestIp } from "@/lib/security-limits";
import { isValidUsername, normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";

function failure(error: string, status: number, retryAfter = 60) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": String(retryAfter) } : {}) } });
}

async function readBody(request: Request): Promise<unknown> {
  const maximumBytes = 8192;
  if (!request.body || Number(request.headers.get("content-length")) > maximumBytes) throw new Error("Invalid body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("Invalid body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return failure("invalid_request", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return failure("invalid_request", 400);

  try {
    const admin = createAdminClient();
    const ipLimit = await consumeSecurityLimits(admin, [{ scope: "login-ip", value: requestIp(request), limit: 30, windowSeconds: 60 }]);
    if (!ipLimit.allowed) return failure("rate_limited", 429, ipLimit.retryAfter);

    let body: unknown;
    try { body = await readBody(request); } catch { return failure("invalid_request", 400); }
    if (!body || typeof body !== "object" || !("identifier" in body) || !("password" in body)) return failure("invalid_request", 400);
    if (typeof body.identifier !== "string" || typeof body.password !== "string") return failure("invalid_request", 400);
    const identifier = body.identifier.trim().toLowerCase();
    const password = body.password;
    if (!identifier || identifier.length > 320 || !password || password.length > 1024) return failure("invalid_request", 400);

    const identifierLimit = await consumeSecurityLimits(admin, [{ scope: "login-identifier", value: identifier, limit: 10, windowSeconds: 60 }]);
    if (!identifierLimit.allowed) return failure("rate_limited", 429, identifierLimit.retryAfter);
    let email = identifier;
    if (!identifier.includes("@")) {
      if (!isValidUsername(identifier)) return failure("invalid_credentials", 401);
      const { data, error } = await admin.rpc("resolve_username_email", { p_username: normalizeUsername(identifier) });
      if (error) return failure("username_setup_required", 503);
      if (typeof data !== "string" || !data) return failure("invalid_credentials", 401);
      email = data.trim().toLowerCase();
    }

    // Both login aliases consume the same account allowance after resolution.
    const accountLimit = await consumeSecurityLimits(admin, [{ scope: "login-account", value: email, limit: 10, windowSeconds: 60 }]);
    if (!accountLimit.allowed) return failure("rate_limited", 429, accountLimit.retryAfter);
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 429) return failure("rate_limited", 429);
      if (error.code === "email_not_confirmed") return failure("email_not_confirmed", 401);
      return failure("invalid_credentials", 401);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure("unavailable", 503);
  }
}
