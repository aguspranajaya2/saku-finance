"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PreferenceControls } from "@/components/preference-controls";
import { usePreferences } from "@/lib/preferences";

export function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { language } = usePreferences();

  return (
    <main className="auth-page">
      <div className="auth-preferences"><PreferenceControls /></div>
      <Link className="brand auth-brand" href="/login">
        <span className="brand-mark">s</span><span>saku<span className="brand-dot">.</span></span>
      </Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="eyebrow">{language === "en" ? "ACCOUNT RECOVERY" : "PEMULIHAN AKUN"}</span>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-subtitle">{description}</p>
        {children}
        <Link className="auth-back-link" href="/login">← {language === "en" ? "Back to sign in" : "Kembali ke halaman masuk"}</Link>
      </section>
    </main>
  );
}
