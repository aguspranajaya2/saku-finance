import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername, normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";

// A small per-process guard supplements Supabase Auth's own rate limits.
// Multi-instance hosting should enforce an additional shared limit at its edge.
const attempts = new Map<string, { count: number; expires: number }>();
const windowMs = 60_000;

function allowAttempt(request: Request, identifier: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  if (attempts.size >= 10_000) return false;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const keys = [
    { value: `ip:${ip}`, limit: 30 },
    { value: `account:${identifier}`, limit: 10 },
  ];
  for (const key of keys) {
    const digest = createHash("sha256").update(key.value).digest("hex");
    const current = attempts.get(digest) ?? { count: 0, expires: now + windowMs };
    if (current.count >= key.limit) return false;
    attempts.set(digest, { count: current.count + 1, expires: current.expires });
  }
  return true;
}

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return failure("invalid_request", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return failure("invalid_request", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }
  if (!body || typeof body !== "object" || !("identifier" in body) || !("password" in body)) return failure("invalid_request", 400);
  if (typeof body.identifier !== "string" || typeof body.password !== "string") return failure("invalid_request", 400);

  const identifier = body.identifier.trim().toLowerCase();
  const password = body.password;
  if (!identifier || identifier.length > 320 || !password || password.length > 1024) return failure("invalid_request", 400);
  if (!allowAttempt(request, identifier)) return failure("rate_limited", 429);

  try {
    let email = identifier;
    if (!identifier.includes("@")) {
      if (!isValidUsername(identifier)) return failure("invalid_credentials", 401);
      if (!process.env.SUPABASE_SECRET_KEY) return failure("username_setup_required", 503);
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("resolve_username_email", { p_username: normalizeUsername(identifier) });
      if (error) return failure("username_setup_required", 503);
      if (typeof data !== "string" || !data) return failure("invalid_credentials", 401);
      email = data;
    }

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
