import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Permintaan tidak valid." }, 403);
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return reply({ error: "Masuk ke akun Saku terlebih dahulu." }, 401);
    // The database derives the owner from auth.uid(), never from request input.
    const { error: disconnectError } = await supabase.rpc("disconnect_telegram");
    if (disconnectError) return reply({ error: "Koneksi belum bisa diputus. Pastikan migrasi keamanan sudah diterapkan." }, 503);
    return reply({ ok: true });
  } catch {
    return reply({ error: "Koneksi belum bisa diputus. Silakan coba lagi." }, 503);
  }
}
