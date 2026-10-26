import type { Metadata } from "next";
import "./globals.css";
import { PreferencesProvider } from "@/lib/preferences";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Saku — Personal Finance",
  description: "Track your income and expenses in one place.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A fresh request is required so Next can nonce its hydration scripts.
  await connection();
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
