import type { Metadata } from "next";
import { ResetPassword } from "@/components/reset-password";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Reset password — Saku",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage() {
  let authenticated = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    authenticated = !error && Boolean(data.user);
  } catch {
    // No session or configuration: offer a new recovery link instead of a form.
  }
  return <ResetPassword authenticated={authenticated} />;
}
