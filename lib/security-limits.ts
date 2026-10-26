import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SecurityLimit = { scope: string; value: string; limit: number; windowSeconds: number };

export class SecurityLimitsUnavailable extends Error {
  constructor() {
    super("Security limits are unavailable.");
    this.name = "SecurityLimitsUnavailable";
  }
}

export function requestIp(request: Request) {
  // The deployment proxy must overwrite this header, as Vercel does.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "unknown";
}

export async function consumeSecurityLimits(admin: Pick<SupabaseClient, "rpc">, limits: SecurityLimit[]) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !limits.length || limits.length > 8) throw new SecurityLimitsUnavailable();
  const payload = limits.map(({ scope, value, limit, windowSeconds }) => {
    if (!scope || scope.length > 80 || !value || value.length > 1024
      || !Number.isInteger(limit) || limit < 1 || limit > 10000
      || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) {
      throw new SecurityLimitsUnavailable();
    }
    return {
      key: createHmac("sha256", secret).update(JSON.stringify([scope, value])).digest("hex"),
      limit,
      window_seconds: windowSeconds,
    };
  });
  try {
    const { data, error } = await admin.rpc("consume_security_limits", { p_limits: payload });
    if (error || !data || typeof data !== "object" || Array.isArray(data)
      || typeof data.allowed !== "boolean" || !Number.isInteger(data.retry_after)
      || data.retry_after < 0 || data.retry_after > 86400) throw new SecurityLimitsUnavailable();
    return { allowed: data.allowed as boolean, retryAfter: data.allowed ? 0 : Math.max(1, data.retry_after as number) };
  } catch {
    throw new SecurityLimitsUnavailable();
  }
}
