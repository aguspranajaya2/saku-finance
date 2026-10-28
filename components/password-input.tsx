"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { usePreferences } from "@/lib/preferences";

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & { id: string };

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const { language } = usePreferences();
  const label = language === "en"
    ? (visible ? "Hide password" : "Show password")
    : (visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi");

  return <div className="password-input-wrap">
    <input {...props} type={visible ? "text" : "password"} />
    <button aria-controls={props.id} aria-label={label} aria-pressed={visible} className="password-visibility-toggle" disabled={props.disabled} onClick={() => setVisible(current => !current)} title={label} type="button">
      <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </div>;
}
