"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { signInError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { usePreferences } from "@/lib/preferences";

export type RecoveryMode = "password" | "username" | "email";

export function AccountRecovery({ initialMode, invalidLink }: { initialMode: RecoveryMode; invalidLink: boolean }) {
  const router = useRouter();
  const { language } = usePreferences();
  const text = (en: string, id: string) => language === "en" ? en : id;
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function chooseMode(nextMode: RecoveryMode) {
    setMode(nextMode);
    setError("");
    setSent(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (busy || (mode === "password" && cooldown > 0)) return;
    const supabase = createClient();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (mode === "password") {
        const email = String(form.get("email") ?? "").trim();
        const redirectTo = new URL("/auth/callback", window.location.origin).toString();
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetError) {
          setError(resetError.status === 429 ? "rate_limited" : "send_failed");
          return;
        }
        setSent(true);
        setCooldown(60);
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: String(form.get("identifier") ?? "").trim(), password: String(form.get("password") ?? "") }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "unavailable");
        return;
      }
      router.replace("/settings#account-details");
      router.refresh();
    } catch {
      setError("connection");
    } finally {
      setBusy(false);
    }
  }

  const description = mode === "password"
    ? text("Enter your account email and we'll send you a password reset link.", "Masukkan email akunmu untuk menerima tautan reset kata sandi.")
    : mode === "username"
      ? text("Sign in with your email and password to see your username in Settings > Account.", "Masuk dengan email dan kata sandi untuk melihat username di Pengaturan > Akun.")
      : text("Sign in with your username and password to see your email in Settings > Account.", "Masuk dengan username dan kata sandi untuk melihat email di Pengaturan > Akun.");
  const errorMessage = error === "send_failed"
    ? text("Could not send the email. Please try again later.", "Email belum bisa dikirim. Silakan coba lagi nanti.")
    : error === "connection"
      ? text("Could not connect. Check your connection and try again.", "Tidak dapat terhubung. Periksa koneksi lalu coba lagi.")
      : signInError(error, language);

  return (
    <AuthFrame title={text("Let's get you back in", "Pulihkan akses akunmu")} description={description}>
      <div className="auth-tabs recovery-tabs" aria-label={text("Choose what you forgot", "Pilih yang kamu lupa")}>
        {(["password", "username", "email"] as const).map((item) => (
          <button aria-pressed={mode === item} className={mode === item ? "selected" : ""} disabled={busy} key={item} onClick={() => chooseMode(item)} type="button">
            {item === "password" ? text("Password", "Kata sandi") : item === "username" ? "Username" : "Email"}
          </button>
        ))}
      </div>
      {invalidLink && <p className="auth-feedback error-feedback recovery-notice" role="alert">{text("This link is invalid or has expired. Request a new link and open it in the same browser you used here.", "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dan buka di browser yang kamu gunakan di sini.")}</p>}
      {!configured ? <p className="field-hint">{text("Account recovery is available once Supabase is connected.", "Pemulihan akun tersedia setelah Supabase terhubung.")}</p> : (
        <form aria-busy={busy} className="auth-form" key={mode} onSubmit={submit}>
          <fieldset className="auth-fields" disabled={busy}>
            {mode === "password" ? (
              <label>{text("Account email", "Email akun")}<input autoComplete="email" maxLength={320} name="email" placeholder="name@email.com" required type="email" /></label>
            ) : (
              <>
                <label>{mode === "username" ? text("Account email", "Email akun") : "Username"}<input autoCapitalize="none" autoComplete={mode === "username" ? "email" : "username"} autoCorrect="off" maxLength={mode === "username" ? 320 : 30} name="identifier" placeholder={mode === "username" ? "name@email.com" : text("your_username", "username_kamu")} required spellCheck={false} type={mode === "username" ? "email" : "text"} /></label>
                <label>{text("Password", "Kata sandi")}<input autoComplete="current-password" maxLength={1024} name="password" required type="password" /></label>
              </>
            )}
          </fieldset>
          {error && <p className="auth-feedback error-feedback" role="alert">{errorMessage}</p>}
          {sent && <p className="auth-feedback success-feedback" role="status">{text("If an account uses this email, a reset link will arrive shortly. Check your inbox and spam folder. Open the link in this browser.", "Jika ada akun dengan email ini, tautan reset akan segera dikirim. Periksa kotak masuk dan folder spam. Buka tautan di browser ini.")}</p>}
          <button className="primary-button auth-submit" disabled={busy || (mode === "password" && cooldown > 0)} type="submit">
            {busy ? text("Working…", "Memproses…") : mode !== "password" ? text("Sign in and view account", "Masuk dan lihat akun") : cooldown > 0 ? text(`Send again in ${cooldown}s`, `Kirim ulang dalam ${cooldown} dtk`) : sent ? text("Send another link", "Kirim tautan lagi") : text("Send reset link", "Kirim tautan reset")}
          </button>
          {mode !== "password" && <button className="auth-text-button" onClick={() => chooseMode("password")} disabled={busy} type="button">{text("Forgot your password too?", "Lupa kata sandi juga?")}</button>}
          {mode === "email" && <p className="field-hint">{text("Forgot both your email and password? Check your email accounts for earlier messages from Saku. You'll need access to your registered inbox to reset your password.", "Lupa email dan kata sandi sekaligus? Periksa akun emailmu untuk mencari pesan lama dari Saku. Kamu perlu akses ke email terdaftar untuk mereset kata sandi.")}</p>}
        </form>
      )}
    </AuthFrame>
  );
}
