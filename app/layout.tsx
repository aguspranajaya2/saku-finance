import type { Metadata } from "next";
import "./globals.css";
import { PreferencesProvider } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Saku — Personal Finance",
  description: "Track your income and expenses in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
