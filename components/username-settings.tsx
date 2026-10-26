"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePreferences } from "@/lib/preferences";
import { createClient } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername } from "@/lib/username";

export function UsernameSettings({ userId }: { userId: string | null }) {
  const { language } = usePreferences();
  const text = (en: string, id: string) => language === "en" ? en : id;
  const [username, setUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "invalid" | "taken" | "save" | "">("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase || !userId) return;
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const { data, error: loadError } = await supabase!.from("profiles").select("username").eq("id", userId).maybeSingle();
        if (!active) return;
        if (loadError || !data) setError("load");
        else {
          setUsername(data.username ?? "");
          setSavedUsername(data.username ?? "");
        }
      } catch {
        if (active) setError("load");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    setError("");
    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) { setError("invalid"); return; }
    const supabase = createClient();
    if (!supabase || !userId) { setError("save"); return; }
    setSaving(true);
    try {
      const { data, error: updateError } = await supabase.from("profiles")
        .update({ username: normalized }).eq("id", userId).select("username").single();
      if (updateError) { setError(updateError.code === "23505" ? "taken" : "save"); return; }
      setUsername(data.username);
      setSavedUsername(data.username);
      setSaved(true);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  const messages = {
    load: text("Your username profile is not available yet. Please try again later.", "Profil username belum tersedia. Silakan coba lagi nanti."),
    invalid: text("Use 3–30 letters, numbers, or underscores.", "Gunakan 3–30 huruf, angka, atau underscore."),
    taken: text("That username is already taken. Choose another one.", "Username sudah digunakan. Pilih username lain."),
    save: text("Could not save your username. Please try again.", "Username gagal disimpan. Silakan coba lagi."),
  };

  return <article className="panel settings-card username-settings-card">
    <div className="panel-heading"><div><h2>{text("Sign-in username", "Username untuk login")}</h2><p>{text("Choose a username to sign in with your existing password.", "Pilih username agar bisa masuk menggunakan kata sandi yang sama.")}</p></div></div>
    {loading ? <p className="field-hint">{text("Loading your profile…", "Memuat profil…")}</p> : <>
      {error !== "load" && <form aria-busy={saving} className="auth-form username-form" onSubmit={submit}>
        <div className="username-form-controls"><label>{text("Username", "Username")}<input aria-describedby="settings-username-hint" autoCapitalize="none" autoComplete="username" autoCorrect="off" disabled={saving} maxLength={30} minLength={3} onChange={(event) => { setUsername(event.target.value); setSaved(false); if (error) setError(""); }} pattern="[A-Za-z0-9_]{3,30}" placeholder={text("your_username", "username_kamu")} required spellCheck={false} type="text" value={username} /></label><button className="primary-button" disabled={saving || normalizeUsername(username) === savedUsername} type="submit">{saving ? text("Saving…", "Menyimpan…") : text("Save username", "Simpan username")}</button></div>
        <p className="field-hint" id="settings-username-hint">{text("3–30 letters, numbers, or underscores. Case-insensitive. Your email still works for sign-in.", "3–30 huruf, angka, atau underscore. Huruf besar/kecil dianggap sama. Email tetap bisa digunakan untuk login.")}</p>
      </form>}
      {error && <p className="auth-feedback error-feedback" role="alert">{messages[error]}</p>}
      {saved && <p className="auth-feedback success-feedback" role="status">{text("Username saved.", "Username berhasil disimpan.")}</p>}
    </>}
  </article>;
}
