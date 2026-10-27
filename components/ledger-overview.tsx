"use client";
import { useState } from "react";
import Link from "next/link";
import { useLedger } from "@/components/ledger-provider";
import { JournalDialog } from "@/components/journal-dialog";
import { JournalList, LedgerStatus, useLedgerText } from "@/components/ledger-ui";
import { accountBalances, entryEffects, incomeStatementEntries, isCash, periodSummary, todayDate } from "@/lib/ledger";

export default function OverviewPage() {
  const { accounts, entries, loading, clearError } = useLedger(); const { t, money } = useLedgerText();
  const [open, setOpen] = useState(false), [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const [year, number] = month.split("-").map(Number);
  const start = `${month}-01`, end = `${month}-${new Date(year, number, 0).getDate()}`;
  const period = periodSummary(accounts, entries, start, end), balances = accountBalances(accounts, entries, todayDate());
  const cash = balances.filter(isCash).reduce((s, a) => s + a.balance, 0n);
  const debts = balances.filter(a => a.account_type === "liability").reduce((s, a) => s + a.balance, 0n);
  const receivables = balances.filter(a => a.role === "receivable").reduce((s, a) => s + a.balance, 0n);
  const groups = new Map<string, bigint>();
  incomeStatementEntries(entries, start, end).forEach(e => { const value = entryEffects(accounts, e).expense; groups.set(e.category, (groups.get(e.category) ?? 0n) + value); });
  const categories = [...groups].filter(([, value]) => value > 0n).sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0).slice(0, 5);
  const chartEnd = end < todayDate() ? end : todayDate();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${chartEnd}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 6 + i);
    const key = date.toISOString().slice(0, 10), sum = periodSummary(accounts, entries, key, key);
    return { key, ...sum };
  });
  const max = Math.max(1, ...days.flatMap(day => [Number(day.cashIn), Number(day.cashOut)]));
  const recent = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at)).slice(0, 5);
  return <div className="page-content ledger-page">
    <div className="page-heading"><div><div className="eyebrow">{t("YOUR BOOKS, IN BALANCE", "BUKU KEUANGAN SEIMBANG")}</div><h1>{t("Financial overview", "Ringkasan keuangan")}</h1><p className="page-subtitle">{t("Revenue, expenses, cash, and outstanding balances from your journal.", "Pendapatan, beban, kas, dan saldo yang belum lunas dari jurnalmu.")}</p></div>
      <div className="ledger-heading-actions"><label className="ledger-date-control"><span>{t("Period", "Periode")}</span><input aria-label={t("Summary month", "Bulan ringkasan")} type="month" required value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label><button className="primary-button" disabled={loading || !accounts.length} onClick={() => { clearError(); setOpen(true); }} type="button">＋ {t("Record activity", "Catat aktivitas")}</button></div></div>
    <LedgerStatus />{loading ? <div className="page-skeleton" /> : <>
    <section className="ledger-summary-grid" aria-label={t("Period summary", "Ringkasan periode")}>
      <article className="summary-card balance-card"><span className="summary-label">{t("Net cash flow", "Arus kas bersih")}</span><div className="summary-value">{money.format(period.cashIn - period.cashOut)}</div><p>{t("Cash received less cash paid", "Kas masuk dikurangi kas keluar")}</p></article>
      <article className="summary-card"><span className="summary-label">{t("Revenue", "Pendapatan")}</span><div className="summary-value positive">{money.format(period.income)}</div><p>{t("Excludes loan proceeds and capital", "Tanpa pokok pinjaman dan modal")}</p></article>
      <article className="summary-card"><span className="summary-label">{t("Expenses", "Beban")}</span><div className="summary-value">{money.format(period.expense)}</div><p>{t("Includes purchases on credit", "Termasuk pembelian secara kredit")}</p></article>
      <article className="summary-card"><span className="summary-label">{t("Net profit / loss", "Laba / rugi bersih")}</span><div className="summary-value">{money.format(period.income - period.expense)}</div><p>{t("Revenue less expenses", "Pendapatan dikurangi beban")}</p></article>
    </section>
    <section className="ledger-position-strip"><div><span>{t("Cash & bank · today", "Kas & bank · hari ini")}</span><strong>{money.format(cash)}</strong></div><Link href="/debts"><span>{t("Outstanding liabilities", "Saldo kewajiban")}</span><strong>{money.format(debts)}</strong></Link><Link href="/debts"><span>{t("Receivables", "Piutang")}</span><strong>{money.format(receivables)}</strong></Link></section>
    <section className="insight-grid"><article className="panel cashflow-panel"><div className="panel-heading"><div><h2>{t("Cash movement", "Pergerakan kas")}</h2><p>{t("7 days ending", "7 hari sampai")} {chartEnd}</p></div></div><div className="chart-legend"><span><i className="legend-income" />{t("Cash in", "Kas masuk")}</span><span><i className="legend-expense" />{t("Cash out", "Kas keluar")}</span></div>
      <div className="cashflow-bars">{days.map(day => <div className="cashflow-day" key={day.key}><div className="cashflow-pair"><i className="cashflow-bar bar-income" style={{ height: `${Math.max(1, Number(day.cashIn) / max * 100)}%` }} title={money.format(day.cashIn)} /><i className="cashflow-bar bar-expense" style={{ height: `${Math.max(1, Number(day.cashOut) / max * 100)}%` }} title={money.format(day.cashOut)} /></div><span>{day.key.slice(5)}</span></div>)}</div><p className="ledger-help">{t("Own-account transfers net to zero. Opening balances are excluded.", "Transfer antar rekening sendiri bersaldo bersih nol. Saldo awal tidak termasuk arus kas.")}</p></article>
      <article className="panel breakdown-panel"><div className="panel-heading"><div><h2>{t("Expense categories", "Kategori beban")}</h2><p>{t("Selected period, after reversals", "Periode terpilih, setelah pembalik")}</p></div><Link className="subtle-link" href="/reports">{t("Reports", "Laporan")} ›</Link></div><div className="overview-category-list">{categories.map(([category, value]) => <div className="overview-category" key={category}><div className="overview-category-label"><span>{category}</span><strong>{money.format(value)}</strong></div><div className="overview-category-track"><i style={{ width: `${Number(value) / Number(categories[0][1]) * 100}%` }} /></div></div>)}{!categories.length && <p className="ledger-help">{t("No expenses in this period.", "Belum ada beban pada periode ini.")}</p>}</div></article></section>
    <section className="panel ledger-panel"><div className="panel-heading"><div><h2>{t("Recent journal entries", "Jurnal terbaru")}</h2><p>{t("Every entry has matching debit and credit totals", "Setiap jurnal memiliki total debit dan kredit yang sama")}</p></div><Link className="subtle-link" href="/transactions">{t("All entries", "Semua jurnal")} ›</Link></div><JournalList entries={recent} /></section>
    </>}<JournalDialog open={open} onClose={() => setOpen(false)} />
  </div>;
}
