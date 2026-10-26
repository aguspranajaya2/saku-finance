"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PreferenceControls } from "@/components/preference-controls";
import { usePreferences } from "@/lib/preferences";
import { createClient } from "@/lib/supabase/client";
import { UsernameSettings } from "@/components/username-settings";
import { watchVerifiedSession } from "@/lib/verified-session";

export default function SettingsPage() {
  const { language, theme } = usePreferences();
  const text = (en: string, id: string) => language === "en" ? en : id;
  const [configured, setConfigured] = useState(false);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLink, setPairingLink] = useState("");
  const [pairingMessage, setPairingMessage] = useState("");
  const [pairingAction, setPairingAction] = useState<"pair" | "disconnect" | "">("");
  const pairingBusy = Boolean(pairingAction);
  const operation = useRef(0);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    setConfigured(true);
    function clearAccount() {
      operation.current += 1;
      setEmail(""); setUserId(null);
      setPairingCode(""); setPairingLink(""); setPairingMessage(""); setPairingAction("");
    }
    const watcher = watchVerifiedSession(supabase, {
      onInvalidated: clearAccount,
      onUser(user) { setEmail(user.email ?? ""); setUserId(user.id); },
      onSignedOut: clearAccount,
      onError: clearAccount,
    });
    return () => { operation.current += 1; watcher.dispose(); };
  }, []);

  async function requestTelegram(action: "pair" | "disconnect") {
    if (pairingBusy || !userId) return;
    const currentOperation = ++operation.current;
    setPairingAction(action);
    setPairingMessage("");
    setPairingCode("");
    setPairingLink("");
    try {
      const response = await fetch(`/api/telegram/${action}`, { method: "POST" });
      const result = await response.json();
      if (operation.current !== currentOperation) return;
      if (!response.ok) {
        setPairingMessage(result.error ?? text("Could not update your Telegram connection.", "Koneksi Telegram belum bisa diperbarui."));
      } else if (action === "disconnect") {
        setPairingMessage("disconnected");
      } else {
        setPairingCode(result.code);
        setPairingLink(result.link ?? "");
        setPairingMessage("created");
      }
    } catch {
      if (operation.current === currentOperation) setPairingMessage("connection");
    } finally {
      if (operation.current === currentOperation) setPairingAction("");
    }
  }

  return (
    <div className="page-content settings-page">
      <div className="page-heading"><div><div className="eyebrow">{text("YOUR WORKSPACE", "RUANG KERJAMU")}</div><h1>{text("Settings", "Pengaturan")}</h1><p className="page-subtitle">{text("Manage your account, appearance, and connected services.", "Kelola akun, tampilan, dan layanan yang terhubung.")}</p></div></div>

      <section className="settings-section" id="account-details">
        <div className="settings-section-heading"><span className="settings-section-icon">◎</span><div><h2>{text("Account", "Akun")}</h2><p>{text("Your sign-in and personal data", "Informasi masuk dan data pribadimu")}</p></div></div>
        <article className="panel settings-card account-settings-card">
          <div className="settings-account-avatar">{email ? email.slice(0, 1).toUpperCase() : "S"}</div>
          <div className="settings-account-copy"><strong>{email || text("Preview account", "Akun pratinjau")}</strong><span>{configured ? text("Your personal account", "Akun pribadimu") : text("Account setup is not connected yet", "Koneksi akun belum diatur")}</span></div>
          {configured ? <span className="account-status"><i />{text("Protected", "Terlindungi")}</span> : <Link className="secondary-button" href="/login">{text("Set up sign in", "Atur login")}</Link>}
        </article>
        <div className="settings-security-note"><span>✓</span><p>{text("Your financial records are private to your account.", "Catatan keuanganmu hanya dapat diakses oleh akunmu.")}</p></div>
        {configured && userId && <UsernameSettings key={userId} userId={userId} />}
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><span className="settings-section-icon">◐</span><div><h2>{text("Appearance", "Tampilan")}</h2><p>{text("Choose your language and color theme", "Pilih bahasa dan tema warna")}</p></div></div>
        <article className="panel settings-card appearance-settings-card">
          <div className="setting-row"><div><strong>{text("Language", "Bahasa")}</strong><span>{text("Choose the language used across Saku.", "Pilih bahasa yang digunakan di seluruh Saku.")}</span></div><PreferenceControls showTheme={false} /></div>
          <div className="setting-row"><div><strong>{text("Color theme", "Tema warna")}</strong><span>{theme === "dark" ? text("Dark theme is active.", "Tema gelap sedang digunakan.") : text("Light theme is active.", "Tema terang sedang digunakan.")}</span></div><PreferenceControls showLanguage={false} /></div>
        </article>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><span className="settings-section-icon telegram-settings-icon">➤</span><div><h2>{text("Telegram bot", "Bot Telegram")}</h2><p>{text("Record activity from your private Telegram chat", "Catat transaksi lewat chat Telegram pribadimu")}</p></div></div>
        <article className="panel settings-card telegram-settings-card">
          <div className="telegram-settings-intro"><strong>{text("Connect your Saku bot", "Hubungkan bot Saku")}</strong><p>{text("Send a transaction or receipt photo. Review the extracted details before saving.", "Kirim transaksi atau foto struk. Tinjau hasil baca sebelum disimpan.")}</p></div>
          <button className="primary-button" disabled={!configured || !userId || pairingBusy} onClick={() => void requestTelegram("pair")} type="button">{pairingAction === "pair" ? text("Creating code…", "Membuat kode…") : configured ? text("Create pairing code", "Buat kode pairing") : text("Set up account first", "Atur akun terlebih dahulu")}</button>
          {configured && <button className="secondary-button" disabled={!userId || pairingBusy} onClick={() => void requestTelegram("disconnect")} type="button">{pairingAction === "disconnect" ? text("Disconnecting…", "Memutus koneksi…") : text("Disconnect Telegram", "Putuskan koneksi Telegram")}</button>}
          {!configured && <p className="telegram-setup-hint">{text("Connect Supabase to create an account and link the bot.", "Hubungkan Supabase untuk membuat akun dan mengaitkan bot.")} <Link href="/login">{text("Account setup", "Atur akun")}</Link></p>}
          {pairingMessage && <p className={`pairing-message${pairingMessage === "created" || pairingMessage === "disconnected" ? " pairing-success" : ""}`} role="status">{pairingMessage === "created" ? text("Code expires in 10 minutes. Send it privately to your bot.", "Kode berlaku 10 menit. Kirim secara pribadi ke bot.") : pairingMessage === "disconnected" ? text("Telegram disconnected. Previous pairing codes and pending receipts have been revoked.", "Telegram sudah diputus. Kode pairing dan struk yang belum disimpan telah dicabut.") : pairingMessage === "connection" ? text("Connection failed. Try again.", "Koneksi gagal. Coba lagi.") : pairingMessage}</p>}
          {pairingCode && <div className="pairing-result settings-pairing-result"><code>{pairingCode}</code>{pairingLink && <a href={pairingLink} rel="noreferrer" target="_blank">{text("Open Telegram chat", "Buka chat Telegram")} ↗</a>}</div>}
        </article>
      </section>

      <footer className="page-footer"><span>© 2026 Saku</span><span>{text("Settings are saved in this browser", "Pengaturan tampilan tersimpan di browser ini")}</span></footer>
    </div>
  );
}
