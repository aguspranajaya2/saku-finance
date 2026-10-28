"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PreferenceControls } from "@/components/preference-controls";
import { PasswordInput } from "@/components/password-input";
import { usePreferences } from "@/lib/preferences";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { signInError } from "@/lib/auth-errors";

export default function LoginPage() {
  const router = useRouter();
  const { language } = usePreferences();
  const text = (english: string, indonesian: string) => language === "en" ? english : indonesian;
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/");
    }).catch(() => {});
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const supabase = createClient();
    if (!supabase) {
      setError(text("Supabase credentials are not set. Complete your .env.local file first.", "Kredensial Supabase belum diatur. Lengkapi .env.local terlebih dahulu."));
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const identifier = String(form.get("identifier") ?? "").trim();
    const username = normalizeUsername(String(form.get("username") ?? ""));
    const password = String(form.get("password") ?? "");
    setBusy(true);

    try {
      if (mode === "login") {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(signInError(result.error, language));
          return;
        }
        router.replace("/");
        router.refresh();
        return;
      }

      if (!isValidUsername(username)) {
        setError(text("Use 3–30 letters, numbers, or underscores for your username.", "Gunakan 3–30 huruf, angka, atau underscore untuk username."));
        return;
      }
      const { data: available, error: availabilityError } = await supabase.rpc("is_username_available", { p_username: username });
      if (availabilityError) {
        setError(text("Username registration is temporarily unavailable. Please try again later.", "Pendaftaran username belum tersedia. Silakan coba lagi nanti."));
        return;
      }
      if (!available) {
        setError(text("That username is already taken. Choose another one.", "Username sudah digunakan. Pilih username lain."));
        return;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin, data: { username } },
      });
      if (authError) {
        const { data: stillAvailable } = await supabase.rpc("is_username_available", { p_username: username });
        setError(stillAvailable === false ? text("That username was just taken. Choose another one.", "Username baru saja digunakan. Pilih username lain.") : authError.message);
        return;
      }
      if (data.session) {
        router.replace("/");
        router.refresh();
        return;
      }
      setMessage(text("Check your email to finish signing up, then sign in.", "Cek email untuk menyelesaikan pendaftaran, lalu masuk ke akunmu."));
    } catch {
      setError(text("Could not connect. Check your connection and try again.", "Tidak dapat terhubung. Periksa koneksi lalu coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-preferences"><PreferenceControls /></div>
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">s</span><span>saku<span className="brand-dot">.</span></span>
      </Link>
      <section className="auth-card">
        <span className="eyebrow">{text("PERSONAL ACCOUNT", "AKUN PRIBADI")}</span>
        <h1>{configured ? (mode === "login" ? text("Welcome back", "Selamat datang kembali") : text("Create your Saku account", "Buat akun Saku")) : text("Connect your account", "Hubungkan akunmu")}</h1>
        <p className="auth-subtitle">
          {configured
            ? text("Sign in to access your financial records.", "Masuk untuk membuka catatan keuanganmu.")
            : text("Connect a Supabase project to enable your account and data.", "Sambungkan proyek Supabase agar akun dan data bisa digunakan.")}
        </p>

        {!configured ? (
          <div className="setup-instructions">
            <div className="setup-step"><span>1</span><p>{text("Create a Supabase project and run the SQL migration in the ", "Buat proyek Supabase dan terapkan migrasi SQL yang ada di folder ")}<code>supabase/migrations</code>{text(" folder.", ".")}</p></div>
            <div className="setup-step"><span>2</span><p>{text("Copy ", "Salin ")}<code>.env.example</code>{text(" to ", " menjadi ")}<code>.env.local</code>{text(", then add the project URL and publishable key.", ", lalu isi URL dan publishable key dari panel proyek.")}</p></div>
            <div className="setup-step"><span>3</span><p>{text("Restart the local server. You can create an account here once the connection is ready.", "Mulai ulang server lokal. Kamu bisa membuat akun di sini setelah koneksi siap.")}</p></div>
            <a className="docs-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">{text("Open Supabase Dashboard", "Buka Supabase Dashboard")} ↗</a>
          </div>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label={text("Account access", "Akses akun")}>
              <button aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} disabled={busy} onClick={() => { setMode("login"); setError(""); setMessage(""); }} role="tab" type="button">{text("Sign in", "Masuk")}</button>
              <button aria-selected={mode === "signup"} className={mode === "signup" ? "selected" : ""} disabled={busy} onClick={() => { setMode("signup"); setError(""); setMessage(""); }} role="tab" type="button">{text("Create account", "Buat akun")}</button>
            </div>
            <form aria-busy={busy} className="auth-form" key={mode} onSubmit={submit}>
              {mode === "login" ? <label>{text("Username or email", "Username atau email")}<input autoCapitalize="none" autoComplete="username" autoCorrect="off" maxLength={320} name="identifier" placeholder={text("your_username or name@email.com", "username_kamu atau nama@email.com")} required spellCheck={false} type="text" /></label> : <>
                <label>{text("Username", "Username")}<input aria-describedby="username-hint" autoCapitalize="none" autoComplete="username" autoCorrect="off" maxLength={30} minLength={3} name="username" pattern="[A-Za-z0-9_]{3,30}" placeholder={text("your_username", "username_kamu")} required spellCheck={false} type="text" /><span className="field-hint" id="username-hint">{text("3–30 letters, numbers, or underscores. Case-insensitive.", "3–30 huruf, angka, atau underscore. Huruf besar/kecil dianggap sama.")}</span></label>
                <label>{text("Email", "Email")}<input autoComplete="email" name="email" placeholder="name@email.com" required type="email" /></label>
              </>}
              <div className="auth-password-field"><div className="auth-field-heading"><label htmlFor="auth-password">{text("Password", "Kata sandi")}</label>{mode === "login" && <Link href="/account-recovery">{text("Forgot password?", "Lupa kata sandi?")}</Link>}</div><PasswordInput autoComplete={mode === "login" ? "current-password" : "new-password"} id="auth-password" minLength={8} name="password" placeholder={text("At least 8 characters", "Minimal 8 karakter")} required /></div>
              {error && <p className="auth-feedback error-feedback" role="alert">{error}</p>}
              {message && <p className="auth-feedback success-feedback" role="status">{message}</p>}
              <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? text("Working…", "Memproses…") : mode === "login" ? text("Sign in to Saku", "Masuk ke Saku") : text("Create account", "Buat akun")}</button>
            </form>
            {mode === "login" && <nav className="auth-help-links" aria-label={text("Account recovery", "Pemulihan akun")}><Link href="/account-recovery?help=username">{text("Forgot username?", "Lupa username?")}</Link><span aria-hidden="true">·</span><Link href="/account-recovery?help=email">{text("Forgot email?", "Lupa email?")}</Link></nav>}
          </>
        )}
      </section>
      <p className="auth-footer">{text("Your financial data is stored in your Supabase project.", "Data keuanganmu disimpan di proyek Supabase milikmu.")}</p>
    </main>
  );
}
