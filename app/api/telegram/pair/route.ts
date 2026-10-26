import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const sessionClient = await createClient();
  const { data, error } = await sessionClient.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Masuk ke akun Saku terlebih dahulu." }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Kredensial server Supabase belum lengkap." }, { status: 503 });
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

  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const link = username ? `https://t.me/${username}?start=${code}` : null;
  return NextResponse.json({ code, link, expiresAt: expiresAt.toISOString() });
}
