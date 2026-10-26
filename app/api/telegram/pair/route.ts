import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { consumeSecurityLimits } from "@/lib/security-limits";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 });
  }
  const sessionClient = await createClient();
  const { data, error } = await sessionClient.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Masuk ke akun Saku terlebih dahulu." }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
    const allowance = await consumeSecurityLimits(admin, [{ scope: "telegram-pair-minute", value: data.user.id, limit: 5, windowSeconds: 60 }]);
    if (!allowance.allowed) {
      return NextResponse.json({ error: "Terlalu banyak permintaan kode. Coba lagi sebentar." }, { status: 429, headers: { "Retry-After": String(allowance.retryAfter), "Cache-Control": "no-store" } });
    }
  } catch {
    return NextResponse.json({ error: "Kode belum bisa dibuat. Pastikan konfigurasi dan migrasi keamanan sudah lengkap." }, { status: 503 });
  }

  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!username || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Konfigurasi bot Telegram belum lengkap." }, { status: 503 });
  }

  const code = randomBytes(24).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const { error: insertError } = await admin.from("telegram_pairing_codes").upsert({
    code_hash: codeHash,
    user_id: data.user.id,
    expires_at: expiresAt.toISOString(),
  }, { onConflict: "user_id" });

  if (insertError) {
    return NextResponse.json({ error: "Kode pairing belum bisa dibuat. Pastikan migrasi Supabase sudah diterapkan." }, { status: 500 });
  }

  const link = `https://t.me/${username}?start=${code}`;
  return NextResponse.json({ code, link, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
