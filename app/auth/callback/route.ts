import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");

  if (code && !url.searchParams.has("error")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (!error) {
        // Recovery always goes to our password form, regardless of URL parameters.
        return NextResponse.redirect(new URL("/reset-password", url.origin), {
          headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
        });
      }
    } catch {
      // Invalid, expired, and unavailable exchanges share the same recovery screen.
    }
  }

  return NextResponse.redirect(new URL("/account-recovery?error=invalid_link", url.origin), {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
