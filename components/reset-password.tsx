"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { createClient } from "@/lib/supabase/client";
import { usePreferences } from "@/lib/preferences";

export function ResetPassword({ authenticated }: { authenticated: boolean }) {
  const { language } = usePreferences();
  const text = (en: string, id: string) => language === "en" ? en : id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved || !authenticated) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmation") ?? "")) {
      setError("mismatch");
      return;
    }
    if (password.length < 8) {
      setError("weak_password");
      return;
    }
    const supabase = createClient();
    if (!supabase) { setError("unavailable"); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.code === "same_password" ? "same_password" : updateError.code === "weak_password" ? "weak_password" : "unavailable");
        return;
      }
      // A sign-out failure must not report an already changed password as failed.
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Password is already saved. */ }
      setSaved(true);
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }

  const errors: Record<string, string> = {
    mismatch: text("The passwords don't match.", "Kedua kata sandi belum sama."),
    weak_password: text("Use at least 8 characters and meet your account's password requirements.", "Gunakan minimal 8 karakter dan ikuti persyaratan kata sandi akunmu."),
    same_password: text("Choose a password different from your current one.", "Pilih kata sandi yang berbeda dari kata sandi saat ini."),
    unavailable: text("Could not update your password. Your session may have expired. Request a new reset link and try again.", "Kata sandi belum bisa diubah. Sesi mungkin kedaluwarsa. Minta tautan reset baru lalu coba lagi."),
  };

  return (
    <AuthFrame title={text("Choose a new password", "Buat kata sandi baru")} description={text("Use a strong password that you don't use for another account.", "Gunakan kata sandi kuat yang tidak kamu pakai untuk akun lain.")}>
      {saved ? (
        <p className="auth-feedback success-feedback" role="status">{text("Your password has been updated. You can now sign in with your new password.", "Kata sandi berhasil diperbarui. Sekarang kamu bisa masuk dengan kata sandi baru.")}</p>
      ) : !authenticated ? (
        <div className="auth-form">
          <p className="auth-feedback error-feedback" role="alert">{text("A valid reset link is required. Request a new link and open it in the same browser.", "Kamu perlu tautan reset yang valid. Minta tautan baru dan buka di browser yang sama.")}</p>
          <Link className="primary-button auth-submit" href="/account-recovery">{text("Request reset link", "Minta tautan reset")}</Link>
        </div>
      ) : (
        <form aria-busy={busy} className="auth-form" onSubmit={submit}>
          <fieldset className="auth-fields" disabled={busy}>
            <label>{text("New password", "Kata sandi baru")}<input autoComplete="new-password" maxLength={1024} minLength={8} name="password" placeholder={text("At least 8 characters", "Minimal 8 karakter")} required type="password" /></label>
            <label>{text("Confirm new password", "Ulangi kata sandi baru")}<input autoComplete="new-password" maxLength={1024} minLength={8} name="confirmation" required type="password" /></label>
          </fieldset>
          {error && <p className="auth-feedback error-feedback" role="alert">{errors[error]}</p>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? text("Saving…", "Menyimpan…") : text("Save new password", "Simpan kata sandi baru")}</button>
          {error === "unavailable" && <Link className="auth-text-button" href="/account-recovery">{text("Request a new link", "Minta tautan baru")}</Link>}
        </form>
      )}
    </AuthFrame>
  );
}
