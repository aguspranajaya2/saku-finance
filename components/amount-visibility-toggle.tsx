"use client";

import { usePreferences } from "@/lib/preferences";

export function AmountVisibilityToggle() {
  const { language, amountsHidden, toggleAmounts } = usePreferences();
  const label = language === "en" ? (amountsHidden ? "Show amounts" : "Hide amounts") : (amountsHidden ? "Tampilkan nominal" : "Sembunyikan nominal");
  return <button className="theme-toggle amount-visibility-toggle" type="button" onClick={toggleAmounts} aria-label={label} title={label} aria-pressed={amountsHidden}>
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{amountsHidden && <path d="m3 3 18 18" />}
    </svg>
  </button>;
}
