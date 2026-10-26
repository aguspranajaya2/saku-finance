import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy } from "@/lib/security-headers";

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV === "development", request.nextUrl.protocol === "https:");
  const headers = new Headers(request.headers);
  // Replace any nonce/policy provided by an untrusted client.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = await updateSession(request, headers);
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
