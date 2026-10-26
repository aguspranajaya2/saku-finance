import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { FinanceProvider } from "@/components/finance-provider";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) redirect("/login");
  }
  return <DashboardShell><FinanceProvider>{children}</FinanceProvider></DashboardShell>;
}
