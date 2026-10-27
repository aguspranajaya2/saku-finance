"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { watchVerifiedSession } from "@/lib/verified-session";
import { readLedger } from "@/lib/ledger-client";
import { demoAccounts, demoJournal, todayDate, validateJournal, type JournalEntry, type LedgerAccount, type NewAccount, type NewJournal } from "@/lib/ledger";

type LedgerError = "" | "migration" | "connection" | "save" | "invalid" | "duplicate";
type LedgerContextValue = {
  configured: boolean; accounts: LedgerAccount[]; entries: JournalEntry[]; loading: boolean; saving: boolean; error: LedgerError;
  clearError: () => void; refresh: () => void;
  postJournal: (entry: NewJournal) => Promise<boolean>;
  createAccount: (account: NewAccount) => Promise<boolean>;
  reverseEntry: (id: string, date: string) => Promise<boolean>;
  recordOpening: (account: LedgerAccount, amount: number, date: string) => Promise<boolean>;
};
const LedgerContext = createContext<LedgerContextValue | null>(null);
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
function errorCode(error: unknown): LedgerError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["42P01", "42703", "PGRST200", "PGRST201", "PGRST202", "PGRST204", "PGRST205"].includes(code) ? "migration" : code === "23505" ? "duplicate" : ["22023", "23514"].includes(code) ? "invalid" : "save";
}
export function LedgerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<LedgerAccount[]>(configured ? [] : demoAccounts);
  const [entries, setEntries] = useState<JournalEntry[]>(configured ? [] : demoJournal);
  const [loading, setLoading] = useState(configured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LedgerError>("");
  const owner = useRef<string | null>(null), generation = useRef(0), operation = useRef(0), busy = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const current = (user: string | null, version: number) => owner.current === user && generation.current === version;

  useEffect(() => {
    const client = createClient(); if (!client) return;
    const watcher = watchVerifiedSession(client, {
      onInvalidated() {
        owner.current = null; generation.current++; operation.current++; busy.current = false;
        setAccounts([]); setEntries([]); setSaving(false); setLoading(true); setError("");
      },
      async onUser(user, isCurrent) {
        owner.current = user.id;
        try {
          const books = await readLedger(client, user.id, isCurrent);
          if (books && isCurrent()) { setAccounts(books.accounts); setEntries(books.entries); setError(books.accounts.length ? "" : "migration"); }
        } catch (cause) { if (isCurrent()) { setAccounts([]); setEntries([]); setError(errorCode(cause) === "migration" ? "migration" : "connection"); } }
        finally { if (isCurrent()) setLoading(false); }
      },
      onSignedOut() { setLoading(false); router.replace("/login"); },
      onError() { setLoading(false); setError("connection"); },
    });
    refreshRef.current = watcher.refresh;
    return () => { watcher.dispose(); generation.current++; operation.current++; owner.current = null; refreshRef.current = () => {}; };
  }, [router]);

  async function mutate(name: string, args: Record<string, unknown>, preview: () => void) {
    if (busy.current) return false;
    const user = owner.current, version = generation.current, attempt = ++operation.current;
    const isCurrent = () => current(user, version) && operation.current === attempt;
    busy.current = true; setSaving(true); setError("");
    try {
      if (!configured) { preview(); return true; }
      const client = createClient(); if (!client || !user) return false;
      const { data: auth, error: authError } = await client.auth.getUser();
      if (!isCurrent()) return false;
      if (authError || auth.user?.id !== user) { refreshRef.current(); return false; }
      const { data: postedId, error: mutationError } = await client.rpc(name, args);
      if (!isCurrent()) return false;
      if (mutationError) { setError(errorCode(mutationError)); return false; }
      if (typeof postedId !== "string" || !postedId) { setError("migration"); return false; }
      // A committed journal must not be retried just because refreshing the view fails.
      try {
        const books = await readLedger(client, user, isCurrent);
        if (books && isCurrent()) { setAccounts(books.accounts); setEntries(books.entries); }
      } catch { if (isCurrent()) setError("connection"); }
      return isCurrent();
    } catch { if (isCurrent()) setError("connection"); return false; }
    finally { if (isCurrent()) { busy.current = false; setSaving(false); } }
  }
  async function postJournal(entry: NewJournal) {
    if (!validateJournal(entry.lines)) { setError("invalid"); return false; }
    return mutate("post_journal", { p_entry_date: entry.date, p_memo: entry.memo, p_lines: entry.lines.map(({ account_id, debit, credit }) => ({ account_id, debit, credit })),
      p_entry_type: entry.type, p_category: entry.category, p_request_id: entry.requestId }, () => {
      setEntries(previous => [...previous, { id: crypto.randomUUID(), entry_date: entry.date, memo: entry.memo, entry_type: entry.type, category: entry.category,
        journal_lines: entry.lines, source: "web", created_at: new Date().toISOString(), reversal_of: null, reversed_by: null }]);
    });
  }
  async function createAccount(account: NewAccount) {
    if (accounts.some(a => a.code === account.code)) { setError("duplicate"); return false; }
    return mutate("create_ledger_account", { p_code: account.code, p_name: account.name, p_account_type: account.type, p_role: account.role,
      p_opening_balance: account.openingBalance, p_opening_date: account.openingDate }, () => {
      const id = crypto.randomUUID();
      setAccounts(previous => [...previous, { id, code: account.code, name: account.name, account_type: account.type, role: account.role }].sort((a, b) => a.code.localeCompare(b.code)));
      if (account.openingBalance) {
        const equity = accounts.find(a => a.role === "opening_equity")!;
        const positiveAsset = (account.type === "asset") === (account.openingBalance > 0);
        const amount = Math.abs(account.openingBalance);
        setEntries(previous => [...previous, { id: crypto.randomUUID(), entry_date: account.openingDate, memo: `Opening balance: ${account.name}`, entry_type: "opening", category: "Saldo awal", source: "web",
          created_at: new Date().toISOString(), reversal_of: null, reversed_by: null, journal_lines: [
            { account_id: positiveAsset ? id : equity.id, debit: amount, credit: 0 }, { account_id: positiveAsset ? equity.id : id, debit: 0, credit: amount },
          ] }]);
      }
    });
  }
  async function reverseEntry(id: string, date: string) {
    const entry = entries.find(e => e.id === id);
    if (!entry || entry.reversal_of || entry.reversed_by || date < entry.entry_date) { setError("invalid"); return false; }
    return mutate("reverse_journal", { p_entry_id: id, p_entry_date: date }, () => {
      const reversal = crypto.randomUUID();
      setEntries(previous => [...previous.map(e => e.id === id ? { ...e, reversed_by: reversal } : e), { ...entry, id: reversal, entry_date: date,
        memo: `Reversal: ${entry.memo}`.slice(0, 240), entry_type: "reversal", reversal_of: id, reversed_by: null, created_at: new Date().toISOString(),
        journal_lines: entry.journal_lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }]);
    });
  }
  async function recordOpening(account: LedgerAccount, amount: number, date: string) {
    const prior = entries.find(e => e.entry_type === "opening" && !e.reversed_by && e.journal_lines.some(l => l.account_id === account.id));
    if (!Number.isSafeInteger(amount) || !amount || prior || entries.some(e => e.entry_date < date && e.journal_lines.some(l => l.account_id === account.id))) { setError("invalid"); return false; }
    return mutate("record_opening_balance", { p_account_id: account.id, p_amount: amount, p_entry_date: date }, () => {
      const equity = accounts.find(a => a.role === "opening_equity")!;
      const positiveAsset = (account.account_type === "asset") === (amount > 0);
      setEntries(previous => [...previous, { id: crypto.randomUUID(), entry_date: date, memo: `Opening balance: ${account.name}`, entry_type: "opening", category: "Saldo awal", source: "web",
        created_at: new Date().toISOString(), reversal_of: null, reversed_by: null, journal_lines: [
          { account_id: positiveAsset ? account.id : equity.id, debit: Math.abs(amount), credit: 0 }, { account_id: positiveAsset ? equity.id : account.id, debit: 0, credit: Math.abs(amount) },
        ] }]);
    });
  }
  return <LedgerContext.Provider value={{ configured, accounts, entries, loading, saving, error, clearError: () => setError(""), refresh: () => refreshRef.current(), postJournal, createAccount, reverseEntry, recordOpening }}>{children}</LedgerContext.Provider>;
}
export function useLedger() { const value = useContext(LedgerContext); if (!value) throw new Error("LedgerProvider required"); return value; }
