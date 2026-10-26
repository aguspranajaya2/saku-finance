import type { Language } from "@/lib/preferences";

const messages: Record<string, [string, string]> = {
  invalid_credentials: ["Username, email, or password is incorrect.", "Username, email, atau kata sandi salah."],
  email_not_confirmed: ["Confirm your email before signing in.", "Konfirmasi email terlebih dahulu sebelum masuk."],
  username_setup_required: ["Username sign-in is not available yet. You can still sign in with your email.", "Login username belum tersedia. Kamu tetap bisa masuk memakai email."],
  rate_limited: ["Too many attempts. Wait a minute before trying again.", "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi."],
  invalid_request: ["Enter your username or email and password.", "Isi username atau email dan kata sandi."],
  unavailable: ["Sign-in is temporarily unavailable. Please try again.", "Login sedang tidak tersedia. Silakan coba lagi."],
};

export function signInError(code: string, language: Language) {
  return (messages[code] ?? messages.unavailable)[language === "en" ? 0 : 1];
}
