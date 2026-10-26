import type { Metadata } from "next";
import { AccountRecovery, type RecoveryMode } from "@/components/account-recovery";

export const metadata: Metadata = {
  title: "Account recovery — Saku",
  robots: { index: false, follow: false },
};

export default async function AccountRecoveryPage({ searchParams }: {
  searchParams: Promise<{ help?: string; error?: string }>;
}) {
  const params = await searchParams;
  const mode: RecoveryMode = params.help === "username" || params.help === "email" ? params.help : "password";
  return <AccountRecovery key={mode} initialMode={mode} invalidLink={params.error === "invalid_link"} />;
}
