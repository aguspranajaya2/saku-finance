"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TransactionDialog } from "@/components/transaction-dialog";
import { categoryLabel, formatTransactionDate } from "@/lib/finance";
import { usePreferences } from "@/lib/preferences";
import { useFinance } from "@/components/finance-provider";

function Icon({ name }: { name: "income" | "expense" | "balance" | "calendar" }) {
  const paths = {
    income: "M7 17 17 7 M7 7h10v10",
    expense: "M7 7l10 10 M17 7v10H7",
    balance: "M4 18V6m0 12h16M7 14l3-4 3 2 5-6",
    calendar: "M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1z",
  };
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none"><path d={paths[name]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function OverviewPage() {
  const { language } = usePreferences();
  const locale = language === "en" ? "en-US" : "id-ID";
  const text = (en: string, id: string) => language === "en" ? en : id;
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "IDR", maximumFractionDigits: 0 }), [locale]);
  const { transactions, configured, loading, loadError, saving, saveError, clearSaveError, saveTransaction } = useFinance();
  const [dialogOpen, setDialogOpen] = useState(false);
  const loadMessage = loadError === "query"
    ? text("Transactions could not load. Apply the Supabase database migration first.", "Transaksi tidak dapat dimuat. Terapkan migrasi database Supabase terlebih dahulu.")
    : text("Could not connect to your account. Check your connection and try again.", "Tidak dapat terhubung ke akun. Periksa koneksi lalu coba lagi.");
  const saveMessage = !saveError ? "" : saveError === "session"
    ? text("Your session is not ready. Refresh and try again.", "Sesi akun belum siap. Muat ulang lalu coba lagi.")
    : text("Could not save this entry. Please try again.", "Catatan gagal disimpan. Silakan coba lagi.");
  const thisMonth = useMemo(() => {
    const now = new Date();
    return transactions.filter((item) => {
      const date = new Date(`${item.date}T12:00:00`);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
  }, [transactions]);
  const totals = useMemo(() => thisMonth.reduce((result, item) => {
    result[item.kind] += item.amount;
    return result;
  }, { income: 0, expense: 0 }), [thisMonth]);
  const expensesByCategory = useMemo(() => {
    const groups = new Map<string, number>();
    thisMonth.filter((item) => item.kind === "expense").forEach((item) => groups.set(item.category, (groups.get(item.category) ?? 0) + item.amount));
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [thisMonth]);
  const maxCategory = expensesByCategory[0]?.[1] ?? 0;

  const weekly = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const ofDay = transactions.filter((item) => item.date === key);
      return {
        day: date.toLocaleDateString(locale, { weekday: "short", timeZone: "Asia/Makassar" }),
        income: ofDay.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount, 0),
        expense: ofDay.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0),
      };
    });
  }, [locale, transactions]);
  const maxWeek = Math.max(1, ...weekly.flatMap((item) => [item.income, item.expense]));

  if (loading) return <div className="page-content"><div className="page-skeleton" /></div>;

  return (
    <div className="page-content">
      <div className="page-heading overview-heading">
        <div><div className="eyebrow">{text("PERSONAL FINANCE", "KEUANGAN PRIBADI")}</div><h1>{text("Your money, in better order.", "Uangmu, lebih teratur.")}</h1><p className="page-subtitle">{text("A clear view of what came in, what went out, and what is next.", "Lihat pemasukan, pengeluaran, dan langkah berikutnya dengan jelas.")}</p></div>
        <button className="primary-button" onClick={() => { clearSaveError(); setDialogOpen(true); }} type="button"><span className="button-plus">＋</span>{text("Add transaction", "Tambah transaksi")}</button>
      </div>

      {!configured && <div className="demo-note"><span className="demo-dot" />{text("Preview mode · sample transactions shown", "Mode pratinjau · menampilkan transaksi contoh")} <Link href="/login">{text("Set up an account", "Siapkan akun")}</Link></div>}
      {loadError && <div className="inline-notice">{loadMessage} <Link href="/login">{text("Open setup", "Buka panduan")}</Link></div>}

      <section aria-label={text("Month summary", "Ringkasan bulanan")} className="summary-grid">
        <article className="summary-card balance-card"><div className="summary-top"><span className="summary-label">{text("Net cash flow · this month", "Arus bersih · bulan ini")}</span><span className="summary-icon balance-icon"><Icon name="balance" /></span></div><div className="summary-value">{money.format(totals.income - totals.expense)}</div><div className="summary-foot"><span className="trend-pill">{thisMonth.length}</span><span>{text("entries this month", "catatan bulan ini")}</span></div><div className="balance-orb orb-one" /><div className="balance-orb orb-two" /></article>
        <article className="summary-card"><div className="summary-top"><span className="summary-label">{text("Income", "Pemasukan")}</span><span className="summary-icon income-icon"><Icon name="income" /></span></div><div className="summary-value">{money.format(totals.income)}</div><div className="summary-foot"><span className="trend-text positive">{thisMonth.filter((item) => item.kind === "income").length}</span><span>{text("income entries", "catatan pemasukan")}</span></div><div className="mini-sparkline income-spark"><i /><i /><i /><i /><i /><i /><i /></div></article>
        <article className="summary-card"><div className="summary-top"><span className="summary-label">{text("Expenses", "Pengeluaran")}</span><span className="summary-icon expense-icon"><Icon name="expense" /></span></div><div className="summary-value">{money.format(totals.expense)}</div><div className="summary-foot"><span className="trend-text negative">{thisMonth.filter((item) => item.kind === "expense").length}</span><span>{text("expense entries", "catatan pengeluaran")}</span></div><div className="mini-sparkline expense-spark"><i /><i /><i /><i /><i /><i /><i /></div></article>
      </section>

      <section className="insight-grid">
        <article className="panel cashflow-panel overview-cashflow"><div className="panel-heading"><div><h2>{text("Cash flow", "Arus kas")}</h2><p>{text("Income and expenses over the last 7 days", "Pemasukan dan pengeluaran selama 7 hari terakhir")}</p></div><span className="period-chip"><Icon name="calendar" />{text("Last 7 days", "7 hari")}</span></div><div className="chart-legend"><span><i className="legend-income" />{text("Income", "Pemasukan")}</span><span><i className="legend-expense" />{text("Expenses", "Pengeluaran")}</span></div><div className="cashflow-bars">{weekly.map((item, index) => <div className="cashflow-day" key={`${item.day}-${index}`}><div className="cashflow-pair"><i className="cashflow-bar bar-income" style={{ height: `${item.income ? Math.max(4, item.income / maxWeek * 100) : 2}%` }} /><i className="cashflow-bar bar-expense" style={{ height: `${item.expense ? Math.max(4, item.expense / maxWeek * 100) : 2}%` }} /></div><span>{index === 6 ? text("Today", "Hari ini") : item.day}</span></div>)}</div><div className="cashflow-totals"><span><i className="legend-income" />{money.format(weekly.reduce((sum, item) => sum + item.income, 0))}</span><span><i className="legend-expense" />{money.format(weekly.reduce((sum, item) => sum + item.expense, 0))}</span></div></article>
        <article className="panel breakdown-panel overview-breakdown"><div className="panel-heading"><div><h2>{text("Spending breakdown", "Rincian pengeluaran")}</h2><p>{text("Top categories this month", "Kategori utama bulan ini")}</p></div><Link className="subtle-link" href="/transactions">{text("Details", "Rincian")} ›</Link></div><div className="overview-category-list">{expensesByCategory.map(([category, amount], index) => <div className="overview-category" key={category}><div className="overview-category-label"><span><i className={`category-dot ${["lavender", "mint", "peach", "blue"][index % 4]}`} />{categoryLabel(category, language)}</span><strong>{money.format(amount)}</strong></div><div className="overview-category-track"><i style={{ width: `${maxCategory ? amount / maxCategory * 100 : 0}%` }} /></div></div>)}{expensesByCategory.length === 0 && <div className="category-empty">{text("No expenses this month yet.", "Belum ada pengeluaran bulan ini.")}</div>}</div></article>
      </section>

      <section className="panel transactions-panel overview-recent">
        <div className="panel-heading transaction-heading"><div><h2>{text("Recent transactions", "Transaksi terbaru")}</h2><p>{text("The latest activity across your accounts", "Aktivitas terbaru dari catatan keuanganmu")}</p></div><Link className="view-all" href="/transactions">{text("All transactions", "Semua transaksi")} <span>›</span></Link></div>
        <div className="transaction-table"><div className="table-head"><span>{text("TRANSACTION", "TRANSAKSI")}</span><span>{text("CATEGORY", "KATEGORI")}</span><span>{text("DATE", "TANGGAL")}</span><span>{text("AMOUNT", "NOMINAL")}</span></div>{transactions.slice(0, 5).map((transaction) => <div className="transaction-row" key={transaction.id}><div className="transaction-title"><span className={`transaction-emoji ${transaction.kind}`}>{transaction.emoji}</span><strong>{language === "id" ? transaction.idTitle ?? transaction.title : transaction.title}</strong></div><span className="transaction-category">{categoryLabel(transaction.category, language)}</span><span className="transaction-date">{formatTransactionDate(transaction.date, locale)}</span><strong className={`transaction-amount ${transaction.kind}`}>{transaction.kind === "income" ? "+" : "−"}{money.format(transaction.amount)}</strong></div>)}{transactions.length === 0 && <div className="empty-state">{text("No transactions yet. Add your first entry.", "Belum ada transaksi. Tambahkan catatan pertamamu.")}</div>}</div>
      </section>
      <footer className="page-footer"><span>© 2026 Saku</span><span>{text("Made for calmer money tracking", "Dibuat untuk mencatat dengan tenang")} <span className="footer-heart">♥</span></span></footer>

      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={saveTransaction} saving={saving} configured={Boolean(configured)} error={saveMessage} />
    </div>
  );
}
