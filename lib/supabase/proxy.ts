import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest, forwardedHeaders: Headers = new Headers(request.headers)) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  function nextResponse() {
    // Preserve request-only security headers when auth refresh replaces cookies.
    const headers = new Headers(forwardedHeaders);
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    else headers.delete("cookie");
    return NextResponse.next({ request: { headers } });
  }

  if (!url || !key) return nextResponse();

  let response = nextResponse();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
