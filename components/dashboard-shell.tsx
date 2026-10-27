"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PreferenceControls } from "@/components/preference-controls";
import { createClient } from "@/lib/supabase/client";
import { watchVerifiedSession } from "@/lib/verified-session";
import { usePreferences } from "@/lib/preferences";

const navigation = [
  { href: "/", key: "overview", icon: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z" },
  { href: "/transactions", key: "transactions", icon: "M7 7h13l-3-3 M20 7l-3 3 M17 17H4l3 3 M4 17l3-3" },
  { href: "/accounts", key: "accounts", icon: "M4 5h16v15H4z M8 5v15 M4 10h16 M12 14h5 M12 17h5" },
  { href: "/debts", key: "debts", icon: "M3 7h18v12H3z M3 11h18 M7 15h4 M7 4h10" },
  { href: "/reports", key: "reports", icon: "M5 3h10l4 4v14H5z M8 16v-3 M12 16V9 M16 16v-5" },
  { href: "/settings", key: "settings", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.2l-.2.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.5-1l-.2-.1-1.7-2.9.1-.2a1.7 1.7 0 0 0-.3-1.8l-.1-.2v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.5l.1-.2 2.9-1.7.2.1a1.7 1.7 0 0 0 1.8-.3l.2-.1h3.4l.1.2a1.7 1.7 0 0 0 1.5 1l.2.1 1.7 2.9-.1.2a1.7 1.7 0 0 0 .3 1.8l.1.2v3.4z" },
];

function Icon({ path, size = 18 }: { path: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"><path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { language } = usePreferences();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [email, setEmail] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const text = (en: string, id: string) => language === "en" ? en : id;
  const labels: Record<string, string> = { overview: text("Overview", "Ringkasan"), transactions: text("General journal", "Jurnal umum"), accounts: text("Accounts & ledger", "Akun & buku besar"), debts: text("Debts & receivables", "Utang & piutang"), reports: text("Reports", "Laporan"), settings: text("Settings", "Pengaturan") };
  const pageName = labels[navigation.find(item => item.href === pathname)?.key ?? "overview"];

  useEffect(() => {
    const saved = window.localStorage.getItem("saku-sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
    const supabase = createClient();
    if (!supabase) {
      setConfigured(false);
      setReady(true);
      return;
    }
    setConfigured(true);
    const watcher = watchVerifiedSession(supabase, {
      onInvalidated() { setReady(false); setEmail(""); },
      onUser(user) { setAccountId(user.id); setEmail(user.email ?? ""); setReady(true); },
      onSignedOut() { setAccountId(null); router.replace("/login"); router.refresh(); },
      onError() { router.replace("/login"); },
    });
    return () => watcher.dispose();
  }, [router]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 790px)");
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])].filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [mobileOpen]);

  function toggleSidebar() {
    setCollapsed((value) => {
      window.localStorage.setItem("saku-sidebar-collapsed", String(!value));
      return !value;
    });
  }

  async function signOut() {
    const supabase = createClient();
    if (!supabase) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) { setSignOutError(true); return; }
      router.replace("/login");
      router.refresh();
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  if (!ready) return <main className="app-loading"><span className="brand-mark">s</span><span>{text("Checking your account…", "Memeriksa akun…")}</span></main>;

  return (
    <main className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`} key={accountId ?? "preview"}>
      {mobileOpen && <button aria-label={text("Close navigation", "Tutup navigasi")} className="sidebar-scrim" onClick={() => setMobileOpen(false)} type="button" />}
      <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`} id="workspace-sidebar" inert={isMobile && !mobileOpen} ref={sidebarRef}>
        <div className="sidebar-brand-row">
          <Link aria-label={text("Saku home", "Beranda Saku")} className="brand" href="/" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark">s</span><span className="brand-word">saku<span className="brand-dot">.</span></span>
          </Link>
          <button aria-label={collapsed ? text("Expand sidebar", "Buka sidebar") : text("Collapse sidebar", "Tutup sidebar")} aria-expanded={!collapsed} className="sidebar-toggle" onClick={toggleSidebar} title={collapsed ? text("Expand sidebar", "Buka sidebar") : text("Collapse sidebar", "Tutup sidebar")} type="button"><span>{collapsed ? "›" : "‹"}</span></button>
          <button aria-label={text("Close navigation", "Tutup navigasi")} className="sidebar-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>
        </div>
        <div className="sidebar-label">{text("WORKSPACE", "RUANG KERJA")}</div>
        <nav aria-label={text("Main navigation", "Navigasi utama")} className="side-nav">
          {navigation.map((item) => {
            const label = labels[item.key];
            const current = pathname === item.href;
            return <Link aria-current={current ? "page" : undefined} className={`nav-link${current ? " active" : ""}`} href={item.href} key={item.href} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined}><Icon path={item.icon} size={18} /><span className="nav-text">{label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tip"><div className="tip-icon"><span>✦</span></div><p className="tip-title">{text("Small steps add up", "Catat sedikit demi sedikit")}</p><p className="tip-copy">{text("A small habit today can make your finances clearer.", "Kebiasaan kecil hari ini bikin keuangan lebih jelas.")}</p></div>
        <div className="profile-row">
          <div className="avatar">{email ? email.slice(0, 1).toUpperCase() : "S"}</div>
          <div className="profile-copy"><strong>{email ? email.split("@")[0] : text("Preview", "Pratinjau")}</strong><span>{email || text("Personal account", "Akun pribadi")}</span></div>
          {configured && <button className="profile-menu profile-signout" disabled={signingOut} onClick={signOut} title={text("Sign out", "Keluar")} type="button">{signingOut ? "…" : text("Sign out", "Keluar")}</button>}
        </div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <button aria-controls="workspace-sidebar" aria-expanded={mobileOpen} aria-label={mobileOpen ? text("Close navigation", "Tutup navigasi") : text("Open navigation", "Buka navigasi")} className="mobile-menu-button" onClick={() => setMobileOpen((open) => !open)} type="button"><span>☰</span></button>
          <div className="breadcrumb"><span>{text("Finance", "Keuangan")}</span><span className="breadcrumb-chevron">›</span><strong>{pageName}</strong></div>
          <div className="topbar-right"><span className="today-label">{new Date().toLocaleDateString(language === "en" ? "en-US" : "id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" })}</span><PreferenceControls />{!configured && <Link className="sign-in-link" href="/login">{text("Sign in", "Masuk")}</Link>}</div>
        </header>
        {signOutError && <div className="inline-notice" role="alert">{text("Could not sign out. Check your connection and try again.", "Belum bisa keluar. Periksa koneksi lalu coba lagi.")}</div>}
        {children}
      </section>
    </main>
  );
}
