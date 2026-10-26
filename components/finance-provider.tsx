"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { demoTransactions, fromDatabase, transactionToDatabase, type DatabaseTransaction, type NewTransaction, type Transaction } from "@/lib/finance";
import { createClient } from "@/lib/supabase/client";
import { watchVerifiedSession } from "@/lib/verified-session";

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

type FinanceContextValue = {
  configured: boolean;
  transactions: Transaction[];
  loading: boolean;
  loadError: "query" | "connection" | "";
  saving: boolean;
  saveError: "session" | "save" | "";
  clearSaveError: () => void;
  saveTransaction: (transaction: NewTransaction) => Promise<boolean>;
};

const FinanceContext = createContext<FinanceContextValue | null>(null);
const transactionColumns = "id, kind, amount, category, description, transaction_date";

function newestFirst(transactions: Transaction[]) {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date));
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>(configured ? [] : demoTransactions);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<FinanceContextValue["loadError"]>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<FinanceContextValue["saveError"]>("");
  const owner = useRef<string | null>(null);
  const generation = useRef(0);
  const saveAttempt = useRef(0);
  const savingNow = useRef(false);
  const refreshSession = useRef<(() => void) | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    const watcher = watchVerifiedSession(supabase, {
      onInvalidated() {
        owner.current = null;
        generation.current += 1;
        saveAttempt.current += 1;
        savingNow.current = false;
        setTransactions([]);
        setLoadError("");
        setSaveError("");
        setSaving(false);
        setLoading(true);
      },
      async onUser(user, isCurrent) {
        owner.current = user.id;
        setLoading(true);
        setLoadError("");
        try {
          const { data, error } = await supabase.from("transactions")
            .select(transactionColumns).eq("user_id", user.id)
            .order("transaction_date", { ascending: false });
          if (!isCurrent() || owner.current !== user.id) return;
          if (error) { setTransactions([]); setLoadError("query"); }
          else setTransactions((data ?? []).map((row: DatabaseTransaction) => fromDatabase(row)));
        } catch {
          if (isCurrent()) { setTransactions([]); setLoadError("connection"); }
        } finally {
          if (isCurrent()) setLoading(false);
        }
      },
      onSignedOut() { setLoading(false); router.replace("/login"); },
      onError() { setLoadError("connection"); setLoading(false); },
    });
    refreshSession.current = watcher.refresh;
    return () => {
      watcher.dispose();
      refreshSession.current = null;
      owner.current = null;
      generation.current += 1;
      saveAttempt.current += 1;
    };
  }, [router]);

  async function saveTransaction(transaction: NewTransaction) {
    if (savingNow.current) return false;
    const account = owner.current;
    const version = generation.current;
    const attempt = ++saveAttempt.current;
    const isCurrent = () => generation.current === version && owner.current === account && saveAttempt.current === attempt;
    savingNow.current = true;
    setSaving(true);
    setSaveError("");
    try {
      if (configured) {
        const supabase = createClient();
        if (!supabase || !account) { if (isCurrent()) setSaveError("session"); return false; }
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (!isCurrent()) return false;
        if (authError || auth.user?.id !== account) {
          refreshSession.current?.();
          return false;
        }
        const { data, error } = await supabase.from("transactions")
          .insert({ ...transactionToDatabase(transaction), user_id: account })
          .select(transactionColumns).single();
        if (!isCurrent()) return false;
        if (error) { setSaveError("save"); return false; }
        setTransactions((current) => newestFirst([fromDatabase(data as DatabaseTransaction), ...current]));
      } else {
        setTransactions((current) => newestFirst([{ ...transaction, id: crypto.randomUUID(), emoji: "🧾" }, ...current]));
      }
      return true;
    } catch {
      if (isCurrent()) setSaveError("save");
      return false;
    } finally {
      if (isCurrent()) { savingNow.current = false; setSaving(false); }
    }
  }

  return <FinanceContext.Provider value={{ configured, transactions, loading, loadError, saving, saveError, clearSaveError: () => setSaveError(""), saveTransaction }}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) throw new Error("useFinance must be used within FinanceProvider");
  return context;
}
